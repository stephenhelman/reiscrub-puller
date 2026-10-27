export const PANEL_CSS = `
:host { all: initial; }
.root {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: 280px; font: 12px/1.4 system-ui, -apple-system, sans-serif; color: #e8eaf0;
  background: #161922; border: 1px solid #2c3142; border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.35); overflow: hidden;
}
.head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; background: #1d212d; cursor: grab; user-select: none; touch-action: none;
}
.head:active { cursor: grabbing; }
.title { font-weight: 600; letter-spacing: .02em; }
.toggle { all: unset; cursor: pointer; padding: 0 6px; font-size: 14px; color: #9aa3b8; }
.body { padding: 10px; display: grid; gap: 8px; }
.collapsed .body { display: none; }
.list { display: grid; gap: 4px; }
.lbl { color: #9aa3b8; }
.sel { box-sizing: border-box; width: 100%; padding: 4px 6px; border-radius: 6px; background: #1d212d; color: #e8eaf0; border: 1px solid #2c3142; font: inherit; }
.sel:disabled { opacity: .5; }
.sel:focus-visible, .chk input:focus-visible { outline: 2px solid #4f8cff; outline-offset: 1px; }
.desc { display: none; color: #c9cfdf; }
.hint { color: #9aa3b8; }
.filters { display: none; gap: 3px; padding: 2px 0; }
.chk { display: flex; gap: 6px; align-items: center; cursor: pointer; }
.rows { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; }
.rows dt { color: #9aa3b8; }
.rows dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.bar { height: 6px; background: #262b3a; border-radius: 3px; overflow: hidden; }
.fill { height: 100%; width: 0; background: #4f8cff; transition: width .2s; }
.note { display: none; color: #e0b44c; }
.status { min-height: 2.8em; color: #c9cfdf; }
.confirm { display: none; gap: 6px; padding: 8px; background: #231f14; border: 1px solid #5b4a1c; border-radius: 6px; }
.confirm.show { display: grid; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
button.b {
  all: unset; box-sizing: border-box; cursor: pointer; padding: 5px 10px; border-radius: 6px;
  background: #2a3042; color: #e8eaf0; text-align: center;
}
button.b:hover:not(:disabled) { background: #343b52; }
button.b.primary { background: #3a6fd8; }
button.b.primary:hover:not(:disabled) { background: #4a7fe8; }
button.b:disabled { opacity: .4; cursor: default; }
button.b:focus-visible, .toggle:focus-visible { outline: 2px solid #4f8cff; outline-offset: 1px; }
`;
