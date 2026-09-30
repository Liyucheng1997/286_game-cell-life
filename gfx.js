// ============================================================
//  渲染底座：噪声 · 程序化纹理 · 生物材质 · 几何工具 · 氛围
//  window.CellGfx({ THREE, renderer, scene, lights, bloom, mergeGeometries }) → X
// ============================================================
window.CellGfx = function ({ THREE, renderer, scene, lights, bloom, mergeGeometries }) {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const U = { time: { value: 0 } };

  /* ---------------- 随机与噪声 ---------------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // 3D Simplex 噪声（Gustavson）
  const perm = new Uint8Array(512); { const r = rng(1337), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
  const g3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];
  function corner(x, y, z, h) { let t = .6 - x * x - y * y - z * z; if (t < 0) return 0; const g = (h % 12) * 3; t *= t; return t * t * (g3[g] * x + g3[g + 1] * y + g3[g + 2] * z); }
  function simplex(x, y, z) {
    const s = (x + y + z) / 3, i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s), t = (i + j + k) / 6;
    const x0 = x - i + t, y0 = y - j + t, z0 = z - k + t; let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const ii = i & 255, jj = j & 255, kk = k & 255;
    return 32 * (corner(x0, y0, z0, perm[ii + perm[jj + perm[kk]]]) + corner(x0 - i1 + 1 / 6, y0 - j1 + 1 / 6, z0 - k1 + 1 / 6, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]])
      + corner(x0 - i2 + 1 / 3, y0 - j2 + 1 / 3, z0 - k2 + 1 / 3, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]) + corner(x0 - .5, y0 - .5, z0 - .5, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]));
  }
  function fbm(x, y, z, oct = 4) { let a = 0, f = 1, amp = .5, n = 0; for (let o = 0; o < oct; o++) { a += amp * simplex(x * f, y * f, z * f); n += amp; f *= 2.03; amp *= .5; } return a / n; }
  const ridged = (x, y, z) => 1 - Math.abs(simplex(x, y, z));

  /* ---------------- 可平铺 2D 纹理 ---------------- */
  // 周期值噪声
  function tileFbm(S, P0, oct, seed) {
    const r = rng(seed), H = new Float32Array(S * S); let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const P = P0 << o, lat = new Float32Array(P * P).map(() => r());
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const fx = x / S * P, fy = y / S * P, xi = Math.floor(fx), yi = Math.floor(fy), u = fx - xi, v = fy - yi;
        const x0 = xi % P, y0 = yi % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
        const a = lat[y0 * P + x0], b = lat[y0 * P + x1], c = lat[y1 * P + x0], d = lat[y1 * P + x1];
        H[y * S + x] += amp * (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv);
      }
      tot += amp; amp *= .5;
    }
    for (let i = 0; i < H.length; i++) H[i] /= tot; return H;
  }
  // 周期 Voronoi：返回 F1、F2、细胞 id
  function tileVoronoi(S, NX, NY, seed, jitter = .85) {
    const r = rng(seed), pts = new Float32Array(NX * NY * 2);
    for (let i = 0; i < NX * NY; i++) { pts[i * 2] = .5 + (r() - .5) * jitter; pts[i * 2 + 1] = .5 + (r() - .5) * jitter; }
    const F1 = new Float32Array(S * S), F2 = new Float32Array(S * S), ID = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = x / S * NX, fy = y / S * NY, cx = Math.floor(fx), cy = Math.floor(fy); let d1 = 9, d2 = 9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy, wx = (gx + NX) % NX, wy = (gy + NY) % NY, k = wy * NX + wx;
        const dx = gx + pts[k * 2] - fx, dy = gy + pts[k * 2 + 1] - fy, d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
      }
      const i = y * S + x; F1[i] = d1; F2[i] = d2; ID[i] = (id * 0.6180339) % 1;
    }
    return { F1, F2, ID };
  }
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function canvasOf(S, fn) { const c = document.createElement('canvas'); c.width = c.height = S; const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S); for (let i = 0; i < S * S; i++) { const [r, g, b, a = 255] = fn(i); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a; } ctx.putImageData(img, 0, 0); return c; }
  function normalFrom(H, S, str) {
    return canvasOf(S, i => { const x = i % S, y = (i / S) | 0, h = (xx, yy) => H[((yy + S) % S) * S + (xx + S) % S];
      const dx = (h(x + 1, y) - h(x - 1, y)) * str, dy = (h(x, y + 1) - h(x, y - 1)) * str, l = Math.hypot(dx, dy, 1);
      return [(-dx / l * .5 + .5) * 255, (dy / l * .5 + .5) * 255, (1 / l * .5 + .5) * 255]; });
  }
  function texFrom(canvas, srgb) { const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; }
  const HEIGHTS = {
    // 细胞铺面：扁平隆起的细胞 + 细沟
    cells: () => { const S = 512, v = tileVoronoi(S, 10, 10, 11, 1), n = tileFbm(S, 8, 5, 5); return v.F1.map((f, i) => sstep(0, .4, v.F2[i] - f) * (1 - .3 * f * f) * .7 + n[i] * .35 + v.ID[i] * .08); },
    // 细长内皮细胞（沿 V 方向拉长）
    endo: () => { const S = 512, v = tileVoronoi(S, 12, 4, 21), n = tileFbm(S, 8, 3, 6); return v.F1.map((f, i) => sstep(0, .18, v.F2[i] - f) * (1 - .6 * f * f) + n[i] * .12 + (f < .12 ? .25 * (1 - f / .12) : 0)); },
    // 细胞膜：细颗粒 + 膜蛋白小点
    membrane: () => { const S = 256, v = tileVoronoi(S, 22, 22, 31, 1), n = tileFbm(S, 6, 5, 7); return v.F1.map((f, i) => n[i] * .7 + (1 - sstep(.05, .3, f)) * .35); },
    fine: () => tileFbm(256, 6, 5, 9),
    // 骨：多孔 + 纤维
    bone: () => { const S = 512, v = tileVoronoi(S, 14, 14, 41), n = tileFbm(S, 4, 5, 8); return v.F1.map((f, i) => sstep(.04, .28, f) * .7 + n[i] * .5); },
    // 纤维状（胶原 / 结缔组织）
    fibrous: () => { const S = 256, a = tileFbm(S, 4, 4, 12); const H = new Float32Array(S * S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = Math.sin((x / S * 64 + a[y * S + x] * 6) * Math.PI) * .25 + a[((y * 4) % S) * S + x] * .6; return H; },
    // 染色质颗粒
    chromatin: () => { const S = 256, v = tileVoronoi(S, 18, 18, 51, 1), n = tileFbm(S, 8, 4, 13); return v.F1.map((f, i) => (1 - sstep(0, .35, f)) * .6 + n[i] * .5); },
  };
  const texCache = {};
  function normalTex(kind, str = 6) { const k = 'n_' + kind + str; if (!texCache[k]) { const H = HEIGHTS[kind](), S = Math.sqrt(H.length); texCache[k] = texFrom(normalFrom(H, S, str), false); } return texCache[k]; }
  // 彩色贴图
  const COLORS = {
    // 肺泡壁：毛细血管网沿 Voronoi 边缘
    capnet: () => { const S = 512, v = tileVoronoi(S, 7, 7, 61), n = tileFbm(S, 8, 4, 14);
      return canvasOf(S, i => { const e = v.F2[i] - v.F1[i], cap = 1 - sstep(.012, .05, e), m = n[i], shade = 1 - .25 * v.F1[i] * v.F1[i]; return [lerp(232 * shade, 176, cap) + m * 16, lerp(152 * shade, 36, cap) + m * 12, lerp(166 * shade, 54, cap) + m * 12]; }); },
    // 骨骼肌横纹：Z 线 | I 带 | A 带（H 区 + M 线）
    stripes: () => { const S = 256, n = tileFbm(S, 8, 3, 15);
      return canvasOf(S, i => { const x = i % S, y = (i / S) | 0, s = (y / S * 4) % 1; let b;
        if (s < .025 || s > .975) b = .15; else if (s < .2 || s > .8) b = .95; else if (Math.abs(s - .5) < .015) b = .35; else if (Math.abs(s - .5) < .09) b = .62; else b = .3;
        const fib = .88 + .12 * Math.sin(x / S * Math.PI * 2 * 24); b = b * fib + (n[i] - .5) * .1;
        return [lerp(90, 255, b), lerp(20, 170, b), lerp(34, 175, b), 255]; }); },
    // 横纹 alpha（暗带不透明）
    stripesA: () => { const S = 256; return canvasOf(S, i => { const y = (i / S) | 0, s = (y / S * 4) % 1; let a; if (s < .025 || s > .975) a = 1; else if (s < .2 || s > .8) a = .08; else if (Math.abs(s - .5) < .09) a = .4; else a = .85; const v = a * 255; return [v, v, v, 255]; }); },
    // 柔光点（粒子 / 光晕）
    sprite: () => { const S = 64; return canvasOf(S, i => { const x = i % S - S / 2 + .5, y = ((i / S) | 0) - S / 2 + .5, d = Math.hypot(x, y) / (S / 2), a = Math.max(0, 1 - d); return [255, 255, 255, a * a * a * 255]; }); },
    // 散景圆
    bokeh: () => { const S = 64; return canvasOf(S, i => { const x = i % S - S / 2 + .5, y = ((i / S) | 0) - S / 2 + .5, d = Math.hypot(x, y) / (S / 2); const a = d > 1 ? 0 : (.35 + .65 * sstep(.7, .95, d)) * (1 - sstep(.95, 1, d)); return [255, 255, 255, a * 255]; }); },
    // 接触阴影
    shadow: () => { const S = 64; return canvasOf(S, i => { const x = i % S - S / 2 + .5, y = ((i / S) | 0) - S / 2 + .5, d = Math.hypot(x, y) / (S / 2); return [0, 0, 0, Math.pow(Math.max(0, 1 - d), 2) * 255]; }); },
  };
  function colorTex(kind) { const k = 'c_' + kind; if (!texCache[k]) texCache[k] = texFrom(COLORS[kind](), kind !== 'stripesA' && kind !== 'sprite' && kind !== 'bokeh' && kind !== 'shadow'); return texCache[k]; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rep(tex, x, y = x) { const t = tex.clone(); t.repeat.set(x, y); t.needsUpdate = true; t.userData.disposable = true; return t; }

  /* ---------------- 材质 ---------------- */
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .02, envMapIntensity: .6, ...o });
  const pmat = (color, o = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: .42, metalness: .0, clearcoat: .5, clearcoatRoughness: .35, envMapIntensity: .8, ...o });
  // 菲涅尔边缘光 + 可选顶点呼吸形变
  function rimify(m, o = {}) {
    const u = { uRimColor: { value: new THREE.Color(o.rim ?? 0xffffff) }, uRimStr: { value: o.rimStr ?? .55 }, uRimPow: { value: o.rimPow ?? 2.6 }, uRimAlpha: { value: o.rimAlpha ?? .55 }, uWob: { value: o.wobble ?? 0 }, uWobF: { value: o.wobbleFreq ?? 2.2 } };
    m.userData.rim = u;
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u, { uTime: U.time });
      sh.vertexShader = 'uniform float uTime; uniform float uWob; uniform float uWobF;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uWob > 0.0) { vec3 q = position * uWobF; float w = sin(q.x + uTime * 1.3) * sin(q.y * 1.1 + uTime * 1.7) + sin(q.z * 1.2 - uTime * 1.1) * sin(q.x * .9 + q.y * .7 + uTime * .9); transformed += normal * w * uWob; }`);
      sh.fragmentShader = 'uniform vec3 uRimColor; uniform float uRimStr; uniform float uRimPow; uniform float uRimAlpha;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `{
          float fr = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), uRimPow);
          outgoingLight += uRimColor * fr * uRimStr; diffuseColor.a = clamp(diffuseColor.a + fr * uRimAlpha, 0.0, 1.0); }
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'rim';
    return m;
  }
  // 细胞膜：半透明、边缘亮、微颗粒法线
  function cellMat(color, o = {}) {
    const { rim, rimStr, rimPow, rimAlpha, wobble, wobbleFreq, nrm = 'membrane', nrep = 4, nscale = .5, ...rest } = o;
    const m = pmat(color, { transparent: true, opacity: .45, depthWrite: false, roughness: .3, clearcoat: .8, clearcoatRoughness: .25, side: THREE.FrontSide, ...rest });
    if (nrm) { m.normalMap = rep(normalTex(nrm), nrep, nrep / 2); m.normalScale.set(nscale, nscale); }
    return rimify(m, { rim: rim ?? new THREE.Color(color).lerp(new THREE.Color(0xffffff), .55).getHex(), rimStr, rimPow, rimAlpha, wobble, wobbleFreq });
  }
  // 组织表面（不透明，带法线纹理）
  function tissueMat(color, o = {}) {
    const { nrm = 'cells', nrep = 6, nrepY, nscale = .8, rim, rimStr = .25, ...rest } = o;
    const m = pmat(color, { roughness: .55, clearcoat: .35, clearcoatRoughness: .45, ...rest });
    if (nrm) { m.normalMap = rep(normalTex(nrm), nrep, nrepY ?? nrep); m.normalScale.set(nscale, nscale); }
    return rimify(m, { rim: rim ?? new THREE.Color(color).lerp(new THREE.Color(0xffffff), .5).getHex(), rimStr, rimAlpha: 0 });
  }
  const glowMat = (color, i = 1.5, o = {}) => mat(color, { emissive: color, emissiveIntensity: i, roughness: .4, ...o });
  function spriteMat(color, opacity = .8, additive = true) { return new THREE.SpriteMaterial({ map: colorTex('sprite'), color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }); }
  function glowSprite(color, size = 1, opacity = .6) { const s = new THREE.Sprite(spriteMat(color, opacity)); s.scale.setScalar(size); return s; }

  /* ---------------- 几何 ---------------- */
  // 平滑 UV 接缝处的法线
  function smoothNormals(geo) {
    geo.computeVertexNormals(); const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
    for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`; (map.get(k) || map.set(k, []).get(k)).push(i); }
    for (const ids of map.values()) if (ids.length > 1) { let x = 0, y = 0, z = 0; ids.forEach(i => { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }); const l = Math.hypot(x, y, z) || 1; ids.forEach(i => n.setXYZ(i, x / l, y / l, z / l)); }
    n.needsUpdate = true; return geo;
  }
  // 沿法向（径向）用 fbm 起伏
  function bumpy(geo, amp, freq, seed = 0) {
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); const l = v.length() || 1; const d = fbm(v.x * freq + seed * 7.1, v.y * freq + seed * 3.3, v.z * freq - seed * 5.7, 3); v.multiplyScalar((l + amp * d * 1.6) / l); p.setXYZ(i, v.x, v.y, v.z); }
    return smoothNormals(geo);
  }
  // 变径管：沿曲线，半径 = rf(t)
  function taperTube(curve, rf, tub = 48, rad = 10) {
    if (Array.isArray(curve)) curve = new THREE.CatmullRomCurve3(curve);
    const geo = new THREE.TubeGeometry(curve, tub, 1, rad, false), p = geo.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= tub; i++) { const t = i / tub; curve.getPointAt(t, c); const r = rf(t); for (let j = 0; j <= rad; j++) { const k = i * (rad + 1) + j; v.set(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r).add(c); p.setXYZ(k, v.x, v.y, v.z); } }
    geo.computeVertexNormals(); return geo;
  }
  // 星形体：每个顶点方向 d → 半径 rf(d)
  function starGeo(res, rf) {
    const geo = new THREE.SphereGeometry(1, res, Math.round(res * .75)), p = geo.attributes.position, d = new THREE.Vector3();
    geo.userData.dirs = p.array.slice();
    for (let i = 0; i < p.count; i++) { d.set(p.getX(i), p.getY(i), p.getZ(i)).normalize(); const r = rf(d, i); p.setXYZ(i, d.x * r, d.y * r, d.z * r); }
    return smoothNormals(geo);
  }
  // 可每帧更新的星形体（伪足 / 褶皱）
  function liveStar(geo, rf) {
    const p = geo.attributes.position, dirs = geo.userData.dirs, d = new THREE.Vector3(), p0 = new Map(), groups = [];
    for (let i = 0; i < p.count; i++) { const k = `${dirs[i * 3].toFixed(4)},${dirs[i * 3 + 1].toFixed(4)},${dirs[i * 3 + 2].toFixed(4)}`; (p0.get(k) || p0.set(k, []).get(k)).push(i); }
    for (const ids of p0.values()) if (ids.length > 1) groups.push(ids);
    return t => { for (let i = 0; i < p.count; i++) { d.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]); const r = rf(d, t, i); p.setXYZ(i, d.x * r, d.y * r, d.z * r); }
      p.needsUpdate = true; geo.computeVertexNormals(); const n = geo.attributes.normal;
      for (const ids of groups) { let x = 0, y = 0, z = 0; ids.forEach(i => { x += n.getX(i); y += n.getY(i); z += n.getZ(i); }); const l = Math.hypot(x, y, z) || 1; ids.forEach(i => n.setXYZ(i, x / l, y / l, z / l)); } };
  }
  // SDF 收缩包裹：从外向内沿射线找最外层表面（适合星形凸的有机体）
  function sdfShrink(sdf, maxR, res = 64, center = V3(0, 0, 0)) {
    const steps = 48, p = new THREE.Vector3();
    return starGeo(res, d => { let r = maxR, prev = maxR; const f = rr => sdf(p.copy(d).multiplyScalar(rr).add(center));
      for (let s = 0; s <= steps; s++) { r = maxR * (1 - s / steps); if (f(r) < 0) break; prev = r; }
      let a = r, b = prev; for (let k = 0; k < 10; k++) { const m = (a + b) / 2; if (f(m) < 0) a = m; else b = m; } return (a + b) / 2; }).translate(center.x, center.y, center.z);
  }
  const SDF = {
    sphere: (p, c, r) => p.distanceTo(c) - r,
    roundCone(p, a, b, r1, r2) { // iq：变径胶囊
      const ba = tmp1.subVectors(b, a), l2 = ba.dot(ba), pa = tmp2.subVectors(p, a); const h = Math.max(0, Math.min(1, pa.dot(ba) / l2)); const r = r1 + (r2 - r1) * h; return pa.addScaledVector(ba, -h).length() - r; },
    smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; },
  };
  const tmp1 = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  // 红细胞：Evans–Fung 双凹圆盘
  const _rbc = {}; function rbcGeo(lo = false) {
    if (_rbc[lo]) return _rbc[lo]; const pts = [], R = 1, N = lo ? 14 : 40, z = x => .5 * R * Math.sqrt(Math.max(0, 1 - x * x)) * (.207161 + 2.002558 * x * x - 1.122762 * x ** 4);
    for (let i = 0; i <= N; i++) { const th = i / N * Math.PI / 2, x = Math.sin(th); pts.push(new THREE.Vector2(Math.max(1e-4, x * R), -Math.max(z(x), 0))); }
    for (let i = N - 1; i >= 0; i--) { const th = i / N * Math.PI / 2, x = Math.sin(th); pts.push(new THREE.Vector2(Math.max(1e-4, x * R), Math.max(z(x), 0))); }
    return (_rbc[lo] = smoothNormals(new THREE.LatheGeometry(pts, lo ? 28 : 64)));
  }
  // 斐波那契球面均匀点
  function fib(i, n) { const y = 1 - (i + .5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996323; return V3(Math.cos(a) * r, y, Math.sin(a) * r); }
  function randDir(r = Math.random) { const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); return V3(Math.cos(a) * s, u, Math.sin(a) * s); }
  // 实例化：fn(i, dummy) 设置位姿，可返回颜色
  const _d = new THREE.Object3D(), _c = new THREE.Color();
  function inst(geo, material, n, fn) {
    const m = new THREE.InstancedMesh(geo, material, n);
    for (let i = 0; i < n; i++) { _d.position.set(0, 0, 0); _d.rotation.set(0, 0, 0); _d.scale.set(1, 1, 1); const c = fn(i, _d); _d.updateMatrix(); m.setMatrixAt(i, _d.matrix); if (c !== undefined && c !== null) m.setColorAt(i, _c.set(c)); }
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; return m;
  }
  // 合并几何（统一属性：position / normal / uv）
  function merge(list) {
    const allIdx = list.every(g => g.index), withColor = list.some(g => g.attributes.color);
    const gs = list.map(g => { if (!allIdx && g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k) || (k === 'color' && !withColor)) g.deleteAttribute(k);
      if (withColor && !g.attributes.color) paint(g, 0xffffff);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; });
    return mergeGeometries(gs);
  }
  // 顶点着色（合并几何时区分部件颜色）
  function paint(geo, hex) { const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; }
  // 沿某轴按长度重设 UV 的 v（胶囊体默认 UV 按顶点序号分布，长条会被拉伸）
  function axisUV(geo, axis = 'y') { geo.computeBoundingBox(); const b = geo.boundingBox, lo = b.min[axis], span = b.max[axis] - lo, p = geo.attributes.position, uv = geo.attributes.uv; for (let i = 0; i < p.count; i++) uv.setY(i, (p['get' + axis.toUpperCase()](i) - lo) / span); uv.needsUpdate = true; return geo; }
  // 把网格的局部变换烘焙进几何
  function bake(geo, pos, quat, scale) { const m = new THREE.Matrix4().compose(pos || V3(0, 0, 0), quat || new THREE.Quaternion(), scale || V3(1, 1, 1)); return geo.applyMatrix4(m); }
  const qFrom = (a, b) => new THREE.Quaternion().setFromUnitVectors(a, b);
  // 随机游走曲线（分支用）
  function walk(start, dir, len, n, curl, r = Math.random) { const pts = [start.clone()], p = start.clone(), d = dir.clone().normalize(); for (let i = 0; i < n; i++) { d.add(V3(r() - .5, r() - .5, r() - .5).multiplyScalar(curl)).normalize(); p.addScaledVector(d, len / n); pts.push(p.clone()); } return pts; }

  /* ---------------- 粒子 ---------------- */
  function particles({ n = 300, R = 30, y0 = .5, y1 = 12, color = 0xffffff, size = .25, opacity = .7, additive = true, tex = 'sprite', drift = .3 }) {
    const pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() * 2 - 1) * R; pos[i * 3 + 1] = y0 + Math.random() * (y1 - y0); pos[i * 3 + 2] = (Math.random() * 2 - 1) * R; ph[i] = Math.random() * 6.28; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size, map: colorTex(tex), transparent: true, opacity, depthWrite: false, sizeAttenuation: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    pts.userData.update = (t, dt) => { const a = g.attributes.position.array; for (let i = 0; i < n; i++) { a[i * 3] += Math.cos(t * .4 + ph[i]) * dt * drift; a[i * 3 + 1] += Math.sin(t * .6 + ph[i] * 2) * dt * drift * .6; a[i * 3 + 2] += Math.sin(t * .3 + ph[i]) * dt * drift; } g.attributes.position.needsUpdate = true; };
    return pts;
  }

  /* ---------------- 氛围：背景 / 雾 / 灯光 / 环境反射 ---------------- */
  const pmrem = new THREE.PMREMGenerator(renderer); const envCache = {};
  function envMap(top, mid, bot, key = 0xffffff) {
    const k = [top, mid, bot, key].join('_'); if (envCache[k]) return envCache[k];
    const s = new THREE.Scene(), geo = new THREE.SphereGeometry(10, 32, 16), p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const ct = new THREE.Color(top), cm = new THREE.Color(mid), cb = new THREE.Color(bot), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; if (y > 0) c.lerpColors(cm, ct, y); else c.lerpColors(cm, cb, -y); col.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    // 两块柔光箱，提供高光
    const box = (x, y, z, w, h, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(key).multiplyScalar(i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m); };
    box(4, 7, 5, 6, 3, 3.5); box(-7, 3, -4, 3, 5, 1.6);
    return (envCache[k] = pmrem.fromScene(s, .02).texture);
  }
  function mood(o) {
    scene.background = new THREE.Color(o.bg); scene.fog = new THREE.FogExp2(o.fog ?? o.bg, o.fogD ?? .02);
    lights.hemi.color.set(o.sky ?? 0xffffff); lights.hemi.groundColor.set(o.ground ?? 0x222233); lights.hemi.intensity = o.hemiI ?? .9;
    lights.sun.color.set(o.key ?? 0xffffff); lights.sun.intensity = o.keyI ?? 1.5;
    lights.rim.color.set(o.rim ?? 0x88ccff); lights.rim.intensity = o.rimI ?? 1.2;
    renderer.toneMappingExposure = o.exposure ?? 1.05; bloom.strength = o.bloom ?? .5;
    const e = o.env || [o.sky ?? 0xffffff, o.bg, o.ground ?? 0x111111]; scene.environment = envMap(e[0], e[1], e[2], o.key ?? 0xffffff);
  }
  function contactShadow(r, opacity = .5) { const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 3.2, r * 3.2), new THREE.MeshBasicMaterial({ map: colorTex('shadow'), transparent: true, opacity, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = .32; m.renderOrder = 1; return m; }

  /* ---------------- 后期：暗角 · 色差 · 颗粒 ---------------- */
  const FinishShader = {
    uniforms: { tDiffuse: { value: null }, uTime: U.time, uAmt: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmt; varying vec2 vUv;
      void main(){ vec2 c = vUv - .5; float d = length(c); vec2 o = c * d * .012 * uAmt;
        vec3 col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
        col *= mix(1.0, smoothstep(.95, .3, d), .55 * uAmt);
        float n = fract(sin(dot(vUv * 1000.0 + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
        col += (n - .5) * .03 * uAmt; gl_FragColor = vec4(col, 1.0); }`
  };

  // 预生成全部程序化纹理（菜单空闲时调用，避免首次进关卡卡顿）
  function warm() { Object.keys(HEIGHTS).forEach(k => normalTex(k)); ['capnet', 'stripes', 'stripesA', 'sprite', 'bokeh', 'shadow'].forEach(colorTex); [3, 7, 9].forEach(s => { normalTex('fine', s); normalTex('cells', s); normalTex('membrane', s); }); }
  // 释放一棵对象树占用的 GPU 资源（缓存的几何/材质下次使用时会自动重新上传）
  function dispose(root) { root.traverse(n => { if (n.geometry) n.geometry.dispose(); const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : []; ms.forEach(m => { for (const k of ['map', 'normalMap', 'alphaMap']) if (m[k] && m[k].userData.disposable) m[k].dispose(); m.dispose(); }); }); }

  return { U, rng, warm, dispose, simplex, fbm, ridged, normalTex, colorTex, rep, mat, pmat, rimify, cellMat, tissueMat, glowMat, spriteMat, glowSprite,
    smoothNormals, bumpy, taperTube, starGeo, liveStar, sdfShrink, SDF, rbcGeo, fib, randDir, inst, merge, paint, axisUV, bake, qFrom, walk, particles, envMap, mood, contactShadow, FinishShader };
};
