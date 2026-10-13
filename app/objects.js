// 물체 — 상자·원기둥·공·판(기본 도형)과 GLB 모델. 회색. 물체마다 키 트랙(keys: [{t,pos,rotY,scale}])이 있어 재생하면 키 사이를 움직인다.
import * as THREE from 'three';

export const KINDS = { box: '상자', cyl: '원기둥', sphere: '공', plane: '판', person: '사람', wall: '벽', door: '문', table: '테이블', chair: '의자', car: '차', tree: '나무', stairs: '계단', glb: '모델' };
const PROPS = ['wall', 'door', 'table', 'chair', 'car', 'tree', 'stairs'];
let seq = 1;

function grey(g = 0.62) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  m.color.setScalar(Math.pow(g, 2.2));
  return m;
}

export function primitiveMesh(kind) {
  if (kind === 'person') return personMesh();
  if (PROPS.includes(kind)) return propMesh(kind);
  let g;
  if (kind === 'box') g = new THREE.BoxGeometry(1, 1, 1);
  else if (kind === 'cyl') g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  else if (kind === 'sphere') g = new THREE.SphereGeometry(0.5, 32, 20);
  else g = new THREE.BoxGeometry(1, 0.02, 1);
  g.translate(0, kind === 'plane' ? 0.01 : 0.5, 0);          // 원점 = 바닥 가운데 (바닥에 놓기 쉽게)
  const m = new THREE.Mesh(g, grey());
  m.castShadow = m.receiveShadow = true;
  return m;
}

// 블록아웃 소품 — 실제 치수의 회색 덩어리(원점 = 바닥 가운데, 앞 = +z)
function propMesh(kind) {
  const g = new THREE.Group(), m = grey();
  const box = (w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  const cyl = (r, h, x, y, z, seg = 16) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  if (kind === 'wall') box(3, 2.8, 0.2, 0, 1.4, 0);
  else if (kind === 'door') { box(0.45, 2.4, 0.2, -0.675, 1.2, 0); box(0.45, 2.4, 0.2, 0.675, 1.2, 0); box(1.8, 0.3, 0.2, 0, 2.25, 0); box(0.9, 2.1, 0.04, -0.45 + 0.45 * Math.cos(1.2), 1.05, 0.45 * Math.sin(1.2)).rotation.y = -1.2; }   // 1.8×2.4 벽 조각에 0.9 m 문짝이 70° 열림
  else if (kind === 'table') { box(1.2, 0.04, 0.8, 0, 0.73, 0); for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) box(0.05, 0.71, 0.05, x, 0.355, z); }
  else if (kind === 'chair') { box(0.45, 0.04, 0.45, 0, 0.45, 0); box(0.45, 0.45, 0.04, 0, 0.7, -0.205); for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.04, 0.43, 0.04, x, 0.215, z); }
  else if (kind === 'car') { box(1.8, 0.55, 4.4, 0, 0.6, 0); box(1.6, 0.5, 2.2, 0, 1.12, -0.2); for (const [x, z] of [[-0.8, 1.4], [0.8, 1.4], [-0.8, -1.4], [0.8, -1.4]]) { const w = cyl(0.33, 0.22, x, 0.33, z, 18); w.rotation.z = Math.PI / 2; } }
  else if (kind === 'tree') { cyl(0.18, 2.2, 0, 1.1, 0, 10); const c = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), m); c.position.set(0, 3.4, 0); c.castShadow = c.receiveShadow = true; g.add(c); }
  else if (kind === 'stairs') { for (let i = 0; i < 6; i++) box(1.2, 0.17, 0.3, 0, 0.085 + i * 0.17, 0.75 - i * 0.3); }
  return g;
}

// 사람 — 1.8 m 마네킹(다리 상자 · 몸통 원기둥 · 머리 공 · 팔), 코가 +z 쪽 = 앞
function personMesh() {
  const g = new THREE.Group(), m = grey();
  const add = (geo, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(0.34, 0.82, 0.22), 0, 0.41, 0);
  add(new THREE.CylinderGeometry(0.2, 0.17, 0.66, 20), 0, 1.15, 0);
  add(new THREE.SphereGeometry(0.13, 20, 14), 0, 1.65, 0);
  add(new THREE.BoxGeometry(0.06, 0.05, 0.08), 0, 1.63, 0.14);
  for (const x of [-0.27, 0.27]) add(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 12), x, 1.13, 0);
  return g;
}

export class SceneObject {
  constructor({ id, kind, name, src, root, size, base = null, keys = [], mixer = null, clipDur = 0, follow = false }) {
    this.id = id || `o${Date.now().toString(36)}${seq++}`;
    this.kind = kind;
    this.name = name;
    this.src = src || null;
    this.group = new THREE.Group();
    this.group.name = name;                                   // .glb 로 내보낼 때 블렌더에 이 이름으로
    this.group.add(root);
    this.group.userData.obj = this;
    this.root = root;
    this.size = size;
    this.base = base || { pos: [0, 0, 0], rotY: 0, scale: [1, 1, 1] };
    this.keys = keys.map(cloneKey).sort((a, b) => a.t - b.t);
    this.follow = follow;            // 카를 타고 — 자리(base·keys)는 카 기준, 그릴 때 카 높이를 더함
    this.locked = false;             // 잠금 — 클릭·기즈모로 안 움직임
    const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3());
    this.unit = [Math.max(sz.x, 0.01), Math.max(sz.y, 0.01), Math.max(sz.z, 0.01)];   // 배율 1 일 때의 가로·높이·세로(m) — 치수를 m 로 보여 주고 입력받는 기준
    this.mixer = mixer;
    this.clipDur = clipDur;
    this.animT = 0;
    this.sync = true;
    this.visible = true;
    this.subject = false;            // 피사체 — 카메라가 따라갈 주인공(사람이 에이전트 모드에서 지정, AI 가 get_scene 에서 봄)
    this.apply(this.base);
  }

  apply(tr) {
    this.group.position.set(tr.pos[0], tr.pos[1], tr.pos[2]);
    this.group.rotation.set(0, tr.rotY * Math.PI / 180, 0);
    this.group.scale.set(tr.scale[0], tr.scale[1], tr.scale[2]);
  }

  read() {                   // 기즈모로 끈 뒤 그룹의 지금 자리
    const g = this.group;
    return { pos: [r3(g.position.x), r3(g.position.y), r3(g.position.z)], rotY: Math.round(g.rotation.y * 180 / Math.PI * 10) / 10,
      scale: [r3(g.scale.x), r3(g.scale.y), r3(g.scale.z)] };
  }

  toJSON() {
    return { id: this.id, kind: this.kind, name: this.name, src: this.src, base: this.base, keys: this.keys, follow: this.follow, locked: this.locked, visible: this.visible, animT: this.animT, sync: this.sync, subject: this.subject || undefined };
  }
}

function r3(v) {
  return Math.round(v * 1000) / 1000;
}

export function cloneTr(tr) {
  return { pos: tr.pos.slice(), rotY: tr.rotY, scale: tr.scale.slice() };
}

function cloneKey(k) {
  return { t: k.t, ...cloneTr(k) };
}

// 트랙에 키 넣기 — 같은 시각(±1 ms)이면 바꿔 끼움, 아니면 시각순으로 끼움
export function setKey(track, t, tr) {
  const k = { t: Math.round(t * 1000) / 1000, ...cloneTr(tr) };
  const i = track.findIndex((x) => Math.abs(x.t - k.t) < 1e-3);
  if (i >= 0) track[i] = k; else { track.push(k); track.sort((a, b) => a.t - b.t); }
  return k;
}

export function removeKeyAt(track, t) {
  const i = track.findIndex((x) => Math.abs(x.t - t) < 1e-3);
  if (i >= 0) track.splice(i, 1);
  return i >= 0;
}

// t 시각의 자리 — 키 사이를 부드럽게(smoothstep). 키가 없으면 base, 범위 밖은 끝 키
export function trackAt(track, t, base) {
  if (!track.length) return base;
  if (t <= track[0].t) return track[0];
  const last = track[track.length - 1];
  if (t >= last.t) return last;
  let i = 0;
  while (i < track.length - 2 && t > track[i + 1].t) i++;
  const a = track[i], b = track[i + 1];
  const u = (t - a.t) / Math.max(b.t - a.t, 1e-6), s = u * u * (3 - 2 * u);
  const L = (x, y) => x + (y - x) * s;
  return { pos: [L(a.pos[0], b.pos[0]), L(a.pos[1], b.pos[1]), L(a.pos[2], b.pos[2])], rotY: L(a.rotY, b.rotY),
    scale: [L(a.scale[0], b.scale[0]), L(a.scale[1], b.scale[1]), L(a.scale[2], b.scale[2])] };
}
