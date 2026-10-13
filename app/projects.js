// 프로젝트 — 블렌더 파일 메뉴처럼: 새로(Ctrl+N) · 열기(Ctrl+O, 썸네일 목록) · 최근 · 저장(Ctrl+S) · 다른 이름으로(Ctrl+Shift+S) · 사본 · 되돌리기 · 복구(자동 저장).
// 파일은 앱 서버(server_api.py)가 문서\블록아웃 스튜디오\프로젝트\<이름>.json(+ .jpg 썸네일)에 쓴다. 서버가 없는 창(파일로 연 것)은 내려받기·올리기로 대신.
// 바뀐 것이 있으면 제목 앞에 ●, 창을 닫으려 하면 묻는다. 2분마다(바뀐 게 있을 때) 자동저장 폴더에 최근 10개.
import { openModal, closeModal, ask, askText, $, esc } from './ui.js';
import { download } from './exporter.js';
import { icon } from './icons.js';

const LS_RECENT = 'blockout-studio:recent', LS_PROJ = 'blockout-studio:project';
const AUTOSAVE_MS = 120000;
const UNTITLED = '제목 없음';
const when = (t) => new Date(t * 1000).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export class Projects {
  constructor(app) {
    this.app = app;
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS_PROJ) || '{}'); } catch (e) { /* 처음 */ }
    this.name = s.name || UNTITLED;
    this.file = s.file || null;
    this.dirty = !!s.dirty;
    this.server = null;                                         // null = 아직 모름
    this.lastAuto = performance.now();
    setInterval(() => this.autosave(), 30000);
    window.addEventListener('beforeunload', (e) => { if (this.dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  async hasServer() {
    if (this.server === null) { try { this.server = (await fetch('/api/projects', { cache: 'no-store' })).ok; } catch (e) { this.server = false; } }
    return this.server;
  }

  remember() { try { localStorage.setItem(LS_PROJ, JSON.stringify({ name: this.name, file: this.file, dirty: this.dirty })); } catch (e) { /* 저장 공간 */ } }

  markDirty() { this.autoDue = true; if (!this.dirty) { this.dirty = true; this.showTitle(); } }       // autoDue: 지난 자동 저장 뒤 바뀐 게 있음

  setClean(name, file) {
    this.name = name || UNTITLED; this.file = file; this.dirty = false;
    this.app.state.name = this.name;
    this.showTitle(); this.remember();
  }

  showTitle() {
    $('projName').textContent = this.name;
    $('projName').title = this.file ? `문서\\블록아웃 스튜디오\\프로젝트\\${this.file} — 누르면 이름 바꾸기` : '아직 저장 안 함 — 누르면 이름 정하고 저장';
    $('dirtyDot').hidden = !this.dirty;
    document.body.classList.toggle('dirty', this.dirty);              // 저장 버튼 테두리가 주황(저장할 게 있음)
    document.title = `${this.dirty ? '● ' : ''}${this.name} — 블록아웃 스튜디오`;
    this.remember();                                              // 이름표가 바뀌는 길은 모두 여기를 지남 — 다시 켜도 장면과 이름표가 맞게
  }

  data(name = this.name) {
    const a = this.app;
    a.state.objects = a.objects.map((o) => o.toJSON());
    return { ...a.state, name, savedAt: new Date().toISOString(), appVersion: a.version };
  }

  async list() {
    try { const r = await fetch('/api/projects', { cache: 'no-store' }); return r.ok ? (await r.json()).items : []; } catch (e) { return []; }
  }

  // ---- 저장
  async writeFile(name, { copy = false, overwrite = false } = {}) {   // 이름으로 바로 저장(대화 없음) — 메뉴의 저장과 AI(save_project)가 같이 씀
    const a = this.app, file = `${name}.json`;
    const fresh = !overwrite && file.toLowerCase() !== String(this.file || '').toLowerCase();   // 지금 파일이 아니면 '새 파일로만' — 같은 이름의 다른 프로젝트를 말없이 덮지 않게
    const r = await fetch(`/api/project?name=${encodeURIComponent(file)}${fresh ? '&new=1' : ''}`, { method: 'POST', body: JSON.stringify(this.data(name)) });
    if (r.status === 409) throw new Error(`「${name}」 이름의 프로젝트가 이미 있음 — 다른 이름으로`);
    if (!r.ok) throw new Error(`저장 실패 (${r.status})`);
    const { path } = await r.json();
    await this.saveThumb(file).catch(() => {});
    if (!copy) this.setClean(name, file);
    this.addRecent(name, file);
    a.status(`저장 — ${path}`);
    return path;
  }

  async save({ as = false, copy = false } = {}) {
    const a = this.app;
    if (!(await this.hasServer())) {                             // 서버 없는 창: 내려받기
      download(new Blob([JSON.stringify(this.data(), null, 1)], { type: 'application/json' }), `${this.name}.json`);
      this.setClean(this.name, null); a.toast('프로젝트를 내려받았습니다'); return true;
    }
    let name = this.name;
    if (as || copy || !this.file) {
      const v = await askText({ title: copy ? '사본 저장' : as ? '다른 이름으로 저장' : '프로젝트 저장', label: '프로젝트 이름', ok: '저장',
        value: copy ? `${name} 사본` : name === UNTITLED ? '' : name, placeholder: '예: 서부 결투 2차' });
      if (!v) return false;
      name = v.replace(/[\\/:*?"<>|]/g, '_');
      const clash = (await this.list()).find((x) => x.file.toLowerCase() === `${name}.json`.toLowerCase());
      if (clash && `${name}.json` !== this.file) {
        const ok = await ask({ title: '같은 이름의 프로젝트가 있습니다', text: `「${name}」 을(를) 지금 내용으로 덮어쓸까요?`, buttons: [{ label: '취소', value: null }, { label: '덮어쓰기', value: 1, danger: true }] });
        if (!ok) return false;
      }
    }
    try {
      await this.writeFile(name, { copy, overwrite: true });       // 덮어쓰기는 위에서 이미 물어봄
      a.toast(copy ? `사본 저장: ${name}` : `저장했습니다: ${name}`);
      return true;
    } catch (e) { a.warn(e.message); return false; }
  }

  async saveThumb(file) {
    const a = this.app, k = a.state.camera.keys;
    const c = await a.renderAt(k.length ? k[0].t : a.time, 480, 270, k.length > 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    a.restoreSize();
    await fetch(`/api/project/thumb?name=${encodeURIComponent(file)}`, { method: 'POST', body: blob });
  }

  // ---- 열기
  async confirmDiscard() {                                       // 바뀐 게 있으면: 저장 · 저장 안 함 · 취소
    if (!this.dirty) return true;
    const v = await ask({ title: '저장하지 않은 변경 사항', text: `「${this.name}」 의 바뀐 내용을 저장할까요?`,
      buttons: [{ label: '취소', value: null }, { label: '저장 안 함', value: 'discard', danger: true }, { label: '저장', value: 'save', primary: true }] });
    if (v === 'save') return this.save();
    return v === 'discard';
  }

  async openFile(file, { ask: askFirst = true } = {}) {
    if (askFirst && !(await this.confirmDiscard())) return false;
    const r = await fetch(`/api/project?name=${encodeURIComponent(file)}`, { cache: 'no-store' });
    if (!r.ok) { this.app.warn(`열지 못했습니다: ${file}`); return false; }
    const st = await r.json();
    await this.app.applyState(st);
    this.setClean(file.replace(/\.json$/i, ''), file);             // 이름 = 파일 이름(안의 name 이 달라도) — Ctrl+S 가 연 그 파일에 씀
    this.addRecent(this.name, file);
    this.app.toast(`열었습니다: ${this.name}`);
    return true;
  }

  async importFile(f) {                                          // 다른 곳의 JSON — 열되 아직 프로젝트 폴더엔 없음(Ctrl+S 하면 이름을 물음)
    if (!(await this.confirmDiscard())) return;
    try {
      const st = JSON.parse(await f.text());
      await this.app.applyState(st);
      this.name = st.name || f.name.replace(/\.json$/i, ''); this.file = null; this.dirty = true;
      this.app.state.name = this.name;
      this.showTitle(); this.remember();
      this.app.toast(`가져왔습니다: ${f.name}`);
    } catch (e) { this.app.warn(`가져오지 못했습니다: ${e.message}`); }
  }

  async newProject(presetId) {
    if (!(await this.confirmDiscard())) return;
    await this.app.loadPreset(presetId);
    this.setClean(this.app.state.name, null);          // 이름은 세트 이름으로 시작 — 저장할 때 바꿈
  }

  async revert() {
    if (!this.file) { this.app.warn('아직 저장한 적이 없어 되돌릴 파일이 없습니다'); return; }
    const ok = await ask({ title: '마지막 저장으로 되돌리기', text: `「${this.name}」 을(를) 마지막으로 저장한 상태로 되돌립니다. 그 뒤에 바꾼 것은 사라집니다.`,
      buttons: [{ label: '취소', value: null }, { label: '되돌리기', value: 1, danger: true }] });
    if (ok) await this.openFile(this.file, { ask: false });
  }

  async rename() {                                               // 제목 누르기 = 이름 바꾸기(저장한 적 없으면 저장)
    if (!this.file) { await this.save(); return; }
    await this.save({ as: true });
  }

  // ---- 최근 · 자동 저장
  recent() { try { return JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); } catch (e) { return []; } }

  addRecent(name, file) {
    const list = [{ name, file }, ...this.recent().filter((x) => x.file !== file)].slice(0, 10);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(list)); } catch (e) { /* 무시 */ }
  }

  async autosave() {
    if (!this.autoDue || performance.now() - this.lastAuto < AUTOSAVE_MS || !(await this.hasServer())) return;
    this.lastAuto = performance.now(); this.autoDue = false;
    fetch(`/api/autosave?name=${encodeURIComponent(this.name)}`, { method: 'POST', body: JSON.stringify(this.data()) }).catch(() => {});
  }

  // ---- 세션(지금 작업) — 브라우저 저장소가 비어도(포트·브라우저가 바뀜) 이어서 열리게 앱 서버에도 둔다
  saveSession() {
    clearTimeout(this.sessT);
    this.sessT = setTimeout(async () => {
      if (!(await this.hasServer())) return;
      const a = this.app;
      const body = JSON.stringify({ savedAt: Date.now(), state: a.state, project: { name: this.name, file: this.file, dirty: this.dirty }, prefs: a.prefs, recent: this.recent() });
      fetch('/api/session', { method: 'POST', body }).catch(() => {});
    }, 1500);
  }

  async loadSession() {
    if (!(await this.hasServer())) return null;
    try { const r = await fetch('/api/session', { cache: 'no-store' }); return r.status === 200 ? await r.json() : null; } catch (e) { return null; }
  }

  adopt(s) {                                                     // 서버 세션에서 이어 열 때: 이름표 · 최근 목록 · 설정(이 브라우저에 없던 것만)
    if (s.project) { this.name = s.project.name || UNTITLED; this.file = s.project.file || null; this.dirty = !!s.project.dirty; }
    try { if (!localStorage.getItem(LS_RECENT) && Array.isArray(s.recent)) localStorage.setItem(LS_RECENT, JSON.stringify(s.recent.slice(0, 10))); } catch (e) { /* 저장소 막힘 */ }
    const a = this.app;
    if (s.prefs && typeof s.prefs === 'object' && !a.hadPrefs) {
      Object.assign(a.prefs, s.prefs); a.keymap.rebuild(); a.savePrefs();
      a.setEasy(a.prefs.easy !== false); a.syncPrefsUI(); a.refreshKeyHints();
    }
  }

  // ---- 창: 열기(썸네일 목록) · 새로(세트 고르기) · 복구
  async openDialog() {
    if (!(await this.hasServer())) { $('fileScene').click(); return; }
    const m = $('projModal');
    const r = await fetch('/api/projects', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ items: [] }));
    const draw = (q = '') => {
      const items = r.items.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
      $('projGrid').innerHTML = items.length ? items.map((x) => `<button class="pcard${x.file === this.file ? ' on' : ''}" data-file="${esc(x.file)}">
        ${x.thumb ? `<img alt="" loading="lazy" src="/api/project/thumb?name=${encodeURIComponent(x.file)}&t=${x.modified}">` : '<span class="noimg">그림 없음</span>'}
        <b title="${esc(x.name)}">${esc(x.name)}</b><small>${when(x.modified)}</small></button>`).join('')
        : `<p class="empty">${q ? '찾는 이름이 없습니다' : '아직 저장한 프로젝트가 없습니다 — 파일 › 저장(Ctrl+S)으로 만들 수 있습니다'}</p>`;
      $('projGrid').querySelectorAll('.pcard').forEach((b) => {
        b.onclick = () => { $('projGrid').querySelectorAll('.pcard').forEach((x) => x.classList.toggle('sel', x === b)); };
        b.ondblclick = () => { closeModal(m); this.openFile(b.dataset.file); };
        b.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); closeModal(m); this.openFile(b.dataset.file); } };
      });
      const pre = $('projGrid').querySelector('.pcard.on') || $('projGrid').querySelector('.pcard');   // 아무것도 안 골랐는데 「열기」가 엉뚱한 걸 열지 않게 — 무엇이 열릴지 보이게
      if (pre) pre.classList.add('sel');
    };
    $('projFolder').textContent = r.folder || '';
    $('projSearch').value = '';
    $('projSearch').oninput = () => draw($('projSearch').value);
    $('projSearch').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('projOpen').click(); } };
    $('projOpen').onclick = () => { const s = $('projGrid').querySelector('.pcard.sel') || $('projGrid').querySelector('.pcard'); if (s) { closeModal(m); this.openFile(s.dataset.file); } };
    $('projImport').onclick = () => { closeModal(m); $('fileScene').click(); };
    $('projShowFolder').onclick = () => fetch('/api/open-folder?which=project', { method: 'POST' });
    draw();
    openModal(m);
  }

  newDialog(presets) {
    const m = $('newModal');
    $('newGrid').innerHTML = presets.map((p) => `<button class="pcard tpl" data-id="${p.id}"><span class="tplic">${p.icon ? icon(p.icon, 26) : ''}</span><b>${esc(p.label)}</b><small>${esc(p.desc || '')}</small></button>`).join('');
    $('newGrid').querySelectorAll('.pcard').forEach((b) => { b.onclick = () => { closeModal(m); this.newProject(b.dataset.id); }; });
    openModal(m);
  }

  async recoverDialog() {
    const r = await fetch('/api/autosave', { cache: 'no-store' }).then((x) => x.json()).catch(() => ({ items: [] }));
    const m = $('recoverModal');
    $('recoverList').innerHTML = r.items.length ? r.items.map((x) => `<li><button data-name="${esc(x.file)}">${esc(x.name.replace(/^\d{8}-\d{6}_/, ''))}<small>${when(x.modified)}</small></button></li>`).join('')
      : '<li class="empty">자동 저장된 것이 없습니다(바뀐 게 있을 때 2분마다 저장됩니다)</li>';
    $('recoverList').querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        closeModal(m);
        if (!(await this.confirmDiscard())) return;
        const r = await fetch(`/api/autosave?name=${encodeURIComponent(b.dataset.name)}`);
        if (!r.ok) { this.app.warn('그 자동 저장을 읽지 못했습니다'); return; }
        const st = await r.json();
        await this.app.applyState(st);
        this.name = st.name || UNTITLED; this.file = null; this.dirty = true; this.app.state.name = this.name;
        this.showTitle(); this.remember();
        this.app.toast('자동 저장에서 되살렸습니다 — Ctrl+S 로 저장하세요');
      };
    });
    openModal(m);
  }
}
