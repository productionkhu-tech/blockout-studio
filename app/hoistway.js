// 승강로 장면 — 실제 엘리베이터 승강로 블록아웃(치수·구조·조명 기구)을 three.js 로 옮긴 것.
// 회색 규칙: 색은 넣지 않는다. 구조·무빙·조명 기구의 자리와 생김새만. 색감·팔레트는 시댄스(영상) 단계에서.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

export const XW = 1.10, ZB = -1.25, ZF = 1.50, PIT = -1.2;       // 승강로 안쪽: x ±1.10, z −1.25(뒷벽·무게추) ~ +1.50(앞벽·승강장)
export const CW0 = 8.8, CW_H = 2.6;                                // 무게추 아래끝 처음 높이 · 길이 — 카가 오른 만큼 내려온다
export const LAMP = [-0.35, 2.70, 0.36];                           // 카 지붕 작업등(카 기준)
const COVE_HH = 0.09, COVE_D = 0.045;

export const DEFAULT_PARAMS = {
  floors: 42, floorH: 3.0, carMode: 'rise', carStart: 1.0, carRamp: 1.3, carVmax: 9.0, carHold: 0.0,
  doorOpen: 0.0, carDoorOpen: 0.0, cut: 'none', handheld: 0.3, fog: 0.006, exposure: 1.3,
};
// AI(MCP) 설명서에 그대로 들어가는 세트 설명 — 세트를 고치면 여기도 같이 고칠 것(app/api.js 가 읽음)
export const HOIST_INFO = 'Elevator hoistway (indoor shaft of a 42-floor building, 3 m per floor). Inside of the shaft: x -1.10..+1.10, z -1.25 (back wall, counterweight) .. +1.50 (front wall with landing doors). '
  + 'The elevator car (cabin, 2.45 m tall) rises over time. With "ride the car" on (default), camera shots and objects that ride the car use y relative to the car floor (car roof = +2.45). '
  + 'Very tight space: keep cameras inside the shaft (|x| < 1.0, z -1.1..1.4); good spots: on the car roof looking up, beside the ropes (x 0.09), looking down the shaft.';
export const STUDIO_INFO = 'Empty photo studio: round grey floor (radius 30 m) centred on the origin, curved backdrop around it, soft key light from (6, 9, 6). Build anything near the origin (|x|, |z| < 15).';
export const DEFAULT_LIGHTS = { cove: true, coveI: 1.6, coveSides: 'side', leak: true, leakI: 1.5, carLamp: true, carLampI: 1.0, top: true, topI: 1.0, fill: 1.5 };

// 카 높이 — carMode 'stop' 이면 carHold 높이에 서 있고, 아니면 carStart 에 출발해 carRamp 초 가속 뒤 초속 carVmax 로 계속 상승
export function carY(p, t) {
  if (p.carMode === 'stop') return p.carHold || 0;
  if (t <= p.carStart) return 0;
  if (t <= p.carStart + p.carRamp) {
    const s = (t - p.carStart) / p.carRamp;
    return p.carVmax * p.carRamp * (s ** 3 - s ** 4 / 2);
  }
  return p.carVmax * p.carRamp * 0.5 + p.carVmax * (t - p.carStart - p.carRamp);
}

function mat(g, rough = 0.8, metal = 0.0) {
  const m = new THREE.MeshStandardMaterial({ roughness: rough, metalness: metal });
  m.color.setScalar(Math.pow(g, 2.2));
  return m;
}

function glow(v) {
  const m = new THREE.MeshBasicMaterial();
  m.color.setScalar(v);
  return m;
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function inst(geom, material, count, fn) {
  const im = new THREE.InstancedMesh(geom, material, count);
  for (let i = 0; i < count; i++) {
    _s.set(1, 1, 1); _q.identity();
    fn(i, _p, _s, _q);
    _m.compose(_p, _q, _s);
    im.setMatrixAt(i, _m);
  }
  im.instanceMatrix.needsUpdate = true;
  return im;
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(r, h, material, x, y, z, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  g.translate(0, h / 2, 0);                       // 원점 = 아래끝
  const m = new THREE.Mesh(g, material);
  m.position.set(x, y, z);
  return m;
}

class Helix extends THREE.Curve {
  constructor(r, pitch, len, phase) { super(); this.r = r; this.pitch = pitch; this.len = len; this.phase = phase; }
  getPoint(t, target = new THREE.Vector3()) {
    const y = t * this.len, a = this.phase + 2 * Math.PI * y / this.pitch;
    return target.set(this.r * Math.cos(a), y, this.r * Math.sin(a));
  }
}

// 꼬인 로프 — 가닥 8개가 0.21 m 마다 한 바퀴(카메라가 바짝 붙는 로프에만, len 구간) + 그 위로는 매끈한 원기둥
function strandedRope(R, len, total, material, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const rs = R * 0.277, hr = R - rs;
  const segs = Math.round(len / 0.21 * 20);
  for (let k = 0; k < 8; k++) g.add(new THREE.Mesh(new THREE.TubeGeometry(new Helix(hr, 0.21, len, 2 * Math.PI * k / 8), segs, rs, 5, false), material));
  g.add(cyl(hr - rs * 0.3, len, material, 0, 0, 0, 8));
  g.add(cyl(R, total - len, material, 0, len, 0, 14));
  return g;
}

export class Hoistway {
  constructor(params) {
    RectAreaLightUniformsLib.init();
    this.group = new THREE.Group();
    this.M = {
      wall: mat(0.42, 0.9), rail: mat(0.78, 0.45, 0.6), car: mat(0.60, 0.5, 0.25), door: mat(0.52, 0.35, 0.6), disp: mat(0.08, 0.25, 0.3),
      cwt: mat(0.92, 0.7), rope: mat(0.70, 0.45, 0.7), band: mat(0.80, 0.3, 0.85), brk: mat(0.42, 0.7), ldoor: mat(0.55, 0.35, 0.6),
      steel: mat(0.30, 0.6, 0.3), sill: mat(0.62, 0.5, 0.4), chain: mat(0.12, 0.85), guard: mat(0.88, 0.7), groove: mat(0.10, 1.0),
      led: glow(3.0), lobby: glow(1.6), top: glow(0.5),
    };
    this.build(params);
  }

  build(p) {
    const g = this.group;
    while (g.children.length) g.remove(g.children[0]);
    const N = Math.max(3, Math.round(p.floors)), fh = p.floorH;
    const TOP = N * fh;
    this.N = N; this.fh = fh; this.TOP = TOP;
    const H = TOP - PIT, YC = (TOP + PIT) / 2, ZL = ZF - ZB, ZC = (ZF + ZB) / 2;
    const M = this.M;
    this.walls = {};

    // 벽 넷(두께 10 cm) + 피트 바닥 + 꼭대기
    this.walls.left = box(0.10, H, ZL + 0.2, M.wall, -XW - 0.05, YC, ZC);
    this.walls.right = box(0.10, H, ZL + 0.2, M.wall, XW + 0.05, YC, ZC);
    this.walls.back = box(2 * XW + 0.2, H, 0.10, M.wall, 0, YC, ZB - 0.05);
    this.walls.left.userData.part = '왼쪽 벽'; this.walls.right.userData.part = '오른쪽 벽'; this.walls.back.userData.part = '뒷벽(무게추 쪽)';
    const front = new THREE.Group();
    front.userData.part = '앞벽(승강장 쪽)';
    front.add(box(2 * XW + 0.2, -PIT, 0.10, M.wall, 0, PIT / 2, ZF + 0.05));                       // 피트 쪽 앞벽
    front.add(inst(new THREE.BoxGeometry(XW - 0.50, fh, 0.10), M.wall, N, (i, pos) => pos.set(-(XW + 0.50) / 2, i * fh + fh / 2, ZF + 0.05)));
    front.add(inst(new THREE.BoxGeometry(XW - 0.50, fh, 0.10), M.wall, N, (i, pos) => pos.set((XW + 0.50) / 2, i * fh + fh / 2, ZF + 0.05)));
    front.add(inst(new THREE.BoxGeometry(1.0, fh - 2.12, 0.10), M.wall, N, (i, pos) => pos.set(0, i * fh + 2.12 + (fh - 2.12) / 2, ZF + 0.05)));
    front.add(inst(new THREE.PlaneGeometry(1.0, 2.12), M.lobby, N, (i, pos, s, q) => { pos.set(0, i * fh + 1.06, ZF + 0.12); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); }));   // 문 너머 로비(밝음)
    this.walls.front = front;
    g.add(this.walls.left, this.walls.right, this.walls.back, front);
    const pit = box(2 * XW + 0.2, 0.1, ZL + 0.2, M.wall, 0, PIT - 0.05, ZC); pit.userData.part = '피트 바닥';
    g.add(pit);
    const top = box(2 * XW, 0.02, ZL, M.top, 0, TOP + 0.01, ZC);
    top.userData.part = '꼭대기';
    g.add(top);
    const lid = box(2 * XW + 0.2, 0.3, ZL + 0.2, M.wall, 0, TOP + 0.17, ZC); lid.userData.part = '꼭대기';
    g.add(lid);

    // 패널 줄눈(세로 — 옆벽 z −0.35·0.55, 뒷벽 x 0·±0.75, 앞벽 x ±0.82 / 가로 — 반 층마다)
    const gv = new THREE.Group();
    gv.userData.part = '벽 줄눈';
    for (const zj of [-0.35, 0.55]) for (const sx of [-1, 1]) gv.add(box(0.012, H, 0.014, M.groove, sx * (XW - 0.004), YC, zj));
    for (const xj of [0, -0.75, 0.75]) gv.add(box(0.014, H, 0.012, M.groove, xj, YC, ZB + 0.004));
    for (const xj of [-0.82, 0.82]) front.add(box(0.014, H, 0.012, M.groove, xj, YC, ZF - 0.004));
    gv.add(inst(new THREE.BoxGeometry(0.012, 0.014, ZL), M.groove, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * (XW - 0.004), Math.floor(i / 2) * fh + fh / 2, ZC)));
    gv.add(inst(new THREE.BoxGeometry(2 * XW, 0.014, 0.012), M.groove, N, (i, pos) => pos.set(0, i * fh + fh / 2, ZB + 0.004)));
    front.add(inst(new THREE.BoxGeometry(XW - 0.50, 0.014, 0.012), M.groove, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * (XW + 0.50) / 2, Math.floor(i / 2) * fh + fh / 2, ZF - 0.004)));
    g.add(gv);

    // ① 코브 선반(층 바닥선 · 양옆 벽) — 선반 + 앞 립 + 립 뒤 숨은 LED (아래에서는 벽에 번지는 빛만 보임)
    const cove = new THREE.Group();
    cove.userData.part = '코브 조명 선반';
    cove.add(inst(new THREE.BoxGeometry(COVE_D, 2 * COVE_HH, ZL), M.band, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * (XW - COVE_D / 2), Math.floor(i / 2) * fh, ZC)));
    cove.add(inst(new THREE.BoxGeometry(0.012, 2 * COVE_HH + 0.025, ZL), M.band, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * (XW - COVE_D + 0.006), Math.floor(i / 2) * fh + 0.0125, ZC)));
    cove.add(inst(new THREE.BoxGeometry(0.026, 0.008, ZL - 0.02), M.led, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * (XW - 0.013), Math.floor(i / 2) * fh + COVE_HH + 0.004, ZC)));
    this.cove = cove;
    g.add(cove);

    // 승강장 문(층마다) — 문짝 둘(가운데 열림) · 스테인리스 문틀 · 문턱 · 행어 박스
    const doors = new THREE.Group();
    doors.userData.part = '승강장 문';
    this.leaves = inst(new THREE.BoxGeometry(0.474, 2.08, 0.024), M.ldoor, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * 0.243, Math.floor(i / 2) * fh + 1.05, ZF + 0.045));
    doors.add(this.leaves);
    doors.add(inst(new THREE.BoxGeometry(0.06, 2.18, 0.024), M.band, 2 * N, (i, pos) => pos.set((i % 2 ? 1 : -1) * 0.53, Math.floor(i / 2) * fh + 1.08, ZF - 0.012)));
    doors.add(inst(new THREE.BoxGeometry(1.12, 0.06, 0.024), M.band, N, (i, pos) => pos.set(0, i * fh + 2.14, ZF - 0.012)));
    doors.add(inst(new THREE.BoxGeometry(1.28, 0.12, 0.05), M.band, N, (i, pos) => pos.set(0, i * fh + 2.27, ZF - 0.025)));
    this.doors = doors;
    front.add(doors);
    g.add(inst(new THREE.BoxGeometry(1.16, 0.03, 0.08), M.sill, N, (i, pos) => pos.set(0, i * fh - 0.015, ZF - 0.03)));

    // 카 가이드레일(좌우 벽) + 브라켓 2.5 m 마다 · 무게추 레일(뒷벽) + 브라켓
    for (const sx of [-1, 1]) {
      g.add(box(0.09, H, 0.016, M.rail, sx * 0.995, YC, -0.15));
      g.add(box(0.012, H, 0.13, M.rail, sx * 1.046, YC, -0.15));
      g.add(box(0.06, H, 0.012, M.rail, sx * 0.515, YC, -1.12));
      g.add(box(0.010, H, 0.10, M.rail, sx * 0.55, YC, -1.12));
    }
    const nb = Math.floor(TOP / 2.5);
    g.add(inst(new THREE.BoxGeometry(0.052, 0.18, 0.24), M.brk, 2 * nb, (i, pos) => pos.set((i % 2 ? 1 : -1) * 1.075, Math.floor(i / 2) * 2.5 + 1.2, -0.15)));
    g.add(inst(new THREE.BoxGeometry(0.18, 0.14, 0.03), M.brk, 2 * nb, (i, pos) => pos.set((i % 2 ? 1 : -1) * 0.55, Math.floor(i / 2) * 2.5 + 0.6, -1.235)));
    g.add(inst(new THREE.BoxGeometry(0.06, 0.12, 0.10), M.brk, 2 * nb, (i, pos) => pos.set((i % 2 ? 1 : -1) * 0.55, Math.floor(i / 2) * 2.5 + 0.6, -1.18)));
    g.add(cyl(0.007, H, M.rope, 0.90, PIT, 0.32, 8));          // 조속기 로프

    // 무게추(v9 실제 구조) — 원점 = 아래끝 가운데, z −1.12
    const cw = new THREE.Group();
    cw.userData.part = '무게추';
    cw.position.set(0, CW0, -1.12);
    for (const sx of [-1, 1]) {
      cw.add(box(0.06, CW_H + 0.04, 0.18, M.steel, sx * 0.425, CW_H / 2, 0));
      cw.add(box(0.07, CW_H - 0.40, 0.09, M.steel, sx * 0.49, CW_H / 2, 0));
      cw.add(box(0.06, 0.10, 0.06, M.steel, sx * 0.33, -0.06, 0));
      const ch = cyl(0.025, 1, M.chain, sx * 0.33, -0.12, 0, 8);
      ch.scale.y = -1;                                           // 아래로
      cw.add(ch);
      sx < 0 ? (this.chainL = ch) : (this.chainR = ch);
    }
    cw.add(box(0.92, 0.12, 0.20, M.steel, 0, 0.05, 0));
    cw.add(box(0.92, 0.12, 0.20, M.steel, 0, CW_H - 0.05, 0));
    cw.add(box(0.32, 0.04, 0.12, M.steel, 0, CW_H + 0.03, 0));
    cw.add(inst(new THREE.BoxGeometry(0.80, 0.044, 0.15), M.cwt, 48, (i, pos) => pos.set(0, 0.125 + i * 0.05, 0)));
    for (const xr of [-0.09, -0.03, 0.03, 0.09]) {
      cw.add(cyl(0.027, 0.35, M.steel, xr, CW_H + 0.05, 0, 10));
      cw.add(cyl(0.016, TOP + 60, M.rope, xr, CW_H + 0.1, 0, 10));
    }
    this.cw = cw;
    g.add(cw);

    // 카 — 원점 = 카 바닥 가운데(x 0, z 0). 몸체 x ±0.80 · y 0~2.45 · z −0.85~0.55, 앞면 문 x ±0.46 · y 0~2.10
    const car = new THREE.Group();
    car.userData.part = '카(엘리베이터)';
    car.add(box(1.6, 2.45, 1.37, M.car, 0, 1.225, -0.165));
    car.add(box(0.34, 2.10, 0.06, M.car, -0.63, 1.05, 0.55));
    car.add(box(0.34, 2.10, 0.06, M.car, 0.63, 1.05, 0.55));
    car.add(box(1.6, 0.35, 0.06, M.car, 0, 2.275, 0.55));
    this.carLeaves = [box(0.455, 2.09, 0.02, M.door, -0.233, 1.045, 0.535), box(0.455, 2.09, 0.02, M.door, 0.233, 1.045, 0.535)];
    car.add(...this.carLeaves);
    car.add(box(0.26, 0.10, 0.016, M.disp, 0, 2.28, 0.588));
    car.add(box(1.24, 0.16, 0.26, M.steel, 0, 2.53, 0.36));
    car.add(box(1.72, 0.20, 0.14, M.steel, 0, 2.56, -0.15));
    for (const sx of [-1, 1]) car.add(box(0.07, 2.72, 0.14, M.steel, sx * 0.84, 1.30, -0.15));
    car.add(box(0.32, 0.10, 0.14, M.steel, 0, 2.71, -0.15));
    car.add(box(0.14, 0.07, 0.10, M.steel, LAMP[0], LAMP[1] - 0.055, LAMP[2]));
    car.add(box(0.12, 0.008, 0.08, M.led, LAMP[0], LAMP[1] - 0.018, LAMP[2]));
    car.add(box(0.28, 0.10, 0.12, M.guard, 0.18, 2.52, 0.10));
    for (const xr of [-0.09, -0.03, 0.03, 0.09]) {
      car.add(cyl(0.028, 0.32, M.steel, xr, 2.70, -0.15, 10));
      if (xr === 0.09) car.add(strandedRope(0.016, 26, TOP + 60, M.rope, xr, 2.74, -0.15));   // 카메라가 붙는 로프(v9: 꼬인 8가닥)
      else car.add(cyl(0.016, TOP + 60, M.rope, xr, 2.74, -0.15, 14));
    }
    const tube = (r, len, x, y, z, axis) => {
      const gm = new THREE.CylinderGeometry(r, r, len, 8);
      if (axis === 'z') gm.rotateX(Math.PI / 2); else if (axis === 'x') gm.rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(gm, M.guard); m.position.set(x, y, z); return m;
    };
    for (const sx of [-1, 1]) {
      car.add(tube(0.022, 1.26, sx * 0.78, 3.55, -0.17, 'z'));
      car.add(tube(0.018, 1.26, sx * 0.78, 3.02, -0.17, 'z'));
      for (const zp of [0.45, -0.17, -0.80]) car.add(tube(0.022, 1.10, sx * 0.78, 3.0, zp, 'y'));
    }
    car.add(tube(0.022, 1.60, 0, 3.55, -0.80, 'x'));
    car.add(tube(0.018, 1.60, 0, 3.02, -0.80, 'x'));
    car.add(tube(0.022, 1.10, 0, 3.0, -0.80, 'y'));
    this.carLamp = new THREE.SpotLight(0xffffff, 10, 14, 1.05, 0.6, 2);
    this.carLamp.position.set(LAMP[0], LAMP[1], LAMP[2]);
    this.carLamp.target.position.set(LAMP[0], LAMP[1] + 5, LAMP[2]);
    car.add(this.carLamp, this.carLamp.target);
    this.car = car;
    g.add(car);
    const names = new Map([[M.rail, '가이드레일'], [M.brk, '레일 브라켓'], [M.sill, '승강장 문턱'], [M.rope, '조속기 로프']]);
    for (const c of g.children) if (!c.userData.part) c.userData.part = names.get(c.material) || '승강로';   // 나머지 조각 이름(에이전트 모드에서 배경 고르기)

    // 빛 — 카메라 가까운 세 층의 코브(RectArea ×2)·문틈(Point), 꼭대기, 아주 약한 바탕
    this.coveLights = [];
    this.leakLights = [];
    for (let i = 0; i < 3; i++) {
      for (const sx of [-1, 1]) {
        const l = new THREE.RectAreaLight(0xffffff, 6, ZL - 0.1, 0.05);
        l.userData.sx = sx;
        g.add(l);
        this.coveLights.push(l);
      }
      const pl = new THREE.PointLight(0xffffff, 2.0, 4.5, 2);
      g.add(pl);
      this.leakLights.push(pl);
    }
    this.topLight = new THREE.PointLight(0xffffff, 40, 0, 1.4);
    this.topLight.position.set(0, TOP - 0.5, ZC);
    g.add(this.topLight);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.03);
    g.add(this.hemi);
  }

  // 매 프레임: 카·무게추·문·조명 자리 — t 시각, camY 카메라 높이(조명을 가까운 층에 둠)
  update(p, L, t, camY) {
    const fh = this.fh, N = this.N;
    const cy = carY(p, t);
    this.car.position.y = cy;
    const cwy = CW0 - cy;
    this.cw.position.y = cwy;
    const chainLen = Math.max(cwy - 0.12 - PIT, 0.1);
    this.chainL.scale.y = -chainLen; this.chainR.scale.y = -chainLen;

    // 카 문 · 카가 선 층의 승강장 문
    const co = p.carDoorOpen * 0.455;
    this.carLeaves[0].position.x = -0.233 - co; this.carLeaves[1].position.x = 0.233 + co;
    const k = Math.round(cy / fh);
    const atFloor = Math.abs(cy - k * fh) < 0.35 && k >= 0 && k < N;
    const doorKey = `${atFloor ? k : -1}:${p.doorOpen}`;
    if (doorKey !== this._doorKey) {                           // 문짝 84개 행렬은 열린 층·열림량이 바뀔 때만
      this._doorKey = doorKey;
      for (let i = 0; i < 2 * N; i++) {
        const fl = Math.floor(i / 2), sx = i % 2 ? 1 : -1;
        const o = (atFloor && fl === k) ? p.doorOpen * 0.48 : 0;
        _s.set(1, 1, 1); _q.identity(); _p.set(sx * (0.243 + o), fl * fh + 1.05, ZF + 0.045);
        _m.compose(_p, _q, _s);
        this.leaves.setMatrixAt(i, _m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }

    // 조명 — 카메라 높이 둘레 세 층
    const k0 = Math.min(Math.max(Math.round(camY / fh), 1), N - 2);
    const ZC = (ZF + ZB) / 2;
    for (let i = 0; i < 3; i++) {
      const y = (k0 - 1 + i) * fh;
      for (let s = 0; s < 2; s++) {
        const l = this.coveLights[i * 2 + s];
        const sx = l.userData.sx;
        l.visible = !!L.cove && (L.coveSides !== 'none');
        l.intensity = 6 * L.coveI;
        l.position.set(sx * (XW - 0.03), y + COVE_HH + 0.02, ZC);
        l.lookAt(sx * (XW - 0.35), y + 1.2, ZC);
      }
      const pl = this.leakLights[i];
      pl.visible = !!L.leak;
      pl.intensity = 2.0 * L.leakI;
      pl.position.set(0, y + 1.05, ZF - 0.15);
    }
    this.cove.visible = L.coveSides !== 'none';
    this.carLamp.visible = !!L.carLamp;
    this.carLamp.intensity = 10 * L.carLampI;
    this.topLight.visible = !!L.top;
    this.topLight.intensity = 40 * L.topI;

    // 단면 — 벽 하나 숨기기
    this.walls.left.visible = p.cut !== 'left';
    this.walls.right.visible = p.cut !== 'right';
    this.walls.back.visible = p.cut !== 'back';
    this.walls.front.visible = p.cut !== 'front';
    return cy;
  }
}

// 빈 스튜디오 — 모델을 올려 놓고 찍는 회색 바닥
export class Studio {
  constructor() {
    this.group = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), mat(0.45, 0.9));
    floor.rotation.x = -Math.PI / 2;
    floor.userData.part = '바닥';
    this.group.add(floor);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 20, 64, 1, true), mat(0.40, 0.95));
    back.material.side = THREE.BackSide;
    back.position.y = 10;
    back.userData.part = '배경막';
    this.group.add(back);
    const key = new THREE.SpotLight(0xffffff, 400, 60, 0.9, 0.7, 2);
    key.position.set(6, 9, 6);
    this.group.add(key, key.target);
    const fill = new THREE.PointLight(0xffffff, 60, 0, 2);
    fill.position.set(-7, 5, -3);
    this.group.add(fill);
    this.group.add(new THREE.HemisphereLight(0xffffff, 0x222222, 0.6));
  }
  update() { return 0; }
}
