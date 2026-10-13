// 단축키 — 기본값(블렌더·언리얼·영상 편집기 관례)과 사람이 바꾼 것(설정 › 단축키, prefs.keymap 에 바꾼 것만 저장).
// 조합은 'Ctrl+Shift+KeyS' 꼴 — e.code 기준이라 한/영 입력 상태와 상관없다. 수식키 순서는 Ctrl·Alt·Shift 고정.
// hold = 누르고 있는 동안 동작(날기). 같은 키를 쓰는 동작은 when(상황)으로 가른다(예: 1 = 물체를 골랐으면 이동 기즈모, 아니면 앞에서 보기).

export const DEFAULT_KEYMAP = {
  'file.new': ['Ctrl+KeyN'], 'file.open': ['Ctrl+KeyO'], 'file.save': ['Ctrl+KeyS'], 'file.saveAs': ['Ctrl+Shift+KeyS'], 'prefs.open': ['Ctrl+Comma'],
  'edit.undo': ['Ctrl+KeyZ'], 'edit.redo': ['Ctrl+KeyY', 'Ctrl+Shift+KeyZ'], 'edit.copy': ['Ctrl+KeyC'], 'edit.paste': ['Ctrl+KeyV'], 'edit.cut': ['Ctrl+KeyX'],
  'edit.duplicate': ['Shift+KeyD', 'Ctrl+KeyD'], 'edit.delete': ['Delete', 'Backspace'], 'edit.escape': ['Escape'],
  'shot.take': ['KeyC', 'KeyI'], 'obj.key': ['KeyK'], 'shot.record': ['KeyV'], 'shot.prev': ['ArrowLeft', 'ArrowDown'], 'shot.next': ['ArrowRight', 'ArrowUp'],
  'play.toggle': ['Space'], 'play.fromStart': ['Enter', 'NumpadEnter'], 'time.start': ['Home', 'Shift+ArrowLeft'], 'time.end': ['End', 'Shift+ArrowRight'],
  'frame.prev': ['Comma'], 'frame.next': ['Period'], 'frame.prev10': ['Shift+Comma'], 'frame.next10': ['Shift+Period'],
  'time.snap': ['Shift+Tab'], 'range.in': ['Ctrl+Home'], 'range.out': ['Ctrl+End'], 'range.clear': ['Alt+Home'],
  'view.cycle': ['Tab'], 'view.front': ['Numpad1', 'Digit1'], 'view.right': ['Numpad3', 'Digit3'], 'view.top': ['Numpad7', 'Digit7'],
  'view.back': ['Ctrl+Numpad1', 'Ctrl+Digit1'], 'view.left': ['Ctrl+Numpad3', 'Ctrl+Digit3'], 'view.bottom': ['Ctrl+Numpad7', 'Ctrl+Digit7'],
  'view.focus': ['Shift+KeyF', 'NumpadDecimal'], 'view.walk': ['Backquote'], 'look.outline': ['KeyO'], 'look.xray': ['Alt+KeyZ'], 'tool.measure': ['KeyM'],
  'speed.down': ['BracketLeft', 'NumpadSubtract'], 'speed.up': ['BracketRight', 'NumpadAdd'], 'lens.wider': ['Minus'], 'lens.narrower': ['Equal'],
  'gizmo.translate': ['Digit1', 'KeyG'], 'gizmo.rotate': ['Digit2'], 'gizmo.scale': ['Digit3'], 'gizmo.cycle': ['KeyT'],
  'mode.toggle': ['F2'], 'note.add': ['KeyN'], 'tool.path': ['KeyP'], 'help.manual': ['F1'], 'help.keys': ['Shift+Slash'],
  'move.forward': ['KeyW'], 'move.back': ['KeyS'], 'move.left': ['KeyA'], 'move.right': ['KeyD'], 'move.up': ['KeyR'], 'move.down': ['KeyF'],
  'turn.left': ['KeyQ'], 'turn.right': ['KeyE'], 'roll.left': ['KeyZ'], 'roll.right': ['KeyX'],
};
export const HOLD = new Set(['move.forward', 'move.back', 'move.left', 'move.right', 'move.up', 'move.down', 'turn.left', 'turn.right', 'roll.left', 'roll.right']);

const MOD = ['Ctrl', 'Alt', 'Shift'];
export function comboOf(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !/^Shift/.test(e.code)) parts.push('Shift');
  return [...parts, e.code].join('+');
}

const NAMES = { Space: 'Space', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', Escape: 'Esc', Delete: 'Del', Backspace: 'Backspace' };
export function label(combo) {
  return combo.split('+').map((p) => (MOD.includes(p) ? p : NAMES[p] || p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'Num $1'))).join('+')
    .replace('Shift+/', '?');
}

export class Keymap {
  constructor(prefs) { this.prefs = prefs; this.rebuild(); }

  keys(id) { return (this.prefs.keymap && this.prefs.keymap[id]) || DEFAULT_KEYMAP[id] || []; }

  rebuild() {                                   // 조합 → 동작들(같은 조합이 상황별로 둘일 수 있음)
    this.byCombo = new Map();
    this.hold = new Map();                      // e.code → hold 동작
    for (const id of new Set([...Object.keys(DEFAULT_KEYMAP), ...Object.keys(this.prefs.keymap || {})])) {
      for (const c of this.keys(id)) {
        if (HOLD.has(id)) { this.hold.set(c, id); continue; }
        if (!this.byCombo.has(c)) this.byCombo.set(c, []);
        this.byCombo.get(c).push(id);
      }
    }
  }

  set(id, combos) {                             // 바꾸기 — 기본값과 같으면 바꾼 기록을 지움
    const km = { ...(this.prefs.keymap || {}) };
    if (JSON.stringify(combos) === JSON.stringify(DEFAULT_KEYMAP[id] || [])) delete km[id]; else km[id] = combos;
    this.prefs.keymap = km;
    this.rebuild();
  }

  conflicts(id, combo) {                        // 이 조합을 이미 쓰는 다른 동작(상황이 겹치는 것만 — 1·2·3 처럼 상황으로 갈리는 짝은 뺌)
    const SPLIT = [['gizmo.translate', 'view.front'], ['gizmo.scale', 'view.right']];
    const others = [...(this.byCombo.get(combo) || []), this.hold.get(combo)].filter((x) => x && x !== id);
    return others.filter((o) => !SPLIT.some(([a, b]) => (a === id && b === o) || (b === id && a === o)));
  }

  reset() { this.prefs.keymap = {}; this.rebuild(); }
}

// 자가 점검(selfcheck.js 가 부름)
export function keymapSelfcheck() {
  const ev = (code, o = {}) => ({ code, ctrlKey: !!o.c, altKey: !!o.a, shiftKey: !!o.s, metaKey: false });
  const km = new Keymap({ keymap: {} });
  const ok = [
    comboOf(ev('KeyS', { c: 1, s: 1 })) === 'Ctrl+Shift+KeyS',
    comboOf(ev('ShiftLeft', { s: 1 })) === 'ShiftLeft',
    label('Ctrl+Shift+KeyS') === 'Ctrl+Shift+S' && label('Shift+Slash') === '?' && label('Numpad7') === 'Num 7',
    km.byCombo.get('Ctrl+KeyS')[0] === 'file.save' && km.hold.get('KeyW') === 'move.forward',
    km.conflicts('gizmo.translate', 'Digit1').length === 0 && km.conflicts('obj.key', 'KeyC').includes('shot.take'),
  ];
  km.set('file.save', ['F5']);
  ok.push(km.byCombo.get('F5')[0] === 'file.save' && !km.byCombo.has('Ctrl+KeyS'));
  km.set('file.save', ['Ctrl+KeyS']);
  ok.push(!('file.save' in km.prefs.keymap));
  return ok.every(Boolean);
}
