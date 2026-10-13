// 에이전트 모드 · 수정 메모 — 사람이 고칠 곳(물체·배경·피사체·시간 구간·동선·카메라 장면)을 골라 메모를 남기면, AI 가 MCP 로 읽어(get_notes) 고치고 완료를 남긴다(resolve_note).
// 수동 수정 모드 = 지금까지처럼 직접 고침. 에이전트 모드에선 화면 클릭이 '고르기'라 물체가 안 움직이고, 고른 것은 보라색으로 보인다.
// 동선 그리기(P): 바닥을 찍어 길을 그림 — 에이전트 모드면 메모 대상, 수동 모드에서 물체를 골라 두었으면 그 물체가 그 길로 걷게 키를 만든다.
import * as THREE from 'three';
import { setKey, trackAt, cloneTr } from './objects.js';
import { ask, $, esc, keepFocus } from './ui.js';
import { icon } from './icons.js';
import { label as keyLabel } from './keymap.js';

const r2 = (v) => Math.round(v * 100) / 100;
const PURPLE = 0x8a38f5, PURPLE_SOFT = 0xb48cff;
export const AI_PROMPT = '블록아웃 스튜디오에 남긴 수정 메모를 get_notes 로 읽고 하나씩 반영해 줘. 메모 하나를 끝낼 때마다 resolve_note 로 완료 표시하고 무엇을 했는지 한 줄로 남겨 줘.';

export class Notes {
  constructor(app) {
    this.app = app;
    this.agent = false;
    this.sel = null;                                   // 지금 고른 것 { type, … }
    this.path = null;                                  // 그리는 중인 동선 { points: [[x,y,z]…] }
    this.filter = 'open';
    this.layer = new THREE.Group();                    // 고른 것·동선·메모 핀 — 화면에만(내보내기·썸네일엔 안 나옴)
    this.layer.renderOrder = 10;
    app.scene3.add(this.layer);
    this.pinMats = new Map();
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hoverEl = $('pickTip');
  }

  get list() { return this.app.state.notes || (this.app.state.notes = []); }

  // ---------------------------------------------------------------- 모드
  setAgent(on) {
    this.agent = !!on;
    document.body.classList.toggle('agent', this.agent);
    $('modeSwitch').querySelectorAll('button').forEach((b) => { const on = (b.dataset.mode === 'agent') === this.agent; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    if (this.agent) { this.app.stopEditing(); this.app.selectObj(null); this.app.showTab('notes'); }
    else { this.select(null); if (this.path) this.cancelPath(); }
    this.hoverEl.hidden = true;
    this.app.renderHint(); this.app.refreshObjList(); this.app.refreshStrip();
    this.app.status(!this.agent ? '수동 수정 모드 — 직접 옮기고 찍습니다' : this.app.aiReady() ? '에이전트 모드 — 고칠 곳(물체·배경·카드·타임라인 구간)을 누르고 메모를 남기면 AI 가 고칩니다'
      : '에이전트 모드 — 고칠 곳을 누르고 메모를 남기세요(AI 는 아직 연결 안 됨 — 위쪽 「AI 연결」)');
    if (this.agent) this.app.agentIntro();
  }

  // ---------------------------------------------------------------- 고르기
  hit(ndc) {                                           // 화면 한 점 → 물체 / 배경(세트 조각) / 바닥 점
    const a = this.app, cam = a.plan ? a.planV.cam : a.camera;
    this.ray.setFromCamera(ndc, cam);
    const objs = a.objects.filter((o) => o.visible).map((o) => o.group);
    const hits = this.ray.intersectObjects([...objs, a.world.group], true);
    const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
    for (const h of hits) {
      if (h.object.isLine || h.object.isLineSegments || h.object.isSprite || h.object.isPoints || !shown(h.object)) continue;
      let g = h.object;
      while (g && !g.userData.obj && !g.userData.part && g !== a.world.group) g = g.parent;
      const p = [r2(h.point.x), r2(h.point.y), r2(h.point.z)];
      if (g && g.userData.obj) { const o = g.userData.obj; return { type: o.subject ? 'subject' : 'object', id: o.id, name: o.name, point: p }; }
      if (g && g.userData.part) return { type: 'background', part: g.userData.part, point: p };
      if (g === a.world.group || h.object.userData.part) return { type: 'background', part: h.object.userData.part || this.setName(), point: p };
    }
    const v = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.ground, v)) return { type: 'point', point: [r2(v.x), 0, r2(v.z)] };
    return null;
  }

  setName() { return { western: '서부 마을', hoistway: '승강로', studio: '스튜디오' }[this.app.state.scene] || '세트'; }

  hover(ndc, x, y) {
    if (!this.agent || this.path) { this.hoverEl.hidden = true; return; }
    const t = this.hit(ndc);
    this.hoverEl.hidden = !t;
    if (!t) return;
    this.hoverEl.textContent = this.label(t);
    this.hoverEl.style.left = `${x + 14}px`; this.hoverEl.style.top = `${y + 12}px`;
  }

  select(t) {
    this.sel = t;
    this.drawSel();
    this.renderSel();
    if (t && this.agent && this.app.activeTab !== 'notes') this.app.showTab('notes');
    this.app.refreshObjList();
  }

  objTarget(o) { return { type: o.subject ? 'subject' : 'object', id: o.id, name: o.name }; }

  selectRange() {
    const r = this.app.state.range;
    if (!r) { this.app.warn('먼저 타임라인 위쪽 눈금을 끌어 구간을 잡거나, 구간 시작(Ctrl+Home)·끝(Ctrl+End)을 찍으세요'); return; }
    this.select({ type: 'range', in: r.in, out: r.out });
  }

  selectShot(k) {
    const i = this.app.state.camera.keys.indexOf(k);
    if (i >= 0) this.select({ type: 'shot', shot: i + 1, t: k.t });
  }

  toggleSubject() {                                    // 고른 물체를 피사체로(카메라가 따라가야 할 주인공) — AI 가 get_scene 에서 봄
    const t = this.sel;
    if (!t || !t.id) return;
    const o = this.app.objects.find((x) => x.id === t.id);
    if (!o) return;
    o.subject = !o.subject;
    this.select({ ...t, type: o.subject ? 'subject' : 'object' });
    this.app.refreshObjList(); this.app.showObj(); this.app.touch();
    this.app.toast(o.subject ? `「${o.name}」 = 피사체` : `「${o.name}」 피사체 해제`);
  }

  label(t) {
    if (!t) return '';
    if (t.type === 'object') return `물체 · ${t.name}`;
    if (t.type === 'subject') return `피사체 · ${t.name}`;
    if (t.type === 'background') return `배경 · ${t.part}`;
    if (t.type === 'range') return `구간 · ${t.in.toFixed(1)}–${t.out.toFixed(1)}초`;
    if (t.type === 'path') return `동선 · ${t.points.length}점 · ${this.pathLen(t.points).toFixed(1)} m`;
    if (t.type === 'shot') return `카메라 장면 ${t.shot}`;
    if (t.type === 'point') return `지점 · ${t.point[0]}, ${t.point[2]}`;
    return t.type;
  }

  renderSel() {
    const t = this.sel, chip = $('selChip');
    chip.textContent = t ? this.label(t) : '고른 것 없음';
    chip.classList.toggle('empty', !t);
    $('selSubject').hidden = !(t && t.id);
    if (t && t.id) { const o = this.app.objects.find((x) => x.id === t.id); $('selSubject').textContent = o && o.subject ? '피사체 해제' : '피사체로 지정'; }
    $('selClear').hidden = !t;
  }

  // ---------------------------------------------------------------- 동선 그리기
  togglePath() {
    if (this.path) { this.finishPath(); return; }
    this.path = { points: [] };
    document.body.classList.add('drawing');
    this.app.status('동선 그리기 — 바닥을 차례로 누르세요 · Enter 또는 더블클릭 = 끝 · Backspace = 한 점 빼기 · Esc = 그만');
    this.drawSel(); this.syncPathUI();
  }

  syncPathUI() {                                       // 「동선 그리기」 버튼 두 곳(메모 탭 · 에이전트 띠)
    const k = this.app.keymap.keys('tool.path')[0], key = k ? keyLabel(k) : '';
    for (const id of ['pathBtn', 'bannerPath']) {
      const b = $(id); if (!b) continue;
      b.classList.toggle('on', !!this.path);
      b.innerHTML = `${icon('path', 14)}${this.path ? '동선 끝내기 <small>Enter</small>' : `동선 그리기${key ? ` <small>${esc(key)}</small>` : ''}`}`;
    }
  }

  addPathPoint(ndc) {
    const t = this.hit(ndc);
    if (!t) return;
    const p = t.point.slice();
    if (t.type !== 'point') p[1] = 0;                  // 물체·벽을 눌렀어도 길은 바닥에
    const last = this.path.points[this.path.points.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[2] - last[2]) < 0.05) return;   // 더블클릭(끝내기)의 두 번째 누름
    this.path.points.push(p);
    this.drawSel();
  }

  popPathPoint() { if (this.path) { this.path.points.pop(); this.drawSel(); } }

  cancelPath() { this.path = null; document.body.classList.remove('drawing'); this.drawSel(); this.syncPathUI(); this.app.status('동선 그리기 그만'); }

  async finishPath() {
    const pts = this.path ? this.path.points : [];
    this.path = null; document.body.classList.remove('drawing'); this.syncPathUI();
    if (pts.length < 2) { this.drawSel(); this.app.warn('동선은 두 점 이상 — 바닥을 두 번 넘게 누르세요'); return; }
    const t = { type: 'path', points: pts };
    this.app.status(`동선 ${pts.length}점 · ${this.pathLen(pts).toFixed(1)} m — 무엇을 할지 메모로 남기세요(예: 보안관이 이 길로 뛰어오게)`);
    const o = this.app.selObj;
    if (!this.agent && o) {                            // 수동 모드: 고른 물체가 이 길로
      const v = await ask({ title: `「${o.name}」 이(가) 이 길로 움직이게 할까요?`, text: `${pts.length}점 · ${this.pathLen(pts).toFixed(1)} m · 지금 시각 ${this.app.time.toFixed(1)}초부터`,
        buttons: [{ label: '취소', value: null }, { label: '메모로만', value: 'note' }, { label: '뛰기 4 m/s', value: 4 }, { label: '걷기 1.4 m/s', value: 1.4, primary: true }] });
      if (typeof v === 'number') { this.walk(o, pts, v); this.select(null); return; }
      if (!v) { this.drawSel(); return; }
    }
    this.select(t);
  }

  walk(o, pts, speed) {                                // 길을 따라 키 — 시각은 거리/속도, 가는 쪽을 봄
    const a = this.app;
    a.pushHistory();
    let t = a.time, prevAng = null;
    const base = cloneTr(trackAt(o.keys, t, o.base));
    for (let i = 0; i < pts.length; i++) {
      if (i) t += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]) / speed;
      const nx = pts[Math.min(i + 1, pts.length - 1)], px = pts[Math.max(i - 1, 0)];
      const A = i < pts.length - 1 ? pts[i] : px, B = i < pts.length - 1 ? nx : pts[i];
      let ang = Math.atan2(B[0] - A[0], B[2] - A[2]) * 180 / Math.PI;
      if (prevAng !== null) { while (ang - prevAng > 180) ang -= 360; while (ang - prevAng < -180) ang += 360; }
      prevAng = ang;
      setKey(o.keys, t, { pos: [pts[i][0], base.pos[1], pts[i][2]], rotY: r2(ang), scale: base.scale.slice() });
    }
    a.recomputeTimes(); a.refreshStrip(); a.showObj(); a.touch();
    a.toast(`「${o.name}」 ${pts.length}점 길을 ${(t - a.time).toFixed(1)}초 동안 움직임`);
    this.drawSel();
  }

  pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]); return L; }

  // ---------------------------------------------------------------- 메모
  add(text, target = this.sel, author = 'user') {
    text = String(text || '').trim();
    if (!text) return null;
    const n = this.list.reduce((m, x) => Math.max(m, x.n), 0) + 1;
    const note = { id: `n${Date.now().toString(36)}${n}`, n, target: target ? JSON.parse(JSON.stringify(target)) : null, text, status: 'open', author, reply: '', created: new Date().toISOString(), updated: null };
    this.list.push(note);
    this.app.touch();
    this.render();
    return note;
  }

  update(n, { status, reply, text, author = 'ai' } = {}) {
    const note = this.list.find((x) => x.n === n);
    if (!note) return null;
    if (status && ['open', 'doing', 'done'].includes(status)) note.status = status;
    if (reply !== undefined) note.reply = String(reply);
    if (text !== undefined) note.text = String(text);
    note.updated = new Date().toISOString(); note.by = author;
    this.app.touch();
    this.render();
    return note;
  }

  remove(n) { const i = this.list.findIndex((x) => x.n === n); if (i >= 0) { this.list.splice(i, 1); this.app.touch(); this.render(); } }

  focus(note) {                                        // 메모를 누르면 그 대상으로: 물체는 고르고, 구간·장면은 그 시각, 점은 그쪽을 봄
    const a = this.app, t = note.target;
    if (!t) return;
    if (t.id) { const o = a.objects.find((x) => x.id === t.id); if (o && !this.agent) a.selectObj(o); }
    if (t.type === 'range') { a.state.range = { in: t.in, out: t.out }; a.syncRangeUI(); a.seek(t.in); }
    if (t.type === 'shot') { const k = a.state.camera.keys[t.shot - 1]; if (k) a.goto(k); }
    if (t.type === 'path' && t.points.length) a.status(`동선 ${t.points.length}점 — 3D 화면의 보라 선`);
    this.select(t);
  }

  render() { const box = $('noteList'); if (box) keepFocus(box, () => this.renderList(box)); }

  renderList(box) {
    const all = this.list, open = all.filter((x) => x.status !== 'done').length;
    $('noteCount').textContent = all.length ? `${open} 열림 · ${all.length - open} 완료` : '';
    $('tabNotesN').textContent = open ? String(open) : '';
    const items = all.filter((x) => this.filter === 'all' || (this.filter === 'open' ? x.status !== 'done' : x.status === 'done')).slice().reverse();
    const ST = { open: '열림', doing: 'AI 작업 중', done: '완료' };
    box.innerHTML = items.length ? items.map((x) => `<li class="note ${ST[x.status] ? x.status : 'open'}${x.author === 'ai' ? ' ai' : ''}" data-n="${+x.n}">
      <div class="nh"><span class="nn">${+x.n}</span>${x.target ? `<button class="chip" data-act="focus">${esc(this.label(x.target))}</button>` : '<span class="chip none">대상 없음</span>'}
        <span class="st">${ST[x.status] || '열림'}</span></div>
      <p>${x.author === 'ai' ? '<b>AI</b> ' : ''}${esc(x.text)}</p>${x.reply ? `<p class="reply"><b>AI</b> ${esc(x.reply)}</p>` : ''}
      <div class="na">${x.status === 'done' ? '<button data-act="reopen">다시 열기</button>' : '<button data-act="done">완료로</button>'}<button data-act="del" class="danger">지우기</button></div></li>`).join('')
      : `<li class="empty">${this.filter === 'done' ? '완료한 메모가 없습니다' : '메모가 없습니다 — 에이전트 모드에서 고칠 곳을 누르고 위 칸에 적으세요'}</li>`;
    box.querySelectorAll('li.note').forEach((li) => {
      const note = this.list.find((x) => x.n === +li.dataset.n);
      li.querySelectorAll('button[data-act]').forEach((b) => {
        b.onclick = () => ({ focus: () => this.focus(note), done: () => this.update(note.n, { status: 'done', author: 'user' }), reopen: () => this.update(note.n, { status: 'open', author: 'user' }), del: async () => { if (await ask({ title: `메모 ${note.n} 을(를) 지울까요?`, text: '지운 메모는 되돌릴 수 없습니다.', buttons: [{ label: '취소', value: null }, { label: '지우기', value: 1, danger: true }] })) this.remove(note.n); } })[b.dataset.act]();
      });
    });
    this.drawPins();
  }

  // ---------------------------------------------------------------- 3D 표시(고른 것 · 그리는 동선 · 메모 핀)
  pinMat(n, done) {
    const k = `${n}:${done}`;
    if (!this.pinMats.has(k)) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = done ? '#525259' : '#8a38f5'; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.font = "600 30px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 34);
      this.pinMats.set(k, new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    }
    return this.pinMats.get(k);
  }

  where(t) {                                           // 대상의 3D 자리(핀·고른 표시용)
    if (!t) return null;
    if (t.id) {
      const o = this.app.objects.find((x) => x.id === t.id);
      if (o) { const b = new THREE.Box3().setFromObject(o.group); if (!b.isEmpty()) return new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.35, (b.min.z + b.max.z) / 2); }
    }
    if (t.point) return new THREE.Vector3(t.point[0], t.point[1] + 0.35, t.point[2]);
    if (t.points && t.points.length) return new THREE.Vector3(t.points[0][0], 0.4, t.points[0][2]);
    if (t.type === 'shot') { const k = this.app.state.camera.keys[t.shot - 1]; if (k) return new THREE.Vector3(...k.pos); }
    return null;
  }

  clearLayer(tag) { for (const c of this.layer.children.filter((x) => x.userData.tag === tag)) { this.layer.remove(c); if (c.geometry) c.geometry.dispose(); } }

  line(points, color, tag, closedDots = true) {
    const v = points.map((p) => new THREE.Vector3(p[0], p[1] + 0.03, p[2]));
    if (v.length > 1) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.userData.tag = tag; l.renderOrder = 11; this.layer.add(l);
    }
    if (closedDots) {
      const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(v), new THREE.PointsMaterial({ color, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
      d.userData.tag = tag; d.renderOrder = 12; d.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); this.layer.add(d);
    }
  }

  drawSel() {
    this.clearLayer('sel');
    if (this.path) this.line(this.path.points, PURPLE_SOFT, 'sel');
    const t = this.sel;
    if (!t) return;
    if (t.type === 'path') this.line(t.points, PURPLE, 'sel');
    else if (t.id) {
      const o = this.app.objects.find((x) => x.id === t.id);
      if (o) { const b = new THREE.Box3Helper(new THREE.Box3().setFromObject(o.group), PURPLE); b.userData.tag = 'sel'; b.material.depthTest = false; b.renderOrder = 11; this.layer.add(b); }
    } else if (t.point) this.line([t.point], PURPLE, 'sel');
  }

  drawPins() {
    this.clearLayer('pin');
    if (this.app.prefs.pins === false) return;          // 설정 › 일반 › 메모 핀 보이기
    const showDone = this.app.activeTab === 'notes';
    for (const note of this.list) {
      if (note.status === 'done' && !showDone) continue;
      const p = this.where(note.target);
      if (!p) continue;
      const s = new THREE.Sprite(this.pinMat(note.n, note.status === 'done'));
      s.position.copy(p); s.scale.setScalar(0.5); s.userData.tag = 'pin'; s.userData.note = note.n; s.renderOrder = 13;
      this.layer.add(s);
      if (note.target.type === 'path') this.line(note.target.points, note.status === 'done' ? 0x5e5e66 : PURPLE, 'pin', false);
    }
  }

  frame(forExport) {                                   // studio.frame 에서 매 프레임 — 내보내기 그림엔 안 나오게, 물체 따라 핀 자리 갱신
    this.layer.visible = !forExport;
    if (forExport || !this.list.length) return;
    for (const s of this.layer.children) {
      if (s.userData.tag !== 'pin' || !s.isSprite) continue;
      const note = this.list.find((x) => x.n === s.userData.note);
      if (note && note.target && note.target.id) { const p = this.where(note.target); if (p) s.position.copy(p); }
      const d = s.position.distanceTo(this.app.camera.position);
      s.scale.setScalar(Math.max(0.25, d * 0.045));    // 멀어도 읽히게
    }
  }

  // ---------------------------------------------------------------- AI 가 읽는 꼴(get_notes · get_selection)
  describe(t) {
    if (!t) return null;
    const a = this.app, d = { ...t, label: this.label(t) };
    if (t.id) {
      const o = a.objects.find((x) => x.id === t.id);
      if (o) { const tr = trackAt(o.keys, a.time, o.base); d.now = { name: o.name, kind: o.kind, position: tr.pos.map(r2), rotation_deg: r2(tr.rotY), subject: !!o.subject, keys: o.keys.length }; }
      else d.missing = true;
    }
    if (t.type === 'range') d.shots_inside = a.state.camera.keys.map((k, i) => ({ shot: i + 1, t: k.t })).filter((x) => x.t >= t.in - 1e-3 && x.t <= t.out + 1e-3).map((x) => x.shot);
    if (t.type === 'path') d.length_m = r2(this.pathLen(t.points));
    return d;
  }
}
