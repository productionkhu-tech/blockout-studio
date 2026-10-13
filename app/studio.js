// 블록아웃 스튜디오 — 게임처럼 WASD 로 날아다니며 C 로 「여기 찍기」, Space 재생, ←→ 장면 와리가리, 물체는 클릭해 기즈모로.
// 회색 블록아웃을 PNG·MP4·JSON 으로 내보낸다.
// 10/8 5판: 카메라 키와 물체 키를 나눔 — C = 카메라 장면, K = 고른 물체의 키. 아래 트랙 타임라인(카메라 줄 + 물체 줄)에서 마름모를 끌어 시각을 옮기고 Delete 로 지운다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Hoistway, Studio, DEFAULT_PARAMS, DEFAULT_LIGHTS, carY } from './hoistway.js';
import { WestTown, WEST_PARAMS, WEST_SKY } from './westtown.js';
import { sample, applyToCamera, keyFromFly, flyFromKey, flyForward, resampleRecording, mmToFov, sortKeys } from './campath.js';
import { exportPNG, exportMP4, exportSheet, exportSize, download, stamp, canEncodeMp4, exportGLB, exportShotList } from './exporter.js';
import { SceneObject, primitiveMesh, trackAt, setKey, removeKeyAt, cloneTr, KINDS } from './objects.js';
import { icon, fillIcons } from './icons.js';
import { PlanView, PLAN_BG } from './plan.js';
import { startBridge, openAI } from './bridge.js';
import { Keymap, comboOf, label as keyLabel } from './keymap.js';
import { bindModals, openModal, closeModal, topModal, ask, askText, $, esc, imgSrc, keepFocus } from './ui.js';
import { Projects } from './projects.js';
import { Notes } from './notes.js';
import { makeActions, makeMenus } from './actions.js';
import { MenuBar } from './menu.js';
import { PrefsUI } from './prefs.js';
import { Updates } from './update.js';

THREE.Cache.enabled = true;                 // GLB 를 다시 불러올 때(되돌리기) 메모리에서

// 새 프로젝트의 세트 — optional 은 파일이 있을 때만 보임(공개 판에는 안 들어가는 예시)
const PRESETS = [
  { id: 'west_duel', label: '서부 마을 · 결투 (무빙·동선 예시)', file: 'scenes/서부_결투.json', icon: 'sun', desc: '큰길에서 두 사람이 마주 걸어오는 예시가 들어 있습니다' },
  { id: 'west_empty', label: '서부 마을 (비어 있음)', builtin: () => blank('western', '서부 마을'), icon: 'sun', desc: '야외 세트 — 큰길 · 가게 · 교회 · 물탱크' },
  { id: 'studio', label: '빈 스튜디오', builtin: () => blank('studio', '빈 스튜디오'), icon: 'box', desc: '둥근 회색 바닥 — 물체를 올려 놓고 찍기' },
  { id: 'hoistway_empty', label: '엘리베이터 승강로 (비어 있음)', builtin: () => blank('hoistway', '승강로'), icon: 'elevator', desc: '42층 승강로 — 카를 타고 오르내리며 찍기' },
  { id: 'hoistway_v9', label: '승강로 · 무빙 예시', file: 'scenes/승강로_v9.json', icon: 'elevator', desc: '승강로에 카메라 무빙 예시가 들어 있습니다', optional: true },
];
const SPOTS = {                      // 세트별 바로 가기 자리
  hoistway: [
    { label: '정면', pos: [0, 2.3, 1.4], look: [0, 2.4, -0.2], mm: 25 },
    { label: '카 지붕 위', pos: [0.7, 3.4, 0.9], look: [0, 2.8, -0.15], mm: 28 },
    { label: '로프 옆', pos: [0.32, 4.2, -0.15], look: [0.09, 7.0, -0.15], mm: 35 },
    { label: '올려다보기', pos: [0, 2.9, 0.3], look: [0, 12, -0.1], mm: 18 },
    { label: '무게추 쪽', pos: [0.6, 3.6, -0.9], look: [0, 6.5, -1.12], mm: 24 },
  ],
  western: [
    { label: '큰길 와이드', pos: [2.4, 1.0, 11], look: [0, 1.3, -4], mm: 24 },
    { label: '얼굴 클로즈업', pos: [0.3, 1.55, 3.8], look: [-0.6, 1.5, 6], mm: 50 },
    { label: '크레인', pos: [-1.5, 9, 16], look: [0.3, 1.5, -8], mm: 28 },
    { label: '살룬 앞', pos: [-2.6, 1.6, -3], look: [-6.5, 2.6, 1], mm: 28 },
    { label: '물탱크 쪽', pos: [2, 1.4, -18], look: [9.5, 8, -34], mm: 24 },
  ],
  studio: [],
};
const CAR_MOVE = { stop: { carMode: 'stop' }, slow: { carMode: 'rise', carVmax: 3 }, normal: { carMode: 'rise', carVmax: 6 }, fast: { carMode: 'rise', carVmax: 9 } };
const LS_KEY = 'blockout-studio:v3', LS_AT = 'blockout-studio:v3-at', LS_TUT = 'blockout-studio:tutorial3', LS_PREFS = 'blockout-studio:prefs';
const vt = (s) => String(s || '0').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
const newerThan = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); return false; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;     // 「동작 줄이기」 — 미끄러지는 이동·튀어나옴도 끔
const REC_MAX = 30, HIST_MAX = 40, MIN_GAP = 0.2;
const DEFAULT_PREFS = { speed: 2, sens: 1, invertY: false, turn: 90, moveDur: 4, moveDist: 2, eye: 1.6, guide: 'none', letterbox: false, easy: true,
  snap: true, loop: false, pins: true, resume: true, keymap: {}, tab: 'camera' };
const FIRST_PRESET = 'west_duel';                    // 처음 열면 — 모델 파일 없이 바로 되는 세트
const REPEAT = new Set(['frame.prev', 'frame.next', 'frame.prev10', 'frame.next10', 'shot.prev', 'shot.next', 'speed.down', 'speed.up', 'lens.wider', 'lens.narrower', 'edit.undo', 'edit.redo']);   // 누르고 있으면 되풀이(나머지는 한 번만)
const SET_NAMES = { western: '서부 마을', hoistway: '엘리베이터 승강로', studio: '빈 스튜디오' };

const MOVES = { dollyIn: '밀어 들어가기', dollyOut: '빠져나오기', craneUp: '크레인 업', craneDown: '크레인 다운', trackL: '왼쪽 트래킹', trackR: '오른쪽 트래킹', arcL: '왼쪽으로 돌기', arcR: '오른쪽으로 돌기', tiltUp: '틸트 업', tiltDown: '틸트 다운', dollyZoom: '돌리 줌' };

function defaultParams(scene) {
  return scene === 'western' ? { ...WEST_PARAMS } : { ...DEFAULT_PARAMS };
}

function blank(scene, name) {
  return { format: 'blockout-studio/4', name, note: '', scene, duration: 0.5, fps: 24, aspect: '16:9', tail: 0.5, follow: scene === 'hoistway', gap: 1.5,
    params: defaultParams(scene), lights: { ...DEFAULT_LIGHTS }, camera: { keys: [] }, objects: [], spots: [], recorded: false, notes: [], range: null };
}

// −/+ 스테퍼: 버튼을 누르면 step 만큼, 값을 누르면 직접 입력
function stepper(el, { get, set, step, fmt, min = -Infinity, max = Infinity }) {
  let v = el.querySelector('.v');
  if (v.tagName !== 'BUTTON') { const b = document.createElement('button'); b.className = 'v'; b.title = '눌러서 값 넣기'; v.replaceWith(b); v = b; }
  const what = (el.closest('.stprow, .gap') && (el.closest('.stprow, .gap').firstElementChild || {}).textContent) || '값';
  el.querySelectorAll('button[data-d]').forEach((b) => { const up = b.dataset.d === '1'; b.innerHTML = icon(up ? 'plus' : 'minus', 14); b.setAttribute('aria-label', `${what.trim()} ${up ? '늘리기' : '줄이기'}`); });
  const show = () => { v.textContent = fmt(get()); };
  el.querySelectorAll('button[data-d]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); set(Math.min(Math.max(get() + step * parseFloat(b.dataset.d), min), max)); show(); }; });
  v.onclick = async (e) => {
    e.stopPropagation();
    const s = await askText({ title: '값 넣기', label: `${fmt(min === -Infinity ? 0 : min)} ~ ${fmt(max === Infinity ? 999 : max)}`, value: String(get()), ok: '바꾸기' });
    if (s === null) return;
    const n = parseFloat(s);
    if (!isNaN(n)) { set(Math.min(Math.max(n, min), max)); show(); }
  };
  show();
  return show;
}

function seg(el, onPick) {
  el.querySelectorAll('button[data-v]').forEach((b) => { b.onclick = () => { el.querySelectorAll('button[data-v]').forEach((x) => x.classList.toggle('on', x === b)); onPick(b.dataset.v); }; });
  return (v) => el.querySelectorAll('button[data-v]').forEach((x) => x.classList.toggle('on', x.dataset.v === String(v)));
}

class App {
  constructor() {
    fillIcons();
    this.canvas = $('c');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;                 // 야외 세트의 해 그림자(승강로엔 그림자 광원이 없어 비용 없음)
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene3 = new THREE.Scene();
    this.scene3.background = new THREE.Color(0x0b0b0b);
    this.planV = new PlanView(this.scene3);            // 평면도(위·앞·옆) 보기
    this.plan = null;
    this._planExport = false;
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.02, 600);
    this.fill = new THREE.PointLight(0xffffff, 0.3, 0, 2);
    this.camera.add(this.fill);
    this.scene3.add(this.camera);
    this.loader = new GLTFLoader();
    this.greyMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
    this.greyMat.color.setScalar(Math.pow(0.62, 2.2));
    this.tc = new TransformControls(this.camera, this.canvas);
    this.tc.setSize(0.9);
    this.tcHelper = this.tc.getHelper();
    this.scene3.add(this.tcHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.gizmoDrag = e.value;
      if (e.value) this.pushHistory();
      else if (this.selObj) this.commitObject(this.selObj, '기즈모');
    });
    this.tc.addEventListener('objectChange', () => { if (this.selObj) this.showObj(); });
    this.outline = null;                      // 고른 물체의 노란 테두리(Box3Helper) — 물체 그룹의 자식이라 따라 움직임
    this.raycaster = new THREE.Raycaster();
    this.measures = new THREE.Group(); this.scene3.add(this.measures);   // 자(M)
    this.measure = null; this.walk = false; this._tele = null;

    this.state = blank('hoistway', '승강로');
    this.prefs = { ...DEFAULT_PREFS };
    try { const sp = localStorage.getItem(LS_PREFS); this.hadPrefs = !!sp; Object.assign(this.prefs, JSON.parse(sp || '{}')); } catch (e) { /* 저장소 막힘 — 기본값으로 */ }
    this.keymap = new Keymap(this.prefs);             // 단축키(설정 › 단축키에서 바꾼 것 포함)
    this.holdDown = new Set();                        // 누르고 있는 날기 동작(move.forward …)
    this.activeTab = 'camera';
    this.version = ''; this.versionInfo = null;
    this.world = null;
    this.objects = [];
    this.selObj = null;
    this.selKey = null;                // 타임라인에서 고른 물체 키 { obj, key }
    this.fly = { pos: [0, 2.3, 1.4], yaw: 0, pitch: 0.07, roll: 0, mm: 25 };
    this.mode = 'fly';
    this.keysDown = new Set();
    this.time = 0;
    this.playing = false;
    this.recording = null;
    this.selected = null;
    this.editing = null;               // 수정 중인 장면 카드
    this.exporting = false;
    this.stop = false;
    this.gizmoDrag = false;
    this.hist = [];
    this.redoStack = [];
    this.timer = new THREE.Timer();
    this._dirty = false;
    this.lastSave = 0;

    bindModals();
    this.ai = { PRESETS: PRESETS.filter((p) => !p.optional), MOVES, log: [] };   // AI 연결(MCP) 상태·기록 — 버튼 글자가 이것을 보므로 화면보다 먼저
    this.projects = new Projects(this);                 // 파일 메뉴(저장·열기·최근·자동 저장)
    this.notes = new Notes(this);                       // 에이전트 모드 · 수정 메모
    this.actions = makeActions(this);                   // 메뉴·단축키·버튼이 함께 쓰는 동작
    this.buildUI();
    this.menuBar = new MenuBar(this, $('menus'), makeMenus(this));
    this.prefsUI = new PrefsUI(this);
    this.updates = new Updates(this);
    this.bindPointer();
    this.bindTimeline();
    this.bindKeys();
    new ResizeObserver(() => this.fitViewport()).observe($('viewport'));
    this.fitViewport();
    this.versionReady = this.loadVersion();
    this.ready = this.loadStart();                     // AI 명령은 첫 장면이 다 뜬 뒤에(app/api.js)
    startBridge(this, this.ai);                         // AI 연결(MCP) — 앱 서버가 있으면 붙음
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---------------------------------------------------------------- 장면 세트 · 상태 · 되돌리기
  async loadStart() {
    this.checkPresets(); this.loadModels();            // 기다리지 않음(파일 있는 예시 세트 · assets 의 GLB)
    const resume = this.prefs.resume !== false;
    let local = null, localAt = 0;
    try { if (resume) { local = localStorage.getItem(LS_KEY); localAt = +localStorage.getItem(LS_AT) || 0; } } catch (e) { /* 저장소 막힘 */ }
    const server = resume ? await this.projects.loadSession() : null;     // 앱 서버에 둔 세션 — 포트·브라우저가 바뀌어 저장소가 비어도 이어서 열림
    let st = null;
    if (server && server.state && (!local || (server.savedAt || 0) > localAt + 2000)) { st = server.state; this.projects.adopt(server); }
    else if (local) { try { st = JSON.parse(local); } catch (e) { console.warn('깨진 자동 저장', e); } }
    let resumed = false;
    if (st) {
      try { await this.applyState(st); resumed = true; } catch (e) { console.warn(e); }
    }
    if (resumed) {
      if (!this.projects.file && this.state.name) this.projects.name = this.state.name;
      this.projects.showTitle();
      this.status('지난 작업을 이어서 열었습니다 — 새로 하려면 파일 › 새 프로젝트 (Ctrl+N)');
    } else {
      await this.loadPreset(FIRST_PRESET);
      this.projects.setClean(this.state.name, null);
      if (this.prefs.resume === false) setTimeout(() => this.projects.newDialog(this.templates()), 300);   // 이어서 열기를 끈 사람: 켤 때마다 세트 고르기
    }
    let tut = false; try { tut = !!localStorage.getItem(LS_TUT); } catch (e) { /* 저장소 막힘 */ }
    if (!tut && !this.prefs.tutorialDone) this.coachStart();
  }

  async loadVersion() {            // 버전 — 오른쪽 아래 「v1.5.0 · 업데이트 확인」, 정보 창, AI 설명서
    try { const v = await (await fetch('version.json', { cache: 'no-store' })).json(); this.versionInfo = v; this.version = `v${v.version}`; } catch (e) { this.version = ''; }
    if (this.updates) this.updates.paint();
  }

  templates() { return PRESETS.filter((p) => !p.optional || p.ok); }

  async checkPresets() {           // 파일이 있어야 보이는 예시 세트(공개 판엔 없음)
    for (const p of PRESETS.filter((x) => x.optional)) {
      try { p.ok = (await fetch(p.file, { method: 'HEAD', cache: 'no-store' })).ok; } catch (e) { p.ok = false; }
    }
  }

  async loadModels() {             // 물체 탭의 모델 버튼 — exe 옆·앱 폴더의 assets 에 있는 GLB(앱 서버가 목록을 줌)
    const box = $('builtinModels');
    let items = [];
    try { const r = await fetch('/api/models', { cache: 'no-store' }); if (r.ok) items = (await r.json()).items || []; } catch (e) { /* 서버 없는 창 */ }
    box.innerHTML = '';
    for (const m of items) {
      const b = document.createElement('button');
      b.innerHTML = `${icon('model', 15)}<span class="nm">${esc(m.name)}</span> <small>${m.mb} MB</small>`; b.title = m.name;
      b.onclick = () => (this.notes.agent ? this.agentBlock() : this.loadModel(m.src).catch((e) => this.warn(`모델을 못 열었음: ${e.message}`)));
      box.appendChild(b);
    }
    box.style.display = items.length ? '' : 'none';
  }

  // ---------------------------------------------------------------- 따라 하기 안내(처음 한 번) · 쉬운 모드
  coachStart() {
    this.coach = { step: 0, base: this.state.camera.keys.length, f0: { pos: this.fly.pos.slice(), yaw: this.fly.yaw, pitch: this.fly.pitch } };
    this.coachShow();
  }

  coachShow() {
    const c = this.coach; if (!c) return;
    const steps = [
      ['1 / 4 · 둘러보기', '마우스로 화면을 <b>끌어</b> 둘러보고, <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 로 움직여 보세요'],
      ['2 / 4 · 찍기', '마음에 드는 자리에서 <kbd>C</kbd> — 그 시점이 장면으로 찍힙니다'],
      ['3 / 4 · 이어 찍기', '조금 움직여서 <kbd>C</kbd> 를 두 번 더 — 찍은 순서가 그대로 무빙이 됩니다'],
      ['4 / 4 · 재생', '<kbd>Space</kbd> 를 눌러 재생해 보세요'],
      ['끝', '영상은 오른쪽 <b>내보내기</b> 탭의 MP4, 프로젝트 저장은 <kbd>Ctrl</kbd>+<kbd>S</kbd>. 사람은 <b>물체</b> 탭의 「사람」, 전체 기능은 오른쪽 아래 「쉬운 모드」'],
    ];
    const [k, t] = steps[c.step];
    $('coach').style.display = 'block'; $('coach').querySelector('.k').textContent = k; $('coach').querySelector('.t').innerHTML = t;
  }

  coachCheck() {                   // tick 마다 — 한 단계가 끝났는지
    const c = this.coach; if (!c) return;
    const n = this.state.camera.keys.length;
    let done = false;
    if (c.step === 0) { const f = this.fly; done = Math.hypot(f.pos[0] - c.f0.pos[0], f.pos[1] - c.f0.pos[1], f.pos[2] - c.f0.pos[2]) > 0.8 || Math.abs(f.yaw - c.f0.yaw) + Math.abs(f.pitch - c.f0.pitch) > 0.3; }
    else if (c.step === 1) done = n >= c.base + 1;
    else if (c.step === 2) done = n >= c.base + 3;
    else if (c.step === 3) done = this.mode === 'play' && this.playing;
    else if (c.step === 4) { if (performance.now() - c.doneAt > 10000) this.coachEnd(); return; }
    if (done) { c.step++; if (c.step === 4) c.doneAt = performance.now(); this.coachShow(); this.toast(c.step === 4 ? '끝! 잘하셨어요' : '좋아요'); }
  }

  coachEnd() {                     // 끝 — 설정에도 남김(브라우저 저장소가 비어도 서버 세션의 설정으로 다시 안 뜨게)
    this.coach = null; $('coach').style.display = 'none';
    try { localStorage.setItem(LS_TUT, '1'); } catch (e) { /* 저장소 막힘 */ }
    if (!this.prefs.tutorialDone) { this.prefs.tutorialDone = true; this.savePrefs(); }
  }

  setEasy(on) {                    // 쉬운 모드: .adv 를 숨김
    this.prefs.easy = !!on; this.savePrefs();
    document.body.classList.toggle('easy', !!on);
    const b = $('btnEasy'); b.classList.toggle('on', !!on); b.textContent = '쉬운 모드'; b.setAttribute('aria-pressed', String(!!on));
    b.title = on ? '쉬운 모드 켜짐 — 꼭 필요한 버튼만. 누르면 전체 기능' : '쉬운 모드 꺼짐 — 전체 기능. 누르면 꼭 필요한 것만';
  }

  async loadPreset(id) {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    const st = p.file ? await (await fetch(p.file)).json() : p.builtin();
    await this.applyState({ ...st, preset: p.id });
    this.status(`${p.label} 불러옴`);
  }

  async applyState(st) {
    this.state = { ...blank(st.scene || 'hoistway', st.name || ''), ...st };
    this.state.params = { ...defaultParams(this.state.scene), ...(st.params || {}) };
    this.state.lights = { ...DEFAULT_LIGHTS, ...(st.lights || {}) };
    this.state.camera = { keys: sortKeys((st.camera && st.camera.keys) || []) };
    if (this.state.scene !== 'hoistway') this.state.follow = false;
    if (!Array.isArray(this.state.notes)) this.state.notes = [];
    for (const k of this.state.camera.keys) if (k.thumb && !imgSrc(k.thumb)) delete k.thumb;           // 썸네일은 그림 data: 만(아니면 다시 찍음)
    if (st.appVersion && this.version && newerThan(vt(st.appVersion), vt(this.version))) setTimeout(() => this.warn(`이 프로젝트는 새 판(${st.appVersion})에서 만들었습니다 — 업데이트하면 빠짐없이 보입니다`), 800);
    if (!this.state.range || !(this.state.range.out > this.state.range.in)) this.state.range = null;
    this._presetId = this.state.preset || null;
    this.selected = null;
    this.editing = null; $('editBadge').style.display = 'none';
    this.selKey = null;
    this.time = 0;
    this.playing = false;
    this.recording = null;
    this.mode = 'fly';
    this.hist = []; this.redoStack = [];
    this.setPlan(null);
    this.buildWorld();
    this.selectObj(null);
    for (const o of this.objects) this.scene3.remove(o.group);
    this.objects = [];
    await this.restoreObjects(st.objects || st.models || []);
    for (const k of this.state.camera.keys) {                       // 3판 저장본(장면 안에 물체 자리) → 물체 키 트랙으로
      if (!k.objects) continue;
      for (const [id, tr] of Object.entries(k.objects)) { const o = this.objects.find((x) => x.id === id); if (o) setKey(o.keys, k.t, tr); }
      delete k.objects;
    }
    this.recomputeTimes();
    const keys = this.state.camera.keys;
    if (keys.length) this.fly = flyFromKey(keys[0]);
    else if (this.state.scene === 'studio') this.fly = { pos: [4, 2.2, 6], yaw: Math.atan2(4, 6), pitch: -0.15, roll: 0, mm: 30 };
    else if (this.state.scene === 'western') this.fly = flyFromKey({ pos: [1.5, 2.4, 19], target: [0, 1.2, -2], roll: 0, mm: 28 });
    else this.fly = flyFromKey({ pos: SPOTS.hoistway[1].pos, target: SPOTS.hoistway[1].look, roll: 0, mm: SPOTS.hoistway[1].mm });   // 빈 승강로는 카 지붕 위에서 시작(앞판 벽만 보이던 자리 대신)
    if (this.notes.path) this.notes.cancelPath();
    this.notes.select(null);
    this.notes.render();
    this.syncUI();
    await this.ensureThumbs();
    this.refreshStrip();
    this.saveLocal();
  }

  buildWorld() {
    if (this.world) this.scene3.remove(this.world.group);
    const sc = this.state.scene;
    this.world = sc === 'studio' ? new Studio() : sc === 'western' ? new WestTown(this.state.params) : new Hoistway(this.state.params);
    this.scene3.add(this.world.group);
    this.scene3.background.set(sc === 'western' ? WEST_SKY : 0x0b0b0b);
    this.scene3.fog = sc === 'studio' ? null : new THREE.FogExp2(sc === 'western' ? WEST_SKY : 0x0b0b0b, this.state.params.fog);
    if (this.plan) { this._fogSaved = this.scene3.fog; this.scene3.fog = null; }
  }

  carY(t) {
    return this.state.scene !== 'hoistway' ? 0 : carY(this.state.params, t);
  }

  saveLocal() {                     // 바뀔 때마다(0.8 초 뒤): 브라우저 저장소 + 앱 서버의 세션(1.5 초 뒤) — 어느 쪽이 비어도 다음에 이어서 열림
    try { this.state.objects = this.objects.map((o) => o.toJSON()); localStorage.setItem(LS_KEY, JSON.stringify(this.state)); localStorage.setItem(LS_AT, String(Date.now())); } catch (e) { /* 저장소 꽉 참·막힘 — 서버 세션이 받음 */ }
    this.projects.remember();
    this.projects.saveSession();
  }

  savePrefs() {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(this.prefs)); } catch (e) { /* 무시 */ }
  }

  touch() {
    this.lastSave = performance.now();
    this._dirty = true;
    if (this.projects) this.projects.markDirty();      // 제목 옆 ● (저장 안 한 변경)
  }

  status(msg) {
    const s = $('status'); s.textContent = msg; s.title = msg;               // 길어서 잘리면 마우스를 올려 전체
  }

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1600);
  }

  warn(msg) {                      // 못 하는 이유는 상태줄(멀다)과 토스트(화면 가운데) 둘 다에
    this.status(msg);
    this.toast(msg);
  }

  snapshotState() {
    const s = this.state;
    return JSON.stringify({ keys: s.camera.keys, objects: this.objects.map((o) => o.toJSON()), params: s.params, lights: s.lights, follow: s.follow, gap: s.gap, tail: s.tail, recorded: s.recorded });
  }

  pushHistory() {                   // 바꾸기 전에 부른다
    this.hist.push(this.snapshotState());
    if (this.hist.length > HIST_MAX) this.hist.shift();
    this.redoStack = [];
    this.syncUndoUI();
  }

  async restoreSnapshot(json) {
    const d = JSON.parse(json);
    const s = this.state;
    s.camera.keys = d.keys; s.params = d.params; s.lights = d.lights; s.follow = d.follow; s.gap = d.gap; s.tail = d.tail; s.recorded = d.recorded;
    if (this.mode === 'play') this.pause();
    this.selKey = null;
    await this.restoreObjects(d.objects);
    this.recomputeTimes();
    this.time = Math.min(this.time, this.state.duration);
    if (this.selected && !s.camera.keys.includes(this.selected)) this.selected = null;
    if (this.editing && !s.camera.keys.includes(this.editing)) { this.editing = null; $('editBadge').style.display = 'none'; }
    this.syncUI();
    this.refreshStrip();
    this.touch();
  }

  async undo() {
    if (!this.hist.length) { this.status('되돌릴 것이 없음'); return; }
    this.redoStack.push(this.snapshotState());
    await this.restoreSnapshot(this.hist.pop());
    this.syncUndoUI();
    this.toast('되돌림');
  }

  async redo() {
    if (!this.redoStack.length) { this.status('다시 할 것이 없음'); return; }
    this.hist.push(this.snapshotState());
    await this.restoreSnapshot(this.redoStack.pop());
    this.syncUndoUI();
    this.toast('다시 함');
  }

  syncUndoUI() {
    $('btnUndo').disabled = !this.hist.length;
    $('btnRedo').disabled = !this.redoStack.length;
  }

  recomputeTimes() {                 // 길이 = 마지막 키(카메라·물체 중 늦은 쪽) + 머무는 시간
    const keys = this.state.camera.keys;
    let last = keys.length ? keys[keys.length - 1].t : 0;
    for (const o of this.objects) if (o.keys.length) last = Math.max(last, o.keys[o.keys.length - 1].t);
    this.state.duration = Math.max(last + this.state.tail, 0.5);
  }

  // ---------------------------------------------------------------- 프레임
  fitViewport() {
    const box = $('viewport').getBoundingClientRect();
    const [aw, ah] = this.state.aspect.split(':').map(Number);
    let w = box.width - 16, h = w * ah / aw;
    if (h > box.height - 16) { h = box.height - 16; w = h * aw / ah; }
    w = Math.max(64, Math.floor(w)); h = Math.max(36, Math.floor(h));
    this.viewW = w; this.viewH = h;
    this.sizeTimeline();
    if (!this.exporting) this.restoreSize();
    this.layoutGuides();
  }

  layoutGuides() {                 // 구도 가이드(블렌더 컴포지션 가이드) + 2.39:1 레터박스(파스파르투) — 화면에만
    const svg = $('guides'); if (!svg || !this.viewW) return;
    const vr = $('viewport').getBoundingClientRect(), cr = this.canvas.getBoundingClientRect(), w = this.viewW, h = this.viewH;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.style.width = `${w}px`; svg.style.height = `${h}px`; svg.style.left = `${cr.left - vr.left}px`; svg.style.top = `${cr.top - vr.top}px`;
    const g = this.prefs.guide || 'none', L = [];
    const line = (x1, y1, x2, y2) => L.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
    if (g === 'thirds') for (const f of [1 / 3, 2 / 3]) { line(w * f, 0, w * f, h); line(0, h * f, w, h * f); }
    else if (g === 'center') { line(w / 2, 0, w / 2, h); line(0, h / 2, w, h / 2); }
    else if (g === 'diag') { line(0, 0, w, h); line(w, 0, 0, h); line(w / 2, 0, w / 2, h); line(0, h / 2, w, h / 2); }
    else if (g === 'golden') for (const f of [0.382, 0.618]) { line(w * f, 0, w * f, h); line(0, h * f, w, h * f); }
    let bars = '';
    if (this.prefs.letterbox) { const bh = (h - w / 2.39) / 2; if (bh > 1) bars = `<rect x="0" y="0" width="${w}" height="${bh}"/><rect x="0" y="${h - bh}" width="${w}" height="${bh}"/>`; }
    svg.innerHTML = `<g class="ln">${L.join('')}</g><g class="bar">${bars}</g>`;
  }

  restoreSize() {
    this.exporting = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(this.viewW, this.viewH, true);
    this.camera.aspect = this.viewW / this.viewH;
    this.camera.updateProjectionMatrix();
  }

  applyFly(t) {
    const f = this.fly, fy = this.state.follow ? this.carY(t) : 0;
    const d = flyForward(f.yaw, f.pitch);
    this.camera.position.set(f.pos[0], f.pos[1] + fy, f.pos[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(f.pos[0] + d[0], f.pos[1] + fy + d[1], f.pos[2] + d[2]);
    this.camera.rotateZ(f.roll * Math.PI / 180);
    this.camera.fov = mmToFov(f.mm);
    this.camera.updateProjectionMatrix();
  }

  frame(t, usePath, forExport = false) {
    const keys = this.state.camera.keys;
    const cy = this.carY(t);
    const planNow = !!this.plan && (!forExport || !!this._planExport);   // 반드시 true/false — undefined 면 layer.visible 이 안 꺼져 썸네일·내보내기에 부채꼴이 찍힘(10/13)
    if (usePath && keys.length) {
      this._lastSample = sample(keys, t);
      applyToCamera(this.camera, this._lastSample, cy, planNow ? 0 : this.state.params.handheld, t);   // 도면의 카메라 마커는 흔들지 않음
    } else this.applyFly(t);
    this.fill.intensity = 0.3 * this.state.lights.fill;
    this.renderer.toneMappingExposure = this.state.params.exposure;
    if (this.scene3.fog) this.scene3.fog.density = this.state.params.fog;
    this.world.update(this.state.params, this.state.lights, t, this.camera.position.y);
    for (const o of this.objects) {
      o.group.visible = o.visible;
      if (!(this.gizmoDrag && o === this.selObj)) { const tr = trackAt(o.keys, t, o.base); o.apply(o.follow ? { pos: [tr.pos[0], tr.pos[1] + cy, tr.pos[2]], rotY: tr.rotY, scale: tr.scale } : tr); }
      if (o._pop && !forExport && reduced()) o._pop = 0;
      if (o._pop && !forExport) {                                         // AI 가 넣은 물체는 톡 튀어나옴(0.32 s, 살짝 넘쳤다 제자리)
        const u = Math.min(1, (performance.now() - o._pop) / 320), v = u - 1;
        o.group.scale.multiplyScalar(Math.max(0.001, 1 + 2.70158 * v * v * v + 1.70158 * v * v));
        if (u >= 1) o._pop = 0;
      }
      if (o.mixer) o.mixer.setTime(o.sync ? Math.min(t, o.clipDur) : o.animT);
    }
    const showGizmo = !forExport && !!this.selObj && !this.playing && !this.selObj.locked;     // 멈춰 있으면 재생 모드에서도 기즈모로 옮기고 K(잠긴 물체는 빼고)
    this.tcHelper.visible = showGizmo;
    this.tc.enabled = showGizmo;
    if (this.outline) this.outline.visible = showGizmo;
    this.notes.frame(forExport);                                        // 메모 핀 · 고른 것 · 동선(화면에만)
    this.planV.layer.visible = planNow;
    if (this.plan || this.planV.outlineOn) {                           // 선 도면 재질은 화면에 그릴 때만(썸네일·내보내기는 원래 재질·배경·안개), 윤곽선은 늘
      if (planNow || this.planV.outlineOn) this.planV.style(this);
      this.planV.setStyled(planNow);
    }
    if (this.plan) {
      this.scene3.background.set(planNow ? PLAN_BG : (this.state.scene === 'western' ? WEST_SKY : 0x0b0b0b));
      this.scene3.fog = planNow ? null : this._fogSaved;
    }
    if (planNow) { this.planV.place(this, t, this._planAspect || this.viewW / this.viewH); this.planV.update(this, t); this.renderer.render(this.scene3, this.planV.cam); }
    else this.renderer.render(this.scene3, this.camera);
    return cy;
  }

  tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (this.exporting || !this.world) return;
    if (this._tele) {                                                       // 더블클릭 텔레포트: 0.35 초 동안 미끄러져 감
      const u = Math.min(1, (performance.now() - this._tele.t0) / 350), s = u * u * (3 - 2 * u), T = this._tele;
      for (let i = 0; i < 3; i++) this.fly.pos[i] = T.from[i] + (T.to[i] - T.from[i]) * s;
      if (u >= 1) this._tele = null;
      this.liveUpdate();
    }
    if (this.mode === 'fly') this.moveFly(dt);
    if (this.coach) this.coachCheck();
    if (this.recording) {
      this.recording.t += dt;
      this.time = this.recording.t;
      const f = this.fly, d = flyForward(f.yaw, f.pitch);
      this.recording.samples.push({ t: this.time, pos: f.pos.slice(), target: [f.pos[0] + d[0] * 2, f.pos[1] + d[1] * 2, f.pos[2] + d[2] * 2], roll: f.roll, mm: f.mm, follow: this.state.follow });
      $('recT').textContent = this.time.toFixed(1);
      if (this.time >= REC_MAX) this.toggleRecord();
    } else if (this.playing) {
      this.time += dt;
      const [a, b] = this.playSpan();
      if (this.time >= b) {
        if (this.prefs.loop && b - a > 0.05) this.time = a;                // 반복: 구간(없으면 전체) 처음으로
        else { this.time = b; this.pause(); }
      }
    }
    const cy = this.frame(this.time, this.mode === 'play');
    if (this.editing && this._thumbDue && !this.plan && performance.now() - (this._thumbAt || 0) > 300) {      // 수정 중 썸네일은 0.3 초마다 지금 화면으로(평면도에선 끝날 때)
      this._thumbAt = performance.now(); this._thumbDue = false;
      this.editing.thumb = this.thumbOf();
      const card = $('strip').children[this.state.camera.keys.indexOf(this.editing)];
      if (card && card.querySelector('img')) card.querySelector('img').src = this.editing.thumb;
    }
    this.drawTimeline();
    const keys = this.state.camera.keys, idx = this.sceneIndex();
    const hud = `${this.time.toFixed(2)} / ${this.state.duration.toFixed(1)} s` + (this.state.scene !== 'hoistway' ? '' : ` · 카 ${cy.toFixed(1)} m${this.state.follow ? ' · 타고' : ''}`) +
      ` · ${(this.mode === 'play' && this._lastSample ? this._lastSample.mm : this.fly.mm).toFixed(0)} mm · 속도 ${this.prefs.speed.toFixed(1)} m/s` +
      (this.plan ? ` · ${{ top: '평면도', front: '정면도', side: '측면도' }[this.plan]} · 격자 ${this.planV.cell} m` : '') + (this.walk ? ' · 걷기' : '') + (this.measure ? ' · 자: 점을 클릭' : '') +
      (this.selObj ? ` · 물체: ${this.selObj.name}${this.selObj.keys.length ? ` (키 ${this.selObj.keys.length})` : ''}` : '');
    if (hud !== this._hud) $('hud').textContent = this._hud = hud;                       // 바뀔 때만 DOM 에 씀
    const after = keys.findIndex((k) => k.t > this.time + 1e-3);
    const where = idx >= 0 ? `장면 ${idx + 1}` : after === 0 ? '장면 1 전' : after < 0 ? `장면 ${keys.length} 뒤` : `장면 ${after}–${after + 1} 사이`;
    const nav = keys.length ? (this.state.recorded ? `녹화 ${this.state.duration.toFixed(1)} s` : `${where} / ${keys.length}${this.editing ? ' · 수정 중' : ''}`) : '장면 없음';
    if (nav !== this._nav) $('navLabel').textContent = this._nav = nav;
    const tt = `${this.time.toFixed(2)} / ${this.state.duration.toFixed(1)} s`;
    if (tt !== this._tt) $('tTime').textContent = this._tt = tt;
    if (this._dirty && performance.now() - this.lastSave > 800) { this._dirty = false; this.saveLocal(); }
  }

  moveFly(dt) {
    const k = this.keysDown, H = (id) => this.holdDown.has(id);
    if (!this.holdDown.size) return;
    const f = this.fly;
    const turn = this.prefs.turn * Math.PI / 180 * dt;
    if (H('turn.left')) f.yaw += turn;
    if (H('turn.right')) f.yaw -= turn;
    if (H('roll.left')) f.roll = Math.max(f.roll - 40 * dt, -45);
    if (H('roll.right')) f.roll = Math.min(f.roll + 40 * dt, 45);
    const d = flyForward(f.yaw, f.pitch);
    const right = [Math.cos(f.yaw), 0, -Math.sin(f.yaw)];
    const sp = this.prefs.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1) * (k.has('ControlLeft') || k.has('ControlRight') ? 0.25 : 1) * dt;
    const mv = [0, 0, 0];
    const add = (v, s) => { mv[0] += v[0] * s; mv[1] += v[1] * s; mv[2] += v[2] * s; };
    if (H('move.forward')) add(d, sp);
    if (H('move.back')) add(d, -sp);
    if (H('move.right')) add(right, sp);
    if (H('move.left')) add(right, -sp);
    if (H('move.up')) mv[1] += sp;
    if (H('move.down')) mv[1] -= sp;
    f.pos[0] += mv[0]; f.pos[1] += mv[1]; f.pos[2] += mv[2];
    if (this.walk && this.state.scene !== 'hoistway') {                  // 걷기: 눈높이에 붙어서(위·아래 키는 눈높이 조절)
      if (H('move.up')) this.prefs.eye = Math.min(this.prefs.eye + sp, 3);
      if (H('move.down')) this.prefs.eye = Math.max(this.prefs.eye - sp, 0.3);
      f.pos[1] = this.prefs.eye;
      if (H('move.up') || H('move.down')) this.savePrefs();
    }
    if (H('roll.left') || H('roll.right')) this.syncFlyUI();
    this.liveUpdate();
  }

  setSpeed(v) {
    this.prefs.speed = Math.round(Math.min(Math.max(v, 0.1), 60) * 10) / 10;
    this.savePrefs();
    this.syncPrefsUI();
  }

  async renderPlan(w, h) {         // 지금 보기(평면·정면·측면, 3D 면 평면도)를 w×h 그림(data URL)으로 — 제목·범례를 2D 로 덧씀
    const prev = this.plan;
    if (!prev) this.setPlan('top');
    this.exporting = true; this._planExport = true; this._planAspect = w / h;
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
    this.frame(this.time, this.mode === 'play', true);
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.drawImage(this.canvas, 0, 0);
    const name = { top: '평면도', front: '정면도', side: '측면도' }[this.plan], f = Math.round(h / 40);
    g.font = `600 ${f}px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif`; g.textBaseline = 'top'; g.fillStyle = '#FFFFFF';
    g.fillText(`${this.state.name || '장면'} — ${name}`, f * 0.8, f * 0.6);
    g.font = `500 ${Math.round(f * 0.62)}px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif`; g.fillStyle = '#CCCCCC';
    g.fillText(`격자 ${this.planV.cell} m · ${this.time.toFixed(1)} s · 번호 = 장면 카메라 · 노란 부채꼴 = 카메라 범위 · 연두 띠 = 동선`, f * 0.8, f * 1.9);
    this._planExport = false; this._planAspect = null;
    this.restoreSize();
    if (!prev) this.setPlan(null);
    return c;
  }

  async renderAt(t, w, h, usePath = this.mode === 'play') {
    this.exporting = true;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame(t, usePath, true);
    return this.renderer.domElement;
  }

  thumbOf() {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 108;
    const ctx = c.getContext('2d');
    const src = this.canvas, s = Math.max(192 / src.width, 108 / src.height);
    const w = src.width * s, h = src.height * s;
    ctx.drawImage(src, (192 - w) / 2, (108 - h) / 2, w, h);
    return c.toDataURL('image/jpeg', 0.72);
  }

  async ensureThumbs() {
    const keys = this.state.camera.keys;
    if (this.state.recorded || keys.every((k) => k.thumb)) return;
    for (const k of keys) {
      if (k.thumb) continue;
      await this.renderAt(k.t, 384, 216, true);
      k.thumb = this.thumbOf();
    }
    this.restoreSize();
  }

  // ---------------------------------------------------------------- 찍기 · 녹화 · 재생 · 장면 이동
  sceneIndex() {
    const keys = this.state.camera.keys;
    if (this.selected) { const i = keys.indexOf(this.selected); if (i >= 0 && Math.abs(this.selected.t - this.time) < 1e-3) return i; }
    return keys.findIndex((k) => Math.abs(k.t - this.time) < 1e-3);
  }

  async snapshot() {               // C — 카메라 장면 하나(물체 키는 K 로 따로)
    if (this.recording) { this.status(`녹화 중에는 찍을 수 없음 — ${this.keyOf('shot.record')} 로 녹화를 끝낸 뒤`); return; }
    if (this.mode === 'play') this.stopPlay();
    this.stopEditing();
    if (this.state.recorded) {
      if (!(await this.askRecordedSwap())) return;
      this.pushHistory();
      this.state.camera.keys = []; this.state.recorded = false;
    } else this.pushHistory();
    const keys = this.state.camera.keys;
    const t = keys.length ? keys[keys.length - 1].t + (this.state.gap || 1.5) : 0;
    const k = keyFromFly(this.fly, t, this.state.follow);
    this.frame(this.time, false, true);
    k.thumb = this.thumbOf();
    keys.push(k);
    this.selected = k;
    this.recomputeTimes();
    this.time = k.t;
    this.refreshStrip();
    const last = $('strip').lastElementChild; if (last) last.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.touch();
    this.status(`${keys.length}번째 장면을 찍음 (${k.t.toFixed(1)} s)`);
    this.toast(`${keys.length}번째 장면 찍음`);
    this.flash();
  }

  // 무빙 넣기 — 지금 자리에서 시작하는 카메라 무빙 장면 2~3개(처음·끝은 멈춤 = 부드럽게). 돌리·크레인·돌기는 앞을 보는 점을 고정해 자연스럽게 틸트가 생긴다
  askRecordedSwap() {
    return ask({ title: '녹화한 무빙을 지울까요?', text: '장면 찍기로 바꾸면 녹화한 무빙은 지워집니다. Ctrl+Z 로 되돌릴 수 있습니다.', buttons: [{ label: '취소', value: null }, { label: '지우고 계속', value: 1, primary: true }] });
  }

  async addMove(kind) {            // (녹화가 없으면 기다림 없이 끝까지 돈다 — AI 의 add_camera_move 가 그 뒤에 값을 되돌림)
    if (this.recording) { this.warn(`녹화 중에는 넣을 수 없음 — ${this.keyOf('shot.record')} 로 녹화를 끝낸 뒤`); return; }
    if (this.mode === 'play') this.stopPlay();
    this.stopEditing();
    if (this.state.recorded) { if (!(await this.askRecordedSwap())) return; this.pushHistory(); this.state.camera.keys = []; this.state.recorded = false; }
    else this.pushHistory();
    const f = this.fly, dur = this.prefs.moveDur, dist = this.prefs.moveDist, fwd = flyForward(f.yaw, f.pitch);
    const hz = [-Math.sin(f.yaw), 0, -Math.cos(f.yaw)], right = [Math.cos(f.yaw), 0, -Math.sin(f.yaw)];
    const L = Math.max(3, dist * 1.5);                                            // 바라보는 점(돌리·크레인·돌기의 기준)
    const P = (a, v, s) => [a[0] + v[0] * s, a[1] + v[1] * s, a[2] + v[2] * s];
    const tgt = P(f.pos, fwd, L), here = f.pos.slice();
    let poses;                                                                    // [{pos, target, mid?}] 시작 → 끝
    if (kind === 'dollyIn') poses = [{ pos: here, target: tgt }, { pos: P(here, hz, dist), target: tgt }];
    else if (kind === 'dollyOut') poses = [{ pos: here, target: tgt }, { pos: P(here, hz, -dist), target: tgt }];
    else if (kind === 'craneUp') poses = [{ pos: here, target: tgt }, { pos: P(here, [0, 1, 0], dist), target: tgt }];
    else if (kind === 'craneDown') poses = [{ pos: here, target: tgt }, { pos: P(here, [0, 1, 0], -dist), target: tgt }];
    else if (kind === 'trackL' || kind === 'trackR') { const s = kind === 'trackL' ? -dist : dist; poses = [{ pos: here, target: tgt }, { pos: P(here, right, s), target: P(tgt, right, s) }]; }
    else if (kind === 'arcL' || kind === 'arcR') {                              // 바라보는 점 둘레로 35° — 가운데 키를 둬 호가 된다
      const ang = (kind === 'arcR' ? 1 : -1) * 35 * Math.PI / 180, dx = here[0] - tgt[0], dz = here[2] - tgt[2];
      const rot = (a) => [tgt[0] + dx * Math.cos(a) + dz * Math.sin(a), here[1], tgt[2] - dx * Math.sin(a) + dz * Math.cos(a)];
      poses = [{ pos: here, target: tgt }, { pos: rot(ang / 2), target: tgt, mid: true }, { pos: rot(ang), target: tgt }];
    } else if (kind === 'dollyZoom') {                                            // 밀고 들어가며 렌즈를 넓혀 피사체 크기는 그대로(현기증 효과)
      const d = Math.min(dist, L * 0.6);
      poses = [{ pos: here, target: tgt }, { pos: P(here, hz, d), target: tgt, mm: f.mm * (L - d) / L }];
    } else {                                                                      // 틸트: 자리는 그대로, 고개만 20°
      const d2 = flyForward(f.yaw, Math.min(Math.max(f.pitch + (kind === 'tiltUp' ? 1 : -1) * 20 * Math.PI / 180, -1.5), 1.5));
      poses = [{ pos: here, target: P(here, fwd, 2) }, { pos: here, target: P(here, d2, 2) }];
    }
    const r4 = (v) => Math.round(v * 10000) / 10000, keys = this.state.camera.keys;
    const t0 = keys.length ? keys[keys.length - 1].t + (this.state.gap || 1.5) : 0, n = poses.length;
    const made = poses.map((p, i) => ({ t: Math.round((t0 + dur * i / (n - 1)) * 1000) / 1000, pos: p.pos.map(r4), target: p.target.map(r4), roll: f.roll, mm: p.mm !== undefined ? Math.round(p.mm * 10) / 10 : f.mm, follow: !!this.state.follow, hold: !p.mid }));
    for (const k of made) { this.fly = flyFromKey(k); this.frame(k.t, false, true); k.thumb = this.thumbOf(); }
    this.fly = flyFromKey(made[n - 1]);                                           // 무빙 끝에 서 있게 — 다음 무빙은 여기서 이어진다
    keys.push(...made);
    this.selected = made[n - 1];
    this.recomputeTimes();
    this.time = this.selected.t;
    this.syncFlyUI(); this.refreshStrip(); this.touch();
    const last = $('strip').lastElementChild; if (last) last.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.toast(`${MOVES[kind]} ${dur} 초 넣음 (장면 ${keys.length - n + 1}~${keys.length})`);
    this.flash();
  }

  setTotal(v) {                    // 전체 길이 — 장면·물체 키 시각을 비례로 늘리고 줄임(끝에 머무는 시간은 그대로)
    const keys = this.state.camera.keys;
    let last = keys.length ? keys[keys.length - 1].t : 0;
    for (const o of this.objects) if (o.keys.length) last = Math.max(last, o.keys[o.keys.length - 1].t);
    if (last < 1e-6) { this.warn('장면이 둘 이상 있어야 길이를 바꿀 수 있음'); return; }
    const s = Math.max(v - this.state.tail, 0.5) / last;
    this.pushHistory();
    for (const k of keys) k.t = Math.round(k.t * s * 1000) / 1000;
    for (const o of this.objects) for (const k of o.keys) k.t = Math.round(k.t * s * 1000) / 1000;
    this.recomputeTimes(); this.time = Math.min(this.time, this.state.duration); this.refreshStrip(); this.touch();
    this.toast(`전체 ${this.state.duration.toFixed(1)} 초`);
  }

  flash() {                         // 찍었음 — 테두리가 바로 켜지고(누름에 바로 답) 천천히 꺼짐
    const v = $('viewport');
    v.style.transition = 'none'; v.style.boxShadow = 'inset 0 0 0 4px #FF6820';
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { v.style.transition = 'box-shadow 200ms ease-out'; v.style.boxShadow = ''; }, 120);
  }

  retake(k) {
    if (this.mode === 'play') this.stopPlay();
    this.pushHistory();
    const nk = keyFromFly(this.fly, k.t, this.state.follow);
    Object.assign(k, { pos: nk.pos, target: nk.target, mm: nk.mm, roll: nk.roll, follow: nk.follow });
    this.selected = k;
    this.time = k.t;
    this.frame(this.time, false, true);
    k.thumb = this.thumbOf();
    this.refreshStrip();
    this.touch();
    this.toast('장면을 다시 찍음');
    this.flash();
  }

  goto(k) {                        // 카드를 누름 = 그 장면으로 가서 '수정 중' — 움직이면 바로 그 장면에 반영
    if (!k) return;
    if (this.notes.agent) { this.seek(k.t); this.selected = k; this.notes.selectShot(k); this.refreshStrip(); return; }   // 에이전트 모드: 보기 + 고르기(수정 안 함)
    if (this.mode === 'play') this.stopPlay();
    this.stopEditing();
    this.selected = k;
    this.selKey = null;
    this.time = k.t;
    const f = flyFromKey(k);
    if (!!k.follow !== !!this.state.follow) { const cy = this.carY(k.t); f.pos[1] += k.follow ? cy : -cy; }
    this.fly = f;
    this.syncFlyUI();
    this.editing = k; this._editPushed = false;
    $('editBadge').innerHTML = `장면 ${this.state.camera.keys.indexOf(k) + 1} 수정 중 — 움직이면 바로 반영 · <kbd>Esc</kbd> 끝`;
    $('editBadge').style.display = 'flex';
    this.refreshStrip();
    const d = $('strip').querySelector('.card.on');
    if (d) d.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  stopEditing() {                  // 수정 끝 — 마지막 그림을 썸네일로
    const k = this.editing;
    if (!k) return;
    this.editing = null;
    $('editBadge').style.display = 'none';
    if (this.state.camera.keys.includes(k) && this._thumbDue) { if (this.plan) this.frame(k.t, false, true); k.thumb = this.thumbOf(); this._thumbDue = false; }
    this.refreshStrip();
  }

  liveUpdate() {                   // 수정 중인 장면에 지금 시점을 씀(값이 바뀌었을 때만)
    const k = this.editing;
    if (!k || this.mode !== 'fly' || Math.abs(this.time - k.t) > 1e-3) return;
    const nk = keyFromFly(this.fly, k.t, this.state.follow);
    if (nk.pos.join() === k.pos.join() && nk.target.join() === k.target.join() && nk.mm === k.mm && nk.roll === k.roll) return;
    if (!this._editPushed) { this.pushHistory(); this._editPushed = true; }
    Object.assign(k, { pos: nk.pos, target: nk.target, mm: nk.mm, roll: nk.roll, follow: nk.follow });
    this._thumbDue = true;
    this.touch();
  }

  step(dir) {                      // ← → ↑ ↓ 장면 와리가리
    const keys = this.state.camera.keys;
    if (!keys.length) return;
    if (this.state.recorded) { this.stepFrame(dir * this.state.fps); return; }
    let i = this.sceneIndex();
    if (i < 0) { i = keys.findIndex((k) => k.t > this.time); if (i < 0) i = keys.length; i += dir > 0 ? 0 : -1; }
    else i += dir;
    i = Math.min(Math.max(i, 0), keys.length - 1);
    this.goto(keys[i]);
  }

  stepFrame(n) {                   // , . 한 프레임 — 무빙 위에서 멈춘 채로
    if (!this.hasMotion()) return;
    this.seek(this.time + n / this.state.fps);
  }

  hasMotion() { return this.state.camera.keys.length > 0 || this.objects.some((o) => o.keys.length > 0); }

  seek(t) {                        // 재생 머리만 옮김 — 멈춘 채 그 시각의 무빙(카메라 장면이 있으면 그 카메라로)
    if (this.recording) return;
    this.stopEditing();
    if (this.playing) this.pause();
    this.mode = this.state.camera.keys.length ? 'play' : 'fly';
    this.time = Math.min(Math.max(t, 0), this.state.duration);
  }

  playSpan() {                     // 재생할 구간 [시작, 끝] — 인·아웃을 잡았으면 그 구간
    const r = this.state.range, D = this.state.duration;
    return r ? [Math.min(r.in, D), Math.min(r.out, D)] : [0, D];
  }

  timeStart() { const r = this.state.range; this.seek(r && this.time > r.in + 1e-3 ? r.in : 0); }        // Home: 구간 처음 → 한 번 더 = 맨 처음
  timeEnd() { const r = this.state.range; this.seek(r && this.time < r.out - 1e-3 ? r.out : this.state.duration); }

  setRange(which) {                // 'in' | 'out' = 지금 시각, null = 지우기
    const D = this.state.duration, t = Math.round(this.time * 1000) / 1000;
    if (!which) { if (!this.state.range) return; this.state.range = null; this.toast('구간 지움 — 전체를 재생'); }
    else {
      const r = this.state.range ? { ...this.state.range } : { in: 0, out: D };
      if (which === 'in') { r.in = t; if (r.out <= t + 0.05) r.out = D; } else { r.out = t; if (r.in >= t - 0.05) r.in = 0; }
      if (r.out - r.in < 0.05) { this.warn('구간이 너무 짧음 — 재생 머리를 옮긴 뒤 다시'); return; }
      this.state.range = r;
      this.toast(`구간 ${r.in.toFixed(2)} – ${r.out.toFixed(2)} s`);
    }
    this.syncRangeUI(); this.touch();
  }

  syncRangeUI() {
    const r = this.state.range;
    $('rText').textContent = r ? `${r.in.toFixed(2)} – ${r.out.toFixed(2)} s` : '전체';
    $('rClear').disabled = !r;
    $('exRangeNote').textContent = r ? `구간 ${r.in.toFixed(1)}–${r.out.toFixed(1)} s` : '무빙 전체';
  }

  toggleSnap() { this.prefs.snap = !this.prefs.snap; this.savePrefs(); this.syncTransportUI(); this.toast(this.prefs.snap ? '자석 켬 — 끌면 키·구간·재생 머리에 붙음 (Ctrl 누르고 끌면 잠깐 끔)' : '자석 끔'); }
  toggleLoop() { this.prefs.loop = !this.prefs.loop; this.savePrefs(); this.syncTransportUI(); this.toast(this.prefs.loop ? '반복 재생' : '반복 끔'); }

  syncTransportUI() {
    for (const [id, on] of [['snapBtn', this.prefs.snap], ['loopBtn', this.prefs.loop]]) { const b = $(id); b.setAttribute('aria-pressed', String(!!on)); }
  }

  remove(k) {
    this.pushHistory();
    this.state.camera.keys = this.state.camera.keys.filter((x) => x !== k);
    if (this.selected === k) this.selected = null;
    if (this.editing === k) { this.editing = null; $('editBadge').style.display = 'none'; }
    if (!this.state.camera.keys.length) this.state.recorded = false;
    this.recomputeTimes();
    this.time = Math.min(this.time, this.state.duration);
    this.refreshStrip();
    this.touch();
  }

  shiftFrom(k, delta) {            // 이 장면과 뒤 장면들의 시각을 delta 만큼 밀기(앞 장면과의 간격은 MIN_GAP 이상)
    const keys = this.state.camera.keys, i = keys.indexOf(k);
    if (i <= 0) return;
    delta = Math.max(delta, keys[i - 1].t + MIN_GAP - k.t);
    for (let j = i; j < keys.length; j++) keys[j].t = Math.round((keys[j].t + delta) * 1000) / 1000;
  }

  keyOf(id) { const k = this.keymap.keys(id)[0]; return k ? keyLabel(k) : ''; }

  async toggleRecord() {
    if (this.recording) {
      const keys = resampleRecording(this.recording.samples);
      this.recording = null;
      $('recBadge').style.display = 'none';
      $('btnRec').classList.remove('on');
      $('btnRec').innerHTML = `${icon('record', 20)}녹화 — 날아다닌 그대로 <span class="key">${esc(this.keyOf('shot.record'))}</span>`;
      if (keys.length < 3) { this.time = 0; this.recomputeTimes(); this.refreshStrip(); this.status('녹화가 너무 짧음 — V 를 누르고 2초 넘게 날아다닌 뒤 다시 V'); return; }
      this.state.camera.keys = keys;
      this.state.recorded = true;
      this.selected = null;
      this.recomputeTimes();
      this.frame(0, true, true);
      keys[0].thumb = this.thumbOf();
      this.time = 0;
      this.refreshStrip();
      this.touch();
      this.toast(`${keys[keys.length - 1].t.toFixed(1)} 초 녹화됨`);
      this.status(`${keys[keys.length - 1].t.toFixed(1)} 초 녹화됨 — ${this.keyOf('play.toggle')} 로 재생`);
      return;
    }
    if (this.mode === 'play') this.stopPlay();
    if (this.state.camera.keys.length && !(await ask({ title: '새로 녹화할까요?', text: '지금 있는 카메라 장면을 지우고 날아다니는 그대로 녹화합니다. Ctrl+Z 로 되돌릴 수 있습니다.', buttons: [{ label: '취소', value: null }, { label: '지우고 녹화', value: 1, primary: true }] }))) return;
    this.editing = null; $('editBadge').style.display = 'none';
    this.pushHistory();
    this.state.camera.keys = [];
    this.state.recorded = false;
    this.time = 0;
    this.recording = { t: 0, samples: [] };
    $('recBadge').innerHTML = `${icon('record', 16)}녹화 중 <span id="recT">0.0</span> s — <kbd>${esc(this.keyOf('shot.record'))}</kbd> 로 끝`;
    $('recBadge').style.display = 'flex';
    $('btnRec').classList.add('on');
    $('btnRec').innerHTML = `${icon('stop', 20)}녹화 끝 <span class="key">${esc(this.keyOf('shot.record'))}</span>`;
    this.refreshStrip();
    this.status(`녹화 중 — 날아다니세요. ${this.keyOf('shot.record')} 로 끝`);
  }

  play() {
    if (this.recording) return;
    if (!this.hasMotion()) { this.warn(`재생할 움직임이 없음 — ${this.keyOf('shot.take')} 로 장면을 찍거나 ${this.keyOf('shot.record')} 로 녹화, 물체는 ${this.keyOf('obj.key')} 로 키`); return; }
    const [a, b] = this.playSpan(), end = this.state.range ? b : Math.max(this.state.duration - this.state.tail, 0);
    if (this.time < a - 1e-3 || this.time >= end - 1e-3) this.time = a;
    this.stopEditing();
    this.mode = this.state.camera.keys.length ? 'play' : 'fly';          // 카메라 장면이 없으면 물체만 움직이고 시점은 그대로(날아다닐 수 있음)
    this.playing = true;
    $('playBadge').innerHTML = `${icon('play', 14)}재생 중${this.state.range ? ' (구간)' : ''}${this.prefs.loop ? ' · 반복' : ''} — <kbd>${esc(this.keyOf('play.toggle'))}</kbd> 멈춤`;
    $('playBadge').style.display = 'flex';
    $('btnPlay').innerHTML = `${icon('pause', 16)}일시정지`;
  }

  pause() {
    this.playing = false;
    $('playBadge').style.display = 'none';
    $('btnPlay').innerHTML = `${icon('play', 16)}재생`;
  }

  stopPlay() {
    this.pause();
    if (this.mode === 'play' && this._lastSample && this.state.camera.keys.length) {
      const s = this._lastSample, f = flyFromKey(s);
      const cy = this.carY(this.time);
      f.pos[1] += s.follow * cy - (this.state.follow ? cy : 0);
      this.fly = f;
      this.syncFlyUI();
    }
    this.mode = 'fly';
  }

  togglePlay() {
    if (this.playing) this.pause(); else this.play();
  }

  playFromStart() {
    if (this.recording) return;
    this.time = this.playSpan()[0];
    this.play();
  }

  goSpot(s) {
    if (this.mode === 'play') this.stopPlay();
    const off = this.state.follow ? 0 : this.carY(this.time);
    this.fly = flyFromKey({ pos: [s.pos[0], s.pos[1] + off, s.pos[2]], target: [s.look[0], s.look[1] + off, s.look[2]], roll: 0, mm: s.mm });
    this.syncFlyUI();
  }

  // 보기: 고른 물체(없으면 카·바닥 가운데) 둘레에서 앞·옆·위 — 블렌더 숫자패드 1·3·7
  focusInfo() {
    const fy = this.state.follow ? this.carY(this.time) : 0;
    if (this.selObj) {
      const bb = new THREE.Box3().setFromObject(this.selObj.group);
      const c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
      return { c: [c.x, c.y - fy, c.z], r: Math.max(s.x, s.y, s.z, 0.5) * 1.6 };
    }
    if (this.state.scene !== 'hoistway') return { c: [0, 1, 0], r: this.state.scene === 'western' ? 12 : 6 };
    return { c: [0, 1.5 + (this.state.follow ? 0 : this.carY(this.time)), 0], r: 5 };
  }

  setView(kind, opposite) {
    if (this.mode === 'play') this.stopPlay();
    const { c, r } = this.focusInfo();
    const f = this.fly;
    if (kind === 'focus') {
      const d = flyForward(f.yaw, f.pitch);
      f.pos = [c[0] - d[0] * r, c[1] - d[1] * r, c[2] - d[2] * r];
    } else if (kind === 'front') { f.yaw = opposite ? Math.PI : 0; f.pitch = 0; f.pos = [c[0], c[1], c[2] + (opposite ? -r : r)]; }
    else if (kind === 'right') { f.yaw = opposite ? -Math.PI / 2 : Math.PI / 2; f.pitch = 0; f.pos = [c[0] + (opposite ? -r : r), c[1], c[2]]; }
    else if (kind === 'top') { f.yaw = 0; f.pitch = opposite ? 1.55 : -1.55; f.pos = [c[0], c[1] + (opposite ? -r : r), c[2] + 0.001]; }
    f.roll = 0;
    this.syncFlyUI();
    this.status({ front: opposite ? '뒤에서' : '앞에서', right: opposite ? '왼쪽에서' : '오른쪽에서', top: opposite ? '아래에서' : '위에서', focus: '고른 것으로' }[kind] + ' 보기');
  }

  setFollow(on) {
    if (on === !!this.state.follow) return;
    this.pushHistory();
    const conv = (y, t) => y + (on ? -this.carY(t) : this.carY(t));
    this.fly.pos[1] = conv(this.fly.pos[1], this.time);
    for (const k of this.state.camera.keys) {
      if (!!k.follow === on) continue;
      k.pos[1] = conv(k.pos[1], k.t); k.target[1] = conv(k.target[1], k.t); k.follow = on;
    }
    this.state.follow = on;
    this.touch();
  }

  // ---------------------------------------------------------------- 물체
  addPrimitive(kind, saved) {
    const n = this.objects.filter((o) => o.kind === kind).length + 1;
    const obj = new SceneObject({ id: saved && saved.id, kind, name: (saved && saved.name) || `${KINDS[kind]} ${n}`, root: primitiveMesh(kind), size: new THREE.Vector3(1, 1, 1),
      base: saved && saved.base && cloneTr(saved.base), keys: (saved && saved.keys) || [],
      follow: saved ? !!saved.follow : (this.state.scene === 'hoistway' && !!this.state.follow) });   // 카를 타고 찍는 중이면 새 물체도 카를 탄다
    if (saved) { obj.visible = saved.visible !== false; obj.locked = !!saved.locked; obj.subject = !!saved.subject; }
    if (!saved) {
      const d = flyForward(this.fly.yaw, this.fly.pitch), fy = this.state.follow ? this.carY(this.time) : 0, cy = this.carY(this.time);
      let px = this.fly.pos[0] + d[0] * 2.5, pz = this.fly.pos[2] + d[2] * 2.5;
      let y = this.fly.pos[1] + fy + d[1] * 2.5 - 0.5;                                   // 바닥 기준 높이(2.5 m 앞, 눈높이보다 조금 아래)
      if (this.state.scene !== 'hoistway') y = 0;                                             // 야외·스튜디오: 바닥에
      else {                                                                             // 승강로: 카 위에서 넣으면 지붕(2.45)에, 카 안에서 넣으면 카 바닥에 — 카 속·카 뒤 틈에 숨지 않게
        const camRel = this.fly.pos[1] + fy - cy, yRel = y - cy, clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
        const nearCar = Math.abs(px) < 1.2 && pz > -1.3 && pz < 0.9;
        const camIn = camRel >= 0 && camRel < 2.45 && Math.abs(this.fly.pos[0]) < 0.8 && this.fly.pos[2] > -0.85 && this.fly.pos[2] < 0.52;   // 카메라가 카 안
        if (camIn) { y = cy; px = clamp(px, -0.5, 0.5); pz = clamp(pz, -0.6, 0.3); }
        else if (nearCar && camRel >= 2.45 && yRel < 2.45) { y = cy + 2.45; px = clamp(px, -0.55, 0.55); pz = clamp(pz, -0.6, 0.3); }
        else { y = Math.max(y, -1.2); px = clamp(px, -1.0, 1.0); pz = clamp(pz, -1.15, 1.4); }         // 승강로 벽 밖으로는 안 나감
      }
      if (obj.follow) y -= cy;
      obj.base = { pos: [r2(px), r2(y), r2(pz)], rotY: 0, scale: [1, 1, 1] };
      obj.apply(obj.base);
      this.pushHistory();                           // 넣기 전 상태를 기록해야 되돌리기가 '넣기 전'으로 감
    }
    this.scene3.add(obj.group);
    this.objects.push(obj);
    this.refreshObjList();
    if (!saved) { this.selectObj(obj); this.toast(`${obj.name} 넣음`); this.status(`${obj.name} 넣음 — 화살표를 끌어 옮기고, 움직이게 하려면 자리마다 ${this.keyOf('obj.key')} 로 키를 찍으세요`); this.touch(); }
    return obj;
  }

  async loadModel(src, saved) {
    this.status(`모델 불러오는 중… ${src instanceof File ? src.name : src.split('/').pop()}`);
    const gltf = await new Promise((res, rej) => {
      if (src instanceof File) { const url = URL.createObjectURL(src); this.loader.load(url, (g) => { URL.revokeObjectURL(url); res(g); }, undefined, rej); }
      else this.loader.load(src, res, undefined, rej);
    });
    const root = gltf.scene;
    root.traverse((o) => { if (o.isMesh) o.material = this.greyMat; });
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    let mixer = null, clipDur = 0, clip = null;
    if (gltf.animations && gltf.animations.length) { clip = gltf.animations[0]; clipDur = clip.duration; }
    const merged = mergeStaticParts(root, clip, this.greyMat);
    if (clip) { mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play(); mixer.setTime(0); }
    const obj = new SceneObject({ id: saved && saved.id, kind: 'glb', name: (saved && saved.name) || (src instanceof File ? src.name : src.split('/').pop()).replace(/\.glb$/i, ''),
      src: src instanceof File ? src.name : src, root, size, base: saved && saved.base && cloneTr(saved.base), keys: (saved && saved.keys) || [], mixer, clipDur, follow: !!(saved && saved.follow) });
    obj.clip = clip;
    if (saved) { obj.visible = saved.visible !== false; obj.animT = saved.animT || 0; obj.sync = saved.sync !== false; obj.locked = !!saved.locked; obj.subject = !!saved.subject; }
    else if (this.state.scene !== 'hoistway') { obj.base = { pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] }; obj.apply(obj.base); }
    if (!saved) this.pushHistory();
    this.scene3.add(obj.group);
    this.objects.push(obj);
    this.refreshObjList();
    if (!saved) { this.selectObj(obj); this.touch(); }
    this.status(`${obj.name} — 크기 ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} m${mixer ? ` · 애니메이션 ${clipDur.toFixed(1)} s` : ''} · 부품 ${merged.before}→${merged.after}`);
    return obj;
  }

  async restoreObjects(list) {     // 저장본·되돌리기: 있는 것은 고치고, 없는 것은 만들고, 남는 것은 뺀다
    const keep = new Set();
    for (const s of list) {
      let o = this.objects.find((x) => x.id === s.id);
      if (!o) {
        try {
          if (s.kind && s.kind !== 'glb') o = this.addPrimitive(s.kind, s);
          else if (s.src && s.src.startsWith('assets/')) o = await this.loadModel(s.src, s);
          else continue;
        } catch (e) { console.warn(e); continue; }
      } else {
        o.base = cloneTr(s.base); o.visible = s.visible !== false; o.name = s.name || o.name; o.group.name = o.name;
        o.keys = (s.keys || []).map((k) => ({ t: k.t, ...cloneTr(k) }));
        o.follow = !!s.follow; o.locked = !!s.locked; o.subject = !!s.subject;
        o.animT = s.animT || 0; o.sync = s.sync !== false; o.apply(o.base);
      }
      keep.add(o.id);
    }
    for (const o of this.objects.slice()) if (!keep.has(o.id)) { if (this.selObj === o) this.selectObj(null); this.scene3.remove(o.group); this.objects = this.objects.filter((x) => x !== o); }
    this.refreshObjList();
    if (this.selObj) this.showObj();
  }

  duplicateObj(o) {
    if (!o) return;
    this.pushHistory();
    const tr = this.objTr(o);
    const base = { pos: [tr.pos[0] + 0.5, tr.pos[1], tr.pos[2] + 0.5], rotY: tr.rotY, scale: tr.scale.slice() };
    const keys = o.keys.map((k) => ({ t: k.t, pos: [k.pos[0] + 0.5, k.pos[1], k.pos[2] + 0.5], rotY: k.rotY, scale: k.scale.slice() }));
    let n;
    if (o.kind !== 'glb') {
      n = new SceneObject({ kind: o.kind, name: `${o.name} 복제`, root: primitiveMesh(o.kind), size: new THREE.Vector3(1, 1, 1), base, keys, follow: o.follow });
    } else {
      const root = o.root.clone(true);
      let mixer = null;
      if (o.clip) { mixer = new THREE.AnimationMixer(root); mixer.clipAction(o.clip).play(); mixer.setTime(0); }
      n = new SceneObject({ kind: 'glb', name: `${o.name} 복제`, src: o.src, root, size: o.size, base, keys, mixer, clipDur: o.clipDur, follow: o.follow });
      n.clip = o.clip;
    }
    this.scene3.add(n.group);
    this.objects.push(n);
    this.refreshObjList();
    this.selectObj(n);
    this.touch();
    this.toast(`${o.name} 복제`);
  }

  // Ctrl+C / V / X — 물체를 골랐으면 물체, 아니면 고른 장면 카드
  copySel() {
    if (this.selObj) { this.clipboard = { type: 'obj', data: this.selObj.toJSON() }; this.toast(`${this.selObj.name} 복사`); }
    else if (this.selected && !this.state.recorded) { this.clipboard = { type: 'scene', data: JSON.parse(JSON.stringify(this.selected)) }; this.toast(`장면 ${this.state.camera.keys.indexOf(this.selected) + 1} 복사`); }
    else this.warn('복사할 것을 먼저 고르세요 — 물체를 클릭하거나 아래 장면 카드를 누르기');
  }

  async pasteClip() {
    const c = this.clipboard;
    if (!c) { this.warn('복사한 것이 없음 — Ctrl+C 로 먼저 복사'); return; }
    if (c.type === 'scene') {
      this.pushHistory();
      const keys = this.state.camera.keys, gap = this.state.gap || 1.5;
      const at = this.selected ? keys.indexOf(this.selected) + 1 : keys.length;
      const k = JSON.parse(JSON.stringify(c.data));
      k.t = at ? keys[at - 1].t + gap : 0;
      for (let j = at; j < keys.length; j++) keys[j].t = Math.round((keys[j].t + gap) * 1000) / 1000;
      keys.splice(at, 0, k);
      this.recomputeTimes();
      this.goto(k);
      this.touch();
      this.toast(`장면 ${at + 1} 에 붙여넣음`);
      return;
    }
    const d = c.data, live = this.objects.find((o) => o.id === d.id);
    if (live) { this.duplicateObj(live); return; }                                     // 원본이 있으면 복제와 같다
    const spec = { ...d, id: undefined, name: `${d.name} 복제`, base: { ...d.base, pos: [d.base.pos[0] + 0.5, d.base.pos[1], d.base.pos[2] + 0.5] } };
    this.pushHistory();
    const o = d.kind !== 'glb' ? this.addPrimitive(d.kind, spec) : await this.loadModel(d.src, spec).catch((e) => { this.warn(`붙여넣지 못했음: ${e.message}`); return null; });
    if (!o) return;
    this.selectObj(o);
    this.touch();
    this.toast(`${o.name} 붙여넣음`);
  }

  cutSel() {
    if (this.selObj) { this.copySel(); this.deleteObj(this.selObj, true); }
    else if (this.selected && !this.state.recorded) { this.copySel(); this.remove(this.selected); this.toast('장면 잘라냄'); }
    else this.warn('잘라낼 것을 먼저 고르세요');
  }

  // Delete — 고른 키 > 고른 물체 > 고른 장면 카드 (Ctrl+Z 로 되돌릴 수 있으니 묻지 않음)
  deleteSel() {
    if (this.selKey) {
      const { obj, key } = this.selKey;
      this.pushHistory();
      removeKeyAt(obj.keys, key.t);
      this.selKey = null;
      this.recomputeTimes(); this.showObj(); this.refreshStrip(); this.touch();
      this.toast(`${obj.name} 키 지움 (${key.t.toFixed(1)} s)`);
      return;
    }
    if (this.selObj) { this.deleteObj(this.selObj, true); return; }
    const k = this.editing || this.selected;
    if (k && !this.state.recorded) { const i = this.state.camera.keys.indexOf(k); this.remove(k); this.toast(`장면 ${i + 1} 지움 — Ctrl+Z 로 되돌림`); return; }
    this.warn('지울 것을 먼저 고르세요 — 물체를 클릭하거나, 장면 카드나 타임라인의 키를 누르기');
  }

  addObjKey() {                    // K — 고른 물체의 지금 자리를 지금 시각의 키로
    const o = this.selObj;
    if (!o) { this.warn('키를 찍을 물체를 먼저 클릭해 고르세요'); return; }
    if (this.mode === 'play') this.stopPlay();
    this.pushHistory();
    const k = setKey(o.keys, this.time, this.objTr(o));
    this.selKey = { obj: o, key: k };
    this.recomputeTimes(); this.showObj(); this.refreshStrip(); this.touch();
    this.toast(`${o.name} 키 (${this.time.toFixed(1)} s) · 키 ${o.keys.length}개`);
    this.flash();
  }

  async clearObjKeys(o) {
    if (!o || !o.keys.length) return;
    if (!(await ask({ title: `「${o.name}」 의 키 ${o.keys.length}개를 전부 지울까요?`, text: '물체는 지금 자리에 멈춥니다. Ctrl+Z 로 되돌릴 수 있습니다.', buttons: [{ label: '취소', value: null }, { label: '전부 지우기', value: 1, danger: true }] }))) return;
    this.pushHistory();
    o.base = this.objTr(o);
    o.keys = [];
    this.selKey = null;
    this.recomputeTimes(); this.showObj(); this.refreshStrip(); this.touch();
  }

  selectObj(obj) {
    this.selObj = obj;
    if (this.selKey && this.selKey.obj !== obj) this.selKey = null;
    if (this.outline) { this.outline.removeFromParent(); this.outline = null; }
    if (obj) {
      this.tc.attach(obj.group); this.tc.enabled = true;
      const g = obj.group, p = g.position.clone(), r = g.rotation.clone(), s = g.scale.clone();   // 자기 좌표계의 상자를 한 번만 잰다(큰 GLB 도 매 프레임 안 돎)
      g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.set(1, 1, 1); g.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(g);
      g.position.copy(p); g.rotation.copy(r); g.scale.copy(s); g.updateMatrixWorld(true);
      this.outline = new THREE.Box3Helper(bb, 0xff6820);
      g.add(this.outline);
    } else { this.tc.detach(); this.tc.enabled = false; }
    $('objPanel').style.display = obj ? '' : 'none';
    this.refreshObjList();
    this.sizeTimeline();
    if (obj) {                                                   // 고른 물체의 타임라인 줄이 보이게 스크롤
      this.showObj();
      const wrap = $('tlWrap'), y = 16 + 22 * (1 + this.objects.indexOf(obj));
      if (y < wrap.scrollTop || y + 22 > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = Math.max(0, y - wrap.clientHeight / 2 + 11);
    }
  }

  pickObject(x, y) {
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.plan ? this.planV.cam : this.camera);
    const hits = this.raycaster.intersectObjects(this.objects.filter((o) => o.visible && !o.locked).map((o) => o.group), true);
    for (const h of hits) {
      let g = h.object;
      while (g && !g.userData.obj) g = g.parent;
      if (g) return g.userData.obj;
    }
    return null;
  }

  objTr(o) {                       // 물체의 지금 자리(저장 좌표) — 카를 타는 물체는 카 높이를 뺀 값
    const tr = o.read();
    if (o.follow) tr.pos[1] = Math.round((tr.pos[1] - this.carY(this.time)) * 1000) / 1000;
    return tr;
  }

  // 물체를 움직인 뒤: 키가 있는 물체면 지금 시각에 키를 찍고(자동 키), 없으면 기본 자리
  commitObject(obj, how) {
    const tr = this.objTr(obj);
    if (obj.keys.length) { const k = setKey(obj.keys, this.time, tr); this.selKey = { obj, key: k }; this.status(`${obj.name} 키 ${this.time.toFixed(1)} s 에 기억 (${how}) · 키 ${obj.keys.length}개`); }
    else obj.base = cloneTr(tr);
    this.recomputeTimes();
    this.showObj();
    this.touch();
  }

  showObj() {
    const o = this.selObj;
    if (!o) return;
    $('objName').value = o.name;
    for (const s of this.objSteppers) s();
    $('objKeyN').textContent = o.keys.length ? `${o.keys.length}개 (${o.keys.map((k) => k.t.toFixed(1)).join(', ')} s)` : `없음 — 자리마다 ${this.keyOf('obj.key')}`;
    $('objKeyClear').disabled = !o.keys.length;
    $('objVis').checked = !!o.visible;
    $('objLock').checked = !!o.locked;
    $('objSubject').checked = !!o.subject;
    $('objFollow').checked = !!o.follow;
    $('objAnimRow').style.display = o.mixer ? '' : 'none';
    if (o.mixer) { $('objSync').checked = !!o.sync; $('objAnimT').max = o.clipDur.toFixed(2); $('objAnimT').value = o.animT; $('objAnimT').disabled = !!o.sync; }
  }

  refreshObjList() { keepFocus($('objList'), () => this.drawObjList()); }

  drawObjList() {
    const box = $('objList');
    box.innerHTML = '';
    const picked = this.notes.agent ? (this.notes.sel && this.notes.sel.id) : (this.selObj && this.selObj.id);
    this.objects.forEach((o) => {
      const b = document.createElement('button');
      b.title = o.name;
      b.innerHTML = `${o.subject ? '<span class="subj">피사체</span>' : ''}<span class="nm">${esc(o.name)}</span>${o.locked ? `<span class="lk" title="잠김">${icon('lock', 13)}</span>` : ''}<small>${[o.keys.length ? `키 ${o.keys.length}` : '', o.visible ? '' : '숨김'].filter(Boolean).join(' · ')}</small>`;
      b.className = o.id === picked ? 'on' : '';
      b.onclick = () => {
        if (this.notes.agent) { this.notes.select(this.notes.sel && this.notes.sel.id === o.id ? null : this.notes.objTarget(o)); return; }
        this.selectObj(o === this.selObj ? null : o);
      };
      box.appendChild(b);
    });
    this.sizeTimeline();
  }

  async deleteObj(o, silent) {
    if (!o) return;
    if (!silent && !(await ask({ title: `「${o.name}」 을(를) 지울까요?`, text: 'Ctrl+Z 로 되돌릴 수 있습니다.', buttons: [{ label: '취소', value: null }, { label: '지우기', value: 1, danger: true }] }))) return;
    this.pushHistory();
    this.scene3.remove(o.group);
    this.objects = this.objects.filter((x) => x !== o);
    if (this.selObj === o) this.selectObj(null);
    this.recomputeTimes();
    this.refreshObjList();
    this.touch();
    this.toast(`${o.name} 지움 — Ctrl+Z 로 되돌림`);
  }

  // ---------------------------------------------------------------- 장면 카드(아래 띠)
  refreshStrip() { keepFocus($('strip'), () => this.drawStrip()); }

  drawStrip() {
    const box = $('strip');
    const keys = this.state.camera.keys, agent = this.notes.agent;
    const ed = (fn) => (e) => { if (e) e.stopPropagation(); if (agent) { this.agentBlock(); return; } fn(); };   // 카드에서 고치는 버튼 — 에이전트 모드에선 안내만
    box.innerHTML = '';
    $('stripInfo').textContent = keys.length ? `${keys.length}장 · 전체 ${this.state.duration.toFixed(1)} 초` : '';
    if (this.showTotal) this.showTotal();
    if (!keys.length) {
      const d = document.createElement('div');
      d.className = 'card empty';
      d.textContent = this.recording ? '녹화 중…' : `아직 찍은 장면이 없습니다 — 날아다니다 ${this.keyOf('shot.take')} 로 찍거나, ${this.keyOf('shot.record')} 로 녹화하세요.`;
      box.appendChild(d);
      return;
    }
    if (this.state.recorded) {
      const d = document.createElement('div');
      d.className = 'card recorded on';
      d.innerHTML = `<div class="rec"><img src="${imgSrc(keys[0].thumb)}" alt=""><div><b>녹화된 무빙</b><br><span class="dim">${keys[keys.length - 1].t.toFixed(1)} 초 · 키 ${keys.length}개</span></div></div>
        <div class="cbtn"><button data-act="play">${icon('play', 14)} 재생</button><button data-act="rerec">다시 녹화</button><button data-act="clear">지우기</button></div>`;
      d.querySelector('[data-act=play]').onclick = () => this.play();
      d.querySelector('[data-act=rerec]').onclick = ed(() => this.toggleRecord());
      d.querySelector('[data-act=clear]').onclick = ed(async () => {
        if (!(await ask({ title: '녹화한 무빙을 지울까요?', text: 'Ctrl+Z 로 되돌릴 수 있습니다.', buttons: [{ label: '취소', value: null }, { label: '지우기', value: 1, danger: true }] }))) return;
        this.pushHistory(); this.state.camera.keys = []; this.state.recorded = false; this.recomputeTimes(); this.refreshStrip(); this.touch();
      });
      box.appendChild(d);
      return;
    }
    const pins = new Map();                                       // 장면 번호 → 열린 수정 메모 번호(카드 왼쪽 위 보라 표)
    for (const n of this.state.notes || []) if (n.status !== 'done' && n.target && n.target.type === 'shot') pins.set(n.target.shot, [...(pins.get(n.target.shot) || []), n.n]);
    const picked = agent && this.notes.sel && this.notes.sel.type === 'shot' ? this.notes.sel.shot : 0;
    keys.forEach((k, i) => {
      const d = document.createElement('div');
      d.className = 'card' + ((agent ? picked === i + 1 : k === this.selected) ? ' on' : '') + (k === this.editing ? ' editing' : '');
      d.draggable = !agent;
      const gap = i ? Math.round((k.t - keys[i - 1].t) * 100) / 100 : 0, pin = pins.get(i + 1);
      d.innerHTML = `<img src="${imgSrc(k.thumb)}" alt="">${k === this.editing ? '<span class="tag">수정 중</span>' : pin ? `<span class="pin" title="수정 메모 ${pin.join(', ')}">${pin.join(' · ')}</span>` : ''}<button class="noteBtn ${k.note ? 'on' : ''}" data-act="note" title="장면 메모 (샷 리스트에 나감)" aria-label="장면 메모">${icon('note', 14)}</button>${k.note ? `<span class="note" title="${esc(k.note)}">${esc(k.note)}</span>` : ''}
        <div class="ct"><span>#${i + 1} <b>${k.t.toFixed(1)} s</b></span><span class="dim">${k.mm.toFixed(0)} mm</span></div>
        <div class="gap">${i === 0 ? '<span>시작 장면</span>' : `<span title="앞 장면에서 몇 초 뒤">앞에서</span><div class="stp"><button data-d="-1" aria-label="줄이기">−</button><span class="v">${gap} 초</span><button data-d="1" aria-label="늘리기">+</button></div>`}</div>
        <div class="cbtn"><button data-act="retake" title="지금 보는 시점으로 바꾼다">다시 찍기</button><button data-act="hold" class="${k.hold ? 'on' : ''}" title="이 장면에서 잠깐 멈췄다 간다">멈춤</button>${i ? `<button data-act="cut" class="${k.cut ? 'on' : ''}" title="앞 장면에서 미끄러지지 않고 이 장면으로 바로 바뀜(컷)">컷</button>` : ''}<button data-act="del" class="x" title="장면 지우기" aria-label="장면 지우기">${icon('close', 14)}</button></div>`;
      d.onclick = (e) => { if (e.target.closest('button') || e.target.closest('.stp')) return; this.goto(k); };
      d.querySelector('[data-act=retake]').onclick = ed(() => this.retake(k));
      d.querySelector('[data-act=note]').onclick = ed(async () => {
        const s = await askText({ title: `장면 ${i + 1} 메모`, label: '샷 리스트에 같이 나갑니다 (비우면 지움)', value: k.note || '', ok: '저장', placeholder: '예: 보안관 얼굴로 천천히', allowEmpty: true });
        if (s === null) return;
        this.pushHistory(); k.note = s.trim(); this.refreshStrip(); this.touch();
      });
      d.querySelector('[data-act=hold]').onclick = ed(() => { this.pushHistory(); k.hold = !k.hold; this.refreshStrip(); this.touch(); });
      const cb = d.querySelector('[data-act=cut]'); if (cb) cb.onclick = ed(() => { this.pushHistory(); k.cut = !k.cut; this.refreshStrip(); this.touch(); this.toast(k.cut ? `장면 ${i + 1}: 컷으로 바뀜` : `장면 ${i + 1}: 미끄러져 감`); });
      d.querySelector('[data-act=del]').onclick = ed(() => { this.remove(k); this.toast(`장면 ${i + 1} 지움 — Ctrl+Z 로 되돌림`); });
      const st = d.querySelector('.stp');
      if (st) stepper(st, { get: () => Math.round((k.t - keys[i - 1].t) * 100) / 100, set: (v) => { if (agent) { this.agentBlock(); return; } this.pushHistory(); this.shiftFrom(k, v - (k.t - keys[i - 1].t)); if (this.editing === k || this.selected === k) this.time = k.t; this.recomputeTimes(); this.refreshStrip(); this.touch(); }, step: 0.5, min: MIN_GAP, max: 60, fmt: (v) => `${v} 초` });
      d.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(i)); d.classList.add('drag'); };
      d.ondragend = () => d.classList.remove('drag');
      d.ondragover = (e) => e.preventDefault();
      d.ondrop = (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(from) || from === i) return;
        this.pushHistory();
        const arr = this.state.camera.keys, times = arr.map((x) => x.t), [m] = arr.splice(from, 1);
        arr.splice(i, 0, m);
        arr.forEach((x, j) => { x.t = times[j]; });                 // 시각 자리는 그대로, 카드만 자리를 바꿈
        this.recomputeTimes(); this.refreshStrip(); this.touch();
      };
      box.appendChild(d);
    });
  }

  // ---------------------------------------------------------------- 트랙 타임라인 — 위쪽 눈금(구간 인·아웃) + 카메라 줄 + 물체 줄, 마름모를 끌어 시각 옮기기(자석)
  tlRows() {
    const rows = [{ type: 'cam', label: '카메라', keys: this.state.camera.keys }];
    for (const o of this.objects) rows.push({ type: 'obj', label: o.name, keys: o.keys, obj: o });
    return rows;
  }

  sizeTimeline() {
    const c = $('tl'), dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(c.clientWidth, 100), h = 16 + 22 * (1 + this.objects.length);
    this._tlW = w; this._tlH = h; this._tlDpr = dpr;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = `${h}px`;
  }

  tlX(t) { const W = this._tlW || 100; return 96 + (W - 106) * (t / Math.max(this.state.duration, 0.01)); }
  tlT(x) { const W = this._tlW || 100; return Math.min(Math.max((x - 96) / (W - 106), 0), 1) * this.state.duration; }

  // 자석 — 가까운(8 px 안) 키 · 구간 끝 · 처음 · 끝(· 재생 머리)에 붙는다. Ctrl 을 누르고 끌면 잠깐 반대로(켜져 있으면 끔)
  snapT(t, { except = null, playhead = false, invert = false } = {}) {
    this._snapLine = null;
    if (!!this.prefs.snap === !!invert) return t;
    const W = this._tlW || 100, tol = 8 * Math.max(this.state.duration, 0.01) / Math.max(W - 106, 1);
    let best = t, bd = tol;
    const test = (v) => { const d = Math.abs(v - t); if (d < bd) { bd = d; best = v; } };
    test(0); test(this.state.duration);
    if (!this.state.recorded) for (const k of this.state.camera.keys) if (k !== except) test(k.t);
    for (const o of this.objects) for (const k of o.keys) if (k !== except) test(k.t);
    const r = this.state.range; if (r) { test(r.in); test(r.out); }
    if (playhead) test(this.time);
    if (best !== t) this._snapLine = best;
    return best;
  }

  drawTimeline() {
    const c = $('tl'), ctx = c.getContext('2d'), W = this._tlW || c.width, H = this._tlH || c.height, D = Math.max(this.state.duration, 0.01);
    const rows = this.tlRows(), agent = this.notes.agent, nsel = this.notes.sel;
    ctx.setTransform(this._tlDpr || 1, 0, 0, this._tlDpr || 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = "500 11px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif"; ctx.textBaseline = 'middle';
    const step = D > 20 ? 5 : D > 8 ? 2 : D > 3 ? 1 : 0.5;
    for (let t = 0; t <= D + 1e-6; t += step) { const x = this.tlX(t); ctx.strokeStyle = '#2E2E33'; ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, H); ctx.stroke(); ctx.fillStyle = '#8C8C8C'; ctx.textAlign = 'center'; ctx.fillText(`${t}s`, x, 7); }
    const r = this.state.range;
    if (r) {                                                                     // 구간: 밖은 어둡게, 눈금 위에 띠와 양 끝 손잡이
      const x0 = this.tlX(Math.min(r.in, D)), x1 = this.tlX(Math.min(r.out, D)), col = agent ? '138,56,245' : '255,104,32';
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(96, 14, Math.max(0, x0 - 96), H); ctx.fillRect(x1, 14, Math.max(0, W - 10 - x1), H);
      ctx.fillStyle = `rgba(${col},0.30)`; ctx.fillRect(x0, 0, x1 - x0, 14);
      ctx.fillStyle = `rgb(${col})`; ctx.fillRect(x0 - 1, 0, 3, 14); ctx.fillRect(x1 - 2, 0, 3, 14);
    }
    rows.forEach((row, i) => {
      const y = 16 + 22 * i + 11;
      const on = row.type === 'obj' && (agent ? !!(nsel && nsel.id === row.obj.id) : row.obj === this.selObj);
      if (on) { ctx.fillStyle = agent ? 'rgba(138,56,245,0.14)' : 'rgba(255,104,32,0.10)'; ctx.fillRect(0, y - 11, W, 22); }
      let lx = 6;
      if (row.type === 'obj' && row.obj.subject) { ctx.fillStyle = '#8A38F5'; ctx.beginPath(); ctx.arc(10, y, 3.5, 0, Math.PI * 2); ctx.fill(); lx = 18; }   // 피사체 = 보라 점
      ctx.fillStyle = on ? (agent ? '#BB94FF' : '#FF8A52') : (row.type === 'cam' ? '#EBEBEB' : '#CCCCCC'); ctx.textAlign = 'left';
      let lab = row.label;                                                     // 이름 칸(86 px)에 맞춰 자름 — 피사체 점이 있으면 그만큼 덜
      if (ctx.measureText(lab).width > 92 - lx) { while (lab.length > 1 && ctx.measureText(`${lab}…`).width > 92 - lx) lab = lab.slice(0, -1); lab += '…'; }
      ctx.fillText(lab, lx, y);
      ctx.strokeStyle = '#2A2A2E'; ctx.beginPath(); ctx.moveTo(96, y + 11); ctx.lineTo(W - 10, y + 11); ctx.stroke();
      if (row.type === 'cam' && this.state.recorded && row.keys.length) { ctx.fillStyle = '#68BACB'; ctx.fillRect(this.tlX(0), y - 4, this.tlX(row.keys[row.keys.length - 1].t) - this.tlX(0), 8); return; }
      row.keys.forEach((k, j) => {
        const x = this.tlX(k.t);
        const sel = row.type === 'cam' ? (agent ? !!(nsel && nsel.type === 'shot' && nsel.shot === j + 1) : (k === this.editing || k === this.selected)) : (!agent && this.selKey && this.selKey.key === k);
        ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y); ctx.closePath();
        ctx.fillStyle = sel ? (agent ? '#8A38F5' : '#FF6820') : (row.type === 'cam' ? (k.hold ? '#E89225' : '#CCCCCC') : '#68BACB'); ctx.fill();
        if (row.type === 'cam' && k.cut) { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 1, y - 10, 2, 20); }   // 컷 = 세로 막대
        if (sel) { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1; }
      });
    });
    if (this._snapLine != null) {                                                // 자석에 붙은 자리 = 흰 점선
      const x = this.tlX(this._snapLine); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
    }
    const x = this.tlX(this.time), col = this.recording ? '#F96960' : '#FF6820';
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, H); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill();
  }

  tlHit(x, y) {
    const rows = this.tlRows(), i = Math.floor((y - 16) / 22);
    if (i < 0 || i >= rows.length) return null;
    const r = rows[i];
    if (r.type === 'cam' && this.state.recorded) return { row: r };
    let best = null, bd = 9;
    for (const k of r.keys) { const d = Math.abs(this.tlX(k.t) - x); if (d < bd) { bd = d; best = k; } }
    return { row: r, key: best };
  }

  bindTimeline() {
    const c = $('tl'), RULER = 15;
    let drag = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const nearRange = (x) => {
      const r = this.state.range, D = this.state.duration;
      if (!r) return null;
      if (Math.abs(this.tlX(Math.min(r.in, D)) - x) < 7) return 'in';
      if (Math.abs(this.tlX(Math.min(r.out, D)) - x) < 7) return 'out';
      return null;
    };
    c.addEventListener('pointerdown', (e) => {
      if (this.recording || e.button !== 0) return;
      const [x, y] = pos(e), agent = this.notes.agent;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트는 포인터가 없음 */ }
      if (y < RULER && x >= 90) {                                                // 위쪽 눈금: 구간 손잡이 끌기 · 끌어서 새 구간 · 그냥 누르면 그 시각으로
        const h = nearRange(x);
        drag = h ? { range: h } : { range: 'new', x0: x, t0: this.tlT(x), moved: false };
        return;
      }
      const h = this.tlHit(x, y);
      if (h && h.key) {
        if (h.row.type === 'cam') this.goto(h.key);
        else if (agent) { this.seek(h.key.t); this.notes.select(this.notes.objTarget(h.row.obj)); }
        else { if (this.mode === 'play') this.stopPlay(); if (this.selObj !== h.row.obj) this.selectObj(h.row.obj); this.selKey = { obj: h.row.obj, key: h.key }; this.time = h.key.t; this.showObj(); this.showTab('objects'); }
        if (!agent) drag = { row: h.row, key: h.key, x0: x, t0: h.key.t, moved: false };
        return;
      }
      if (h && h.row.type === 'obj' && x < 96) {
        if (agent) this.notes.select(this.notes.sel && this.notes.sel.id === h.row.obj.id ? null : this.notes.objTarget(h.row.obj));
        else { this.selectObj(this.selObj === h.row.obj ? null : h.row.obj); if (this.selObj) this.showTab('objects'); }
        return;
      }
      this.seek(this.snapT(this.tlT(x), { invert: e.ctrlKey }));
      drag = { scrub: true };
    });
    c.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (!drag) { c.style.cursor = y < RULER ? (nearRange(x) ? 'ew-resize' : 'text') : 'pointer'; return; }
      if (drag.scrub) { this.time = this.snapT(this.tlT(x), { invert: e.ctrlKey }); return; }
      if (drag.range) {
        const t = Math.round(this.snapT(this.tlT(x), { invert: e.ctrlKey, playhead: true }) * 1000) / 1000;
        if (drag.range === 'new') {
          if (!drag.moved && Math.abs(x - drag.x0) < 4) return;
          if (!drag.moved) { drag.moved = true; drag.ts = Math.round(this.snapT(drag.t0, { invert: e.ctrlKey, playhead: true }) * 1000) / 1000; }
          const a = Math.min(drag.ts, t), b = Math.max(drag.ts, t);
          this.state.range = b - a >= 0.05 ? { in: a, out: b } : null;
        } else if (this.state.range) {
          const r = this.state.range;
          if (drag.range === 'in') r.in = Math.min(t, r.out - 0.05); else r.out = Math.max(t, r.in + 0.05);
        }
        this.syncRangeUI();
        return;
      }
      if (!drag.moved) { if (Math.abs(x - drag.x0) < 3) return; drag.moved = true; this.pushHistory(); }
      const raw = this.tlT(x), snapped = this.snapT(raw, { except: drag.key, invert: e.ctrlKey });
      let t = snapped !== raw ? snapped : Math.round(raw * this.state.fps) / this.state.fps;     // 붙을 데가 없으면 프레임 단위
      const keys = drag.row.keys, i = keys.indexOf(drag.key);
      if (drag.row.type === 'cam') { if (i > 0) t = Math.max(t, keys[i - 1].t + MIN_GAP); if (i < keys.length - 1) t = Math.min(t, keys[i + 1].t - MIN_GAP); if (i === 0) t = 0; }
      else { if (keys.some((k, j) => j !== i && Math.abs(k.t - t) < 1e-3)) return; }
      drag.key.t = Math.round(t * 1000) / 1000;
      this.time = drag.key.t;
    });
    const end = (e) => {
      if (!drag) return;
      if (drag.range) {
        if (drag.range === 'new' && !drag.moved) this.seek(this.snapT(this.tlT(pos(e)[0]), { invert: e.ctrlKey }));
        else if (this.state.range) {
          const r = this.state.range;
          this.touch();
          this.toast(`구간 ${r.in.toFixed(2)} – ${r.out.toFixed(2)} s — 재생 · MP4 가 이 구간만`);
          if (this.notes.agent) this.notes.selectRange();
        }
      } else if (drag.key && drag.moved) {
        if (drag.row.type === 'obj') drag.row.keys.sort((a, b) => a.t - b.t);
        this.recomputeTimes(); this.refreshStrip(); this.showObj(); this.touch();
        this.toast(`${drag.row.type === 'cam' ? '장면' : drag.row.label + ' 키'} → ${drag.key.t.toFixed(2)} s`);
      }
      drag = null; this._snapLine = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- 내보내기
  async doExport(kind, opts = {}) {           // opts.throwErrors: AI(MCP)가 부를 때 — 경고창 대신 오류를 돌려줌
    if (this.busy || this.exporting || this.recording) return;
    this.busy = true;                                // 내보내는 동안 단축키·AI 명령이 무빙을 바꾸지 않게(Esc = 중단)
    const height = parseInt(this.exRes, 10);
    const [w, h] = exportSize(this.state.aspect, height);
    const base = `블록아웃_${(this.state.name || '장면').replace(/[\\/:*?"<>|]/g, '_')}_${stamp()}`;
    const ov = $('overlay');
    const wasPlaying = this.playing; if (this.playing) this.pause();
    try {
      if (kind === 'png') {
        await exportPNG(this, this.time, w, h, `${base}_${this.time.toFixed(2)}s.png`);
        this.toast(`PNG 저장 ${w}×${h}`); this.status(`PNG 저장 ${w}×${h} — 다운로드 폴더`);
      } else if (kind === 'sheet') {
        if (!this.state.camera.keys.length) throw new Error('찍은 장면이 없음');
        const n = Math.max(2, Math.min(24, parseInt($('exSheetN').value, 10) || 8));
        const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * this.state.duration);
        await exportSheet(this, times, Math.min(w, 1280), Math.round(Math.min(w, 1280) * h / w), 4, `${base}_장면시트.png`);
        this.toast('장면 시트 저장'); this.status(`장면 시트 ${n}장 저장 — 다운로드 폴더`);
      } else if (kind === 'plan') {
        const c = await this.renderPlan(w, h);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        download(blob, `${base}_도면.png`);
        this.toast('도면 PNG 저장'); this.status(`도면 PNG 저장 ${w}×${h} — 다운로드 폴더`);
      } else if (kind === 'shots') {
        if (!this.state.camera.keys.length) throw new Error('찍은 장면이 없음');
        const c = await this.renderPlan(1600, 900);
        const n = exportShotList(this, c.toDataURL('image/jpeg', 0.82), base);
        this.toast('샷 리스트 저장'); this.status(`샷 리스트 ${n}장 — HTML(브라우저에서 열어 인쇄 → PDF)과 CSV, 다운로드 폴더`);
      } else if (kind === 'glb') {
        this.selectObj(null); this.planV.setStyled(false); this.exporting = true;
        this.status('블렌더용 .glb 만드는 중…');
        const r = await exportGLB(this, `${base}.glb`);
        this.toast('.glb 저장'); this.status(`.glb 저장 ${(r.bytes / 1048576).toFixed(1)} MB · 카메라 ${r.frames}프레임 · 움직이는 물체 ${r.objects} — 블렌더: 파일 › 가져오기 › glTF 2.0`);
      } else if (kind === 'mp4') {
        if (!canEncodeMp4()) throw new Error('이 브라우저는 MP4 저장(WebCodecs)을 지원하지 않음 — Edge/Chrome 최신판으로');
        if (!this.hasMotion()) throw new Error(`움직임이 없음 — ${this.keyOf('shot.take')} 로 장면을 찍거나 ${this.keyOf('shot.record')} 로 녹화한 뒤`);
        this.stop = false;
        const [a, b] = this.playSpan(), part = !!this.state.range, dur = Math.max(b - a, 1 / this.state.fps);
        ov.style.display = 'flex'; $('ovStop').focus();
        $('ovText').textContent = `MP4 ${w}×${h} · ${this.state.fps} fps · ${dur.toFixed(1)} s${part ? ` · 구간 ${a.toFixed(1)}–${b.toFixed(1)} s` : ''}`;
        await exportMP4(this, { start: a, duration: dur, fps: this.state.fps, w, h, name: `${base}${part ? `_${a.toFixed(1)}-${b.toFixed(1)}s` : ''}.mp4`,
          onProgress: (r) => { $('ovBar').style.width = `${(r * 100).toFixed(1)}%`; $('ovPct').textContent = `${Math.round(r * 100)}%`; },
          shouldStop: () => this.stop });
        this.toast(this.stop ? 'MP4 중단' : 'MP4 저장'); this.status(this.stop ? 'MP4 중단' : `MP4 저장 ${w}×${h} — 다운로드 폴더`);
      }
    } catch (e) {
      console.error(e);
      this.status(`저장 실패: ${e.message}`);
      if (opts.throwErrors) throw e;
      ask({ title: '저장하지 못했습니다', text: e.message, buttons: [{ label: '닫기', value: null, primary: true }] });
    } finally {
      this.busy = false;
      ov.style.display = 'none';
      this.restoreSize();
      if (wasPlaying) this.play();
    }
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    // 위 막대 · 상태줄 · 버튼 — data-action 은 동작 목록(actions.js)을 그대로 부름(툴팁의 단축키도 거기서)
    document.querySelectorAll('[data-action]').forEach((b) => { const a = this.actions[b.dataset.action]; if (a && a.run) b.addEventListener('click', () => a.run()); });
    $('projName').onclick = () => this.projects.rename();
    $('modeSwitch').querySelectorAll('button').forEach((b) => { b.onclick = () => this.notes.setAgent(b.dataset.mode === 'agent'); });
    const tabs = [...$('tabs').querySelectorAll('button')];
    tabs.forEach((b, i) => {
      b.onclick = () => this.showTab(b.dataset.tab);
      b.onkeydown = (e) => {                                                   // ← → 로 탭 사이(WAI-ARIA 탭)
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); this.showTab(n.dataset.tab);
      };
    });
    $('fileScene').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await this.projects.importFile(f); };
    $('helpClose').addEventListener('click', () => localStorage.setItem(LS_TUT, '1'));
    $('helpCoach').onclick = () => { closeModal('help'); localStorage.setItem(LS_TUT, '1'); this.coachStart(); };
    $('keysEdit').onclick = () => { closeModal('keysModal'); this.prefsUI.open('keys'); };
    $('coachSkip').onclick = () => this.coachEnd();
    this.setEasy(this.prefs.easy !== false);
    setInterval(() => { fetch('/ping', { cache: 'no-store' }).catch(() => {}); }, 2500);   // exe 실행기: 창이 살아 있다는 신호(없는 서버면 무시)
    document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && e.detail && !b.closest('.modal')) b.blur(); });   // 마우스로 누른 버튼이 포커스를 쥐면 Space/Enter 가 버튼을 또 누른다(창 안은 그대로 — 키보드 초점 가둠)
    this.syncUndoUI();

    // 세트 탭
    $('follow').onchange = () => this.setFollow($('follow').checked);
    this.segCar = seg($('carMove'), (v) => { this.pushHistory(); Object.assign(this.state.params, CAR_MOVE[v]); this.touch(); });
    this.segDoor = seg($('doorBtns'), (v) => { this.pushHistory(); this.state.params.doorOpen = parseFloat(v); this.state.params.carDoorOpen = parseFloat(v); this.touch(); });
    this.segCut = seg($('cutBtns'), (v) => { this.state.params.cut = v; this.touch(); });
    const P = () => this.state.params, L = () => this.state.lights;
    const rows = [                                 // [칸, 이름, 키, 대상, 최소, 최대, 단계, 다시 짓기, 세트]
      ['rowsScene', '층 수', 'floors', P, 3, 60, 1, true, 'hoistway'],
      ['rowsScene', '층고 (m)', 'floorH', P, 2.6, 4.5, 0.05, true, 'hoistway'],
      ['rowsScene', '카 멈춤 높이 (멈춤일 때, m)', 'carHold', P, 0, 120, 0.5, false, 'hoistway'],
      ['rowsScene', '카 출발 시각 (s)', 'carStart', P, 0, 10, 0.1, false, 'hoistway'],
      ['rowsScene', '가속 시간 (s)', 'carRamp', P, 0.2, 5, 0.1, false, 'hoistway'],
      ['rowsScene', '해 높이 (°)', 'sunEl', P, 4, 85, 1, false, 'western'],
      ['rowsScene', '해 방향 (°)', 'sunAz', P, 0, 360, 5, false, 'western'],
      ['rowsScene', '햇빛 세기', 'sunI', P, 0, 5, 0.1, false, 'western'],
      ['rowsScene', '하늘빛 세기', 'skyI', P, 0, 3, 0.05, false, 'western'],
      ['rowsScene', '핸드헬드 흔들림 (°, 0 = 고정)', 'handheld', P, 0, 2, 0.05, false, 'all'],
      ['rowsScene', '안개(깊이감)', 'fog', P, 0, 0.03, 0.001, false, 'all'],
      ['rowsScene', '노출', 'exposure', P, 0.3, 3, 0.05, false, 'all'],
      ['rowsLight', '코브 LED 세기', 'coveI', L, 0, 3, 0.05, false, 'hoistway'],
      ['rowsLight', '문틈 빛 세기', 'leakI', L, 0, 3, 0.05, false, 'hoistway'],
      ['rowsLight', '카 지붕 작업등 세기', 'carLampI', L, 0, 3, 0.05, false, 'hoistway'],
      ['rowsLight', '꼭대기 빛 세기', 'topI', L, 0, 3, 0.05, false, 'hoistway'],
      ['rowsLight', '카메라 보조광', 'fill', L, 0, 3, 0.05, false, 'all'],
    ];
    this.sliders = [];
    for (const [pane, label, key, getObj, min, max, step, rebuild, set] of rows) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"><output></output>`;
      const inp = row.querySelector('input'), out = row.querySelector('output');
      inp.oninput = () => { const v = parseFloat(inp.value); getObj()[key] = v; out.textContent = v; if (rebuild) this.buildWorld(); this.touch(); };
      $(pane).appendChild(row);
      this.sliders.push({ inp, out, key, getObj, row, set });
    }
    for (const [id, key] of [['lCove', 'cove'], ['lLeak', 'leak'], ['lCarLamp', 'carLamp'], ['lTop', 'top']]) $(id).onchange = () => { this.state.lights[key] = $(id).checked; this.touch(); };

    // 카메라 탭
    $('moveBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => this.actions[`move.${b.dataset.m}`].run(); });
    this.showMoveDur = stepper($('moveDurStp'), { get: () => this.prefs.moveDur, set: (v) => { this.prefs.moveDur = Math.round(v * 2) / 2; this.savePrefs(); }, step: 0.5, min: 0.5, max: 30, fmt: (v) => `${v} 초` });
    this.showMoveDist = stepper($('moveDistStp'), { get: () => this.prefs.moveDist, set: (v) => { this.prefs.moveDist = Math.round(v * 2) / 2; this.savePrefs(); }, step: 0.5, min: 0.5, max: 40, fmt: (v) => `${v} m` });
    this.showGap = stepper($('gapStp'), { get: () => this.state.gap || 1.5, set: (v) => { this.state.gap = Math.round(v * 10) / 10; this.touch(); }, step: 0.5, min: MIN_GAP, max: 60, fmt: (v) => `${v} 초` });
    const spd = $('speedBtns');
    this.segSpeed = seg(spd, (v) => this.setSpeed(parseFloat(v)));
    spd.querySelectorAll('button[data-d]').forEach((b) => { b.onclick = () => this.setSpeed(this.prefs.speed * (b.dataset.d === '1' ? 1.25 : 0.8)); });
    const lens = $('lensBtns');
    lens.querySelectorAll('button[data-v]').forEach((b) => { b.onclick = () => { this.fly.mm = parseFloat(b.dataset.v); this.syncFlyUI(); }; });
    lens.querySelectorAll('button[data-d]').forEach((b) => { b.onclick = () => this.nudgeLens(b.dataset.d === '1' ? 1 : -1); });
    const roll = $('rollBtns');
    roll.querySelectorAll('button').forEach((b) => { b.onclick = () => { this.fly.roll = b.dataset.v !== undefined ? 0 : Math.min(Math.max(this.fly.roll + 5 * parseFloat(b.dataset.d), -45), 45); this.syncFlyUI(); }; });
    $('viewBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => this.setView(b.dataset.view, false); });
    $('walkMode').onchange = () => this.toggleWalk($('walkMode').checked);
    this.segGuide = seg($('guideBtns'), (v) => { this.prefs.guide = v; this.savePrefs(); this.layoutGuides(); });
    $('letterbox').onchange = () => { this.prefs.letterbox = $('letterbox').checked; this.savePrefs(); this.layoutGuides(); };
    $('lookBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => this.toggleLook(b.dataset.v); });

    // 물체 탭
    const add = (k) => (this.notes.agent ? this.agentBlock() : this.addPrimitive(k));
    $('addBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => add(b.dataset.k); });
    $('propBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => add(b.dataset.k); });
    $('btnModelFile').onclick = () => this.actions['file.importModel'].run();
    $('fileModel').onchange = (e) => { const f = e.target.files[0]; if (f) this.loadModel(f).catch((err) => this.warn(`모델을 못 열었음: ${err.message}`)); e.target.value = ''; };
    $('objName').onchange = () => { if (this.selObj) { this.selObj.name = $('objName').value || this.selObj.name; this.selObj.group.name = this.selObj.name; this.refreshObjList(); this.touch(); } };
    $('objDel').onclick = () => this.deleteObj(this.selObj);
    $('objDup').onclick = () => this.duplicateObj(this.selObj);
    $('objSizeBtns').querySelectorAll('button').forEach((b) => { b.onclick = () => { const o = this.selObj; if (!o) return; this.pushHistory(); o.group.scale.setScalar(parseFloat(b.dataset.s)); this.commitObject(o, '크기'); }; });
    $('objKeyAdd').onclick = () => this.actions['obj.key'].run();
    $('objKeyDel').onclick = () => { const o = this.selObj; if (!o) return; const k = o.keys.find((x) => Math.abs(x.t - this.time) < 1e-3); if (k) { this.selKey = { obj: o, key: k }; this.deleteSel(); } else this.status(`지금 시각(${this.time.toFixed(1)} s)에는 ${o.name} 의 키가 없음 — 타임라인의 마름모를 누른 뒤 Delete`); };
    $('objKeyClear').onclick = () => this.clearObjKeys(this.selObj);
    $('gizmoMode').querySelectorAll('button').forEach((b) => { b.onclick = () => this.setGizmoMode(b.dataset.m); });
    const F = {
      px: { get: () => this.selObj.read().pos[0], set: (v) => { this.selObj.group.position.x = v; }, step: 0.1, fmt: (v) => `${v.toFixed(2)} m` },
      py: { get: () => this.selObj.read().pos[1], set: (v) => { this.selObj.group.position.y = v; }, step: 0.1, fmt: (v) => `${v.toFixed(2)} m` },
      pz: { get: () => this.selObj.read().pos[2], set: (v) => { this.selObj.group.position.z = v; }, step: 0.1, fmt: (v) => `${v.toFixed(2)} m` },
      ry: { get: () => this.selObj.read().rotY, set: (v) => { this.selObj.group.rotation.y = v * Math.PI / 180; }, step: 15, fmt: (v) => `${Math.round(v)}°` },
      sx: { get: () => this.selObj.read().scale[0] * this.selObj.unit[0], set: (v) => { const o = this.selObj, s = v / o.unit[0]; if (o.kind === 'glb') o.group.scale.setScalar(s); else o.group.scale.x = s; }, step: 0.1, min: 0.05, fmt: (v) => `${v.toFixed(2)} m` },   // 치수는 m 로(배율 × 단위 크기)
      sy: { get: () => this.selObj.read().scale[1] * this.selObj.unit[1], set: (v) => { const o = this.selObj, s = v / o.unit[1]; if (o.kind === 'glb') o.group.scale.setScalar(s); else o.group.scale.y = s; }, step: 0.1, min: 0.05, fmt: (v) => `${v.toFixed(2)} m` },
      sz: { get: () => this.selObj.read().scale[2] * this.selObj.unit[2], set: (v) => { const o = this.selObj, s = v / o.unit[2]; if (o.kind === 'glb') o.group.scale.setScalar(s); else o.group.scale.z = s; }, step: 0.1, min: 0.05, fmt: (v) => `${v.toFixed(2)} m` },
    };
    this.objSteppers = [];
    $('objPanel').querySelectorAll('.stp[data-f]').forEach((el) => {
      const f = F[el.dataset.f];
      this.objSteppers.push(stepper(el, { get: () => (this.selObj ? f.get() : 0), set: (v) => { if (!this.selObj) return; this.pushHistory(); f.set(v); this.commitObject(this.selObj, '숫자'); }, step: f.step, min: f.min, fmt: f.fmt }));
    });
    $('objVis').onchange = () => { if (this.selObj) { this.selObj.visible = $('objVis').checked; this.refreshObjList(); this.touch(); } };
    $('objLock').onchange = () => { if (this.selObj) { this.selObj.locked = $('objLock').checked; this.refreshObjList(); this.touch(); this.status(this.selObj.locked ? `${this.selObj.name} 잠금 — 목록에서 골라 풀 수 있음` : `${this.selObj.name} 잠금 해제`); } };
    $('objSubject').onchange = () => {
      const o = this.selObj; if (!o) return;
      o.subject = $('objSubject').checked; this.refreshObjList(); this.touch();
      this.toast(o.subject ? `「${o.name}」 = 피사체 — AI 도 이 물체를 주인공으로 봅니다` : `「${o.name}」 피사체 해제`);
    };
    $('objFollow').onchange = () => {                 // 켜고 끌 때 지금 자리는 그대로(좌표만 카 기준 <-> 바닥 기준)
      const o = this.selObj; if (!o) return;
      this.pushHistory();
      const on = $('objFollow').checked, conv = (y, t) => Math.round((y + (on ? -this.carY(t) : this.carY(t))) * 1000) / 1000;
      o.base.pos[1] = conv(o.base.pos[1], this.time);
      for (const k of o.keys) k.pos[1] = conv(k.pos[1], k.t);
      o.follow = on;
      this.touch();
    };
    $('objSync').onchange = () => { if (this.selObj) { this.selObj.sync = $('objSync').checked; $('objAnimT').disabled = this.selObj.sync; this.touch(); } };
    $('objAnimT').oninput = () => { if (this.selObj) { this.selObj.animT = parseFloat($('objAnimT').value); this.touch(); } };

    // 메모 탭(에이전트 모드)
    $('noteAdd').onclick = () => this.addNoteFromUI();
    $('noteText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.addNoteFromUI(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); }
    });
    $('selClear').onclick = () => this.notes.select(null);
    $('selSubject').onclick = () => this.notes.toggleSubject();
    $('selRange').onclick = () => this.notes.selectRange();
    $('noteFilter').querySelectorAll('button').forEach((b) => { b.onclick = () => { this.notes.filter = b.dataset.f; $('noteFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); this.notes.render(); }; });

    // 보기 · 내보내기
    $('viewMode').querySelectorAll('button').forEach((b) => { b.onclick = () => this.setPlan(b.dataset.v || null); });
    $('navPrev').onclick = () => this.step(-1);
    $('navNext').onclick = () => this.step(1);
    this.segAspect = seg($('aspectBtns'), (v) => { this.state.aspect = v; this.fitViewport(); this.touch(); });
    this.exRes = '1080';
    seg($('resBtns'), (v) => { this.exRes = v; });
    this.showTotal = stepper($('totalStp'), { get: () => Math.round(this.state.duration * 10) / 10, set: (v) => this.setTotal(v), step: 1, min: 1, max: 600, fmt: (v) => `${v} 초` });
    this.showTail = stepper($('tailStp'), { get: () => this.state.tail, set: (v) => { this.state.tail = v; this.recomputeTimes(); this.refreshStrip(); this.touch(); }, step: 0.5, min: 0, max: 30, fmt: (v) => `${v} 초` });
    $('tFps').onchange = () => { this.state.fps = parseInt($('tFps').value, 10); $('tFps').blur(); this.touch(); };
    $('exPng').onclick = () => this.doExport('png');
    $('exMp4').onclick = () => this.doExport('mp4');
    $('exSheet').onclick = () => this.doExport('sheet');
    $('exGlb').onclick = () => this.doExport('glb');
    $('exPlan').onclick = () => this.doExport('plan');
    $('exShots').onclick = () => this.doExport('shots');
    $('ovStop').onclick = () => { this.stop = true; };
    if (!canEncodeMp4()) $('exMp4').disabled = true;
    $('agentAI').onclick = () => openAI(this, this.ai);
    this.syncPrefsUI();
    this.refreshKeyHints();
    this.syncAIUI();
    this.showTab(this.prefs.tab || 'camera');
  }

  // ---------------------------------------------------------------- 패널 탭 · 단축키 표 · 안내 · 에이전트
  showTab(name) {
    if (!$('tabs').querySelector(`[data-tab="${name}"]`)) name = 'camera';
    this.activeTab = name;
    $('tabs').querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll('section.tab').forEach((s) => { s.hidden = s.dataset.tab !== name; });
    if (this.prefs.tab !== name) { this.prefs.tab = name; this.savePrefs(); }
    this.notes.drawPins();                                   // 메모 탭에선 완료한 메모 핀도 보임
  }

  showKeys() { this.renderKeys(); openModal('keysModal'); }

  renderKeys() {                   // 단축키 표 — 동작 목록 + 지금 단축키(바꾼 것 포함)에서 만든다
    const groups = new Map();
    for (const [id, a] of Object.entries(this.actions)) {
      const ks = this.keymap.keys(id);
      if (!ks.length || !a.group) continue;
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(`<tr><td>${ks.map((c) => `<kbd>${esc(keyLabel(c))}</kbd>`).join(' ')}</td><td>${esc(a.label)}</td></tr>`);
    }
    $('keysBody').innerHTML = [...groups].map(([g, rows]) => `<section><h4>${esc(g)}</h4><table>${rows.join('')}</table></section>`).join('');
  }

  refreshKeyHints() {              // 단축키를 바꾸면: 버튼 툴팁 · 버튼 안 키 · 아래 안내 · 단축키 표
    document.querySelectorAll('[data-action]').forEach((b) => {
      const id = b.dataset.action, a = this.actions[id]; if (!a) return;
      const k = this.keyOf(id);
      b.title = k ? `${a.label} (${k})` : a.label;
      const kk = b.querySelector('.key'); if (kk) kk.textContent = k;
    });
    this.renderHint();
    this.notes.syncPathUI();
    if ($('keysModal').style.display === 'flex') this.renderKeys();
  }

  renderHint() {                   // 3D 화면 아래 안내 — 지금 단축키로, 모드에 맞게
    const k = (id) => { const s = this.keyOf(id); return s ? `<kbd>${esc(s)}</kbd>` : ''; };
    $('hint').innerHTML = this.notes.agent
      ? `<b>누르기</b> = 고르기 (물체 · 배경 · 장면 카드 · 타임라인 눈금 끌기 = 구간) · ${k('tool.path')} 동선 · ${k('note.add')} 메모 · ${k('mode.toggle')} 수동 수정`
      : `${k('move.forward')}${k('move.left')}${k('move.back')}${k('move.right')} 이동 ${k('move.up')}${k('move.down')} 위아래 <span class="adv">${k('turn.left')}${k('turn.right')} 고개 </span>· <b>드래그</b> 둘러보기<span class="adv"> · <kbd>Shift</kbd> 빠르게 ${k('speed.down')}${k('speed.up')} 속도 · <b>휠</b> 렌즈</span> &nbsp;|&nbsp; ${k('shot.take')} 찍기 ${k('obj.key')} 물체 키 ${k('play.toggle')} 재생 <span class="adv">${k('time.start')} 처음으로 · ${k('view.cycle')} 평면도 · </span>${k('help.keys')} 단축키`;
  }

  aiReady() {                      // AI 가 붙어 있나 — Claude·Codex 설정에 연결돼 있거나, 30 분 안에 AI 가 실제로 부름
    const s = this.ai && this.ai.status, recent = this.ai && this.ai.lastAt && performance.now() - this.ai.lastAt < 1800000;
    return !!(recent || (s && (s.configured || s.recent)));
  }

  syncAIUI() {                     // 연결 여부에 맞게 버튼·띠 글자(연결 안 됐는데 AI 를 조르지 않게)
    const on = this.aiReady(), b = $('noteAI'), c = $('agentAI');
    if (b) b.innerHTML = on ? `${icon('ai', 16)}AI 에게 맡기기 <small>— 맡기는 말을 복사해 AI 채팅에 붙여 넣기</small>` : `${icon('ai', 16)}AI 연결하고 맡기기 <small>— 한 번만 연결하면 됩니다</small>`;
    if (c) { c.classList.toggle('on', on); c.innerHTML = on ? '<span class="dot"></span>AI 연결됨' : 'AI 연결 안 됨 · 연결하기'; c.title = on ? 'AI 연결 창 — 연결된 AI · AI 가 한 일' : 'AI 연결 방법 보기'; }
  }

  async agentIntro() {             // 에이전트 모드를 처음 켰는데 AI 가 없으면 한 번만 알려 줌(다시 묻지 않음)
    if (this.aiReady() || this.prefs.agentIntro) return;
    this.prefs.agentIntro = true; this.savePrefs();
    const v = await ask({ title: '에이전트 모드 — 고칠 곳을 골라 메모하면 AI 가 고칩니다', text: '지금은 연결된 AI 가 없습니다. 메모는 그대로 남길 수 있고(사람끼리 봐도 됩니다), AI 가 고치게 하려면 Claude 나 ChatGPT 를 한 번만 연결하면 됩니다.',
      buttons: [{ label: '메모만 남기기', value: null }, { label: 'AI 연결 방법 보기', value: 1, primary: true }] });
    if (v === 1) openAI(this, this.ai);
  }

  agentBlock() { this.toast(`에이전트 모드에선 고르고 메모만 합니다 — 직접 고치려면 ${this.keyOf('mode.toggle') || '위쪽 버튼'} (수동 수정)`); }

  addNoteFromUI() {
    const n = this.notes.add($('noteText').value);
    if (!n) { this.warn('무엇을 고칠지 적어 주세요'); $('noteText').focus(); return; }
    $('noteText').value = '';
    if (this.notes.filter === 'done') { this.notes.filter = 'open'; $('noteFilter').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.f === 'open')); this.notes.render(); }
    this.toast(`메모 ${n.n} 남김${n.target ? ` — ${this.notes.label(n.target)}` : ''}${this.aiReady() ? ' · AI 에게 「메모대로 고쳐 줘」' : ''}`);
    this.notes.select(null);
  }

  async copyText(text, msg = '복사했습니다') {
    try { await navigator.clipboard.writeText(text); this.toast(msg); return; } catch (e) { /* 아래 */ }
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove();
    this.toast(ok ? msg : '복사가 막혀 있음 — 직접 복사하세요');
  }

  escape() {                       // Esc — 하던 것 하나씩 그만(동선 → 자 → 녹화 → 재생 → 장면 수정 → 고른 키 → 고른 물체 → 고른 대상)
    if (this.notes.path) { this.notes.cancelPath(); return; }
    if (this.measure) { this.measure = null; this.status('자 끝'); return; }
    if (this.recording) { this.toggleRecord(); return; }
    if (this.playing || this.mode === 'play') { this.stopPlay(); return; }
    if (this.editing) { this.stopEditing(); this.toast('장면 수정 끝'); return; }
    if (this.selKey) { this.selKey = null; return; }
    if (this.selObj) { this.selectObj(null); return; }
    if (this.notes.sel) { this.notes.select(null); return; }
    if (this.coach) this.coachEnd();
  }

  async resetSet() {
    const id = this._presetId || { western: 'west_empty', hoistway: 'hoistway_empty', studio: 'studio' }[this.state.scene];
    if (!(await ask({ title: '세트를 처음 상태로', text: '찍은 장면 · 물체 · 메모가 이 세트의 처음 상태로 돌아갑니다. 저장해 둔 프로젝트 파일은 그대로입니다.', buttons: [{ label: '취소', value: null }, { label: '처음 상태로', value: 1, danger: true }] }))) return;
    await this.loadPreset(id);
    this.state.name = this.projects.name;
    this.projects.markDirty();
  }

  setPlan(view) {                  // null = 3D, 'top' | 'front' | 'side' = 평면도·정면도·측면도
    if (view === this.plan) return;
    if (view) { if (!this.plan) this._fogSaved = this.scene3.fog; this.planV.enter(this, view); this.scene3.fog = null; }
    else { this.planV.exit(); this.scene3.fog = this._fogSaved === undefined ? this.scene3.fog : this._fogSaved; this._fogSaved = undefined; this.scene3.background.set(this.state.scene === 'western' ? WEST_SKY : 0x0b0b0b); }
    this.plan = view;
    this.tc.camera = view ? this.planV.cam : this.camera;
    $('viewMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b.dataset.v || '') === (view || '')));
    if (view) this.status({ top: '평면도(위) — 번호·물체 키·카메라를 끌어 옮기기 · 빈 곳 끌기 = 이동 · 휠 = 확대 · 오른쪽 끌기 = 둘러보기 · 번호 클릭 = 그 장면', front: '정면도 — 앞에서 본 단면', side: '측면도 — 옆에서 본 단면' }[view]);
  }

  async refreshThumb(k) {          // 장면 자리가 바뀌었으면 썸네일도 다시
    await this.renderAt(k.t, 384, 216, true);
    k.thumb = this.thumbOf();
    this.restoreSize();
    this.refreshStrip();
  }

  refreshSpots() {                 // 세트에 맞는 바로 가기 + 내가 기억한 자리(Shift+클릭 = 지우기) + 「지금 자리 기억」
    const sp = $('spots'), list = SPOTS[this.state.scene] || [], mine = this.state.spots || [];
    sp.innerHTML = '';
    list.forEach((s) => { const b = document.createElement('button'); b.textContent = s.label; b.onclick = () => this.goSpot(s); sp.appendChild(b); });
    mine.forEach((s, i) => {
      const b = document.createElement('button'); b.innerHTML = `${icon('star', 13)}${esc(s.label)}`; b.title = 'Shift+클릭 = 지우기';
      b.onclick = (e) => { if (e.shiftKey) { this.state.spots.splice(i, 1); this.refreshSpots(); this.touch(); this.toast(`${s.label} 지움`); } else this.goSpot(s); };
      sp.appendChild(b);
    });
    const add = document.createElement('button'); add.innerHTML = `${icon('plus', 14)}지금 자리 기억`; add.title = '지금 서 있는 자리와 보는 방향을 버튼으로';
    add.onclick = async () => {
      const label = await askText({ title: '지금 자리 기억', label: '자리 이름', value: `자리 ${mine.length + 1}`, ok: '기억' }); if (label === null) return;
      const f = this.fly, d = flyForward(f.yaw, f.pitch), off = this.state.follow ? this.carY(this.time) : 0;
      (this.state.spots = this.state.spots || []).push({ label: label || `자리 ${mine.length + 1}`, pos: [f.pos[0], f.pos[1] + off, f.pos[2]], look: [f.pos[0] + d[0] * 2, f.pos[1] + off + d[1] * 2, f.pos[2] + d[2] * 2], mm: f.mm });
      this.refreshSpots(); this.touch(); this.toast('자리 기억');
    };
    sp.appendChild(add);
    $('spotsLbl').style.display = sp.style.display = '';
  }

  teleport(e) {                    // 더블클릭한 곳으로 — 바닥이면 그 위 눈높이, 벽이면 그 앞
    if (this.plan || this.mode !== 'fly' || this.measure) return;
    const r = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects([this.world.group, ...this.objects.filter((o) => o.visible).map((o) => o.group)], true).find((h) => h.object.isMesh);
    if (!hit) return;
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const dir = this.raycaster.ray.direction, off = this.state.follow ? this.carY(this.time) : 0, p = hit.point;
    const to = n.y > 0.6 ? [p.x, p.y + this.prefs.eye - off, p.z] : [p.x - dir.x * 0.8, this.fly.pos[1], p.z - dir.z * 0.8];
    if (reduced()) { this.fly.pos = to; this.stopEditing(); return; }
    this._tele = { from: this.fly.pos.slice(), to, t0: performance.now() };
    this.stopEditing();
  }

  toggleWalk(on) {
    if (on && this.state.scene === 'hoistway') { this.warn('승강로에선 걷기 모드가 없음(카를 타고 찍기)'); on = false; }
    this.walk = on; $('walkMode').checked = on;
    if (on) { this.fly.pos[1] = this.prefs.eye; this.status(`걷기 모드 — 눈높이로 걷기, ${this.keyOf('move.up')}/${this.keyOf('move.down')} 로 눈높이, ${this.keyOf('view.walk')} 로 끄기`); }
  }

  measureClick(x, y) {            // 자: 두 점을 찍으면 거리
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = this.raycaster.intersectObjects([this.world.group, ...this.objects.filter((o) => o.visible).map((o) => o.group)], true).find((h) => h.object.isMesh);
    if (!hit) { this.warn('세트나 물체 위를 클릭하세요'); return; }
    if (!this.measure.a) { this.measure.a = hit.point.clone(); this.status('자: 둘째 점을 클릭'); return; }
    const a = this.measure.a, b = hit.point.clone(), d = a.distanceTo(b);
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xff6820, depthTest: false }));
    ln.renderOrder = 5; this.measures.add(ln);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d');
    g.fillStyle = 'rgba(24,24,26,.88)'; g.fillRect(0, 0, 256, 64); g.fillStyle = '#FF8A52'; g.font = "600 34px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${d.toFixed(2)} m`, 128, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.position.copy(a).lerp(b, 0.5); sp.scale.set(Math.max(0.6, d * 0.25), Math.max(0.15, d * 0.0625), 1); sp.renderOrder = 6; this.measures.add(sp);
    this.measure = { a: null };
    this.status(`자: ${d.toFixed(2)} m — 다음 첫 점을 클릭하거나 ${this.keyOf('tool.measure')} 로 끝`);
    this.toast(`${d.toFixed(2)} m`);
  }

  toggleMeasure() {
    if (this.measure || this.measures.children.length) { this.measure = null; this.measures.clear(); this.status('자 지움'); return; }
    this.measure = { a: null }; this.status(`자: 첫 점을 클릭 (${this.keyOf('tool.measure')} 또는 Esc 로 끝)`);
  }

  toggleLook(kind) {               // 윤곽선(O) · 엑스레이(Alt+Z)
    if (kind === 'outline') { this.planV.setOutline(!this.planV.outlineOn); this.status(this.planV.outlineOn ? '윤곽선 켜짐 — 모서리에 선' : '윤곽선 꺼짐'); }
    else { this.planV.setXray(this, !this.planV.xrayOn); this.status(this.planV.xrayOn ? '엑스레이 — 세트가 비쳐 보임(물체·사람은 그대로)' : '엑스레이 꺼짐'); }
    $('lookBtns').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'outline' ? this.planV.outlineOn : this.planV.xrayOn));
  }

  setGizmoMode(m) {
    this.tc.setMode(m);
    $('gizmoMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.m === m));
  }

  nudgeLens(dir) {
    this.fly.mm = Math.min(Math.max(Math.round(this.fly.mm * (dir > 0 ? 1.15 : 1 / 1.15)), 8), 200);
    this.syncFlyUI();
  }

  syncUI() {
    const st = this.state;
    $('setName').textContent = SET_NAMES[st.scene] || st.scene;
    $('tFps').value = st.fps;
    this.segAspect(st.aspect);
    this.showTail(); this.showGap();
    $('follow').checked = !!st.follow;
    this.segCar(st.params.carMode === 'stop' ? 'stop' : st.params.carVmax <= 3 ? 'slow' : st.params.carVmax <= 6 ? 'normal' : 'fast');
    this.segDoor(st.params.doorOpen >= 0.99 ? 1 : st.params.doorOpen > 0.01 ? 0.5 : 0);
    this.segCut(st.params.cut || 'none');
    for (const s of this.sliders) { const v = s.getObj()[s.key]; s.row.style.display = (s.set === 'all' || s.set === st.scene) ? '' : 'none'; if (v !== undefined) { s.inp.value = v; s.out.textContent = v; } }
    $('lCove').checked = !!st.lights.cove; $('lLeak').checked = !!st.lights.leak; $('lCarLamp').checked = !!st.lights.carLamp; $('lTop').checked = !!st.lights.top;
    document.querySelectorAll('.hoistOnly').forEach((el) => { el.style.display = st.scene !== 'hoistway' ? 'none' : ''; });
    this.refreshSpots();
    this.syncFlyUI();
    this.pause();
    this.mode = 'fly';
    this.fitViewport();
    this.refreshObjList();
    this.syncUndoUI();
    this.syncRangeUI();
  }

  syncFlyUI() {
    $('lensVal').textContent = `${this.fly.mm.toFixed(0)} mm`;
    $('rollVal').textContent = `${this.fly.roll.toFixed(0)}°`;
    $('lensBtns').querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', Math.abs(parseFloat(b.dataset.v) - this.fly.mm) < 0.5));
    this.liveUpdate();
  }

  syncPrefsUI() {
    $('speedVal').textContent = `${this.prefs.speed.toFixed(1)} m/s`;
    this.segSpeed(this.prefs.speed);
    $('walkMode').checked = !!this.walk;
    if (this.segGuide) this.segGuide(this.prefs.guide || 'none');
    $('letterbox').checked = !!this.prefs.letterbox;
    this.syncTransportUI();
  }

  syncSnap() {                     // 블렌더처럼 Ctrl = 단위 스냅, Ctrl+Shift = 더 잘게
    const k = this.keysDown, ctrl = k.has('ControlLeft') || k.has('ControlRight'), shift = k.has('ShiftLeft') || k.has('ShiftRight');
    this.tc.setTranslationSnap(ctrl ? (shift ? 0.1 : 0.5) : null);
    this.tc.setRotationSnap(ctrl ? (shift ? 5 : 15) * Math.PI / 180 : null);
    this.tc.setScaleSnap(ctrl ? (shift ? 0.05 : 0.25) : null);
  }

  // ---------------------------------------------------------------- 마우스 · 키보드
  bindPointer() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (this.tc.axis || this.gizmoDrag) return;
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button };
      if (this.plan && e.button === 0) {                                                    // 평면도: 무엇을 잡았나(에이전트·동선 그리기 중엔 끌기 = 이동만)
        const r = c.getBoundingClientRect();
        drag.hit = (this.notes.agent || this.notes.path) ? { kind: 'pan' } : this.planV.hit(this, new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.raycaster) || { kind: 'pan' };
        if (this.mode === 'play' && drag.hit.kind !== 'pan') this.stopPlay();
      }
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* 합성 이벤트 */ }
      c.focus(); this._tabViews = true;                                        // 마우스로 누른 뒤엔 Tab = 평면도 돌리기
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) {                                                                            // 에이전트 모드: 무엇이 골라질지 미리 보여 줌(가볍게 70 ms 마다)
        if (this.notes.agent && !this.notes.path && performance.now() - (this._hoverAt || 0) > 70) {
          this._hoverAt = performance.now();
          const r = c.getBoundingClientRect(), vr = $('viewport').getBoundingClientRect();
          this.notes.hover(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), e.clientX - vr.left, e.clientY - vr.top);
        }
        return;
      }
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { ...drag, x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) drag.moved = true;
      if (!drag.moved) return;
      if (this.plan && drag.button === 0) {                                                 // 평면도에서 끌기: 이동 · 카메라 · 장면 번호 · 물체 키
        const d = this.planV.delta(dx, dy, this.viewH), h = drag.hit;
        if (h.kind === 'pan') { this.planV.off.x -= d.x; this.planV.off.y -= d.y; this.planV.off.z -= d.z; }
        else if (h.kind === 'cam') { this.fly.pos[0] += d.x; this.fly.pos[1] += d.y; this.fly.pos[2] += d.z; this.liveUpdate(); }
        else if (h.kind === 'camKey') {
          if (!drag.pushed) { this.pushHistory(); drag.pushed = true; }
          for (const a of ['pos', 'target']) { h.key[a][0] += d.x; h.key[a][1] += d.y; h.key[a][2] += d.z; }
          if (h.key === this.editing) this.fly.pos = flyFromKey(h.key).pos;
        } else if (h.kind === 'objKey') {
          if (!drag.pushed) { this.pushHistory(); drag.pushed = true; }
          h.key.pos[0] += d.x; h.key.pos[1] += d.y; h.key.pos[2] += d.z;
        }
        return;
      }
      if (this.mode === 'play') this.stopPlay();
      const k = 0.0035 * this.prefs.sens;
      this.fly.yaw -= dx * k;
      this.fly.pitch = Math.min(Math.max(this.fly.pitch - dy * k * (this.prefs.invertY ? -1 : 1), -1.55), 1.55);
      this.liveUpdate();
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && this.plan && drag.button === 0 && drag.hit && drag.hit.kind !== 'pan') {
        const h = drag.hit;
        if (!drag.moved) {                                                                    // 평면도에서 누르기: 번호 = 그 장면, 물체 키 = 그 물체·그 시각
          if (h.kind === 'camKey') this.goto(h.key);
          else if (h.kind === 'objKey') { this.selectObj(h.obj); this.selKey = { obj: h.obj, key: h.key }; this.time = h.key.t; this.showObj(); }
        } else if (h.kind === 'camKey') { this.touch(); this.refreshThumb(h.key); }
        else if (h.kind === 'objKey') { this.showObj(); this.touch(); }
        drag = null; return;
      }
      if (drag && !drag.moved && !this.gizmoDrag && drag.button === 0) {
        const r = c.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        if (this.notes.path) { this.notes.addPathPoint(ndc); drag = null; return; }
        if (this.notes.agent) { this.notes.select(this.notes.hit(ndc)); drag = null; return; }
        if (this.measure && !this.plan) { this.measureClick(ndc.x, ndc.y); drag = null; return; }
        const obj = this.pickObject(ndc.x, ndc.y);
        if (this.mode === 'play' && obj) this.stopPlay();
        if (this.mode === 'fly') { this.selectObj(obj); if (obj) this.showTab('objects'); }
      }
      drag = null;
    });
    c.addEventListener('pointerleave', () => { $('pickTip').hidden = true; });
    c.addEventListener('blur', () => { this._tabViews = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.plan) { this.planV.h = Math.min(Math.max(this.planV.h * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 0.4), 400); return; }   // 평면도: 휠 = 확대/축소
      if (e.ctrlKey) { this.setSpeed(this.prefs.speed * (e.deltaY < 0 ? 1.25 : 0.8)); return; }        // Ctrl+휠 = 이동 속도 (블렌더 걷기 모드의 휠)
      if (this.mode === 'play') this.stopPlay();
      const mm2 = Math.round(Math.min(Math.max(this.fly.mm * (1 - e.deltaY * 0.0012), 8), 200) * 10) / 10;
      if (e.shiftKey) {                                                                            // Shift+휠: 렌즈를 바꾸면서 거리도 바꿔 피사체 크기 유지(Camera Rigs 의 Swap Lens)
        let d = 3;
        if (this.selObj) { const c0 = new THREE.Box3().setFromObject(this.selObj.group).getCenter(new THREE.Vector3()); const fy = this.state.follow ? this.carY(this.time) : 0; d = Math.max(0.5, Math.hypot(c0.x - this.fly.pos[0], c0.y - fy - this.fly.pos[1], c0.z - this.fly.pos[2])); }
        const fwd = flyForward(this.fly.yaw, this.fly.pitch), move = d * (mm2 / this.fly.mm - 1);
        for (let i = 0; i < 3; i++) this.fly.pos[i] -= fwd[i] * move;
      }
      this.fly.mm = mm2;
      this.syncFlyUI();
    }, { passive: false });
    c.addEventListener('dblclick', (e) => { if (this.notes.path) { this.notes.finishPath(); return; } this.teleport(e); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindKeys() {
    const typing = (e) => {                     // 글 쓰는 칸이면 단축키 쉼 — 체크박스는 Space 만, 슬라이더는 화살표·Home/End 만 그 칸 몫
      const t = e.target, n = (t.tagName || '').toLowerCase(), ty = (t.type || '').toLowerCase();
      if (n === 'textarea' || n === 'select' || t.isContentEditable) return true;
      if (n !== 'input') return false;
      if (ty === 'checkbox' || ty === 'radio') return e.code === 'Space';
      if (ty === 'range') return /^(Arrow|Home|End|Page)/.test(e.code);
      return true;
    };
    const usable = (id) => { const a = this.actions[id]; return a && a.run ? a : null; };
    window.addEventListener('keydown', (e) => {
      if (/^(Control|Shift|Alt|Meta)/.test(e.code)) { this.keysDown.add(e.code); this.syncSnap(); return; }    // 천천히(Ctrl) · 빠르게(Shift) · 기즈모 스냅
      if (this.busy) { e.preventDefault(); if (e.key === 'Escape') this.stop = true; return; }
      if (e.defaultPrevented || this.capturingKeys || typing(e) || topModal()) return;                // 글 쓰는 칸 · 열린 창 · 단축키 바꾸는 중
      if (this.menuBar.openIdx >= 0) { if (e.key === 'Escape') this.menuBar.close(); return; }                // 메뉴가 열려 있으면 메뉴 몫
      const combo = comboOf(e), t = e.target;
      if ((combo === 'Tab' || combo === 'Shift+Tab') && !(t === this.canvas && this._tabViews)) return;   // 키보드로 들어온 3D 화면은 Tab 으로 나감                           // Tab: 3D 화면을 누른 뒤에만 평면도 — 다른 곳에선 초점 옮기기(키보드로도 쓸 수 있게)
      if (['Space', 'Enter', 'NumpadEnter'].includes(combo) && t !== this.canvas && t !== document.body && t.closest && t.closest('button, a, summary, [role=tab]')) return;   // 키보드 초점이 버튼에 있으면 버튼 누르기
      if (this.notes.path && (combo === 'Enter' || combo === 'NumpadEnter')) { e.preventDefault(); this.notes.finishPath(); return; }     // 동선 그리는 중
      if (this.notes.path && combo === 'Backspace') { e.preventDefault(); this.notes.popPathPoint(); return; }
      const ids = this.keymap.byCombo.get(combo) || [];
      const id = ids.find((x) => { const a = usable(x); return a && a.when && a.when(); }) || ids.find((x) => { const a = usable(x); return a && !a.when; });   // 상황(when)이 맞는 것 먼저 — 1 = 물체를 골랐으면 이동 기즈모, 아니면 앞에서 보기
      if (id) {
        e.preventDefault();
        if (e.repeat && !REPEAT.has(id)) return;
        this.actions[id].run();
        return;
      }
      const hold = !e.ctrlKey && !e.metaKey && !e.altKey && this.keymap.hold.get(e.code);                    // 날기(누르고 있기)
      if (hold) {
        e.preventDefault();
        if (this.mode === 'play' && this.state.camera.keys.length) this.stopPlay();
        this.holdDown.add(hold);
      }
    });
    window.addEventListener('keyup', (e) => { this.keysDown.delete(e.code); const h = this.keymap.hold.get(e.code); if (h) this.holdDown.delete(h); this.syncSnap(); });
    window.addEventListener('blur', () => { this.keysDown.clear(); this.holdDown.clear(); this.syncSnap(); });
  }
}

function r2(v) {
  return Math.round(v * 100) / 100;
}

// GLB 부품 합치기 — 같은 '움직이는 조상' 아래의 안 움직이는 메시를 하나로(재질이 전부 회색 하나라 가능). 그리기 호출 수천 → 수백.
// 애니메이션 트랙이 가리키는 노드와 그 아래 메시는 그 노드를 기준으로 합쳐 움직임은 그대로. 스킨 메시는 건드리지 않음.
function mergeStaticParts(root, clip, material) {
  root.updateMatrixWorld(true);
  const animated = new Set();
  if (clip) for (const tr of clip.tracks) { try { animated.add(THREE.PropertyBinding.parseTrackName(tr.name).nodeName); } catch (e) { /* 이름 없는 트랙 */ } }
  const groups = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    before++;
    let a = o;
    while (a !== root && !animated.has(a.name)) a = a.parent;
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(o);
  });
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  let after = 0;
  for (const [anchor, meshes] of groups) {
    if (meshes.length < 2) { after += meshes.length; continue; }
    inv.copy(anchor.matrixWorld).invert();
    const geos = meshes.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      g.morphAttributes = {};
      rel.multiplyMatrices(inv, m.matrixWorld);
      return g.applyMatrix4(rel);
    });
    const merged = mergeGeometries(geos, false);
    for (const m of meshes) m.removeFromParent();
    if (merged) { anchor.add(new THREE.Mesh(merged, material)); after++; }
  }
  return { before, after };
}

function fatal(e) {               // 앱을 못 엶 — 빈 화면 대신 이유와 할 일(WebGL 을 못 쓰는 PC: 오래된 그래픽·원격 데스크톱·가속 꺼짐)
  console.error(e);
  const msg = String((e && e.message) || e), gl = /webgl|context/i.test(msg);
  const v = document.getElementById('viewport');
  if (v) v.innerHTML = gl ? `<div class="fatal"><b>3D 화면을 열 수 없습니다</b><p>이 PC 에서 3D 그래픽(WebGL)을 쓸 수 없는 것 같습니다.</p>
    <ul><li>그래픽 드라이버를 업데이트하고 다시 켜 보세요</li><li>원격 데스크톱이면 그 PC 앞에서 직접 켜 보세요</li><li>Edge · Chrome 최신판이 필요합니다(설정 › 시스템 › 「가능한 경우 그래픽 가속 사용」 켜기)</li></ul>
    <small>${esc(msg)}</small></div>`
    : `<div class="fatal"><b>앱을 여는 중에 문제가 생겼습니다</b><p>창을 닫고 다시 켜 보세요. 계속되면 도움말 › 문제 알리기로 아래 글을 보내 주세요.</p><small>${esc(msg)}</small></div>`;
}
try { window.app = new App(); } catch (e) { fatal(e); }
if (location.search.includes('check')) import('./selfcheck.js');     // ?check — 자가 점검
