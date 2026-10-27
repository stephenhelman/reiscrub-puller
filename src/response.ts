import type { Usage } from './pacing';

export interface ParsedResponse {
  count: number;
  /** Raw row total (num_records) when present; count is distinct properties. */
  totalRows: number;
  pageSize: number | null;
  rows: unknown[];
  usage: Usage | null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseSearchResponse(json: unknown): ParsedResponse | null {
  if (!isObj(json)) return null;
  const count = numOrNull(json.count);
  if (count === null || !Array.isArray(json.rows)) return null;

  const counts = isObj(json.counts) ? json.counts : null;
  const totalRows = (counts && numOrNull(counts.num_records)) ?? count;

  let usage: Usage | null = null;
  const fu = isObj(json.freeUsage) ? json.freeUsage : null;
  const pg = fu && isObj(fu.pagination) ? fu.pagination : null;
  if (pg) {
    usage = {
      dailyRemaining: numOrNull(pg.dailyRemaining),
      userTokensRemaining: numOrNull(pg.userTokensRemaining),
      orgRemainingThisMinute: numOrNull(pg.organizationRemainingThisMinute),
      orgResetAt: typeof pg.organizationResetAt === 'string' ? pg.organizationResetAt : null,
    };
  }

  return { count, totalRows, pageSize: numOrNull(json.pageSize), rows: json.rows, usage };
}
