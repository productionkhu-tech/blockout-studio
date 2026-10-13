// 카메라 경로 — 키프레임(시각 · 위치 · 바라보는 점 · 롤 · 렌즈 mm · 카에 붙음 · 멈춤) 사이를 부드럽게 잇는다.
// 보간은 시간 간격을 반영한 Catmull-Rom(에르미트) — 키 사이 속도가 자연스럽고, '멈춤' 키에서는 접선을 0 으로 둬서 천천히 서고 출발한다.
import * as THREE from 'three';

export function sortKeys(keys) {
  return keys.slice().sort((a, b) => a.t - b.t);
}

function tangent(keys, i, field, comp) {
  const k = keys[i];
  if (k.hold) return 0;
  const v = (key) => (comp === null ? key[field] : key[field][comp]);
  const prev = keys[i - 1], next = keys[i + 1];
  if (prev && next) return (v(next) - v(prev)) / Math.max(next.t - prev.t, 1e-6);
  if (next) return (v(next) - v(k)) / Math.max(next.t - k.t, 1e-6);
  if (prev) return (v(k) - v(prev)) / Math.max(k.t - prev.t, 1e-6);
  return 0;
}

function hermite(p0, m0, p1, m1, u, dt) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * dt * m1;
}

// t 시각의 카메라 상태 — { pos, target, roll, mm, follow } (pos·target 은 follow 비율만큼 카 기준). keys 는 시각순이어야 한다.
export function sample(keys, t) {
  if (keys.length === 0) return null;
  if (keys.length === 1 || t <= keys[0].t) return clone(keys[0]);
  const last = keys[keys.length - 1];
  if (t >= last.t) return clone(last);
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  if (b.cut) return clone(a);                                   // 컷: 앞 장면에 머물다 이 장면 시각에 바로 바뀜(블렌더의 카메라-마커 바인딩)
  const dt = Math.max(b.t - a.t, 1e-6);
  const u = (t - a.t) / dt;
  const out = { pos: [0, 0, 0], target: [0, 0, 0], roll: 0, mm: 35, follow: 0 };
  for (let c = 0; c < 3; c++) {
    out.pos[c] = hermite(a.pos[c], tangent(keys, i, 'pos', c), b.pos[c], tangent(keys, i + 1, 'pos', c), u, dt);
    out.target[c] = hermite(a.target[c], tangent(keys, i, 'target', c), b.target[c], tangent(keys, i + 1, 'target', c), u, dt);
  }
  out.roll = hermite(a.roll, tangent(keys, i, 'roll', null), b.roll, tangent(keys, i + 1, 'roll', null), u, dt);
  out.mm = hermite(a.mm, tangent(keys, i, 'mm', null), b.mm, tangent(keys, i + 1, 'mm', null), u, dt);
  const s = u * u * (3 - 2 * u);
  out.follow = (a.follow ? 1 : 0) * (1 - s) + (b.follow ? 1 : 0) * s;
  return out;
}

function clone(k) {
  return { pos: k.pos.slice(), target: k.target.slice(), roll: k.roll, mm: k.mm, follow: k.follow ? 1 : 0 };
}

export function mmToFov(mm) {            // 세로 화각(°) — 풀프레임 24 mm 세로 기준
  return 2 * Math.atan(12 / Math.max(mm, 1)) * 180 / Math.PI;
}

export function fovToMm(fov) {
  return 12 / Math.tan(fov * Math.PI / 360);
}

const _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// 샘플한 상태를 카메라에 적용. carY 는 카 높이(follow 비율만큼 더해짐), jitter 는 핸드헬드 흔들림(°)
export function applyToCamera(camera, st, carY, jitterDeg, time) {
  const fy = st.follow * carY;
  camera.position.set(st.pos[0], st.pos[1] + fy, st.pos[2]);
  _dir.set(st.target[0], st.target[1] + fy, st.target[2]);
  camera.up.copy(_up);
  camera.lookAt(_dir);
  // 핸드헬드 — 느린 흔들림(0.2~0.7 Hz)이 주, 아주 작은 떨림(약 2 Hz)만 살짝. 예전 4~7 Hz 는 '덜덜' 떨려 보였음
  const jx = jitterDeg ? jitterDeg * (0.55 * Math.sin(time * 2.1) + 0.3 * Math.sin(time * 3.7 + 0.8) + 0.08 * Math.sin(time * 11.3)) : 0;
  const jy = jitterDeg ? jitterDeg * (0.5 * Math.sin(time * 1.7 + 1.3) + 0.3 * Math.sin(time * 4.3 + 2.1) + 0.08 * Math.sin(time * 13.1)) : 0;
  const jz = jitterDeg ? jitterDeg * 0.25 * Math.sin(time * 1.3 + 0.4) : 0;
  camera.rotateX(jx * Math.PI / 180);
  camera.rotateY(jy * Math.PI / 180);
  camera.rotateZ((st.roll + jz) * Math.PI / 180);
  camera.fov = mmToFov(st.mm);
  camera.updateProjectionMatrix();
}

function r4(v) {
  return Math.round(v * 10000) / 10000;
}

// 날기(WASD) 시점 → 키. pos 는 이미 카 기준이면 그대로(follow), yaw·pitch 는 라디안
export function keyFromFly(fly, t, follow) {
  const f = flyForward(fly.yaw, fly.pitch);
  return {
    t: Math.round(t * 1000) / 1000,
    pos: [r4(fly.pos[0]), r4(fly.pos[1]), r4(fly.pos[2])],
    target: [r4(fly.pos[0] + f[0] * 2), r4(fly.pos[1] + f[1] * 2), r4(fly.pos[2] + f[2] * 2)],
    roll: Math.round(fly.roll * 100) / 100,
    mm: Math.round(fly.mm * 10) / 10,
    follow: !!follow,
    hold: false,
  };
}

export function flyForward(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

// 키(또는 샘플) → 날기 시점(yaw·pitch)
export function flyFromKey(k) {
  const dx = k.target[0] - k.pos[0], dy = k.target[1] - k.pos[1], dz = k.target[2] - k.pos[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return { pos: k.pos.slice(), yaw: Math.atan2(-dx, -dz), pitch: Math.asin(Math.min(Math.max(dy / len, -1), 1)), roll: k.roll, mm: k.mm };
}

// 녹화한 원본 샘플(촘촘)을 0.25 s 간격 키로 — 앞뒤 ±win 초 평균으로 손떨림을 걷어 냄
export function resampleRecording(samples, step = 0.25, win = 0.2) {
  if (samples.length < 2) return [];
  const T = samples[samples.length - 1].t;
  const keys = [];
  for (let t = 0; t <= T + 1e-6; t += step) {
    const acc = { pos: [0, 0, 0], target: [0, 0, 0], roll: 0, mm: 0, n: 0 };
    for (const s of samples) {
      if (Math.abs(s.t - t) > win) continue;
      for (let c = 0; c < 3; c++) { acc.pos[c] += s.pos[c]; acc.target[c] += s.target[c]; }
      acc.roll += s.roll; acc.mm += s.mm; acc.n++;
    }
    if (!acc.n) continue;
    keys.push({ t: Math.round(t * 1000) / 1000, pos: acc.pos.map((v) => r4(v / acc.n)), target: acc.target.map((v) => r4(v / acc.n)),
      roll: Math.round(acc.roll / acc.n * 100) / 100, mm: Math.round(acc.mm / acc.n * 10) / 10, follow: !!samples[0].follow, hold: false });
  }
  if (keys.length) { keys[0].hold = true; keys[keys.length - 1].hold = true; }
  return keys;
}
