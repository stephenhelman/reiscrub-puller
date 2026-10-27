# REIscrub Puller (phase 1)

Chrome MV3 extension (WXT + TypeScript). On a DealMachine property search it pages through the
full result set using your own session and copies a deduped address list for REIscrub.

## Install (load unpacked)

```sh
corepack enable
pnpm install
pnpm wxt build          # outputs .output/chrome-mv3
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** and pick `.output/chrome-mv3`.
3. Open DealMachine's property search, filter it in their UI, then use the **REIscrub Puller**
   panel (bottom-right, draggable, collapsible): **Collect** -> **Copy**.

After rebuilding or reloading the extension, refresh the DealMachine tab so the page-side script
and the panel reconnect.

## Use

- The panel says "Search captured: Yes" once DealMachine's own `map-properties` request has been seen.
  If not, run or refresh the search.
- **Collect** always starts a fresh run. Uncopied records from a previous run require confirmation
  before they are discarded. If the free daily page budget is smaller than the pages needed you
  choose **Collect what I can** or cancel.
- **Keep the tab open and visible** while collecting. If it is hidden, the run finishes the in-flight
  page, pauses (no requests are sent), and continues by itself when you return.
- If DealMachine answers 401/403 the run is parked as "Session expired" (never retried) and keeps its
  records and next row. Refresh your search, then click **Resume**; it becomes enabled after a new
  search is captured. Resume is refused if the new search's filters/locations differ from the run's.
- **Copy** writes `REISCRUB:v1:dealmachine` on line 1 and a JSON array of `{id, line1, line2}` on
  line 2. If the clipboard write fails you can download the same payload as a `.txt` file.
- Records live in `chrome.storage.session`, keyed per tab (cleared when the browser session ends or the tab closes). Nothing else
  is persisted. Auth headers stay in page memory and are never stored, logged, or copied.

## DEBUG flag

Logs page number, rows received, `userTokensRemaining` before -> after, and wait time per page
(use it to read the token refill rate). Two ways to turn it on:

- Build-time: `WXT_DEBUG=true pnpm wxt build`
- Runtime, in the DealMachine tab's console: `localStorage.setItem('reiscrub:debug','1')`, then reload.

Messages appear in the page console with the prefix `[reiscrub]`. Headers and cookies are never logged.

## Scripts

`pnpm wxt build` · `pnpm typecheck` (`tsc --noEmit`) · `pnpm dev`

## Layout

- `entrypoints/capture.content.ts` - MAIN world: passive fetch/XHR capture, runs the replay
- `entrypoints/panel.content.ts` - isolated world: panel, Zod validation of MAIN messages, clipboard, storage
- `entrypoints/background.ts` - opens `storage.session` to content scripts
- `src/config.ts` - bundled defaults and the (unimplemented) remote-config hook
- `src/collector.ts`, `src/pacing.ts` - paging loop, adaptive pacing, retries
