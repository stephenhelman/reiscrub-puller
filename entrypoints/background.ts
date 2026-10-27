import { browser } from 'wxt/browser';

// Content scripts can't read chrome.storage.session unless access is widened.
export default defineBackground(() => {
  const open = () =>
    browser.storage.session
      .setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
      .catch((e: unknown) => console.warn('[reiscrub] setAccessLevel failed', e));

  void open();
  browser.runtime.onInstalled.addListener(() => void open());
  browser.runtime.onStartup.addListener(() => void open());

  // Content scripts can't learn their own tab id; runs are stored per tab.
  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const isAsk = typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'reiscrub:tab-id';
    if (!isAsk || sender.id !== browser.runtime.id || typeof sender.tab?.id !== 'number') return false;
    sendResponse({ tabId: sender.tab.id });
    return false;
  });

  // Don't leave a closed tab's run in session storage.
  browser.tabs.onRemoved.addListener((tabId) => {
    void browser.storage.session.remove(`run:${tabId}`).catch(() => {});
  });
});
