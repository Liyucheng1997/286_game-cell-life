// ============================================================
//  细胞模型 · 物品模型 · 动画
//  由 index.html 注入上下文 CTX 后调用：window.CellModels(CTX)
// ============================================================
window.CellModels = function (CTX) {
  const { THREE, G, scene, rand, clamp, lerp, ease, mat, pmat, bumpy, burst } = CTX;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---------------- 通用零件 ---------------- */
  // 细胞核（含核仁与染色质斑点）
  function makeNucleus(r, color = 0x8a4bd6, opt = {}) {
    const g = new THREE.Group();
    const env = new THREE.Mesh(bumpy(new THREE.SphereGeometry(r, 24, 24), r * .04, 3), pmat(color, { transparent: true, opacity: .8, depthWrite: false, emissive: color, emissiveIntensity: .25, ...opt }));
    const nucleolus = new THREE.Mesh(new THREE.SphereGeometry(r * .38, 14, 14), mat(0x3a1a6a, { emissive: 0x2a0a4a, emissiveIntensity: .5 }));
    nucleolus.position.set(r * .25, r * .1, r * .15);
    g.add(env, nucleolus);
    for (let i = 0; i < 14; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(r * .09, 6, 6), mat(0x5a2d9a)); s.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(r * .3, r * .8)); g.add(s); }
    g.userData.env = env; return g;
  }
  // 线粒体
  function makeMito(len = .5) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.14, len, 6, 12), pmat(0xff9f5a, { emissive: 0x7a3010, emissiveIntensity: .35 }));
    g.add(body);
    for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.TorusGeometry(.1, .025, 6, 12), mat(0xffd2a8)); c.position.y = -len / 2 + (i + .5) * len / 4; c.rotation.x = Math.PI / 2; g.add(c); }
    return g;
  }
  // 内质网（围绕核的弯曲片层）
  function makeER(r) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(r + i * .1, .035, 6, 40, Math.PI * rand(.5, 1.1)), mat(0xa9c8ff, { transparent: true, opacity: .8 })); t.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); g.add(t); }
    return g;
  }
  // 高尔基体（叠层）
  function makeGolgi() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.TorusGeometry(.32 + i * .06, .03, 6, 24, Math.PI * .8), mat(0xffe3a3)); d.position.y = i * .08 - .12; d.rotation.x = Math.PI / 2 + .3; g.add(d); }
    return g;
  }
  // 有丝分裂零件（上皮细胞 / 干细胞共用）
  function addMitosisParts(inner, parts, bodyColor) {
    const chromos = new THREE.Group(); chromos.visible = false; parts.chromos = chromos;
    const cols = [0xff5f7e, 0x6ee7ff, 0xffe36e, 0xa78bfa, 0x8dff6b, 0xff9b5f];
    for (let i = 0; i < 6; i++) { const pair = new THREE.Group(); const cm = mat(cols[i], { emissive: cols[i], emissiveIntensity: .35 });
      for (let j = 0; j < 2; j++) { const s = new THREE.Mesh(new THREE.CapsuleGeometry(.07, .3, 4, 8), cm); s.position.x = (j ? 1 : -1) * .1; const k = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 6), mat(0xffffff)); k.position.y = .05; s.add(k); pair.add(s); }
      pair.position.set(rand(-.5, .5), rand(-.5, .5), rand(-.5, .5)); pair.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); pair.scale.setScalar(.001); chromos.add(pair); }
    parts.centrosomes = [0, 1].map(() => { const c = new THREE.Group(); const m1 = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .18, 8), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: .8 })); const m2 = m1.clone(); m2.rotation.z = Math.PI / 2; c.add(m1, m2); c.position.y = .9; return c; });
    const spindle = new THREE.Group(); spindle.visible = false; parts.spindle = spindle;
    for (let i = 0; i < 16; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.8), mat(0xffffff, { transparent: true, opacity: .5 })); l.rotation.z = Math.PI / 2; l.position.set(0, (i % 8 - 3.5) * .28, (i < 8 ? .12 : -.12)); l.rotation.y = i < 8 ? .3 : -.3; spindle.add(l); }
    const pinch = new THREE.Mesh(new THREE.TorusGeometry(1.32, .06, 8, 40), mat(0xffd08a, { emissive: 0xffa040, emissiveIntensity: .8 })); pinch.rotation.y = Math.PI / 2; pinch.visible = false; parts.pinch = pinch;
    parts.daughterNuclei = [0, 1].map(() => { const n = makeNucleus(.5); n.visible = false; return n; });
    parts.daughters = [0, 1].map(() => { const d = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.3, 28, 28), .05, 3), pmat(bodyColor, { transparent: true, opacity: .7, depthWrite: false })); d.scale.set(1.15, .85, 1.15); d.visible = false; return d; });
    inner.add(chromos, ...parts.centrosomes, spindle, pinch, ...parts.daughters, ...parts.daughterNuclei);
  }
  // 树突 / 伪足：逐段变细的分支
  function branch(parent, origin, dir, len, r, depth, color, curl = .5) {
    let p = origin.clone(), d = dir.clone().normalize();
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const l = len / segs, r0 = r * (1 - i / segs * .5), r1 = r * (1 - (i + 1) / segs * .5);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, l, 7), mat(color));
      const q = p.clone().addScaledVector(d, l / 2); seg.position.copy(q); seg.quaternion.setFromUnitVectors(V3(0, 1, 0), d); parent.add(seg);
      p.addScaledVector(d, l); d.add(V3(rand(-curl, curl), rand(-curl, curl), rand(-curl, curl)).multiplyScalar(.5)).normalize();
    }
    if (depth > 0) for (let k = 0; k < 2; k++) branch(parent, p, d.clone().add(V3(rand(-1, 1), rand(-.5, 1), rand(-1, 1)).multiplyScalar(.7)), len * .6, r * .5, depth - 1, color, curl);
    return p;
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
      const sphere = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.25, 32, 32), .04, 3), pmat(0xd94848, { transparent: true, opacity: .68, depthWrite: false })); parts.sphere = sphere;
      const nucleus = makeNucleus(.62, 0x9a5cf0); parts.nucleus = nucleus;
      parts.organelles = []; for (let i = 0; i < 6; i++) { const o = makeMito(.3); o.position.set(rand(-.8, .8), rand(-.6, .6), rand(-.8, .8)); o.rotation.set(rand(0, 3), rand(0, 3), 0); parts.organelles.push(o); sphere.add(o); }
      for (let i = 0; i < 40; i++) { const rb = new THREE.Mesh(new THREE.SphereGeometry(.035, 4, 4), mat(0x3a1a6a)); rb.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(.7, 1.1)); parts.organelles.push(rb); sphere.add(rb); }
      sphere.add(nucleus);
      const pts = [[0, .26], [.3, .22], [.6, .22], [.9, .32], [1.15, .46], [1.32, .42], [1.44, .22], [1.48, 0], [1.44, -.22], [1.32, -.42], [1.15, -.46], [.9, -.32], [.6, -.22], [.3, -.22], [0, -.26]].map(p => new THREE.Vector2(p[0], p[1]));
      const discMat = pmat(0xb02a2a, { roughness: .35, clearcoat: .8, clearcoatRoughness: .3, sheen: .5, sheenColor: new THREE.Color(0xff8080) });
      const disc = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), discMat); disc.rotation.x = .5; parts.disc = disc; P.discMat = discMat;
      inner.add(sphere, disc);
      if (matured) { sphere.visible = false; disc.visible = true; } else { disc.visible = false; disc.scale.setScalar(.001); }
      P.setOxy = f => discMat.color.lerpColors(new THREE.Color(0x7a1a1a), new THREE.Color(0xff3b3b), f);
      if (stageIdx === 3) P.setOxy(1);
      P.update = (t, dt) => { disc.rotation.y += dt * .8; disc.rotation.x = .5 + Math.sin(t * 1.3) * .15; sphere.rotation.y += dt * .5; };
    }

    /* ---------- 中性粒细胞 ---------- */
    else if (id === 'neutrophil') {
      const memb = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.35, 40, 40), .09, 2.6), pmat(0xd8ccff, { transparent: true, opacity: .5, depthWrite: false, roughness: .3, clearcoat: .6 })); parts.membrane = memb;
      const nuc = new THREE.Group(); const nm = pmat(0x5a3d99, { emissive: 0x2a1a5a, emissiveIntensity: .4 });
      const lobes = [[-.6, .1, 0], [-.15, .4, .25], [.3, .1, -.15], [.7, -.15, .1]];
      lobes.forEach((p, i) => { const s = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.4, 14, 14), .03, 4), nm); s.position.set(...p); nuc.add(s);
        if (i) { const a = V3(...lobes[i - 1]), b = V3(...p); const c = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, a.distanceTo(b), 6), nm); c.position.lerpVectors(a, b, .5); c.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize()); nuc.add(c); } });
      parts.nucleus = nuc;
      const gr = new THREE.Group(); for (let i = 0; i < 46; i++) { const c = i % 3 ? 0xffc9f0 : 0xd0b0ff; const g = new THREE.Mesh(new THREE.SphereGeometry(rand(.06, .11), 6, 6), mat(c, { emissive: c, emissiveIntensity: .5 })); g.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(.5, 1.15)); gr.add(g); }
      for (let i = 0; i < 3; i++) { const m = makeMito(.25); m.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(.9); m.rotation.set(rand(0, 3), rand(0, 3), 0); gr.add(m); }
      inner.add(nuc, gr, memb);
      P.update = (t, dt) => { nuc.rotation.y += dt * .5; gr.rotation.y -= dt * .3; memb.scale.set(1 + Math.sin(t * 2) * .05, 1 + Math.cos(t * 2.3) * .05, 1 + Math.sin(t * 1.7) * .04); };
    }

    /* ---------- 神经元 ---------- */
    else if (id === 'neuron') {
      const somaMat = pmat(0x5aa9ff, { emissive: 0x123a88, emissiveIntensity: .5, transparent: true, opacity: .85, depthWrite: false, clearcoat: .7 });
      const soma = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.05, 32, 32), .05, 3), somaMat); parts.soma = soma;
      const nuc = makeNucleus(.55, 0x2b3f9e); soma.add(nuc);
      const dend = new THREE.Group(); parts.dendrites = dend;
      for (let i = 0; i < 6; i++) { const dir = V3(rand(-1, 1), rand(-.3, .9), rand(-1, 1)).normalize(); branch(dend, dir.clone().multiplyScalar(.95), dir, rand(1.6, 2.4), .16, 1, 0x7bbcff, .6); }
      const hill = new THREE.Mesh(new THREE.ConeGeometry(.28, .9, 10), mat(0x7bbcff)); hill.position.set(0, -.2, 1.15); hill.rotation.x = Math.PI / 2; parts.hillock = hill;
      for (let i = 0; i < 4; i++) { const m = makeMito(.25); m.position.set(rand(-.6, .6), rand(-.6, .6), rand(-.6, .6)); m.rotation.set(rand(0, 3), rand(0, 3), 0); soma.add(m); }
      inner.add(soma, dend, hill);
      P.update = (t, dt) => { somaMat.emissiveIntensity = .4 + Math.sin(t * 3) * .2; };
    }

    /* ---------- 上皮细胞 ---------- */
    else if (id === 'epithelial') {
      const bodyMat = pmat(0xffb347, { transparent: true, opacity: .62, roughness: .45, depthWrite: false, clearcoat: .5 });
      const body = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.3, 36, 36), .05, 3), bodyMat); body.scale.set(1.15, .85, 1.15); body.userData.op0 = .62; parts.body = body;
      const nucleus = makeNucleus(.6); parts.nucleus = nucleus;
      const org = new THREE.Group(); parts.organelles = org;
      for (let i = 0; i < 6; i++) { const m = makeMito(rand(.25, .4)); m.position.set(rand(-1, 1), rand(-.5, .5), rand(-1, 1)).normalize().multiplyScalar(rand(.85, 1.15)); m.position.y *= .6; m.rotation.set(rand(0, 3), rand(0, 3), 0); org.add(m); }
      const er = makeER(.75); org.add(er); const golgi = makeGolgi(); golgi.position.set(-.8, .1, .5); org.add(golgi);
      const villi = new THREE.Group(); parts.villi = villi;
      for (let i = 0; i < 40; i++) { const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * 1.1; const v = new THREE.Mesh(new THREE.CylinderGeometry(.03, .04, .35, 5), mat(0xffd08a)); v.position.set(Math.cos(a) * rr, Math.sqrt(Math.max(0, 1 - (rr / 1.5) ** 2)) * 1.05 + .1, Math.sin(a) * rr); villi.add(v); }
      addMitosisParts(inner, parts, 0xffb347);
      inner.add(body, nucleus, org, villi);
      P.update = (t, dt) => { nucleus.rotation.y += dt * .3; org.rotation.y += dt * .1; };
    }

    /* ---------- 肌细胞（骨骼肌纤维） ---------- */
    else if (id === 'muscle') {
      const fiberMat = pmat(0xd9575c, { transparent: true, opacity: .72, depthWrite: false, roughness: .4, clearcoat: .6, sheen: .6, sheenColor: new THREE.Color(0xff9090) });
      const fiber = new THREE.Mesh(bumpy(new THREE.CapsuleGeometry(.85, 4.2, 12, 28), .03, 3), fiberMat); fiber.rotation.z = Math.PI / 2; parts.fiber = fiber;
      const fiberG = new THREE.Group(); fiberG.add(fiber); parts.fiberG = fiberG;
      // 横纹
      const stri = new THREE.Group(); parts.striations = stri;
      for (let i = 0; i < 15; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(.87, .035, 6, 32), mat(0x8a2a30, { transparent: true, opacity: .75 })); r.position.x = -2.1 + i * .3; r.rotation.y = Math.PI / 2; stri.add(r); }
      fiberG.add(stri);
      // 多个细胞核贴在边缘
      parts.nuclei = []; for (let i = 0; i < 6; i++) { const n = new THREE.Mesh(new THREE.SphereGeometry(.28, 12, 12), pmat(0x8a4bd6, { emissive: 0x3a1a6a, emissiveIntensity: .4 })); n.scale.set(1.6, .8, .8); const a = rand(0, Math.PI * 2); n.position.set(-1.9 + i * .78, Math.sin(a) * .7, Math.cos(a) * .7); parts.nuclei.push(n); fiberG.add(n); }
      // 肌节（QTE 里逐步出现）
      const sarc = new THREE.Group(); parts.sarcomere = sarc; parts.zdiscs = []; parts.thick = []; parts.thin = [];
      for (let i = 0; i < 6; i++) { const z = new THREE.Mesh(new THREE.CylinderGeometry(.62, .62, .04, 24), mat(0x2a0a10, { emissive: 0x552030, emissiveIntensity: .5 })); z.rotation.z = Math.PI / 2; z.position.x = -1.75 + i * .7; z.scale.setScalar(.001); parts.zdiscs.push(z); sarc.add(z); }
      for (let s = 0; s < 5; s++) for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2;
        const th = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .42, 6), mat(0x4a1c40, { emissive: 0x3a0a30, emissiveIntensity: .4 })); th.rotation.z = Math.PI / 2; th.position.set(-1.4 + s * .7, Math.sin(a) * .35, Math.cos(a) * .35); th.scale.setScalar(.001); parts.thick.push(th); sarc.add(th);
        for (const side of [-1, 1]) { const tn = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .34, 5), mat(0xffd8d8, { emissive: 0xffa0a0, emissiveIntensity: .3 })); tn.rotation.z = Math.PI / 2; tn.position.set(-1.4 + s * .7 + side * .3, Math.sin(a + .5) * .38, Math.cos(a + .5) * .38); tn.scale.setScalar(.001); parts.thin.push(tn); sarc.add(tn); } }
      fiberG.add(sarc);
      // 肌原纤维（成熟后可见的细长条纹）
      const myof = new THREE.Group(); parts.myofibrils = myof;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const c = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, 4.4, 6), mat(0xff8a8a, { transparent: true, opacity: .55 })); c.rotation.z = Math.PI / 2; c.position.set(0, Math.sin(a) * .5, Math.cos(a) * .5); myof.add(c); }
      fiberG.add(myof);
      inner.add(fiberG);
      // 阶段 0：成肌细胞（很小），随融合长大
      P.r = 1.6; P.growth = stageIdx === 0 ? 0 : 1;
      P.setGrowth = f => { P.growth = f; fiberG.scale.set(.32 + f * .68, .55 + f * .45, .55 + f * .45); parts.nuclei.forEach((n, i) => n.visible = i < 1 + Math.floor(f * 5.99)); stri.visible = f > .5; myof.visible = f > .5; };
      P.setGrowth(P.growth);
      if (stageIdx >= 2) parts.zdiscs.concat(parts.thick, parts.thin).forEach(o => o.scale.setScalar(1));
      if (stageIdx < 2) myof.visible = false;
      P.contractT = 0; P.contract = () => { P.contractT = 1; };
      P.update = (t, dt) => { P.contractT = Math.max(0, P.contractT - dt * 1.6); const c = Math.sin(P.contractT * Math.PI); const s = fiberG.scale; const gx = .32 + P.growth * .68, gy = .55 + P.growth * .45; s.set(gx * (1 - c * .22), gy * (1 + c * .28), gy * (1 + c * .28)); fiberMat.emissive.setHex(0x661010); fiberMat.emissiveIntensity = c * .8; };
      P.onCollect = f => P.setGrowth(f);
    }

    /* ---------- 巨噬细胞 ---------- */
    else if (id === 'macrophage') {
      const big = stageIdx >= 2;
      const membMat = pmat(0xbfe3ff, { transparent: true, opacity: .55, depthWrite: false, roughness: .35, clearcoat: .6 });
      const memb = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.5, 44, 44), .16, 2.2), membMat); parts.membrane = memb;
      const pods = new THREE.Group(); parts.pods = pods;
      for (let i = 0; i < 9; i++) { const dir = V3(rand(-1, 1), rand(-.4, .6), rand(-1, 1)).normalize(); const p = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.34, 12, 12), .03, 4), membMat); p.geometry.scale(1, 2.4, 1); p.position.copy(dir).multiplyScalar(1.6); p.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); p.userData.dir = dir; p.userData.ph = rand(0, 6); pods.add(p); }
      // 肾形核
      const nuc = new THREE.Group(); const nm = pmat(0x5a3d99, { emissive: 0x2a1a5a, emissiveIntensity: .4 });
      const n1 = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.55, 16, 16), .03, 4), nm); n1.scale.set(1.3, .8, .9); n1.position.set(-.2, .1, 0); const n2 = n1.clone(); n2.position.set(.35, .2, .1); n2.scale.set(1, .75, .8); nuc.add(n1, n2); parts.nucleus = nuc;
      const lys = new THREE.Group(); parts.lysosomes = lys;
      for (let i = 0; i < 16; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(rand(.1, .18), 8, 8), mat(0xc266ff, { emissive: 0x7a1cff, emissiveIntensity: .5 })); l.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(.6, 1.2)); lys.add(l); }
      for (let i = 0; i < 5; i++) { const m = makeMito(.3); m.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(1); m.rotation.set(rand(0, 3), rand(0, 3), 0); lys.add(m); }
      // 吞噬体（含细菌）用于抗原呈递动画
      const phago = new THREE.Group(); phago.visible = false; parts.phagosome = phago;
      const pv = new THREE.Mesh(new THREE.SphereGeometry(.5, 14, 14), mat(0xd0f0ff, { transparent: true, opacity: .4, depthWrite: false })); const bac = new THREE.Mesh(new THREE.CapsuleGeometry(.14, .4, 4, 8), mat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .5 })); bac.rotation.z = 1; phago.add(pv, bac); phago.position.set(.7, -.3, .5); parts.phagoBac = bac; parts.phagoVes = pv;
      // MHC-II 分子（Y 形），初始隐藏
      const mhc = new THREE.Group(); mhc.visible = false; parts.mhc = mhc;
      for (let i = 0; i < 14; i++) { const dir = V3(rand(-1, 1), rand(-.2, 1), rand(-1, 1)).normalize(); const y = new THREE.Group(); const stem = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .3, 5), mat(0xffe36e, { emissive: 0xffc400, emissiveIntensity: 1 })); stem.position.y = .15; const a1 = stem.clone(); a1.position.set(-.08, .38, 0); a1.rotation.z = .5; const a2 = stem.clone(); a2.position.set(.08, .38, 0); a2.rotation.z = -.5; const pep = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 6), mat(0xff5f7e, { emissive: 0xff2050, emissiveIntensity: 1 })); pep.position.y = .48; y.add(stem, a1, a2, pep); y.position.copy(dir).multiplyScalar(1.5); y.quaternion.setFromUnitVectors(V3(0, 1, 0), dir); y.scale.setScalar(.001); mhc.add(y); }
      inner.add(nuc, lys, phago, memb, pods, mhc);
      P.r = big ? 1.7 : 1.3; if (!big) { memb.scale.setScalar(.8); pods.scale.setScalar(.6); }
      P.update = (t, dt) => { nuc.rotation.y += dt * .3; lys.rotation.y -= dt * .25; pods.children.forEach(p => { const s = 1 + Math.sin(t * 1.5 + p.userData.ph) * .25; p.scale.set(1, s, 1); p.position.copy(p.userData.dir).multiplyScalar(1.6 * (memb.scale.x) + s * .2); }); memb.rotation.y += dt * .1; };
    }

    /* ---------- 造血干细胞 ---------- */
    else if (id === 'stem') {
      const bodyMat = pmat(0xffffff, { transparent: true, opacity: .55, depthWrite: false, roughness: .25, clearcoat: .9, emissive: 0x9fd8ff, emissiveIntensity: .25 });
      const body = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.15, 36, 36), .03, 3), bodyMat); body.userData.op0 = .55; parts.body = body;
      const nucleus = makeNucleus(.8, 0x7c5cff, { emissiveIntensity: .45 }); parts.nucleus = nucleus;
      const org = new THREE.Group(); parts.organelles = org;
      for (let i = 0; i < 3; i++) { const m = makeMito(.2); m.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(.95); m.rotation.set(rand(0, 3), rand(0, 3), 0); org.add(m); }
      // 光环：象征“潜能”
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.5, .04, 8, 64), mat(0x9fd8ff, { emissive: 0x6ee7ff, emissiveIntensity: 1.5, transparent: true, opacity: .8 })); halo.rotation.x = Math.PI / 2; parts.halo = halo;
      const halo2 = halo.clone(); halo2.rotation.x = Math.PI / 3; halo2.rotation.y = .5; parts.halo2 = halo2;
      addMitosisParts(inner, parts, 0xdff4ff);
      inner.add(body, nucleus, org, halo, halo2);
      P.update = (t, dt) => { halo.rotation.z += dt * .6; halo2.rotation.z -= dt * .4; bodyMat.emissiveIntensity = .2 + Math.sin(t * 2) * .12; nucleus.rotation.y += dt * .3; };
    }
    return P;
  }

  /* ================================================================
     物品
     ================================================================ */
  const ITEM_BUILDERS = {
    iron: () => new THREE.Mesh(new THREE.IcosahedronGeometry(.5, 1), mat(0xff8a3d, { emissive: 0xff5a1a, emissiveIntensity: 1.2, flatShading: true })),
    o2: () => { const g = new THREE.Group(); const m = mat(0x8fe9ff, { emissive: 0x3fc8ff, emissiveIntensity: 1.4, transparent: true, opacity: .9 });
      const a = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 14), m), b = a.clone(); a.position.x = -.26; b.position.x = .26; g.add(a, b); return g; },
    granule: () => new THREE.Mesh(new THREE.SphereGeometry(.48, 14, 14), mat(0xd9a8ff, { emissive: 0x9a5cff, emissiveIntensity: 1 })),
    signal: () => new THREE.Mesh(new THREE.OctahedronGeometry(.6), mat(0xffe36e, { emissive: 0xffc400, emissiveIntensity: 1.3 })),
    bacteria: () => { const g = new THREE.Group(); const b = new THREE.Mesh(bumpy(new THREE.CapsuleGeometry(.32, .8, 6, 14), .02, 6), pmat(0x7ddc4c, { emissive: 0x2f7d1a, emissiveIntensity: .6, clearcoat: .5 }));
      b.rotation.z = Math.PI / 2; g.add(b); for (let i = 0; i < 8; i++) { const f = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .8), mat(0xa8f08a)); f.position.set(rand(-.6, .6), 0, rand(-.3, .3)); f.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3)); g.add(f); } g.scale.setScalar(1.6); return g; },
    waypoint: () => new THREE.Mesh(new THREE.TorusGeometry(1.4, .12, 10, 48), mat(0x8fe9ff, { emissive: 0x3fc8ff, emissiveIntensity: 1.4 })),
    netrin: () => new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 0), mat(0x8fe9ff, { emissive: 0x2fd0ff, emissiveIntensity: 1.6, flatShading: true })),
    neuronTarget: () => { const g = new THREE.Group(); const soma = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1, 20, 20), .04, 3), pmat(0x4f8cff, { emissive: 0x2244aa, emissiveIntensity: .8 })); g.add(soma);
      for (let i = 0; i < 5; i++) { const dir = V3(rand(-1, 1), rand(-.5, 1), rand(-1, 1)).normalize(); branch(g, dir.clone().multiplyScalar(.9), dir, rand(1.6, 2.6), .14, 1, 0x6fa0ff, .6); } return g; },
    nutrient: () => new THREE.Mesh(new THREE.DodecahedronGeometry(.55), mat(0x8dff6b, { emissive: 0x39c14a, emissiveIntensity: 1.1 })),
    nucleotide: () => { const g = new THREE.Group(); const c = [0xb388ff, 0xff8fb1, 0x8fe9ff, 0xffe36e][Math.floor(rand(0, 4))];
      const b = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), mat(c, { emissive: c, emissiveIntensity: 1 })); const s = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 8), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: .4 })); s.position.x = .45; g.add(b, s); return g; },
    radical: () => spiky(0xff5a2a, 0xff2200),
    toxin: () => spiky(0x5b2a6b, 0x9b1cff),
    radiation: () => spiky(0xffe36e, 0xffc400),
    lactate: () => spiky(0xff9b5f, 0xff6a00),
    tissue: () => { const g = new THREE.Group(); const b = new THREE.Mesh(bumpy(new THREE.SphereGeometry(1.2, 20, 20), .05, 3), pmat(0x9c8fb8, { emissive: 0x2a2050, emissiveIntensity: .4 })); b.scale.set(1.2, .8, 1.2);
      const n = new THREE.Mesh(new THREE.SphereGeometry(.45, 12, 12), mat(0x7a2d5a)); n.position.y = .3; g.add(b, n); g.userData.body = b; return g; },
    // 新增
    myoblast: () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .9, 6, 12), pmat(0xf08a90, { transparent: true, opacity: .8, emissive: 0x7a2030, emissiveIntensity: .5 })); b.rotation.z = Math.PI / 2; const n = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 10), mat(0x8a4bd6)); g.add(b, n); return g; },
    lysosome: () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.SphereGeometry(.45, 14, 14), pmat(0xc266ff, { emissive: 0x7a1cff, emissiveIntensity: 1, transparent: true, opacity: .85 })); g.add(s); for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(.08, 6, 6), mat(0xffffff)); d.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(.3); g.add(d); } return g; },
    debris: () => { const g = new THREE.Group(); const m = pmat(0xbfb8c8, { emissive: 0x403050, emissiveIntensity: .5, transparent: true, opacity: .85 }); const c = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.5, 12, 12), .12, 4), m); g.add(c);
      for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(rand(.1, .2), 8, 8), m); b.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(.6); g.add(b); } return g; },
    cytokine: () => { const g = new THREE.Group(); const c = [0x6ee7ff, 0xffe36e, 0xff8fb1][Math.floor(rand(0, 3))]; const s = new THREE.Mesh(new THREE.TetrahedronGeometry(.5), mat(c, { emissive: c, emissiveIntensity: 1.3, flatShading: true })); const s2 = s.clone(); s2.rotation.set(Math.PI, 0, 0); g.add(s, s2); return g; },
    glycogen: () => { const g = new THREE.Group(); for (let i = 0; i < 9; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 8), mat(0xffd36e, { emissive: 0xffa040, emissiveIntensity: 1 })); s.position.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(0, .3)); g.add(s); } return g; },
    tcell: () => { const g = new THREE.Group(); const b = new THREE.Mesh(bumpy(new THREE.SphereGeometry(.9, 20, 20), .04, 3), pmat(0x6fa0ff, { transparent: true, opacity: .7, depthWrite: false, emissive: 0x2244aa, emissiveIntensity: .5 })); const n = new THREE.Mesh(new THREE.SphereGeometry(.6, 14, 14), mat(0x2b3f9e)); g.add(b, n); return g; }
  };
  function spiky(color, emissive) { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(.5, 0), mat(color, { emissive, emissiveIntensity: 1, flatShading: true })); g.add(c);
    for (let i = 0; i < 12; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(.08, .45, 5), mat(color, { emissive, emissiveIntensity: .8 })); const d = V3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(); s.position.copy(d).multiplyScalar(.6); s.quaternion.setFromUnitVectors(V3(0, 1, 0), d); g.add(s); } return g; }

  /* ================================================================
     动画（QTE 步骤 / 过场）  返回 { dur, fn(k 0→1), end? }
     ================================================================ */
  const ANIMS = {
    /* 红细胞 */
    rbcEnucleate: () => { const P = G.player; const n = P.parts.nucleus; const s = n.position.clone(); return { dur: 2.2, fn: k => { n.position.x = s.x + ease(clamp(k * 1.4, 0, 1)) * 2.4; n.scale.setScalar(Math.max(.001, 1 - Math.max(0, k - .6) * 2.5)); if (k > .95) n.visible = false; } }; },
    rbcClearOrganelles: () => { const P = G.player; return { dur: 1.6, fn: k => P.parts.organelles.forEach(o => o.scale.setScalar(Math.max(0.001, 1 - k))) }; },
    rbcShape: () => { const P = G.player; return { dur: 2, fn: k => { P.parts.sphere.scale.setScalar(Math.max(.001, 1 - k)); P.parts.disc.visible = true; P.parts.disc.scale.setScalar(k); }, end: () => { P.parts.sphere.visible = false; } }; },
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
    apoptosis: () => { const P = G.player.group; const blebs = new THREE.Group(); scene.add(blebs); const N = 22; const color = new THREE.Color(G.cell.color);
        for (let i = 0; i < N; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(rand(.15, .35), 8, 8), pmat(color, { emissive: color, emissiveIntensity: .3, transparent: true, opacity: .85 })); b.userData.d = V3(rand(-1, 1), rand(0, 1), rand(-1, 1)).normalize(); b.userData.o = rand(0, 1); b.visible = false; blebs.add(b); }
        return { dur: 20, fn: k => { P.scale.setScalar(Math.max(.05, 1 - k * .8)); P.rotation.y += .01; P.position.y = Math.sin(k * 40) * .06 * (k > .2 ? 1 : 0);
          blebs.children.forEach(b => { const s = clamp((k - .25 - b.userData.o * .5) / .25, 0, 1); b.visible = s > 0; b.position.copy(P.position).addScaledVector(b.userData.d, 1 + s * 4); b.position.y += .8 + s; b.scale.setScalar(Math.max(.001, 1 - s * .9)); }); }, end: () => scene.remove(blebs) }; },
    neuronLife: () => { const g = new THREE.Group(); scene.add(g); const P = G.player.group.position; const N = 70; const syn = [];
        for (let i = 0; i < N; i++) { const dir = V3(rand(-1, 1), rand(-.2, .6), rand(-1, 1)).normalize(); const len = rand(4, 12); const a = P.clone().add(V3(0, .8, 0)), b0 = a.clone().add(dir.clone().multiplyScalar(len));
          const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b0]), new THREE.LineBasicMaterial({ color: 0x6fd6ff, transparent: true, opacity: 0 })); const b = new THREE.Mesh(new THREE.SphereGeometry(.25, 8, 8), mat(0xffe36e, { emissive: 0xffe36e, emissiveIntensity: 1, transparent: true, opacity: 0 })); b.position.copy(b0); g.add(l, b); syn.push({ l, b, birth: rand(0, .35), death: Math.random() < .45 ? rand(.4, .6) : 2, prune: Math.random() < .3 }); }
        return { dur: 24, fn: k => { syn.forEach(s => { let a = clamp((k - s.birth) / .05, 0, 1); if (k > s.death) a *= clamp(1 - (k - s.death) / .05, 0, 1); if (k > .85 && !s.prune) a *= .6; s.l.material.opacity = a; s.b.material.opacity = a; s.b.material.emissiveIntensity = .5 + Math.sin(G.t * 6 + s.birth * 30) * .5; }); }, end: () => scene.remove(g) }; },

    /* ---------- 肌细胞 ---------- */
    muscleZ: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.zdiscs.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 6 - i) / 1.5, 0, 1)))) }; },
    muscleThick: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.thick.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 30 - i) / 6, 0, 1)))) }; },
    muscleThin: () => { const P = G.player; return { dur: 1.8, fn: k => P.parts.thin.forEach((z, i) => z.scale.setScalar(Math.max(.001, clamp((k * 60 - i) / 8, 0, 1)))) }; },
    muscleFirstTwitch: () => { const P = G.player; return { dur: 2.4, fn: k => { const c = Math.sin(clamp(k * 1.5, 0, 1) * Math.PI); P.parts.myofibrils.visible = k > .6; P.contractT = c; } }; },
    muscleAge: () => { const P = G.player; const fg = P.parts.fiberG; const fat = new THREE.Group(); scene.add(fat);
        for (let i = 0; i < 10; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(rand(.3, .6), 10, 10), pmat(0xffe08a)); f.position.copy(P.group.position).add(V3(rand(-3, 3), 1.2 + rand(-.6, .6), rand(-1.2, 1.2))); f.scale.setScalar(.001); f.userData.o = rand(.3, .8); fat.add(f); }
        return { dur: 24, fn: k => { const e = clamp((k - .3) / .6, 0, 1); fg.scale.set(1, 1 - e * .45, 1 - e * .45); P.parts.nuclei.forEach((n, i) => n.visible = i < 6 - Math.floor(e * 3)); fat.children.forEach(f => f.scale.setScalar(Math.max(.001, clamp((k - f.userData.o) / .2, 0, 1)))); if (k > .8) P.contractT = Math.max(P.contractT, Math.sin((k - .8) * 30) * .4 + .4); }, end: () => scene.remove(fat) }; },

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
    stemLeave: () => { const P = G.player; const d = P.parts.daughters[1], n = P.parts.daughterNuclei[1]; const s = d.position.clone(); const ns = n.position.clone(); const c0 = new THREE.Color(0xdff4ff), c1 = new THREE.Color(0xff7a7a); return { dur: 3, fn: k => { const e = ease(k); d.material.color.lerpColors(c0, c1, Math.min(1, k * 2)); d.position.set(s.x + e * 6, s.y + e * .5, s.z - e * 4); n.position.set(ns.x + e * 6, ns.y + e * .5, ns.z - e * 4); d.material.opacity = .7 * (1 - clamp((k - .7) / .3, 0, 1)); n.visible = k < .8; P.parts.halo.visible = true; P.parts.halo2.visible = true; P.parts.halo.position.x = -1.8; P.parts.halo2.position.x = -1.8; } }; },
    stemLife: () => { const g = new THREE.Group(); scene.add(g); const P = G.player.group; const cells = [];
        const disc = new THREE.LatheGeometry([[0, .2], [.5, .17], [.9, .3], [1.15, .22], [1.2, 0], [1.15, -.22], [.9, -.3], [.5, -.17], [0, -.2]].map(p => new THREE.Vector2(p[0], p[1])), 24);
        for (let i = 0; i < 90; i++) { const kind = Math.random(); let m; if (kind < .6) m = new THREE.Mesh(disc, mat(0xd94848)); else if (kind < .8) m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), mat(0xd9ccff, { transparent: true, opacity: .8 })); else if (kind < .92) m = new THREE.Mesh(new THREE.SphereGeometry(.4, 8, 8), mat(0xffe3a3)); else m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), mat(0x9fd8ff, { emissive: 0x6ee7ff, emissiveIntensity: .5 }));
          m.scale.setScalar(.6); m.visible = false; g.add(m); cells.push({ m, birth: rand(0, .8), dir: V3(rand(-1, 1), rand(.1, .8), rand(-1, 1)).normalize(), spd: rand(4, 9), rot: rand(1, 3) }); }
        return { dur: 26, fn: k => { cells.forEach(c => { const a = (k - c.birth) / .18; c.m.visible = a > 0 && a < 1; if (c.m.visible) { c.m.position.copy(P.position).add(V3(0, 1.2, 0)).addScaledVector(c.dir, a * c.spd); c.m.rotation.x += .05; c.m.rotation.y += .03; c.m.scale.setScalar(.2 + a * .6); } }); if (k > .55) G.player.parts.body.material.emissiveIntensity = .2 + Math.max(0, .5 - (k - .55)) ; }, end: () => scene.remove(g) }; }
  };
  // 末期 + 胞质分裂（asym=true 时第二个子细胞略小、颜色不同）
  function telophase(asym) {
    const P = G.player; const bm = P.parts.body.material;
    return { dur: 3.2, fn: k => { const e = ease(k); const stretch = Math.min(1, k * 2.2);
      P.parts.body.scale.set(1.15 * (1 + stretch * .5), .85 * (1 - stretch * .3), 1.15 * (1 - stretch * .3)); bm.opacity = (P.parts.body.userData.op0 ?? .65) * (1 - clamp((k - .35) / .35, 0, 1));
      const ps = 1 - clamp((k - .25) / .55, 0, 1); P.parts.pinch.visible = k > .25 && ps > .06; P.parts.pinch.scale.set(1, Math.max(.02, ps), Math.max(.02, ps));
      P.parts.chromos.children.forEach(c => { c.scale.setScalar(Math.max(.001, 1 - e)); c.children[0].position.x = -1 - e * .8; c.children[1].position.x = 1 + e * .8; }); P.parts.spindle.scale.setScalar(Math.max(.001, 1 - stretch));
      P.parts.daughters.forEach((d, i) => { const s = clamp((k - .3) / .6, 0, 1); d.visible = s > 0; const ds = Math.max(.001, s * (asym && i ? .8 : .95)); d.scale.set(1.15 * ds, .85 * ds, 1.15 * ds); d.position.x = (i ? 1 : -1) * (.6 + s * 1.2); if (asym && i) d.material.color.setHex(0xffd0d0); });
      P.parts.daughterNuclei.forEach((n, i) => { const s = clamp((k - .5) / .5, 0, 1); n.visible = s > 0; n.scale.setScalar(Math.max(.001, s * (asym && i ? .7 : .85))); n.position.x = (i ? 1 : -1) * 1.8; }); },
      end: () => { if (P.parts.organelles) P.parts.organelles.visible = false; if (P.parts.villi) P.parts.villi.visible = false; } };
  }

  return { buildPlayer, ITEM_BUILDERS, ANIMS };
};
