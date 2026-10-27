import type { z } from 'zod';
import type { DataMessageSchema, DoneReasonSchema, RecordSchema, StoredRunSchema } from './schemas';

export type DataMessage = z.infer<typeof DataMessageSchema>;
export type DoneReason = z.infer<typeof DoneReasonSchema>;
export type PuRecord = z.infer<typeof RecordSchema>;
export type StoredRun = z.infer<typeof StoredRunSchema>;

/** isolated -> MAIN only. */
export type Command =
  | { type: 'start'; runId: string; maxPages: number | null }
  | {
      type: 'resume';
      runId: string;
      startRow: number;
      page: number;
      maxPages: number | null;
      searchKey: string | null;
      ids: number[];
    }
  | { type: 'stop'; runId: string };

export function parseCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.runId !== 'string' || o.runId.length > 64) return null;
  if (o.type === 'stop') return { type: 'stop', runId: o.runId };
  if (o.type === 'start') {
    const mp = o.maxPages;
    if (mp !== null && !(typeof mp === 'number' && Number.isInteger(mp) && mp > 0)) return null;
    return { type: 'start', runId: o.runId, maxPages: mp };
  }
  if (o.type === 'resume') {
    const { startRow, page, maxPages, searchKey, ids } = o;
    const nat = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    if (!nat(startRow) || !nat(page)) return null;
    if (maxPages !== null && !(nat(maxPages) && maxPages > 0)) return null;
    if (searchKey !== null && (typeof searchKey !== 'string' || searchKey.length > 64)) return null;
    if (!Array.isArray(ids) || ids.length > 200_000 || !ids.every((i) => Number.isSafeInteger(i))) return null;
    return { type: 'resume', runId: o.runId, startRow, page, maxPages, searchKey, ids: ids as number[] };
  }
  return null;
}
