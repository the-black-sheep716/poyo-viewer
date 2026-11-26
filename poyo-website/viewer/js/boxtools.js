// boxtools.js: ways of setting the section box, and where its handles sit on screen.
// Box values are EPSG:25830 metres. Scene geometry is in local metres.
"use strict";
(function () {
  var GAP = [10, 10, 1];                       // smallest box size in x, y, z while editing

  function floor10(v) { return Math.floor(v / 10) * 10; }
  function ceil10(v) { return Math.ceil(v / 10) * 10; }

  // Rectangle around the basin outline, in local metres.
  function basinRect(app) {
    var xy = app.outline.xy, r = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < xy.length; i += 2) {
      if (xy[i] < r[0]) r[0] = xy[i]; if (xy[i + 1] < r[1]) r[1] = xy[i + 1];
      if (xy[i] > r[2]) r[2] = xy[i]; if (xy[i + 1] > r[3]) r[3] = xy[i + 1];
    }
    return r;
  }

  // Highest ground inside a local rectangle, or null when no ground lies there.
  function highest(app, x0, y0, x1, y1) {
    var g = app.scene.grids.terrain_10m, hi = null;
    var c0 = Math.max(0, Math.floor((x0 - g.left) / g.cell)), c1 = Math.min(g.cols - 1, Math.floor((x1 - g.left) / g.cell));
    var r0 = Math.max(0, Math.floor((g.top - y1) / g.cell)), r1 = Math.min(g.rows - 1, Math.floor((g.top - y0) / g.cell));
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        if (g.mask && !g.mask[r * g.cols + c]) continue;
        var h = g.at(c, r);
        if (hi === null || h > hi) hi = h;
      }
    }
    return hi;
  }

  // x and y from a local rectangle, rounded outward to 10 m.
  function setPlan(app, x0, y0, x1, y1) {
    var b = app.state.box, f = app.frame;
    b.min[0] = floor10(Math.min(x0, x1) + f.cx); b.max[0] = ceil10(Math.max(x0, x1) + f.cx);
    b.min[1] = floor10(Math.min(y0, y1) + f.cy); b.max[1] = ceil10(Math.max(y0, y1) + f.cy);
  }
  // Height from the base datum to a little above the highest ground inside.
  function setHeight(app, margin) {
    var b = app.state.box, f = app.frame;
    var hi = highest(app, b.min[0] - f.cx, b.min[1] - f.cy, b.max[0] - f.cx, b.max[1] - f.cy);
    b.min[2] = app.state.terrain.datum_m;
    b.max[2] = ceil10((hi === null ? 1100 : hi) + margin);
  }

  function fitBasin(app) {
    var r = basinRect(app);
    setPlan(app, r[0], r[1], r[2], r[3]);
    setHeight(app, 100);
  }

  function enable(app, on) {
    var s = app.state;
    if (on && !POYO.state.boxIsSet(s.box)) fitBasin(app);
    s.box.enabled = !!on;
    if (on) s.sheet.layout = "stage2";
  }

  function reset(app) {
    var s = app.state, keep = s.box.enabled;
    s.box = POYO.state.defaults().box;
    fitBasin(app);
    s.box.enabled = keep;
  }

  // A rectangle dragged in plan view, given as local metres.
  function fromRect(app, x0, y0, x1, y1) {
    var s = app.state, had = POYO.state.boxIsSet(s.box);
    setPlan(app, x0, y0, x1, y1);
    // keep a height the user chose, unless it is still the whole basin default
    if (!had || s.box.max[2] - s.box.min[2] > 400) setHeight(app, 60);
    enable(app, true);
  }

  // Take the box from what the sheet shows now.
  function fromView(app) {
    var s = app.state, v = s.view, mm = POYO.state.paperSize(s.sheet), f = app.frame;
    var halfW = mm[0] / 2000 * v.scale, halfH = mm[1] / 2000 * v.scale;
    var basis = POYO.camera.basis(v.azimuth, v.elevation), t = v.target;
    var had = POYO.state.boxIsSet(s.box);
    if (!had) fitBasin(app);
    if (v.elevation < 0.5) {
      // elevation: the sheet gives the run along the view and the height
      var off = Math.abs(v.azimuth / 90 - Math.round(v.azimuth / 90)) * 90;
      if (off > 0.5) return { ok: false, message: "In an elevation this needs a view along an axis: 0, 90, 180 or 270 degrees." };
      var axis = Math.abs(basis.r[0]) > 0.5 ? 0 : 1, c = axis === 0 ? f.cx : f.cy;
      s.box.min[axis] = floor10(t[axis] - halfW + c);
      s.box.max[axis] = ceil10(t[axis] + halfW + c);
      s.box.min[2] = Math.max(s.terrain.datum_m, Math.floor(t[2] - halfH / v.ve));
      s.box.max[2] = Math.max(s.box.min[2] + 10, Math.ceil(t[2] + halfH / v.ve));
      enable(app, true);
      return { ok: true, message: "Box set along the view and in height. The depth along the view is unchanged." };
    }
    // plan and oblique: the four sheet corners on a level plane through the target
    var xs = [], ys = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) {
      var px = t[0] + basis.r[0] * k[0] * halfW + basis.u[0] * k[1] * halfH;
      var py = t[1] + basis.r[1] * k[0] * halfW + basis.u[1] * k[1] * halfH;
      var pz = t[2] * v.ve + basis.r[2] * k[0] * halfW + basis.u[2] * k[1] * halfH;
      var step = (t[2] * v.ve - pz) / basis.f[2];
      xs.push(px + basis.f[0] * step); ys.push(py + basis.f[1] * step);
    });
    setPlan(app, Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys));
    setHeight(app, 60);
    enable(app, true);
    return { ok: true, message: v.elevation >= 89.99 ? "Box set to the sheet." : "Box set to the ground the sheet covers." };
  }

  // ==== screen positions. q is the screen layout from main.js
  function toScreen(app, q, p) {
    var m = POYO.camera.project(app.state.view, p);
    return [q.centreX + m[0] * q.pxPerM, q.centreY - m[1] * q.pxPerM];
  }

  function local(app) {
    var b = app.state.box, f = app.frame;
    return { min: [b.min[0] - f.cx, b.min[1] - f.cy, b.min[2]], max: [b.max[0] - f.cx, b.max[1] - f.cy, b.max[2]] };
  }

  // One handle in the middle of each face. A face seen exactly along its own axis
  // cannot be dragged, so its handle is left out.
  function handles(app, q) {
    var box = local(app), v = app.state.view, out = [];
    POYO.section.handles(box).forEach(function (h) {
      var step = [0, 0, 0]; step[h.axis] = 1;
      var a = POYO.camera.project(v, h.at);
      var b = POYO.camera.project(v, [h.at[0] + step[0], h.at[1] + step[1], h.at[2] + step[2]]);
      var vec = [(b[0] - a[0]) * q.pxPerM, -(b[1] - a[1]) * q.pxPerM];
      var seen = Math.hypot(b[0] - a[0], b[1] - a[1]) / (h.axis === 2 ? v.ve : 1);
      if (seen < 0.2) return;
      var at = toScreen(app, q, h.at);
      out.push({ name: h.name, axis: h.axis, side: h.side, x: at[0], y: at[1], vec: vec });
    });
    return out;
  }

  // New value of one face after the pointer moved by (dx, dy) screen pixels.
  function dragged(app, handle, start, dx, dy) {
    var b = app.state.box, vec = handle.vec, len = vec[0] * vec[0] + vec[1] * vec[1];
    if (!(len > 0)) return;
    var value = Math.round(start + (dx * vec[0] + dy * vec[1]) / len), a = handle.axis;
    if (handle.side === "min") value = Math.min(value, b.max[a] - GAP[a]);
    else value = Math.max(value, b.min[a] + GAP[a]);
    b[handle.side][a] = value;
  }

  // A typed value. The opposite face moves along when the two would cross.
  function typed(app, side, axis, value) {
    var s = app.state, b = s.box;
    if (!POYO.state.boxIsSet(b)) fitBasin(app);
    b[side][axis] = value;
    if (side === "min" && b.max[axis] < value + GAP[axis]) b.max[axis] = value + GAP[axis];
    if (side === "max" && b.min[axis] > value - GAP[axis]) b.min[axis] = value - GAP[axis];
  }

  // The twelve edges, as screen segments.
  function edges(app, q) {
    var box = local(app), out = [];
    function p(i) { return [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]]; }
    for (var i = 0; i < 8; i++) {
      [1, 2, 4].forEach(function (bit) {
        if (i & bit) return;
        out.push([toScreen(app, q, p(i)), toScreen(app, q, p(i | bit))]);
      });
    }
    return out;
  }

  POYO.boxtools = { basinRect: basinRect, highest: highest, fitBasin: fitBasin, enable: enable, reset: reset,
                    fromRect: fromRect, fromView: fromView, handles: handles, dragged: dragged, typed: typed,
                    edges: edges, toScreen: toScreen, GAP: GAP };
})();
