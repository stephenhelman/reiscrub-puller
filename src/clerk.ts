// DealMachine signs in through Clerk. The page mints a ~60s session JWT with
// POST clerk.<host>/v1/client/sessions/<id>/tokens and attaches it to its search calls. During a
// run the page's search calls stop, so the JWT we hold goes stale while a newer one has already
// been minted. These helpers let us notice that and use the page's own newer token.
import { jwtClaims } from './token-age';

const TOKENS_PATH = /^\/v1\/client\/sessions\/[^/]+\/tokens$/;

export function isSessionTokenUrl(url: URL, apiHostSuffix: string): boolean {
  return url.hostname === `clerk.${apiHostSuffix}` && TOKENS_PATH.test(url.pathname);
}

/** The `jwt` field of a token response, if it looks like a JWT. */
export function sessionJwt(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const jwt = (json as Record<string, unknown>).jwt;
  return typeof jwt === 'string' && jwtClaims(jwt) ? jwt : null;
}

/**
 * The Authorization value to send: the page's newer Clerk JWT when it is from the same issuer as
 * the one we hold and was issued later; otherwise what we hold. Never invents auth we don't have.
 */
export function pickAuthorization(held: string | undefined, clerkJwt: string | null): string | undefined {
  if (!held || !clerkJwt) return held;
  const h = jwtClaims(held);
  const c = jwtClaims(clerkJwt);
  if (!h?.iat || !c?.iat || h.iss !== c.iss) return held;
  return c.iat > h.iat ? `Bearer ${clerkJwt}` : held;
}
