// Debug-only helpers for working out how DealMachine's page refreshes its login token.
// They report names and yes/no facts only; token values are never returned.

const TOKENISH = /token|jwt|access|refresh|session|auth/i;

/** Names of keys (two levels deep) that look token-related in a JSON response. */
export function tokenKeys(json: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= 8 || typeof v !== 'object' || v === null || Array.isArray(v)) return;
    for (const [k, child] of Object.entries(v)) {
      if (TOKENISH.test(k)) out.push(path + k);
      if (depth < 1) walk(child, `${path}${k}.`, depth + 1);
    }
  };
  walk(json, '', 0);
  return out.slice(0, 8);
}

/** none = no Authorization header; first = nothing held yet; same / new relative to what we hold. */
export function authState(held: string | undefined, sent: string | undefined): 'none' | 'first' | 'same' | 'new' {
  if (!sent) return 'none';
  if (!held) return 'first';
  return held === sent ? 'same' : 'new';
}

/** host/path only: query strings and fragments can carry identifiers. */
export function safeTarget(url: URL): string {
  return `${url.host}${url.pathname}`;
}
