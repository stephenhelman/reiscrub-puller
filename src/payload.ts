import { CONFIG } from './config';
import type { PuRecord } from './types';

export function buildPayload(records: readonly PuRecord[]): string {
  const rows = records.map((r) => ({ id: r.id, line1: r.line1, line2: r.line2 }));
  return `${CONFIG.payloadHeader}\n${JSON.stringify(rows)}`;
}
