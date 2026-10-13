// 평면도 — 위(평면)·앞(정면)·옆(측면)에서 직교 투영으로 본 도면 보기. 격자, 카메라 자리와 화각, 찍은 장면 번호·경로, 물체 동선을 겹쳐 그리고
// 번호·마커를 끌어 자리를 옮긴다. 승강로는 카 지붕 조금 위에서 자른 단면(위), 앞벽 안쪽에서 본 단면(앞·옆). 야외 세트는 멀리서 통째로.
// 그림은 선 도면: 모든 메시를 어두운 평면 채움으로 바꾸고 모서리 선(EdgesGeometry)을 자식으로 붙인다. 채움이 뒤를 가리니 숨은 선은 저절로 빠짐.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const COL = { cam: 0xffd34d, key: 0x9ad2ff, hold: 0xe08a4a, obj: 0x9ae0b4, grid: 0x8b93a1 };
const MAXK = 512;
export const PLAN_BG = 0x12161c;
const FLAT = new THREE.MeshBasicMaterial({ color: 0x1f252d, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });   // 채움은 살짝 뒤로 밀어 선과 안 겹치게
const EDGE = new THREE.LineBasicMaterial({ color: 0xb9c1cc });
const EDGE_OBJ = new THREE.LineBasicMaterial({ color: 0xf2f5f9 });
const EDGE3D = new THREE.LineBasicMaterial({ color: 0x0e1115, transparent: true, opacity: 0.85 });   // 3D 윤곽선(블렌더 Workbench Outline)
const EDGE_ANGLE = 20, TRI_MAX = 30000, TRI_BUDGET = 600000;   // 너무 큰 메시(GLB 병합 덩어리)는 채움만 — 선 계산이 수 초 걸림

function triCount(g) {
  return g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
}

function edgesFor(mesh, mat) {
  let eg = new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE);
  if (mesh.isInstancedMesh) {                                   // 인스턴스마다 행렬을 구워 선 하나로(문짝 84개 등)
    const m = new THREE.Matrix4(), parts = [];
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); parts.push(eg.clone().applyMatrix4(m)); }
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    eg.dispose(); eg = merged;
    if (!eg) return null;
  }
  const ln = new THREE.LineSegments(eg, mat);
  ln.frustumCulled = false; ln.raycast = () => {};              // 클릭 판정은 메시로만
  return ln;
}

function lineMat(color, opacity = 1) {
  return new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity });
}

function buf(n) {
  return new THREE.BufferAttribute(new Float32Array(n * 3), 3);
}

// 점 목록을 폭 w 의 띠로(보는 방향 viewDir 에 수직) — 세그먼트마다 삼각형 둘. 쓴 꼭짓점 수를 돌려준다
const _d = new THREE.Vector3(), _s = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
function fillRibbon(attr, pts, w, viewDir) {
  let k = 0;
  const put = (v) => { attr.array[k++] = v.x; attr.array[k++] = v.y; attr.array[k++] = v.z; };
  for (let i = 0; i + 1 < pts.length && k + 18 <= attr.array.length; i++) {
    _a.fromArray(pts[i]); _b.fromArray(pts[i + 1]);
    _d.subVectors(_b, _a); if (_d.lengthSq() < 1e-8) continue;
    _s.crossVectors(_d.normalize(), viewDir); if (_s.lengthSq() < 1e-8) _s.set(1, 0, 0); _s.normalize().multiplyScalar(w / 2);
    const a1 = _a.clone().add(_s), a2 = _a.clone().sub(_s), b1 = _b.clone().add(_s), b2 = _b.clone().sub(_s);
    put(a1); put(a2); put(b1); put(a2); put(b2); put(b1);
  }
  attr.needsUpdate = true;
  return k / 3;
}

function fillMat(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
}

export class PlanView {
  constructor(scene) {
    this.view = null; this.h = 10; this.off = { x: 0, y: 0, z: 0 }; this.cell = 1;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 3000);
    this.layer = new THREE.Group(); this.layer.visible = false; scene.add(this.layer);
    this.grid = null;
    this.frustum = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(COL.cam)); this.frustum.renderOrder = 3;
    this.frustum.geometry.setAttribute('position', buf(16));
    this.fan = new THREE.Mesh(new THREE.BufferGeometry(), fillMat(COL.cam, 0.22)); this.fan.renderOrder = 2;          // 카메라가 보는 범위 — 채운 부채꼴(위에서 보면 삼각형)
    this.fan.geometry.setAttribute('position', buf(18));
    this.pathMesh = new THREE.Mesh(new THREE.BufferGeometry(), fillMat(COL.cam, 0.55)); this.pathMesh.renderOrder = 2;  // 장면 경로 띠
    this.pathMesh.geometry.setAttribute('position', buf(MAXK * 6));
    this.objRibbons = new THREE.Group(); this.objRibbonMap = new Map();
    this.viewDir = new THREE.Vector3(0, -1, 0);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: COL.cam, depthTest: false })); this.body.renderOrder = 3;
    this.path = new THREE.Line(new THREE.BufferGeometry(), lineMat(COL.cam, 0.85)); this.path.renderOrder = 2;
    this.path.geometry.setAttribute('position', buf(MAXK));
    this.pts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, depthTest: false, vertexColors: true })); this.pts.renderOrder = 3;
    this.pts.geometry.setAttribute('position', buf(MAXK)); this.pts.geometry.setAttribute('color', buf(MAXK));
    this.labels = new THREE.Group();
    this.objLines = new THREE.Group();
    this.objPts = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, depthTest: false, color: COL.obj })); this.objPts.renderOrder = 3;
    this.objPts.geometry.setAttribute('position', buf(MAXK));
    this.layer.add(this.fan, this.pathMesh, this.objRibbons, this.frustum, this.body, this.path, this.pts, this.labels, this.objLines, this.objPts);
    this.path.visible = false; this.objLines.visible = false;                              // 가는 선 대신 띠
    this.labelMats = new Map(); this.objKeyMap = []; this.objLineMap = new Map();
    this.frustum.frustumCulled = this.path.frustumCulled = this.pts.frustumCulled = this.objPts.frustumCulled = this.fan.frustumCulled = this.pathMesh.frustumCulled = false;
    for (const g of [this.pts.geometry, this.objPts.geometry]) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // 자리가 매 프레임 바뀌니 경계 구는 '무한'으로(레이캐스트가 옛 경계에 막히지 않게)
    this.styled = []; this.budget = TRI_BUDGET; this.flatOn = false; this.edgesOn = false; this.outlineOn = false; this.xrayOn = false; this.xrayMats = new Map(); this.offsetMats = new Set();
  }

  // ---- 선 도면 재질: 매 프레임 불러 새로 생긴 메시(세트 다시 짓기·물체 넣기)에 붙이고, 인스턴스 행렬이 바뀌면(문 열림) 선을 다시 굽는다
  style(app) {
    const visit = (m, mat) => {
      if (!m.isMesh) return;
      if (m.userData._planMat === undefined) { m.userData._planMat = m.material; this.styled.push(m); }
      const ver = m.isInstancedMesh ? m.instanceMatrix.version : 0;
      if (m.userData._planEdges === undefined || m.userData._planVer !== ver) {
        if (m.userData._planEdges) { m.remove(m.userData._planEdges); m.userData._planEdges.geometry.dispose(); }
        const n = triCount(m.geometry);
        let ln = null;
        if (n > 0 && n <= TRI_MAX && this.budget >= n) { ln = edgesFor(m, mat); if (ln) { this.budget -= n; m.add(ln); ln.visible = this.edgesOn; ln.material = this.flatOn ? mat : EDGE3D; } }
        m.userData._planEdges = ln; m.userData._planVer = ver; m.userData._planEdgeMat = mat;
      }
    };
    app.world.group.traverse((m) => visit(m, EDGE));
    for (const o of app.objects) o.group.traverse((m) => visit(m, EDGE_OBJ));
  }

  setStyled(on) {                  // on: 평면 채움 + 선 / off: 원래 재질(썸네일·내보내기) — 3D 윤곽선이 켜져 있으면 선만 남긴다
    on = !!on;                     // three.js 는 visible === false 만 숨긴다 → 늘 true/false 로
    const edges = on || !!this.outlineOn;
    if (on === this.flatOn && edges === this.edgesOn) return;
    this.flatOn = on; this.edgesOn = edges;
    for (const m of this.styled) {
      if (m.userData._planMat === undefined) continue;
      m.material = on ? FLAT : m.userData._planMat;
      const ln = m.userData._planEdges;
      if (ln) { ln.visible = edges; ln.material = on ? (m.userData._planEdgeMat || EDGE) : EDGE3D; }
      if (!on && edges) { const mat = m.userData._planMat; if (mat && !this.offsetMats.has(mat)) { mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 1; mat.needsUpdate = true; this.offsetMats.add(mat); } }   // 면을 살짝 밀어 선이 이긴다
    }
    if (!edges) { for (const mat of this.offsetMats) { mat.polygonOffset = false; mat.needsUpdate = true; } this.offsetMats.clear(); }
  }

  setOutline(on) {                 // O — 3D 에서 모서리 선
    this.outlineOn = on;
    if (!on && !this.view) this.unstyle();
  }

  setXray(app, on) {               // Alt+Z — 세트를 반투명하게(물체·사람은 그대로)
    if (on === this.xrayOn) return;
    this.xrayOn = on;
    if (on) {
      app.world.group.traverse((m) => {
        if (!m.isMesh) return;
        const mat = m.userData._planMat || m.material;
        if (!mat || this.xrayMats.has(mat)) return;
        this.xrayMats.set(mat, { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite });
        mat.transparent = true; mat.opacity = 0.28; mat.depthWrite = false; mat.needsUpdate = true;
      });
    } else {
      for (const [mat, o] of this.xrayMats) { mat.transparent = o.transparent; mat.opacity = o.opacity; mat.depthWrite = o.depthWrite; mat.needsUpdate = true; }
      this.xrayMats.clear();
    }
  }

  unstyle() {
    this.setStyled(false);
    for (const m of this.styled) {
      if (m.userData._planEdges) { m.remove(m.userData._planEdges); m.userData._planEdges.geometry.dispose(); }
      delete m.userData._planMat; delete m.userData._planEdges; delete m.userData._planVer;
    }
    this.styled = []; this.budget = TRI_BUDGET;
  }

  // 세트·보기마다 기본 틀: h 반높이(m), cut 자르는 면의 자리(위: y, 앞: z, 옆: x), c 가운데
  defaults(app, view) {
    const sc = app.state.scene;
    if (sc === 'hoistway') return view === 'top' ? { h: 2.6, cell: 0.5, size: 20 } : { h: 4.5, cell: 0.5, size: 20 };
    if (sc === 'western') return view === 'top' ? { h: 30, cell: 5, size: 300 } : { h: 16, cell: 5, size: 300 };
    return view === 'top' ? { h: 8, cell: 1, size: 60 } : { h: 5, cell: 1, size: 60 };
  }

  center(app, t) {                 // 자동 가운데 + 사용자가 끌어 옮긴 만큼
    const sc = app.state.scene, cy = app.carY(t), o = this.off;
    let c;
    if (sc === 'hoistway') c = { x: 0, y: cy + 2.0, z: 0, cut: this.view === 'top' ? cy + 3.7 : this.view === 'front' ? 1.45 : 1.08 };
    else if (sc === 'western') c = { x: 0, y: 7, z: -10, cut: this.view === 'top' ? 150 : 40 };      // 앞·옆은 마을 바로 밖에서 잘라야 멀리 언덕이 가리지 않음
    else c = { x: 0, y: 2, z: 0, cut: this.view === 'top' ? 60 : 29 };                                   // 스튜디오: 앞·옆은 둥근 배경막(반지름 30) 안쪽에서 잘라야 막이 물체를 가리지 않음(10/13)
    return { x: c.x + o.x, y: c.y + o.y, z: c.z + o.z, cut: c.cut };
  }

  enter(app, view) {
    this.view = view;
    const d = this.defaults(app, view);
    this.h = d.h; this.cell = d.cell; this.off = { x: 0, y: 0, z: 0 };
    if (this.grid) { this.layer.remove(this.grid); this.grid.geometry.dispose(); }
    this.grid = new THREE.GridHelper(d.size, Math.round(d.size / d.cell), COL.grid, COL.grid);
    this.grid.material.depthTest = false; this.grid.material.transparent = true; this.grid.material.opacity = 0.28; this.grid.renderOrder = 1;
    if (view === 'front') this.grid.rotation.x = Math.PI / 2;                     // XY 면
    else if (view === 'side') this.grid.rotation.z = Math.PI / 2;                 // YZ 면
    this.viewDir.set(view === 'top' ? 0 : view === 'side' ? -1 : 0, view === 'top' ? -1 : 0, view === 'front' ? -1 : 0);
    this.layer.add(this.grid);
    this.layer.visible = true;
  }

  exit() {
    this.view = null; this.layer.visible = false;
    if (this.outlineOn) this.setStyled(false); else this.unstyle();
  }

  place(app, t, aspect) {          // 직교 카메라 자리
    const c = this.center(app, t), cam = this.cam, h = this.h;
    cam.left = -h * aspect; cam.right = h * aspect; cam.top = h; cam.bottom = -h;
    if (this.view === 'top') { cam.position.set(c.x, c.cut, c.z); cam.up.set(0, 0, -1); cam.lookAt(c.x, c.cut - 1, c.z); }
    else if (this.view === 'front') { cam.position.set(c.x, c.y, c.cut); cam.up.set(0, 1, 0); cam.lookAt(c.x, c.y, c.cut - 1); }
    else { cam.position.set(c.cut, c.y, c.z); cam.up.set(0, 1, 0); cam.lookAt(c.cut - 1, c.y, c.z); }
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const snap = (v) => Math.round(v / this.cell) * this.cell;                   // 격자는 세계 좌표에 맞춰 두고 가운데만 따라감
    if (this.view === 'top') this.grid.position.set(snap(c.x), 0, snap(c.z));
    else if (this.view === 'front') this.grid.position.set(snap(c.x), snap(c.y), 0);
    else this.grid.position.set(0, snap(c.y), snap(c.z));
  }

  labelMat(n, color) {
    const k = `${n}:${color}`;
    if (!this.labelMats.has(k)) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      g.fillStyle = '#' + color.toString(16).padStart(6, '0'); g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.font = 'bold 32px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 32, 34);
      this.labelMats.set(k, new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    }
    return this.labelMats.get(k);
  }

  update(app, t) {                 // 카메라 마커·화각, 장면 경로·번호, 물체 동선
    const s = this.h * 0.045;
    const cam = app.camera; cam.updateMatrixWorld();
    this.body.position.copy(cam.position); this.body.scale.setScalar(s);
    const L = this.h * 0.55, vt = Math.tan(cam.fov * Math.PI / 360) * L, ht = vt * cam.aspect;
    const corners = [[-ht, -vt], [ht, -vt], [ht, vt], [-ht, vt]].map(([x, y]) => cam.localToWorld(new THREE.Vector3(x, y, -L)));
    const F = this.frustum.geometry.attributes.position; let k = 0;
    const put = (v) => { F.array[k++] = v.x; F.array[k++] = v.y; F.array[k++] = v.z; };
    for (const c of corners) { put(cam.position); put(c); }
    for (let i = 0; i < 4; i++) { put(corners[i]); put(corners[(i + 1) % 4]); }
    F.needsUpdate = true; this.frustum.geometry.setDrawRange(0, 16);
    const FA = this.fan.geometry.attributes.position; let f = 0;
    const tri = (a, b, c) => { for (const v of [a, b, c]) { FA.array[f++] = v.x; FA.array[f++] = v.y; FA.array[f++] = v.z; } };
    for (let i = 0; i < 4; i++) tri(cam.position, corners[i], corners[(i + 1) % 4]);
    tri(corners[0], corners[1], corners[2]); tri(corners[0], corners[2], corners[3]);
    FA.needsUpdate = true; this.fan.geometry.setDrawRange(0, 18);

    const keys = app.state.camera.keys, n = Math.min(keys.length, MAXK), rec = app.state.recorded;
    const P = this.path.geometry.attributes.position, K = this.pts.geometry.attributes.position, C = this.pts.geometry.attributes.color, col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const key = keys[i], y = key.pos[1] + (key.follow ? app.carY(key.t) : 0);
      P.setXYZ(i, key.pos[0], y, key.pos[2]); K.setXYZ(i, key.pos[0], y, key.pos[2]);
      col.set(key === app.editing || key === app.selected ? COL.cam : key.hold ? COL.hold : COL.key); C.setXYZ(i, col.r, col.g, col.b);
    }
    P.needsUpdate = K.needsUpdate = C.needsUpdate = true;
    this.path.geometry.setDrawRange(0, n); this.pts.geometry.setDrawRange(0, rec ? 0 : n);
    const camPts = []; for (let i = 0; i < n; i++) camPts.push([P.getX(i), P.getY(i), P.getZ(i)]);
    this.pathMesh.geometry.setDrawRange(0, fillRibbon(this.pathMesh.geometry.attributes.position, camPts, this.h * 0.01, this.viewDir));
    while (this.labels.children.length > (rec ? 0 : n)) this.labels.remove(this.labels.children[this.labels.children.length - 1]);
    if (!rec) for (let i = 0; i < n; i++) {
      const key = keys[i], color = key === app.editing || key === app.selected ? COL.cam : key.hold ? COL.hold : COL.key;
      let sp = this.labels.children[i];
      if (!sp) { sp = new THREE.Sprite(); sp.renderOrder = 4; this.labels.add(sp); }
      const m = this.labelMat(i + 1, color); if (sp.material !== m) sp.material = m;
      sp.position.set(K.getX(i), K.getY(i), K.getZ(i)); sp.scale.setScalar(s * 1.7);
    }

    this.objKeyMap = []; const O = this.objPts.geometry.attributes.position; let m = 0;
    const seen = new Set();
    for (const o of app.objects) {
      if (!o.keys.length) continue;
      const pos = o.keys.map((kk) => [kk.pos[0], kk.pos[1] + (o.follow ? app.carY(kk.t) : 0), kk.pos[2]]);
      for (let i = 0; i < pos.length && m < MAXK; i++) { O.setXYZ(m, pos[i][0], pos[i][1], pos[i][2]); this.objKeyMap[m++] = { obj: o, key: o.keys[i] }; }
      if (pos.length >= 2) {
        seen.add(o.id);
        let rb = this.objRibbonMap.get(o.id);                                              // 동선 띠(연두, 두껍게)
        if (!rb || rb.geometry.attributes.position.count < pos.length * 6) {
          if (rb) { this.objRibbons.remove(rb); rb.geometry.dispose(); }
          rb = new THREE.Mesh(new THREE.BufferGeometry(), fillMat(COL.obj, 0.9)); rb.renderOrder = 2; rb.frustumCulled = false;
          rb.geometry.setAttribute('position', buf(Math.max(pos.length, 8) * 6));
          this.objRibbons.add(rb); this.objRibbonMap.set(o.id, rb);
        }
        rb.geometry.setDrawRange(0, fillRibbon(rb.geometry.attributes.position, pos, this.h * 0.018, this.viewDir));
        let ln = this.objLineMap.get(o.id);
        if (!ln || ln.geometry.attributes.position.count < pos.length) {
          if (ln) { this.objLines.remove(ln); ln.geometry.dispose(); }
          ln = new THREE.Line(new THREE.BufferGeometry(), lineMat(COL.obj, 0.9)); ln.renderOrder = 2; ln.frustumCulled = false;
          ln.geometry.setAttribute('position', buf(Math.max(pos.length, 8)));
          this.objLines.add(ln); this.objLineMap.set(o.id, ln);
        }
        const A = ln.geometry.attributes.position;
        pos.forEach((p, i) => A.setXYZ(i, p[0], p[1], p[2])); A.needsUpdate = true; ln.geometry.setDrawRange(0, pos.length);
      }
    }
    for (const [id, ln] of this.objLineMap) if (!seen.has(id)) { this.objLines.remove(ln); ln.geometry.dispose(); this.objLineMap.delete(id); }
    for (const [id, rb] of this.objRibbonMap) if (!seen.has(id)) { this.objRibbons.remove(rb); rb.geometry.dispose(); this.objRibbonMap.delete(id); }
    O.needsUpdate = true; this.objPts.geometry.setDrawRange(0, m);
  }

  unitsPerPx(viewH) {
    return (2 * this.h) / viewH;
  }

  delta(dx, dy, viewH) {            // 화면 픽셀 이동 → 세계 좌표 이동(보기마다 축이 다름)
    const u = this.unitsPerPx(viewH);
    if (this.view === 'top') return { x: dx * u, y: 0, z: dy * u };
    if (this.view === 'front') return { x: dx * u, y: -dy * u, z: 0 };
    return { x: 0, y: -dy * u, z: -dx * u };
  }

  hit(app, ndc, raycaster) {       // 마커 맞추기: 장면 번호 › 물체 키 › 카메라
    raycaster.setFromCamera(ndc, this.cam);
    raycaster.params.Points.threshold = this.h * 0.035;
    let hits = app.state.recorded ? [] : raycaster.intersectObject(this.pts);
    if (hits.length) return { kind: 'camKey', key: app.state.camera.keys[hits[0].index] };
    hits = raycaster.intersectObject(this.objPts);
    if (hits.length && this.objKeyMap[hits[0].index]) return { kind: 'objKey', ...this.objKeyMap[hits[0].index] };
    hits = raycaster.intersectObject(this.body);
    if (hits.length) return { kind: 'cam' };
    return null;
  }
}
