// MAIN world. Passively records the latest map-properties request/response by
// wrapping fetch and XHR (the page's own calls are never modified), and runs the
// replay. Auth headers live only in this closure; they are never logged, stored,
// or posted anywhere.
import { openMainChannel } from '@/src/bridge';
import { Collector, type Auth, type Env } from '@/src/collector';
import { CONFIG } from '@/src/config';
import { DEBUG, debug } from '@/src/debug';
import type { Usage } from '@/src/pacing';
import { parseSearchResponse } from '@/src/response';
import { getPreset } from '@/src/presets';
import { isSessionTokenUrl, pickAuthorization, sessionJwt } from '@/src/clerk';
import { describeAuth } from '@/src/token-age';
import { authState, safeTarget, tokenKeys } from '@/src/trace';
import { buildTemplate, type CapturedTemplate } from '@/src/run-setup';
import { parseCommand } from '@/src/types';

interface Meta {
  url: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials;
  body: string | null;
}

export default defineContentScript({
  matches: ['*://*.dealmachine.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const origFetch = window.fetch;
    const boundFetch: typeof fetch = (...a) => origFetch.apply(window, a);

    let template: CapturedTemplate | null = null;
    // List type chosen in the panel; decides the effective body and the search key.
    let selection: { presetId: string | null; excluded: number[] } = { presetId: null, excluded: [] };
    let lastCount = 0;
    let lastUsage: Usage | null = null;

    // Auth material, memory-only, per API host. Refreshed by every API request the page
    // makes, so a long-lived tab keeps replay credentials as fresh as the page's own.
    const BODY_HEADERS = new Set(['content-type', 'content-length']);
    const CRED_RANK: Record<string, number> = { omit: 0, 'same-origin': 1, include: 2 };
    const authByHost = new Map<string, Auth>();
    // Newest session JWT the page itself minted via Clerk (see src/clerk.ts). Memory-only.
    let clerkJwt: string | null = null;

    function noteAuth(url: string, headers: Record<string, string>, credentials: RequestCredentials): void {
      const host = new URL(url).host;
      const cur = authByHost.get(host) ?? { headers: {}, credentials };
      const merged = { ...cur.headers };
      for (const [k, v] of Object.entries(headers)) if (!BODY_HEADERS.has(k)) merged[k] = v;
      // Credentials mode is configuration, not a token: never downgrade it.
      const stronger = (CRED_RANK[credentials] ?? 0) > (CRED_RANK[cur.credentials] ?? 0);
      authByHost.set(host, {
        headers: merged,
        credentials: stronger ? credentials : cur.credentials,
        seenAt: Date.now(),
      });
    }

    const isApiRequest = (url: string) => {
      const u = new URL(url);
      return (
        (u.hostname === CONFIG.apiHostSuffix || u.hostname.endsWith(`.${CONFIG.apiHostSuffix}`)) &&
        u.pathname.startsWith(CONFIG.apiPathPrefix)
      );
    };

    const env: Env = {
      visible: () => document.visibilityState === 'visible',
      whenVisible: (signal) =>
        new Promise((resolve) => {
          if (document.visibilityState === 'visible' || signal.aborted) return resolve();
          const done = () => {
            document.removeEventListener('visibilitychange', onChange);
            signal.removeEventListener('abort', done);
            resolve();
          };
          const onChange = () => {
            if (document.visibilityState === 'visible') done();
          };
          document.addEventListener('visibilitychange', onChange);
          signal.addEventListener('abort', done);
        }),
    };

    const channel = openMainChannel(
      (raw) => {
        const cmd = parseCommand(raw);
        if (!cmd) return;
        if (cmd.type === 'stop') return collector.stop(cmd.runId);
        if (cmd.type === 'proceed') return collector.proceed(cmd.runId, cmd.maxPages);
        if (cmd.type === 'select') return select(cmd.presetId, cmd.excluded);
        if (cmd.type === 'resume') return void resumeRun(cmd);
        void startRun(cmd.runId, cmd.maxPages, cmd.presetId, cmd.excluded);
      },
      () => announceCapture(),
    );

    const collector = new Collector(
      boundFetch,
      (m) => channel.sendData(m),
      () => {
        const base = (template && authByHost.get(new URL(template.url).host)) || { headers: {}, credentials: 'include' };
        const held = base.headers['authorization'];
        const pick = pickAuthorization(held, clerkJwt);
        return pick && pick !== held ? { ...base, headers: { ...base.headers, authorization: pick } } : base;
      },
      env,
    );

    function announceCapture(): void {
      if (!template) return;
      const tpl = buildTemplate(template, selection.presetId, selection.excluded);
      if (!tpl) return;
      channel.sendData({
        type: 'captured',
        count: lastCount,
        pageSize: template.pageSize,
        dailyRemaining: lastUsage?.dailyRemaining ?? null,
        searchKey: tpl.searchKey,
        presetId: selection.presetId,
        excluded: selection.excluded,
      });
    }

    function select(presetId: string | null, excluded: number[]): void {
      if (collector.running || (presetId !== null && !getPreset(presetId))) return;
      const key = JSON.stringify([presetId, [...excluded].sort((a, b) => a - b)]);
      if (key === JSON.stringify([selection.presetId, [...selection.excluded].sort((a, b) => a - b)])) return;
      selection = { presetId, excluded };
      announceCapture();
    }

    const fail = (runId: string, message: string, collected = 0) =>
      channel.sendData({ type: 'done', runId, reason: 'error', message, collected, dailyRemaining: null });

    async function startRun(
      runId: string,
      maxPages: number | null,
      presetId: string | null,
      excluded: number[],
    ): Promise<void> {
      if (collector.running) return;
      if (!template) {
        channel.sendData({
          type: 'done',
          runId,
          reason: 'error',
          message: 'No captured search. Run or refresh your search first.',
          collected: 0,
          dailyRemaining: null,
        });
        return;
      }
      const tpl = buildTemplate(template, presetId, excluded);
      if (!tpl) return fail(runId, 'Unknown list type');
      selection = { presetId, excluded };
      const usage = await collector.run(tpl, {
        runId,
        startRow: 0,
        page: 0,
        maxPages,
        knownIds: [],
        usage: lastUsage,
        // A preset's true count is only known after its first page; that page is page 1 of the run.
        gate: tpl.managedSession,
      });
      lastUsage = usage ?? lastUsage;
    }

    /** Continue the same run from a saved row using the freshest template and auth. */
    async function resumeRun(cmd: Extract<NonNullable<ReturnType<typeof parseCommand>>, { type: 'resume' }>): Promise<void> {
      if (collector.running) return;
      if (!template) return fail(cmd.runId, 'No captured search. Refresh your search first.', cmd.ids.length);
      // Same preset and unchecked filters as the run, so the key covers the effective body.
      const tpl = buildTemplate(template, cmd.presetId, cmd.excluded);
      if (!tpl) return fail(cmd.runId, 'Unknown list type', cmd.ids.length);
      if (cmd.searchKey !== null && cmd.searchKey !== tpl.searchKey) {
        channel.sendData({ type: 'resume_refused', runId: cmd.runId });
        return;
      }
      selection = { presetId: cmd.presetId, excluded: cmd.excluded };
      const usage = await collector.run(tpl, {
        runId: cmd.runId,
        startRow: cmd.startRow,
        page: cmd.page,
        maxPages: cmd.maxPages,
        knownIds: cmd.ids,
        usage: lastUsage,
        resultSessionId: cmd.resultSessionId,
      });
      lastUsage = usage ?? lastUsage;
    }

    function record(meta: Meta, responseJson: unknown): void {
      // A search captured mid-run is ignored until the run ends.
      if (collector.running) return;
      const res = parseSearchResponse(responseJson);
      if (!res || meta.body === null) return;
      let body: unknown;
      try {
        body = JSON.parse(meta.body);
      } catch {
        return;
      }
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
      const b = body as Record<string, unknown>;

      let pageSize = res.pageSize;
      if (!pageSize && typeof b.startRow === 'number' && typeof b.endRow === 'number') {
        pageSize = b.endRow - b.startRow;
      }
      if (!pageSize || pageSize <= 0) pageSize = CONFIG.defaultPageSize;

      // The body template is kept apart from auth; auth was already refreshed from this
      // request when it started. A search capture resets the credentials mode to the page's.
      const ct = meta.headers['content-type'];
      const host = new URL(meta.url).host;
      const cur = authByHost.get(host);
      if (cur) authByHost.set(host, { ...cur, credentials: meta.credentials });
      template = {
        url: meta.url,
        method: meta.method,
        bodyHeaders: { 'content-type': ct ?? 'application/json' },
        body: b,
        pageSize,
      };
      lastCount = res.count;
      lastUsage = res.usage;
      debug('captured search', { count: res.count, pageSize });
      announceCapture();
    }

    const matches = (url: string) => CONFIG.endpointPattern.test(url);

    // --- debug trace -------------------------------------------------------
    // With DEBUG on, log every request the page makes (host/path, status, whether its
    // Authorization header is the one we hold, and the NAMES of token-like response keys).
    // Used to find which call refreshes the login token. Never logs values.
    function heldAuthorization(url: URL): string | undefined {
      return authByHost.get(url.host)?.headers['authorization'];
    }
    function traceLog(method: string, url: URL, status: number, auth: string, json: unknown): void {
      const keys = tokenKeys(json);
      debug(`page request: ${method} ${safeTarget(url)} -> ${status} auth=${auth}${keys.length ? ` token-keys=${keys.join(',')}` : ''}`);
    }

    // --- fetch -----------------------------------------------------------
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      let trace: { method: string; url: URL; auth: string } | null = null;
      let tokenCall = false;
      let reqUrl: URL | null = null;
      const req = typeof Request !== 'undefined' && args[0] instanceof Request ? args[0] : null;
      try {
        reqUrl = new URL(req ? req.url : String(args[0]), location.href);
        tokenCall = isSessionTokenUrl(reqUrl, CONFIG.apiHostSuffix);
      } catch {
        reqUrl = null;
      }
      if (DEBUG && reqUrl) {
        const url = reqUrl;
        try {
          const h = new Headers(args[1]?.headers ?? req?.headers);
          const method = (args[1]?.method ?? req?.method ?? 'GET').toUpperCase();
          trace = { method, url, auth: authState(heldAuthorization(url), h.get('authorization') ?? undefined) };
        } catch {
          trace = null;
        }
      }
      let metaP: Promise<Meta | null> | null = null;
      try {
        metaP = describeFetch(args[0], args[1]);
      } catch {
        metaP = null;
      }
      const p = Reflect.apply(origFetch, this ?? window, args) as Promise<Response>;
      if (tokenCall) {
        p.then(async (res) => {
          if (!res.ok) return;
          const jwt = sessionJwt(await res.clone().json());
          if (!jwt) return;
          clerkJwt = jwt;
          debug('page minted a new session token;', describeAuth({ authorization: `Bearer ${jwt}` }, null, Date.now()));
        }).catch(() => {});
      }
      if (trace) {
        const t = trace;
        p.then(async (res) => {
          let json: unknown = null;
          try {
            json = await res.clone().json();
          } catch {
            /* not JSON */
          }
          traceLog(t.method, t.url, res.status, t.auth, json);
        }).catch(() => {});
      }
      if (metaP) {
        p.then(async (res) => {
          if (!res.ok) return;
          const meta = await metaP;
          if (!meta) return;
          record(meta, await res.clone().json());
        }).catch(() => {});
      }
      return p;
    };

    function describeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Meta | null> | null {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const rawUrl = isReq ? input.url : String(input);
      const url = new URL(rawUrl, location.href).href;
      const api = isApiRequest(url);
      if (!api && !matches(url)) return null;

      const headers: Record<string, string> = {};
      new Headers(init?.headers ?? (isReq ? input.headers : undefined)).forEach((v, k) => {
        headers[k] = v;
      });
      const method = (init?.method ?? (isReq ? input.method : 'GET')).toUpperCase();
      const credentials = init?.credentials ?? (isReq ? input.credentials : 'same-origin');
      if (api) noteAuth(url, headers, credentials);
      if (!matches(url)) return null;

      let bodyP: Promise<string | null>;
      if (typeof init?.body === 'string') bodyP = Promise.resolve(init.body);
      else if (isReq && init?.body === undefined) bodyP = input.clone().text();
      else bodyP = Promise.resolve(null);

      return bodyP.then((body) => ({ url, method, headers, credentials, body }));
    }

    // --- XMLHttpRequest ----------------------------------------------------
    interface XhrState {
      url: string;
      method: string;
      headers: Record<string, string>;
      search: boolean;
    }
    const xhrState = new WeakMap<XMLHttpRequest, XhrState>();
    const proto = XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSetHeader = proto.setRequestHeader;
    const origSend = proto.send;

    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        const url = new URL(String(args[1]), location.href).href;
        if (isApiRequest(url) || matches(url)) {
          xhrState.set(this, { url, method: String(args[0]).toUpperCase(), headers: {}, search: matches(url) });
        } else xhrState.delete(this);
      } catch {
        /* never break the page */
      }
      return Reflect.apply(origOpen, this, args);
    } as typeof proto.open;

    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      try {
        const st = xhrState.get(this);
        if (st) st.headers[name.toLowerCase()] = value;
      } catch {
        /* ignore */
      }
      return origSetHeader.call(this, name, value);
    };

    const xhrTrace = new WeakMap<XMLHttpRequest, { method: string; url: URL }>();
    const origOpen2 = proto.open;
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      if (DEBUG) {
        try {
          xhrTrace.set(this, { method: String(args[0]).toUpperCase(), url: new URL(String(args[1]), location.href) });
        } catch {
          /* ignore */
        }
      }
      return Reflect.apply(origOpen2, this, args);
    } as typeof proto.open;
    const xhrHeaders = new WeakMap<XMLHttpRequest, Record<string, string>>();
    const origSetHeader2 = proto.setRequestHeader;
    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      if (DEBUG && name.toLowerCase() === 'authorization') {
        const h = xhrHeaders.get(this) ?? {};
        h['authorization'] = value;
        xhrHeaders.set(this, h);
      }
      return origSetHeader2.call(this, name, value);
    };

    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      if (DEBUG) {
        try {
          const t = xhrTrace.get(this);
          if (t) {
            const auth = authState(heldAuthorization(t.url), xhrHeaders.get(this)?.['authorization']);
            const xhr = this;
            xhr.addEventListener('loadend', () => {
              let json: unknown = null;
              try {
                json = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
              } catch {
                /* not JSON */
              }
              traceLog(t.method, t.url, xhr.status, auth, json);
            });
          }
        } catch {
          /* ignore */
        }
      }
      try {
        const st = xhrState.get(this);
        if (st) noteAuth(st.url, st.headers, this.withCredentials ? 'include' : 'same-origin');
        if (st && st.search && typeof body === 'string') {
          const xhr = this;
          xhr.addEventListener('loadend', () => {
            try {
              if (xhr.status < 200 || xhr.status >= 300) return;
              const json: unknown = xhr.responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
              record(
                {
                  url: st.url,
                  method: st.method,
                  headers: st.headers,
                  credentials: xhr.withCredentials ? 'include' : 'same-origin',
                  body,
                },
                json,
              );
            } catch {
              /* response not readable/JSON */
            }
          });
        }
      } catch {
        /* ignore */
      }
      return origSend.call(this, body);
    };
  },
});
