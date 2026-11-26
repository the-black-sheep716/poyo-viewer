// camera.js: orthographic camera. Local coordinates are metres from the basin centre,
// z is the true height. Vertical exaggeration is applied here and nowhere else.
"use strict";
(function () {
  var DEG = POYO.DEG;

  // az: compass direction the camera looks towards. el: angle looking down.
  function basis(az, el) {
    var sa = Math.sin(az * DEG), ca = Math.cos(az * DEG);
    var se = Math.sin(el * DEG), ce = Math.cos(el * DEG);
    var f = [sa * ce, ca * ce, -se];                    // view direction
    var r = [ca, -sa, 0];                               // screen right
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { r: r, u: u, f: f };
  }

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  // view = {azimuth, elevation, ve, target:[x,y,z true]}
  // size = {width, height} in pixels, mpp = metres per pixel, box = scene bounds
  function matrix(view, size, mpp, box) {
    var b = basis(view.azimuth, view.elevation), ve = view.ve;
    var t = [view.target[0], view.target[1], view.target[2] * ve];
    var dmin = Infinity, dmax = -Infinity;
    for (var i = 0; i < 8; i++) {
      var c = [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1],
               (i & 4 ? box.max[2] : box.min[2]) * ve];
      var d = dot(b.f, [c[0] - t[0], c[1] - t[1], c[2] - t[2]]);
      if (d < dmin) dmin = d;
      if (d > dmax) dmax = d;
    }
    var margin = (dmax - dmin) * 0.01 + 200;
    var mid = (dmin + dmax) / 2, half = (dmax - dmin) / 2 + margin;
    var sx = 2 / (size.width * mpp), sy = 2 / (size.height * mpp), sz = 1 / half;
    // column major
    var m = new Float32Array([
      b.r[0] * sx, b.u[0] * sy, b.f[0] * sz, 0,
      b.r[1] * sx, b.u[1] * sy, b.f[1] * sz, 0,
      b.r[2] * sx * ve, b.u[2] * sy * ve, b.f[2] * sz * ve, 0,
      -dot(b.r, t) * sx, -dot(b.u, t) * sy, -(dot(b.f, t) + mid) * sz, 1
    ]);
    return { m: m, basis: b, depthHalf: half };
  }

  // Screen position in metres (right, up) of a point relative to the target.
  function project(view, p) {
    var b = basis(view.azimuth, view.elevation), ve = view.ve;
    var q = [p[0] - view.target[0], p[1] - view.target[1], (p[2] - view.target[2]) * ve];
    return [dot(b.r, q), dot(b.u, q), dot(b.f, q)];
  }

  // Move the target by (dx, dy) metres in the screen plane.
  function shift(view, dx, dy) {
    var b = basis(view.azimuth, view.elevation);
    view.target = [view.target[0] + b.r[0] * dx + b.u[0] * dy,
                   view.target[1] + b.r[1] * dx + b.u[1] * dy,
                   view.target[2] + (b.u[2] * dy) / view.ve];
  }

  // Slide the target along the view ray until it sits on the ground. The picture
  // does not change; orbiting then turns around the point in the middle of the sheet.
  function groundTarget(view, grid, inside) {
    if (view.elevation < 3) return;
    var b = basis(view.azimuth, view.elevation), ve = view.ve;
    var t = [view.target[0], view.target[1], view.target[2] * ve];
    var top = 1100 * ve, bottom = -100 * ve;
    var from = (top - t[2]) / b.f[2], to = (bottom - t[2]) / b.f[2];   // f[2] < 0
    if (!(to > from)) return;
    var steps = Math.min(6000, Math.max(50, Math.ceil((to - from) * Math.cos(view.elevation * DEG) / 20)));
    for (var i = 0; i <= steps; i++) {
      var s = from + (to - from) * i / steps;
      var x = t[0] + b.f[0] * s, y = t[1] + b.f[1] * s, z = (t[2] + b.f[2] * s) / ve;
      if (inside(x, y) && z <= grid.height(x, y)) {
        view.target = [x, y, z];                       // on the ray, so nothing moves
        return;
      }
    }
  }

  var COMPASS = ["north", "north east", "east", "south east", "south", "south west", "west", "north west"];
  function compass(az) { return COMPASS[Math.round((((az % 360) + 360) % 360) / 45) % 8]; }

  var PRESETS = {
    plan: { label: "Plan", azimuth: 0, elevation: 90 },
    elev_s: { label: "Elevation from the south", azimuth: 0, elevation: 0 },
    elev_e: { label: "Elevation from the east", azimuth: 270, elevation: 0 },
    elev_n: { label: "Elevation from the north", azimuth: 180, elevation: 0 },
    elev_w: { label: "Elevation from the west", azimuth: 90, elevation: 0 },
    iso_ne: { label: "Isometric from the north east", azimuth: 225, elevation: 35.264 },
    iso_se: { label: "Isometric from the south east", azimuth: 315, elevation: 35.264 },
    iso_sw: { label: "Isometric from the south west", azimuth: 45, elevation: 35.264 },
    iso_nw: { label: "Isometric from the north west", azimuth: 135, elevation: 35.264 }
  };

  function presetOf(az, el) {
    var found = "free";
    Object.keys(PRESETS).forEach(function (k) {
      var p = PRESETS[k];
      var da = Math.abs((((az - p.azimuth) % 360) + 540) % 360 - 180);
      if (Math.abs(el - p.elevation) < 0.01 && da < 0.01) found = k;
    });
    return found;
  }

  function viewName(view) {
    var k = presetOf(view.azimuth, view.elevation);
    if (k !== "free") return PRESETS[k].label;
    if (view.elevation >= 89.99) return "Plan, turned";
    if (view.elevation <= 0.01) return "Elevation, looking " + compass(view.azimuth);
    return "Oblique view, looking " + compass(view.azimuth);
  }

  // The statement printed on every sheet about which lengths are true.
  function lengthStatement(view) {
    var el = view.elevation, ve = view.ve;
    if (el >= 89.99) return ["Distances on the ground are true in every direction."];
    if (el <= 0.01) {
      return ["True lengths: horizontal, across the sheet.",
              ve === 1 ? "Heights are true." : "Heights are drawn × " + POYO.fmt(ve, ve % 1 ? 1 : 0) + "."];
    }
    var h = Math.cos(el * DEG) * ve, g = Math.sin(el * DEG);
    return ["True lengths: horizontal, across the sheet only.",
            "Heights are drawn × " + POYO.fmt(h, 2) + ", ground depth × " + POYO.fmt(g, 2) + "."];
  }

  POYO.camera = { basis: basis, matrix: matrix, project: project, shift: shift,
                  groundTarget: groundTarget, compass: compass, PRESETS: PRESETS,
                  presetOf: presetOf, viewName: viewName, lengthStatement: lengthStatement, dot: dot };
})();
