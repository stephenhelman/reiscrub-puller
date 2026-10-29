import { describe, expect, it } from 'vitest';
import { isSessionTokenUrl, pickAuthorization, sessionJwt } from './clerk';

const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=/g, '')}.sig`;
const ISS = 'https://clerk.dealmachine.com';

describe('isSessionTokenUrl', () => {
  it('matches only the Clerk session token endpoint on the app domain', () => {
    const ok = (u: string) => isSessionTokenUrl(new URL(u), 'dealmachine.com');
    expect(ok('https://clerk.dealmachine.com/v1/client/sessions/sess_1/tokens?x=1')).toBe(true);
    expect(ok('https://clerk.dealmachine.com/v1/client/sessions/sess_1/touch')).toBe(false);
    expect(ok('https://clerk.dealmachine.com/v1/client/sessions/sess_1/tokens/template')).toBe(false);
    expect(ok('https://clerk.evil.com/v1/client/sessions/sess_1/tokens')).toBe(false);
    expect(ok('https://www.dealmachine.com/v1/client/sessions/sess_1/tokens')).toBe(false);
  });
});

describe('sessionJwt', () => {
  it('returns a JWT-shaped jwt field only', () => {
    const t = jwt({ iat: 1 });
    expect(sessionJwt({ jwt: t })).toBe(t);
    expect(sessionJwt({ jwt: 'nope' })).toBeNull();
    expect(sessionJwt({ response: { jwt: t } })).toBeNull();
    expect(sessionJwt(null)).toBeNull();
  });
});

describe('pickAuthorization', () => {
  const old = `Bearer ${jwt({ iat: 100, iss: ISS })}`;
  const newer = jwt({ iat: 150, iss: ISS });

  it('uses the page\'s newer token from the same issuer', () => {
    expect(pickAuthorization(old, newer)).toBe(`Bearer ${newer}`);
  });
  it('keeps the held token when it is as new or newer', () => {
    expect(pickAuthorization(`Bearer ${newer}`, jwt({ iat: 120, iss: ISS }))).toBe(`Bearer ${newer}`);
  });
  it('keeps the held token for a different issuer, or when nothing is held or minted', () => {
    expect(pickAuthorization(old, jwt({ iat: 150, iss: 'other' }))).toBe(old);
    expect(pickAuthorization(undefined, newer)).toBeUndefined();
    expect(pickAuthorization(old, null)).toBe(old);
    expect(pickAuthorization('Bearer opaque', newer)).toBe('Bearer opaque');
  });
});
