import { z } from 'zod';
import { CONFIG } from './config';

const num = z.number().finite().min(0).max(1e9);
const usageNum = num.nullable();

export const RecordSchema = z.object({
  id: z.number().int().safe(),
  line1: z.string().max(CONFIG.limits.maxLineLength),
  line2: z.string().max(CONFIG.limits.maxLineLength),
});

export const DoneReasonSchema = z.enum(['complete', 'stopped', 'daily-limit', 'max-pages', 'error']);

/** MAIN -> isolated. Everything here is untrusted until parsed. */
export const DataMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('captured'),
    count: num,
    pageSize: num,
    dailyRemaining: usageNum,
    searchKey: z.string().max(64),
  }),
  z.object({
    type: z.literal('records'),
    runId: z.string().max(64),
    // Records are validated one by one so a single bad row doesn't drop a page.
    records: z.array(z.unknown()).max(CONFIG.limits.maxRecordsPerMessage),
  }),
  z.object({
    type: z.literal('progress'),
    runId: z.string().max(64),
    state: z.enum(['fetching', 'waiting', 'retrying', 'paused']),
    page: num,
    collected: num,
    total: num,
    waitMs: num,
    tokens: usageNum,
    dailyRemaining: usageNum,
  }),
  z.object({
    type: z.literal('needs_reauth'),
    runId: z.string().max(64),
    page: num,
    collected: num,
    total: num,
    nextStartRow: num,
    searchKey: z.string().max(64),
    dailyRemaining: usageNum,
  }),
  z.object({
    type: z.literal('resume_refused'),
    runId: z.string().max(64),
  }),
  z.object({
    type: z.literal('done'),
    runId: z.string().max(64),
    reason: DoneReasonSchema,
    message: z.string().max(300).optional(),
    collected: num,
    dailyRemaining: usageNum,
  }),
]);

export const StoredRunSchema = z.object({
  runId: z.string(),
  records: z.array(RecordSchema),
  copied: z.boolean(),
  state: z.enum(['running', 'needs_reauth', 'finished']),
  reason: DoneReasonSchema.optional(),
  total: num,
  page: num,
  /** Page budget chosen at Collect time (null = unlimited). */
  maxPages: num.nullable(),
  /** Where a Resume continues from. */
  nextStartRow: num,
  searchKey: z.string().max(64).optional(),
});
