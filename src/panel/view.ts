// Shadow DOM panel. All dynamic text goes through textContent; no innerHTML.
import { PRESETS } from '../presets';
import { PANEL_CSS } from './styles';

export interface Confirm {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface ViewState {
  captured: boolean;
  count: number | null;
  pagesNeeded: number | null;
  dailyRemaining: number | null;
  running: boolean;
  collected: number;
  page: number;
  apnOnly: number;
  status: string;
  canCopy: boolean;
  canResume: boolean;
  canClear: boolean;
  confirm: Confirm | null;
  /** Selected preset id; null = the user's own DealMachine filters. */
  listType: string | null;
  listTypeLocked: boolean;
  presetDescription: string | null;
  presetFilters: { id: number; label: string; checked: boolean }[];
  /** Preset mode, before the first page has revealed the true count. */
  countPending: boolean;
}

export interface Handlers {
  onCollect(): void;
  onStop(): void;
  onResume(): void;
  onCopy(): void;
  onClear(): void;
  onSelectPreset(id: string | null): void;
  onToggleFilter(filterId: number, checked: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString());

export function mountPanel(handlers: Handlers): { update(s: ViewState): void } {
  const host = el('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = el('style');
  style.textContent = PANEL_CSS;

  const root = el('div', 'root');
  const head = el('div', 'head');
  head.append(el('span', 'title', 'REIscrub Puller'));
  const toggle = el('button', 'toggle', '▾');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Collapse panel');
  head.append(toggle);

  const body = el('div', 'body');

  // List type: the user's own filters, or a built-in preset that they refine in DealMachine.
  const listBox = el('div', 'list');
  const selectId = 'reiscrub-list-type';
  const selectLabel = el('label', 'lbl', 'List type');
  selectLabel.htmlFor = selectId;
  const select = el('select', 'sel');
  select.id = selectId;
  const addOption = (value: string, label: string) => {
    const o = el('option', undefined, label);
    o.value = value;
    select.append(o);
  };
  addOption('', 'My DealMachine filters');
  for (const p of PRESETS) addOption(p.id, p.name);
  select.addEventListener('change', () => handlers.onSelectPreset(select.value === '' ? null : select.value));
  const desc = el('div', 'desc');
  const presetNote = el('div', 'hint', 'Starts from this preset. Filters you set in DealMachine override or add to it.');
  const filterBox = el('div', 'filters');
  listBox.append(selectLabel, select, desc, presetNote, filterBox);
  const countHint = el('div', 'hint', 'Count shown after Collect starts');

  const rows = el('dl', 'rows');
  const values: Record<string, HTMLElement> = {};
  for (const [key, label] of [
    ['captured', 'Search captured'],
    ['total', 'Total results'],
    ['pages', 'Pages needed'],
    ['daily', 'Daily pages left'],
    ['progress', 'Collected'],
    ['page', 'Current page'],
    ['apn', 'APN-only'],
  ] as const) {
    const dd = el('dd', undefined, '—');
    values[key] = dd;
    rows.append(el('dt', undefined, label), dd);
  }
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  bar.append(fill);
  const note = el('div', 'note', 'Keep this tab open and visible while collecting.');
  const status = el('div', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const confirmBox = el('div', 'confirm');
  const confirmMsg = el('div');
  const confirmBtns = el('div', 'btns');
  const confirmYes = el('button', 'b primary');
  const confirmNo = el('button', 'b');
  confirmYes.type = confirmNo.type = 'button';
  confirmBtns.append(confirmYes, confirmNo);
  confirmBox.append(confirmMsg, confirmBtns);

  const btns = el('div', 'btns');
  const mk = (label: string, cls: string, fn: () => void) => {
    const b = el('button', `b ${cls}`.trim(), label);
    b.type = 'button';
    b.addEventListener('click', fn);
    btns.append(b);
    return b;
  };
  const bCollect = mk('Collect', 'primary', handlers.onCollect);
  const bStop = mk('Stop', '', handlers.onStop);
  const bResume = mk('Resume', 'primary', handlers.onResume);
  const bCopy = mk('Copy', '', handlers.onCopy);
  const bClear = mk('Clear', '', handlers.onClear);

  body.append(listBox, rows, countHint, bar, note, status, confirmBox, btns);
  root.append(head, body);
  shadow.append(style, root);
  document.documentElement.append(host);

  // Collapse
  toggle.addEventListener('click', () => {
    const collapsed = root.classList.toggle('collapsed');
    toggle.textContent = collapsed ? '▴' : '▾';
    toggle.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
  });

  // Drag by header
  let drag: { dx: number; dy: number } | null = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target === toggle) return;
    const r = root.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = root.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - drag.dx), window.innerWidth - r.width);
    const y = Math.min(Math.max(0, e.clientY - drag.dy), window.innerHeight - 30);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  });
  const endDrag = () => {
    drag = null;
  };
  head.addEventListener('pointerup', endDrag);
  head.addEventListener('pointercancel', endDrag);

  let confirmHandlers: Confirm | null = null;
  confirmYes.addEventListener('click', () => confirmHandlers?.onConfirm());
  confirmNo.addEventListener('click', () => confirmHandlers?.onCancel());

  let filterSig = '';
  const checks = new Map<number, HTMLInputElement>();
  function renderFilters(list: ViewState['presetFilters']): void {
    const sig = list.map((f) => `${f.id}:${f.label}`).join('|');
    if (sig !== filterSig) {
      filterSig = sig;
      checks.clear();
      filterBox.replaceChildren();
      for (const f of list) {
        const row = el('label', 'chk');
        const box = el('input');
        box.type = 'checkbox';
        box.addEventListener('change', () => handlers.onToggleFilter(f.id, box.checked));
        row.append(box, el('span', undefined, f.label)); // label text via textContent
        filterBox.append(row);
        checks.set(f.id, box);
      }
    }
    for (const f of list) {
      const box = checks.get(f.id);
      if (box) box.checked = f.checked;
    }
  }

  return {
    update(s) {
      select.value = s.listType ?? '';
      select.disabled = s.listTypeLocked;
      desc.textContent = s.presetDescription ?? '';
      desc.style.display = s.presetDescription ? 'block' : 'none';
      presetNote.style.display = s.listType ? 'block' : 'none';
      filterBox.style.display = s.listType ? 'grid' : 'none';
      renderFilters(s.presetFilters);
      for (const box of checks.values()) box.disabled = s.listTypeLocked;
      countHint.style.display = s.countPending ? 'block' : 'none';
      values.captured!.textContent = s.captured ? 'Yes' : 'No';
      values.total!.textContent = fmt(s.count);
      values.pages!.textContent = fmt(s.pagesNeeded);
      values.daily!.textContent = fmt(s.dailyRemaining);
      values.progress!.textContent = s.count === null ? fmt(s.collected) : `${fmt(s.collected)} / ${fmt(s.count)}`;
      values.page!.textContent = s.page > 0 ? String(s.page) : '—';
      values.apn!.textContent = fmt(s.apnOnly);
      const pct = s.count ? Math.min(100, (s.collected / s.count) * 100) : 0;
      fill.style.width = `${pct}%`;
      status.textContent = s.status;
      note.style.display = s.running ? 'block' : 'none';

      confirmHandlers = s.confirm;
      confirmBox.classList.toggle('show', s.confirm !== null);
      if (s.confirm) {
        confirmMsg.textContent = s.confirm.message;
        confirmYes.textContent = s.confirm.confirmLabel;
        confirmNo.textContent = s.confirm.cancelLabel;
      }

      const locked = s.confirm !== null;
      bCollect.disabled = s.running || locked;
      bStop.disabled = !s.running;
      bResume.disabled = !s.canResume || locked;
      bCopy.disabled = !s.canCopy || s.running || locked;
      bClear.disabled = !s.canClear || s.running || locked;
    },
  };
}
