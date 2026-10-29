import { describe, expect, it } from 'vitest';
import { describeAuth } from './token-age';

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=/g, '')}.sig`;

describe('describeAuth', () => {
  it('reports expiry and age without echoing the token', () => {
    const now = 1_000_000_000_000;
    const token = jwt({ exp: now / 1000 + 120, iat: now / 1000 - 30 });
    const out = describeAuth({ Authorization: `Bearer ${token}` }, now - 5000, now);
    expect(out).toBe('auth: expires in 120s, issued 30s ago, last seen from page 5s ago');
    expect(out).not.toContain(token);
  });

  it('copes with a missing or unreadable token', () => {
    expect(describeAuth({}, null, 0)).toBe('auth: no readable JWT');
    expect(describeAuth({ authorization: 'Bearer nope' }, null, 0)).toBe('auth: no readable JWT');
  });
});
