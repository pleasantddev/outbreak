// Page-side probe. Installed by perf/probe.py. Everything hangs off window.__P.
(() => {
  const hl = window.__hl, v = hl.view, sim = hl.sim, R = v.renderer, I = R.info, W = v.world;
  const P = window.__P = {};
  I.autoReset = false;
  P.halt = () => { window.requestAnimationFrame = () => 0; };
  P.settle = (x, z, maxIter = 400) => { for (let i = 0; i < maxIter; i++) { W.update(x, z, true); if (!W.job && i > 3) { let want = 0; /* all wanted tiles built */ if (i > 10) break; } } return W.tiles.size; };
  // classify draw objects
  const carRoots = () => new Set([...v.cars.values()].map((c) => c.m && c.m.root).filter(Boolean));
  let tag = 'main';
  const cat = (o, mat) => {
    if (o.isSkinnedMesh) return 'actor';
    if (o.isPoints) return 'fx';
    let p = o, tile = null, car = false, inWorld = false;
    while (p) { if (p === W.group) inWorld = true; if (P._cars && P._cars.has(p)) car = true; p = p.parent; }
    if (car) return 'car';
    if (inWorld) {
      if (mat && mat.hlUniforms) return 'tile.ground';
      if (mat === W.buildMat) return 'tile.bld';
      if (o.isInstancedMesh) return 'tile.inst';
      if (o.isLine || o.isLineSegments) return 'tile.wire';
      return 'tile.mesh';
    }
    if (o === v.atmo.dome) return 'sky';
    if (o.isLine || o.isLineSegments) return 'line';
    return 'other';
  };
  P.scan = (forceShadow = false) => {
    P._cars = carRoots();
    const rec = { passes: {}, cats: {}, objs: 0 };
    const orig = R.renderBufferDirect.bind(R);
    R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      const pass = scene ? tag : 'shadow';
      const c = cat(object, material);
      const tri = geometry.index ? geometry.index.count / 3 : (geometry.attributes.position ? geometry.attributes.position.count / 3 : 0);
      let n = group ? group.count / 3 : tri; if (object.isInstancedMesh) n *= object.count;
      const key = pass + ':' + c;
      const r = rec.cats[key] || (rec.cats[key] = { calls: 0, tris: 0 }); r.calls++; r.tris += n;
      return orig(camera, scene, geometry, material, object, group);
    };
    const wrapped = [];
    v.composer.passes.forEach((ps) => { const o = ps.render; ps.render = function (...a) { tag = ps.constructor.name + (ps.enabled ? '' : '-off'); return o.apply(this, a); }; wrapped.push([ps, o]); });
    I.reset(); const t0 = performance.now(); if (forceShadow && v.atmo.shadowOn) { v.atmo.sun.shadow.needsUpdate = true; R.shadowMap.needsUpdate = true; }
    v.composer.render(0.016); rec.ms = performance.now() - t0;
    rec.calls = I.render.calls; rec.tris = I.render.triangles; rec.lines = I.render.lines; rec.points = I.render.points;
    R.renderBufferDirect = orig; wrapped.forEach(([ps, o]) => (ps.render = o));
    rec.mem = { geo: I.memory.geometries, tex: I.memory.textures }; rec.programs = I.programs ? I.programs.length : 0;
    return rec;
  };
  // draw stubbing: removes the GPU cost so the JS-side cost of a frame can be timed
  const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements'];
  const gl = R.getContext(); const saved = {};
  P.stub = (on) => { for (const n of names) { if (on) { saved[n] = gl[n]; gl[n] = function () {}; } else if (saved[n]) { gl[n] = saved[n]; delete gl[n]; } } };
  P.cpuRender = (n = 12, shadow = true) => {
    P.stub(true); const ts = [];
    for (let i = 0; i < n; i++) { if (shadow && v.atmo.shadowOn) { v.atmo.sun.shadow.needsUpdate = true; R.shadowMap.needsUpdate = true; } const t0 = performance.now(); v.composer.render(0.016); ts.push(performance.now() - t0); }
    P.stub(false); ts.sort((a, b) => a - b); return { med: +ts[ts.length >> 1].toFixed(2), min: +ts[0].toFixed(2), max: +ts[ts.length - 1].toFixed(2) };
  };
  // full frame (view.frame without the sim): atmosphere, actors, cars, composer; draws stubbed
  P.cpuFrame = (n = 30) => {
    P.stub(true); const ts = []; const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0; let up = 0, last = heap0;
    for (let i = 0; i < n; i++) { const t0 = performance.now(); v.frame(1 / 60); ts.push(performance.now() - t0); const h = performance.memory ? performance.memory.usedJSHeapSize : 0; if (h > last) up += h - last; last = h; }
    P.stub(false); ts.sort((a, b) => a - b); return { med: +ts[ts.length >> 1].toFixed(2), p90: +ts[Math.floor(ts.length * 0.9)].toFixed(2), max: +ts[ts.length - 1].toFixed(2), kbPerFrame: +(up / 1024 / n).toFixed(1) };
  };
  // streaming: teleport the focus 400 m and let the non-burst path catch up. Reports each world.update call's wall time.
  P.stream = (x, z, maxCalls = 600) => {
    const calls = []; let idle = 0; const names = {}; const sl = {};
    const push = W.slices.push; W.slices.push = function (e) { const q = sl[e[0]] || (sl[e[0]] = { n: 0, max: 0, sum: 0 }); q.n++; q.sum += e[1]; if (e[1] > q.max) q.max = e[1]; return push.call(this, e); };
    for (let i = 0; i < maxCalls; i++) {
      const s0 = W.slices.length; const t0 = performance.now(); W.update(x, z, false); const ms = performance.now() - t0; calls.push(ms);
      if (ms < 0.6) idle++; else idle = 0; if (idle > 40) break;
    }
    W.slices.push = push; for (const k in sl) { sl[k].max = +sl[k].max.toFixed(1); sl[k].sum = +sl[k].sum.toFixed(0); }
    const busy = calls.filter((m) => m > 0.6); busy.sort((a, b) => a - b);
    return { calls: calls.length, busy: busy.length, max: +(busy[busy.length - 1] || 0).toFixed(1), p90: +(busy[Math.floor(busy.length * 0.9)] || 0).toFixed(1), med: +(busy[busy.length >> 1] || 0).toFixed(1), total: +busy.reduce((a, b) => a + b, 0).toFixed(0), over16: busy.filter((m) => m > 16).length, over8: busy.filter((m) => m > 8).length, tiles: W.tiles.size, slices: sl };
  };
  // heaviest draws in the main pass (visible, frustum culled): geometry tris x instances
  P.top = (n = 15) => {
    const out = []; const fr = v.fr; const cam = v.camera;
    W.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return; let p = o.parent, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return;
      if (o.frustumCulled && !fr.intersectsObject(o)) return;
      const g = o.geometry; const tri = (g.index ? g.index.count : g.attributes.position.count) / 3; const inst = o.isInstancedMesh ? o.count : 1;
      const tile = (() => { let q = o; while (q && q.parent !== W.group) q = q.parent; return q ? Math.round(q.position.x) + ',' + Math.round(q.position.z) : '?'; })();
      out.push({ tris: Math.round(tri * inst), inst, tri: Math.round(tri), mat: o.material && (o.material.name || o.material.type), tile, shadow: o.castShadow, sh: o.geometry.attributes.position.count });
    });
    out.sort((a, b) => b.tris - a.tris); const tot = out.reduce((a, b) => a + b.tris, 0);
    return { total: tot, n: out.length, top: out.slice(0, n) };
  };
  P.cam = (x, z, yaw, h = 2.6, back = 6) => { const dx = Math.sin(yaw), dz = Math.cos(yaw); v.debugCam = { x: x - dx * back, y: h, z: z - dz * back, tx: x + dx * 12, ty: 1.4, tz: z + dz * 12 }; };
  P.info = () => ({ calls: I.render.calls, tris: I.render.triangles, geo: I.memory.geometries, tex: I.memory.textures, prog: I.programs ? I.programs.length : 0, tiles: W.tiles.size, actors: v.actors.size, cars: v.cars.size, level: v.level, dpr: R.getPixelRatio(), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 });
  return 'probe ready';
})()
