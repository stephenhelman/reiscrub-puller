import type { z } from 'zod';
import type { DataMessageSchema, DoneReasonSchema, RecordSchema, StoredRunSchema } from './schemas';

export type DataMessage = z.infer<typeof DataMessageSchema>;
export type DoneReason = z.infer<typeof DoneReasonSchema>;
export type PuRecord = z.infer<typeof RecordSchema>;
export type StoredRun = z.infer<typeof StoredRunSchema>;

/** isolated -> MAIN only. */
export type Command =
  | { type: 'select'; presetId: string | null; excluded: number[] }
  | { type: 'start'; runId: string; maxPages: number | null; presetId: string | null; excluded: number[] }
  | { type: 'proceed'; runId: string; maxPages: number | null }
  | {
      type: 'resume';
      runId: string;
      startRow: number;
      page: number;
      maxPages: number | null;
      searchKey: string | null;
      ids: number[];
      presetId: string | null;
      excluded: number[];
      resultSessionId: string | null;
    }
  | { type: 'stop'; runId: string };

const nat = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const presetIdOk = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length <= 64);
const excludedOk = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length <= 100 && v.every((i) => typeof i === 'number' && Number.isSafeInteger(i));

export function parseCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.type === 'select') {
    if (!presetIdOk(o.presetId) || !excludedOk(o.excluded)) return null;
    return { type: 'select', presetId: o.presetId, excluded: o.excluded };
  }
  if (typeof o.runId !== 'string' || o.runId.length > 64) return null;
  if (o.type === 'stop') return { type: 'stop', runId: o.runId };
  if (o.type === 'start') {
    const mp = o.maxPages;
    if (mp !== null && !(typeof mp === 'number' && Number.isInteger(mp) && mp > 0)) return null;
    if (!presetIdOk(o.presetId) || !excludedOk(o.excluded)) return null;
    return { type: 'start', runId: o.runId, maxPages: mp, presetId: o.presetId, excluded: o.excluded };
  }
  if (o.type === 'proceed') {
    if (o.maxPages !== null && !(nat(o.maxPages) && o.maxPages > 0)) return null;
    return { type: 'proceed', runId: o.runId, maxPages: o.maxPages };
  }
  if (o.type === 'resume') {
    const { startRow, page, maxPages, searchKey, ids } = o;
    const { presetId, excluded, resultSessionId } = o;
    if (!presetIdOk(presetId) || !excludedOk(excluded)) return null;
    if (resultSessionId !== null && (typeof resultSessionId !== 'string' || resultSessionId.length > 200)) return null;
    if (!nat(startRow) || !nat(page)) return null;
    if (maxPages !== null && !(nat(maxPages) && maxPages > 0)) return null;
    if (searchKey !== null && (typeof searchKey !== 'string' || searchKey.length > 64)) return null;
    if (!Array.isArray(ids) || ids.length > 200_000 || !ids.every((i) => Number.isSafeInteger(i))) return null;
    return {
      type: 'resume',
      runId: o.runId,
      startRow,
      page,
      maxPages,
      searchKey,
      ids: ids as number[],
      presetId,
      excluded,
      resultSessionId,
    };
  }
  return null;
}
