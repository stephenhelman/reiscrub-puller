import type { PacingConfig } from './config';

export interface Usage {
  dailyRemaining: number | null;
  userTokensRemaining: number | null;
  orgRemainingThisMinute: number | null;
  orgResetAt: string | null;
}

export function jitter(ms: number, ratio: number): number {
  return Math.max(0, Math.round(ms * (1 + (Math.random() * 2 - 1) * ratio)));
}

/** Exponential backoff for attempt n (0-based), with jitter, capped. */
export function backoffMs(n: number, cfg: PacingConfig): number {
  const raw = Math.min(cfg.backoffCapMs, cfg.backoffBaseMs * 2 ** n);
  return Math.min(cfg.backoffCapMs, jitter(raw, cfg.jitterRatio));
}

export function shortDelayMs(cfg: PacingConfig): number {
  return Math.round(cfg.minDelayMs + Math.random() * (cfg.maxDelayMs - cfg.minDelayMs));
}

export function isThrottled(u: Usage | null, cfg: PacingConfig): boolean {
  if (!u) return false;
  if (u.userTokensRemaining !== null && u.userTokensRemaining <= cfg.lowUserTokens) return true;
  if (u.orgRemainingThisMinute !== null && u.orgRemainingThisMinute <= cfg.lowOrgRemaining) return true;
  return false;
}

/** If the org per-minute budget is nearly out, wait for its reset when that is sooner than the cap. */
export function orgResetWaitMs(u: Usage | null, cfg: PacingConfig, now: number): number {
  if (!u || u.orgRemainingThisMinute === null || u.orgRemainingThisMinute > cfg.lowOrgRemaining) return 0;
  if (!u.orgResetAt) return 0;
  const t = Date.parse(u.orgResetAt);
  if (Number.isNaN(t)) return 0;
  const until = t - now;
  if (until <= 0) return 0;
  return Math.min(cfg.backoffCapMs, until + 500 + Math.round(Math.random() * 1000));
}
