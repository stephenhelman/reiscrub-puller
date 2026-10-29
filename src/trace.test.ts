import { describe, expect, it } from 'vitest';
import { authState, safeTarget, tokenKeys } from './trace';

describe('trace helpers', () => {
  it('lists token-like key names, never values', () => {
    const keys = tokenKeys({ ok: 1, data: { accessToken: 'secret', name: 'x' }, refresh_token: 'secret2' });
    expect(keys).toEqual(['data.accessToken', 'refresh_token']);
    expect(JSON.stringify(keys)).not.toContain('secret');
  });

  it('ignores non-objects', () => {
    expect(tokenKeys(null)).toEqual([]);
    expect(tokenKeys([{ token: 1 }])).toEqual([]);
  });

  it('classifies the Authorization header against the held one', () => {
    expect(authState('a', undefined)).toBe('none');
    expect(authState(undefined, 'a')).toBe('first');
    expect(authState('a', 'a')).toBe('same');
    expect(authState('a', 'b')).toBe('new');
  });

  it('drops the query string', () => {
    expect(safeTarget(new URL('https://www.dealmachine.com/api/x?id=7#f'))).toBe('www.dealmachine.com/api/x');
  });
});
