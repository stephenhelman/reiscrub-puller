function readFlag(): boolean {
  if (import.meta.env?.WXT_DEBUG === 'true') return true;
  try {
    return localStorage.getItem('reiscrub:debug') === '1';
  } catch {
    return false;
  }
}

/** Build with WXT_DEBUG=true, or run localStorage.setItem('reiscrub:debug','1') and reload. */
export const DEBUG = readFlag();

export function debug(...args: unknown[]): void {
  if (DEBUG) console.debug('[reiscrub]', ...args);
}
