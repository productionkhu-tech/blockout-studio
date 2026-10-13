// 서부 마을 — 야외 세트(회색 블록아웃): 흙길 큰길 양쪽에 가게(가짜 정면·포치·보드워크), 살룬·호텔·은행·보안관 사무실·마구간, 길 끝 교회, 물탱크, 마차·통·말 매는 난간, 멀리 언덕.
// 조명은 해(그림자) + 하늘빛뿐. 색은 영상 단계에서. x 는 큰길 가로(가게 정면 |x| = 6.5), z 는 큰길 세로(+z 가 마을 입구, 교회는 −z 끝).
import * as THREE from 'three';

export const WEST_PARAMS = { sunAz: 150, sunEl: 50, sunI: 2.6, skyI: 1.25, fog: 0.0045, exposure: 1.05, handheld: 0.3 };   // 해는 마을 입구(+z) 오른쪽 위에서 — 길과 정면이 밝게, 그림자는 짧게
export const WEST_SKY = 0xc3c8d0;
// AI(MCP) 설명서에 그대로 들어가는 세트 설명 — 세트를 고치면 여기도 같이 고칠 것(app/api.js 가 읽음)
export const WEST_INFO = 'Western frontier town, outdoor, sunny. The dirt main street runs along z: town entrance at z = +26, church at the north end (church door at z = -44, church body z -44..-56, x -4..4, bell tower 15 m). '
  + 'Street is 8 m wide (|x| < 4.1), wooden boardwalks at |x| 4.1..6.5, shop false-fronts at |x| = 6.5 and buildings behind them (|x| 6.5..15.5, roofs 3.5..9 m). '
  + 'Left side (x < 0): general store z 11, two-storey saloon with balcony z 1, bank z -9, barber z -17, warehouse z -26. Right side (x > 0): two-storey hotel z 11, sheriff office z 1.5, blacksmith z -8, stable z -18, shed z -27. '
  + 'Water tower at (9.5, 0, -34), 13 m tall. Props already in the set: barrels near (-3.7, 0, 5), hitching rail x -3.9 z 8..11, water trough (3.6, 0, 7.5), wagon (2.9, 0, -13). '
  + 'Free space for action: the street itself (x -3..3, z -40..24). Typical duel: two people facing each other along z. Sun: elevation 50 deg from azimuth 150 deg (front-right of the entrance).';
const FACADE = 6.5, WALK = 2.4, DEPTH = 9;

function mat(g, rough = 0.92) {
  const m = new THREE.MeshStandardMaterial({ roughness: rough, metalness: 0 });
  m.color.setScalar(Math.pow(g, 2.2));
  return m;
}

export class WestTown {
  constructor(p) {
    this.group = new THREE.Group();
    this.M = { ground: mat(0.5), street: mat(0.44), wall: mat(0.58), trim: mat(0.68), roof: mat(0.4), dark: mat(0.16), prop: mat(0.55), post: mat(0.5), hill: mat(0.47) };
    this.build();
    this.update(p, null, 0, 0);
  }

  box(w, h, d, m, x, y, z, ry = 0) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; o.userData.part = this.part;
    this.group.add(o); return o;
  }

  cyl(r, h, m, x, y, z, rz = 0, rt = 0, seg = 14) {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(rt || r, r, h, seg), m);
    o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = o.receiveShadow = true; o.userData.part = this.part;
    this.group.add(o); return o;
  }

  // 가게 하나: side −1 왼쪽(정면이 +x 를 봄) / +1 오른쪽. w 폭, h 본체 높이, front 가짜 정면이 본체보다 더 솟는 높이, floors 층 수, balcony 2층 발코니
  building({ name, z, w, h, side, front = 1.6, floors = 1, balcony = false, sign = true, doors = 1 }) {
    const M = this.M, fx = side * FACADE;
    this.part = name;
    const FB = 0.3;                                                                                          // 가짜 정면 두께
    this.box(DEPTH - FB + 0.01, h, w, M.wall, side * (FACADE + FB - 0.01 + (DEPTH - FB + 0.01) / 2), h / 2, z);   // 본체는 가짜 정면 뒤에서 시작 — 같은 자리에 면이 겹치면 카메라 따라 깜빡임(z-fighting)
    this.box(FB, h + front, w + 0.04, M.wall, side * (FACADE + FB / 2), (h + front) / 2, z);                 // 가짜 정면(본체보다 2 cm 넓게 — 옆면도 안 겹치게)
    this.box(0.5, 0.25, w + 0.3, M.trim, side * (FACADE + 0.1), h + front, z);                               // 정면 윗선
    this.box(w, 0.3, WALK, M.prop, side * (FACADE - WALK / 2), 0.15, z);                                     // 보드워크
    const roofY = floors > 1 ? 3.6 : 3.1;
    this.box(w, 0.12, WALK + 0.2, M.roof, side * (FACADE - WALK / 2), roofY, z);                             // 포치 지붕(2층이면 발코니 바닥)
    const n = Math.max(2, Math.round(w / 3));
    for (let i = 0; i < n; i++) {
      const pz = z - w / 2 + 0.35 + (w - 0.7) * i / (n - 1);
      this.cyl(0.07, roofY - 0.3, M.post, side * (FACADE - WALK + 0.15), 0.3 + (roofY - 0.3) / 2, pz);       // 포치 기둥
      if (balcony) this.cyl(0.035, 1.0, M.post, side * (FACADE - WALK + 0.15), roofY + 0.56, pz);            // 발코니 난간 기둥
    }
    if (balcony) this.box(0.06, 0.06, w, M.post, side * (FACADE - WALK + 0.15), roofY + 1.06, z);           // 발코니 윗 난간
    for (let k = 0; k < doors; k++) {
      const dz = doors === 1 ? z : z + (k ? 0.6 : -0.6);
      this.box(0.06, 2.1, 1.0, M.dark, side * (FACADE - 0.04), 1.35, dz);                                   // 문
    }
    const wins = Math.max(1, Math.round(w / 2.6));                                                           // 창(층마다)
    for (let f = 0; f < floors; f++) for (let i = 0; i < wins; i++) {
      const wz = z - w / 2 + w * (i + 0.5) / wins + (doors && f === 0 ? (i % 2 ? 0.25 : -0.25) : 0);
      if (f === 0 && Math.abs(wz - z) < 0.95) continue;                                                    // 문 자리는 비움
      this.box(0.06, 1.3, 0.9, M.dark, side * (FACADE - 0.04), 1.95 + f * 3.2, wz);
    }
    if (sign) this.box(0.12, 0.6, Math.min(w - 1, 5), M.trim, side * (FACADE - 0.1), h + front - 0.9, z);   // 간판
  }

  build() {
    const M = this.M;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), M.ground);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.userData.part = '땅'; this.group.add(ground);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(2 * (FACADE - WALK), 68), M.street);               // 흙길
    street.rotation.x = -Math.PI / 2; street.position.set(0, 0.01, -8); street.receiveShadow = true; street.userData.part = '큰길'; this.group.add(street);
    for (const x of [-1.0, 1.0]) { const r = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 66), mat(0.4)); r.rotation.x = -Math.PI / 2; r.position.set(x, 0.015, -8); r.receiveShadow = true; r.userData.part = '큰길'; this.group.add(r); }  // 바퀴 자국

    // 왼쪽(−x): 잡화점 · 살룬 · 은행 · 이발소 · 창고
    this.building({ name: '잡화점', z: 11, w: 8, h: 4.8, side: -1 });
    this.building({ name: '살룬', z: 1, w: 11, h: 7.2, side: -1, front: 2.0, floors: 2, balcony: true, doors: 2 });
    this.building({ name: '은행', z: -9, w: 7, h: 5.2, side: -1, front: 1.8 });
    this.building({ name: '이발소', z: -17, w: 5, h: 4.0, side: -1, front: 1.4 });
    this.building({ name: '왼쪽 창고', z: -26, w: 6, h: 3.5, side: -1, front: 1.0, sign: false });
    // 오른쪽(+x): 호텔 · 보안관 사무실 · 대장간 · 마구간 · 창고
    this.building({ name: '호텔', z: 11, w: 9, h: 7.0, side: 1, front: 1.8, floors: 2, balcony: true });
    this.building({ name: '보안관 사무실', z: 1.5, w: 6.5, h: 4.5, side: 1, front: 1.6 });
    this.building({ name: '대장간', z: -8, w: 8, h: 4.8, side: 1, front: 1.2 });
    this.building({ name: '마구간', z: -18, w: 9, h: 5.0, side: 1, front: 1.0, doors: 2, sign: false });
    this.building({ name: '오른쪽 헛간', z: -27, w: 5, h: 3.5, side: 1, front: 0.8, sign: false });

    // 교회(길 끝, +z 를 봄)
    this.part = '교회';
    this.box(8, 6, 12, M.wall, 0, 3, -50);
    const shape = new THREE.Shape([new THREE.Vector2(-4.4, 6), new THREE.Vector2(4.4, 6), new THREE.Vector2(0, 9.6)]);
    const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 12.6, bevelEnabled: false }), M.roof);
    roof.position.z = -56.3; roof.castShadow = roof.receiveShadow = true; roof.userData.part = '교회'; this.group.add(roof);
    this.box(2.2, 4.5, 2.2, M.trim, 0, 11.4, -46.5);                                                        // 종탑
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.8, 4), M.roof); spire.position.set(0, 15.05, -46.5); spire.rotation.y = Math.PI / 4; spire.castShadow = true; spire.userData.part = '교회'; this.group.add(spire);
    this.box(1.4, 2.6, 0.06, M.dark, 0, 1.3, -43.9);
    this.box(10, 0.3, 3, M.prop, 0, 0.15, -42.6);                                                            // 교회 앞 계단

    // 물탱크(오른쪽 길 끝)
    this.part = '물탱크';
    const tx = 9.5, tz = -34;
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) this.cyl(0.12, 8.2, M.post, tx + dx, 4.1, tz + dz);
    for (const y of [2.6, 5.6]) { this.box(2.7, 0.09, 0.09, M.post, tx, y, tz - 1.2); this.box(2.7, 0.09, 0.09, M.post, tx, y, tz + 1.2); this.box(0.09, 0.09, 2.7, M.post, tx - 1.2, y, tz); this.box(0.09, 0.09, 2.7, M.post, tx + 1.2, y, tz); }
    this.box(3.2, 0.2, 3.2, M.prop, tx, 8.3, tz);
    this.cyl(1.9, 3.0, M.prop, tx, 9.9, tz, 0, 0, 24);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.15, 1.3, 24), M.roof); cone.position.set(tx, 12.05, tz); cone.castShadow = true; cone.userData.part = '물탱크'; this.group.add(cone);

    // 소품: 통 · 말 매는 난간 · 물통 · 마차
    this.part = '술통';
    for (const [x, z] of [[-3.75, 4.6], [-3.75, 5.3], [-3.3, 4.95]]) this.cyl(0.32, 0.9, M.prop, x, 0.45, z, 0, 0.3, 16);
    this.part = '말 매는 난간';
    for (const z of [8.2, 11.2]) this.cyl(0.06, 1.0, M.post, -3.9, 0.5, z);
    this.cyl(0.04, 3.0, M.post, -3.9, 0.95, 9.7, Math.PI / 2).rotation.set(Math.PI / 2, 0, 0);
    this.part = '물통';
    this.box(2.2, 0.6, 0.8, M.prop, 3.6, 0.3, 7.5);
    const wg = new THREE.Group(); wg.position.set(2.9, 0, -13); wg.userData.part = '마차'; this.group.add(wg);
    const add = (o) => { o.castShadow = o.receiveShadow = true; wg.add(o); return o; };
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 3.4), M.prop)).position.set(0, 1.1, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.8), M.prop)).position.set(0, 1.75, 1.3);
    for (const [x, z] of [[-0.95, -1.3], [0.95, -1.3], [-0.95, 1.3], [0.95, 1.3]]) { const w = add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 18), M.post)); w.position.set(x, 0.6, z); w.rotation.z = Math.PI / 2; }
    for (const x of [-0.5, 0.5]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.6), M.post)).position.set(x, 0.7, 2.9);

    // 멀리 언덕(안개 속)
    for (const [x, y, z, r] of [[-60, -4, -130, 34], [5, -3, -150, 40], [75, -5, -135, 36], [-125, -6, -110, 44], [135, -6, -120, 42], [-20, -8, -175, 60], [60, -9, -185, 55], [-45, -5, 125, 38], [65, -6, 140, 46], [5, -8, 175, 62], [-130, -6, 90, 44]]) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12), M.hill); h.scale.set(1, 0.32, 1); h.position.set(x, y, z); h.userData.part = '먼 언덕'; this.group.add(h);
    }

    // 조명: 해 + 하늘빛
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -48; sc.right = sc.top = 48; sc.near = 1; sc.far = 320;
    this.sun.shadow.mapSize.set(4096, 4096); this.sun.shadow.bias = -0.0002; this.sun.shadow.normalBias = 0.08; this.sun.shadow.radius = 3;   // 그늘진 벽의 얼룩(acne)이 카메라 따라 바뀌며 플리커 → 법선 바이어스 크게·맵 촘촘히·부드럽게
    this.group.add(this.sun, this.sun.target);
    this.sky = new THREE.HemisphereLight(0xdfe4ec, 0x5f5b55, 0.9);
    this.group.add(this.sky);
  }

  update(p, L, t, camY) {           // 해 방향(어디서 오는지: 방위각 0 = +z 쪽, 시계 방향) · 세기 — 카메라 높이 보정은 없음(카가 없으니 0)
    const az = (p.sunAz ?? 150) * Math.PI / 180, el = (p.sunEl ?? 50) * Math.PI / 180;
    this.sun.position.set(Math.sin(az) * Math.cos(el) * 140, Math.sin(el) * 140, Math.cos(az) * Math.cos(el) * 140);
    this.sun.intensity = p.sunI ?? 2.6;
    this.sky.intensity = p.skyI ?? 1.25;
    return 0;
  }
}
