// AI(MCP) 명령 — 이 앱이 스스로 내놓는 도구 목록과 실행기.
// COMMANDS 에 하나 넣으면 Claude · ChatGPT(Codex) · Cursor 의 도구 목록과 설명서(get_guide)에 저절로 들어간다 — 앱 서버(mcp_bridge.py)는 손대지 않는다.
// 규칙: ① 바꾸기 전에 pushHistory 한 번(Ctrl+Z 한 번 = AI 의 한 동작) ② confirm/alert 금지(창이 멈춰 AI 가 기다림) ③ 결과는 짧은 글 + data(JSON)
//       ④ 사람이 보는 화면에서 바로 보이게(새 물체는 톡 튀어나오고, 새 장면은 그 시점으로 감) ⑤ 설명(desc)·스키마는 영어(모델이 가장 잘 따름), 사람에게 보이는 말은 한국어.
import * as THREE from 'three';
import { KINDS, primitiveMesh, setKey, trackAt, cloneTr } from './objects.js';
import { flyFromKey, flyForward } from './campath.js';
import { hooks, stamp } from './exporter.js';
import { WEST_INFO } from './westtown.js';
import { HOIST_INFO, STUDIO_INFO } from './hoistway.js';
import { icon } from './icons.js';
import { label as keyLabel } from './keymap.js';
import { esc } from './ui.js';

const appVersion = (app) => app.version || 'dev';          // version.json (앱이 켤 때 읽음)
const DEG = Math.PI / 180;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SET_INFO = { western: WEST_INFO, hoistway: HOIST_INFO, studio: STUDIO_INFO };
const MADE_KINDS = Object.keys(KINDS).filter((k) => k !== 'glb');
const KIND_ALIAS = { cylinder: 'cyl', ball: 'sphere', floor: 'plane', ground: 'plane', human: 'person', man: 'person', woman: 'person', actor: 'person', stair: 'stairs', steps: 'stairs', cube: 'box' };

// ---------------------------------------------------------------- 공통 스키마 조각
const V3 = (d) => ({ type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: d });
const TARGET = { type: 'string', description: 'Object id or exact name (see get_scene).' };
const SIZE_PROPS = {
  size: V3('Size in meters [width x, height y, depth z] before rotation. Overrides height/scale.'),
  height: { type: 'number', description: 'Uniform resize so the object becomes this tall (meters), keeping proportions. Handy for people, trees, cars.' },
  scale: { description: 'Multiplier: one number, or [sx, sy, sz].', oneOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }] },
};

// ---------------------------------------------------------------- 값 다루기
function v3(v, what) {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(+x))) return v.map(Number);
  if (v && typeof v === 'object' && ['x', 'y', 'z'].every((k) => Number.isFinite(+v[k]))) return [+v.x, +v.y, +v.z];
  throw new Error(`${what} must be [x, y, z] in meters — got ${JSON.stringify(v)}`);
}
function num(v, what, lo = -Infinity, hi = Infinity) {
  const n = +v;
  if (!Number.isFinite(n)) throw new Error(`${what} must be a number — got ${JSON.stringify(v)}`);
  return Math.min(Math.max(n, lo), hi);
}
function list(v, what, max = 500) {
  if (!Array.isArray(v) || !v.length) throw new Error(`${what} must be a non-empty array`);
  if (v.length > max) throw new Error(`${what}: at most ${max} per call`);
  return v;
}
function kindOf(k) {
  const s = String(k || '').trim().toLowerCase();
  const id = KIND_ALIAS[s] || s;
  if (MADE_KINDS.includes(id)) return id;
  const byLabel = MADE_KINDS.find((x) => KINDS[x] === String(k).trim());
  if (byLabel) return byLabel;
  throw new Error(`unknown kind "${k}" — use one of: ${MADE_KINDS.join(', ')}`);
}
function findObj(app, target) {
  if (target === undefined || target === null || target === '') throw new Error('target (object id or name) is missing');
  const t = String(target).trim();
  const o = app.objects.find((x) => x.id === t) || app.objects.find((x) => x.name === t) || app.objects.find((x) => x.name.toLowerCase() === t.toLowerCase());
  if (!o) throw new Error(`no object "${t}" — objects: ${app.objects.map((x) => `${x.name} (${x.id})`).join(', ') || 'none'}`);
  return o;
}
function uniqueName(app, name, self) {
  if (!name) return '';
  let n = String(name).trim(), i = 2;
  const base = n;
  while (app.objects.some((o) => o !== self && o.name === n)) n = `${base} ${i++}`;
  return n;
}
function scaleFor(o, spec, cur) {             // size > height > scale → 배율
  if (spec.size !== undefined) { const s = v3(spec.size, 'size'); return [s[0] / o.unit[0], o.kind === 'plane' ? 1 : s[1] / o.unit[1], s[2] / o.unit[2]].map((x) => r3(Math.max(x, 0.01))); }
  if (spec.height !== undefined) { const k = num(spec.height, 'height', 0.01, 500) / Math.max(cur[1] * o.unit[1], 1e-6); return cur.map((x) => r3(Math.max(x * k, 0.01))); }   // 지금 비율 그대로 키만
  if (spec.scale !== undefined) { const s = Array.isArray(spec.scale) ? v3(spec.scale, 'scale') : [num(spec.scale, 'scale'), num(spec.scale, 'scale'), num(spec.scale, 'scale')]; return s.map((x) => r3(Math.max(x, 0.01))); }
  return cur;
}
const sizeOf = (o, tr) => [r2(tr.scale[0] * o.unit[0]), r2(tr.scale[1] * o.unit[1]), r2(tr.scale[2] * o.unit[2])];

function objInfo(app, o, keys = true) {
  const tr = trackAt(o.keys, app.time, o.base);
  const d = { id: o.id, name: o.name, kind: o.kind, position: tr.pos.map(r2), rotation_deg: r2(tr.rotY), size_m: sizeOf(o, tr) };
  if (o.locked) d.locked = true;
  if (!o.visible) d.visible = false;
  if (o.follow) d.rides_car = true;
  if (o.subject) d.subject = true;
  if (keys && o.keys.length) d.keys = o.keys.map((k) => ({ t: k.t, position: k.pos.map(r2), rotation_deg: r2(k.rotY) }));
  return d;
}
function shotInfo(k, i) {
  const d = { shot: i + 1, t: k.t, position: k.pos.map(r2), look_at: k.target.map(r2), lens_mm: k.mm };
  if (k.roll) d.roll_deg = k.roll;
  if (k.hold) d.hold = true;
  if (k.cut) d.cut = true;
  if (k.note) d.note = k.note;
  return d;
}
function stopCamWork(app) {                   // 장면을 고치기 전에: 재생·수정 중을 끝냄
  if (app.recording) throw new Error('the human is recording a camera move (V) right now — wait until they finish');
  if (app.mode === 'play') app.stopPlay();
  app.stopEditing();
}
function groundSpot(app, dist = 4) {          // 위치를 안 주면: 지금 보는 곳 앞 바닥
  const d = flyForward(app.fly.yaw, app.fly.pitch), f = app.fly.pos;
  return [r2(f[0] + d[0] * dist), app.state.scene === 'hoistway' ? r2(Math.max(f[1] - 1.2, -1.2)) : 0, r2(f[2] + d[2] * dist)];
}
function bounds(app, objs) {
  const box = new THREE.Box3();
  for (const o of objs) if (o.visible) box.expandByObject(o.group);
  if (box.isEmpty()) { const f = app.focusInfo(); return { c: f.c, r: f.r }; }
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  return { c: [c.x, c.y, c.z], r: Math.max(s.x, s.y, s.z, 1) * 0.6 + 1 };
}
async function postFile(kind, name, blob) {
  const r = await fetch(`/bridge/file?kind=${kind}&name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
  if (!r.ok) throw new Error(`saving ${name} failed (${r.status})`);
  return (await r.json()).path;
}
function stateJSON(app) {
  app.state.objects = app.objects.map((o) => o.toJSON());
  return JSON.stringify(app.state, null, 1);
}
async function backup(app, why) {
  try { return await postFile('backup', `${app.state.name || '장면'}_${why}_${stamp()}.json`, new Blob([stateJSON(app)], { type: 'application/json' })); } catch (e) { return null; }
}

// ---------------------------------------------------------------- 그림(AI 가 눈으로 확인)
function jpeg(canvas, q = 0.85) { return canvas.toDataURL('image/jpeg', q).split(',')[1]; }
function sheetCanvas(cols, rows, tw, th) {
  const c = document.createElement('canvas'); c.width = cols * tw; c.height = rows * th;
  const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
  return { c, g };
}
function label(g, text, x, y, f = 15) {
  g.font = `600 ${f}px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif`; g.textBaseline = 'top';
  const w = g.measureText(text).width;
  g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x + 6, y + 6, w + 12, f + 10);
  g.fillStyle = '#FF8A52'; g.fillText(text, x + 12, y + 11);
}
async function look(app, a) {
  const W = Math.round(num(a.width ?? 1024, 'width', 320, 1600)), H = Math.round(W * 9 / 16);
  const view = a.view || (app.plan || 'current');
  const out = [];
  const keys = app.state.camera.keys;
  try {
    if (view === 'top' || view === 'front' || view === 'side') {
      const prev = app.plan; app.setPlan(view);
      const pv = app.planV, keep = { off: { ...pv.off }, h: pv.h };
      const box = new THREE.Box3(), P = (p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
      for (const o of app.objects) { if (o.visible) box.expandByObject(o.group); for (const k of o.keys) P(k.pos); }
      for (const k of keys) P(k.pos);
      if (a.fit !== false && !box.isEmpty()) {                       // AI 가 볼 땐 물체·동선·카메라가 다 들어오게(사람이 보던 평면도 위치는 뒤에서 되돌림)
        pv.off = { x: 0, y: 0, z: 0 };
        const base = pv.center(app, app.time), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), asp = W / H;
        const [u, v, du, dv] = view === 'top' ? ['x', 'z', s.x, s.z] : view === 'front' ? ['x', 'y', s.x, s.y] : ['z', 'y', s.z, s.y];
        pv.off[u] = c[u] - base[u]; pv.off[v] = c[v] - base[v];
        pv.h = Math.max(dv / 2, du / 2 / asp) * 1.18 + 1.5;
      }
      let c;
      try { c = await app.renderPlan(W, H); } finally { pv.off = keep.off; pv.h = keep.h; app.setPlan(prev); }
      out.push({ data: jpeg(c), mimeType: 'image/jpeg', label: `${{ top: 'Top (plan) view', front: 'Front view (looking toward -z)', side: 'Side view' }[view]} — numbers = camera shots, yellow fans = what each shot sees, green ribbons = object paths, grid = ${app.planV.cell} m` });
    } else if (view === 'shot') {
      if (!keys.length) throw new Error('no camera shots yet');
      const i = Math.round(num(a.shot ?? 1, 'shot', 1, keys.length)) - 1;
      await app.renderAt(keys[i].t, W, H, true);
      out.push({ data: jpeg(app.canvas), mimeType: 'image/jpeg', label: `Shot ${i + 1} at ${keys[i].t} s through its camera (${keys[i].mm} mm)` });
    } else if (view === 'sheet') {
      if (!keys.length) throw new Error('no camera shots yet');
      const idx = keys.length <= 12 ? keys.map((_, i) => i) : Array.from({ length: 12 }, (_, i) => Math.round(i * (keys.length - 1) / 11));
      const cols = idx.length <= 4 ? 2 : idx.length <= 9 ? 3 : 4, rows = Math.ceil(idx.length / cols);
      const tw = Math.round(Math.min(W, 1600) / cols), th = Math.round(tw * 9 / 16);
      const { c, g } = sheetCanvas(cols, rows, tw, th);
      for (const [n, i] of idx.entries()) {
        await app.renderAt(keys[i].t, tw, th, true);
        g.drawImage(app.canvas, (n % cols) * tw, Math.floor(n / cols) * th, tw, th);
        label(g, `#${i + 1} · ${keys[i].t}s · ${keys[i].mm}mm`, (n % cols) * tw, Math.floor(n / cols) * th);
      }
      out.push({ data: jpeg(c), mimeType: 'image/jpeg', label: `Contact sheet of ${idx.length} of ${keys.length} shots` });
    } else if (view === 'around') {
      const objs = a.target ? [findObj(app, a.target)] : app.objects;
      const { c: ctr, r } = bounds(app, objs);
      const saved = { ...app.fly, pos: app.fly.pos.slice() };
      const tw = Math.round(W / 2), th = Math.round(H / 2);
      const { c, g } = sheetCanvas(2, 2, tw, th);
      const names = { 45: 'front-right (+x +z)', 135: 'back-right (+x -z)', 225: 'back-left (-x -z)', 315: 'front-left (-x +z)' };
      try {
        for (const [n, az] of [315, 45, 225, 135].entries()) {
          const el = 28 * DEG, d = r * 2.3, A = az * DEG;
          app.fly = flyFromKey({ pos: [ctr[0] + Math.sin(A) * Math.cos(el) * d, ctr[1] + Math.sin(el) * d, ctr[2] + Math.cos(A) * Math.cos(el) * d], target: ctr, roll: 0, mm: 28 });
          await app.renderAt(app.time, tw, th, false);
          g.drawImage(app.canvas, (n % 2) * tw, Math.floor(n / 2) * th, tw, th);
          label(g, `from ${names[az]}`, (n % 2) * tw, Math.floor(n / 2) * th);
        }
      } finally { app.fly = saved; }
      out.push({ data: jpeg(c), mimeType: 'image/jpeg', label: `4 views around ${a.target ? `"${objs[0].name}"` : 'the objects'} (center ${ctr.map(r2).join(', ')})` });
    } else {
      const t = a.time !== undefined ? num(a.time, 'time', 0, app.state.duration) : app.time;
      await app.renderAt(t, W, H, a.time !== undefined ? app.state.camera.keys.length > 0 : app.mode === 'play');
      out.push({ data: jpeg(app.canvas), mimeType: 'image/jpeg', label: a.time !== undefined ? `Camera path at ${r2(t)} s` : `What the user sees now (${app.plan ? `${app.plan} view` : `3D, ${app.fly.mm} mm`})` });
    }
  } finally { app.restoreSize(); }
  return out;
}

// ---------------------------------------------------------------- 명령
export const COMMANDS = [
  {
    name: 'get_scene', title: '장면 보기', readOnly: true,
    desc: 'Current state of the open Blockout Studio window: project, set, time/duration and the in/out range, viewer camera, every object (id, name, kind, position, rotation, size in meters, motion keys, subject flag) and every camera shot (time, position, look_at, lens), plus how many revision notes are open. Call this first, and again whenever unsure.',
    schema: { type: 'object', properties: { include_keys: { type: 'boolean', description: 'Include object motion keys (default true).' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const s = app.state, setOf = (id) => (/^west/.test(id) ? 'western' : /^hoist/.test(id) ? 'hoistway' : id === 'studio' ? 'studio' : '');
      const preset = ctx.PRESETS.find((p) => p.id === app._presetId && setOf(p.id) === s.scene);     // 저장본을 불러오면 드롭다운이 처음 값으로 남아 있을 수 있음 — 세트가 맞을 때만
      const f = app.fly, d = flyForward(f.yaw, f.pitch);
      return { data: {
        name: s.name, project: { name: app.projects.name, saved_file: app.projects.file, unsaved_changes: !!app.projects.dirty },
        mode: app.notes.agent ? 'agent (the human is picking things and writing revision notes for you)' : 'manual',
        set: { type: s.scene, preset: preset ? preset.id : null, label: preset ? preset.label : null },
        time: { now: r2(app.time), duration: r2(s.duration), fps: s.fps, gap_between_new_shots: s.gap, end_hold: s.tail, aspect: s.aspect, ride_car: s.scene === 'hoistway' ? !!s.follow : undefined,
          range: s.range ? { in: r2(s.range.in), out: r2(s.range.out), note: 'playback and MP4 export use only this range' } : null },
        subjects: app.objects.filter((o) => o.subject).map((o) => o.name),
        notes: { open: (s.notes || []).filter((n) => n.status !== 'done').length, total: (s.notes || []).length, hint: 'get_notes lists them' },
        viewer: { view: app.plan || '3d', mode: app.mode, position: f.pos.map(r2), looking_toward: [r2(f.pos[0] + d[0] * 5), r2(f.pos[1] + d[1] * 5), r2(f.pos[2] + d[2] * 5)], lens_mm: f.mm },
        objects: app.objects.map((o) => objInfo(app, o, a.include_keys !== false)),
        shots: s.recorded ? { recorded_path: true, length_s: r2(s.camera.keys.length ? s.camera.keys[s.camera.keys.length - 1].t : 0), note: 'camera was recorded live (V); add_shots with replace:true switches back to shots' } : s.camera.keys.map(shotInfo),
        selected: app.selObj ? app.selObj.name : null,
      } };
    },
  },
  {
    name: 'look', title: '그림으로 보기', readOnly: true,
    desc: 'Render pictures so you can SEE the scene and check your work. view: "current" (what the user sees), "shot" (through camera shot N), "sheet" (all shots side by side), "top"/"front"/"side" (labelled plan drawings: camera numbers, fields of view, motion paths, grid), "around" (4 angles around the objects or one target). Use after building or changing things.',
    schema: { type: 'object', properties: {
      view: { type: 'string', enum: ['current', 'shot', 'sheet', 'top', 'front', 'side', 'around'], description: 'Default: current.' },
      shot: { type: 'integer', minimum: 1, description: 'For view "shot": shot number (1-based).' },
      time: { type: 'number', description: 'For view "current": render the camera path at this time (s) instead of the user view.' },
      target: TARGET, width: { type: 'integer', minimum: 320, maximum: 1600, description: 'Image width in px (default 1024).' },
      fit: { type: 'boolean', description: 'Plan views: zoom to fit every object, path and camera (default true; false = what the user sees).' } }, additionalProperties: false },
    async run(app, a) {
      const images = await look(app, a);
      return { text: `${images.length} image(s)`, images };
    },
  },
  {
    name: 'new_scene', title: '새 장면(세트)', destructive: true,
    desc: 'Replace the whole scene with a set preset (the current scene is backed up to Documents first). Only when the user asked for a new/other set. Empty presets are best for building from scratch.',
    schema: (ctx) => ({ type: 'object', properties: {
      preset: { type: 'string', enum: ctx.PRESETS.map((p) => p.id), description: ctx.PRESETS.map((p) => `${p.id} = ${p.label}`).join('; ') },
      name: { type: 'string', description: 'Scene name shown in the app.' } }, required: ['preset'], additionalProperties: false }),
    async run(app, a, ctx) {
      const p = ctx.PRESETS.find((x) => x.id === a.preset);
      if (!p) throw new Error(`unknown preset — use one of ${ctx.PRESETS.map((x) => x.id).join(', ')}`);
      stopCamWork(app);
      const bak = await backup(app, '새장면전');
      await app.loadPreset(p.id);
      app.projects.setClean(a.name ? String(a.name) : app.state.name, null);    // 새 프로젝트(아직 저장 안 함)
      note(app, ctx, a._client, `새 세트: ${p.label}`);
      return { text: `Loaded set "${p.label}".${bak ? ` Previous scene backed up to ${bak}` : ''}`, data: { objects: app.objects.length, shots: app.state.camera.keys.length } };
    },
  },
  {
    name: 'add_objects', title: '물체 넣기',
    desc: 'Add grey blockout objects (several per call; they pop in one by one so the user watches it being built). Objects stand on their position (bottom-center) and face +z. Kinds: box, cyl, sphere, plane (thin floor plate), person (1.8 m mannequin), wall (3 x 2.8 x 0.2), door (wall piece with open door), table, chair, car, tree, stairs. Returns ids.',
    schema: { type: 'object', properties: { objects: { type: 'array', minItems: 1, maxItems: 300, items: { type: 'object', properties: {
      kind: { type: 'string', enum: MADE_KINDS }, name: { type: 'string', description: 'Readable unique name, e.g. "castle wall north".' },
      position: V3('[x, y, z] meters, bottom-center. y = 0 is the ground. Default: on the ground in front of the user view.'),
      rotation_deg: { type: 'number', description: 'Turn around the vertical axis. 0 = facing +z, 90 = facing +x, 180 = facing -z.' },
      ...SIZE_PROPS, locked: { type: 'boolean', description: 'Lock so the human cannot drag it by accident.' } }, required: ['kind'], additionalProperties: false } } }, required: ['objects'], additionalProperties: false },
    async run(app, a, ctx) {
      const specs = list(a.objects, 'objects', 300);
      const plan = specs.map((s, i) => ({ s, kind: kindOf(s.kind), pos: s.position !== undefined ? v3(s.position, `objects[${i}].position`) : null, rot: s.rotation_deg !== undefined ? num(s.rotation_deg, 'rotation_deg') : 0 }));
      app.pushHistory();
      const made = [], gap = Math.min(90, 1400 / plan.length);
      for (const p of plan) {
        const name = uniqueName(app, p.s.name);
        const o = app.addPrimitive(p.kind, { name: name || undefined, base: { pos: (p.pos || groundSpot(app)).map(r3), rotY: r2(p.rot), scale: [1, 1, 1] }, keys: [], follow: false, visible: true, locked: !!p.s.locked });
        o.base.scale = scaleFor(o, p.s, [1, 1, 1]);
        o.apply(o.base);
        o._pop = performance.now();
        made.push(o);
        if (plan.length > 1) await sleep(gap);
      }
      app.recomputeTimes(); app.refreshObjList(); app.refreshStrip(); app.touch();
      note(app, ctx, a._client, made.length === 1 ? `${made[0].name} 넣음` : `물체 ${made.length}개 넣음`);
      return { text: `Added ${made.length} object(s).`, data: made.map((o) => objInfo(app, o, false)) };
    },
  },
  {
    name: 'update_objects', title: '물체 고치기',
    desc: 'Move / rotate / resize / rename / lock / hide objects. If an object already has motion keys, the change is stored as a key at "time" (default: the current time) — like the app\'s auto-key; otherwise it changes the object\'s resting place.',
    schema: { type: 'object', properties: { objects: { type: 'array', minItems: 1, maxItems: 300, items: { type: 'object', properties: {
      target: TARGET, position: V3('New [x, y, z].'), move_by: V3('Move by [dx, dy, dz].'), rotation_deg: { type: 'number' }, rotate_by: { type: 'number', description: 'Degrees to add.' },
      ...SIZE_PROPS, new_name: { type: 'string' }, locked: { type: 'boolean' }, visible: { type: 'boolean' }, subject: { type: 'boolean', description: 'Mark as the subject (main character the camera should follow).' },
      time: { type: 'number', description: 'For animated objects: which key time to change (s).' } }, required: ['target'], additionalProperties: false } } }, required: ['objects'], additionalProperties: false },
    async run(app, a, ctx) {
      const specs = list(a.objects, 'objects', 300).map((s) => ({ s, o: findObj(app, s.target) }));
      app.pushHistory();
      for (const { s, o } of specs) {
        const t = s.time !== undefined ? num(s.time, 'time', 0, 3600) : app.time;
        const cur = cloneTr(trackAt(o.keys, t, o.base));
        if (s.position !== undefined) cur.pos = v3(s.position, 'position');
        if (s.move_by !== undefined) { const m = v3(s.move_by, 'move_by'); cur.pos = cur.pos.map((v, i) => v + m[i]); }
        if (s.rotation_deg !== undefined) cur.rotY = num(s.rotation_deg, 'rotation_deg');
        if (s.rotate_by !== undefined) cur.rotY += num(s.rotate_by, 'rotate_by');
        cur.scale = scaleFor(o, s, cur.scale);
        cur.pos = cur.pos.map(r3); cur.rotY = r2(cur.rotY);
        if (o.keys.length) setKey(o.keys, t, cur); else o.base = cur;
        if (s.new_name) { o.name = uniqueName(app, s.new_name, o); o.group.name = o.name; }
        if (s.locked !== undefined) o.locked = !!s.locked;
        if (s.visible !== undefined) o.visible = !!s.visible;
        if (s.subject !== undefined) o.subject = !!s.subject;
        o._pop = performance.now() - 200;
      }
      app.recomputeTimes(); app.refreshObjList(); app.refreshStrip(); if (app.selObj) app.showObj(); app.touch();
      note(app, ctx, a._client, `물체 ${specs.length}개 고침`);
      return { text: `Updated ${specs.length} object(s).`, data: specs.map(({ o }) => objInfo(app, o, true)) };
    },
  },
  {
    name: 'delete_objects', title: '물체 지우기', destructive: true,
    desc: 'Delete objects by id/name, or all objects with all:true (undoable with undo).',
    schema: { type: 'object', properties: { targets: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const objs = a.all ? app.objects.slice() : list(a.targets, 'targets', 500).map((t) => findObj(app, t));
      if (!objs.length) return { text: 'Nothing to delete.' };
      app.pushHistory();
      for (const o of objs) { if (app.selObj === o) app.selectObj(null); app.scene3.remove(o.group); }
      app.objects = app.objects.filter((o) => !objs.includes(o));
      app.recomputeTimes(); app.refreshObjList(); app.refreshStrip(); app.touch();
      note(app, ctx, a._client, `물체 ${objs.length}개 지움`);
      return { text: `Deleted ${objs.length}: ${objs.map((o) => o.name).join(', ')}. (undo restores them)` };
    },
  },
  {
    name: 'animate_object', title: '물체 움직이기',
    desc: 'Make an object move over time with keys {t, position, rotation_deg, size...}; between keys it glides smoothly. Use face_motion:true for people/cars so they turn to face where they walk. replace:true clears old keys first (keys:[] with replace:true = stop moving).',
    schema: { type: 'object', properties: { target: TARGET, keys: { type: 'array', maxItems: 200, items: { type: 'object', properties: {
      t: { type: 'number', minimum: 0, description: 'Time in seconds.' }, position: V3('[x, y, z] at time t.'), move_by: V3('Offset from the pose at time t.'), rotation_deg: { type: 'number' }, ...SIZE_PROPS },
      required: ['t'], additionalProperties: false } }, replace: { type: 'boolean' }, face_motion: { type: 'boolean', description: 'Auto-set rotation so the object faces its direction of travel.' } }, required: ['target', 'keys'], additionalProperties: false },
    async run(app, a, ctx) {
      const o = findObj(app, a.target);
      if (!Array.isArray(a.keys)) throw new Error('keys must be an array');
      const ks = a.keys.map((k, i) => ({ ...k, t: num(k.t, `keys[${i}].t`, 0, 3600) })).sort((x, y) => x.t - y.t);
      app.pushHistory();
      if (a.replace) { o.base = cloneTr(trackAt(o.keys, app.time, o.base)); o.keys = []; }
      for (const k of ks) {
        const cur = cloneTr(trackAt(o.keys, k.t, o.base));
        if (k.position !== undefined) cur.pos = v3(k.position, 'position');
        if (k.move_by !== undefined) { const m = v3(k.move_by, 'move_by'); cur.pos = cur.pos.map((v, i) => v + m[i]); }
        if (k.rotation_deg !== undefined) cur.rotY = num(k.rotation_deg, 'rotation_deg');
        cur.scale = scaleFor(o, k, cur.scale);
        cur.pos = cur.pos.map(r3);
        setKey(o.keys, k.t, cur);
      }
      if (a.face_motion && o.keys.length > 1) {                       // 가는 쪽을 보게 — 0° = +z, 각도는 앞 키와 180° 안쪽으로 이어 붙여 한 바퀴 돌지 않게
        const K = o.keys;
        let prev = null;
        for (let i = 0; i < K.length; i++) {
          const A = K[Math.max(0, i === K.length - 1 ? i - 1 : i)], B = K[Math.min(K.length - 1, i === K.length - 1 ? i : i + 1)];
          const dx = B.pos[0] - A.pos[0], dz = B.pos[2] - A.pos[2];
          let ang = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(dx, dz) / DEG : (prev ?? K[i].rotY);
          if (prev !== null) { while (ang - prev > 180) ang -= 360; while (ang - prev < -180) ang += 360; }
          K[i].rotY = r2(ang); prev = ang;
        }
      }
      app.recomputeTimes(); app.refreshObjList(); app.refreshStrip(); if (app.selObj === o) app.showObj(); app.touch();
      note(app, ctx, a._client, o.keys.length ? `${o.name} 움직임 키 ${o.keys.length}개` : `${o.name} 멈춤`);
      return { text: `${o.name}: ${o.keys.length} key(s). Scene length is now ${r2(app.state.duration)} s.`, data: objInfo(app, o, true) };
    },
  },
  {
    name: 'add_shots', title: '카메라 장면 넣기',
    desc: 'Add camera shots (keyframes of the camera move). Each shot = camera position + look_at point + lens. Shots play in time order and the camera glides between them. Without t, a shot goes after the last one plus "after" seconds (default: the scene gap, usually 1.5-2.5 s). replace:true starts a fresh camera move. The user\'s view jumps to the last new shot.',
    schema: { type: 'object', properties: { shots: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: {
      position: V3('Camera position [x, y, z]. Eye height is about 1.6.'), look_at: V3('Point the camera looks at.'),
      lens_mm: { type: 'number', minimum: 8, maximum: 300, description: '18 very wide, 24 wide, 35 normal (default), 50 portrait, 85 close-up.' },
      roll_deg: { type: 'number', description: 'Dutch tilt, -45..45.' }, t: { type: 'number', minimum: 0, description: 'Exact time (s).' },
      after: { type: 'number', minimum: 0.2, description: 'Seconds after the previous shot (if t not given).' },
      hold: { type: 'boolean', description: 'Ease in/out and pause here (smooth start/stop).' }, cut: { type: 'boolean', description: 'Hard cut to this shot instead of gliding.' },
      note: { type: 'string', description: 'Shot note for the shot list.' } }, required: ['position', 'look_at'], additionalProperties: false } },
      replace: { type: 'boolean', description: 'Delete all existing shots first.' } }, required: ['shots'], additionalProperties: false },
    async run(app, a, ctx) {
      stopCamWork(app);
      const s = app.state, keys = s.camera.keys;
      if (s.recorded && !a.replace) throw new Error('the camera is a live-recorded path — use replace:true to start shots again');
      const specs = list(a.shots, 'shots', 100).map((x, i) => ({ x, pos: v3(x.position, `shots[${i}].position`), tgt: v3(x.look_at, `shots[${i}].look_at`) }));
      for (const [i, p] of specs.entries()) if (Math.hypot(p.pos[0] - p.tgt[0], p.pos[1] - p.tgt[1], p.pos[2] - p.tgt[2]) < 0.05) throw new Error(`shots[${i}]: look_at must differ from position`);
      app.pushHistory();
      if (a.replace) { keys.length = 0; s.recorded = false; app.selected = null; }
      let last = keys.length ? keys[keys.length - 1].t : null;
      const made = [];
      for (const { x, pos, tgt } of specs) {
        const t = x.t !== undefined ? num(x.t, 't', 0, 3600) : last === null ? 0 : last + num(x.after ?? s.gap ?? 1.5, 'after', 0.2, 600);
        const k = { t: r3(t), pos: pos.map(r4), target: tgt.map(r4), roll: x.roll_deg !== undefined ? num(x.roll_deg, 'roll_deg', -45, 45) : 0, mm: r2(num(x.lens_mm ?? 35, 'lens_mm', 8, 300)), follow: !!s.follow, hold: !!x.hold, cut: !!x.cut, note: x.note ? String(x.note) : '' };
        const same = keys.findIndex((q) => Math.abs(q.t - k.t) < 1e-3);
        if (same >= 0) keys.splice(same, 1, k); else keys.push(k);
        made.push(k);
        last = Math.max(last ?? 0, k.t);
      }
      keys.sort((p, q) => p.t - q.t);
      for (const k of made) { await app.renderAt(k.t, 384, 216, true); k.thumb = app.thumbOf(); }
      app.restoreSize();
      const end = made[made.length - 1];
      app.selected = end; app.time = end.t; app.fly = flyFromKey(end); app.syncFlyUI();
      app.recomputeTimes(); app.refreshStrip(); app.flash(); app.touch();
      note(app, ctx, a._client, `카메라 장면 ${made.length}개 넣음 (전체 ${keys.length}개)`);
      return { text: `Added ${made.length} shot(s); ${keys.length} total, length ${r2(s.duration)} s.`, data: keys.map(shotInfo) };
    },
  },
  {
    name: 'update_shot', title: '카메라 장면 고치기',
    desc: 'Change one camera shot (1-based number from get_scene): position, look_at, move_by, lens, roll, time, hold, cut, note.',
    schema: { type: 'object', properties: { shot: { type: 'integer', minimum: 1 }, position: V3('New camera position.'), look_at: V3('New look-at point.'), move_by: V3('Move camera and look_at together.'),
      lens_mm: { type: 'number', minimum: 8, maximum: 300 }, roll_deg: { type: 'number' }, t: { type: 'number', minimum: 0 }, hold: { type: 'boolean' }, cut: { type: 'boolean' }, note: { type: 'string' } }, required: ['shot'], additionalProperties: false },
    async run(app, a, ctx) {
      stopCamWork(app);
      const keys = app.state.camera.keys;
      if (app.state.recorded) throw new Error('the camera is a live-recorded path, not shots');
      const i = Math.round(num(a.shot, 'shot', 1, Math.max(keys.length, 1))) - 1, k = keys[i];
      if (!k) throw new Error('no such shot');
      app.pushHistory();
      if (a.position !== undefined) k.pos = v3(a.position, 'position').map(r4);
      if (a.look_at !== undefined) k.target = v3(a.look_at, 'look_at').map(r4);
      if (a.move_by !== undefined) { const m = v3(a.move_by, 'move_by'); k.pos = k.pos.map((v, j) => r4(v + m[j])); k.target = k.target.map((v, j) => r4(v + m[j])); }
      if (a.lens_mm !== undefined) k.mm = r2(num(a.lens_mm, 'lens_mm', 8, 300));
      if (a.roll_deg !== undefined) k.roll = num(a.roll_deg, 'roll_deg', -45, 45);
      if (a.t !== undefined) { k.t = r3(num(a.t, 't', 0, 3600)); keys.sort((p, q) => p.t - q.t); }
      for (const f of ['hold', 'cut']) if (a[f] !== undefined) k[f] = !!a[f];
      if (a.note !== undefined) k.note = String(a.note);
      await app.renderAt(k.t, 384, 216, true); k.thumb = app.thumbOf(); app.restoreSize();
      app.selected = k; app.time = k.t; app.fly = flyFromKey(k); app.syncFlyUI();
      app.recomputeTimes(); app.refreshStrip(); app.touch();
      note(app, ctx, a._client, `카메라 장면 ${keys.indexOf(k) + 1} 고침`);
      return { text: `Shot ${keys.indexOf(k) + 1} updated.`, data: keys.map(shotInfo) };
    },
  },
  {
    name: 'delete_shots', title: '카메라 장면 지우기', destructive: true,
    desc: 'Delete camera shots by number (1-based), or all:true.',
    schema: { type: 'object', properties: { shots: { type: 'array', items: { type: 'integer', minimum: 1 } }, all: { type: 'boolean' } }, additionalProperties: false },
    async run(app, a, ctx) {
      stopCamWork(app);
      const keys = app.state.camera.keys;
      const gone = a.all ? keys.slice() : list(a.shots, 'shots', 500).map((n) => { const k = keys[Math.round(n) - 1]; if (!k) throw new Error(`no shot ${n}`); return k; });
      app.pushHistory();
      app.state.camera.keys = keys.filter((k) => !gone.includes(k));
      if (!app.state.camera.keys.length) app.state.recorded = false;
      if (gone.includes(app.selected)) app.selected = null;
      app.recomputeTimes(); app.time = Math.min(app.time, app.state.duration); app.refreshStrip(); app.touch();
      note(app, ctx, a._client, `카메라 장면 ${gone.length}개 지움`);
      return { text: `Deleted ${gone.length} shot(s); ${app.state.camera.keys.length} left.`, data: app.state.camera.keys.map(shotInfo) };
    },
  },
  {
    name: 'add_camera_move', title: '카메라 무빙 넣기',
    desc: 'Append a standard camera move (2-3 new shots at the end of the timeline) starting from a shot\'s camera (default: the last shot, or the user view if there are no shots). Kinds: dollyIn, dollyOut, craneUp, craneDown, trackL, trackR, arcL, arcR (orbit 35 deg around the look point), tiltUp, tiltDown, dollyZoom.',
    schema: (ctx) => ({ type: 'object', properties: { kind: { type: 'string', enum: Object.keys(ctx.MOVES), description: Object.entries(ctx.MOVES).map(([k, v]) => `${k} = ${v}`).join('; ') },
      from_shot: { type: 'integer', minimum: 1 }, duration: { type: 'number', minimum: 0.5, maximum: 60, description: 'Seconds (default 4).' }, distance: { type: 'number', minimum: 0.2, maximum: 50, description: 'Meters (default 2).' } }, required: ['kind'], additionalProperties: false }),
    async run(app, a, ctx) {
      if (!ctx.MOVES[a.kind]) throw new Error(`unknown kind — use ${Object.keys(ctx.MOVES).join(', ')}`);
      stopCamWork(app);
      const keys = app.state.camera.keys;
      if (app.state.recorded) throw new Error('the camera is a live-recorded path — add_shots with replace:true first');
      const from = a.from_shot !== undefined ? keys[Math.round(a.from_shot) - 1] : keys[keys.length - 1];
      if (a.from_shot !== undefined && !from) throw new Error('no such shot');
      if (from) app.fly = flyFromKey(from);
      const before = keys.length, P = app.prefs, saved = [P.moveDur, P.moveDist];
      P.moveDur = num(a.duration ?? 4, 'duration', 0.5, 60); P.moveDist = num(a.distance ?? 2, 'distance', 0.2, 50);
      try { app.addMove(a.kind); } finally { [P.moveDur, P.moveDist] = saved; }
      note(app, ctx, a._client, `${ctx.MOVES[a.kind]} 넣음`);
      return { text: `${ctx.MOVES[a.kind]}: added shots ${before + 1}-${app.state.camera.keys.length}. Length ${r2(app.state.duration)} s.`, data: app.state.camera.keys.map(shotInfo) };
    },
  },
  {
    name: 'set_timing', title: '시간 맞추기',
    desc: 'Change timing: total_seconds stretches/squeezes every camera shot and object key proportionally; gap = default spacing for new shots; end_hold = seconds to hold at the end; fps = 24/25/30/60 for MP4; range = [in, out] seconds limits playback and MP4 export to that part (range: null clears it).',
    schema: { type: 'object', properties: { total_seconds: { type: 'number', minimum: 1, maximum: 600 }, gap: { type: 'number', minimum: 0.2, maximum: 60 }, end_hold: { type: 'number', minimum: 0, maximum: 30 }, fps: { type: 'integer', enum: [24, 25, 30, 60] },
      range: { description: '[in, out] in seconds, or null to clear.', oneOf: [{ type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 2 }, { type: 'null' }] } }, additionalProperties: false },
    async run(app, a, ctx) {
      stopCamWork(app);
      const s = app.state;
      if (a.gap !== undefined) s.gap = r2(num(a.gap, 'gap', 0.2, 60));
      if (a.end_hold !== undefined) { s.tail = r2(num(a.end_hold, 'end_hold', 0, 30)); app.recomputeTimes(); }
      if (a.fps !== undefined) { s.fps = a.fps; const sel = document.getElementById('tFps'); if ([...sel.options].some((o) => o.value === String(a.fps))) sel.value = String(a.fps); }
      if (a.total_seconds !== undefined) app.setTotal(num(a.total_seconds, 'total_seconds', 1, 600));
      if (a.range === null) s.range = null;
      else if (a.range !== undefined) {
        const [i0, o0] = [num(a.range[0], 'range[0]', 0, s.duration), num(a.range[1], 'range[1]', 0, s.duration)];
        if (Math.abs(o0 - i0) < 0.05) throw new Error('range is too short (needs at least 0.05 s)');
        s.range = { in: r3(Math.min(i0, o0)), out: r3(Math.max(i0, o0)) };
      }
      app.syncRangeUI(); app.showGap(); app.showTail(); app.refreshStrip(); app.touch();
      note(app, ctx, a._client, `시간 맞춤 — 전체 ${r2(s.duration)} 초${s.range ? ` · 구간 ${r2(s.range.in)}–${r2(s.range.out)} 초` : ''}`);
      return { text: `Length ${r2(s.duration)} s, gap ${s.gap} s, end hold ${s.tail} s, ${s.fps} fps${s.range ? `, range ${r2(s.range.in)}-${r2(s.range.out)} s` : ''}.`, data: s.camera.keys.map(shotInfo) };
    },
  },
  {
    name: 'playback', title: '재생 · 멈춤 · 이동',
    desc: 'Show the camera move to the user: play (from the start, or from the in point of the range, by default), pause, or goto a time/shot (paused on the camera path there).',
    schema: { type: 'object', properties: { action: { type: 'string', enum: ['play', 'pause', 'goto'] }, from_start: { type: 'boolean' }, time: { type: 'number', minimum: 0 }, shot: { type: 'integer', minimum: 1 } }, required: ['action'], additionalProperties: false },
    async run(app, a, ctx) {
      const keys = app.state.camera.keys;
      if (a.action === 'play') {
        if (!app.hasMotion()) throw new Error('nothing moves yet — add_shots or animate_object first');
        if (a.from_start !== false) app.playFromStart(); else app.play();
        note(app, ctx, a._client, '재생');
        return { text: `Playing ${r2(app.state.duration)} s for the user.` };
      }
      if (a.action === 'pause') { app.pause(); return { text: `Paused at ${r2(app.time)} s.` }; }
      let t = a.time !== undefined ? num(a.time, 'time', 0, app.state.duration) : null;
      if (a.shot !== undefined) { const k = keys[Math.round(a.shot) - 1]; if (!k) throw new Error('no such shot'); t = k.t; }
      if (t === null) throw new Error('goto needs time or shot');
      app.seek(t);
      return { text: `Showing ${r2(t)} s.` };
    },
  },
  {
    name: 'set_view', title: '보는 곳 바꾸기',
    desc: 'Change what the USER sees (not the shots): mode 3d/top/front/side, and/or put the viewer camera at a position looking at a point, or frame an object nicely (focus). Use it to show the user what you built.',
    schema: { type: 'object', properties: { mode: { type: 'string', enum: ['3d', 'top', 'front', 'side'] }, position: V3('Viewer camera position.'), look_at: V3('Point to look at.'), lens_mm: { type: 'number', minimum: 8, maximum: 300 }, focus: TARGET }, additionalProperties: false },
    async run(app, a, ctx) {
      if (a.mode) app.setPlan(a.mode === '3d' ? null : a.mode);
      if (a.position || a.look_at || a.focus) {
        if (app.mode === 'play') app.stopPlay();
        app.stopEditing();
        let pos, tgt;
        if (a.focus) {
          const o = findObj(app, a.focus), { c, r } = bounds(app, [o]), A = 35 * DEG, E = 22 * DEG, d = r * 2.6;
          tgt = c; pos = [c[0] + Math.sin(A) * Math.cos(E) * d, c[1] + Math.sin(E) * d, c[2] + Math.cos(A) * Math.cos(E) * d];
        }
        if (a.position) pos = v3(a.position, 'position');
        if (a.look_at) tgt = v3(a.look_at, 'look_at');
        if (!pos) { const d = flyForward(app.fly.yaw, app.fly.pitch); pos = app.fly.pos.slice(); if (!tgt) tgt = [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]; }
        if (!tgt) { const d = flyForward(app.fly.yaw, app.fly.pitch); tgt = [pos[0] + d[0], pos[1] + d[1], pos[2] + d[2]]; }
        app.fly = flyFromKey({ pos, target: tgt, roll: 0, mm: a.lens_mm !== undefined ? num(a.lens_mm, 'lens_mm', 8, 300) : app.fly.mm });
        app.syncFlyUI();
      }
      return { text: `User view: ${app.plan || '3d'}, camera at ${app.fly.pos.map(r2).join(', ')}.` };
    },
  },
  {
    name: 'set_environment', title: '빛 · 분위기',
    desc: 'Lighting and mood of the current set: sun height/direction/strength and sky light (western set only), plus fog, exposure and handheld camera shake (all sets). E.g. evening: sun_elevation_deg 8, sun_azimuth_deg 260.',
    schema: { type: 'object', properties: { sun_elevation_deg: { type: 'number', minimum: 4, maximum: 85 }, sun_azimuth_deg: { type: 'number', minimum: 0, maximum: 360, description: '0 = sun from +z (entrance side), clockwise.' },
      sun_intensity: { type: 'number', minimum: 0, maximum: 5 }, sky_intensity: { type: 'number', minimum: 0, maximum: 3 }, fog: { type: 'number', minimum: 0, maximum: 0.03 }, exposure: { type: 'number', minimum: 0.3, maximum: 3 },
      handheld_shake_deg: { type: 'number', minimum: 0, maximum: 2, description: '0 = locked-off camera.' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const p = app.state.params, west = app.state.scene === 'western';
      const map = { sun_elevation_deg: 'sunEl', sun_azimuth_deg: 'sunAz', sun_intensity: 'sunI', sky_intensity: 'skyI', fog: 'fog', exposure: 'exposure', handheld_shake_deg: 'handheld' };
      const skipped = [];
      app.pushHistory();
      for (const [k, key] of Object.entries(map)) {
        if (a[k] === undefined) continue;
        if (['sunEl', 'sunAz', 'sunI', 'skyI'].includes(key) && !west) { skipped.push(k); continue; }
        p[key] = num(a[k], k);
      }
      for (const s of app.sliders) { const v = s.getObj()[s.key]; if (v !== undefined) { s.inp.value = v; s.out.textContent = v; } }
      app.touch();
      note(app, ctx, a._client, '빛·분위기 바꿈');
      return { text: `Environment updated.${skipped.length ? ` Ignored (western set only): ${skipped.join(', ')}` : ''}` };
    },
  },
  {
    name: 'undo', title: '되돌리기',
    desc: 'Undo (or redo with redo:true) the last changes — each of your tool calls is one step.',
    schema: { type: 'object', properties: { steps: { type: 'integer', minimum: 1, maximum: 40 }, redo: { type: 'boolean' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const n = Math.round(num(a.steps ?? 1, 'steps', 1, 40));
      let done = 0;
      for (let i = 0; i < n; i++) {
        if (a.redo ? !app.redoStack.length : !app.hist.length) break;
        await (a.redo ? app.redo() : app.undo()); done++;
      }
      note(app, ctx, a._client, `${a.redo ? '다시 함' : '되돌림'} ${done}번`);
      return { text: `${a.redo ? 'Redid' : 'Undid'} ${done} step(s).` };
    },
  },
  {
    name: 'save_project', title: '프로젝트 저장',
    desc: 'Save the project (same as File > Save in the app) into Documents\\블록아웃 스튜디오\\프로젝트 with a thumbnail. Without name it saves to the project\'s own file. With a new name it saves as that name and the app switches to it; an existing different project with that name is never overwritten unless overwrite:true (ask the user first). Returns the path.',
    schema: { type: 'object', properties: { name: { type: 'string', description: 'Project name (no extension).' }, copy: { type: 'boolean', description: 'Save a copy and keep working on the current project.' },
      overwrite: { type: 'boolean', description: 'Replace an existing different project with that name (only when the user said so).' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const name = String(a.name || app.projects.name || app.state.name || '제목 없음').replace(/\.json$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || '제목 없음';
      const path = await app.projects.writeFile(name, { copy: !!a.copy, overwrite: !!a.overwrite });
      note(app, ctx, a._client, `프로젝트 저장: ${name}`);
      return { text: `Saved to ${path}`, data: { path, name } };
    },
  },
  {
    name: 'open_project', title: '프로젝트 열기', destructive: true,
    desc: 'Without name: list saved projects (Documents\\블록아웃 스튜디오\\프로젝트, newest first). With name (or a full path to a .json): open it, replacing the current project (which is backed up first).',
    schema: { type: 'object', properties: { name: { type: 'string', description: 'Project name from the list, or a full path to a .json file.' } }, additionalProperties: false },
    async run(app, a, ctx) {
      const items = await app.projects.list();
      if (!a.name) return { text: `${items.length} saved project(s)`, data: items.map((x) => ({ name: x.name, modified: new Date(x.modified * 1000).toLocaleString('sv-SE').slice(0, 16) })) };
      const want = String(a.name).trim(), stem = want.replace(/\.json$/i, '');
      const hit = items.find((x) => x.name === stem) || items.find((x) => x.name.toLowerCase() === stem.toLowerCase());
      stopCamWork(app);
      const bak = await backup(app, '열기전');
      if (hit) await app.projects.openFile(hit.file, { ask: false });
      else {
        const r = await fetch(`/bridge/file?path=${encodeURIComponent(want)}`);
        const body = await r.json();
        if (!r.ok) throw new Error(`no project "${want}" — saved: ${items.map((x) => x.name).join(', ') || 'none'}`);
        await app.applyState(body);
        app.projects.name = body.name || stem.split(/[\\/]/).pop(); app.projects.file = null; app.projects.dirty = true; app.projects.showTitle();
      }
      note(app, ctx, a._client, `프로젝트 열기: ${hit ? hit.name : want}`);
      return { text: `Opened "${hit ? hit.name : want}".${bak ? ` Previous state backed up to ${bak}` : ''}`, data: { objects: app.objects.length, shots: app.state.camera.keys.length, notes_open: (app.state.notes || []).filter((n) => n.status !== 'done').length } };
    },
  },
  {
    name: 'get_notes', title: '수정 메모 읽기', readOnly: true,
    desc: 'Revision notes the human left in agent mode. Each note has text plus the target they picked: an object, the subject (main character), a background part of the set (e.g. "살룬"), a time range (in/out seconds), a drawn path (points on the ground), a camera shot, or a ground point. When the user says things like "fix my notes" / "메모대로 고쳐 줘": call this, do each open note with the other tools, then resolve_note it.',
    schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'done', 'all'], description: 'Default open (open + doing).' } }, additionalProperties: false },
    async run(app, a) {
      const list = (app.state.notes || []).filter((n) => (a.status === 'all' ? true : a.status === 'done' ? n.status === 'done' : n.status !== 'done'));
      return { text: `${list.length} note(s)${app.notes.agent ? ' — the human is in agent mode' : ''}`, data: {
        notes: list.map((n) => ({ note: n.n, text: n.text, status: n.status, author: n.author, reply: n.reply || undefined, target: app.notes.describe(n.target) })),
        selection_now: app.notes.describe(app.notes.sel),
      } };
    },
  },
  {
    name: 'resolve_note', title: '수정 메모 처리',
    desc: 'Update a revision note: status "doing" when you start it, "done" when finished (with a one-line reply saying what you changed, in the user\'s language), or "open" to give it back with a question in reply.',
    schema: { type: 'object', properties: { note: { type: 'integer', minimum: 1, description: 'Note number from get_notes.' }, status: { type: 'string', enum: ['doing', 'done', 'open'] }, reply: { type: 'string', description: 'What you did, or your question.' } }, required: ['note', 'status'], additionalProperties: false },
    async run(app, a, ctx) {
      const n = app.notes.update(Math.round(num(a.note, 'note', 1, 1e6)), { status: a.status, reply: a.reply !== undefined ? String(a.reply).slice(0, 500) : undefined, author: 'ai' });
      if (!n) throw new Error(`no note ${a.note} — notes: ${(app.state.notes || []).map((x) => x.n).join(', ') || 'none'}`);
      note(app, ctx, a._client, `메모 ${n.n} ${{ doing: '작업 중', done: '완료', open: '되돌려 줌' }[a.status]}${a.reply ? ` — ${String(a.reply).slice(0, 60)}` : ''}`);
      return { text: `Note ${n.n} is ${n.status}.` };
    },
  },
  {
    name: 'add_note', title: '메모 남기기',
    desc: 'Leave a note for the human in the notes list (e.g. a question, or a suggestion you did not apply). Optionally attach it to an object, a shot, a time range or a ground point.',
    schema: { type: 'object', properties: { text: { type: 'string' }, object: TARGET, shot: { type: 'integer', minimum: 1 }, range: { type: 'array', items: { type: 'number', minimum: 0 }, minItems: 2, maxItems: 2 }, point: V3('Ground point [x, y, z].') }, required: ['text'], additionalProperties: false },
    async run(app, a, ctx) {
      let target = null;
      if (a.object !== undefined) target = app.notes.objTarget(findObj(app, a.object));
      else if (a.shot !== undefined) { const k = app.state.camera.keys[Math.round(a.shot) - 1]; if (!k) throw new Error('no such shot'); target = { type: 'shot', shot: Math.round(a.shot), t: k.t }; }
      else if (a.range !== undefined) target = { type: 'range', in: r3(Math.min(+a.range[0], +a.range[1])), out: r3(Math.max(+a.range[0], +a.range[1])) };
      else if (a.point !== undefined) target = { type: 'point', point: v3(a.point, 'point').map(r2) };
      const n = app.notes.add(String(a.text).slice(0, 1000), target, 'ai');
      if (!n) throw new Error('text is empty');
      note(app, ctx, a._client, `메모 ${n.n} 남김`);
      return { text: `Note ${n.n} added.` };
    },
  },
  {
    name: 'get_selection', title: '지금 고른 것', readOnly: true,
    desc: 'What the human is pointing at right now: the picked target in agent mode (object / background part / range / path / shot / point), the selected object or shot in manual mode, the in/out range and the subject objects. Use it when they say "this", "here", "이거", "여기".',
    schema: { type: 'object', properties: {}, additionalProperties: false },
    async run(app) {
      const s = app.state, i = app.selected ? s.camera.keys.indexOf(app.selected) : -1;
      return { data: {
        mode: app.notes.agent ? 'agent' : 'manual',
        picked: app.notes.describe(app.notes.sel),
        selected_object: app.selObj ? objInfo(app, app.selObj, true) : null,
        selected_shot: i >= 0 ? shotInfo(s.camera.keys[i], i) : null,
        range: s.range ? { in: r2(s.range.in), out: r2(s.range.out) } : null,
        subjects: app.objects.filter((o) => o.subject).map((o) => o.name),
        time_now: r2(app.time),
      } };
    },
  },
  {
    name: 'export', title: '내보내기', longRunning: true,
    desc: 'Export files into Documents\\블록아웃 스튜디오\\내보내기: mp4 (the camera move as video — only the in/out range if one is set), png (current view), sheet (contact sheet), plan (plan drawing png), shots (shot list HTML + CSV), glb (scene + animated camera for Blender: File > Import > glTF). Returns file paths.',
    schema: { type: 'object', properties: { kind: { type: 'string', enum: ['mp4', 'png', 'sheet', 'plan', 'shots', 'glb'] }, resolution: { type: 'integer', enum: [480, 720, 1080, 1440, 2160], description: 'Video/image height in px (default 1080).' } }, required: ['kind'], additionalProperties: false },
    async run(app, a, ctx) {
      stopCamWork(app);
      const files = [], savedRes = app.exRes;
      hooks.pending = [];
      hooks.save = (blob, name) => postFile('export', name, blob).then((p) => { files.push(p); return p; });
      try {
        if (a.resolution) app.exRes = String(a.resolution);
        await app.doExport(a.kind, { throwErrors: true });
        await Promise.all(hooks.pending);
      } finally { hooks.save = null; hooks.pending = []; app.exRes = savedRes; }
      if (!files.length) throw new Error('nothing was exported');
      note(app, ctx, a._client, `${a.kind.toUpperCase()} 저장`);
      return { text: `Exported:\n${files.join('\n')}`, data: { files } };
    },
  },
];

// ---------------------------------------------------------------- 설명서(사람이 쓴 app/mcp_guide.md + 앱에서 자동으로 뽑는 부분)
let guideText = null;
async function handGuide() {
  if (guideText === null) { try { guideText = await (await fetch('app/mcp_guide.md', { cache: 'no-store' })).text(); } catch (e) { guideText = ''; } }
  return guideText;
}
function kindTable() {
  return MADE_KINDS.map((k) => {
    const m = primitiveMesh(k), s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    return `| ${k} | ${KINDS[k]} | ${r2(s.x)} x ${r2(s.y)} x ${r2(s.z)} |`;
  }).join('\n');
}
function shortcutTable(app) {                  // 사람이 쓰는 단축키(지금 설정 그대로) — 아이에게 "직접 해 보기"를 알려 줄 때
  return Object.entries(app.actions).filter(([id, a]) => a.group && app.keymap.keys(id).length)
    .map(([id, a]) => `- ${app.keymap.keys(id).map(keyLabel).join(' / ')} — ${a.label} (${a.group})`).join('\n');
}
export const INSTRUCTIONS = 'Blockout Studio (블록아웃 스튜디오) is a grey-box 3D previs app open on the user\'s PC. Your tool calls edit that window live while the user watches. '
  + 'Units: meters, seconds, degrees. y is up, ground y = 0; objects stand on their bottom-center and face +z. '
  + 'Flow: get_scene -> add_objects / animate_object -> add_shots -> look (check the pictures, fix) -> playback. Every change is undoable (undo). '
  + 'The human can switch to agent mode, pick things (objects, background parts, a time range, a path, a shot) and leave revision notes: when asked to follow them, get_notes -> fix each -> resolve_note. '
  + 'Read get_guide once for sets, sizes and camera tips. Users may be kids or planners: reply in their language, simply and warmly, and show results.';

function buildGuide(app, ctx, hand) {
  const cmds = COMMANDS.map((c) => `- \`${c.name}\` (${c.title}) — ${c.desc}`).join('\n');
  const sets = ctx.PRESETS.map((p) => `- \`${p.id}\` — ${p.label}`).join('\n');
  const info = Object.entries(SET_INFO).map(([k, v]) => `- **${k}**: ${v}`).join('\n');
  const moves = Object.entries(ctx.MOVES).map(([k, v]) => `\`${k}\` ${v}`).join(' · ');
  return `${hand.trim()}

## Tools (auto — app ${appVersion(app)})
${cmds}

## Set presets (auto)
${sets}

## Set layouts (auto, from each set's code)
${info}

## Object kinds and default sizes in meters (auto: width x height x depth)
| kind | 이름 | size |
|---|---|---|
${kindTable()}

## Camera moves for add_camera_move (auto)
${moves}

## Keyboard shortcuts the human uses (auto, the app's current keymap)
${shortcutTable(app)}
`;
}

export async function describe(app, ctx) {
  const hand = await handGuide();
  if (app.versionReady) await app.versionReady;
  return {
    app: 'blockout-studio', app_version: appVersion(app), instructions: INSTRUCTIONS,
    commands: COMMANDS.map((c) => ({
      name: c.name, title: c.title, description: c.desc,
      inputSchema: typeof c.schema === 'function' ? c.schema(ctx) : c.schema,
      annotations: { title: c.title, readOnlyHint: !!c.readOnly, destructiveHint: !!c.destructive, idempotentHint: !!c.readOnly, openWorldHint: false },
      longRunning: !!c.longRunning,
    })),
    guide: buildGuide(app, ctx, hand),
  };
}

// ---------------------------------------------------------------- 실행 · 화면 알림
export async function run(app, ctx, cmd) {
  const c = COMMANDS.find((x) => x.name === cmd.name);
  if (!c) return { ok: false, error: `unknown command ${cmd.name}` };
  try {
    if (app.ready) await app.ready;
    if (app.exporting || app.busy) throw new Error('the app is busy exporting — try again in a moment');
    const r = await c.run(app, { ...(cmd.args || {}), _client: cmd.client }, ctx);
    return { ok: true, ...r };
  } catch (e) {
    console.warn('[AI]', cmd.name, e);
    try { app.restoreSize(); } catch (_) { /* 무시 */ }
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export function clientLabel(name) {
  const n = String(name || '');
  if (/claude/i.test(n)) return 'Claude';
  if (/codex|openai|chatgpt|gpt/i.test(n)) return 'ChatGPT·Codex';
  if (/cursor/i.test(n)) return 'Cursor';
  if (/code|vscode/i.test(n)) return 'VS Code';
  return n ? n.slice(0, 20) : 'AI';
}

function note(app, ctx, client, text) {
  const who = clientLabel(client);
  const b = document.getElementById('aiBadge');
  if (b) {
    b.innerHTML = `${icon('ai', 15)}<b>${esc(who)}</b><span>${esc(text)}</span>`;
    b.classList.add('show');
    clearTimeout(note._t); note._t = setTimeout(() => b.classList.remove('show'), 3500);
  }
  ctx.log.unshift({ at: new Date(), who, text });
  if (ctx.log.length > 50) ctx.log.length = 50;
  ctx.lastAt = performance.now(); ctx.lastWho = who;
  if (ctx.onLog) ctx.onLog();
  app.status(`AI(${who}) · ${text}`);
}
