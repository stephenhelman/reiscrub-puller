// Debug-only: how close the replay credentials are to expiring. Reads the `exp`/`iat` claims
// of a Bearer JWT and returns plain seconds; the token itself is never returned or logged.

export interface JwtClaims {
  exp?: number;
  iat?: number;
  iss?: string;
}

/** Claims of a JWT, or of an `Authorization` value such as `Bearer <jwt>`. Null if unreadable. */
export function jwtClaims(raw: string | undefined): JwtClaims | null {
  const jwt = raw?.replace(/^Bearer\s+/i, '').split('.');
  if (!jwt || jwt.length !== 3 || !jwt[1]) return null;
  try {
    const b64 = jwt[1].replace(/-/g, '+').replace(/_/g, '/');
    const o: unknown = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')));
    if (typeof o !== 'object' || o === null) return null;
    const { exp, iat, iss } = o as Record<string, unknown>;
    return {
      ...(typeof exp === 'number' ? { exp } : {}),
      ...(typeof iat === 'number' ? { iat } : {}),
      ...(typeof iss === 'string' ? { iss } : {}),
    };
  } catch {
    return null;
  }
}

export function authorizationOf(headers: Record<string, string>): string | undefined {
  return Object.entries(headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1];
}

function claims(headers: Record<string, string>): JwtClaims | null {
  return jwtClaims(authorizationOf(headers));
}

/** e.g. "auth: expires in 212s, issued 88s ago, last seen from page 41s ago". */
export function describeAuth(headers: Record<string, string>, seenAt: number | null, nowMs: number): string {
  const parts: string[] = [];
  const c = claims(headers);
  if (!c) parts.push('no readable JWT');
  else {
    const now = nowMs / 1000;
    parts.push(c.exp === undefined ? 'no exp claim' : `expires in ${Math.round(c.exp - now)}s`);
    if (c.iat !== undefined) parts.push(`issued ${Math.round(now - c.iat)}s ago`);
  }
  if (seenAt !== null) parts.push(`last seen from page ${Math.round((nowMs - seenAt) / 1000)}s ago`);
  return `auth: ${parts.join(', ')}`;
}
