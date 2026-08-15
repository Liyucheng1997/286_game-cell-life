// ============================================================
//  场景环境：window.CellEnvs(CTX) → { ENV }
//  每个环境返回 { group, type:'disc'|'corridor', R | halfW+len, start, spread(n, ordered), update(t,dt), ... }
// ============================================================
window.CellEnvs = function (CTX) {
  const { THREE, scene, rand, clamp, mat, pmat, bumpy, noise3, ITEM_BUILDERS } = CTX;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---------------- 通用 ---------------- */
  // 起伏地面（带顶点色变化）
  function terrain(color, R = 60, amp = .35, freq = .18, opt = {}) {
    const geo = new THREE.PlaneGeometry(R * 2, R * 2, 90, 90); geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position; const col = new Float32Array(p.count * 3); const c0 = new THREE.Color(color), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); const n = noise3(x * freq, 0, z * freq); p.setY(i, n * amp - .1); c.copy(c0).multiplyScalar(1 + n * .18); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true, roughness: .95, ...opt }));
  }
  function discSpread(R, n, minD = 4) {
    const pts = []; let tries = 0;
    while (pts.length < n && tries++ < 3000) { const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * (R - 3) + 3; const p = V3(Math.cos(a) * r, .9, Math.sin(a) * r);
      if (p.length() < 5) continue; if (pts.every(q => q.distanceTo(p) > minD)) pts.push(p); }
    return pts;
  }
  function orderedPath(R, n) { const pts = []; for (let i = 0; i < n; i++) { const t = (i + 1) / n; const z = 4 - t * (R + 1); const x = Math.sin(t * Math.PI * 2.2 + 1) * R * .38; pts.push(V3(x, 1, z)); } return pts; }
  function baseEnv(bg, fogD, R) {
    scene.background = new THREE.Color(bg); scene.fog = new THREE.FogExp2(bg, fogD);
    const group = new THREE.Group();
    return { group, R, type: 'disc', start: V3(0, 0, 0), spread: (n, ordered) => ordered ? orderedPath(R, n) : discSpread(R, n), update: () => {} };
  }
  function corridorEnv(bg, fogD, halfW, len) {
    scene.background = new THREE.Color(bg); scene.fog = new THREE.FogExp2(bg, fogD);
    const group = new THREE.Group();
    const spread = n => { const pts = []; for (let i = 0; i < n; i++) pts.push(V3(rand(-halfW + 1.5, halfW - 1.5), .9, 8 - (i + 1) * (len - 14) / n)); return pts; };
    return { group, type: 'corridor', halfW, len, start: V3(0, 0, 10), spread, update: () => {} };
  }
  function scatter(group, n, R, make, minR = 6) { for (let i = 0; i < n; i++) { const a = rand(0, Math.PI * 2), r = rand(minR, R); const o = make(i); o.position.set(Math.cos(a) * r, o.position.y, Math.sin(a) * r); o.rotation.y = rand(0, 6); group.add(o); } }
  function floaters(env, n, R, make, drift = 1) {
    const g = new THREE.Group(); env.group.add(g); const list = [];
    for (let i = 0; i < n; i++) { const o = make(); o.position.set(rand(-R, R), rand(2, 9), rand(-R, R)); g.add(o); list.push({ o, v: V3(rand(-1, 1), rand(-.3, .3), rand(-1, 1)).multiplyScalar(drift), s: rand(0, 6) }); }
    const prev = env.update; env.update = (t, dt) => { prev(t, dt); list.forEach(f => { f.o.position.addScaledVector(f.v, dt); f.o.rotation.x += dt * .3; f.o.rotation.y += dt * .2; if (f.o.position.length() > R + 4) f.o.position.multiplyScalar(-.9); }); };
  }
  // 悬浮微粒（Points）
  function dust(env, n, R, color, size = .12) {
    const pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { pos[i * 3] = rand(-R, R); pos[i * 3 + 1] = rand(.5, 12); pos[i * 3 + 2] = rand(-R, R); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: .7, sizeAttenuation: true })); env.group.add(pts);
    const prev = env.update; env.update = (t, dt) => { prev(t, dt); const a = g.attributes.position.array; for (let i = 0; i < n; i++) { a[i * 3 + 1] += Math.sin(t + i) * dt * .3; a[i * 3] += Math.cos(t * .5 + i) * dt * .2; } g.attributes.position.needsUpdate = true; };
  }
  function light(env, color, intensity, pos, dist = 60) { const l = new THREE.PointLight(color, intensity, dist, 1.2); l.position.copy(pos); env.group.add(l); return l; }
  // 血管管腔（内壁铺内皮细胞）
  function vesselTube(env, radius, len, zc, colorWall = 0xa83a44) {
    const tube = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(radius, radius, len, 48, 24, true), .18, .35), pmat(colorWall, { side: THREE.BackSide, roughness: .55, clearcoat: .3 })); tube.rotation.x = Math.PI / 2; tube.position.set(0, radius * .55, zc); env.group.add(tube);
    // 内皮细胞：贴在管壁内侧的扁平椭球
    const endo = new THREE.Group(); const em = pmat(0xc25058, { roughness: .5 });
    for (let i = 0; i < 160; i++) { const a = rand(0, Math.PI * 2), z = rand(-len / 2, len / 2); const e = new THREE.Mesh(new THREE.SphereGeometry(rand(.8, 1.3), 8, 8), em); e.scale.set(1, .25, 1.6); e.position.set(Math.cos(a) * (radius - .1), radius * .55 + Math.sin(a) * (radius - .1), zc + z); e.lookAt(0, radius * .55, zc + z); e.rotateX(Math.PI / 2); endo.add(e); }
    env.group.add(endo);
    for (let i = 0; i < Math.floor(len / 10); i++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(radius - .15, .28, 8, 48), pmat(0xd06068)); ring.position.set(0, radius * .55, zc + len / 2 - 5 - i * 10); env.group.add(ring); }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.2, len), mat(0x8c2c34, { roughness: .95 })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, -.05, zc); env.group.add(floor);
  }
  const rbcDiscGeo = new THREE.LatheGeometry([[0, .2], [.5, .17], [.9, .3], [1.15, .22], [1.2, 0], [1.15, -.22], [.9, -.3], [.5, -.17], [0, -.2]].map(p => new THREE.Vector2(p[0], p[1])), 28);
  const rbcMat = pmat(0xd94848, { roughness: .35, clearcoat: .7, clearcoatRoughness: .3 });
  // 血流中的红细胞
  function bloodFlow(env, n, halfW, zMin, zMax, speed) {
    const list = []; const g = new THREE.Group(); env.group.add(g);
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(rbcDiscGeo, rbcMat); m.position.set(rand(-halfW, halfW), rand(1, halfW + 1), rand(zMin, zMax)); m.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); g.add(m); list.push(m); }
    const prev = env.update; env.update = (t, dt) => { prev(t, dt); list.forEach(m => { m.position.z -= dt * speed; m.rotation.x += dt; if (m.position.z < zMin) m.position.z = zMax; }); };
  }
  function cellBlob(color, r, opt = {}) { const g = new THREE.Group(); const b = new THREE.Mesh(bumpy(new THREE.SphereGeometry(r, 18, 18), r * .06, 3), pmat(color, { transparent: true, opacity: .85, ...opt })); const n = new THREE.Mesh(new THREE.SphereGeometry(r * .4, 10, 10), mat(0x6a3aa8)); n.position.set(r * .2, r * .15, 0); g.add(b, n); return g; }

  /* ================================================================
     环境定义
     ================================================================ */
  const ENV = {
    marrow() {
      const e = baseEnv(0x3a1518, .02, 26); e.group.add(terrain(0x5a1c22, 60, .4));
      // 骨小梁：起伏的骨柱 + 横梁
      scatter(e.group, 20, 32, () => { const h = rand(5, 13); const m = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(rand(.5, .9), rand(.8, 1.4), h, 12, 8), .12, 1.2), pmat(0xe9dcc4, { roughness: .85 })); m.position.y = h / 2 - .5; m.rotation.z = rand(-.25, .25); return m; }, 10);
      scatter(e.group, 8, 30, () => { const m = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(.5, .5, rand(8, 14), 10, 8), .1, 1.2), pmat(0xe9dcc4, { roughness: .85 })); m.rotation.z = Math.PI / 2 + rand(-.3, .3); m.position.y = rand(5, 9); return m; }, 12);
      // 脂肪细胞
      scatter(e.group, 12, 30, () => { const m = new THREE.Mesh(bumpy(new THREE.SphereGeometry(rand(1.2, 1.9), 18, 18), .06, 3), pmat(0xffe08a, { roughness: .5, clearcoat: .6 })); m.position.y = 1.2; return m; }, 12);
      // 血窦
      const sinus = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 70, 24, 1, true), pmat(0xc25058, { transparent: true, opacity: .35, side: THREE.DoubleSide })); sinus.rotation.z = Math.PI / 2; sinus.position.set(0, 9, -18); e.group.add(sinus);
      // 各阶段血细胞
      floaters(e, 24, 30, () => { const m = new THREE.Mesh(rbcDiscGeo, rbcMat); m.scale.setScalar(.7); return m; }, .8);
      floaters(e, 14, 30, () => cellBlob([0xd9ccff, 0xb8f0ff, 0xffc9f0][Math.floor(rand(0, 3))], rand(.5, .8)), .6);
      floaters(e, 8, 30, () => { const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rand(.5, .8), 10, 10), pmat(0xd9c8ff, { transparent: true, opacity: .8 })); s.position.set(rand(-.6, .6), rand(-.6, .6), rand(-.6, .6)); g.add(s); } return g; }, .3); // 巨核细胞
      dust(e, 300, 32, 0xffb0b0, .1); light(e, 0xff8060, 40, V3(0, 8, -6));
      return e;
    },
    lung() {
      const e = baseEnv(0xf3c9cf, .02, 26); e.group.add(terrain(0xf6b8c0, 60, .3));
      const alv = [];
      scatter(e.group, 34, 32, () => { const g = new THREE.Group(); const r = rand(1.6, 3); const s = new THREE.Mesh(bumpy(new THREE.SphereGeometry(r, 26, 26), r * .05, 2.5), pmat(0xffd9df, { transparent: true, opacity: .8, roughness: .3, clearcoat: .8, depthWrite: false })); g.add(s);
        const cap = new THREE.Mesh(new THREE.TorusKnotGeometry(r * .92, .06, 80, 6, 2, 5), pmat(0xd94848)); g.add(cap); const cap2 = new THREE.Mesh(new THREE.TorusKnotGeometry(r * .92, .05, 80, 6, 3, 4), pmat(0xe06070)); g.add(cap2);
        g.position.y = rand(1.5, 5); g.userData.r = r; alv.push(g); return g; });
      floaters(e, 40, 30, () => new THREE.Mesh(new THREE.SphereGeometry(rand(.12, .25), 8, 8), mat(0xffffff, { transparent: true, opacity: .8 })), 1.2);
      dust(e, 200, 32, 0xffffff, .14); light(e, 0xfff0e0, 30, V3(0, 12, 0));
      const prev = e.update; e.update = (t, dt) => { prev(t, dt); alv.forEach((a, i) => a.scale.setScalar(1 + Math.sin(t * 1.2 + i) * .06)); };
      return e;
    },
    capillary() {
      const e = corridorEnv(0x5c1a22, .012, 5, 100);
      vesselTube(e, 6.5, 120, -35);
      e.sourcePos = V3(0, 0, 10); e.start = V3(0, 0, 4);
      e.spread = n => { const pts = []; for (let i = 0; i < n; i++) pts.push(V3((i % 2 ? 1 : -1) * rand(2, 3.6), .9, -6 - i * 12)); return pts; };
      dust(e, 250, 40, 0xffd0d0, .08); light(e, 0xff9080, 30, V3(0, 3, -10), 40); light(e, 0xff9080, 30, V3(0, 3, -50), 40);
      return e;
    },
    spleen() {
      const e = baseEnv(0x2a1030, .028, 20); e.group.add(terrain(0x4a1c40, 50, .3));
      scatter(e.group, 30, 26, () => { const h = rand(3, 8); const m = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(.5, .7, h, 10, 6), .06, 2), pmat(0x8a3a6a)); m.position.y = h / 2; return m; });
      scatter(e.group, 10, 26, () => { const t = new THREE.Mesh(new THREE.TorusGeometry(rand(1.5, 2.5), .25, 8, 40), pmat(0x9a4a7a)); t.position.y = rand(2, 6); t.rotation.set(rand(0, 3), rand(0, 3), 0); return t; }, 8);
      // 巨噬细胞（用于结局动画）
      const M = new THREE.Group(); const mm = pmat(0xc9b6ff, { transparent: true, opacity: .75, roughness: .3, emissive: 0x000000, depthWrite: false }); const body = new THREE.Mesh(bumpy(new THREE.SphereGeometry(3.2, 32, 32), .3, 2), mm); M.add(body);
      for (let i = 0; i < 9; i++) { const dir = V3(rand(-1, 1), rand(-.5, .5), rand(-1, 1)).normalize(); const p = new THREE.Mesh(new THREE.SphereGeometry(.7, 12, 12), mm); p.geometry.scale(1, 2.2, 1); p.position.copy(dir).multiplyScalar(3.6); p.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); M.add(p); }
      const n = new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 14), mat(0x5a3d99)); n.scale.set(1.3, .8, .9); M.add(n);
      for (let i = 0; i < 12; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(rand(.2, .35), 8, 8), mat(0xc266ff, { emissive: 0x7a1cff, emissiveIntensity: .5 })); l.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 2.6)); M.add(l); }
      M.position.set(-14, 3.6, -10); e.group.add(M); e.macrophage = M;
      floaters(e, 25, 24, () => new THREE.Mesh(rbcDiscGeo, pmat(0x8c1f1f)), .5);
      dust(e, 200, 26, 0xd0a0ff, .1); light(e, 0xb080ff, 30, V3(0, 8, 0));
      return e;
    },
    vessel() {
      const e = corridorEnv(0x5c1a22, .012, 7, 110); e.flow = 2.2;
      vesselTube(e, 9, 140, -40);
      bloodFlow(e, 70, 6.5, -105, 20, 6);
      dust(e, 300, 40, 0xffd0d0, .08); light(e, 0xff9080, 40, V3(0, 5, -20), 60); light(e, 0xff9080, 40, V3(0, 5, -70), 60);
      return e;
    },
    infection() {
      const e = baseEnv(0x2f3414, .022, 26); e.group.add(terrain(0x5b6a24, 60, .5, .22));
      // 受损组织细胞
      scatter(e.group, 24, 30, () => { const m = cellBlob(0xb8a06a, rand(1.2, 2)); m.scale.y = .6; m.position.y = .5; return m; });
      // 脓 / 纤维蛋白丝
      scatter(e.group, 12, 28, () => { const m = new THREE.Mesh(bumpy(new THREE.SphereGeometry(rand(.5, .9), 12, 12), .1, 3), pmat(0xf3f0b0, { transparent: true, opacity: .8 })); m.position.y = .5; return m; });
      for (let i = 0; i < 16; i++) { const pts = []; let p = V3(rand(-24, 24), rand(.5, 3), rand(-24, 24)); for (let k = 0; k < 6; k++) { pts.push(p.clone()); p = p.clone().add(V3(rand(-4, 4), rand(-1, 1.5), rand(-4, 4))); }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .07, 5), mat(0xfff5cc, { transparent: true, opacity: .7 })); e.group.add(tube); }
      // 细菌菌落（静态装饰）
      scatter(e.group, 10, 28, () => { const g = new THREE.Group(); for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CapsuleGeometry(.18, .5, 4, 8), pmat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .5 })); b.position.set(rand(-.8, .8), .3, rand(-.8, .8)); b.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); g.add(b); } return g; }, 8);
      floaters(e, 30, 28, () => new THREE.Mesh(new THREE.OctahedronGeometry(.25), mat(0xffe36e, { emissive: 0xffc400, emissiveIntensity: .8 })), 1);
      dust(e, 250, 30, 0xe0f0a0, .1); light(e, 0xc0ff80, 30, V3(0, 8, 0));
      return e;
    },
    cortex() {
      const e = baseEnv(0x0a1030, .018, 26); e.group.add(terrain(0x141b46, 70, .3, .15, { emissive: 0x05081a }));
      scatter(e.group, 16, 34, () => { const h = rand(10, 22); const m = new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, h, 10), pmat(0x6f74c9, { transparent: true, opacity: .5, emissive: 0x2a2f7a, emissiveIntensity: .4, depthWrite: false })); m.position.y = h / 2; return m; });
      scatter(e.group, 22, 34, () => { const g = ITEM_BUILDERS.neuronTarget(); g.scale.setScalar(rand(.6, 1.1)); g.position.y = rand(1, 8); g.children[0].material = pmat(0x3a4fa8, { emissive: 0x1a2560, emissiveIntensity: .6 }); return g; });
      // 星形胶质细胞
      scatter(e.group, 8, 30, () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.SphereGeometry(.5, 10, 10), mat(0xa0a8ff, { transparent: true, opacity: .6 })); g.add(c); for (let i = 0; i < 12; i++) { const d = V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(); const a = new THREE.Mesh(new THREE.CylinderGeometry(.02, .08, rand(1.5, 3), 5), mat(0xa0a8ff, { transparent: true, opacity: .6 })); a.position.copy(d).multiplyScalar(1); a.quaternion.setFromUnitVectors(V3(0, 1, 0), d); a.translateY(.7); g.add(a); } g.position.y = rand(2, 7); return g; }, 8);
      floaters(e, 60, 34, () => new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 6), mat(0xffe36e, { emissive: 0xffe36e, emissiveIntensity: 1.5 })), 1.5);
      dust(e, 400, 36, 0x8fb0ff, .09); light(e, 0x6080ff, 40, V3(0, 10, 0));
      return e;
    },
    epithelium() {
      const e = baseEnv(0x4a2a1c, .02, 26); e.group.add(terrain(0x6a3a2a, 60, .2));
      const hm = pmat(0xffc98a, { transparent: true, opacity: .85, clearcoat: .4 });
      for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) { const x = (q + r / 2) * 4.2, z = r * 3.65; if (Math.hypot(x, z) < 6 || Math.hypot(x, z) > 30) continue;
        const h = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, .5, 6), hm); h.position.set(x, .25, z); e.group.add(h);
        const n = new THREE.Mesh(new THREE.SphereGeometry(.4, 10, 10), mat(0x8a4bd6)); n.position.set(x, .55, z); e.group.add(n);
        for (let k = 0; k < 10; k++) { const v = new THREE.Mesh(new THREE.CylinderGeometry(.03, .04, .35, 4), mat(0xffd08a)); v.position.set(x + rand(-1.4, 1.4), .65, z + rand(-1.4, 1.4)); e.group.add(v); } }
      dust(e, 200, 30, 0xffe0c0, .08); light(e, 0xffc080, 30, V3(0, 8, 0));
      return e;
    },
    nucleus() {
      const e = baseEnv(0x1a0f33, .02, 24); e.group.add(terrain(0x2a1a4a, 50, .3, .2, { emissive: 0x0d0820 }));
      const env = new THREE.Mesh(new THREE.SphereGeometry(34, 48, 48), pmat(0x5a3d99, { side: THREE.BackSide, transparent: true, opacity: .6, roughness: .9 })); e.group.add(env);
      // 核孔
      for (let i = 0; i < 60; i++) { const d = V3(rand(-1, 1), rand(.1, 1), rand(-1, 1)).normalize(); const p = new THREE.Mesh(new THREE.TorusGeometry(1.1, .3, 8, 16), mat(0x9a7cff, { emissive: 0x4a2a9a, emissiveIntensity: .6 })); p.position.copy(d).multiplyScalar(33.5); p.lookAt(0, 0, 0); e.group.add(p); }
      // 核仁
      const nl = new THREE.Mesh(bumpy(new THREE.SphereGeometry(6, 24, 24), .5, 2), pmat(0x3a1a6a, { emissive: 0x2a0a4a, emissiveIntensity: .5, roughness: .8 })); nl.position.set(-16, 8, -14); e.group.add(nl);
      for (let i = 0; i < 12; i++) { const pts = []; let p = V3(rand(-20, 20), rand(6, 12), rand(-20, 20)); for (let k = 0; k < 8; k++) { pts.push(p.clone()); p = p.clone().add(V3(rand(-6, 6), rand(-1.5, 1.5), rand(-6, 6))); p.y = clamp(p.y, 5, 13); }
        const c = [0xb388ff, 0xff8fb1, 0x8fe9ff][i % 3]; const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, .28, 8), pmat(c, { emissive: 0x221144, emissiveIntensity: .5, clearcoat: .5 })); e.group.add(tube);
        for (let k = 0; k < 20; k++) { const q = tube.geometry.parameters.path.getPointAt(k / 20); const h = new THREE.Mesh(new THREE.TorusGeometry(.42, .1, 6, 12), mat(0xffffff, { transparent: true, opacity: .5 })); h.position.copy(q); h.lookAt(tube.geometry.parameters.path.getPointAt(Math.min(1, k / 20 + .01))); e.group.add(h); } }
      dust(e, 400, 30, 0xc0a0ff, .1); light(e, 0xa080ff, 40, V3(0, 10, 0));
      return e;
    },
    villus() {
      const e = baseEnv(0x5a2e1a, .02, 18); e.group.add(terrain(0xd88a6a, 60, .3));
      scatter(e.group, 26, 36, () => { const h = rand(6, 14); const g = new THREE.Group(); const m = new THREE.Mesh(bumpy(new THREE.CapsuleGeometry(1.4, h, 8, 20), .06, 2), pmat(0xffb08a, { roughness: .6, clearcoat: .3 })); m.position.y = h / 2; g.add(m);
        for (let i = 0; i < 40; i++) { const a = rand(0, Math.PI * 2), y = rand(0, h); const c = new THREE.Mesh(new THREE.SphereGeometry(.22, 6, 6), mat(0xffc9a0)); c.position.set(Math.cos(a) * 1.4, y, Math.sin(a) * 1.4); g.add(c); }
        const cap = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, .06, 60, 6, 2, 3), pmat(0xd94848)); cap.scale.y = h / 3; cap.position.y = h / 2; g.add(cap); return g; }, 21);
      scatter(e.group, 60, 17, () => { const m = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 1.2, 6), mat(0xffc9a0)); m.position.y = .6; return m; }, 3);
      floaters(e, 40, 30, () => new THREE.Mesh(new THREE.SphereGeometry(.15, 6, 6), mat(0xffe9c9)), .8);
      dust(e, 200, 30, 0xffe0c0, .1); light(e, 0xffb080, 30, V3(0, 8, 0));
      return e;
    },
    /* ---- 新增：肌肉组织 ---- */
    muscle() {
      const e = baseEnv(0x4a1c22, .02, 26); e.group.add(terrain(0x7a2a30, 60, .2));
      // 平行肌纤维铺成“地面” + 远处更粗的肌束
      const fm = pmat(0xd9575c, { roughness: .45, clearcoat: .5, sheen: .5, sheenColor: new THREE.Color(0xff9090) });
      for (let i = -12; i <= 12; i++) { const x = i * 3; const f = new THREE.Mesh(bumpy(new THREE.CapsuleGeometry(1.15, 70, 8, 20), .04, 2), fm); f.rotation.x = Math.PI / 2; f.position.set(x, -.9, 0); e.group.add(f);
        for (let k = -34; k <= 34; k += 1.1) { const r = new THREE.Mesh(new THREE.TorusGeometry(1.16, .04, 6, 24), mat(0x8a2a30, { transparent: true, opacity: .55 })); r.position.set(x, -.9, k + (i % 2) * .5); e.group.add(r); }
        for (let k = 0; k < 8; k++) { const n = new THREE.Mesh(new THREE.SphereGeometry(.28, 8, 8), mat(0x8a4bd6)); n.scale.set(.8, .6, 1.6); const a = rand(0, Math.PI); n.position.set(x + Math.cos(a) * 1.05, -.9 + Math.sin(a) * 1.05, rand(-34, 34)); e.group.add(n); } }
      // 远处肌束
      for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(bumpy(new THREE.CapsuleGeometry(rand(3, 5), 80, 8, 24), .3, .8), pmat(0xb03a40, { roughness: .6 })); b.rotation.x = Math.PI / 2; b.position.set(rand(-40, 40) + (i < 3 ? -30 : 30), rand(2, 14), 0); e.group.add(b); }
      // 毛细血管
      for (let i = 0; i < 10; i++) { const pts = []; let p = V3(rand(-30, 30), .6, -35); for (let k = 0; k < 8; k++) { pts.push(p.clone()); p = p.clone().add(V3(rand(-3, 3), rand(-.2, .3), 10)); } const t = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, .12, 6), pmat(0xff5050, { emissive: 0x500000, emissiveIntensity: .5 })); e.group.add(t); }
      // 运动神经元轴突
      const axPts = [V3(-34, 7, 34), V3(-18, 5, 16), V3(-11, 3, 4), V3(-10, 1.6, -10), V3(-13, 1.4, -22)]; const ax = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(axPts), 60, .2, 8), pmat(0x9fd8ff, { emissive: 0x2f9fff, emissiveIntensity: .5 })); e.group.add(ax);
      dust(e, 250, 32, 0xffb0b0, .1); light(e, 0xff8070, 40, V3(0, 8, 0));
      e.motorAxon = axPts;
      return e;
    },
    /* ---- 新增：伤口 ---- */
    wound() {
      const e = baseEnv(0x3a1a18, .02, 26); e.group.add(terrain(0x7a3a34, 60, .6, .25));
      scatter(e.group, 22, 30, () => { const m = cellBlob(0xc8a088, rand(1, 1.8)); m.scale.y = .6; m.position.y = .4; return m; });
      scatter(e.group, 16, 28, () => { const m = new THREE.Mesh(bumpy(new THREE.SphereGeometry(rand(.6, 1.2), 12, 12), .2, 4), pmat(0x9a7a70, { roughness: .8 })); m.position.y = .4; return m; }, 7); // 组织碎片
      for (let i = 0; i < 24; i++) { const pts = []; let p = V3(rand(-24, 24), rand(.5, 3), rand(-24, 24)); for (let k = 0; k < 6; k++) { pts.push(p.clone()); p = p.clone().add(V3(rand(-4, 4), rand(-1, 1.5), rand(-4, 4))); }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .07, 5), mat(0xfff5cc, { transparent: true, opacity: .75 })); e.group.add(tube); } // 纤维蛋白
      floaters(e, 30, 28, () => { const m = new THREE.Mesh(rbcDiscGeo, rbcMat); m.scale.setScalar(.6); return m; }, .7);
      floaters(e, 24, 26, () => new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, .12, 8), mat(0xffe3a3)), .8); // 血小板
      dust(e, 250, 30, 0xffc0a0, .1); light(e, 0xff8060, 40, V3(0, 8, 0));
      return e;
    },
    /* ---- 新增：骨髓干细胞龛 ---- */
    niche() {
      const e = baseEnv(0x2c1a2e, .02, 24); e.group.add(terrain(0x4a2a3a, 60, .3));
      // 骨内膜：一面弯曲的骨壁 + 成骨细胞
      const wall = new THREE.Mesh(bumpy(new THREE.CylinderGeometry(40, 40, 30, 64, 12, true, Math.PI * .8, Math.PI * .9), .4, .3), pmat(0xe9dcc4, { side: THREE.DoubleSide, roughness: .85 })); wall.position.set(0, 10, 0); e.group.add(wall);
      for (let i = 0; i < 40; i++) { const a = Math.PI * .8 + Math.PI * .9 * (i + .5) / 40; const ob = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 1.2), pmat(0xd8c0e8, { roughness: .6 })); ob.position.set(Math.sin(a) * 38.5, 1.2, Math.cos(a) * 38.5); ob.lookAt(0, 1.2, 0); e.group.add(ob); const n = new THREE.Mesh(new THREE.SphereGeometry(.4, 8, 8), mat(0x6a3aa8)); n.position.copy(ob.position); n.y += .2; e.group.add(n); }
      // 血窦
      const sinus = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 80, 32, 1, true), pmat(0xc25058, { transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false })); sinus.rotation.z = Math.PI / 2; sinus.position.set(0, 4, -22); e.group.add(sinus);
      bloodFlow(e, 30, 2.4, -60, 40, 4); e.group.children[e.group.children.length - 1].position.set(0, 4, -22); e.group.children[e.group.children.length - 1].rotation.y = Math.PI / 2;
      // 基质细胞（CAR 细胞）：伸出触角
      scatter(e.group, 12, 22, () => { const g = new THREE.Group(); const c = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.9, 14, 14), .06, 3), pmat(0xf0c8ff, { transparent: true, opacity: .75 })); g.add(c); for (let i = 0; i < 6; i++) { const d = V3(rand(-1, 1), rand(-.2, .5), rand(-1, 1)).normalize(); const a = new THREE.Mesh(new THREE.CylinderGeometry(.03, .12, rand(2, 4), 5), mat(0xf0c8ff, { transparent: true, opacity: .7 })); a.position.copy(d).multiplyScalar(1.5); a.quaternion.setFromUnitVectors(V3(0, 1, 0), d); g.add(a); } g.position.y = 1; return g; }, 7);
      scatter(e.group, 8, 24, () => { const m = new THREE.Mesh(bumpy(new THREE.SphereGeometry(rand(1.2, 1.9), 18, 18), .06, 3), pmat(0xffe08a, { roughness: .5, clearcoat: .6 })); m.position.y = 1.2; return m; }, 12);
      floaters(e, 40, 26, () => new THREE.Mesh(new THREE.OctahedronGeometry(.18), mat(0x9fd8ff, { emissive: 0x6ee7ff, emissiveIntensity: 1.2 })), 1); // CXCL12 / SCF 信号
      dust(e, 250, 28, 0xd0b0ff, .1); light(e, 0xa0c0ff, 40, V3(0, 8, 0));
      return e;
    }
  };
  return { ENV };
};
