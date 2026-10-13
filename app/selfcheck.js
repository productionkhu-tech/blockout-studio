// 자가 점검 — http://localhost:8795/?check 로 열면 콘솔에 결과. 보간·녹화 리샘플·물체 트랙·내보내기 크기·카 높이가 깨지면 여기서 걸린다.
import { sample, resampleRecording, mmToFov, fovToMm } from './campath.js';
import { trackAt, setKey, removeKeyAt } from './objects.js';
import { exportSize } from './exporter.js';
import { carY } from './hoistway.js';
import { COMMANDS } from './api.js';
import { keymapSelfcheck, DEFAULT_KEYMAP } from './keymap.js';
import { makeActions } from './actions.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const fails = [];
let count = 0;
const check = (name, ok) => { count++; if (!ok) fails.push(name); };

const keys = [
  { t: 0, pos: [0, 0, 0], target: [0, 0, -1], roll: 0, mm: 24, follow: true, hold: true },
  { t: 2, pos: [2, 0, 0], target: [2, 0, -1], roll: 10, mm: 48, follow: true, hold: false },
  { t: 4, pos: [4, 4, 0], target: [4, 4, -1], roll: 0, mm: 24, follow: false, hold: true },
];
check('키 밖(앞) = 첫 키', near(sample(keys, -1).pos[0], 0));
check('키 밖(뒤) = 끝 키', near(sample(keys, 9).pos[1], 4));
check('키 위에서는 그 키 값', near(sample(keys, 2).mm, 48) && near(sample(keys, 2).roll, 10));
check('키 사이는 사이값', (() => { const s = sample(keys, 1); return s.pos[0] > 0 && s.pos[0] < 2; })());
check('follow 는 0~1 로 섞임', (() => { const f = sample(keys, 3).follow; return f > 0 && f < 1; })());
check('렌즈 ↔ 화각 왕복', near(fovToMm(mmToFov(35)), 35, 1e-9));

const rec = Array.from({ length: 61 }, (_, i) => ({ t: i / 30, pos: [i / 30, 0, 0], target: [i / 30, 0, -1], roll: 0, mm: 25, follow: true }));
const rk = resampleRecording(rec);
check('녹화 2초 → 0.25 s 키 9개', rk.length === 9);
check('녹화 첫·끝 키는 멈춤', rk[0].hold && rk[rk.length - 1].hold);
check('녹화 키 x 는 시각과 같이 늘어남', near(rk[4].pos[0], 1.0, 0.05));

const base = { pos: [9, 9, 9], rotY: 0, scale: [1, 1, 1] };
const track = [];
setKey(track, 2, { pos: [2, 0, 0], rotY: 90, scale: [1, 1, 1] });
setKey(track, 0, { pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] });
check('키는 시각순으로 끼워짐', track[0].t === 0 && track[1].t === 2);
setKey(track, 2.0004, { pos: [3, 0, 0], rotY: 90, scale: [1, 1, 1] });
check('같은 시각 키는 바꿔 끼움', track.length === 2 && track[1].pos[0] === 3);
check('물체 트랙 없으면 base', trackAt([], 1, base).pos[0] === 9);
check('물체 트랙 가운데 = 절반', near(trackAt(track, 1, base).pos[0], 1.5) && near(trackAt(track, 1, base).rotY, 45));
check('물체 트랙 끝 밖 = 끝 값', trackAt(track, 5, base).pos[0] === 3);
check('키 지우기', removeKeyAt(track, 2) && track.length === 1 && !removeKeyAt(track, 7));

check('16:9 1080 → 1920×1080', exportSize('16:9', 1080).join('x') === '1920x1080');
check('9:16 1080 → 1080×1920', exportSize('9:16', 1080).join('x') === '1080x1920');
check('21:9 720 → 짝수 폭', exportSize('21:9', 720)[0] % 2 === 0);

const p = { carMode: 'rise', carStart: 1, carRamp: 1.3, carVmax: 9, carHold: 0 };
check('카 출발 전 0', carY(p, 0.5) === 0);
check('카 가속 뒤 등속', near(carY(p, 5) - carY(p, 4), 9, 1e-6));
check('카 멈춤 모드는 멈춤 높이', carY({ ...p, carMode: 'stop', carHold: 12 }, 100) === 12);

// AI(MCP) 명령 목록 — 앱을 고치다 명령 하나가 깨지면 Claude·GPT 쪽 도구 목록이 통째로 이상해지므로 여기서 잡는다
const ctx = { PRESETS: [{ id: 'x', label: 'x' }], MOVES: { dollyIn: 'x' } };
const names = COMMANDS.map((c) => c.name);
check('AI 명령 이름은 겹치지 않음', new Set(names).size === names.length && !names.includes('get_guide'));
check('AI 명령은 이름·제목·설명·실행이 다 있음', COMMANDS.every((c) => /^[a-z_]+$/.test(c.name) && c.title && c.desc && c.desc.length > 20 && typeof c.run === 'function'));
check('AI 명령 입력 칸은 object 스키마', COMMANDS.every((c) => { const sc = typeof c.schema === 'function' ? c.schema(ctx) : c.schema; return sc && sc.type === 'object' && sc.properties && (!sc.required || sc.required.every((r) => r in sc.properties)); }));

check('AI 수정 메모 도구 넷이 있음', ['get_notes', 'resolve_note', 'add_note', 'get_selection'].every((n) => names.includes(n)));

// 단축키 — 조합 문자열·바꾸기·되돌리기·상황 짝(1 = 기즈모/앞에서 보기)
check('단축키 바꾸기 · 기본값 되돌리기', keymapSelfcheck());
const acts = makeActions(window.app);
check('기본 단축키는 모두 있는 동작', Object.keys(DEFAULT_KEYMAP).every((id) => id in acts));
check('메뉴 동작은 이름·묶음이 있음', Object.values(acts).every((a) => a.label && a.group));

// 자석 · 구간(앱이 떠 있을 때)
const a = window.app;
if (a && a.state) {
  const keep = { snap: a.prefs.snap, range: a.state.range, time: a.time };
  a.prefs.snap = true;
  const k = a.state.camera.keys[0];
  if (k) check('자석: 키 바로 옆은 키에 붙음', near(a.snapT(k.t + 0.001), k.t));
  check('자석 끄면 그대로', (() => { a.prefs.snap = false; return near(a.snapT(1.2345), 1.2345); })());
  a.state.range = { in: 1, out: 2 };
  check('구간 재생 범위', (() => { const [s, e] = a.playSpan(), D = a.state.duration; return near(s, Math.min(1, D)) && near(e, Math.min(2, D)); })());
  Object.assign(a.prefs, { snap: keep.snap }); a.state.range = keep.range; a.time = keep.time;
}

console[fails.length ? 'error' : 'log'](fails.length ? `자가 점검 실패 ${fails.length}/${count}: ${fails.join(' / ')}` : `자가 점검 통과 (${count})`);
window.__selfcheck = fails;
