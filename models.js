// ============================================================
//  细胞模型 · 物品模型 · 动画
//  由 index.html 注入上下文 CTX 后调用：window.CellModels(CTX)
//  X = gfx.js 提供的材质 / 纹理 / 几何工具
// ============================================================
window.CellModels = function (CTX) {
  const { THREE, G, scene, rand, clamp, lerp, ease, mat, pmat, bumpy, burst, X } = CTX;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const UP = V3(0, 1, 0);
  const GC = {}; const cached = (k, f) => GC[k] || (GC[k] = f());
  const sphereGeo = (w = 12, h = 10) => cached('sph' + w + '_' + h, () => new THREE.SphereGeometry(1, w, h));
  const rimP = (color, o = {}, r = {}) => X.rimify(pmat(color, o), { rimAlpha: 0, rimStr: .35, rim: new THREE.Color(color).lerp(new THREE.Color(0xffffff), .5).getHex(), ...r });

  /* ================================================================
     细胞器库
     ================================================================ */
  // 细胞核：核膜 + 核孔复合体 + 异染色质 + 常染色质丝 + 核仁
  function makeNucleus(r, color = 0x8a4bd6, opt = {}, cfg = {}) {
    const g = new THREE.Group(), c = new THREE.Color(color), seed = rand(0, 9);
    const env = new THREE.Mesh(bumpy(new THREE.SphereGeometry(r, 48, 36), r * .03, 1.8 / r, seed), X.cellMat(color, { opacity: .4, emissive: color, emissiveIntensity: .22, nrm: 'chromatin', nrep: 3, nscale: .6, rimAlpha: .5, ...opt }));
    // 核孔复合体（8 重对称的环 + 中央栓）
    const poreGeo = cached('pore', () => X.merge([new THREE.TorusGeometry(1, .38, 6, 8), new THREE.CylinderGeometry(.35, .35, .5, 8).rotateX(Math.PI / 2)]));
    const nP = Math.round(clamp(r * r * 140, 30, 170));
    const pores = X.inst(poreGeo, mat(c.clone().lerp(new THREE.Color(0xffffff), .5), { emissive: color, emissiveIntensity: .35, roughness: .4 }), nP, (i, d) => { const dir = X.fib(i, nP); d.position.copy(dir).multiplyScalar(r * 1.015); d.lookAt(dir.clone().multiplyScalar(r * 3)); d.scale.setScalar(r * .05); });
    // 异染色质：贴在核膜内侧的暗斑
    const dark = c.clone().multiplyScalar(cfg.dense ? .3 : .45);
    const hetero = X.inst(cached('blob', () => bumpy(new THREE.SphereGeometry(1, 12, 10), .18, 1.4)), mat(dark, { roughness: .7, normalMap: X.normalTex('chromatin'), emissive: dark, emissiveIntensity: .25 }), cfg.dense ? 40 : 24,
      (i, d) => { const dir = X.randDir(); d.position.copy(dir).multiplyScalar(r * rand(.7, .85)); d.lookAt(dir.clone().multiplyScalar(r * 3)); const s = cfg.dense ? 1.4 : 1; d.scale.set(r * rand(.16, .3) * s, r * rand(.12, .24) * s, r * .08 * s); });
    // 常染色质丝
    const thr = []; for (let i = 0; i < 5; i++) { const pts = X.walk(X.randDir().multiplyScalar(r * .35), X.randDir(), r * 1.6, 10, 1.3); pts.forEach(p => p.clampLength(0, r * .78)); thr.push(X.taperTube(pts, () => r * .028, 60, 5)); }
    const threads = new THREE.Mesh(X.merge(thr), mat(c.clone().lerp(new THREE.Color(0xffffff), .3), { emissive: color, emissiveIntensity: .35 }));
    // 核仁（颗粒状）
    const nr = r * (cfg.nucleolus ?? .32);
    const nucleolus = new THREE.Mesh(bumpy(new THREE.SphereGeometry(nr, 28, 20), nr * .16, 5 / nr, seed + 2), pmat(c.clone().multiplyScalar(.32), { roughness: .8, clearcoat: .2, normalMap: X.normalTex('chromatin'), emissive: c.clone().multiplyScalar(.3), emissiveIntensity: .6 }));
    nucleolus.position.set(r * .22, r * .12, r * .1);
    g.add(hetero, threads, nucleolus, pores, env); g.userData.env = env; return g;
  }
  // 线粒体：半透明外膜 + 内嵴（交错的板层）
  function mitoMats(tint = 0xff9a5a) { return { outer: X.cellMat(tint, { opacity: .38, rim: 0xffd6b0, rimStr: .7, nrm: 'fine', nrep: 2, emissive: 0x5a1a00, emissiveIntensity: .3 }), cristae: mat(0xff7a30, { emissive: 0x8a2a00, emissiveIntensity: .45, roughness: .45 }) }; }
  function makeMito(len = .5, M) {
    M = M || mitoMats(); const L = Math.round(len * 20) / 20;
    const geos = cached('mito' + L, () => {
      const n = Math.max(3, Math.round(L / .075)), cr = [];
      for (let i = 0; i < n; i++) { const side = i % 2 ? 1 : -1; cr.push(X.bake(new THREE.CylinderGeometry(.1, .1, .016, 14), V3(side * .034, -L / 2 + (i + .5) * L / n, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(-.25, .25), 0, rand(-.2, .2))), V3(1, 1, rand(.75, 1)))); }
      return { outer: X.smoothNormals(new THREE.CapsuleGeometry(.15, L, 8, 18)), cristae: X.merge(cr) };
    });
    const g = new THREE.Group(); g.add(new THREE.Mesh(geos.cristae, M.cristae), new THREE.Mesh(geos.outer, M.outer)); return g;
  }
  // 粗面内质网：绕核的弯曲片层 + 核糖体
  function makeER(r, n = 5, color = 0x9fc0ff) {
    const g = new THREE.Group(), m = X.cellMat(color, { opacity: .5, side: THREE.DoubleSide, nrm: 'fine', nrep: 2, rimAlpha: .3, emissive: color, emissiveIntensity: .12 });
    const ribo = [], phi0 = rand(0, 6.28);
    for (let i = 0; i < n; i++) {
      const rr = r + i * .085, ps = phi0 + rand(-.4, .4), pl = rand(1.4, 2.4), ts = rand(.8, 1.3), tl = rand(.5, .9);
      g.add(new THREE.Mesh(bumpy(new THREE.SphereGeometry(rr, 28, 10, ps, pl, ts, tl), .015, 3), m));
      for (let k = 0; k < 36; k++) { const p = rand(ps, ps + pl), t = rand(ts, ts + tl), q = rr * (1 + (k % 2 ? .03 : -.03)); ribo.push(V3(-q * Math.cos(p) * Math.sin(t), q * Math.cos(t), q * Math.sin(p) * Math.sin(t))); }
    }
    g.add(X.inst(cached('ribo', () => new THREE.IcosahedronGeometry(1, 1)), mat(0x5a6ad0, { emissive: 0x2a3080, emissiveIntensity: .6 }), ribo.length, (i, d) => { d.position.copy(ribo[i]); d.scale.setScalar(.022); }));
    return g;
  }
  // 高尔基体：弯曲的扁平囊堆叠 + 膨大边缘 + 出芽小泡
  function makeGolgi(s = 1, color = 0xffd27a) {
    const g = new THREE.Group();
    const geo = cached('golgi', () => { const parts = []; for (let i = 0; i < 5; i++) { const R = .5 - i * .035, th = .62 - i * .04, y = -R + i * .065;
      parts.push(X.bake(new THREE.SphereGeometry(R, 28, 5, 0, Math.PI * 2, 0, th), V3(0, i * .065 - R + R, 0).setY(y)));
      parts.push(X.bake(new THREE.TorusGeometry(R * Math.sin(th), .026, 6, 32), V3(0, y + R * Math.cos(th), 0), X.qFrom(V3(0, 0, 1), UP))); } return X.merge(parts); });
    g.add(new THREE.Mesh(geo, pmat(color, { side: THREE.DoubleSide, emissive: 0x6a4000, emissiveIntensity: .35, roughness: .35 })));
    g.add(X.inst(sphereGeo(10, 8), pmat(color, { emissive: 0x6a4000, emissiveIntensity: .45 }), 14, (i, d) => { const a = rand(0, 6.28), rr = rand(.3, .46); d.position.set(Math.cos(a) * rr, rand(-.05, .4), Math.sin(a) * rr); d.scale.setScalar(rand(.03, .055)); }));
    g.scale.setScalar(s); return g;
  }
  // 中心体：两个互相垂直的中心粒（9 组三联微管）+ 周围物质辉光
  function makeCentrosome(s = 1) {
    const geo = cached('centriole', () => { const parts = []; for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; for (let j = 0; j < 3; j++) { const rr = .058 + j * .016, an = a + j * .2; parts.push(X.bake(new THREE.CylinderGeometry(.009, .009, .22, 5), V3(Math.cos(an) * rr, 0, Math.sin(an) * rr))); } } return X.merge(parts); });
    const g = new THREE.Group(), m = X.glowMat(0xeaffff, .9);
    const c1 = new THREE.Mesh(geo, m), c2 = new THREE.Mesh(geo, m); c2.rotation.x = Math.PI / 2; c2.position.set(.1, 0, .06);
    g.add(c1, c2, X.glowSprite(0xbfefff, .8, .35)); g.scale.setScalar(s); return g;
  }
  // 细胞质中的小颗粒（游离核糖体 / 糖原）
  function cytoDots(n, r0, r1, color, size = .03, emissive = .5) {
    return X.inst(cached('ribo', () => new THREE.IcosahedronGeometry(1, 1)), mat(color, { emissive: color, emissiveIntensity: emissive }), n, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(r0, r1)); d.scale.setScalar(size * rand(.7, 1.2)); });
  }
  function scatterMitos(group, n, rmin, rmax, lens = [.25, .4], M) { M = M || mitoMats(); const out = []; for (let i = 0; i < n; i++) { const m = makeMito(rand(...lens), M); m.position.copy(X.randDir()).multiplyScalar(rand(rmin, rmax)); m.rotation.set(rand(0, 3), rand(0, 3), 0); group.add(m); out.push(m); } return out; }

  // 有丝分裂零件（上皮细胞 / 干细胞共用）
  function addMitosisParts(inner, parts, bodyColor) {
    const chromos = new THREE.Group(); chromos.visible = false; parts.chromos = chromos;
    const cols = [0xff5f7e, 0x6ee7ff, 0xffe36e, 0xa78bfa, 0x8dff6b, 0xff9b5f];
    // 染色单体：中部着丝粒缢缩的弯曲棒
    const chromGeo = cached('chromatid', () => { const pts = [V3(0, -.21, 0), V3(.02, -.11, .01), V3(0, -.01, 0), V3(.02, .11, -.01), V3(-.01, .21, 0)]; const rf = t => .056 * (.8 + .2 * Math.sin(t * Math.PI)) * (1 - .38 * Math.exp(-((t - .48) ** 2) / .004));
      return X.merge([X.taperTube(pts, rf, 40, 10), X.bake(new THREE.SphereGeometry(.046, 10, 8), pts[0]), X.bake(new THREE.SphereGeometry(.046, 10, 8), pts[4])]); });
    const kineGeo = cached('kine', () => new THREE.SphereGeometry(.03, 10, 8));
    for (let i = 0; i < 6; i++) {
      const pair = new THREE.Group(), cm = pmat(cols[i], { emissive: cols[i], emissiveIntensity: .35, normalMap: X.normalTex('chromatin'), roughness: .5 });
      for (let j = 0; j < 2; j++) { const s = new THREE.Mesh(chromGeo, cm); s.position.x = (j ? 1 : -1) * .045; s.rotation.z = (j ? -1 : 1) * .1; const k = new THREE.Mesh(kineGeo, X.glowMat(0xffffff, .9)); k.position.set((j ? 1 : -1) * .045, -.01, 0); s.add(k); pair.add(s); }
      pair.position.set(rand(-.5, .5), rand(-.5, .5), rand(-.5, .5)); pair.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); pair.scale.setScalar(.001); chromos.add(pair);
    }
    parts.centrosomes = [0, 1].map(() => { const c = makeCentrosome(1.2); c.position.y = .9; return c; });
    // 纺锤体：两极到赤道板的微管 + 星体微管
    const sp = [];
    for (let i = 0; i < 30; i++) { const a = i / 30 * Math.PI * 2, rr = rand(.08, .5), eq = V3(0, Math.cos(a) * rr * 1.8, Math.sin(a) * rr);
      for (const s of [-1, 1]) { const P0 = V3(s * 1.6, 0, 0), mid = P0.clone().lerp(eq, .5); mid.y *= 1.3; mid.z *= 1.3; const pts = new THREE.QuadraticBezierCurve3(P0, mid, eq).getPoints(10); for (let k = 0; k < 10; k++) sp.push(pts[k], pts[k + 1]); } }
    for (const s of [-1, 1]) for (let i = 0; i < 16; i++) { const d = X.randDir(); if (d.x * s < 0) d.x *= -1; sp.push(V3(s * 1.6, 0, 0), V3(s * 1.6, 0, 0).addScaledVector(d, rand(.3, .75))); }
    const spindle = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(sp), new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false })); spindle.visible = false; parts.spindle = spindle;
    // 收缩环（肌动蛋白-肌球蛋白）
    const pinch = new THREE.Mesh(new THREE.TorusGeometry(1.32, .055, 10, 72), X.glowMat(0xffb060, .8, { normalMap: X.rep(X.normalTex('fibrous'), 8, 1) })); pinch.rotation.y = Math.PI / 2; pinch.visible = false; parts.pinch = pinch;
    parts.daughterNuclei = [0, 1].map(() => { const n = makeNucleus(.5); n.visible = false; return n; });
    parts.daughters = [0, 1].map(() => { const d = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.3, 48, 36), .04, 1.6), X.cellMat(bodyColor, { opacity: .5, wobble: .02 })); d.scale.set(1.15, .85, 1.15); d.visible = false; return d; });
    inner.add(chromos, ...parts.centrosomes, spindle, pinch, ...parts.daughters, ...parts.daughterNuclei);
  }

  // 神经元：SDF 融合的胞体（树突根部 / 轴丘无缝过渡）+ 分支树突 + 树突棘
  function neuronParts(cfg) {
    const { somaR = .95, nDend = 5, reach = 1, seed = 1, spines = true } = cfg; const r = X.rng(seed);
    const roots = [V3(0, .35, -1).normalize()]; // 顶树突
    for (let i = 0; i < nDend - 1; i++) { const d = X.randDir(r); if (d.z > .2) d.z = -d.z; d.y = d.y * .5 - .15; roots.push(d.normalize()); }
    const hill = V3(0, -.12, 1).normalize();
    const sdf = p => { let d = X.SDF.sphere(p, V3(0, 0, 0), somaR); roots.forEach((dir, i) => { d = X.SDF.smin(d, X.SDF.roundCone(p, dir.clone().multiplyScalar(somaR * .5), dir.clone().multiplyScalar(somaR * 1.62), somaR * (i ? .3 : .38), somaR * (i ? .15 : .19)), .35); }); d = X.SDF.smin(d, X.SDF.roundCone(p, hill.clone().multiplyScalar(somaR * .5), hill.clone().multiplyScalar(somaR * 1.65), somaR * .3, somaR * .1), .3); return d; };
    const soma = bumpy(X.sdfShrink(sdf, somaR * 2.2, 72), .02, 2);
    const tubes = [], sp = [];
    const grow = (start, dir, len, r0, depth) => {
      const pts = X.walk(start, dir, len, 8, .45, r); const rf = t => lerp(r0, r0 * .45, t); tubes.push(X.taperTube(pts, rf, 36, 7));
      if (spines) { const cv = new THREE.CatmullRomCurve3(pts); for (let s = 0; s < len * 10; s++) { const t = .1 + r() * .9, p = cv.getPointAt(t), n = X.randDir(r); sp.push({ p: p.addScaledVector(n, rf(t) * .9), n }); } }
      const end = pts[pts.length - 1], d2 = end.clone().sub(pts[pts.length - 2]).normalize();
      if (depth > 0) for (let k = 0; k < 2; k++) grow(end, d2.clone().add(X.randDir(r).multiplyScalar(.85)).normalize(), len * .62, r0 * .45, depth - 1);
      else tubes.push(X.bake(new THREE.SphereGeometry(r0 * .45, 6, 5), end));
    };
    roots.forEach((dir, i) => grow(dir.clone().multiplyScalar(somaR * 1.5), dir, (i ? 1.7 : 2.3) * reach, somaR * (i ? .15 : .19), cfg.depth ?? 2));
    return { soma, dend: X.merge(tubes), spines: sp, hill, somaR };
  }
  function spineMesh(list, material) {
    const geo = cached('spine', () => X.merge([X.bake(new THREE.CylinderGeometry(.011, .014, .07, 5), V3(0, .035, 0)), X.bake(new THREE.SphereGeometry(.03, 8, 6), V3(0, .08, 0))]));
    return X.inst(geo, material, list.length, (i, d) => { d.position.copy(list[i].p); d.quaternion.copy(X.qFrom(UP, list[i].n)); d.scale.setScalar(rand(.8, 1.3)); });
  }
  // 蛋白质：α 螺旋与无规卷曲交替的肽链
  function proteinGeo(seed, size = .5) {
    return cached('prot' + seed, () => { const r = X.rng(seed), pts = []; let p = V3(-size * .3, 0, 0);
      for (let s = 0; s < 7; s++) { const d = X.randDir(r); if (p.length() > size * .55) d.copy(p).multiplyScalar(-1).normalize().add(X.randDir(r).multiplyScalar(.4)).normalize();
        const helix = s % 2 === 0, u = UP.clone().cross(d).normalize(), w = d.clone().cross(u), L = helix ? .34 : .22, n = helix ? 18 : 5;
        for (let k = 0; k < n; k++) { const t = k / n, a = t * Math.PI * 2 * 3.3, c = p.clone().addScaledVector(d, t * L); if (helix) c.addScaledVector(u, Math.cos(a) * .075).addScaledVector(w, Math.sin(a) * .075); else c.add(X.randDir(r).multiplyScalar(.04)); pts.push(c); }
        p = p.clone().addScaledVector(d, L); }
      return X.taperTube(pts, t => .045 * (1 - .4 * Math.abs(t - .5)), 320, 6).center(); });
  }

  /* ================================================================
     玩家细胞
     ================================================================ */
  function buildPlayer(id, stageIdx) {
    const group = new THREE.Group(); const parts = {}; const P = { group, parts, speed: 9, r: 1.3, locked: false, update: () => {} };
    const inner = new THREE.Group(); group.add(inner); inner.position.y = 1.2; P.inner = inner;

    /* ---------- 红细胞 ---------- */
    if (id === 'rbc') {
      const matured = stageIdx >= 2;
      // 晚幼红细胞：球形、有核、正在大量合成血红蛋白
      const sphere = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.25, 64, 48), .03, 1.6), X.cellMat(0xe05a5a, { opacity: .4, rim: 0xffb4aa, emissive: 0x5a0808, emissiveIntensity: .35, wobble: .02 })); parts.sphere = sphere;
      const nucleus = makeNucleus(.58, 0x7a3cc8, {}, { dense: true, nucleolus: .2 }); nucleus.position.set(.15, 0, .1); parts.nucleus = nucleus;
      parts.organelles = scatterMitos(sphere, 5, .75, .95, [.2, .32]);
      const ribos = cytoDots(260, .7, 1.12, 0x7a2ab0, .032, .6); parts.organelles.push(ribos); sphere.add(ribos);
      const hb = cytoDots(120, .3, 1.1, 0xff4a4a, .045, .9); parts.organelles.push(hb); sphere.add(hb); // 血红蛋白
      sphere.add(nucleus);
      // 成熟红细胞：Evans–Fung 双凹圆盘
      const discMat = X.rimify(pmat(0xb02a2a, { roughness: .32, clearcoat: .9, clearcoatRoughness: .25, sheen: .7, sheenRoughness: .4, sheenColor: new THREE.Color(0xff7a7a), normalMap: X.rep(X.normalTex('fine', 3), 2), normalScale: new THREE.Vector2(.3, .3) }), { rim: 0xff8a8a, rimStr: .4, rimPow: 3, rimAlpha: 0 });
      const disc = new THREE.Group(); const dm = new THREE.Mesh(X.rbcGeo(), discMat); dm.scale.setScalar(1.48); disc.add(dm); disc.rotation.x = .5; parts.disc = disc; P.discMat = discMat;
      inner.add(sphere, disc);
      if (matured) { sphere.visible = false; disc.visible = true; } else { disc.visible = false; disc.scale.setScalar(.001); }
      P.setOxy = f => { discMat.color.lerpColors(new THREE.Color(0x6a1622), new THREE.Color(0xff3b3b), f); discMat.sheenColor.lerpColors(new THREE.Color(0x9a4a6a), new THREE.Color(0xff8a7a), f); };
      if (stageIdx === 3) P.setOxy(1);
      P.update = (t, dt) => { disc.rotation.y += dt * .8; disc.rotation.x = .5 + Math.sin(t * 1.3) * .15; sphere.rotation.y += dt * .5; };
    }

    /* ---------- 中性粒细胞 ---------- */
    else if (id === 'neutrophil') {
      // 表面褶皱的细胞膜
      const memb = new THREE.Mesh(X.starGeo(72, d => 1.35 + .07 * X.fbm(d.x * 2.2, d.y * 2.2, d.z * 2.2, 3) + .05 * X.ridged(d.x * 7, d.y * 7, d.z * 7)), X.cellMat(0xd8ccff, { opacity: .32, rim: 0xf2eaff, wobble: .035, nrep: 6 })); parts.membrane = memb;
      // 分叶核：3~4 叶，由细染色质丝相连
      const lobeC = [[-1.15, .05], [-.4, .2], [.35, -.05], [1.1, .1]].map(([a, y]) => V3(Math.sin(a) * .55, y, Math.cos(a) * .55 - .15));
      const lg = []; lobeC.forEach((c, i) => { lg.push(X.bake(bumpy(new THREE.SphereGeometry(.36, 28, 20), .035, 3.5, i), c, new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), 0)), V3(1.15, .88, .95)));
        if (i) lg.push(X.taperTube([lobeC[i - 1], lobeC[i - 1].clone().lerp(c, .5).add(V3(0, .08, 0)), c], t => .05 + .07 * Math.abs(t - .5) * 2, 16, 8)); });
      const nuc = new THREE.Mesh(X.merge(lg), rimP(0x6a3cc8, { emissive: 0x3a1a8a, emissiveIntensity: .55, normalMap: X.normalTex('chromatin'), roughness: .55 }, { rim: 0xc8b0ff, rimStr: .6 })); parts.nucleus = nuc;
      // 三类颗粒：嗜天青（初级）、特异（次级）、明胶酶（三级）
      const gr = new THREE.Group();
      gr.add(X.inst(sphereGeo(10, 8), mat(0xffffff, { emissive: 0x3a1a5a, emissiveIntensity: .5, roughness: .35 }), 150, (i, d) => { const k = Math.random(); d.position.copy(X.randDir()).multiplyScalar(rand(.62, 1.2)); d.scale.setScalar(k < .3 ? rand(.06, .08) : k < .8 ? rand(.04, .055) : .035); return k < .3 ? 0xb070ff : k < .8 ? 0xffc4ea : 0xfff2ff; }));
      scatterMitos(gr, 3, .8, 1, [.2, .26]); const gol = makeGolgi(.6, 0xffc9e6); gol.position.set(0, -.1, .45); gr.add(gol);
      const cs = makeCentrosome(.9); cs.position.set(0, .1, .25); gr.add(cs);
      inner.add(nuc, gr, memb);
      P.update = (t, dt) => { nuc.rotation.y += dt * .5; gr.rotation.y -= dt * .3; memb.scale.set(1 + Math.sin(t * 2) * .05, 1 + Math.cos(t * 2.3) * .05, 1 + Math.sin(t * 1.7) * .04); };
    }

    /* ---------- 神经元（锥体细胞） ---------- */
    else if (id === 'neuron') {
      const N = neuronParts({ somaR: .95, nDend: 6, seed: 7 });
      const somaMat = X.cellMat(0x5aa9ff, { opacity: .82, emissive: 0x123a88, emissiveIntensity: .5, rim: 0xb0e0ff, rimStr: .8, nrep: 5 });
      const soma = new THREE.Mesh(N.soma, somaMat); parts.soma = soma;
      const dMat = rimP(0x6fb0ff, { emissive: 0x123a88, emissiveIntensity: .5, normalMap: X.rep(X.normalTex('membrane'), 2, 8), normalScale: new THREE.Vector2(.4, .4), roughness: .35 }, { rim: 0xb0e0ff, rimStr: .6 });
      const dend = new THREE.Group(); dend.add(new THREE.Mesh(N.dend, dMat), spineMesh(N.spines, dMat)); parts.dendrites = dend;
      // 内部：大核 + 显著核仁 + 尼氏体 + 线粒体
      const nuc = makeNucleus(.5, 0x2b3f9e, {}, { nucleolus: .38 });
      const nissl = X.inst(cached('blob', () => bumpy(new THREE.SphereGeometry(1, 12, 10), .18, 1.4)), mat(0x2a3a9a, { emissive: 0x1a2a7a, emissiveIntensity: .5 }), 26, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(.58, .82)); d.lookAt(0, 0, 0); d.scale.set(rand(.1, .16), rand(.08, .12), .03); });
      soma.add(nuc, nissl); scatterMitos(soma, 5, .55, .8, [.18, .26]);
      // 轴突：前方的轴突起始段；生长期带生长锥，成熟期有髓鞘
      const hillEnd = N.hill.clone().multiplyScalar(N.somaR * 1.6), axPts = X.walk(hillEnd, N.hill, 1.4, 5, .15);
      const axon = new THREE.Group(); axon.add(new THREE.Mesh(X.taperTube(axPts, t => lerp(.1, .075, t), 30, 8), dMat)); parts.hillock = axon;
      const tip = axPts[axPts.length - 1];
      if (stageIdx < 3) { // 生长锥：扁平掌状 + 丝状伪足
        const gm = X.glowMat(0x8fe0ff, .9), cone = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.25, 20, 14), .03, 5), gm); cone.scale.set(1.2, .35, 1); cone.position.copy(tip); axon.add(cone);
        const fil = []; for (let i = 0; i < 7; i++) { const d = V3(rand(-.9, .9), rand(-.2, .2), 1).normalize(); fil.push(X.taperTube(X.walk(tip, d, rand(.45, .8), 4, .4), t => lerp(.028, .008, t), 12, 5)); }
        axon.add(new THREE.Mesh(X.merge(fil), gm));
      } else { const my = pmat(0xfff1c9, { roughness: .3, clearcoat: .8, emissive: 0x403010, emissiveIntensity: .3 }); [.35, .8].forEach(t => { const cv = new THREE.CatmullRomCurve3(axPts); const s = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .28, 6, 16), my); s.position.copy(cv.getPointAt(t)); s.quaternion.copy(X.qFrom(UP, cv.getTangentAt(t))); axon.add(s); }); }
      inner.add(soma, dend, axon);
      P.update = (t, dt) => { somaMat.emissiveIntensity = .4 + Math.sin(t * 3) * .2; dMat.emissiveIntensity = .4 + Math.sin(t * 3 - .6) * .2; };
    }

    /* ---------- 上皮细胞（小肠吸收细胞） ---------- */
    else if (id === 'epithelial') {
      const round = stageIdx === 2; // 分裂期细胞变圆
      const bodyMat = X.cellMat(0xffb347, { opacity: .45, rim: 0xffe2b8, nrep: 5 });
      const org = new THREE.Group(); parts.organelles = org;
      const villi = new THREE.Group(); parts.villi = villi;
      const mvGeo = cached('microvillus', () => X.merge([X.bake(new THREE.CylinderGeometry(.026, .03, .3, 6), V3(0, .15, 0)), X.bake(new THREE.SphereGeometry(.026, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), V3(0, .3, 0))]));
      const mvMat = pmat(0xffd9a0, { emissive: 0x7a4000, emissiveIntensity: .35, roughness: .4 });
      let body, nucleus;
      if (!round) {
        // 圆角六棱柱：柱状上皮
        const HR = .95, HH = 1.2, RR = .22;
        const hex = (px, py, pz, hr, hh) => { let x = Math.abs(px), y = Math.abs(pz); const z = Math.abs(py), kx = -.8660254, ky = .5, kz = .57735; const dd = 2 * Math.min(kx * x + ky * y, 0); x -= dd * kx; y -= dd * ky; const cx = clamp(x, -kz * hr, kz * hr); const dx = Math.hypot(x - cx, y - hr) * Math.sign(y - hr), dy = z - hh; return Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)); };
        body = new THREE.Mesh(X.sdfShrink(p => hex(p.x, p.y, p.z, HR - RR, HH - RR) - RR, 2.2, 80), bodyMat);
        // 刷状缘：密集微绒毛
        const pts = []; for (let x = -1; x <= 1; x += .072) for (let z = -1; z <= 1; z += .0624) { const px = x + (Math.round(z / .0624) % 2 ? .036 : 0) + rand(-.01, .01), pz = z + rand(-.01, .01); if ([30, 90, 150].every(a => Math.abs(px * Math.cos(a * Math.PI / 180) + pz * Math.sin(a * Math.PI / 180)) < HR - .12)) pts.push([px, pz]); }
        villi.add(X.inst(mvGeo, mvMat, pts.length, (i, d) => { d.position.set(pts[i][0], HH - .02, pts[i][1]); d.rotation.set(rand(-.06, .06), 0, rand(-.06, .06)); d.scale.y = rand(.85, 1.15); }));
        // 紧密连接带（顶端的六边形环）
        const tj = new THREE.Mesh(new THREE.TorusGeometry((HR + .01) / .866, .03, 6, 6), X.glowMat(0xffe9a0, 1)); tj.rotation.x = -Math.PI / 2; tj.position.y = HH - .3; villi.add(tj);
        nucleus = makeNucleus(.46, 0x8a4bd6); nucleus.scale.set(1, 1.45, 1); nucleus.position.y = -.42;
        const M = mitoMats(); for (let i = 0; i < 9; i++) { const m = makeMito(rand(.3, .45), M); const a = rand(0, 6.28); m.position.set(Math.cos(a) * rand(.45, .7), rand(-.9, .7), Math.sin(a) * rand(.45, .7)); m.rotation.set(rand(-.2, .2), rand(0, 3), rand(-.2, .2)); org.add(m); }
        const gol = makeGolgi(.8); gol.position.set(0, .45, 0); org.add(gol);
        const er = makeER(.5, 4); er.scale.set(1, 1.6, 1); er.position.y = -.3; org.add(er);
        org.add(X.inst(sphereGeo(10, 8), X.cellMat(0xfff0c0, { opacity: .6, nrm: null }), 22, (i, d) => { d.position.set(rand(-.55, .55), rand(.6, 1), rand(-.55, .55)); d.scale.setScalar(rand(.05, .09)); })); // 吸收小泡
        const tw = X.inst(sphereGeo(6, 4), mat(0xffc070, { emissive: 0x8a4a00, emissiveIntensity: .5 }), 200, (i, d) => { d.position.set(rand(-.7, .7), rand(.95, 1.08), rand(-.7, .7)); d.scale.setScalar(.018); }); org.add(tw); // 终末网
      } else {
        body = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.3, 64, 48), .04, 1.6), bodyMat); body.scale.set(1.15, .85, 1.15);
        nucleus = makeNucleus(.6);
        villi.add(X.inst(mvGeo, mvMat, 70, (i, d) => { const a = rand(0, 6.28), rr = Math.sqrt(Math.random()) * 1.05; const y = Math.sqrt(Math.max(0, 1 - (rr / 1.5) ** 2)) * 1.08; d.position.set(Math.cos(a) * rr * 1.1, y - .04, Math.sin(a) * rr * 1.1); d.lookAt(d.position.clone().multiplyScalar(3)); d.rotateX(Math.PI / 2); d.scale.setScalar(.55); }));
        scatterMitos(org, 7, .85, 1.1, [.25, .38]); const gol = makeGolgi(.7); gol.position.set(-.85, .15, .45); org.add(gol); // 分裂期内质网已分散，不再绘制
      }
      body.userData.op0 = .45; parts.body = body; parts.nucleus = nucleus;
      addMitosisParts(inner, parts, 0xffb347);
      inner.add(body, nucleus, org, villi);
      P.update = (t, dt) => { if (round) { nucleus.rotation.y += dt * .3; org.rotation.y += dt * .1; } };
    }

    /* ---------- 肌细胞（骨骼肌纤维） ---------- */
    else if (id === 'muscle') {
      const L = 4.2, SARC = 4;
      const fiberMat = X.cellMat(0xd9575c, { opacity: .5, rim: 0xffb0b0, nrm: 'fine', nrep: 2, nscale: .3, sheen: .6, sheenColor: new THREE.Color(0xff9090) });
      const fiber = new THREE.Mesh(X.axisUV(bumpy(new THREE.CapsuleGeometry(.85, L, 16, 56), .02, 2)), fiberMat); fiber.rotation.z = Math.PI / 2; parts.fiber = fiber;
      const fiberG = new THREE.Group(); fiberG.add(fiber); parts.fiberG = fiberG;
      // 横纹：半透明套层，暗带（A 带 / Z 线）不透明
      const stri = new THREE.Mesh(X.axisUV(new THREE.CapsuleGeometry(.868, L, 16, 56)), mat(0x5a1018, { alphaMap: X.rep(X.colorTex('stripesA'), 1, SARC), transparent: true, depthWrite: false, opacity: .85, roughness: .5 })); stri.rotation.z = Math.PI / 2; parts.striations = stri; fiberG.add(stri);
      // 边缘扁平的多个细胞核
      parts.nuclei = []; const nm = rimP(0x8a4bd6, { emissive: 0x3a1a6a, emissiveIntensity: .45, normalMap: X.normalTex('chromatin') });
      for (let i = 0; i < 6; i++) { const n = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.28, 20, 14), .02, 4, i), nm); const a = rand(0, Math.PI * 2); n.scale.set(1.7, .45, .8); n.rotation.x = Math.PI / 2 - a; n.position.set(-1.9 + i * .78, Math.sin(a) * .74, Math.cos(a) * .74); parts.nuclei.push(n); fiberG.add(n); }
      // 肌节（QTE 里逐步出现）：Z 盘 · 粗肌丝（肌球蛋白头）· 细肌丝（肌动蛋白双螺旋）
      const sarc = new THREE.Group(); parts.sarcomere = sarc; parts.zdiscs = []; parts.thick = []; parts.thin = [];
      const thickGeo = cached('thick', () => { const ps = [new THREE.CylinderGeometry(.028, .028, .42, 6)]; for (let k = 0; k < 18; k++) { const y = (k < 9 ? -.2 : .04) + (k % 9) * .018, a = k * 2.1; ps.push(X.bake(new THREE.SphereGeometry(.02, 6, 4), V3(Math.cos(a) * .042, y, Math.sin(a) * .042))); } return X.merge(ps); });
      const thinGeo = cached('thin', () => { const ps = []; for (let k = 0; k < 14; k++) for (const o of [0, Math.PI]) { const a = k * .7 + o; ps.push(X.bake(new THREE.SphereGeometry(.013, 6, 4), V3(Math.cos(a) * .014, -.17 + k * .026, Math.sin(a) * .014))); } return X.merge(ps); });
      const zm = X.glowMat(0x7a1a38, .6, { normalMap: X.rep(X.normalTex('cells'), 3) }), thm = mat(0x6a2a78, { emissive: 0x4a1058, emissiveIntensity: .55 }), tnm = mat(0xffd8d8, { emissive: 0xffa0a0, emissiveIntensity: .4 });
      for (let i = 0; i < 6; i++) { const z = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .035, 36), zm); z.rotation.z = Math.PI / 2; z.position.x = -1.75 + i * .7; z.scale.setScalar(.001); parts.zdiscs.push(z); sarc.add(z); }
      for (let s = 0; s < 5; s++) for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2;
        const th = new THREE.Mesh(thickGeo, thm); th.rotation.z = Math.PI / 2; th.position.set(-1.4 + s * .7, Math.sin(a) * .35, Math.cos(a) * .35); th.scale.setScalar(.001); parts.thick.push(th); sarc.add(th);
        for (const side of [-1, 1]) { const tn = new THREE.Mesh(thinGeo, tnm); tn.rotation.z = Math.PI / 2; tn.position.set(-1.4 + s * .7 + side * .3, Math.sin(a + .5) * .38, Math.cos(a + .5) * .38); tn.scale.setScalar(.001); parts.thin.push(tn); sarc.add(tn); } }
      fiberG.add(sarc);
      // 肌原纤维：带横纹贴图的细柱束
      const myof = new THREE.Group(); parts.myofibrils = myof; const mfm = mat(0xffffff, { map: X.rep(X.colorTex('stripes'), 1, SARC), roughness: .45, emissive: 0x401010, emissiveIntensity: .3 });
      for (let i = 0; i < 13; i++) { const ring = i < 4 ? .22 : .5, a = (i < 4 ? i / 4 : (i - 4) / 9) * Math.PI * 2 + (i < 4 ? .4 : 0); const c = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 4.5, 12), mfm); c.rotation.z = Math.PI / 2; c.position.set(0, Math.sin(a) * ring, Math.cos(a) * ring); myof.add(c); }
      const M = mitoMats(); for (let i = 0; i < 8; i++) { const m = makeMito(rand(.25, .35), M); m.rotation.z = Math.PI / 2; const a = rand(0, 6.28); m.position.set(rand(-1.8, 1.8), Math.sin(a) * .66, Math.cos(a) * .66); myof.add(m); }
      fiberG.add(myof);
      inner.add(fiberG);
      // 阶段 0：成肌细胞（很小），随融合长大
      P.r = 1.6; P.growth = stageIdx === 0 ? 0 : 1;
      P.setGrowth = f => { P.growth = f; fiberG.scale.set(.32 + f * .68, .55 + f * .45, .55 + f * .45); parts.nuclei.forEach((n, i) => n.visible = i < 1 + Math.floor(f * 5.99)); stri.visible = f > .5; myof.visible = f > .5; };
      P.setGrowth(P.growth);
      if (stageIdx >= 2) parts.zdiscs.concat(parts.thick, parts.thin).forEach(o => o.scale.setScalar(1));
      if (stageIdx < 2) { myof.visible = false; stri.visible = false; } // 肌节组装完成、第一次收缩后才出现横纹
      P.contractT = 0; P.contract = () => { P.contractT = 1; };
      P.update = (t, dt) => { P.contractT = Math.max(0, P.contractT - dt * 1.6); const c = Math.sin(P.contractT * Math.PI); const s = fiberG.scale; const gx = .32 + P.growth * .68, gy = .55 + P.growth * .45; s.set(gx * (1 - c * .22), gy * (1 + c * .28), gy * (1 + c * .28)); fiberMat.emissive.setHex(0x661010); fiberMat.emissiveIntensity = c * .8; };
      P.onCollect = f => P.setGrowth(f);
    }

    /* ---------- 巨噬细胞 ---------- */
    else if (id === 'macrophage') {
      const big = stageIdx >= 2;
      const membMat = X.cellMat(0xa8d4ff, { opacity: .4, rim: 0xd8f0ff, nrep: 3, nscale: .35 });
      // 伪足：每帧重算的星形体，伪足随相位伸缩；表面带褶皱
      const pods = new THREE.Group(); parts.pods = pods;
      const podDirs = []; for (let i = 0; i < 8; i++) podDirs.push({ d: V3(rand(-1, 1), rand(-.3, .35), rand(-1, 1)).normalize(), ph: rand(0, 6), w: rand(12, 26), a: rand(.7, 1.1) });
      const membGeo = X.starGeo(64, () => 1.5), base = [];
      const liveUpd = X.liveStar(membGeo, (d, t, i) => { if (base[i] === undefined) base[i] = 1.38 + .12 * X.fbm(d.x * 2.4, d.y * 2.4, d.z * 2.4, 3) + .11 * Math.pow(X.ridged(d.x * 5, d.y * 5, d.z * 5), 3);
        let r = base[i]; const amp = pods.scale.x; for (const p of podDirs) { const c = d.dot(p.d); if (c > 0) r += Math.pow(c, p.w) * p.a * amp * (.75 + .35 * Math.sin(t * 1.5 + p.ph)); } return r; });
      const memb = new THREE.Mesh(membGeo, membMat); parts.membrane = memb; liveUpd(0);
      // 丝状伪足
      const fm = X.cellMat(0xcfeaff, { opacity: .6, nrm: null });
      for (let i = 0; i < 14; i++) { const dir = X.randDir(); dir.y *= .5; dir.normalize(); const f = new THREE.Mesh(cached('filo', () => X.bake(new THREE.CylinderGeometry(.008, .03, .8, 5), V3(0, .4, 0))), fm); f.userData.dir = dir; f.userData.ph = rand(0, 6); f.quaternion.copy(X.qFrom(UP, dir)); pods.add(f); }
      // 肾形核
      const nsdf = p => Math.max(X.SDF.smin(X.SDF.sphere(p, V3(-.25, .05, 0), .5), X.SDF.sphere(p, V3(.3, .1, .05), .45), .35), -X.SDF.sphere(p, V3(.02, .05, .6), .36));
      const nuc = new THREE.Mesh(bumpy(X.sdfShrink(nsdf, 1.3, 56, V3(0, .05, -.1)), .015, 4), rimP(0x5a3d99, { emissive: 0x2a1a5a, emissiveIntensity: .45, normalMap: X.normalTex('chromatin'), roughness: .6 }, { rim: 0xb09ae0 })); parts.nucleus = nuc;
      // 溶酶体（前 16 个子对象）+ 线粒体 + 空泡
      const lys = new THREE.Group(); parts.lysosomes = lys; const lm = pmat(0xc266ff, { emissive: 0x7a1cff, emissiveIntensity: .6, clearcoat: 1, roughness: .25 });
      for (let i = 0; i < 16; i++) { const l = new THREE.Mesh(cached('lys', () => bumpy(new THREE.SphereGeometry(1, 16, 12), .08, 2)), lm); l.scale.setScalar(rand(.1, .17)); l.position.copy(X.randDir()).multiplyScalar(rand(.6, 1.2)); lys.add(l); }
      scatterMitos(lys, 5, .9, 1.1, [.25, .35]);
      lys.add(X.inst(sphereGeo(14, 10), X.cellMat(0xe6f4ff, { opacity: .35, nrm: null }), 14, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(.7, 1.15)); d.scale.setScalar(rand(.1, .2)); }));
      const gol = makeGolgi(.7, 0xffd9a0); gol.position.set(.1, .1, .55); lys.add(gol);
      // 吞噬体（含细菌）用于抗原呈递动画
      const phago = new THREE.Group(); phago.visible = false; parts.phagosome = phago;
      const pv = new THREE.Mesh(sphereGeo(20, 16), X.cellMat(0xd0f0ff, { opacity: .3, nrm: null })); pv.scale.setScalar(.5);
      const bac = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .4, 6, 12), pmat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .5, normalMap: X.normalTex('fine') })); bac.rotation.z = 1; phago.add(pv, bac); phago.position.set(.7, -.3, .5); parts.phagoBac = bac; parts.phagoVes = pv;
      // MHC-II：α/β 两条链 + 槽里的抗原肽
      const mhc = new THREE.Group(); mhc.visible = false; parts.mhc = mhc;
      const chainGeo = cached('mhc', () => X.merge([-1, 1].flatMap(s => [X.bake(new THREE.CylinderGeometry(.022, .026, .3, 6), V3(s * .032, .15, 0)), X.bake(bumpy(new THREE.SphereGeometry(.055, 10, 8), .01, 20), V3(s * .038, .33, 0)), X.bake(bumpy(new THREE.SphereGeometry(.05, 10, 8), .01, 20), V3(s * .034, .23, .01))])));
      const chm = mat(0xffe36e, { emissive: 0xffc400, emissiveIntensity: .9 }), pepm = X.glowMat(0xff5f7e, 1.4);
      for (let i = 0; i < 14; i++) { const dir = V3(rand(-1, 1), rand(-.2, 1), rand(-1, 1)).normalize(); const y = new THREE.Group(); const pep = new THREE.Mesh(cached('pep', () => new THREE.CapsuleGeometry(.018, .09, 4, 8).rotateZ(Math.PI / 2)), pepm); pep.position.y = .4; y.add(new THREE.Mesh(chainGeo, chm), pep); y.position.copy(dir).multiplyScalar(1.5); y.quaternion.setFromUnitVectors(UP, dir); y.scale.setScalar(.001); mhc.add(y); }
      inner.add(nuc, lys, phago, memb, pods, mhc);
      P.r = big ? 1.7 : 1.3; if (!big) { memb.scale.setScalar(.8); pods.scale.setScalar(.6); }
      P.update = (t, dt) => { liveUpd(t); nuc.rotation.y += dt * .3; lys.rotation.y -= dt * .25; memb.rotation.y += dt * .1;
        pods.children.forEach(f => { const s = 1 + Math.sin(t * 1.5 + f.userData.ph) * .3; f.scale.set(1, s, 1); f.position.copy(f.userData.dir).multiplyScalar(1.38 * memb.scale.x / pods.scale.x); }); };
    }

    /* ---------- 造血干细胞 ---------- */
    else if (id === 'stem') {
      const bodyMat = X.cellMat(0xeaf6ff, { opacity: .4, emissive: 0x9fd8ff, emissiveIntensity: .25, rim: 0xc6f2ff, rimStr: .8, wobble: .015 });
      const body = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.15, 64, 48), .025, 1.6), bodyMat); body.userData.op0 = .4; parts.body = body;
      // 高核质比：大核、细染色质
      const nucleus = makeNucleus(.8, 0x7c5cff, { emissiveIntensity: .45 }, { nucleolus: .26 }); parts.nucleus = nucleus;
      const org = new THREE.Group(); parts.organelles = org;
      scatterMitos(org, 4, .9, 1, [.18, .24]); org.add(cytoDots(160, .85, 1.1, 0x9fb0ff, .025, .8));
      const cs = makeCentrosome(1); cs.position.set(0, .2, .95); org.add(cs);
      org.add(X.inst(cached('mvs', () => X.bake(new THREE.CapsuleGeometry(.025, .16, 3, 6), V3(0, .08, 0))), X.cellMat(0xeaf6ff, { opacity: .7, nrm: null }), 40, (i, d) => { const dir = X.fib(i, 40); d.position.copy(dir).multiplyScalar(1.12); d.quaternion.copy(X.qFrom(UP, dir)); }));
      // 光环：象征“潜能”
      const makeHalo = () => { const h = new THREE.Group(); h.add(new THREE.Mesh(new THREE.TorusGeometry(1.5, .016, 8, 160), X.glowMat(0x9fd8ff, 1.8, { transparent: true, opacity: .8 })));
        h.add(X.inst(sphereGeo(8, 6), X.glowMat(0xd8ffff, 2.5), 30, (i, d) => { const a = i / 30 * Math.PI * 2 + rand(-.05, .05); d.position.set(Math.cos(a) * 1.5, Math.sin(a) * 1.5, rand(-.03, .03)); d.scale.setScalar(i % 5 ? .025 : .05); })); return h; };
      const halo = makeHalo(); halo.rotation.x = Math.PI / 2; parts.halo = halo;
      const halo2 = makeHalo(); halo2.rotation.x = Math.PI / 3; halo2.rotation.y = .5; parts.halo2 = halo2;
      addMitosisParts(inner, parts, 0xdff4ff);
      inner.add(body, nucleus, org, halo, halo2);
      P.update = (t, dt) => { halo.rotation.z += dt * .6; halo2.rotation.z -= dt * .4; bodyMat.emissiveIntensity = .2 + Math.sin(t * 2) * .12; nucleus.rotation.y += dt * .3; };
    }
    return P;
  }

  /* ================================================================
     物品（每次新建材质：setItemActive 会单独改动它们）
     ================================================================ */
  const atom = (pos, r, m) => { const a = new THREE.Mesh(sphereGeo(16, 12), m); a.position.copy(pos); a.scale.setScalar(r); return a; };
  const bondGeo = (a, b, r = .045) => { const L = a.distanceTo(b); return X.bake(new THREE.CylinderGeometry(r, r, L, 8), a.clone().lerp(b, .5), X.qFrom(UP, b.clone().sub(a).normalize())); };
  const ring = (n, r, cx = 0, cz = 0, a0 = 0) => [...Array(n)].map((_, i) => V3(cx + Math.cos(a0 + i / n * Math.PI * 2) * r, 0, cz + Math.sin(a0 + i / n * Math.PI * 2) * r));
  function spiky(color, emissive, jag = false) {
    const g = new THREE.Group(); const core = new THREE.Mesh(bumpy(new THREE.IcosahedronGeometry(.45, 3), .08, 3), pmat(color, { emissive, emissiveIntensity: 1, roughness: .3, normalMap: X.normalTex('fine') })); g.add(core);
    const sm = mat(color, { emissive, emissiveIntensity: .9 });
    const spikes = []; for (let i = 0; i < 16; i++) { const d = X.fib(i, 16); spikes.push(X.bake(new THREE.ConeGeometry(.07, jag ? rand(.4, .7) : .5, 6), d.clone().multiplyScalar(jag ? .6 : .62), X.qFrom(UP, d))); }
    g.add(new THREE.Mesh(X.merge(spikes), sm), X.glowSprite(emissive, 2.2, .45)); return g;
  }
  const ITEM_BUILDERS = {
    // 转铁蛋白携带的 Fe³⁺
    iron: () => { const g = new THREE.Group();
      const prot = new THREE.Mesh(cached('transferrin', () => X.merge([-1, 1].map((s, i) => X.bake(bumpy(new THREE.SphereGeometry(.34, 22, 16), .06, 5, i), V3(s * .25, 0, 0), null, V3(1, .85, .9))))), pmat(0xffb070, { emissive: 0xff5a1a, emissiveIntensity: .45, roughness: .5, normalMap: X.normalTex('fine') }));
      const fm = X.glowMat(0xff7a2a, 2.4); g.add(prot, atom(V3(-.25, .2, .24), .12, fm), atom(V3(.25, .2, .24), .12, fm), X.glowSprite(0xff7a30, 2.2, .5)); return g; },
    // O₂：双原子分子
    o2: () => { const g = new THREE.Group(); const m = pmat(0x8fe9ff, { emissive: 0x3fc8ff, emissiveIntensity: 1.1, clearcoat: 1, roughness: .12, transparent: true, opacity: .92 });
      g.add(atom(V3(-.24, 0, 0), .34, m), atom(V3(.24, 0, 0), .34, m), X.glowSprite(0x6fd8ff, 2, .45)); return g; },
    // 颗粒：膜包被的囊泡 + 致密核心
    granule: () => { const g = new THREE.Group(); const shell = new THREE.Mesh(sphereGeo(24, 18), X.cellMat(0xe6c8ff, { opacity: .45, emissive: 0x6a3cc0, emissiveIntensity: .5, nrm: 'membrane', nrep: 2 })); shell.scale.setScalar(.5);
      const core = new THREE.Mesh(cached('gcore', () => bumpy(new THREE.SphereGeometry(.28, 20, 16), .05, 5)), X.glowMat(0xb87aff, 1.2)); g.add(core, shell, X.glowSprite(0xb07aff, 1.6, .35)); return g; },
    // 趋化因子：一个小蛋白
    signal: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(proteinGeo(3, .55), pmat(0xffe36e, { emissive: 0xffb400, emissiveIntensity: 1.2, roughness: .35 })), X.glowSprite(0xffd040, 2.2, .45)); g.scale.setScalar(1.3); return g; },
    // 细菌：杆菌 + 鞭毛 + 菌毛
    bacteria: () => { const g = new THREE.Group();
      const body = new THREE.Mesh(cached('bac', () => bumpy(new THREE.CapsuleGeometry(.3, .8, 8, 20), .02, 5).rotateX(Math.PI / 2)), pmat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .55, clearcoat: .7, normalMap: X.rep(X.normalTex('fine'), 2), normalScale: new THREE.Vector2(.6, .6) }));
      const fl = cached('flag', () => X.merge([0, 1, 2].map(k => { const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40, a = t * Math.PI * 7 + k * 2.1; pts.push(V3(Math.cos(a) * .08 * t + (k - 1) * .12, Math.sin(a) * .08 * t + (k - 1) * .05, -.65 - t * 1.4)); } return X.taperTube(pts, () => .018, 80, 5); })));
      const pili = cached('pili', () => X.merge([...Array(26)].map((_, i) => { const d = X.fib(i, 26); d.z *= 1.6; const p = d.clone().normalize(); const at = V3(p.x * .3, p.y * .3, p.z * .7); return X.bake(new THREE.CylinderGeometry(.006, .006, .22, 3), at.addScaledVector(p, .1), X.qFrom(UP, p)); })));
      g.add(body, new THREE.Mesh(fl, mat(0xc8f0a0, { emissive: 0x3a7a1a, emissiveIntensity: .4 })), new THREE.Mesh(pili, mat(0xa8f08a, { emissive: 0x2f7d1a, emissiveIntensity: .3 }))); g.scale.setScalar(1.6); return g; },
    // 路标：发光的引导环
    waypoint: () => { const g = new THREE.Group(); const m = X.glowMat(0x8fe9ff, 1.4); const t = new THREE.Mesh(new THREE.TorusGeometry(1.4, .07, 12, 96), m); g.add(t);
      g.add(new THREE.Mesh(new THREE.TorusGeometry(1.18, .025, 8, 96), X.glowMat(0xd8faff, 1.2, { transparent: true, opacity: .7 })));
      g.add(X.inst(sphereGeo(8, 6), X.glowMat(0xffffff, 2), 12, (i, d) => { const a = i / 12 * Math.PI * 2; d.position.set(Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0); d.scale.setScalar(.11); })); return g; },
    // 导向分子（Netrin）
    netrin: () => { const g = new THREE.Group(); g.add(new THREE.Mesh(proteinGeo(7, .6), pmat(0x8fe9ff, { emissive: 0x2fd0ff, emissiveIntensity: 1.4, roughness: .3 })), X.glowSprite(0x6fe0ff, 2.4, .45)); g.scale.setScalar(1.3); return g; },
    // 目标神经元（children[0] = 胞体）
    neuronTarget: () => { const k = Math.floor(rand(0, 3)); const N = cached('nt' + k, () => neuronParts({ somaR: .9, nDend: 5, seed: 20 + k, reach: .9, depth: 1, spines: false }));
      const g = new THREE.Group(); g.add(new THREE.Mesh(N.soma, rimP(0x4f8cff, { emissive: 0x2244aa, emissiveIntensity: .8, normalMap: X.normalTex('membrane') }, { rim: 0xa0d0ff, rimStr: .6 })), new THREE.Mesh(N.dend, rimP(0x6fa0ff, { emissive: 0x1a3a90, emissiveIntensity: .6 }, { rim: 0xa0d0ff })));
      g.rotation.y = rand(0, 6); return g; },
    // 营养：葡萄糖（球棍模型）
    nutrient: () => { const g = new THREE.Group(); const C = mat(0x8dff6b, { emissive: 0x39c14a, emissiveIntensity: 1 }), O = mat(0xff7a7a, { emissive: 0xc02a2a, emissiveIntensity: .9 });
      const rp = ring(6, .42); rp.forEach((p, i) => g.add(atom(p, i === 0 ? .14 : .12, i === 0 ? O : C)));
      const oh = rp.slice(1).map((p, i) => p.clone().multiplyScalar(1.6).add(V3(0, i % 2 ? .22 : -.22, 0))); oh.forEach(p => g.add(atom(p, .1, O)));
      g.add(new THREE.Mesh(cached('glcB', () => X.merge([...rp.map((p, i) => bondGeo(p, rp[(i + 1) % 6])), ...rp.slice(1).map((p, i) => bondGeo(p, oh[i], .035))])), mat(0xeaffea, { emissive: 0x80c080, emissiveIntensity: .6 })), X.glowSprite(0x8dff6b, 2, .35)); g.rotation.x = .5; return g; },
    // 核苷酸：磷酸 — 脱氧核糖 — 碱基
    nucleotide: () => { const g = new THREE.Group(); const col = [0xb388ff, 0xff8fb1, 0x8fe9ff, 0xffe36e][Math.floor(rand(0, 4))]; const purine = Math.random() < .5;
      const Pm = mat(0xffa040, { emissive: 0xff7010, emissiveIntensity: .9 }), Sm = mat(0xf0f0ff, { emissive: 0x8080a0, emissiveIntensity: .5 }), Bm = mat(col, { emissive: col, emissiveIntensity: 1 });
      const P0 = V3(-.62, 0, 0), sug = ring(5, .2, -.18, 0, .3), base = ring(6, .22, .42, .05); if (purine) base.push(...ring(5, .19, .78, .05).slice(1, 4));
      g.add(atom(P0, .17, Pm)); sug.forEach(p => g.add(atom(p, .07, Sm))); base.forEach(p => g.add(atom(p, .08, Bm)));
      const bonds = [bondGeo(P0, sug[3]), bondGeo(sug[0], base[3], .04), ...sug.map((p, i) => bondGeo(p, sug[(i + 1) % 5], .03)), ...base.slice(0, 6).map((p, i) => bondGeo(p, base[(i + 1) % 6], .03))];
      g.add(new THREE.Mesh(X.merge(bonds), mat(0xffffff, { emissive: 0x9090b0, emissiveIntensity: .5 })), X.glowSprite(col, 1.8, .35)); g.scale.setScalar(1.35); return g; },
    radical: () => spiky(0xff5a2a, 0xff2200, true),
    toxin: () => spiky(0x5b2a6b, 0x9b1cff),
    radiation: () => spiky(0xffe36e, 0xffc400, true),
    lactate: () => spiky(0xff9b5f, 0xff6a00),
    // 缺氧的组织细胞（userData.body 送氧后变色）
    tissue: () => { const g = new THREE.Group(); const b = new THREE.Mesh(cached('tissue', () => bumpy(new THREE.SphereGeometry(1.2, 40, 30), .06, 1.6)), rimP(0x8a8fc8, { emissive: 0x2a2050, emissiveIntensity: .45, normalMap: X.rep(X.normalTex('membrane'), 3), roughness: .35 }, { rim: 0xc8c8ff, rimStr: .5 })); b.scale.set(1.2, .75, 1.2);
      const n = new THREE.Mesh(cached('tn', () => bumpy(new THREE.SphereGeometry(.45, 20, 16), .03, 4)), rimP(0x7a2d8a, { emissive: 0x3a1050, emissiveIntensity: .4, normalMap: X.normalTex('chromatin') })); n.position.y = .55; n.scale.set(1.2, .6, 1);
      g.add(b, n); g.userData.body = b; return g; },
    // 成肌细胞：梭形
    myoblast: () => { const g = new THREE.Group(); const geo = cached('myob', () => X.sdfShrink(p => X.SDF.smin(X.SDF.roundCone(p, V3(-.8, 0, 0), V3(0, 0, 0), .06, .38), X.SDF.roundCone(p, V3(0, 0, 0), V3(.8, 0, 0), .38, .06), .2), 1.2, 48));
      g.add(new THREE.Mesh(geo, X.cellMat(0xf08a90, { opacity: .6, emissive: 0x7a2030, emissiveIntensity: .5 })));
      const n = new THREE.Mesh(sphereGeo(16, 12), rimP(0x8a4bd6, { emissive: 0x4a1a8a, emissiveIntensity: .5, normalMap: X.normalTex('chromatin') })); n.scale.set(.32, .2, .2); g.add(n, X.glowSprite(0xff8a90, 1.6, .25)); return g; },
    // 溶酶体：酸性水解酶囊泡
    lysosome: () => { const g = new THREE.Group(); const s = new THREE.Mesh(sphereGeo(24, 18), X.cellMat(0xc266ff, { opacity: .5, emissive: 0x7a1cff, emissiveIntensity: 1, nrep: 2 })); s.scale.setScalar(.45);
      g.add(X.inst(cached('enz', () => new THREE.IcosahedronGeometry(1, 0)), X.glowMat(0xf0d8ff, 1.2), 16, (i, d) => { d.position.copy(X.randDir()).multiplyScalar(rand(0, .3)); d.scale.setScalar(rand(.04, .07)); d.rotation.set(rand(0, 3), rand(0, 3), 0); }), s, X.glowSprite(0xc070ff, 1.6, .4)); return g; },
    // 凋亡小体 / 细胞碎片
    debris: () => { const g = new THREE.Group(); const m = rimP(0xbfb8c8, { emissive: 0x403050, emissiveIntensity: .5, normalMap: X.normalTex('membrane'), roughness: .45 }, { rim: 0xe0d8ff });
      g.add(new THREE.Mesh(bumpy(new THREE.SphereGeometry(.45, 24, 18), .12, 3, rand(0, 9)), m));
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(sphereGeo(14, 10), m); b.scale.setScalar(rand(.12, .22)); b.position.copy(X.randDir()).multiplyScalar(.55); g.add(b); }
      const fr = new THREE.Mesh(new THREE.SphereGeometry(.7, 16, 8, 0, 1.6, .8, 1.1), X.cellMat(0xd0c8e0, { opacity: .45, side: THREE.DoubleSide, emissive: 0x403050, emissiveIntensity: .3 })); fr.rotation.set(rand(0, 3), rand(0, 3), 0); g.add(fr); return g; },
    // 细胞因子（小蛋白）
    cytokine: () => { const g = new THREE.Group(); const c = [0x6ee7ff, 0xffe36e, 0xff8fb1][Math.floor(rand(0, 3))]; g.add(new THREE.Mesh(proteinGeo(11 + Math.floor(rand(0, 3)), .5), pmat(c, { emissive: c, emissiveIntensity: 1.2, roughness: .3 })), X.glowSprite(c, 2, .45)); g.scale.setScalar(1.3); return g; },
    // 糖原：分支的 β 颗粒玫瑰花结
    glycogen: () => { const g = new THREE.Group(); const geo = cached('glyc', () => { const ps = []; const gen = (p, d, lvl) => { ps.push(X.bake(new THREE.SphereGeometry(.13 - lvl * .025, 10, 8), p)); if (lvl < 3) for (let k = 0; k < 3; k++) { const d2 = d.clone().add(X.randDir().multiplyScalar(.9)).normalize(); gen(p.clone().addScaledVector(d2, .2 - lvl * .03), d2, lvl + 1); } }; gen(V3(0, 0, 0), UP.clone(), 0); return X.merge(ps).center(); });
      g.add(new THREE.Mesh(geo, pmat(0xffd36e, { emissive: 0xffa040, emissiveIntensity: .9, roughness: .3 })), X.glowSprite(0xffc050, 1.8, .35)); return g; },
    // T 细胞（children[0] = 细胞体）
    tcell: () => { const g = new THREE.Group(); const b = new THREE.Mesh(cached('tc', () => bumpy(new THREE.SphereGeometry(.9, 40, 30), .04, 2.5)), X.cellMat(0x6fa0ff, { opacity: .55, emissive: 0x2244aa, emissiveIntensity: .5 }));
      const n = new THREE.Mesh(cached('tcn', () => bumpy(new THREE.SphereGeometry(.64, 24, 18), .03, 3)), rimP(0x2b3f9e, { emissive: 0x101a60, emissiveIntensity: .4, normalMap: X.normalTex('chromatin') }));
      const mv = X.inst(cached('mvs', () => X.bake(new THREE.CapsuleGeometry(.025, .16, 3, 6), V3(0, .08, 0))), mat(0x9fc0ff, { emissive: 0x2244aa, emissiveIntensity: .4 }), 60, (i, d) => { const dir = X.fib(i, 60); d.position.copy(dir).multiplyScalar(.88); d.quaternion.copy(X.qFrom(UP, dir)); });
      g.add(b, n, mv); return g; }
  };

  /* ================================================================
     动画（QTE 步骤 / 过场）  返回 { dur, fn(k 0→1), end? }
     ================================================================ */
  const ANIMS = {
    /* 红细胞 */
    rbcEnucleate: () => { const P = G.player; const n = P.parts.nucleus; const s = n.position.clone(); return { dur: 2.2, fn: k => { n.position.x = s.x + ease(clamp(k * 1.4, 0, 1)) * 2.4; n.scale.setScalar(Math.max(.001, 1 - Math.max(0, k - .6) * 2.5)); if (k > .95) n.visible = false; } }; },
    rbcClearOrganelles: () => { const P = G.player; return { dur: 1.6, fn: k => P.parts.organelles.forEach(o => o.scale.setScalar(Math.max(0.001, 1 - k))) }; },
    rbcShape: () => { const P = G.player; return { dur: 2, fn: k => { P.parts.sphere.scale.setScalar(Math.max(.001, 1 - k)); P.parts.disc.visible = true; P.parts.disc.scale.setScalar(Math.max(.001, k)); }, end: () => { P.parts.sphere.visible = false; } }; },
    /* 白细胞出血管 */
    wbcRoll: () => { const g = G.player.group; const s = g.position.clone(); const wallX = G.env.halfW - 1.4; return { dur: 2.4, fn: k => { g.position.x = lerp(s.x, wallX, ease(Math.min(1, k * 1.5))); g.position.z = s.z - k * 10; G.player.group.rotation.z = -k * 12; } }; },
    wbcAdhere: () => { const g = G.player.group; return { dur: 1.6, fn: k => { g.rotation.z = lerp(g.rotation.z, 0, .08); g.scale.set(1 + .25 * Math.sin(k * Math.PI), 1 - .2 * Math.sin(k * Math.PI), 1 + .25 * Math.sin(k * Math.PI)); } }; },
    wbcExit: () => { const g = G.player.group; const s = g.position.clone(); return { dur: 2.6, fn: k => { const e = ease(k); g.scale.set(lerp(1, .35, Math.sin(k * Math.PI)), 1, lerp(1, 2.2, Math.sin(k * Math.PI))); g.position.x = s.x + e * 3.2; g.position.y = s.y + e * 1.5; } }; },
    /* 有丝分裂 */
    mitoProphase: () => { const P = G.player; const ne = P.parts.nucleus; return { dur: 2.2, fn: k => { ne.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = (1 - k) * .8; } }); P.parts.chromos.visible = true; P.parts.chromos.children.forEach(c => c.scale.setScalar(Math.max(.001, Math.min(1, k * 1.5)))); P.parts.centrosomes.forEach((c, i) => c.position.x = (i ? 1 : -1) * ease(k) * 1.6); }, end: () => P.parts.nucleus.visible = false }; },
    mitoMetaphase: () => { const P = G.player; const st = P.parts.chromos.children.map(c => c.position.clone()); return { dur: 2, fn: k => { const e = ease(k); P.parts.chromos.children.forEach((c, i) => { const y = (i - 2.5) * .34; c.position.set(lerp(st[i].x, 0, e), lerp(st[i].y, y, e), lerp(st[i].z, 0, e)); c.rotation.set(0, 0, 0); }); P.parts.spindle.visible = true; P.parts.spindle.scale.setScalar(Math.max(.001, e)); } }; },
    mitoAnaphase: () => { const P = G.player; return { dur: 2, fn: k => { const e = ease(k); P.parts.chromos.children.forEach(c => { c.children[0].position.x = -e * 1; c.children[1].position.x = e * 1; }); } }; },
    mitoTelophase: () => telophase(false),
    /* 神经元一生 / 吞噬 / 凋亡 */
    engulf: () => { const M = G.env.macrophage; const P = G.player.group; const s = M.position.clone(); return { dur: 22, fn: k => { const e = ease(clamp((k - .18) / .3, 0, 1)); M.position.lerpVectors(s, P.position.clone().add(V3(0, 0, -.5)), e); M.scale.setScalar(1 + e * .3);
        P.scale.setScalar(Math.max(.001, 1 - clamp((k - .45) / .25, 0, 1))); M.rotation.y += .002; if (k > .55) { const f = clamp((k - .55) / .3, 0, 1); M.children[0].material.emissive.setHex(0xff8040); M.children[0].material.emissiveIntensity = f * .6; } } }; },
    apoptosis: () => { const P = G.player.group; const blebs = new THREE.Group(); scene.add(blebs); const N = 22; const color = new THREE.Color(G.cell.color); const bm = X.cellMat(color, { opacity: .75, emissive: color, emissiveIntensity: .3, nrm: null });
        for (let i = 0; i < N; i++) { const b = new THREE.Mesh(sphereGeo(16, 12), bm); b.scale.setScalar(rand(.15, .35)); b.userData.s0 = b.scale.x; b.userData.d = V3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize(); b.userData.o = rand(0, 1); b.visible = false; blebs.add(b); }
        return { dur: 20, fn: k => { P.scale.setScalar(Math.max(.05, 1 - k * .8)); P.rotation.y += .01; P.position.y = Math.sin(k * 40) * .06 * (k > .2 ? 1 : 0);
          blebs.children.forEach(b => { const s = clamp((k - .25 - b.userData.o * .5) / .25, 0, 1); b.visible = s > 0; b.position.copy(P.position).addScaledVector(b.userData.d, 1 + s * 4); b.position.y += .8 + s; b.scale.setScalar(Math.max(.001, b.userData.s0 * (1 - s * .9))); }); }, end: () => scene.remove(blebs) }; },
    neuronLife: () => { const g = new THREE.Group(); scene.add(g); const P = G.player.group.position; const N = 70; const syn = []; const bg = sphereGeo(10, 8);
        for (let i = 0; i < N; i++) { const dir = V3(rand(-1, 1), rand(-.2, .6), rand(-1, 1)).normalize(); const len = rand(4, 12); const a = P.clone().add(V3(0, .8, 0)), b0 = a.clone().add(dir.clone().multiplyScalar(len));
          const mid = a.clone().lerp(b0, .5).add(X.randDir().multiplyScalar(len * .15)); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, mid, b0).getPoints(16)), new THREE.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
          const b = new THREE.Mesh(bg, mat(0xffe36e, { emissive: 0xffe36e, emissiveIntensity: 1, transparent: true, opacity: 0 })); b.scale.setScalar(.25); b.position.copy(b0); g.add(l, b); syn.push({ l, b, birth: rand(0, .35), death: Math.random() < .45 ? rand(.4, .6) : 2, prune: Math.random() < .3 }); }
        return { dur: 24, fn: k => { syn.forEach(s => { let a = clamp((k - s.birth) / .05, 0, 1); if (k > s.death) a *= clamp(1 - (k - s.death) / .05, 0, 1); if (k > .85 && !s.prune) a *= .6; s.l.material.opacity = a; s.b.material.opacity = a; s.b.material.emissiveIntensity = .5 + Math.sin(G.t * 6 + s.birth * 30) * .5; }); }, end: () => scene.remove(g) }; },

    /* ---------- 肌细胞 ---------- */
    muscleZ: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.zdiscs.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 6 - i) / 1.5, 0, 1)))) }; },
    muscleThick: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.thick.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 30 - i) / 6, 0, 1)))) }; },
    muscleThin: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.thin.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 60 - i) / 8, 0, 1)))) }; },
    muscleFirstTwitch: () => { const P = G.player; return { dur: 2.4, fn: k => { const c = Math.sin(clamp(k * 1.5, 0, 1) * Math.PI); P.parts.myofibrils.visible = k > .6; P.parts.striations.visible = k > .6; P.contractT = c; } }; },
    muscleAge: () => { const P = G.player; const fg = P.parts.fiberG; const fat = new THREE.Group(); scene.add(fat); const fm = X.cellMat(0xffe08a, { opacity: .75, emissive: 0x6a5010, emissiveIntensity: .3 });
        for (let i = 0; i < 10; i++) { const f = new THREE.Mesh(sphereGeo(20, 16), fm); f.userData.s = rand(.3, .6); f.position.copy(P.group.position).add(V3(rand(-3, 3), 1.2 + rand(-.6, .6), rand(-1.2, 1.2))); f.scale.setScalar(.001); f.userData.o = rand(.3, .8); fat.add(f); }
        return { dur: 24, fn: k => { const e = clamp((k - .3) / .6, 0, 1); fg.scale.set(1, 1 - e * .45, 1 - e * .45); P.parts.nuclei.forEach((n, i) => n.visible = i < 6 - Math.floor(e * 3)); fat.children.forEach(f => f.scale.setScalar(Math.max(.001, f.userData.s * clamp((k - f.userData.o) / .2, 0, 1)))); if (k > .8) P.contractT = Math.max(P.contractT, Math.sin((k - .8) * 30) * .4 + .4); }, end: () => scene.remove(fat) }; },

    /* ---------- 巨噬细胞 ---------- */
    macDifferentiate: () => { const P = G.player; return { dur: 2.6, fn: k => { const e = ease(k); P.parts.membrane.scale.setScalar(lerp(.8, 1.05, e)); P.parts.pods.scale.setScalar(lerp(.6, 1.1, e)); P.parts.lysosomes.scale.setScalar(1 + e * .3); P.r = lerp(1.3, 1.7, e); } }; },
    macDigest: () => { const P = G.player; P.parts.phagosome.visible = true; const bac = P.parts.phagoBac; const lys = P.parts.lysosomes.children.slice(0, 5); const st = lys.map(l => l.position.clone()); return { dur: 2.6, fn: k => { const e = ease(clamp(k * 1.6, 0, 1)); lys.forEach((l, i) => l.position.lerpVectors(st[i], P.parts.phagosome.position, e)); P.parts.phagoVes.material.color.setHex(k > .5 ? 0xd8a0ff : 0xd0f0ff); bac.scale.setScalar(Math.max(.001, 1 - clamp((k - .5) / .5, 0, 1))); bac.material.emissiveIntensity = k > .5 ? 2 : .5; } }; },
    macPresent: () => { const P = G.player; P.parts.mhc.visible = true; return { dur: 2.2, fn: k => P.parts.mhc.children.forEach((y, i) => y.scale.setScalar(Math.max(.001, clamp((k * 14 - i) / 4, 0, 1)))) }; },
    macActivate: () => { const P = G.player; const t = ITEM_BUILDERS.tcell(); scene.add(t); const start = P.group.position.clone().add(V3(7, 1.4, -4)); const end = P.group.position.clone().add(V3(2.6, 1.4, -.6)); t.position.copy(start);
        return { dur: 3, fn: k => { t.position.lerpVectors(start, end, ease(clamp(k * 1.4, 0, 1))); if (k > .7) { t.children[0].material.emissiveIntensity = 1 + Math.sin(k * 60) * .8; if (Math.floor(k * 30) % 6 === 0) burst(t.position.clone().lerp(P.group.position, .4).add(V3(0, 1, 0)), 0xffe36e); } }, end: () => { setTimeout(() => scene.remove(t), 3000); } }; },

    /* ---------- 干细胞 ---------- */
    stemAwaken: () => { const P = G.player; return { dur: 2, fn: k => { const e = ease(k); P.parts.body.material.emissiveIntensity = .2 + e * .35; P.parts.halo.scale.setScalar(1 + e * .3); P.parts.halo2.scale.setScalar(1 + e * .3); P.parts.nucleus.scale.setScalar(1 + e * .15); } }; },
    stemDivide: () => { const P = G.player; const ne = P.parts.nucleus; const st = P.parts.chromos.children.map(c => c.position.clone()); return { dur: 3.2, fn: k => { const k1 = clamp(k * 2, 0, 1), k2 = clamp(k * 2 - 1, 0, 1); ne.traverse(o => { if (o.isMesh) { o.material.transparent = true; o.material.opacity = (1 - k1) * .8; } }); if (k1 >= 1) ne.visible = false;
        P.parts.chromos.visible = true; P.parts.chromos.children.forEach((c, i) => { c.scale.setScalar(Math.max(.001, Math.min(1, k1 * 1.5))); const y = (i - 2.5) * .34; const e = ease(k2); c.position.set(lerp(st[i].x, 0, e), lerp(st[i].y, y, e), lerp(st[i].z, 0, e)); if (k2 > 0) c.rotation.set(0, 0, 0); }); P.parts.centrosomes.forEach((c, i) => c.position.x = (i ? 1 : -1) * ease(k1) * 1.6); P.parts.spindle.visible = k2 > 0; P.parts.spindle.scale.setScalar(Math.max(.001, ease(k2))); } }; },
    stemAsym: () => { const P = G.player; P.parts.halo.visible = false; P.parts.halo2.visible = false; const base = telophase(true); return { dur: 4, fn: k => { const k1 = clamp(k * 2.2, 0, 1), k2 = clamp((k - .45) / .55, 0, 1); P.parts.chromos.children.forEach(c => { c.children[0].position.x = -ease(k1); c.children[1].position.x = ease(k1); }); if (k2 > 0) base.fn(k2); }, end: base.end }; },
    stemLeave: () => { const P = G.player; const d = P.parts.daughters[1], n = P.parts.daughterNuclei[1]; const s = d.position.clone(); const ns = n.position.clone(); const c0 = new THREE.Color(0xdff4ff), c1 = new THREE.Color(0xff7a7a); return { dur: 3, fn: k => { const e = ease(k); d.material.color.lerpColors(c0, c1, Math.min(1, k * 2)); d.position.set(s.x + e * 6, s.y + e * .5, s.z - e * 4); n.position.set(ns.x + e * 6, ns.y + e * .5, ns.z - e * 4); d.material.opacity = .5 * (1 - clamp((k - .7) / .3, 0, 1)); n.visible = k < .8; P.parts.halo.visible = true; P.parts.halo2.visible = true; P.parts.halo.position.x = -1.8; P.parts.halo2.position.x = -1.8; } }; },
    stemLife: () => { const g = new THREE.Group(); scene.add(g); const P = G.player.group; const cells = [];
        const rbcM = pmat(0xd94848, { sheen: .6, sheenColor: new THREE.Color(0xff8080) }), wbcM = X.cellMat(0xd9ccff, { opacity: .7, nrm: null }), pltM = mat(0xffe3a3, { emissive: 0x6a5020, emissiveIntensity: .4 }), stM = X.cellMat(0x9fd8ff, { opacity: .7, emissive: 0x6ee7ff, emissiveIntensity: .5, nrm: null });
        for (let i = 0; i < 90; i++) { const kind = Math.random(); let m, s = .6; if (kind < .6) { m = new THREE.Mesh(X.rbcGeo(true), rbcM); s = .75; } else if (kind < .8) m = new THREE.Mesh(sphereGeo(20, 14), wbcM); else if (kind < .92) { m = new THREE.Mesh(cached('plt', () => X.smoothNormals(bumpy(new THREE.SphereGeometry(.45, 12, 10), .06, 3).scale(1, .35, 1))), pltM); s = 1; } else m = new THREE.Mesh(sphereGeo(20, 14), stM);
          m.userData.s = s; m.visible = false; g.add(m); cells.push({ m, birth: rand(0, .8), dir: V3(rand(-1, 1), rand(.1, .8), rand(-1, 1)).normalize(), spd: rand(4, 9) }); }
        return { dur: 26, fn: k => { cells.forEach(c => { const a = (k - c.birth) / .18; c.m.visible = a > 0 && a < 1; if (c.m.visible) { c.m.position.copy(P.position).add(V3(0, 1.2, 0)).addScaledVector(c.dir, a * c.spd); c.m.rotation.x += .05; c.m.rotation.y += .03; c.m.scale.setScalar((.2 + a * .6) * c.m.userData.s / .6); } }); if (k > .55) G.player.parts.body.material.emissiveIntensity = .2 + Math.max(0, .5 - (k - .55)); }, end: () => scene.remove(g) }; }
  };
  // 末期 + 胞质分裂（asym=true 时第二个子细胞略小、颜色不同）
  function telophase(asym) {
    const P = G.player; const bm = P.parts.body.material;
    return { dur: 3.2, fn: k => { const e = ease(k); const stretch = Math.min(1, k * 2.2);
      P.parts.body.scale.set(1.15 * (1 + stretch * .5), .85 * (1 - stretch * .3), 1.15 * (1 - stretch * .3)); bm.opacity = (P.parts.body.userData.op0 ?? .65) * (1 - clamp((k - .35) / .35, 0, 1));
      const ps = 1 - clamp((k - .25) / .55, 0, 1); P.parts.pinch.visible = k > .25 && ps > .06; P.parts.pinch.scale.set(1, Math.max(.02, ps), Math.max(.02, ps));
      P.parts.chromos.children.forEach(c => { c.scale.setScalar(Math.max(.001, 1 - e)); c.children[0].position.x = -1 - e * .8; c.children[1].position.x = 1 + e * .8; }); P.parts.spindle.scale.setScalar(Math.max(.001, 1 - stretch));
      P.parts.daughters.forEach((d, i) => { const s = clamp((k - .3) / .6, 0, 1); d.visible = s > 0; const ds = Math.max(.001, s * (asym && i ? .8 : .95)); d.scale.set(1.15 * ds, .85 * ds, 1.15 * ds); d.position.x = (i ? 1 : -1) * (.6 + s * 1.2); if (asym && i) d.material.color.setHex(0xffd0d0); });
      P.parts.daughterNuclei.forEach((n, i) => { const s = clamp((k - .5) / .5, 0, 1); n.visible = s > 0; n.scale.setScalar(Math.max(.001, s * (asym && i ? .7 : .85))); n.position.x = (i ? 1 : -1) * 1.8; });
      [P.parts.organelles, P.parts.villi].forEach(o => o && o.scale.setScalar(Math.max(.001, 1 - e))); },
      end: () => { if (P.parts.organelles) P.parts.organelles.visible = false; if (P.parts.villi) P.parts.villi.visible = false; } };
  }

  return { buildPlayer, ITEM_BUILDERS, ANIMS, lib: { makeNucleus, makeMito, mitoMats, makeER, makeGolgi, makeCentrosome, neuronParts, spineMesh, proteinGeo, cytoDots, rimP } };
};
