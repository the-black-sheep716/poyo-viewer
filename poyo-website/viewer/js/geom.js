// geom.js: pure geometry. No DOM, so it can be tested outside the browser.
"use strict";
(function () {
  // ==== terrain grid
  function Grid(meta, arrays, frame) {
    var cols = meta.cols, rows = meta.rows, delta = arrays.height_delta;
    var raw = new Int16Array(cols * rows);          // assignment wraps, like the encoder
    for (var r = 0; r < rows; r++) {
      var o = r * cols, run = 0;
      for (var c = 0; c < cols; c++) {
        run = (run + delta[o + c]) << 16 >> 16;
        raw[o + c] = run;
      }
    }
    this.cols = cols; this.rows = rows; this.cell = meta.cell;
    this.scale = meta.scale; this.offset = meta.offset;
    this.raw = raw; this.mask = arrays.mask;
    this.left = meta.x0 - frame.cx;                  // local metres of the left edge
    this.top = meta.ytop - frame.cy;                 // local metres of the top edge
  }

  Grid.prototype.at = function (c, r) {
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.raw[r * this.cols + c] * this.scale + this.offset;
  };

  // Height on the triangle mesh that the terrain renderer draws.
  Grid.prototype.height = function (x, y) {
    var gx = (x - this.left) / this.cell - 0.5, gy = (this.top - y) / this.cell - 0.5;
    var i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    var h10 = this.at(i + 1, j), h01 = this.at(i, j + 1);
    if (fx + fy <= 1) {
      var h00 = this.at(i, j);
      return h00 + fx * (h10 - h00) + fy * (h01 - h00);
    }
    var h11 = this.at(i + 1, j + 1);
    return h11 + (1 - fx) * (h01 - h11) + (1 - fy) * (h10 - h11);
  };

  Grid.prototype.range = function () {
    var lo = Infinity, hi = -Infinity, n = 0;
    for (var i = 0; i < this.raw.length; i++) {
      if (!this.mask[i]) continue;
      var v = this.raw[i]; n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return { min: lo * this.scale + this.offset, max: hi * this.scale + this.offset, cells: n };
  };

  // ==== polygons
  // Convert centimetre offsets to local metres.
  function localXY(xy, frame) {
    var out = new Float64Array(xy.length);
    for (var i = 0; i < xy.length; i += 2) {
      out[i] = frame.ox + xy[i] / 100 - frame.cx;
      out[i + 1] = frame.oy + xy[i + 1] / 100 - frame.cy;
    }
    return out;
  }

  function polygonSet(arrays, frame, prefix) {
    var p = prefix || "";
    return { xy: localXY(arrays[p + "xy"], frame), ringStart: arrays[p + "ring_start"],
             polyRing: arrays[p + "poly_ring"], polyFeature: arrays[p + "poly_feature"],
             count: arrays[p + "poly_feature"].length };
  }

  function ringArea(xy, s, e) {
    var a = 0, x0 = xy[2 * s], y0 = xy[2 * s + 1];
    for (var i = s + 1; i < e - 1; i++) {
      a += (xy[2 * i] - x0) * (xy[2 * i + 3] - y0) - (xy[2 * i + 2] - x0) * (xy[2 * i + 1] - y0);
    }
    return a / 2;                                    // positive when anticlockwise
  }

  // Area and centroid of one polygon of a set, holes subtracted.
  function polygonMoments(set, p) {
    var first = set.polyRing[p], last = set.polyRing[p + 1];
    var ref = set.ringStart[first], x0 = set.xy[2 * ref], y0 = set.xy[2 * ref + 1];
    var area = 0, mx = 0, my = 0;
    for (var r = first; r < last; r++) {
      var s = set.ringStart[r], e = set.ringStart[r + 1], a = 0, cx = 0, cy = 0;
      for (var i = s; i < e; i++) {
        var j = i + 1 < e ? i + 1 : s;
        var ax = set.xy[2 * i] - x0, ay = set.xy[2 * i + 1] - y0;
        var bx = set.xy[2 * j] - x0, by = set.xy[2 * j + 1] - y0;
        var k = ax * by - bx * ay;
        a += k; cx += (ax + bx) * k; cy += (ay + by) * k;
      }
      if (a === 0) continue;
      var sign = (r === first ? 1 : -1) * (a > 0 ? 1 : -1);
      area += sign * a / 2; mx += sign * cx / 6; my += sign * cy / 6;
    }
    return { area: area, mx: mx + x0 * area, my: my + y0 * area };
  }

  // ==== triangulation
  // Ear clipping with hole bridging (the approach used by mapbox/earcut).
  function Node(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = this.next = null; }

  function insert(i, x, y, last) {
    var p = new Node(i, x, y);
    if (!last) { p.prev = p.next = p; }
    else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function remove(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function same(a, b) { return a.x === b.x && a.y === b.y; }

  function linkedRing(xy, s, e, base, anticlockwise) {
    var last = null, i;
    if (anticlockwise === (ringArea(xy, s, e) > 0)) {
      for (i = s; i < e; i++) last = insert(i - base, xy[2 * i], xy[2 * i + 1], last);
    } else {
      for (i = e - 1; i >= s; i--) last = insert(i - base, xy[2 * i], xy[2 * i + 1], last);
    }
    if (last && same(last, last.next)) { remove(last); last = last.next; }
    return last;
  }

  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    var p = start, again;
    do {
      again = false;
      if (same(p, p.next) || area(p.prev, p, p.next) === 0) {
        remove(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }

  function inTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
           (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
           (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }

  function isEar(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var p = c.next;
    while (p !== a) {
      if (!same(p, a) && inTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) &&
          area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function onSegment(p, q, r) {
    return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) &&
           q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y);
  }
  function intersects(p1, q1, p2, q2) {
    var o1 = sign(area(p1, q1, p2)), o2 = sign(area(p1, q1, q2));
    var o3 = sign(area(p2, q2, p1)), o4 = sign(area(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && onSegment(p2, q1, q2)) return true;
    return false;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0
      ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0
      : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function middleInside(a, b) {
    var p = a, inside = false, px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if ((p.y > py) !== (p.next.y > py) && p.next.y !== p.y &&
          px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function crossesPolygon(a, b) {
    var p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i &&
          intersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function validDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !crossesPolygon(a, b) &&
      (locallyInside(a, b) && locallyInside(b, a) && middleInside(a, b) &&
        (area(a.prev, a, b.prev) || area(a, b.prev, b)) ||
        same(a, b) && area(a.prev, a, a.next) > 0 && area(b.prev, b, b.next) > 0);
  }
  function split(a, b) {
    var a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }

  function cureIntersections(start, out) {
    var p = start;
    do {
      var a = p.prev, b = p.next.next;
      if (!same(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        out.push(a.i, p.i, b.i);
        remove(p); remove(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }

  function splitAndClip(start, out) {
    var a = start;
    do {
      var b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && validDiagonal(a, b)) {
          var c = split(a, b);
          a = filterPoints(a, a.next);
          c = filterPoints(c, c.next);
          clip(a, out, 0);
          clip(c, out, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }

  function clip(ear, out, pass) {
    if (!ear) return;
    var stop = ear;
    while (ear.prev !== ear.next) {
      var prev = ear.prev, next = ear.next;
      if (isEar(ear)) {
        out.push(prev.i, ear.i, next.i);
        remove(ear);
        ear = stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) clip(filterPoints(ear), out, 1);
        else if (pass === 1) clip(cureIntersections(filterPoints(ear), out), out, 2);
        else if (pass === 2) splitAndClip(ear, out);
        break;
      }
    }
  }

  function bridgeTo(hole, outer) {
    var p = outer, hx = hole.x, hy = hole.y, qx = -Infinity, m = null;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) return m;
        }
      }
      p = p.next;
    } while (p !== outer);
    if (!m) return null;
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x &&
          inTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        var tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) &&
            (tan < tanMin || (tan === tanMin && (p.x > m.x ||
              (p.x === m.x && area(m.prev, m, p.prev) < 0 && area(p.next, m, m.next) < 0))))) {
          m = p; tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }

  // Triangle indices (relative to the polygon's first vertex) for polygon p.
  function triangulate(set, p, out) {
    var first = set.polyRing[p], last = set.polyRing[p + 1], base = set.ringStart[first];
    var outer = linkedRing(set.xy, base, set.ringStart[first + 1], base, true);
    if (!outer || outer.next === outer.prev) return out;
    var holes = [];
    for (var r = first + 1; r < last; r++) {
      var h = linkedRing(set.xy, set.ringStart[r], set.ringStart[r + 1], base, false);
      if (!h) continue;
      var q = h, left = h;
      do { if (q.x < left.x || (q.x === left.x && q.y < left.y)) left = q; q = q.next; } while (q !== h);
      holes.push(left);
    }
    holes.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    for (var i = 0; i < holes.length; i++) {
      var bridge = bridgeTo(holes[i], outer);
      if (!bridge) continue;
      var back = split(bridge, holes[i]);
      filterPoints(back, back.next);
      outer = filterPoints(bridge, bridge.next);
    }
    clip(outer, out, 0);
    return out;
  }

  // ==== fill rasteriser
  // Coverage (0 to 255) of a polygon set on a grid, 4 sample lines per row.
  function rasterCoverage(set, px, pad) {
    var xy = set.xy, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, i;
    for (i = 0; i < xy.length; i += 2) {
      if (xy[i] < minx) minx = xy[i];
      if (xy[i] > maxx) maxx = xy[i];
      if (xy[i + 1] < miny) miny = xy[i + 1];
      if (xy[i + 1] > maxy) maxy = xy[i + 1];
    }
    if (!isFinite(minx)) { minx = miny = 0; maxx = maxy = px; }
    var left = Math.floor(minx / px - pad) * px, top = Math.ceil(maxy / px + pad) * px;
    var cols = Math.ceil((maxx - left) / px) + pad, rows = Math.ceil((top - miny) / px) + pad;
    cols = (cols + 3) & ~3;                           // rows of the texture stay 4 byte aligned
    var data = new Uint8Array(cols * rows), SUB = 4, STEP = 64;
    for (var p = 0; p < set.count; p++) {
      var first = set.polyRing[p], last = set.polyRing[p + 1];
      var s0 = set.ringStart[first], e0 = set.ringStart[last];
      var ylo = Infinity, yhi = -Infinity, xlo = Infinity, xhi = -Infinity;
      for (i = s0; i < e0; i++) {
        var vx = xy[2 * i], vy = xy[2 * i + 1];
        if (vy < ylo) ylo = vy; if (vy > yhi) yhi = vy;
        if (vx < xlo) xlo = vx; if (vx > xhi) xhi = vx;
      }
      var r0 = Math.max(0, Math.floor((top - yhi) / px));
      var r1 = Math.min(rows - 1, Math.floor((top - ylo) / px));
      var c0 = Math.max(0, Math.floor((xlo - left) / px));
      var c1 = Math.min(cols - 1, Math.floor((xhi - left) / px));
      if (r1 < r0 || c1 < c0) continue;
      var lines = new Array((r1 - r0 + 1) * SUB);
      for (var r = first; r < last; r++) {
        var s = set.ringStart[r], e = set.ringStart[r + 1];
        for (i = s; i < e; i++) {
          var j = i + 1 < e ? i + 1 : s;
          var ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1];
          if (ay === by) continue;
          var lo = Math.min(ay, by), hi = Math.max(ay, by);
          // sample line k sits at y = top - (k + 0.5) * px / SUB
          var k0 = Math.max(r0 * SUB, Math.floor((top - hi) * SUB / px - 0.5) + 1);
          var k1 = Math.min((r1 + 1) * SUB - 1, Math.floor((top - lo) * SUB / px - 0.5));
          for (var k = k0; k <= k1; k++) {
            var yc = top - (k + 0.5) * px / SUB;
            var xi = ax + (yc - ay) * (bx - ax) / (by - ay);
            var slot = k - r0 * SUB;
            (lines[slot] || (lines[slot] = [])).push(xi);
          }
        }
      }
      var acc = new Float32Array(c1 - c0 + 2);
      for (var row = r0; row <= r1; row++) {
        acc.fill(0);
        var any = false;
        for (var q = 0; q < SUB; q++) {
          var hits = lines[(row - r0) * SUB + q];
          if (!hits) continue;
          hits.sort(function (a, b) { return a - b; });
          for (var h = 0; h + 1 < hits.length; h += 2) {
            var u0 = (hits[h] - left) / px, u1 = (hits[h + 1] - left) / px;
            var a0 = Math.max(c0, Math.floor(u0)), a1 = Math.min(c1, Math.floor(u1));
            for (var col = a0; col <= a1; col++) {
              var cover = Math.min(u1, col + 1) - Math.max(u0, col);
              if (cover > 0) { acc[col - c0] += cover * STEP; any = true; }
            }
          }
        }
        if (!any) continue;
        var off = row * cols;
        for (var c = c0; c <= c1; c++) {
          if (acc[c - c0] === 0) continue;
          var v = data[off + c] + Math.round(acc[c - c0]);
          data[off + c] = v > 255 ? 255 : v;
        }
      }
    }
    return { data: data, cols: cols, rows: rows, cell: px, left: left, top: top };
  }

  // ==== basin distance field
  // Signed distance to the basin outline on the terrain grid, clamped to +/- range.
  function distanceField(outline, grid, range) {
    var n = grid.cols * grid.rows, d = new Float32Array(n), i;
    for (i = 0; i < n; i++) d[i] = grid.mask[i] ? range : -range;
    var cell = grid.cell, reach = Math.ceil(range / cell) + 1, xy = outline.xy;
    for (var r = 0; r < outline.ringStart.length - 1; r++) {
      var s = outline.ringStart[r], e = outline.ringStart[r + 1];
      for (i = s; i < e; i++) {
        var j = i + 1 < e ? i + 1 : s;
        var ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1];
        var c0 = Math.max(0, Math.floor((Math.min(ax, bx) - grid.left) / cell) - reach);
        var c1 = Math.min(grid.cols - 1, Math.floor((Math.max(ax, bx) - grid.left) / cell) + reach);
        var r0 = Math.max(0, Math.floor((grid.top - Math.max(ay, by)) / cell) - reach);
        var r1 = Math.min(grid.rows - 1, Math.floor((grid.top - Math.min(ay, by)) / cell) + reach);
        var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        for (var row = r0; row <= r1; row++) {
          var y = grid.top - (row + 0.5) * cell;
          for (var col = c0; col <= c1; col++) {
            var x = grid.left + (col + 0.5) * cell;
            var t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            var ex = x - ax - t * dx, ey = y - ay - t * dy, dist = Math.sqrt(ex * ex + ey * ey);
            var o = row * grid.cols + col;
            if (dist < Math.abs(d[o])) d[o] = grid.mask[o] ? dist : -dist;
          }
        }
      }
    }
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) out[i] = Math.round((d[i] / (2 * range) + 0.5) * 255);
    return out;
  }

  // ==== lines
  // Segments draped on the terrain, as x,y,z,x,y,z per segment.
  function drape(xy, starts, closed, grid, step) {
    var parts = starts.length - 1, count = 0, p, i;
    function each(fn) {
      for (p = 0; p < parts; p++) {
        var s = starts[p], e = starts[p + 1], last = closed ? e : e - 1;
        for (i = s; i < last; i++) {
          var j = i + 1 < e ? i + 1 : s;
          var ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1];
          var n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
          fn(ax, ay, bx, by, n);
        }
      }
    }
    each(function (ax, ay, bx, by, n) { count += n; });
    var out = new Float32Array(count * 6), o = 0;
    each(function (ax, ay, bx, by, n) {
      var px = ax, py = ay, pz = grid.height(ax, ay);
      for (var k = 1; k <= n; k++) {
        var qx = ax + (bx - ax) * k / n, qy = ay + (by - ay) * k / n, qz = grid.height(qx, qy);
        out[o++] = px; out[o++] = py; out[o++] = pz;
        out[o++] = qx; out[o++] = qy; out[o++] = qz;
        px = qx; py = qy; pz = qz;
      }
    });
    return out;
  }

  POYO.geom = { Grid: Grid, localXY: localXY, polygonSet: polygonSet, ringArea: ringArea,
                polygonMoments: polygonMoments, triangulate: triangulate,
                rasterCoverage: rasterCoverage, distanceField: distanceField, drape: drape };
})();
