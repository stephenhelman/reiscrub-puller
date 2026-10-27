// Runs in the MAIN world. Replays the captured search request page by page,
// changing only startRow/endRow, and streams deduped records out.
import { CONFIG } from './config';
import { debug } from './debug';
import { backoffMs, isThrottled, orgResetWaitMs, shortDelayMs, type Usage } from './pacing';
import { parseSearchResponse, type ParsedResponse } from './response';
import type { DataMessage, DoneReason, PuRecord } from './types';

/** What to ask for. Auth material is kept separately (see Auth) so it can be refreshed independently. */
export interface Template {
  url: string;
  method: string;
  /** Body-describing headers only (content-type). */
  bodyHeaders: Record<string, string>;
  /** Parsed original request body. */
  body: Record<string, unknown>;
  pageSize: number;
  searchKey: string;
}

/** How to authenticate. Memory-only, read fresh for every request. */
export interface Auth {
  headers: Record<string, string>;
  credentials: RequestCredentials;
}

export interface Env {
  visible(): boolean;
  /** Resolves when the page becomes visible, or the signal aborts. */
  whenVisible(signal: AbortSignal): Promise<void>;
}

export interface RunOptions {
  runId: string;
  startRow: number;
  page: number;
  maxPages: number | null;
  knownIds: Iterable<number>;
  usage: Usage | null;
}

class FatalError extends Error {}
class StopSignal extends Error {}
/** 401/403: never retried; the run parks in needs_reauth. */
class AuthError extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

function toRecord(row: unknown): PuRecord | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const id = r.internal_property_id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id)) return null;
  if (typeof r.displayLine1 !== 'string' || typeof r.displayLine2 !== 'string') return null;
  return { id, line1: r.displayLine1, line2: r.displayLine2 };
}

function retryAfterMs(res: Response): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(CONFIG.pacing.backoffCapMs, s * 1000) : null;
}

export class Collector {
  private ctl: AbortController | null = null;
  private runId: string | null = null;

  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly emit: (m: DataMessage) => void,
    private readonly getAuth: () => Auth,
    private readonly env: Env,
  ) {}

  get running(): boolean {
    return this.ctl !== null;
  }

  stop(runId: string): void {
    if (this.ctl && this.runId === runId) this.ctl.abort();
  }

  /** Returns the last usage seen so the caller can keep its pre-flight numbers fresh. */
  async run(tpl: Template, opts: RunOptions): Promise<Usage | null> {
    if (this.ctl) throw new Error('A run is already in progress');
    const { runId, maxPages } = opts;
    const ctl = new AbortController();
    this.ctl = ctl;
    this.runId = runId;

    const pacing = CONFIG.pacing;
    const started = Date.now();
    const seen = new Set<number>(opts.knownIds);
    let usage = opts.usage;
    let startRow = opts.startRow;
    let page = opts.page;
    let total = 0;
    let throttleN = 0;
    let reason: DoneReason = 'complete';
    let message: string | undefined;
    let needsReauth = false;

    const progress = (state: 'fetching' | 'waiting' | 'retrying' | 'paused', waitMs: number) =>
      this.emit({
        type: 'progress',
        runId,
        state,
        page,
        collected: seen.size,
        total,
        waitMs,
        tokens: usage?.userTokensRemaining ?? null,
        dailyRemaining: usage?.dailyRemaining ?? null,
      });

    try {
      for (;;) {
        if (ctl.signal.aborted) {
          reason = 'stopped';
          break;
        }
        if (maxPages !== null && page >= maxPages) {
          reason = 'max-pages';
          break;
        }

        if (!this.env.visible()) {
          // No requests while the tab is hidden; re-evaluate everything once it's back.
          progress('paused', 0);
          debug('tab hidden: paused');
          await this.env.whenVisible(ctl.signal);
          continue;
        }

        const tokensBefore = usage?.userTokensRemaining ?? null;
        progress('fetching', 0);
        const res = await this.fetchPage(tpl, startRow, {
          retry: (ms) => {
            progress('retrying', ms);
            return sleep(ms, ctl.signal);
          },
          gate: async () => {
            while (!this.env.visible() && !ctl.signal.aborted) {
              progress('paused', 0);
              await this.env.whenVisible(ctl.signal);
            }
          },
        });

        usage = res.usage ?? usage;
        total = res.count;
        const fresh: PuRecord[] = [];
        for (const row of res.rows) {
          const rec = toRecord(row);
          if (rec && !seen.has(rec.id)) {
            seen.add(rec.id);
            fresh.push(rec);
          }
        }
        if (fresh.length > 0) this.emit({ type: 'records', runId, records: fresh });
        page += 1;
        startRow += tpl.pageSize;

        let wait = 0;
        const more =
          res.rows.length > 0 &&
          seen.size < res.count &&
          startRow < res.totalRows &&
          usage?.dailyRemaining !== 0 &&
          !ctl.signal.aborted;

        if (more) {
          if (isThrottled(usage, pacing)) {
            wait = Math.max(backoffMs(throttleN, pacing), orgResetWaitMs(usage, pacing, Date.now()));
            throttleN += 1;
          } else {
            throttleN = 0;
            wait = shortDelayMs(pacing);
          }
        }

        debug(
          `page ${page} rows=${res.rows.length} new=${fresh.length} collected=${seen.size}/${res.count}`,
          `tokens ${tokensBefore ?? '?'}→${usage?.userTokensRemaining ?? '?'}`,
          `org/min=${usage?.orgRemainingThisMinute ?? '?'} daily=${usage?.dailyRemaining ?? '?'}`,
          `wait=${wait}ms t+${((Date.now() - started) / 1000).toFixed(1)}s`,
        );

        if (!more) {
          if (ctl.signal.aborted) reason = 'stopped';
          else if (res.rows.length > 0 && seen.size < res.count && startRow < res.totalRows) reason = 'daily-limit';
          else reason = 'complete';
          break;
        }
        progress('waiting', wait);
        await sleep(wait, ctl.signal);
      }
    } catch (e) {
      if (e instanceof StopSignal) {
        reason = 'stopped';
      } else if (e instanceof AuthError) {
        needsReauth = true;
        debug('auth rejected (401/403): parked for re-auth at row', startRow);
      } else {
        reason = 'error';
        message = e instanceof FatalError ? e.message : 'Unexpected error while collecting';
        if (!(e instanceof FatalError)) debug('unexpected error', e);
      }
    } finally {
      this.ctl = null;
      this.runId = null;
    }

    if (needsReauth) {
      this.emit({
        type: 'needs_reauth',
        runId,
        page,
        collected: seen.size,
        total,
        nextStartRow: startRow,
        searchKey: tpl.searchKey,
        dailyRemaining: usage?.dailyRemaining ?? null,
      });
      return usage;
    }

    this.emit({
      type: 'done',
      runId,
      reason,
      ...(message ? { message: message.slice(0, 300) } : {}),
      collected: seen.size,
      dailyRemaining: usage?.dailyRemaining ?? null,
    });
    return usage;
  }

  private async fetchPage(
    tpl: Template,
    startRow: number,
    hooks: { retry: (ms: number) => Promise<void>; gate: () => Promise<void> },
  ): Promise<ParsedResponse> {
    const body = JSON.stringify({ ...tpl.body, startRow, endRow: startRow + tpl.pageSize });

    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        const auth = this.getAuth(); // freshest headers at send time
        res = await this.fetchFn(tpl.url, {
          method: tpl.method,
          headers: { ...auth.headers, ...tpl.bodyHeaders },
          credentials: auth.credentials,
          body,
        });
      } catch {
        res = null; // network error: retryable
      }

      if (res && res.ok) {
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new FatalError('Response was not valid JSON');
        }
        const parsed = parseSearchResponse(json);
        if (!parsed) throw new FatalError('Unexpected response shape');
        return parsed;
      }

      if (res && (res.status === 401 || res.status === 403)) throw new AuthError();

      const retryable = res === null || res.status === 429 || res.status >= 500;
      if (!retryable) throw new FatalError(`Request failed with HTTP ${res?.status}`);
      if (attempt >= CONFIG.pacing.maxRetries) {
        throw new FatalError(
          `${res ? `HTTP ${res.status}` : 'Network error'} after ${CONFIG.pacing.maxRetries} retries`,
        );
      }
      const wait = (res && retryAfterMs(res)) ?? backoffMs(attempt, CONFIG.pacing);
      debug(`retry ${attempt + 1}/${CONFIG.pacing.maxRetries} in ${wait}ms (${res ? res.status : 'network'})`);
      await hooks.retry(wait);
      if (this.ctl?.signal.aborted) throw new StopSignal();
      // A retry must not go out while the tab is hidden either.
      await hooks.gate();
      if (this.ctl?.signal.aborted) throw new StopSignal();
    }
  }
}
