// 내보내기 — PNG(지금 화면) · MP4(키프레임 무빙 전체, WebCodecs H.264 + mp4-muxer) · 키프레임 시트 PNG · JSON
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer/mp4-muxer.mjs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { sample, applyToCamera, mmToFov } from './campath.js';
import { trackAt } from './objects.js';
import { imgSrc } from './ui.js';

// 블렌더로 보내기 — 세트·물체·카메라를 .glb 로. 카메라와 움직이는 물체는 프레임마다 구운 애니메이션(블렌더가 glTF 카메라·키프레임을 그대로 읽음). 렌즈(mm) 변화는 glTF 애니메이션에 없어 첫 값 고정.
export async function exportGLB(studio, name) {
  const st = studio.state, fps = st.fps, dur = st.duration, n = Math.max(2, Math.floor(dur * fps) + 1), keys = st.camera.keys;
  const cam = new THREE.PerspectiveCamera(mmToFov(keys.length ? keys[0].mm : studio.fly.mm), 16 / 9, 0.05, 600);
  cam.name = 'Blockout Camera';
  const times = new Float32Array(n), cpos = new Float32Array(n * 3), cq = new Float32Array(n * 4);
  const moving = studio.objects.filter((o) => o.keys.length || o.follow);
  const rec = moving.map((o) => ({ o, pos: new Float32Array(n * 3), q: new Float32Array(n * 4), sc: new Float32Array(n * 3) }));
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / fps, dur), cy = studio.carY(t);
    times[i] = t;
    if (keys.length) applyToCamera(cam, sample(keys, t), cy, 0, t);
    else { studio.applyFly(t); cam.position.copy(studio.camera.position); cam.quaternion.copy(studio.camera.quaternion); }
    cam.position.toArray(cpos, i * 3); cam.quaternion.toArray(cq, i * 4);
    for (const r of rec) {
      const tr = trackAt(r.o.keys, t, r.o.base);
      r.pos[i * 3] = tr.pos[0]; r.pos[i * 3 + 1] = tr.pos[1] + (r.o.follow ? cy : 0); r.pos[i * 3 + 2] = tr.pos[2];
      q.setFromEuler(e.set(0, tr.rotY * Math.PI / 180, 0)); q.toArray(r.q, i * 4);
      r.sc[i * 3] = tr.scale[0]; r.sc[i * 3 + 1] = tr.scale[1]; r.sc[i * 3 + 2] = tr.scale[2];
    }
  }
  const tracks = [new THREE.VectorKeyframeTrack(cam.uuid + '.position', times, cpos), new THREE.QuaternionKeyframeTrack(cam.uuid + '.quaternion', times, cq)];
  for (const r of rec) tracks.push(new THREE.VectorKeyframeTrack(r.o.group.uuid + '.position', times, r.pos), new THREE.QuaternionKeyframeTrack(r.o.group.uuid + '.quaternion', times, r.q), new THREE.VectorKeyframeTrack(r.o.group.uuid + '.scale', times, r.sc));
  const clip = new THREE.AnimationClip('blockout', dur, tracks);
  const groups = studio.objects.map((o) => o.group), root = new THREE.Group();
  root.name = st.name || 'blockout';
  root.add(studio.world.group, ...groups, cam);                                   // 내보내는 동안만 한 뿌리 아래로(애니메이션 대상 찾기)
  try {
    const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: [clip], onlyVisible: true, trs: true });
    download(new Blob([glb], { type: 'model/gltf-binary' }), name);
    return { frames: n, objects: rec.length, bytes: glb.byteLength };
  } finally {
    studio.scene3.add(studio.world.group, ...groups);
    for (const o of studio.objects) o.apply(trackAt(o.keys, studio.time, o.base));
  }
}

export const hooks = { save: null, pending: [] };       // AI(MCP) 내보내기: 다운로드 대신 앱 서버로 보내 문서\블록아웃 스튜디오\내보내기 에 저장(app/api.js)

export function download(blob, name) {
  if (hooks.save) { hooks.pending.push(hooks.save(blob, name)); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 내보내기 해상도 — 세로 기준(720/1080/2160)과 화면비
export function exportSize(aspect, height) {
  const [aw, ah] = aspect.split(':').map(Number);
  let w = Math.round(height * aw / ah / 2) * 2;
  let h = Math.round(height / 2) * 2;
  if (aw < ah) { h = Math.round(height * ah / aw / 2) * 2; w = Math.round(height / 2) * 2; }   // 세로 화면비: 짧은 변을 height 로
  return [w, h];
}

// studio.renderAt(t, w, h) 가 그 시각을 w×h 로 그린 뒤 canvas 를 돌려준다고 본다.
export async function exportPNG(studio, t, w, h, name) {
  const canvas = await studio.renderAt(t, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  studio.restoreSize();
  download(blob, name);
}

export async function exportSheet(studio, times, w, h, cols, name) {
  const cw = Math.round(w / 2), ch = Math.round(h / 2);
  const rows = Math.ceil(times.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = rows * ch;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  for (let i = 0; i < times.length; i++) {
    const canvas = await studio.renderAt(times[i], w, h, true);
    ctx.drawImage(canvas, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect((i % cols) * cw, Math.floor(i / cols) * ch, 92, 28);
    ctx.fillStyle = '#FF8A52';
    ctx.font = "600 16px 'Pretendard', 'Pretendard GOV', 'BlockoutSans', sans-serif";
    ctx.fillText(`${times[i].toFixed(2)} s`, (i % cols) * cw + 8, Math.floor(i / cols) * ch + 20);
  }
  studio.restoreSize();
  const blob = await new Promise((res) => sheet.toBlob(res, 'image/png'));
  download(blob, name);
}

// 샷 리스트 — 인쇄용 HTML(썸네일·도면 포함) + CSV(엑셀). 길이 = 다음 장면까지, 마지막은 머무는 시간
export function shotRows(studio) {
  const st = studio.state, keys = st.camera.keys;
  return keys.map((k, i) => {
    const next = keys[i + 1], dur = next ? next.t - k.t : st.tail;
    const cy = k.follow ? studio.carY(k.t) : 0, dx = k.target[0] - k.pos[0], dz = k.target[2] - k.pos[2];
    const head = Math.round(((Math.atan2(-dx, -dz) * 180 / Math.PI) + 360) % 360), tilt = Math.round(Math.atan2(k.target[1] - k.pos[1], Math.hypot(dx, dz)) * 180 / Math.PI);
    return { n: i + 1, t: k.t, dur, mm: k.mm, h: k.pos[1] + cy, x: k.pos[0], z: k.pos[2], head, tilt, cut: !!k.cut, hold: !!k.hold, note: k.note || '', thumb: k.thumb || '' };
  });
}

export function exportShotList(studio, planDataURL, base) {
  const st = studio.state, rows = shotRows(studio), esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const paths = studio.objects.filter((o) => o.keys.length >= 2).map((o) => `${esc(o.name)}: ${o.keys.map((k) => `(${k.pos[0].toFixed(1)}, ${k.pos[2].toFixed(1)}) @${k.t.toFixed(1)}s`).join(' → ')}`);
  const tr = rows.map((r) => `<tr><td>${imgSrc(r.thumb) ? `<img src="${imgSrc(r.thumb)}">` : ''}</td><td class="n">${r.n}</td><td>${r.t.toFixed(1)} s</td><td>${r.dur.toFixed(1)} s</td><td>${r.mm.toFixed(0)} mm</td><td>${r.h.toFixed(2)} m</td><td>(${r.x.toFixed(1)}, ${r.z.toFixed(1)})</td><td>${r.head}° / ${r.tilt > 0 ? '+' : ''}${r.tilt}°</td><td>${r.cut ? '컷' : ''}${r.cut && r.hold ? ' · ' : ''}${r.hold ? '멈춤' : ''}</td><td class="note">${esc(r.note)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${esc(st.name || '장면')} — 샷 리스트</title>
<style>body{font-family:'Pretendard GOV','Pretendard','Malgun Gothic',sans-serif;color:#111;margin:28px;font-size:13px}h1{font-size:22px;margin:0 0 4px}.meta{color:#555;margin-bottom:14px}img.plan{width:100%;max-height:520px;object-fit:contain;background:#12161c;border-radius:8px;margin:8px 0 16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:5px 7px;vertical-align:middle;text-align:left}th{background:#f2f3f5}td img{width:144px;height:81px;object-fit:cover;display:block}td.n{font-weight:700;font-size:16px}td.note{min-width:160px}.paths{margin-top:14px;color:#333}.legend{color:#555;font-size:12px}@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}}</style>
<h1>${esc(st.name || '장면')} — 샷 리스트</h1><div class="meta">${new Date().toLocaleString('ko-KR')} · 장면 ${rows.length}개 · 전체 ${st.duration.toFixed(1)} s · ${st.fps} fps · ${st.aspect} · 블록아웃 스튜디오</div>
${planDataURL ? `<img class="plan" src="${planDataURL}"><div class="legend">도면: 번호 = 장면의 카메라 자리 · 노란 부채꼴 = 지금 시각의 카메라 범위 · 연두 띠 = 물체 동선 · 격자 ${studio.planV.cell} m</div>` : ''}
<table><thead><tr><th>그림</th><th>#</th><th>시작</th><th>길이</th><th>렌즈</th><th>높이</th><th>자리 (x, z)</th><th>방향 / 틸트</th><th></th><th>메모</th></tr></thead><tbody>${tr}</tbody></table>
${paths.length ? `<div class="paths"><b>동선</b><br>${paths.join('<br>')}</div>` : ''}
</html>`;
  download(new Blob([html], { type: 'text/html' }), `${base}_샷리스트.html`);
  const csv = ['번호,시작(s),길이(s),렌즈(mm),높이(m),x,z,방향(°),틸트(°),컷,멈춤,메모', ...rows.map((r) => [r.n, r.t.toFixed(2), r.dur.toFixed(2), r.mm, r.h.toFixed(2), r.x.toFixed(2), r.z.toFixed(2), r.head, r.tilt, r.cut ? 1 : 0, r.hold ? 1 : 0, '"' + r.note.replace(/"/g, '""') + '"'].join(','))].join('\r\n');
  download(new Blob(['\ufeff' + csv], { type: 'text/csv' }), `${base}_샷리스트.csv`);
  return rows.length;
}

export function canEncodeMp4() {
  return typeof VideoEncoder !== 'undefined';
}

// MP4 — 프레임을 하나씩 그려 넣으므로 느린 컴퓨터에서도 길이·속도가 정확하다.
export async function exportMP4(studio, { start = 0, duration, fps, w, h, name, onProgress, shouldStop }) {   // start: 구간만 뽑을 때 시작 시각
  const codec = h > 1100 ? 'avc1.640033' : 'avc1.640028';
  const config = { codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.16), framerate: fps, hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } };
  const sup = await VideoEncoder.isConfigSupported(config);
  if (!sup.supported) {
    config.hardwareAcceleration = 'no-preference';
    const sup2 = await VideoEncoder.isConfigSupported(config);
    if (!sup2.supported) throw new Error('이 브라우저는 H.264 인코딩을 지원하지 않음 — Edge/Chrome 최신판으로');
  }
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
  encoder.configure(config);
  const n = Math.round(duration * fps);
  for (let i = 0; i < n; i++) {
    if (shouldStop && shouldStop()) break;
    if (err) throw err;
    const t = start + i / fps;
    const canvas = await studio.renderAt(t, w, h, true);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 15));
    if (onProgress) onProgress((i + 1) / n);
    if (i % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  studio.restoreSize();
  download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), name);
}
