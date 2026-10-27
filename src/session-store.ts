import { browser } from 'wxt/browser';
import { StoredRunSchema } from './schemas';
import type { StoredRun } from './types';

/** Runs are keyed by tab so two DealMachine tabs never collide. */
export interface RunStore {
  load(): Promise<StoredRun | null>;
  save(run: StoredRun): Promise<void>;
  clear(): Promise<void>;
}

async function resolveTabId(): Promise<string> {
  try {
    const reply: unknown = await browser.runtime.sendMessage({ type: 'reiscrub:tab-id' });
    const id = (reply as { tabId?: unknown } | undefined)?.tabId;
    if (typeof id === 'number' && Number.isInteger(id)) return String(id);
  } catch {
    /* fall through */
  }
  // Without a tab id, still isolate this page load from every other tab.
  return `anon-${crypto.randomUUID()}`;
}

export async function createRunStore(): Promise<RunStore> {
  const key = `run:${await resolveTabId()}`;
  return {
    async load() {
      try {
        const got = await browser.storage.session.get(key);
        const parsed = StoredRunSchema.safeParse(got[key]);
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async save(run) {
      try {
        await browser.storage.session.set({ [key]: run });
      } catch (e) {
        console.warn('[reiscrub] could not persist run', e instanceof Error ? e.message : e);
      }
    },
    async clear() {
      try {
        await browser.storage.session.remove(key);
      } catch {
        /* nothing to clear */
      }
    },
  };
}
