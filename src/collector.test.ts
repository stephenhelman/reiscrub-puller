// Runs the Collector against an in-memory stand-in for DealMachine's search endpoint.
import { beforeAll, describe, expect, it } from 'vitest';
import { Collector, type Auth, type Env } from './collector';
import { CONFIG } from './config';
import { effectiveBody } from './effective-body';
import { getPreset } from './presets';
import { buildTemplate, type CapturedTemplate } from './run-setup';
import type { DataMessage } from './types';

beforeAll(() => {
  CONFIG.pacing.minDelayMs = 0;
  CONFIG.pacing.maxDelayMs = 0;
});

const URL_ = 'https://api.dealmachine.com/api/search/map-properties';
const LOCATION = [{ locationId: 39981, locationType: 'zipCode', locationCode: '77033' }];
const userFilter = (id: number, v: string) => ({ filterId: id, label: `U${id}`, operation: 'o', data: { v } });

function captured(over: Record<string, unknown> = {}): CapturedTemplate {
  return {
    url: URL_,
    method: 'POST',
    bodyHeaders: { 'content-type': 'application/json' },
    pageSize: 25,
    body: {
      // 29 overrides the preset's Property Type; 999 is new.
      filters: [userFilter(29, 'user'), userFilter(999, 'user')],
      filterGroups: [],
      policyFilters: [],
      locations: LOCATION,
      includeLists: [],
      excludeLists: [],
      fields: ['internal_property_id'],
      resultSessionId: 'stale-from-the-page',
      startRow: 0,
      endRow: 25,
      ...over,
    },
  };
}

interface Sent {
  body: Record<string, unknown>;
}

/** Issues session S1 on a request with resultSessionId null and then requires it. */
function fakeServer(opts: { total: number; daily?: number; failAuthAtRow?: number }) {
  const sent: Sent[] = [];
  const live = new Set<string>();
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ body });
    const startRow = body.startRow as number;
    const endRow = body.endRow as number;
    if (opts.failAuthAtRow === startRow) return new Response('no', { status: 401 });
    let session = body.resultSessionId;
    if (session === null) {
      session = 'S1';
      live.add('S1');
    } else if (typeof session !== 'string' || !live.has(session)) {
      return new Response('unknown session', { status: 400 });
    }
    const rows = [];
    for (let i = startRow; i < Math.min(endRow, opts.total); i++) {
      rows.push({ internal_property_id: i + 1, displayLine1: `${i + 1} Main St`, displayLine2: 'Houston, TX' });
    }
    return Response.json({
      count: opts.total,
      rows,
      pageSize: 25,
      resultSessionId: session,
      freeUsage: {
        pagination: { dailyRemaining: opts.daily ?? 100, userTokensRemaining: 10, organizationRemainingThisMinute: 10 },
      },
    });
  }) as typeof fetch;
  return { fetchFn, sent, live };
}

function harness(server: ReturnType<typeof fakeServer>, onMessage?: (m: DataMessage, c: Collector) => void) {
  const messages: DataMessage[] = [];
  const auth: Auth = { headers: { authorization: 'Bearer t' }, credentials: 'include' };
  const env: Env = { visible: () => true, whenVisible: async () => {} };
  const collector: Collector = new Collector(
    server.fetchFn,
    (m) => {
      messages.push(m);
      onMessage?.(m, collector);
    },
    () => auth,
    env,
  );
  const done = () => messages.find((m) => m.type === 'done') as Extract<DataMessage, { type: 'done' }> | undefined;
  const ids = () =>
    messages.flatMap((m) => (m.type === 'records' ? m.records.map((r) => (r as { id: number }).id) : []));
  return { collector, messages, done, ids };
}

const run = { usage: null, knownIds: [] as number[] };

describe('preset run', () => {
  it('sends resultSessionId null first, then the session the server returned', async () => {
    const server = fakeServer({ total: 60 });
    const h = harness(server);
    const tpl = buildTemplate(captured(), 'cash-buyers', [])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });

    expect(server.sent.map((s) => s.body.resultSessionId)).toEqual([null, 'S1', 'S1']);
    expect(server.sent.map((s) => s.body.startRow)).toEqual([0, 25, 50]);
    expect(h.ids()).toHaveLength(60);
    expect(h.done()?.reason).toBe('complete');
  });

  it('sends the merged filters, the user\'s location and the user\'s other keys', async () => {
    const server = fakeServer({ total: 10 });
    const h = harness(server);
    const cap = captured();
    const tpl = buildTemplate(cap, 'cash-buyers', [431])!; // 431 unchecked
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });

    const body = server.sent[0]!.body;
    const filters = body.filters as { filterId: number; data: { v?: string } }[];
    expect(filters.map((f) => f.filterId)).toEqual([795, 29, 123, 775, 999]);
    expect(filters.find((f) => f.filterId === 29)?.data.v).toBe('user'); // user's version won
    expect(body.locations).toEqual(LOCATION);
    expect(body.fields).toEqual(['internal_property_id']);
    expect(body.policyFilters).toEqual([]);
    expect(body.filters).toEqual(effectiveBody(cap.body, getPreset('cash-buyers')!, [431]).filters);
  });

  it('leaves a non-preset run untouched, including the body\'s own resultSessionId', async () => {
    const server = fakeServer({ total: 10 });
    server.live.add('stale-from-the-page');
    const h = harness(server);
    const tpl = buildTemplate(captured(), null, [])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, ...run });
    expect(server.sent[0]!.body.resultSessionId).toBe('stale-from-the-page');
    expect(server.sent[0]!.body.filters).toEqual(captured().body.filters);
  });

  it('pauses after page 1 when the pages left exceed the daily budget', async () => {
    const server = fakeServer({ total: 100, daily: 1 }); // 4 pages; 3 left after page 1
    const h = harness(server, (m, c) => {
      if (m.type === 'gate') setTimeout(() => c.proceed(m.runId, m.page + m.dailyRemaining), 0);
    });
    const tpl = buildTemplate(captured(), 'cash-buyers', [])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });

    const gate = h.messages.find((m) => m.type === 'gate');
    expect(gate).toMatchObject({ page: 1, count: 100, pagesLeft: 3, dailyRemaining: 1 });
    expect(server.sent).toHaveLength(2); // page 1 (kept) + the one page the budget allows
    expect(h.ids()).toHaveLength(50);
    expect(h.done()?.reason).toBe('max-pages');
  });

  it('keeps page 1 and stops when the gate is cancelled', async () => {
    const server = fakeServer({ total: 100, daily: 1 });
    const h = harness(server, (m, c) => {
      if (m.type === 'gate') setTimeout(() => c.stop(m.runId), 0);
    });
    const tpl = buildTemplate(captured(), 'cash-buyers', [])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });
    expect(server.sent).toHaveLength(1);
    expect(h.ids()).toHaveLength(25);
    expect(h.done()?.reason).toBe('stopped');
  });

  it('does not gate when the budget covers the rest', async () => {
    const server = fakeServer({ total: 100, daily: 3 });
    const h = harness(server);
    const tpl = buildTemplate(captured(), 'cash-buyers', [])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });
    expect(h.messages.some((m) => m.type === 'gate')).toBe(false);
    expect(h.ids()).toHaveLength(100);
  });
});

describe('resume with a preset', () => {
  it('parks on 401 with the session and effective search key, then resumes with the same session', async () => {
    const server = fakeServer({ total: 100, failAuthAtRow: 50 });
    const h = harness(server);
    const tpl = buildTemplate(captured(), 'cash-buyers', [775])!;
    await h.collector.run(tpl, { runId: 'r', startRow: 0, page: 0, maxPages: null, gate: true, ...run });

    const parked = h.messages.find((m) => m.type === 'needs_reauth') as Extract<DataMessage, { type: 'needs_reauth' }>;
    expect(parked).toMatchObject({ nextStartRow: 50, sessionId: 'S1', searchKey: tpl.searchKey });

    // Same preset and unchecked filters => same key; any change => refused.
    expect(buildTemplate(captured(), 'cash-buyers', [775])!.searchKey).toBe(parked.searchKey);
    expect(buildTemplate(captured(), 'cash-buyers', [])!.searchKey).not.toBe(parked.searchKey);
    expect(buildTemplate(captured(), null, [])!.searchKey).not.toBe(parked.searchKey);
    expect(buildTemplate(captured({ locations: [] }), 'cash-buyers', [775])!.searchKey).not.toBe(parked.searchKey);

    const server2 = fakeServer({ total: 100 });
    server2.live.add('S1');
    const h2 = harness(server2);
    const resumed = buildTemplate(captured(), 'cash-buyers', [775])!;
    await h2.collector.run(resumed, {
      runId: 'r',
      startRow: 50,
      page: 2,
      maxPages: null,
      knownIds: h.ids(),
      usage: null,
      resultSessionId: parked.sessionId,
    });
    expect(server2.sent.map((s) => [s.body.startRow, s.body.resultSessionId])).toEqual([
      [50, 'S1'],
      [75, 'S1'],
    ]);
    expect(h2.ids()).toHaveLength(50);
    expect(h2.done()?.reason).toBe('complete');
  });

  it('falls back once to a null session from the saved row when the server rejects it', async () => {
    const server = fakeServer({ total: 100 }); // S1 is not live: the server forgot it
    const h = harness(server);
    const tpl = buildTemplate(captured(), 'cash-buyers', [])!;
    const overlap = [51, 52, 53]; // rows already held from before the park
    await h.collector.run(tpl, {
      runId: 'r',
      startRow: 50,
      page: 2,
      maxPages: null,
      knownIds: overlap,
      usage: null,
      resultSessionId: 'S1',
    });
    expect(server.sent.map((s) => [s.body.startRow, s.body.resultSessionId])).toEqual([
      [50, 'S1'], // rejected
      [50, null], // same row, new session
      [75, 'S1'], // and the new session is used from then on
    ]);
    expect(h.messages.filter((m) => m.type === 'notice')).toHaveLength(1);
    expect(h.ids().filter((i) => overlap.includes(i))).toEqual([]); // dedupe absorbed the overlap
    expect(h.done()?.reason).toBe('complete');
  });
});
