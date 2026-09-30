// ============================================================
//  场景环境：window.CellEnvs(CTX) → { ENV }
//  每个环境返回 { group, type:'disc'|'corridor', R | halfW+len, start, spread(n, ordered), update(t,dt), ... }
// ============================================================
window.CellEnvs = function (CTX) {
  const { THREE, rand, clamp, lerp, mat, pmat, bumpy, X, M } = CTX;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = V3(0, 1, 0);
  const GC = {}; const cached = (k, f) => GC[k] || (GC[k] = f());
  const sph = (w = 16, h = 12) => cached('s' + w + h, () => new THREE.SphereGeometry(1, w, h));

  /* ================================================================
     通用构件
     ================================================================ */
  function onUpdate(e, fn) { const prev = e.update; e.update = (t, dt) => { prev(t, dt); fn(t, dt); }; }
  // 地面：fbm 起伏 + 双色混合 + 组织法线纹理
  function ground(e, { color, color2, R = 60, amp = .35, freq = .07, nrm = 'cells', nrep = 10, nscale = .5, map, rough = .7, emissive = 0x000000, colorFn }) {
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, 150, 150); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c0 = new THREE.Color(color), c1 = new THREE.Color(color2 ?? color), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), n = X.fbm(x * freq, .5, z * freq, 4), m = X.fbm(x * freq * .4 + 9, 1.3, z * freq * .4, 2);
      p.setY(i, n * amp * 1.6 - .12); c.lerpColors(c0, c1, clamp(m * 1.6 + .5, 0, 1)).multiplyScalar(1 + n * .35); if (colorFn) colorFn(x, z, c); col.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = pmat(0xffffff, { vertexColors: true, roughness: rough, clearcoat: .35, clearcoatRoughness: .5, emissive, map: map || null });
    if (nrm) { m.normalMap = X.rep(X.normalTex(nrm), nrep); m.normalScale.set(nscale, nscale); }
    const mesh = new THREE.Mesh(geo, m); e.group.add(mesh); return mesh;
  }
  function discSpread(R, n, minD = 4) {
    const pts = []; let tries = 0;
    while (pts.length < n && tries++ < 3000) { const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * (R - 3) + 3; const p = V3(Math.cos(a) * r, .9, Math.sin(a) * r);
      if (p.length() < 5) continue; if (pts.every(q => q.distanceTo(p) > minD)) pts.push(p); }
    return pts;
  }
  function orderedPath(R, n) { const pts = []; for (let i = 0; i < n; i++) { const t = (i + 1) / n; const z = 4 - t * (R + 1); const x = Math.sin(t * Math.PI * 2.2 + 1) * R * .38; pts.push(V3(x, 1, z)); } return pts; }
  function baseEnv(R) { const group = new THREE.Group(); return { group, R, type: 'disc', start: V3(0, 0, 0), spread: (n, ordered) => ordered ? orderedPath(R, n) : discSpread(R, n), update: () => {} }; }
  function corridorEnv(halfW, len) {
    const group = new THREE.Group();
    const spread = n => { const pts = []; for (let i = 0; i < n; i++) pts.push(V3(rand(-halfW + 1.5, halfW - 1.5), .9, 8 - (i + 1) * (len - 14) / n)); return pts; };
    return { group, type: 'corridor', halfW, len, start: V3(0, 0, 10), spread, update: () => {} };
  }
  // 环形散布（避开中心的游戏区）
  function ringPos(minR, maxR) { const a = rand(0, Math.PI * 2), r = rand(minR, maxR); return V3(Math.cos(a) * r, 0, Math.sin(a) * r); }
  // 避开镜头通道（镜头在玩家 +Z 方向上方）
  function awayPos(minR, maxR) { for (let k = 0; k < 40; k++) { const p = ringPos(minR, maxR); if (!(p.z > -4 && Math.abs(p.x) < 9)) return p; } return ringPos(maxR, maxR); }
  function scatter(group, n, R, make, minR = 6) { for (let i = 0; i < n; i++) { const o = make(i); const p = ringPos(minR, R); o.position.x = p.x; o.position.z = p.z; o.rotation.y = rand(0, 6); group.add(o); } }
  // 漂浮的单个物体
  function floaters(e, n, R, make, drift = 1, y0 = 1.5, y1 = 7) {
    const g = new THREE.Group(); e.group.add(g); const list = [];
    for (let i = 0; i < n; i++) { const o = make(); o.position.set(rand(-R, R), rand(y0, y1), rand(-R, R)); o.rotation.set(rand(0, 6), rand(0, 6), 0); g.add(o); list.push({ o, v: V3(rand(-1, 1), rand(-.3, .3), rand(-1, 1)).multiplyScalar(drift) }); }
    onUpdate(e, (t, dt) => list.forEach(f => { f.o.position.addScaledVector(f.v, dt); f.o.rotation.x += dt * .3; f.o.rotation.y += dt * .2; if (f.o.position.y < y0 * .5 || f.o.position.y > y1 * 1.3) f.v.y *= -1; if (Math.hypot(f.o.position.x, f.o.position.z) > R + 4) { f.o.position.x *= -.9; f.o.position.z *= -.9; } }));
  }
  // 实例化漂浮物（大量、每帧更新矩阵）
  function instFloat(e, geo, material, n, R, { y0 = 1.5, y1 = 6.5, drift = .8, spin = .8, scale = [.8, 1.2], color, parent } = {}) {
    const d = new THREE.Object3D(), st = [];
    const m = X.inst(geo, material, n, (i, dd) => { const s = { p: V3(rand(-R, R), rand(y0, y1), rand(-R, R)), r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), w: V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(spin), v: V3(rand(-1, 1), rand(-.3, .3), rand(-1, 1)).multiplyScalar(drift), s: rand(...scale) }; st.push(s); dd.position.copy(s.p); dd.scale.setScalar(s.s); return color ? color(i) : undefined; });
    (parent || e.group).add(m);
    onUpdate(e, (t, dt) => { st.forEach((s, i) => { s.p.addScaledVector(s.v, dt); if (s.p.y < y0 || s.p.y > y1) s.v.y *= -1; if (Math.hypot(s.p.x, s.p.z) > R) { s.p.x *= -.95; s.p.z *= -.95; } s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; d.position.copy(s.p); d.rotation.copy(s.r); d.scale.setScalar(s.s); d.updateMatrix(); m.setMatrixAt(i, d.matrix); }); m.instanceMatrix.needsUpdate = true; });
    return m;
  }
  // 沿局部 -Z 流动的实例（血流）
  function flowInst(e, geo, material, n, { xr = 5, y0 = 1, y1 = 6, z0 = -100, z1 = 20, speed = 6, scale = [.9, 1.1], tumble = 1, parent, radial } = {}) {
    const d = new THREE.Object3D(), st = [];
    const m = X.inst(geo, material, n, (i, dd) => { let x = rand(-xr, xr), y = rand(y0, y1); if (radial) { const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * radial; x = Math.cos(a) * r; y = Math.sin(a) * r; }
      const s = { p: V3(x, y, rand(z0, z1)), r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)), w: rand(.5, 1.5) * tumble, v: speed * rand(.8, 1.2), s: rand(...scale) }; st.push(s); dd.position.copy(s.p); dd.scale.setScalar(s.s); });
    m.frustumCulled = false; (parent || e.group).add(m);
    onUpdate(e, (t, dt) => { st.forEach((s, i) => { s.p.z -= s.v * dt; if (s.p.z < z0) s.p.z = z1; s.r.x += s.w * dt; s.r.z += s.w * .6 * dt; d.position.copy(s.p); d.rotation.copy(s.r); d.scale.setScalar(s.s); d.updateMatrix(); m.setMatrixAt(i, d.matrix); }); m.instanceMatrix.needsUpdate = true; });
    return m;
  }
  // 粒子 + 散景
  function atmosphere(e, { n = 350, R = 32, color = 0xffffff, size = .22, opacity = .6, bokeh = 30, bokehColor, y1 = 12, drift = .3 }) {
    const p = X.particles({ n, R, color, size, opacity, y1, drift }); e.group.add(p);
    const b = bokeh ? X.particles({ n: bokeh, R: R * .8, y0: 2, y1: y1 + 4, color: bokehColor ?? color, size: 2.6, opacity: .09, tex: 'bokeh', drift: .15 }) : null; if (b) e.group.add(b);
    onUpdate(e, (t, dt) => { p.userData.update(t, dt); if (b) b.userData.update(t, dt); });
  }
  function light(e, color, intensity, pos, dist = 60) { const l = new THREE.PointLight(color, intensity, dist, 1.2); l.position.copy(pos); e.group.add(l); return l; }

  // 血管管腔（内壁铺拉长的内皮细胞）
  function vesselTube(e, radius, len, zc, { wall = 0xb03a48, floor = 0x9a3040 } = {}) {
    const geo = new THREE.CylinderGeometry(radius, radius, len, 72, 60, true), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = radius + .35 * X.fbm(Math.cos(a) * 2, y * .08, Math.sin(a) * 2, 3); p.setXYZ(i, Math.cos(a) * r, y, Math.sin(a) * r); }
    X.smoothNormals(geo);
    const tube = new THREE.Mesh(geo, X.tissueMat(wall, { side: THREE.BackSide, nrm: 'endo', nrep: 5, nrepY: len / 14, nscale: 1.4, roughness: .45, clearcoat: .6, rimStr: .15 }));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, radius * .55, zc); e.group.add(tube);
    // 内皮细胞核的隆起
    const nm = X.rimify(pmat(new THREE.Color(wall).lerp(new THREE.Color(0xffc0c8), .35), { roughness: .4, clearcoat: .7, normalMap: X.normalTex('chromatin') }), { rimAlpha: 0, rimStr: .3 });
    const n = Math.floor(len * radius * .12);
    e.group.add(X.inst(cached('endoN', () => bumpy(new THREE.SphereGeometry(1, 16, 12), .06, 2)), nm, n, (i, d) => { const a = rand(-.15, Math.PI + .15), z = rand(-len / 2, len / 2); d.position.set(Math.cos(a) * (radius - .05), radius * .55 + Math.sin(a) * (radius - .05), zc + z); d.lookAt(0, radius * .55, zc + z); d.scale.set(rand(1.2, 1.7), rand(.5, .7), .22); }));
    // 平坦的“地面”（管腔底部）
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.2, len, 1, 1), X.tissueMat(floor, { nrm: 'endo', nrep: 4, nrepY: len / 14, nscale: 1.4, roughness: .5, clearcoat: .5, rimStr: 0 })); fl.rotation.x = -Math.PI / 2; fl.position.set(0, -.05, zc); e.group.add(fl);
    return tube;
  }
  const rbcMat = () => cached('rbcMat', () => pmat(0xc8303a, { roughness: .32, clearcoat: .8, clearcoatRoughness: .3, sheen: .8, sheenRoughness: .4, sheenColor: new THREE.Color(0xff8080), envMapIntensity: .7 }));
  const plateletGeo = () => cached('plt', () => X.smoothNormals(bumpy(new THREE.SphereGeometry(.45, 16, 12), .08, 3).scale(1, .32, 1)));
  // 脂肪细胞团（大脂滴 + 印戒样的扁核）
  function adipocytes(e, n, R, minR, y = 1.2) {
    const cells = []; for (let c = 0; c < Math.ceil(n / 7); c++) { const cp = ringPos(minR, R); for (let k = 0; k < 7 && cells.length < n; k++) { const r = rand(1.5, 2.3); cells.push({ p: cp.clone().add(V3(rand(-3, 3), y + rand(-.2, .8), rand(-3, 3))), r }); } }
    const fm = X.cellMat(0xffe6a0, { opacity: .85, depthWrite: true, roughness: .12, clearcoat: 1, emissive: 0x6a4a10, emissiveIntensity: .2, rim: 0xfff4d0, rimStr: .6, nrm: 'fine', nrep: 2, nscale: .25 });
    e.group.add(X.inst(cached('adipo', () => bumpy(new THREE.SphereGeometry(1, 32, 24), .04, 1.2)), fm, cells.length, (i, d) => { d.position.copy(cells[i].p); d.scale.set(cells[i].r, cells[i].r * .92, cells[i].r); }));
    const nm = X.rimify(pmat(0x7a4ab0, { emissive: 0x3a1a60, emissiveIntensity: .4, normalMap: X.normalTex('chromatin') }), { rimAlpha: 0, rimStr: .3 });
    e.group.add(X.inst(sph(), nm, cells.length, (i, d) => { const dir = X.randDir(); dir.y = Math.abs(dir.y) * .6 + .2; dir.normalize(); d.position.copy(cells[i].p).addScaledVector(dir, cells[i].r * .97); d.lookAt(cells[i].p.clone().addScaledVector(dir, 9)); d.scale.set(.35, .2, .12); }));
  }
  // 半透明细胞团（实例化的细胞体 + 细胞核）
  function cellCluster(e, list, { opacity = .55, nucColor = 0x5a2d9a } = {}) {
    const bm = X.cellMat(0xffffff, { opacity, nrep: 3, rimStr: .5 });
    e.group.add(X.inst(cached('cc', () => bumpy(new THREE.SphereGeometry(1, 22, 16), .05, 1.6)), bm, list.length, (i, d) => { d.position.copy(list[i].p); d.scale.set(list[i].r, list[i].r * (list[i].fy ?? .9), list[i].r); d.rotation.y = rand(0, 6); return list[i].c; }));
    const nm = pmat(0xffffff, { emissive: 0x201030, emissiveIntensity: .5, roughness: .6, normalMap: X.normalTex('chromatin') });
    e.group.add(X.inst(cached('ccN', () => bumpy(new THREE.SphereGeometry(1, 16, 12), .08, 2)), nm, list.length, (i, d) => { d.position.copy(list[i].p).add(V3(list[i].r * .15, list[i].r * .1, 0)); d.scale.setScalar(list[i].r * (list[i].nr ?? .45)); return list[i].nc ?? nucColor; }));
  }
  // 三维网络：节点 + 连杆（骨小梁 / 网状纤维 / 基质细胞）
  function network(nodes, maxD, maxLinks, rf, nodeR) {
    const parts = [], links = new Map();
    nodes.forEach((a, i) => { const near = nodes.map((b, j) => ({ j, d: a.distanceTo(b) })).filter(o => o.j !== i && o.d < maxD).sort((x, y) => x.d - y.d).slice(0, maxLinks);
      near.forEach(({ j }) => { const k = i < j ? i + '_' + j : j + '_' + i; if (links.has(k)) return; links.set(k, 1); const b = nodes[j], mid = a.clone().lerp(b, .5).add(V3(rand(-1, 1), rand(-1.2, .3), rand(-1, 1)).multiplyScalar(a.distanceTo(b) * .15)); parts.push(X.taperTube([a, mid, b], rf, 20, 8)); }); });
    if (nodeR) nodes.forEach((n, i) => parts.push(X.bake(bumpy(new THREE.SphereGeometry(nodeR(i), 14, 10), nodeR(i) * .15, 2, i), n)));
    return X.merge(parts);
  }
  // 星形细胞体（巨噬细胞等）
  function blobCell(r, lobes = 7, sharp = 12, seed = 1) {
    const rr = X.rng(seed), L = [...Array(lobes)].map(() => ({ d: X.randDir(rr), a: .4 + rr() * .6, w: sharp * (.6 + rr() * .8) }));
    return X.starGeo(56, d => { let v = r * (1 + .08 * X.fbm(d.x * 2.5 + seed, d.y * 2.5, d.z * 2.5, 3)); L.forEach(l => { const c = d.dot(l.d); if (c > 0) v += Math.pow(c, l.w) * l.a * r; }); return v; });
  }
  const colorOf = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

  /* ================================================================
     环境定义
     ================================================================ */
  const ENV = {
    /* ---- 红骨髓 ---- */
    marrow() {
      const e = baseEnv(26);
      X.mood({ bg: 0x2a0c10, fogD: .022, sky: 0xffc0b0, ground: 0x3a0a10, hemiI: .75, key: 0xffe4d8, keyI: 1.5, rim: 0xff6a5a, rimI: 1.8, env: [0xffc8b8, 0x5a1a20, 0x1a0508], bloom: .5 });
      ground(e, { color: 0x6a1c26, color2: 0x8e2c34, nrm: 'cells', nrep: 20, amp: .4 });
      // 骨小梁：海绵状的骨网络
      const nodes = []; for (let i = 0; i < 34; i++) { const p = ringPos(11, 38); p.y = p.length() > 30 ? rand(6, 14) : rand(3, 7.5); nodes.push(p); }
      const cols = nodes.filter((_, i) => i % 2 === 0).map(n => [V3(n.x + rand(-2, 2), -.6, n.z + rand(-2, 2)), n]);
      const boneGeo = X.merge([network(nodes, 12, 2, t => .45 * (1 + .7 * (1 - Math.sin(t * Math.PI))), i => rand(.8, 1.2)), ...cols.map(([a, b]) => X.taperTube([a, a.clone().lerp(b, .5).add(V3(rand(-1, 1), 0, rand(-1, 1))), b], t => lerp(1.4, .7, t) * (1 + .2 * Math.sin(t * 11)), 24, 12))]);
      e.group.add(new THREE.Mesh(boneGeo, X.tissueMat(0xeadcc2, { nrm: 'bone', nrep: 2, nscale: 1.3, roughness: .75, clearcoat: .2, rim: 0xfff0dc, rimStr: .35 })));
      adipocytes(e, 42, 32, 12);
      // 造血细胞岛：各阶段的血细胞挤在一起
      const cl = []; for (let k = 0; k < 16; k++) { const c = ringPos(7, 30); for (let i = 0; i < 11; i++) { const kind = Math.random(); cl.push({ p: c.clone().add(V3(rand(-2.2, 2.2), rand(.4, 1.2), rand(-2.2, 2.2))), r: rand(.45, .8), c: kind < .45 ? colorOf(0xff8a8a, 0xd84a5a, Math.random()) : kind < .8 ? colorOf(0xd9ccff, 0xb8a0ff, Math.random()) : 0xb8e8ff, nc: kind < .45 ? 0x3a1a50 : 0x6a3aa8 }); } }
      cellCluster(e, cl, { opacity: .6 });
      // 红系岛：中央巨噬细胞 + 一圈幼红细胞
      for (let k = 0; k < 3; k++) { const c = ringPos(9, 22); c.y = 1.4; const mac = new THREE.Mesh(blobCell(1.2, 8, 10, k + 3), X.cellMat(0xc9d8ff, { opacity: .55, emissive: 0x203060, emissiveIntensity: .3 })); mac.position.copy(c); e.group.add(mac);
        const ring = []; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; ring.push({ p: c.clone().add(V3(Math.cos(a) * 2, rand(-.3, .5), Math.sin(a) * 2)), r: rand(.5, .65), c: 0xe05a6a, nc: 0x2a0a40, nr: .5 }); } cellCluster(e, ring, { opacity: .7 }); }
      // 巨核细胞：多叶核 + 伸向血窦的前血小板
      for (let k = 0; k < 2; k++) { const c = V3(k ? 12 : -10, 2.5, -15 + rand(-2, 2)); const g = new THREE.Group(); g.position.copy(c);
        g.add(new THREE.Mesh(blobCell(2.2, 10, 6, k + 9), X.cellMat(0xe0c8ff, { opacity: .5, emissive: 0x402060, emissiveIntensity: .3 })));
        const lob = []; for (let i = 0; i < 6; i++) lob.push(X.bake(bumpy(new THREE.SphereGeometry(.6, 16, 12), .05, 3, i), X.randDir().multiplyScalar(.7))); g.add(new THREE.Mesh(X.merge(lob), pmat(0x6a3aa8, { emissive: 0x3a1a60, emissiveIntensity: .5, normalMap: X.normalTex('chromatin') })));
        const pp = []; for (let i = 0; i < 6; i++) { const pts = X.walk(V3(0, 1, -1.5), V3(rand(-.5, .5), rand(.2, .8), -1), rand(3, 5), 6, .5); pp.push(X.taperTube(pts, t => .09 + .05 * Math.max(0, Math.sin(t * 30)), 60, 6)); }
        g.add(new THREE.Mesh(X.merge(pp), X.glowMat(0xffe3a3, .5))); e.group.add(g); }
      // 血窦：半透明薄壁 + 其中流动的红细胞
      const sin = new THREE.Group(); sin.position.set(0, 9, -19); sin.rotation.y = Math.PI / 2; e.group.add(sin);
      sin.add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 90, 40, 1, true).rotateX(Math.PI / 2), X.cellMat(0xd06070, { opacity: .22, side: THREE.DoubleSide, nrm: 'endo', nrep: 3, rimAlpha: .35 })));
      flowInst(e, X.rbcGeo(true), rbcMat(), 40, { radial: 2, z0: -45, z1: 45, speed: 4, scale: [.75, .85], parent: sin });
      // 网状纤维
      const fib = []; for (let i = 0; i < 60; i++) { const a = ringPos(5, 30); a.y = rand(.5, 6); const b = a.clone().add(X.randDir().multiplyScalar(rand(3, 7))); b.y = clamp(b.y, .3, 9); fib.push(a, b); }
      e.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(fib), new THREE.LineBasicMaterial({ color: 0xffc8b0, transparent: true, opacity: .1 })));
      instFloat(e, X.rbcGeo(true), rbcMat(), 26, 30, { scale: [.6, .75], drift: .6 });
      atmosphere(e, { n: 380, color: 0xffb0a0, size: .2, bokehColor: 0xff8070 });
      light(e, 0xff8060, 40, V3(0, 8, -6));
      return e;
    },

    /* ---- 肺泡 ---- */
    lung() {
      const e = baseEnv(26);
      X.mood({ bg: 0xdca4b0, fogD: .02, sky: 0xfff4f4, ground: 0xa04858, hemiI: .7, key: 0xfff6f0, keyI: 1.3, rim: 0xffd8e8, rimI: 1.5, env: [0xffffff, 0xe8b0bc, 0x9a4050], exposure: .95, bloom: .3 });
      ground(e, { color: 0xffffff, color2: 0xffe8ec, map: X.rep(X.colorTex('capnet'), 13), nrm: 'fine', nrep: 20, nscale: .6, rough: .45, amp: .3 });
      // 肺泡囊：带虹彩的薄壁泡 + 表面的毛细血管网
      // 毛细血管“篮”：球面上的点两两以大圆弧相连，形成网眼
      const nets = [0, 1, 2, 3].map(k => cached('alvNet' + k, () => { const r = X.rng(k + 40), N = 22, pts = [...Array(N)].map((_, i) => X.fib(i, N).add(X.randDir(r).multiplyScalar(.18)).normalize()), parts = [], seen = new Set();
        pts.forEach((a, i) => pts.map((b, j) => ({ j, d: a.distanceTo(b) })).filter(o => o.j !== i).sort((x, y) => x.d - y.d).slice(0, 3).forEach(({ j }) => { const key = Math.min(i, j) + '_' + Math.max(i, j); if (seen.has(key)) return; seen.add(key);
          const arc = []; for (let s = 0; s <= 10; s++) arc.push(a.clone().lerp(pts[j], s / 10).normalize().multiplyScalar(1.012)); parts.push(X.taperTube(arc, () => .026, 14, 5)); }));
        return X.merge(parts); }));
      const sacM = X.rimify(pmat(0xffe4ea, { transparent: true, opacity: .22, depthWrite: false, roughness: .08, clearcoat: 1, iridescence: .8, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 600] }), { rim: 0xffffff, rimStr: .45, rimAlpha: .5, rimPow: 2.2 });
      const capM = X.rimify(pmat(0xd8303e, { emissive: 0x500010, emissiveIntensity: .4, roughness: .35 }), { rimAlpha: 0, rimStr: .3 });
      const alv = [];
      for (let i = 0; i < 30; i++) { const g = new THREE.Group(), r = rand(1.8, 3.2), p = awayPos(9, 36); g.position.set(p.x, rand(2.2, 5), p.z);
        g.add(new THREE.Mesh(sph(40, 30), sacM)); const n = new THREE.Mesh(nets[i % 4], capM); n.rotation.set(rand(0, 6), rand(0, 6), 0); g.add(n); g.scale.setScalar(r); e.group.add(g); alv.push(g); }
      // Ⅱ型肺泡细胞（分泌表面活性物质）
      const t2 = []; for (let i = 0; i < 40; i++) { const p = ringPos(5, 30); t2.push({ p: p.setY(.35), r: rand(.5, .75), fy: .6, c: 0xfff2e8, nc: 0xb06ad0 }); } cellCluster(e, t2, { opacity: .75 });
      // 肺泡巨噬细胞（“尘细胞”）
      const dust = []; for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(blobCell(1, 7, 10, i + 30), X.cellMat(0xd8e8ff, { opacity: .55, emissive: 0x303a60, emissiveIntensity: .25 })); m.position.copy(ringPos(8, 20)).setY(1.2);
        m.add(X.inst(sph(8, 6), mat(0x4a3a3a, { roughness: .8 }), 12, (k, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(.2, .7)); d.scale.setScalar(rand(.06, .12)); })); e.group.add(m); dust.push({ m, v: V3(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(.4) }); }
      atmosphere(e, { n: 300, color: 0x9fe8ff, size: .22, opacity: .7, bokeh: 34, bokehColor: 0xffffff, drift: .6 });
      e.group.add(X.particles({ n: 60, R: 30, color: 0xffffff, size: .5, opacity: .8, additive: false, drift: 1 }));
      light(e, 0xfff0e0, 30, V3(0, 12, 0));
      onUpdate(e, (t, dt) => { alv.forEach((a, i) => { const s = a.userData.s ?? (a.userData.s = a.scale.x); a.scale.setScalar(s * (1 + Math.sin(t * 1.2 + i) * .05)); }); dust.forEach(d => { d.m.position.addScaledVector(d.v, dt); d.m.rotation.y += dt * .2; if (d.m.position.length() > 24) d.v.multiplyScalar(-1); }); });
      return e;
    },

    /* ---- 毛细血管 ---- */
    capillary() {
      const e = corridorEnv(5, 100);
      X.mood({ bg: 0x4a1218, fogD: .014, sky: 0xffb0a8, ground: 0x3a0810, hemiI: .8, key: 0xffe0d8, keyI: 1.2, rim: 0xff8a7a, rimI: 1.2, env: [0xffd0c8, 0x7a2a30, 0x2a0508], bloom: .5 });
      vesselTube(e, 6.5, 120, -35, { wall: 0xb8404c, floor: 0xa03444 });
      flowInst(e, X.rbcGeo(true), rbcMat(), 12, { xr: 3, y0: 1.5, y1: 4.2, z0: -95, z1: 15, speed: 3, scale: [1.1, 1.3] });
      flowInst(e, plateletGeo(), pmat(0xffe3a3, { emissive: 0x6a5020, emissiveIntensity: .4 }), 16, { xr: 4, y0: 1, y1: 6, z0: -95, z1: 15, speed: 3.5, scale: [.8, 1] });
      e.sourcePos = V3(0, 0, 10); e.start = V3(0, 0, 4);
      e.spread = n => { const pts = []; for (let i = 0; i < n; i++) pts.push(V3((i % 2 ? 1 : -1) * rand(2, 3.6), .9, -6 - i * 12)); return pts; };
      atmosphere(e, { n: 260, R: 40, color: 0xffd0d0, size: .16, bokehColor: 0xff9090 });
      light(e, 0xff9080, 30, V3(0, 3, -10), 40); light(e, 0xff9080, 30, V3(0, 3, -50), 40);
      return e;
    },

    /* ---- 脾脏红髓 ---- */
    spleen() {
      const e = baseEnv(20);
      X.mood({ bg: 0x220a26, fogD: .03, sky: 0xe0a0ff, ground: 0x2a0a20, hemiI: .8, key: 0xffe0f0, keyI: 1.3, rim: 0xc080ff, rimI: 1.6, env: [0xe0b0ff, 0x4a1a4a, 0x14040e], bloom: .55 });
      ground(e, { color: 0x4a1a40, color2: 0x6a2050, nrm: 'cells', nrep: 18, amp: .35 });
      // 脾索：网状细胞构成的三维网架
      const nodes = []; for (let i = 0; i < 70; i++) { const p = awayPos(8, 32); p.y = rand(.5, 6.5); nodes.push(p); }
      e.group.add(new THREE.Mesh(network(nodes, 8, 2, t => .1 + .08 * (1 - Math.sin(t * Math.PI)), () => rand(.22, .34)), X.tissueMat(0xb0608a, { nrm: 'membrane', nrep: 1, nscale: .6, rimStr: .35 })));
      // 静脉窦：木桶板样的杆状内皮 + 环形箍
      const staveG = cached('stave', () => { const ps = []; for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; ps.push(X.bake(bumpy(new THREE.CapsuleGeometry(.32, 7.5, 6, 12), .04, 2, i), V3(Math.cos(a) * 2.2, 3.9, Math.sin(a) * 2.2))); } return X.merge(ps); });
      const hoopG = cached('hoop', () => X.merge([...Array(7)].map((_, k) => X.bake(new THREE.TorusGeometry(2.5, .06, 6, 40), V3(0, .7 + k * 1.15, 0), X.qFrom(V3(0, 0, 1), UP)))));
      const sm = X.tissueMat(0xc06a90, { nrm: 'endo', nrep: 1, nrepY: 3, rimStr: .35 }), hm = mat(0x6a2050, { emissive: 0x3a1030, emissiveIntensity: .4 });
      for (let i = 0; i < 6; i++) { const g = new THREE.Group(); g.add(new THREE.Mesh(staveG, sm), new THREE.Mesh(hoopG, hm)); g.position.copy(awayPos(9, 26)); g.rotation.set(rand(-.15, .15), rand(0, 6), rand(-.15, .15)); e.group.add(g); }
      // 巨噬细胞（结局动画用，children[0] = 细胞体）
      const Mc = new THREE.Group(); const body = new THREE.Mesh(blobCell(3.2, 9, 8, 77), X.cellMat(0xc9b6ff, { opacity: .6, emissive: 0x000000, emissiveIntensity: 0, rim: 0xe8dcff, nrep: 10, nscale: .25 })); Mc.add(body);
      const n = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.1, 28, 20), .08, 2), pmat(0x5a3d99, { emissive: 0x2a1a5a, emissiveIntensity: .4, normalMap: X.normalTex('chromatin') })); n.scale.set(1.3, .8, .9); Mc.add(n);
      Mc.add(X.inst(sph(12, 10), pmat(0xc266ff, { emissive: 0x7a1cff, emissiveIntensity: .6 }), 14, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(1.5, 2.5)); d.scale.setScalar(rand(.2, .35)); }));
      Mc.add(X.inst(sph(8, 6), mat(0x8a4a20, { emissive: 0x3a1a00, emissiveIntensity: .4 }), 30, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(1, 2.6)); d.scale.setScalar(rand(.08, .14)); })); // 含铁血黄素
      Mc.position.set(-14, 3.6, -10); e.group.add(Mc); e.macrophage = Mc;
      // 衰老红细胞：皱缩的棘形红细胞
      const echino = cached('echino', () => { const g = X.rbcGeo(true).clone(), ps = [g]; for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2 + (i % 2) * .1, top = i % 3 === 0; const p = top ? V3(Math.cos(a) * .55, .26 * (i % 2 ? 1 : -1), Math.sin(a) * .55) : V3(Math.cos(a) * .98, 0, Math.sin(a) * .98); const nrm = top ? V3(0, Math.sign(p.y), 0).lerp(p.clone().setY(0).normalize(), .4).normalize() : p.clone().normalize(); ps.push(X.bake(new THREE.ConeGeometry(.05, .16, 5), p.clone().addScaledVector(nrm, .05), X.qFrom(UP, nrm))); } return X.merge(ps); });
      instFloat(e, echino, pmat(0x8c2228, { roughness: .45, clearcoat: .5, sheen: .5, sheenColor: new THREE.Color(0xc06070) }), 28, 24, { scale: [.9, 1.1], drift: .5, y0: 1, y1: 4.5 });
      atmosphere(e, { n: 240, R: 26, color: 0xd0a0ff, size: .18, bokehColor: 0xc080ff });
      light(e, 0xb080ff, 30, V3(0, 8, 0));
      return e;
    },

    /* ---- 血管 ---- */
    vessel() {
      const e = corridorEnv(7, 110); e.flow = 2.2;
      X.mood({ bg: 0x4a1218, fogD: .013, sky: 0xffb0a8, ground: 0x3a0810, hemiI: .8, key: 0xffe0d8, keyI: 1.2, rim: 0xff8a7a, rimI: 1.3, env: [0xffd0c8, 0x7a2a30, 0x2a0508], bloom: .5 });
      vesselTube(e, 9, 140, -40, { wall: 0xb03a48, floor: 0x9a3040 });
      flowInst(e, X.rbcGeo(true), rbcMat(), 110, { xr: 6.5, y0: 1, y1: 8, z0: -105, z1: 20, speed: 6, scale: [1.05, 1.25] });
      flowInst(e, plateletGeo(), pmat(0xffe3a3, { emissive: 0x6a5020, emissiveIntensity: .4 }), 40, { xr: 6.5, y0: 1, y1: 8, z0: -105, z1: 20, speed: 6.5, scale: [.8, 1.1] });
      // 贴壁滚动的白细胞
      const wm = X.cellMat(0xe0d8ff, { opacity: .55, wobble: .03 });
      for (let i = 0; i < 5; i++) { const w = new THREE.Mesh(cached('wbc', () => X.starGeo(48, d => 1 + .08 * X.ridged(d.x * 5, d.y * 5, d.z * 5))), wm); w.position.set((i % 2 ? 1 : -1) * rand(5, 6), 1.1, -10 - i * 18); w.userData.v = rand(1, 2); e.group.add(w);
        onUpdate(e, (t, dt) => { w.position.z -= w.userData.v * dt; w.rotation.x -= w.userData.v * dt; if (w.position.z < -100) w.position.z = 15; }); }
      atmosphere(e, { n: 300, R: 40, color: 0xffd0d0, size: .15, bokehColor: 0xff9090 });
      light(e, 0xff9080, 40, V3(0, 5, -20), 60); light(e, 0xff9080, 40, V3(0, 5, -70), 60);
      return e;
    },

    /* ---- 感染灶 ---- */
    infection() {
      const e = baseEnv(26);
      X.mood({ bg: 0x20240c, fogD: .024, sky: 0xe8ffb0, ground: 0x2a2a08, hemiI: .8, key: 0xfff4d0, keyI: 1.4, rim: 0xc0ff60, rimI: 1.4, env: [0xf0ffc0, 0x4a5018, 0x101204], bloom: .5 });
      ground(e, { color: 0x5b6a24, color2: 0x7a6230, nrm: 'cells', nrep: 16, amp: .5 });
      // 肿胀、受损的组织细胞
      const tc = []; for (let i = 0; i < 34; i++) { const p = ringPos(7, 32); tc.push({ p: p.setY(.4), r: rand(1.1, 1.9), fy: .55, c: colorOf(0xd8c08a, 0xb89a6a, Math.random()), nc: 0x6a3a6a, nr: .35 }); } cellCluster(e, tc, { opacity: .55 });
      // 细菌菌落：杆菌 + 链球菌
      const bacG = cached('bacS', () => bumpy(new THREE.CapsuleGeometry(.18, .5, 6, 12), .015, 6));
      const bm = pmat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .5, clearcoat: .7, normalMap: X.normalTex('fine') });
      const cols = [...Array(12)].map(() => ringPos(8, 30));
      e.group.add(X.inst(bacG, bm, 180, (i, d) => { const c = cols[i % 12]; d.position.set(c.x + rand(-1.6, 1.6), rand(.35, 1.2), c.z + rand(-1.6, 1.6)); d.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6)); return colorOf(0x7ddc4c, 0xb8e060, Math.random()); }));
      const chains = []; for (let k = 0; k < 10; k++) { const pts = X.walk(ringPos(6, 28).setY(.6), X.randDir().setY(.1), 5, 14, .7); pts.forEach(p => chains.push(p)); }
      e.group.add(X.inst(sph(12, 10), pmat(0x9ae060, { emissive: 0x3a7a1a, emissiveIntensity: .5, clearcoat: .6 }), chains.length, (i, d) => { d.position.copy(chains[i]); d.position.y = Math.max(.4, d.position.y); d.scale.setScalar(.2); }));
      // 生物膜：包裹菌落的黏液
      e.group.add(X.inst(cached('slime', () => bumpy(new THREE.SphereGeometry(1, 32, 24), .15, 1.5)), X.cellMat(0xd0e880, { opacity: .22, depthWrite: false, nrm: 'fine', nrep: 2 }), 12, (i, d) => { d.position.copy(cols[i]).setY(.3); d.scale.set(2.6, 1.1, 2.6); }));
      // 中性粒细胞胞外诱捕网（NETs）：发光的 DNA 网 + 颗粒蛋白
      const net = [], netDots = []; for (let k = 0; k < 3; k++) { const c = ringPos(8, 22).setY(2); for (let i = 0; i < 18; i++) { const a = c.clone().add(X.randDir().multiplyScalar(rand(0, 3))), b = c.clone().add(X.randDir().multiplyScalar(rand(3, 6))); a.y = Math.max(.3, a.y); b.y = Math.max(.3, b.y); const pts = [a, a.clone().lerp(b, .5).add(X.randDir().multiplyScalar(.8)), b]; net.push(X.taperTube(pts, () => .035, 20, 4)); const cv = new THREE.CatmullRomCurve3(pts); for (let s = 0; s < 6; s++) netDots.push(cv.getPointAt(Math.random())); } }
      e.group.add(new THREE.Mesh(X.merge(net), X.glowMat(0xd8e8ff, .8, { transparent: true, opacity: .75 })));
      e.group.add(X.inst(sph(8, 6), X.glowMat(0xd070ff, 1.2), netDots.length, (i, d) => { d.position.copy(netDots[i]); d.scale.setScalar(.08); }));
      // 纤维蛋白丝
      const fb = []; for (let i = 0; i < 26; i++) { const st = ringPos(9, 30); const pts = X.walk(st.setY(rand(.5, 3)), st.clone().setY(0).normalize().applyAxisAngle(UP, rand(1.2, 1.9)), rand(8, 14), 6, .6); pts.forEach(p => p.y = clamp(p.y, .3, 5)); fb.push(X.taperTube(pts, () => .06, 40, 5)); }
      e.group.add(new THREE.Mesh(X.merge(fb), pmat(0xfff2c0, { roughness: .25, clearcoat: 1, transparent: true, opacity: .8, emissive: 0x4a4020, emissiveIntensity: .3 })));
      // 脓：死亡的中性粒细胞（分叶核可见）
      const pus = []; for (let i = 0; i < 12; i++) { const p = ringPos(6, 28); pus.push({ p: p.setY(.6), r: rand(.8, 1.1), c: 0xfff4c8, nc: 0x7a4ab0, nr: .4 }); } cellCluster(e, pus, { opacity: .7 });
      floaters(e, 26, 28, () => { const m = new THREE.Mesh(M.proteinGeo(11, .5), X.glowMat(0xffe36e, .9)); m.scale.setScalar(.8); return m; }, 1);
      atmosphere(e, { n: 280, color: 0xe0f0a0, size: .18, bokehColor: 0xc0ff80 });
      light(e, 0xc0ff80, 30, V3(0, 8, 0));
      return e;
    },

    /* ---- 大脑皮层 ---- */
    cortex() {
      const e = baseEnv(26);
      X.mood({ bg: 0x060a24, fogD: .02, sky: 0x8aa8ff, ground: 0x080a20, hemiI: .7, key: 0xc8d8ff, keyI: 1.2, rim: 0x6a8aff, rimI: 1.8, env: [0x9ab8ff, 0x141a50, 0x04061a], bloom: .7 });
      ground(e, { color: 0x141b46, color2: 0x1c1a50, nrm: 'cells', nrep: 16, amp: .3, emissive: 0x04061a });
      // 放射状胶质纤维（神经元迁移的“梯子”）
      const rg = []; for (let i = 0; i < 18; i++) { const b = ringPos(5, 34), h = b.length() > 28 ? 3.4 : 1, pts = []; for (let k = 0; k <= 8; k++) pts.push(V3(b.x + Math.sin(k + i) * .5, k * h - .5, b.z + Math.cos(k * .7 + i) * .5)); rg.push(X.taperTube(pts, t => t < .06 ? .7 - t * 8 : .18, 50, 7)); }
      e.group.add(new THREE.Mesh(X.merge(rg), X.cellMat(0x7a7ad8, { opacity: .45, depthWrite: false, emissive: 0x2a2f7a, emissiveIntensity: .5, nrm: 'fibrous', nrep: 1 })));
      // 锥体神经元（胞体 + 树突合并成一个网格）
      const nm = X.rimify(pmat(0x3a58c0, { emissive: 0x1a2a80, emissiveIntensity: .7, roughness: .35, normalMap: X.normalTex('membrane') }), { rim: 0x9fc0ff, rimStr: .7, rimAlpha: 0 });
      const variants = [0, 1, 2, 3, 4].map(k => cached('cn' + k, () => { const N = M.neuronParts({ somaR: .9, nDend: 6, seed: 60 + k, reach: 1.4, depth: 2, spines: false }); return X.merge([N.soma, N.dend]); }));
      const axons = [];
      for (let i = 0; i < 18; i++) { const m = new THREE.Mesh(variants[i % 5], nm); const p = ringPos(6, 32); m.position.set(p.x, rand(1.8, 5.5), p.z); m.rotation.set(rand(-.3, .3), rand(0, 6), rand(-.3, .3)); m.scale.setScalar(rand(.8, 1.3)); e.group.add(m);
        const start = V3(0, -.1, 1.5).applyEuler(m.rotation).multiplyScalar(m.scale.x).add(m.position); axons.push(X.walk(start, V3(rand(-1, 1), -.4, rand(-1, 1)), rand(10, 18), 10, .35)); }
      // 有髓轴突 + 郎飞结 + 奔跑的动作电位
      const am = X.rimify(pmat(0x5a78e0, { emissive: 0x1a2a80, emissiveIntensity: .5 }), { rimAlpha: 0, rim: 0x9fc0ff });
      e.group.add(new THREE.Mesh(X.merge(axons.map(pts => X.taperTube(pts, () => .09, 60, 6))), am));
      const myl = []; axons.forEach(pts => { const cv = new THREE.CatmullRomCurve3(pts); for (let t = .12; t < .95; t += .09) myl.push({ p: cv.getPointAt(t), d: cv.getTangentAt(t) }); });
      e.group.add(X.inst(cached('myel', () => new THREE.CapsuleGeometry(.22, .7, 6, 14)), pmat(0xfff0cc, { roughness: .25, clearcoat: .9, emissive: 0x3a3010, emissiveIntensity: .3 }), myl.length, (i, d) => { d.position.copy(myl[i].p); d.quaternion.copy(X.qFrom(UP, myl[i].d)); }));
      const aps = axons.map((pts, i) => { const s = X.glowSprite(0xffe36e, 1.4, .9); e.group.add(s); return { s, cv: new THREE.CatmullRomCurve3(pts), o: rand(0, 1), v: rand(.25, .45) }; });
      // 星形胶质细胞：星状突起，部分终足贴在血管上
      const vesPts = []; for (let k = 0; k <= 10; k++) vesPts.push(V3(-34 + k * 7, 1.2 + Math.sin(k) * .8, -14 + Math.cos(k * .8) * 5));
      const vcv = new THREE.CatmullRomCurve3(vesPts);
      e.group.add(new THREE.Mesh(X.taperTube(vcv, () => .7, 120, 16), X.cellMat(0xd04058, { opacity: .6, depthWrite: true, emissive: 0x500818, emissiveIntensity: .5, nrm: 'endo', nrep: 2 })));
      const ast = []; for (let i = 0; i < 9; i++) { const c = i < 4 ? vcv.getPointAt(i / 4 + .1).add(V3(rand(-2, 2), rand(2, 3), rand(-2, 2))) : ringPos(6, 30).setY(rand(3, 7)); ast.push(X.bake(bumpy(new THREE.SphereGeometry(.45, 16, 12), .06, 3), c));
        for (let k = 0; k < 14; k++) { const d = X.randDir(); let pts = X.walk(c, d, rand(1.5, 3), 5, .6); if (i < 4 && k < 3) { const tgt = vcv.getPointAt(clamp(i / 4 + .1 + rand(-.05, .05), 0, 1)); pts = [c, c.clone().lerp(tgt, .5).add(X.randDir().multiplyScalar(.4)), tgt]; ast.push(X.bake(new THREE.SphereGeometry(.22, 8, 6), tgt)); } ast.push(X.taperTube(pts, t => lerp(.1, .025, t), 20, 5)); } }
      e.group.add(new THREE.Mesh(X.merge(ast), X.cellMat(0xb8b8ff, { opacity: .6, depthWrite: true, emissive: 0x3a3aa0, emissiveIntensity: .5, nrm: null })));
      floaters(e, 60, 34, () => { const m = new THREE.Mesh(sph(8, 6), X.glowMat(0xffe36e, 1.8)); m.scale.setScalar(.12); return m; }, 1.5);
      atmosphere(e, { n: 420, R: 36, color: 0x8fb0ff, size: .16, bokehColor: 0x6a8aff });
      light(e, 0x6080ff, 40, V3(0, 10, 0));
      onUpdate(e, t => aps.forEach(a => { const k = (t * a.v + a.o) % 1; a.s.position.copy(a.cv.getPointAt(k)); a.s.material.opacity = Math.sin(k * Math.PI) * .9; }));
      return e;
    },

    /* ---- 小肠上皮（俯视） ---- */
    epithelium() {
      const e = baseEnv(26);
      X.mood({ bg: 0x2e140a, fogD: .022, sky: 0xffd8b8, ground: 0x2a1006, hemiI: .6, key: 0xfff0e0, keyI: 1.25, rim: 0xffa060, rimI: 1.5, env: [0xffe0c8, 0x5a2a14, 0x140804], bloom: .4 });
      ground(e, { color: 0x6a3a2a, color2: 0x5a2a20, nrm: 'fine', nrep: 20, amp: .1 });
      // 六角柱状细胞：圆角顶面带刷状缘纹理
      const hexTop = cached('hexTop', () => { const HR = 1.9, HH = .7, RR = .35; const hex = (px, py, pz, hr, hh) => { let x = Math.abs(px), y = Math.abs(pz); const z = Math.abs(py), kx = -.8660254, ky = .5, kz = .57735; const dd = 2 * Math.min(kx * x + ky * y, 0); x -= dd * kx; y -= dd * ky; const cx = clamp(x, -kz * hr, kz * hr); const dx = Math.hypot(x - cx, y - hr) * Math.sign(y - hr), dy = z - hh; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)); };
        return bumpy(X.sdfShrink(p => hex(p.x, p.y, p.z, HR - RR, HH - RR) - RR, 3, 36), .02, 1.5); });
      const hm = X.rimify(pmat(0xffffff, { roughness: .7, clearcoat: .3, normalMap: X.rep(X.normalTex('membrane', 9), 5), normalScale: new THREE.Vector2(1.1, 1.1) }), { rim: 0xffc890, rimStr: .3, rimAlpha: 0 });
      const pos = [], goblets = []; for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) { const x = q * 3.64, z = (r + q / 2) * 4.2; const d = Math.hypot(x, z); if (d < 5 || d > 34) continue; pos.push(V3(x, 0, z)); if (Math.random() < .08) goblets.push(V3(x, .5, z)); }
      e.group.add(X.inst(hexTop, hm, pos.length, (i, d) => { d.position.copy(pos[i]); d.scale.set(1, rand(.9, 1.1), 1); return colorOf(0xf0a060, 0xd87848, Math.random()); }));
      // 紧密连接：每个细胞顶端的发光六边形环
      e.group.add(X.inst(cached('tj', () => new THREE.TorusGeometry(2.12, .045, 4, 6).rotateX(-Math.PI / 2)), X.glowMat(0xffe0a0, .8), pos.length, (i, d) => { d.position.copy(pos[i]).setY(.42); }));
      // 杯状细胞：顶端鼓出的黏液泡
      e.group.add(X.inst(sph(28, 20), X.cellMat(0xf4f0ff, { opacity: .8, depthWrite: true, emissive: 0x404060, emissiveIntensity: .2, nrm: 'fine', nrep: 2 }), goblets.length, (i, d) => { d.position.copy(goblets[i]); d.scale.set(1.3, .75, 1.3); }));
      // 黏液丝 + 共生菌
      const mu = []; for (let i = 0; i < 8; i++) { const pts = X.walk(awayPos(10, 28).setY(rand(1.5, 3)), X.randDir(), rand(6, 12), 6, .5); pts.forEach(p => p.y = clamp(p.y, 1, 4)); mu.push(X.taperTube(pts, t => .12 + .08 * Math.sin(t * 9), 40, 6)); }
      e.group.add(new THREE.Mesh(X.merge(mu), X.cellMat(0xf0f4ff, { opacity: .18, nrm: 'fine', nrep: 1 })));
      instFloat(e, cached('bacS', () => bumpy(new THREE.CapsuleGeometry(.18, .5, 6, 12), .015, 6)), pmat(0x9ad070, { emissive: 0x3a6a20, emissiveIntensity: .4 }), 30, 26, { y0: 2, y1: 7, scale: [.9, 1.2] });
      atmosphere(e, { n: 220, R: 30, color: 0xffe0c0, size: .18, bokehColor: 0xffc080 });
      light(e, 0xffc080, 30, V3(0, 8, 0));
      return e;
    },

    /* ---- 细胞核内部 ---- */
    nucleus() {
      const e = baseEnv(24);
      X.mood({ bg: 0x140a2c, fogD: .022, sky: 0xc8a8ff, ground: 0x100620, hemiI: .75, key: 0xe8d8ff, keyI: 1.3, rim: 0xa080ff, rimI: 1.8, env: [0xd0b0ff, 0x2a1a50, 0x0a0418], bloom: .6 });
      ground(e, { color: 0x2a1a4a, color2: 0x3a1a5a, nrm: 'fine', nrep: 8, nscale: .8, amp: .3, emissive: 0x0a0418 });
      // 核膜（从内部看）+ 核孔复合体（胞质环 + 中央通道 + 核篮）
      e.group.add(new THREE.Mesh(new THREE.SphereGeometry(34, 64, 48), X.tissueMat(0x5a3d99, { side: THREE.BackSide, nrm: 'membrane', nrep: 10, transparent: true, opacity: .7, rimStr: .2 })));
      const npc = cached('npc', () => { const ps = [new THREE.TorusGeometry(1.1, .28, 8, 16)]; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; ps.push(X.bake(new THREE.SphereGeometry(.32, 8, 6), V3(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0))); ps.push(X.taperTube([V3(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0), V3(Math.cos(a) * .9, Math.sin(a) * .9, 1), V3(Math.cos(a) * .45, Math.sin(a) * .45, 1.8)], () => .06, 8, 4)); }
        ps.push(X.bake(new THREE.TorusGeometry(.45, .08, 6, 16), V3(0, 0, 1.8))); ps.push(new THREE.CylinderGeometry(.35, .35, .6, 12).rotateX(Math.PI / 2)); return X.merge(ps); });
      e.group.add(X.inst(npc, mat(0xb89aff, { emissive: 0x5a3aa0, emissiveIntensity: .6, roughness: .4 }), 110, (i, d) => { const dir = X.fib(i, 220); if (dir.y < 0) dir.y = -dir.y; d.position.copy(dir).multiplyScalar(33.3); d.lookAt(0, 0, 0); }));
      // 核仁
      const nl = new THREE.Mesh(bumpy(new THREE.SphereGeometry(6, 64, 48), .9, .5), X.tissueMat(0x3a1a6a, { nrm: 'chromatin', nrep: 4, emissive: 0x2a0a4a, emissiveIntensity: .5, roughness: .8, rim: 0xa080ff, rimStr: .5 })); nl.position.set(-18, 4, -16); e.group.add(nl);
      e.group.add(X.inst(sph(12, 10), X.glowMat(0xffd0ff, 1.2), 20, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(6.1).add(nl.position); d.scale.setScalar(rand(.4, .8)); }));
      // 染色质纤维：DNA 串珠（核小体 = 组蛋白八聚体 + 缠绕 1.7 圈的 DNA）
      const nuc = cached('nucleosome', () => { const ps = [new THREE.CylinderGeometry(.3, .3, .26, 18)]; const pts = []; for (let k = 0; k <= 60; k++) { const a = k / 60 * Math.PI * 2 * 1.7; pts.push(V3(Math.cos(a) * .36, -.15 + k / 60 * .3, Math.sin(a) * .36)); } ps.push(X.taperTube(pts, () => .055, 60, 5)); return X.merge(ps); });
      const beads = [], dna = []; const cols = [0xb388ff, 0xff8fb1, 0x8fe9ff, 0xffd08a];
      for (let i = 0; i < 14; i++) { const pts = []; let p = V3(rand(-24, 24), rand(2.5, 6), rand(-24, 24)); for (let k = 0; k < 9; k++) { pts.push(p.clone()); p = p.clone().add(V3(rand(-6, 6), rand(-1.2, 1.2), rand(-6, 6))); p.y = clamp(p.y, 2, 7); }
        const cv = new THREE.CatmullRomCurve3(pts); dna.push(X.taperTube(cv, () => .07, 200, 5)); const L = cv.getLength(); for (let s = .3; s < L; s += .75) beads.push({ p: cv.getPointAt(s / L), d: cv.getTangentAt(s / L), c: cols[i % 4] }); }
      e.group.add(new THREE.Mesh(X.merge(dna), X.glowMat(0xe0d0ff, .5)));
      e.group.add(X.inst(nuc, pmat(0xffffff, { emissive: 0x2a1a50, emissiveIntensity: .5, roughness: .35, clearcoat: .6 }), beads.length, (i, d) => { d.position.copy(beads[i].p); d.quaternion.copy(X.qFrom(UP, beads[i].d)); d.rotateY(rand(0, 6)); return beads[i].c; }));
      // 核斑点
      e.group.add(X.inst(cached('blobN', () => bumpy(new THREE.SphereGeometry(1, 14, 10), .2, 1.2)), X.glowMat(0x9a6aff, .45), 26, (i, d) => { d.position.copy(ringPos(6, 30)).setY(rand(1.5, 7)); d.scale.setScalar(rand(.2, .45)); }));
      atmosphere(e, { n: 420, R: 30, color: 0xc0a0ff, size: .16, bokehColor: 0xa080ff });
      light(e, 0xa080ff, 40, V3(0, 10, 0));
      return e;
    },

    /* ---- 小肠绒毛 ---- */
    villus() {
      const e = baseEnv(18);
      X.mood({ bg: 0x40200f, fogD: .022, sky: 0xffe0c8, ground: 0x3a1408, hemiI: .65, key: 0xfff0e0, keyI: 1.35, rim: 0xffa070, rimI: 1.5, env: [0xffe8d8, 0x7a3a20, 0x1a0804], bloom: .45 });
      ground(e, { color: 0xd88a6a, color2: 0xc07050, nrm: 'cells', nrep: 26, amp: .3 });
      // 肠腺隐窝开口
      const cr = [...Array(16)].map(() => ({ p: ringPos(4, 30), s: rand(.8, 1.2) }));
      e.group.add(X.inst(cached('crypt', () => new THREE.TorusGeometry(1, .35, 10, 28).rotateX(-Math.PI / 2)), X.tissueMat(0xe0987a, { nrm: 'cells', nrep: 2 }), 16, (i, d) => { d.position.copy(cr[i].p).setY(.05); d.scale.set(cr[i].s * .8, cr[i].s * .45, cr[i].s * .8); }));
      e.group.add(X.inst(cached('cryptD', () => new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2)), mat(0x2a0a04, { roughness: 1 }), 16, (i, d) => { d.position.copy(cr[i].p).setY(.1); d.scale.setScalar(cr[i].s * .8); }));
      // 绒毛：指状突起，表面是吸收细胞的铺路石纹理 + 白色杯状细胞
      const vil = [0, 1, 2, 3].map(k => cached('vil' + k, () => { const r = X.rng(k + 80), h = 7 + k * 2.2, pts = []; for (let s = 0; s <= 8; s++) pts.push(V3(Math.sin(s * .6 + k) * .4, s / 8 * h, Math.cos(s * .5 + k) * .4));
        const cv = new THREE.CatmullRomCurve3(pts), body = X.taperTube(cv, t => 1.35 - t * .2 + (t > .92 ? -(1 - Math.sqrt(Math.max(0, 1 - ((t - .92) / .08) ** 2))) * 1.1 : 0), 60, 28);
        const gob = []; for (let i = 0; i < 26; i++) { const t = .05 + r() * .85, p = cv.getPointAt(t), a = r() * Math.PI * 2, rr = 1.35 - t * .2; gob.push(X.paint(X.bake(new THREE.SphereGeometry(.28, 10, 8), V3(p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr), null, V3(1, 1.3, 1)), 0xfff8f0)); }
        return X.merge([X.paint(body, 0xffffff), ...gob]); }));
      const vm = X.rimify(pmat(0xffb08a, { vertexColors: true, roughness: .5, clearcoat: .5, normalMap: X.rep(X.normalTex('cells', 7), 7, 6), normalScale: new THREE.Vector2(1, 1), sheen: .5, sheenColor: new THREE.Color(0xffe0c0) }), { rim: 0xffd8c0, rimStr: .45, rimAlpha: 0 });
      scatter(e.group, 30, 38, i => { const m = new THREE.Mesh(vil[i % 4], vm); m.scale.setScalar(rand(.85, 1.1)); return m; }, 19);
      // 近处的矮绒毛 / 微皱襞
      scatter(e.group, 36, 17, i => { const m = new THREE.Mesh(vil[i % 4], vm); m.scale.set(.32, rand(.14, .22), .32); return m; }, 4);
      floaters(e, 30, 28, () => { const m = new THREE.Mesh(cached('chyme', () => bumpy(new THREE.SphereGeometry(.25, 12, 10), .08, 4)), pmat(0xffe9c9, { emissive: 0x4a3a20, emissiveIntensity: .3 })); return m; }, .8);
      atmosphere(e, { n: 220, R: 30, color: 0xffe0c0, size: .18, bokehColor: 0xffb080 });
      light(e, 0xffb080, 30, V3(0, 8, 0));
      return e;
    },

    /* ---- 肌肉组织 ---- */
    muscle() {
      const e = baseEnv(26);
      X.mood({ bg: 0x3a1018, fogD: .022, sky: 0xffc0c0, ground: 0x2a0810, hemiI: .8, key: 0xffe8e0, keyI: 1.5, rim: 0xff7080, rimI: 1.6, env: [0xffd0d0, 0x6a2028, 0x1a0408], bloom: .5 });
      ground(e, { color: 0x5a1a22, color2: 0x4a1418, nrm: 'fibrous', nrep: 8, amp: .15 });
      // 平行排列的肌纤维（带横纹贴图）
      const fm = X.rimify(pmat(0xffffff, { map: X.rep(X.colorTex('stripes'), 1, 55), roughness: .42, clearcoat: .6, clearcoatRoughness: .3, sheen: .5, sheenColor: new THREE.Color(0xff9090) }), { rim: 0xffb0b0, rimStr: .35, rimAlpha: 0 });
      const fiberG = cached('fiber', () => X.axisUV(bumpy(new THREE.CapsuleGeometry(1.15, 70, 8, 32), .03, .6)));
      for (let i = -12; i <= 12; i++) { const f = new THREE.Mesh(fiberG, fm); f.rotation.x = Math.PI / 2; f.rotation.y = rand(0, 6); f.position.set(i * 2.45, -.75, rand(-.5, .5)); e.group.add(f); }
      // 边缘扁平的细胞核
      e.group.add(X.inst(cached('mn', () => bumpy(new THREE.SphereGeometry(1, 16, 12), .05, 2)), X.rimify(pmat(0x8a4bd6, { emissive: 0x3a1a6a, emissiveIntensity: .45, normalMap: X.normalTex('chromatin') }), { rimAlpha: 0, rimStr: .3 }), 200, (i, d) => { const x = (Math.floor(rand(-12, 13))) * 2.45, a = rand(.3, Math.PI - .3); d.position.set(x + Math.cos(a) * 1.13, -.75 + Math.sin(a) * 1.13, rand(-34, 34)); d.rotation.z = a - Math.PI / 2; d.scale.set(.25, .1, .6); }));
      // 纤维之间的毛细血管
      const caps = []; for (let i = -12; i < 12; i++) { const x = i * 2.45 + 1.22, pts = []; for (let z = -35; z <= 35; z += 5) pts.push(V3(x + Math.sin(z * .3 + i) * .15, -.05 + Math.sin(z * .2) * .08, z)); caps.push(X.taperTube(pts, () => .14, 80, 6)); }
      e.group.add(new THREE.Mesh(X.merge(caps), pmat(0xff4a5a, { emissive: 0x600010, emissiveIntensity: .6, roughness: .3, clearcoat: .8 })));
      // 远处的肌束（肌束膜包裹）
      for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(X.axisUV(bumpy(new THREE.CapsuleGeometry(rand(3, 5), 80, 8, 32), .25, .5, i)), X.tissueMat(0xb03a48, { nrm: 'fibrous', nrep: 3, nrepY: 20, rim: 0xff9090, rimStr: .3 })); b.rotation.x = Math.PI / 2; b.position.set(rand(-6, 6) + (i < 3 ? -40 : 40), rand(2, 14), 0); e.group.add(b); }
      // 运动神经轴突：髓鞘节段 + 神经-肌肉接头的终板
      const axPts = [V3(-34, 7, 34), V3(-18, 5, 16), V3(-11, 3, 4), V3(-10, 1.6, -10), V3(-13, 1.4, -22)]; const acv = new THREE.CatmullRomCurve3(axPts);
      e.group.add(new THREE.Mesh(X.taperTube(acv, () => .16, 120, 8), X.glowMat(0x9fd8ff, .6)));
      const my = []; for (let t = .02; t < .98; t += .045) my.push({ p: acv.getPointAt(t), d: acv.getTangentAt(t) });
      e.group.add(X.inst(cached('myel2', () => new THREE.CapsuleGeometry(.32, 1.4, 6, 16)), pmat(0xfff0cc, { roughness: .25, clearcoat: .9, emissive: 0x3a3010, emissiveIntensity: .3 }), my.length, (i, d) => { d.position.copy(my[i].p); d.quaternion.copy(X.qFrom(UP, my[i].d)); }));
      const nmj = []; [.35, .55, .75].forEach(t => { const p = acv.getPointAt(t); const x = Math.round(p.x / 2.45) * 2.45; const end = V3(x + rand(-.3, .3), .45, p.z + rand(-1, 1)); nmj.push(X.taperTube([p, p.clone().lerp(end, .5).add(V3(0, .6, 0)), end], t => .08, 20, 6)); for (let k = 0; k < 7; k++) nmj.push(X.bake(new THREE.SphereGeometry(.14, 10, 8), end.clone().add(V3(rand(-.5, .5), rand(-.05, .1), rand(-.5, .5))))); });
      e.group.add(new THREE.Mesh(X.merge(nmj), X.glowMat(0x9fd8ff, 1)));
      atmosphere(e, { n: 260, R: 32, color: 0xffb0b0, size: .18, bokehColor: 0xff8080 });
      light(e, 0xff8070, 40, V3(0, 8, 0));
      e.motorAxon = axPts;
      return e;
    },

    /* ---- 伤口 ---- */
    wound() {
      const e = baseEnv(26);
      X.mood({ bg: 0x2e1210, fogD: .022, sky: 0xffc8b0, ground: 0x2a0a08, hemiI: .8, key: 0xfff0e0, keyI: 1.5, rim: 0xff8a60, rimI: 1.5, env: [0xffd8c8, 0x6a2a20, 0x1a0604], bloom: .5 });
      ground(e, { color: 0x7a3a34, color2: 0x8a4a3a, nrm: 'cells', nrep: 16, amp: .55, colorFn: (x, z, c) => { const w = Math.exp(-(z * z) / 60); c.lerp(new THREE.Color(0x4a0a10), w * .7); } });
      // 纤维蛋白网：交织的亮丝（经典的血凝块电镜图景）
      const fib = []; for (let i = 0; i < 80; i++) { const a = ringPos(7, 30).setY(rand(.3, 4)), b = a.clone().add(X.randDir().multiplyScalar(rand(5, 11))); b.y = clamp(b.y, .2, 5); fib.push(X.taperTube([a, a.clone().lerp(b, .5).add(X.randDir().multiplyScalar(.6)), b], t => .045 + .03 * Math.sin(t * 7), 16, 5)); }
      e.group.add(new THREE.Mesh(X.merge(fib), pmat(0xf4e2b0, { roughness: .3, clearcoat: 1, emissive: 0x3a2a10, emissiveIntensity: .12 })));
      // 被困的红细胞 + 活化血小板（伸出伪足）
      e.group.add(X.inst(X.rbcGeo(true), rbcMat(), 70, (i, d) => { d.position.copy(ringPos(7, 30)).setY(rand(.5, 3.5)); d.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.scale.setScalar(rand(.9, 1.2)); }));
      const aplt = cached('aplt', () => { const ps = [X.smoothNormals(bumpy(new THREE.SphereGeometry(.4, 14, 10), .1, 3).scale(1, .5, 1))]; for (let k = 0; k < 7; k++) { const d = X.randDir(); d.y *= .3; d.normalize(); ps.push(X.taperTube([d.clone().multiplyScalar(.3), d.clone().multiplyScalar(.9).add(X.randDir().multiplyScalar(.15))], t => .06 * (1 - t) + .015, 6, 4)); } return X.merge(ps); });
      e.group.add(X.inst(aplt, pmat(0xffe3a3, { emissive: 0x5a4018, emissiveIntensity: .2, roughness: .5 }), 70, (i, d) => { d.position.copy(ringPos(6, 28)).setY(rand(.4, 3)); d.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6)); d.scale.setScalar(rand(.8, 1.3)); }));
      // 伤口边缘的受损细胞 + 成纤维细胞
      const dc = []; for (let i = 0; i < 26; i++) { const p = ringPos(9, 32); if (Math.abs(p.z) < 7) p.z += Math.sign(p.z || 1) * 8; dc.push({ p: p.setY(.4), r: rand(1, 1.7), fy: .6, c: colorOf(0xd8b098, 0xc89080, Math.random()), nc: 0x6a2d5a }); } cellCluster(e, dc, { opacity: .6 });
      const fbG = cached('fibro', () => X.smoothNormals(X.sdfShrink(p => X.SDF.smin(X.SDF.roundCone(p, V3(-1.6, 0, 0), V3(0, 0, 0), .06, .45), X.SDF.roundCone(p, V3(0, 0, 0), V3(1.8, 0, .2), .45, .05), .3), 2.2, 48).scale(1, .5, 1)));
      e.group.add(X.inst(fbG, X.cellMat(0xf0d0b8, { opacity: .7, depthWrite: true, emissive: 0x4a2a1a, emissiveIntensity: .3 }), 16, (i, d) => { d.position.copy(ringPos(8, 30)).setY(.5); d.rotation.y = rand(0, 6); }));
      // 组织碎片
      e.group.add(X.inst(cached('deb', () => bumpy(new THREE.SphereGeometry(1, 20, 16), .25, 2)), X.rimify(pmat(0x9a7a70, { roughness: .7, normalMap: X.normalTex('fine') }), { rimAlpha: 0, rimStr: .3 }), 18, (i, d) => { d.position.copy(ringPos(7, 28)).setY(.4); d.scale.setScalar(rand(.5, 1.1)); d.rotation.set(rand(0, 6), rand(0, 6), 0); }));
      instFloat(e, X.rbcGeo(true), rbcMat(), 24, 28, { scale: [.7, .85], drift: .6 });
      instFloat(e, plateletGeo(), pmat(0xffe3a3, { emissive: 0x6a5020, emissiveIntensity: .4 }), 24, 26, { scale: [.8, 1] });
      atmosphere(e, { n: 260, color: 0xffc0a0, size: .18, bokehColor: 0xff9060 });
      light(e, 0xff8060, 40, V3(0, 8, 0));
      return e;
    },

    /* ---- 骨髓造血干细胞龛 ---- */
    niche() {
      const e = baseEnv(24);
      X.mood({ bg: 0x221226, fogD: .022, sky: 0xd8c0ff, ground: 0x1a0a1a, hemiI: .8, key: 0xf0e8ff, keyI: 1.4, rim: 0x9ab8ff, rimI: 1.7, env: [0xe0d0ff, 0x3a2040, 0x0e060e], bloom: .55 });
      ground(e, { color: 0x4a2a3a, color2: 0x5a2a4a, nrm: 'cells', nrep: 18, amp: .3 });
      // 骨内膜：弯曲的骨壁 + 成骨细胞衬里
      const wall = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(40, 40, 30, 96, 20, true, Math.PI * .8, Math.PI * .9), .5, .12), X.tissueMat(0xe9dcc4, { side: THREE.DoubleSide, nrm: 'bone', nrep: 6, nrepY: 3, nscale: 1.3, roughness: .8, clearcoat: .15, rimStr: .2 })); wall.position.set(0, 10, 0); e.group.add(wall);
      const obG = cached('osteo', () => bumpy(X.sdfShrink(p => { const qx = Math.abs(p.x) - .75, qy = Math.abs(p.y) - .45, qz = Math.abs(p.z) - .35; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - .25; }, 1.6, 24), .03, 2));
      const obs = []; for (let row = 0; row < 3; row++) for (let i = 0; i < 44; i++) { const a = Math.PI * .8 + Math.PI * .9 * (i + .5 + row * .5) / 44; obs.push({ p: V3(Math.sin(a) * (38.6 - row * .1), 1 + row * 1.5, Math.cos(a) * (38.6 - row * .1)), a }); }
      e.group.add(X.inst(obG, X.cellMat(0xd8c0e8, { opacity: .75, depthWrite: true, rim: 0xf4e8ff, nrep: 1 }), obs.length, (i, d) => { d.position.copy(obs[i].p); d.lookAt(0, obs[i].p.y, 0); return colorOf(0xffffff, 0xe8d8ff, Math.random()); }));
      e.group.add(X.inst(sph(12, 10), pmat(0x6a3aa8, { emissive: 0x3a1a60, emissiveIntensity: .5 }), obs.length, (i, d) => { d.position.copy(obs[i].p).multiplyScalar(.985).setY(obs[i].p.y + .15); d.scale.set(.4, .35, .3); }));
      // 血窦
      const sin = new THREE.Group(); sin.position.set(0, 4, -22); sin.rotation.y = Math.PI / 2; e.group.add(sin);
      sin.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 90, 40, 1, true).rotateX(Math.PI / 2), X.cellMat(0xd06070, { opacity: .25, side: THREE.DoubleSide, nrm: 'endo', nrep: 3, rimAlpha: .35 })));
      flowInst(e, X.rbcGeo(true), rbcMat(), 34, { radial: 2.3, z0: -45, z1: 45, speed: 4, scale: [.8, .9], parent: sin });
      // CXCL12 丰富的网状（CAR）细胞：伸出长突起彼此相连
      const nodes = []; for (let i = 0; i < 22; i++) { const p = ringPos(5, 26); p.y = rand(.8, 4); nodes.push(p); }
      e.group.add(new THREE.Mesh(network(nodes, 10, 3, t => .07 + .05 * (1 - Math.sin(t * Math.PI)), () => rand(.55, .8)), X.cellMat(0xf0c8ff, { opacity: .7, depthWrite: true, emissive: 0x6a3a8a, emissiveIntensity: .45, rim: 0xffe8ff, nrm: null })));
      adipocytes(e, 16, 26, 13);
      const hc = []; for (let i = 0; i < 30; i++) { const p = ringPos(7, 24); hc.push({ p: p.setY(rand(.6, 1.2)), r: rand(.45, .7), c: colorOf(0xd9ccff, 0xffa0a8, Math.random()), nc: 0x5a2d9a }); } cellCluster(e, hc, { opacity: .6 });
      floaters(e, 40, 26, () => new THREE.Mesh(M.proteinGeo(12, .4), X.glowMat(0x9fd8ff, 1.2)), 1); // CXCL12 / SCF 信号
      atmosphere(e, { n: 260, R: 28, color: 0xd0b0ff, size: .18, bokehColor: 0xa0c0ff });
      light(e, 0xa0c0ff, 40, V3(0, 8, 0));
      return e;
    }
  };
  return { ENV };
};
