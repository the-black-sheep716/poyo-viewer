// section.js: the section box. Pure geometry, no drawing, so it can be tested outside
// the browser. Box values in the state are EPSG:25830 metres (z is true height).
"use strict";
(function () {
  // The box in local metres, or null when it is off.
  function local(state, frame) {
    var b = state.box;
    if (!b || !b.enabled) return null;
    return { mode: b.mode === "inside" ? "inside" : "outside",
             min: [b.min[0] - frame.cx, b.min[1] - frame.cy, b.min[2]],
             max: [b.max[0] - frame.cx, b.max[1] - frame.cy, b.max[2]] };
  }

  // Value of the basin distance field at a point, bilinear like the graphics card.
  // 127.5 is the basin edge, higher is inside.
  function sdfAt(sdf, g, x, y) {
    var gx = (x - g.left) / g.cell - 0.5, gy = (g.top - y) / g.cell - 0.5;
    var i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    function v(c, r) {
      c = c < 0 ? 0 : c >= g.cols ? g.cols - 1 : c;
      r = r < 0 ? 0 : r >= g.rows ? g.rows - 1 : r;
      return sdf[r * g.cols + c];
    }
    return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) +
           (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
  }

  function Faces() { this.tri = []; this.line = []; this.area = 0; }
  // A point on a vertical plane: axis 0 is a plane x = value (s runs along y),
  // axis 1 is a plane y = value (s runs along x).
  function push(out, axis, value, s, z) {
    if (axis === 0) out.push(value, s, z); else out.push(s, value, z);
  }
  Faces.prototype.quad = function (axis, v, s0, s1, lo0, lo1, hi0, hi1) {
    var t = this.tri;
    push(t, axis, v, s0, lo0); push(t, axis, v, s1, lo1); push(t, axis, v, s1, hi1);
    push(t, axis, v, s0, lo0); push(t, axis, v, s1, hi1); push(t, axis, v, s0, hi0);
    this.area += (s1 - s0) * ((hi0 - lo0) + (hi1 - lo1)) / 2;
  };
  Faces.prototype.segment = function (axis, v, s0, z0, s1, z1) {
    if (Math.abs(s1 - s0) < 1e-6 && Math.abs(z1 - z0) < 1e-6) return;
    push(this.line, axis, v, s0, z0); push(this.line, axis, v, s1, z1);
  };

  // A run of touching quads gets one outline: ends, top and bottom.
  function Run(faces, axis, v) { this.f = faces; this.axis = axis; this.v = v; this.open = null; }
  Run.prototype.add = function (s0, s1, lo0, lo1, hi0, hi1) {
    var o = this.open, f = this.f, a = this.axis, v = this.v;
    if (o && Math.abs(o.s - s0) > 1e-4) { this.close(); o = null; }
    if (!o) f.segment(a, v, s0, lo0, s0, hi0);
    else {
      if (Math.abs(o.lo - lo0) > 1e-4) f.segment(a, v, s0, o.lo, s0, lo0);
      if (Math.abs(o.hi - hi0) > 1e-4) f.segment(a, v, s0, o.hi, s0, hi0);
    }
    f.quad(a, v, s0, s1, lo0, lo1, hi0, hi1);
    f.segment(a, v, s0, hi0, s1, hi1);
    f.segment(a, v, s0, lo0, s1, lo1);
    this.open = { s: s1, lo: lo1, hi: hi1 };
  };
  Run.prototype.close = function () {
    var o = this.open;
    if (o) this.f.segment(this.axis, this.v, o.s, o.lo, o.s, o.hi);
    this.open = null;
  };

  // Positions along the plane where the terrain mesh bends: grid lines and the
  // diagonals of the cells. Between two of them the ground is a straight line.
  function breakpoints(grid, axis, value, lo, hi) {
    var cell = grid.cell, out = [lo], frac, j, s, first, last;
    if (axis === 0) {                              // run along y
      var gx = (value - grid.left) / cell - 0.5; frac = gx - Math.floor(gx);
      first = Math.floor((grid.top - hi) / cell - 0.5) - 1;
      last = Math.ceil((grid.top - lo) / cell - 0.5) + 1;
      for (j = last; j >= first; j--) {            // y rises as j falls
        [j + 1 - frac, j].forEach(function (gy) {
          s = grid.top - (gy + 0.5) * cell;
          if (s > out[out.length - 1] + 1e-6 && s < hi - 1e-6) out.push(s);
        });
      }
    } else {                                       // run along x
      var gy2 = (grid.top - value) / cell - 0.5; frac = gy2 - Math.floor(gy2);
      first = Math.floor((lo - grid.left) / cell - 0.5) - 1;
      last = Math.ceil((hi - grid.left) / cell - 0.5) + 1;
      for (j = first; j <= last; j++) {
        [j, j + 1 - frac].forEach(function (g) {
          s = grid.left + (g + 0.5) * cell;
          if (s > out[out.length - 1] + 1e-6 && s < hi - 1e-6) out.push(s);
        });
      }
    }
    out.push(hi);
    return out;
  }

  // Cut face of the ground on one vertical plane.
  // o: grid, sdf, sdfGrid, datum, zmin, zmax
  function terrainFace(faces, o, axis, value, lo, hi) {
    var grid = o.grid;
    var floor = Math.max(o.datum, o.zmin), ceil = o.zmax;
    if (!(ceil > floor) || !(hi > lo)) return;
    var across = axis === 0 ? [grid.left, grid.left + grid.cols * grid.cell]
                            : [grid.top - grid.rows * grid.cell, grid.top];
    if (value < across[0] || value > across[1]) return;
    var along = axis === 0 ? [grid.top - grid.rows * grid.cell, grid.top]
                           : [grid.left, grid.left + grid.cols * grid.cell];
    lo = Math.max(lo, along[0]); hi = Math.min(hi, along[1]);
    if (!(hi > lo)) return;
    function px(s) { return axis === 0 ? value : s; }
    function py(s) { return axis === 0 ? s : value; }
    var pts = breakpoints(grid, axis, value, lo, hi), run = new Run(faces, axis, value);
    var s0 = pts[0], d0 = sdfAt(o.sdf, o.sdfGrid, px(s0), py(s0)) - 127.5, h0 = grid.height(px(s0), py(s0));
    for (var i = 1; i < pts.length; i++) {
      var s1 = pts[i], d1 = sdfAt(o.sdf, o.sdfGrid, px(s1), py(s1)) - 127.5, h1 = grid.height(px(s1), py(s1));
      if (d0 >= 0 || d1 >= 0) {
        var a = 0, b = 1;                          // part of the step inside the basin
        if (d0 < 0) a = d0 / (d0 - d1);
        if (d1 < 0) b = d0 / (d0 - d1);
        var cuts = [a, b];
        [floor, ceil].forEach(function (z) {
          if ((h0 - z) * (h1 - z) < 0) {
            var t = (z - h0) / (h1 - h0);
            if (t > a && t < b) cuts.push(t);
          }
        });
        cuts.sort(function (p, q) { return p - q; });
        for (var k = 0; k + 1 < cuts.length; k++) {
          var t0 = cuts[k], t1 = cuts[k + 1];
          if (t1 - t0 < 1e-9) continue;
          if (h0 + (h1 - h0) * (t0 + t1) / 2 <= floor) continue;
          var top0 = Math.min(ceil, Math.max(floor, h0 + (h1 - h0) * t0));
          var top1 = Math.min(ceil, Math.max(floor, h0 + (h1 - h0) * t1));
          run.add(s0 + (s1 - s0) * t0, s0 + (s1 - s0) * t1, floor, floor, top0, top1);
        }
      }
      s0 = s1; d0 = d1; h0 = h1;
    }
    run.close();
  }

  // Bounding rectangle of every building polygon, worked out once.
  function polygonBoxes(set) {
    var out = new Float32Array(set.count * 4);
    for (var p = 0; p < set.count; p++) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      var a = set.ringStart[set.polyRing[p]], b = set.ringStart[set.polyRing[p] + 1];
      for (var i = a; i < b; i++) {
        var x = set.xy[2 * i], y = set.xy[2 * i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      out[4 * p] = x0; out[4 * p + 1] = y0; out[4 * p + 2] = x1; out[4 * p + 3] = y1;
    }
    return out;
  }

  // Heights of one building as the renderer draws it.
  function buildingSpan(bl, f, heights) {
    var source = bl.source[f];
    var h = source === 2 ? (bl.industrial[f] ? heights.industrial : heights.other) : bl.height[f];
    return [bl.base[f] - 0.5, bl.roof[f] + h];
  }

  // Cut faces of the buildings on one vertical plane.
  // bl: {set, boxes, bins, base, roof, height, source, industrial}
  // o: grid (ground to stand on, or null), zmin, zmax, heights {other, industrial}
  function buildingFace(faces, bl, o, axis, value, lo, hi) {
    if (!(o.zmax > o.zmin) || !(hi > lo)) return 0;
    var set = bl.set, boxes = bl.boxes, count = 0;
    var across = axis, along = 1 - axis, grid = o.grid, ys = [];
    for (var q = 0; q < bl.bins.length; q++) {
      var bin = bl.bins[q];
      if (value < bin.box[across] || value > bin.box[across + 3]) continue;
      if (hi < bin.box[along] || lo > bin.box[along + 3]) continue;
      for (var n = 0; n < bin.polys.length; n++) {
        var p = bin.polys[n];
        if (value < boxes[4 * p + across] || value > boxes[4 * p + 2 + across]) continue;
        if (hi < boxes[4 * p + along] || lo > boxes[4 * p + 2 + along]) continue;
        ys.length = 0;
        for (var r = set.polyRing[p]; r < set.polyRing[p + 1]; r++) {
          var a0 = set.ringStart[r], a1 = set.ringStart[r + 1];
          for (var i = a0; i < a1; i++) {
            var j = i + 1 < a1 ? i + 1 : a0;
            var u = set.xy[2 * i + across], v = set.xy[2 * j + across];
            if ((u <= value) === (v <= value)) continue;
            var s = set.xy[2 * i + along];
            ys.push(s + (value - u) / (v - u) * (set.xy[2 * j + along] - s));
          }
        }
        if (ys.length < 2) continue;
        ys.sort(function (x, y) { return x - y; });
        var f = set.polyFeature[p], span = buildingSpan(bl, f, o.heights);
        var top = Math.min(o.zmax, span[1]);
        for (var k = 0; k + 1 < ys.length; k += 2) {
          var from = Math.max(lo, ys[k]), to = Math.min(hi, ys[k + 1]);
          if (!(to - from > 0.01)) continue;
          var run = new Run(faces, axis, value), used = false;
          var steps = grid ? Math.max(1, Math.ceil((to - from) / (grid.cell / 2))) : 1;
          var sA = from, zA = floorAt(sA);
          for (var m = 1; m <= steps; m++) {
            var sB = from + (to - from) * m / steps, zB = floorAt(sB);
            var lA = Math.min(zA, top), lB = Math.min(zB, top);
            if (top - lA > 0.001 || top - lB > 0.001) { run.add(sA, sB, lA, lB, top, top); used = true; }
            sA = sB; zA = zB;
          }
          run.close();
          if (used) count++;
        }
      }
    }
    return count;
    // the cut building stands on the ground line, or on its own base without ground
    function floorAt(s) {
      var z = grid ? grid.height(axis === 0 ? value : s, axis === 0 ? s : value) : span[0];
      return Math.max(o.zmin, z);
    }
  }

  // The four vertical faces of the box: [axis, plane, from, to]
  function verticalPlanes(box) {
    return [[0, box.min[0], box.min[1], box.max[1]], [0, box.max[0], box.min[1], box.max[1]],
            [1, box.min[1], box.min[0], box.max[0]], [1, box.max[1], box.min[0], box.max[0]]];
  }

  // Face centres with their axis, for the drag handles.
  function handles(box) {
    var mid = [0, 1, 2].map(function (i) { return (box.min[i] + box.max[i]) / 2; }), out = [];
    ["x", "y", "z"].forEach(function (name, axis) {
      ["min", "max"].forEach(function (side) {
        var p = mid.slice(); p[axis] = box[side][axis];
        out.push({ name: name + side, axis: axis, side: side, at: p });
      });
    });
    return out;
  }

  POYO.section = { local: local, sdfAt: sdfAt, Faces: Faces, terrainFace: terrainFace,
                   breakpoints: breakpoints, polygonBoxes: polygonBoxes, buildingSpan: buildingSpan,
                   buildingFace: buildingFace, verticalPlanes: verticalPlanes, handles: handles };
})();
