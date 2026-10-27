// Isolated world. Owns the panel, the per-run record store and the clipboard.
// Everything arriving from the MAIN world is untrusted and validated with Zod.
import { openIsolatedChannel } from '@/src/bridge';
import { debug } from '@/src/debug';
import { buildPayload } from '@/src/payload';
import { DataMessageSchema, RecordSchema } from '@/src/schemas';
import { getPreset } from '@/src/presets';
import { createRunStore } from '@/src/session-store';
import type { Command, DoneReason, PuRecord, StoredRun } from '@/src/types';
import { mountPanel, type Confirm } from '@/src/panel/view';

const WATCHDOG_MS = 10_000;
const REAUTH_STATUS = 'Session expired — refresh your search, then click Resume.';

interface Captured {
  count: number;
  pageSize: number;
  dailyRemaining: number | null;
}

export default defineContentScript({
  matches: ['*://*.dealmachine.com/*'],
  runAt: 'document_end',
  async main() {
    let captured: Captured | null = null;
    let run: StoredRun | null = null;
    let ids = new Set<number>();
    let apnOnly = 0;
    let status = 'Filter your search in DealMachine, then click Collect.';
    let confirm: Confirm | null = null;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    // Set once a new search is captured after the run parked in needs_reauth.
    let freshCapture: { searchKey: string } | null = null;
    // List type chosen in the panel (null preset = the user's own DealMachine filters).
    let selection: { presetId: string | null; excluded: Set<number> } = { presetId: null, excluded: new Set() };
    // Appended to progress statuses once something worth telling the user happened mid-run.
    let notice = '';

    const store = await createRunStore();
    const isRunning = () => run?.state === 'running';
    const persist = () => {
      if (run) void store.save(run);
    };
    const searchMatches = () =>
      !run?.searchKey || !freshCapture || freshCapture.searchKey === run.searchKey;
    const selectLocked = () => run?.state === 'running' || run?.state === 'needs_reauth';
    const canResume = () =>
      run?.state === 'needs_reauth' && freshCapture !== null && searchMatches() && run.nextStartRow >= 0;

    function adopt(r: StoredRun | null): void {
      run = r;
      ids = new Set(r?.records.map((x) => x.id));
      apnOnly = r ? r.records.filter((x) => x.line1.startsWith('APN:')).length : 0;
    }

    function render(): void {
      const preset = getPreset(selection.presetId);
      // A preset's count is unknown until its first page is fetched; the user's own search is known.
      const count = preset
        ? run && run.presetId === preset.id && run.total > 0
          ? run.total
          : null
        : (captured?.count ?? null);
      const pagesNeeded = captured && count !== null ? Math.ceil(count / captured.pageSize) : null;
      panel.update({
        captured: captured !== null,
        count,
        pagesNeeded,
        dailyRemaining: captured ? captured.dailyRemaining : null,
        running: isRunning(),
        collected: run?.records.length ?? 0,
        page: run?.page ?? 0,
        apnOnly,
        status,
        canCopy: (run?.records.length ?? 0) > 0,
        canResume: canResume(),
        canClear: run !== null,
        confirm,
        listType: preset?.id ?? null,
        listTypeLocked: selectLocked(),
        presetDescription: preset?.description ?? null,
        presetFilters: (preset?.filters ?? []).map((f) => ({
          id: f.filterId,
          label: f.label,
          checked: !selection.excluded.has(f.filterId),
        })),
        countPending: preset !== null && count === null,
      });
    }

    const syncSelection = () => send({ type: 'select', presetId: selection.presetId, excluded: [...selection.excluded] });

    function ask(c: Omit<Confirm, 'onCancel'> & { onCancel?: () => void }): void {
      confirm = {
        ...c,
        onConfirm: () => {
          confirm = null;
          c.onConfirm();
          render();
        },
        onCancel: () => {
          confirm = null;
          c.onCancel?.();
          render();
        },
      };
      render();
    }

    const clearWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
    };

    function finish(reason: DoneReason, message?: string): void {
      if (!run) return;
      clearWatchdog();
      run.state = 'finished';
      run.reason = reason;
      const n = run.records.length.toLocaleString();
      const total = run.total.toLocaleString();
      switch (reason) {
        case 'complete':
          status = `Done: collected ${n} of ${total}.`;
          break;
        case 'stopped':
          status = `Stopped. Kept ${n} records.`;
          break;
        case 'daily-limit':
          status = `Daily page limit reached. Kept ${n} records.`;
          break;
        case 'max-pages':
          status = `Collected what today's budget allows: ${n} records.`;
          break;
        case 'error':
          status = `Stopped on error${message ? `: ${message}` : ''}. Kept ${n} records.`;
          break;
      }
      persist();
    }

    function onData(raw: unknown): void {
      const parsed = DataMessageSchema.safeParse(raw);
      if (!parsed.success) {
        debug('dropped malformed MAIN message');
        return;
      }
      const m = parsed.data;

      if (m.type === 'captured') {
        if (isRunning()) return;
        if (m.pageSize < 1) return;
        // The search key is for the page script's selection; make it match ours before using it.
        const same =
          m.presetId === selection.presetId &&
          m.excluded.length === selection.excluded.size &&
          m.excluded.every((id) => selection.excluded.has(id));
        if (!same) {
          syncSelection();
          return;
        }
        captured = { count: m.count, pageSize: m.pageSize, dailyRemaining: m.dailyRemaining };
        if (run?.state === 'needs_reauth') {
          freshCapture = { searchKey: m.searchKey };
          status = searchMatches()
            ? 'Search captured. Click Resume to continue.'
            : 'The search changed. Restore the original search, or Clear to start over.';
        } else if (!run) {
          status = 'Search captured. Click Collect.';
        }
        render();
        return;
      }

      // Everything else belongs to a specific run.
      if (!run || run.runId !== m.runId) return;
      if (run.state !== 'running') return;
      clearWatchdog();

      if (m.type === 'records') {
        for (const candidate of m.records) {
          const rec = RecordSchema.safeParse(candidate);
          if (!rec.success || ids.has(rec.data.id)) continue;
          ids.add(rec.data.id);
          run.records.push(rec.data);
          if (rec.data.line1.startsWith('APN:')) apnOnly += 1;
        }
        persist();
      } else if (m.type === 'gate') {
        run.total = m.count;
        const runId = run.runId;
        const pages = m.page + m.pagesLeft;
        status = 'Waiting for your choice…';
        ask({
          message: `This list has ${m.count.toLocaleString()} results (${pages.toLocaleString()} pages) but only ${m.dailyRemaining.toLocaleString()} remain today.`,
          confirmLabel: 'Collect what I can',
          cancelLabel: 'Cancel',
          onConfirm: () => {
            const cap = m.page + m.dailyRemaining;
            if (run && run.runId === runId) {
              run.maxPages = cap;
              persist();
            }
            status = 'Collecting…';
            send({ type: 'proceed', runId, maxPages: cap });
          },
          onCancel: () => {
            status = 'Stopping…';
            send({ type: 'stop', runId });
          },
        });
        persist();
        return;
      } else if (m.type === 'notice') {
        notice = ' Search session expired; restarted from the saved row.';
        status = notice.trim();
      } else if (m.type === 'progress') {
        run.page = m.page;
        run.total = m.total;
        run.resultSessionId = m.sessionId;
        if (captured) captured.dailyRemaining = m.dailyRemaining;
        const secs = (m.waitMs / 1000).toFixed(1);
        if (m.state === 'fetching') status = `Fetching page ${m.page + 1}…`;
        else if (m.state === 'waiting') status = `Waiting ${secs}s before next page…`;
        else if (m.state === 'paused') status = 'Paused — return to this tab to continue';
        else status = `Server pushed back. Retrying in ${secs}s…`;
        status += notice;
      } else if (m.type === 'needs_reauth') {
        run.state = 'needs_reauth';
        run.page = m.page;
        run.total = m.total;
        run.nextStartRow = m.nextStartRow;
        run.searchKey = m.searchKey;
        run.resultSessionId = m.sessionId;
        freshCapture = null;
        if (captured) captured.dailyRemaining = m.dailyRemaining;
        status = REAUTH_STATUS;
        persist();
      } else if (m.type === 'resume_refused') {
        run.state = 'needs_reauth';
        status = 'The search changed. Restore the original search, or Clear to start over.';
        persist();
      } else {
        if (captured) captured.dailyRemaining = m.dailyRemaining;
        finish(m.reason, m.message);
      }
      render();
    }

    const channel = openIsolatedChannel(onData);
    const send = (c: Command) => channel.sendCommand(c);

    function startRun(maxPages: number | null): void {
      const runId = crypto.randomUUID();
      adopt({
        runId,
        records: [],
        copied: false,
        state: 'running',
        // A preset's count arrives with its first page.
        total: selection.presetId === null ? (captured?.count ?? 0) : 0,
        page: 0,
        maxPages,
        nextStartRow: 0,
        presetId: selection.presetId,
        excluded: [...selection.excluded],
        resultSessionId: null,
      });
      freshCapture = null;
      notice = '';
      persist();
      status = 'Starting…';
      watchdog = setTimeout(() => {
        finish('error', 'page script did not respond; reload the DealMachine tab');
        render();
      }, WATCHDOG_MS);
      send({ type: 'start', runId, maxPages, presetId: selection.presetId, excluded: [...selection.excluded] });
      render();
    }

    function checkBudget(): void {
      if (!captured) return;
      const pages = Math.ceil(captured.count / captured.pageSize);
      const daily = captured.dailyRemaining;
      if (daily !== null && daily <= 0) {
        status = 'No daily pages remaining. Try again after the limit resets.';
        render();
        return;
      }
      // Preset runs check the budget themselves once their first page has revealed the count.
      if (selection.presetId === null && daily !== null && pages > daily) {
        ask({
          message: `This search needs ${pages.toLocaleString()} pages but only ${daily.toLocaleString()} remain today.`,
          confirmLabel: 'Collect what I can',
          cancelLabel: 'Cancel',
          onConfirm: () => startRun(daily),
        });
        return;
      }
      startRun(null);
    }

    function onCollect(): void {
      if (isRunning()) return;
      if (!captured) {
        status = 'No search captured yet. Run or refresh your search in DealMachine first.';
        render();
        return;
      }
      const uncopied = run && !run.copied ? run.records.length : 0;
      if (uncopied > 0) {
        ask({
          message: `You have ${uncopied.toLocaleString()} uncopied records from a previous search. Discard and start?`,
          confirmLabel: 'Discard and start',
          cancelLabel: 'Cancel',
          onConfirm: checkBudget,
        });
        return;
      }
      checkBudget();
    }

    function onResume(): void {
      if (!run || !canResume()) return;
      if (captured && captured.dailyRemaining !== null && captured.dailyRemaining <= 0) {
        status = 'No daily pages remaining. Try again after the limit resets.';
        render();
        return;
      }
      run.state = 'running';
      status = 'Resuming…';
      watchdog = setTimeout(() => {
        finish('error', 'page script did not respond; reload the DealMachine tab');
        render();
      }, WATCHDOG_MS);
      send({
        type: 'resume',
        runId: run.runId,
        startRow: run.nextStartRow,
        page: run.page,
        maxPages: run.maxPages,
        searchKey: run.searchKey ?? null,
        ids: [...ids],
        presetId: run.presetId,
        excluded: run.excluded,
        resultSessionId: run.resultSessionId,
      });
      persist();
      render();
    }

    function download(text: string): void {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `reiscrub-dealmachine-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }

    function markCopied(): void {
      if (run) run.copied = true;
      persist();
    }

    async function onCopy(): Promise<void> {
      if (!run || run.records.length === 0) return;
      const records: PuRecord[] = run.records;
      const text = buildPayload(records);
      const n = records.length.toLocaleString();
      try {
        await navigator.clipboard.writeText(text);
        markCopied();
        status = `Copied ${n} records to clipboard.`;
        render();
      } catch {
        ask({
          message: 'Clipboard write failed. Download the same payload as a .txt file instead?',
          confirmLabel: 'Download',
          cancelLabel: 'Dismiss',
          onConfirm: () => {
            download(text);
            markCopied();
            status = `Downloaded ${n} records.`;
          },
        });
      }
    }

    const panel = mountPanel({
      onCollect,
      onResume,
      onStop() {
        if (!run || !isRunning()) return;
        status = 'Stopping…';
        send({ type: 'stop', runId: run.runId });
        render();
      },
      onSelectPreset(id) {
        if (selectLocked()) return;
        selection = { presetId: id, excluded: new Set() };
        syncSelection();
        render();
      },
      onToggleFilter(filterId, checked) {
        if (selectLocked()) return;
        if (checked) selection.excluded.delete(filterId);
        else selection.excluded.add(filterId);
        syncSelection();
        render();
      },
      onCopy: () => void onCopy(),
      onClear() {
        if (isRunning()) return;
        adopt(null);
        void store.clear();
        freshCapture = null;
        notice = '';
        status = 'Cleared.';
        render();
      },
    });

    // Restore a run that survived a panel re-render / page navigation.
    const saved = await store.load();
    if (saved) {
      adopt(saved);
      if (saved.state === 'running') {
        // The MAIN-world loop died with the page; keep what we have.
        finish('error', 'the page was reloaded mid-run');
      } else if (saved.state === 'needs_reauth') {
        // A parked run resumes with the list type it started with.
        selection = { presetId: saved.presetId, excluded: new Set(saved.excluded) };
        status = REAUTH_STATUS;
      } else {
        status = `Restored ${saved.records.length.toLocaleString()} records from this session.`;
      }
    }
    render();
  },
});
