// trees.js: illustrative trees, made on demand from the land colour class grids.
// Nothing is made at load and nothing is stored in the data folder. The same seed,
// area and settings always give the same trees.
"use strict";
(function () {
  var L = POYO.layers, S = POYO.styles, R = POYO.render, ID = POYO.ID;
  var LABEL = "Illustrative trees, random placement, not an inventory.";
  var BIN = 500;                      // metres, for skipping trees outside a tile
  var DRAFT = 60000;                  // most trees drawn while the view is moving
  var SOURCES = [["planned", "Planned use"], ["observed", "Observed cover SIOSE 2014"], ["crops", "Crop types"]];

  // [mode, per hectare, height from, height to, crown from, crown to, on]
  var OFF = ["random", 50, 3, 7, 2, 4, false];
  var DEFAULTS = {
    planned: {
      "Forest common": ["random", 200, 6, 10, 3, 6, true],
      "Natural protected municipal": ["random", 120, 4, 9, 3, 5, true],
      "Natural protected by law": ["random", 120, 4, 9, 3, 5, true],
      "Green space": ["random", 80, 4, 8, 3, 6, true],
      "Watercourse corridor": ["random", 100, 3, 8, 2, 5, true],
      "Agricultural common": ["random", 30, 3, 6, 2, 4, false],
      "Agricultural protected": ["random", 30, 3, 6, 2, 4, false]
    },
    observed: {
      CNF: ["random", 250, 6, 12, 3, 5, true], FDP: ["random", 250, 6, 12, 4, 7, true],
      MTR: ["random", 150, 1, 3, 1, 3, true], ZAU: ["random", 80, 4, 8, 3, 6, true],
      LFC: ["random", 280, 2.5, 4, 2.5, 3.5, true], LFN: ["random", 280, 2.5, 4, 2.5, 3.5, true],
      LOL: ["random", 280, 2.5, 4, 2.5, 3.5, true], LOC: ["random", 280, 2.5, 4, 2.5, 3.5, true],
      LVI: ["random", 280, 0.8, 1.5, 0.8, 1.5, false]
    },
    crops: {
      "Citrus": ["random", 280, 2.5, 4, 2.5, 3.5, true], "Fruit trees": ["random", 280, 2.5, 4.5, 2.5, 4, true],
      "Nut trees": ["random", 280, 3, 5, 3, 4.5, true], "Olive groves": ["random", 280, 3, 5, 3, 4.5, true],
      "Mixed tree crops": ["random", 280, 3, 5, 3, 4.5, true], "Forest": ["random", 200, 6, 10, 3, 6, true],
      "Pasture and scrub": ["random", 60, 1, 3, 1, 2.5, false], "Vineyard": ["random", 280, 0.8, 1.5, 0.8, 1.5, false]
    }
  };

  function count(n) { return Math.round(n).toLocaleString("en-US"); }

  // ==== classes ================================================================
  function keyOfClass(source, c) { return source === "planned" ? c.name : source === "observed" ? c.cover : c.type; }

  // One entry per selectable class of a source, with the grid values it covers.
  function classList(manifest, source) {
    var entry = manifest.entries[L.GRID_OF[source]], out = [], by = {};
    if (!entry) return out;
    entry.classes.forEach(function (c) {
      var key = keyOfClass(source, c);
      if (!by[key]) {
        var label = key;
        if (source === "planned") label = c.label || c.name;
        if (source === "observed") {
          label = L.SIOSE[key] ? L.SIOSE[key][0] + " (" + key + ")" : key === "mixed" ? "Mixed cover" : key;
        }
        by[key] = { key: key, label: label, indices: [] };
        out.push(by[key]);
      }
      by[key].indices.push(c.index);
    });
    out.forEach(function (k, i) { k.def = DEFAULTS[source][k.key] || OFF; k.at = i; });
    out.sort(function (a, b) { return (b.def[6] ? 1 : 0) - (a.def[6] ? 1 : 0) || a.at - b.at; });
    return out;
  }

  // Enabled classes of a settings object as state entries. An empty list means the defaults.
  function entries(manifest, t) {
    if (t.classes.length) return t.classes;
    return classList(manifest, t.source).filter(function (k) { return k.def[6]; })
      .map(function (k) { return [k.key].concat(k.def.slice(0, 6)); });
  }

  // Grid value to rule, or nothing.
  function rules(manifest, t) {
    var by = {}, out = [];
    classList(manifest, t.source).forEach(function (k) { by[k.key] = k.indices; });
    function n(v, lo, hi, d) { v = Number(v); return isFinite(v) ? POYO.clamp(v, lo, hi) : d; }
    entries(manifest, t).forEach(function (e) {
      var h0 = n(e[3], 0.3, 40, 4), c0 = n(e[5], 0.3, 25, 3);
      var rule = { grid: e[1] === "grid", density: n(e[2], 0, 2000, 0), h0: h0, h1: n(e[4], h0, 40, h0),
                   c0: c0, c1: n(e[6], c0, 25, c0) };
      (by[e[0]] || []).forEach(function (i) { out[i] = rule; });
    });
    return out;
  }

  // ==== chance, the same on every computer ====================================
  function random(seed, a, b, k) {
    var h = (seed ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ (a | 0), 0x85ebca6b); h ^= h >>> 13;
    h = Math.imul(h ^ (b | 0), 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ (k | 0), 0x27d4eb2f); h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ==== area ==================================================================
  // The section box when it shows its inside, else the ground the sheet covers.
  function areaFor(app) {
    var s = app.state, f = app.frame, b = s.box;
    if (b.enabled && POYO.state.boxIsSet(b) && b.mode !== "inside") {
      return { rect: [b.min[0], b.min[1], b.max[0], b.max[1]], from: "section box" };
    }
    var v = s.view;
    if (v.elevation < 0.5) {
      return { error: "In an elevation, draw a section box first, or switch to plan or an isometric view." };
    }
    var mm = POYO.state.paperSize(s.sheet), halfW = mm[0] / 2000 * v.scale, halfH = mm[1] / 2000 * v.scale;
    var basis = POYO.camera.basis(v.azimuth, v.elevation), t = v.target, xs = [], ys = [];
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) {
      var px = t[0] + basis.r[0] * k[0] * halfW + basis.u[0] * k[1] * halfH;
      var py = t[1] + basis.r[1] * k[0] * halfW + basis.u[1] * k[1] * halfH;
      var pz = t[2] * v.ve + basis.r[2] * k[0] * halfW + basis.u[2] * k[1] * halfH;
      var step = (t[2] * v.ve - pz) / basis.f[2];
      xs.push(px + basis.f[0] * step); ys.push(py + basis.f[1] * step);
    });
    return { rect: [Math.floor(Math.min.apply(null, xs) + f.cx), Math.floor(Math.min.apply(null, ys) + f.cy),
                    Math.ceil(Math.max.apply(null, xs) + f.cx), Math.ceil(Math.max.apply(null, ys) + f.cy)],
             from: "current view" };
  }

  function localRect(scene, area) {
    var f = scene.frame;
    return [area[0] - f.cx, area[1] - f.cy, area[2] - f.cx, area[3] - f.cy];
  }

  // Expected number before buildings, roads and water are taken out.
  function estimate(scene, manifest, t, area) {
    var counts = L.countGrid(scene, L.GRID_OF[t.source], { rect: localRect(scene, area), inside: false });
    var total = 0, spacing = Math.max(2, t.grid_m);
    rules(manifest, t).forEach(function (rule, i) {
      if (rule && counts[i]) total += counts[i] * 25 * (rule.grid ? 1 / (spacing * spacing) : rule.density / 10000);
    });
    return total;
  }

  // ==== places that stay clear ================================================
  // Buildings, roads and river polygons as a yes or no raster over the area.
  function mask(scene, rect) {
    var res = Math.max(1, Math.sqrt((rect[2] - rect[0]) * (rect[3] - rect[1]) / 16e6));
    var cols = Math.ceil((rect[2] - rect[0]) / res) + 1, rows = Math.ceil((rect[3] - rect[1]) / res) + 1;
    var data = new Uint8Array(cols * rows), left = rect[0], top = rect[3];
    function mark(x, y) {
      var c = Math.floor((x - left) / res), r = Math.floor((top - y) / res);
      if (c >= 0 && r >= 0 && c < cols && r < rows) data[r * cols + c] = 1;
    }
    function polygons(set, skip) {
      var xy = set.xy;
      for (var p = 0; p < set.count; p++) {
        if (skip && skip[set.polyFeature[p]]) continue;
        var first = set.polyRing[p], last = set.polyRing[p + 1];
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
        for (i = set.ringStart[first]; i < set.ringStart[first + 1]; i++) {
          var x = xy[2 * i], y = xy[2 * i + 1];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < rect[0] || x0 > rect[2] || y1 < rect[1] || y0 > rect[3]) continue;
        var r0 = Math.max(0, Math.ceil((top - y1) / res - 0.5)), r1 = Math.min(rows - 1, Math.floor((top - y0) / res - 0.5));
        var cross = [];
        for (var q = r0; q <= r1; q++) cross.push([]);
        for (var ring = first; ring < last; ring++) {
          var s = set.ringStart[ring], e = set.ringStart[ring + 1];
          for (i = s; i < e; i++) {
            var j = i + 1 < e ? i + 1 : s;
            var ax = xy[2 * i], ay = xy[2 * i + 1], bx = xy[2 * j], by = xy[2 * j + 1];
            // the outline itself, so that thin shapes are not missed
            if (!(Math.max(ax, bx) < rect[0] || Math.min(ax, bx) > rect[2] ||
                  Math.max(ay, by) < rect[1] || Math.min(ay, by) > rect[3])) {
              var n = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / (res * 0.5)) || 1;
              for (var k = 0; k <= n; k++) mark(ax + (bx - ax) * k / n, ay + (by - ay) * k / n);
            }
            if (ay === by) continue;
            var lo = Math.min(ay, by), hi = Math.max(ay, by);
            var a = Math.max(r0, Math.ceil((top - hi) / res - 0.5)), z = Math.min(r1, Math.floor((top - lo) / res - 0.5));
            for (var row = a; row <= z; row++) {
              var yc = top - (row + 0.5) * res;
              if (yc > lo && yc <= hi) cross[row - r0].push(ax + (yc - ay) * (bx - ax) / (by - ay));
            }
          }
        }
        for (var m = 0; m < cross.length; m++) {
          var xs = cross[m].sort(function (u, v) { return u - v; });
          for (var u = 0; u + 1 < xs.length; u += 2) {
            var c0 = Math.max(0, Math.ceil((xs[u] - left) / res - 0.5));
            var c1 = Math.min(cols - 1, Math.floor((xs[u + 1] - left) / res - 0.5));
            if (c1 >= c0) data.fill(1, (r0 + m) * cols + c0, (r0 + m) * cols + c1 + 1);
          }
        }
      }
    }
    if (scene.buildings) polygons(scene.buildings.set);
    if (scene.fills.rivers) polygons(scene.fills.rivers.set);
    var roads = L.store(scene).roads;
    if (roads) polygons(roads.set, roads.tunnel);
    return { res: res, at: function (x, y) {
      var c = Math.floor((x - left) / res), r = Math.floor((top - y) / res);
      return c >= 0 && r >= 0 && c < cols && r < rows && data[r * cols + c] === 1;
    } };
  }

  // ==== making the trees ======================================================
  function refusal(n, cap, what) {
    return what + " " + count(n) + " trees, over the limit of " + count(cap) +
           ". Shrink the section box, zoom in or lower the density. No trees were made.";
  }

  function generate(scene, manifest, t) {
    var g = L.store(scene).grids[L.GRID_OF[t.source]], area = t.area;
    var expected = estimate(scene, manifest, t, area);
    if (expected > t.cap) return { count: 0, refused: refusal(expected, t.cap, "About") };
    var rect = localRect(scene, area), table = rules(manifest, t), seed = t.seed;
    var found = [], clear = null, removed = 0;
    function place(x, y, rule, u, v, tint) {
      if (x < rect[0] || x >= rect[2] || y < rect[1] || y >= rect[3]) return;
      var h = rule.h0 + (rule.h1 - rule.h0) * u, crown = rule.c0 + (rule.c1 - rule.c0) * (0.7 * u + 0.3 * v);
      if (!clear) clear = mask(scene, rect);
      var d = crown / 4;
      if (clear.at(x, y) || clear.at(x - d, y) || clear.at(x + d, y) || clear.at(x, y - d) || clear.at(x, y + d)) {
        removed++;
        return;
      }
      found.push(x, y, scene.grids.terrain_10m.height(x, y), h, crown, tint);
    }
    var cell = g.cell;
    var c0 = Math.max(0, Math.floor((rect[0] - g.left) / cell)), c1 = Math.min(g.cols, Math.ceil((rect[2] - g.left) / cell));
    var r0 = Math.max(0, Math.floor((g.top - rect[3]) / cell)), r1 = Math.min(g.rows, Math.ceil((g.top - rect[1]) / cell));
    var gridded = false;
    for (var r = r0; r < r1; r++) {
      for (var c = c0; c < c1; c++) {
        var rule = table[g.data[r * g.cols + c]];
        if (!rule) continue;
        if (rule.grid) { gridded = true; continue; }
        var mean = rule.density * cell * cell / 10000, n = Math.floor(mean);
        if (random(seed, c, r, 0) < mean - n) n++;
        for (var i = 0; i < n; i++) {
          var k = 5 * i + 1;
          place(g.left + (c + random(seed, c, r, k)) * cell, g.top - (r + random(seed, c, r, k + 1)) * cell, rule,
                random(seed, c, r, k + 2), random(seed, c, r, k + 3), random(seed, c, r, k + 4));
        }
      }
    }
    // orchards: a regular grid tied to the coordinate system, so a moved box keeps the rows
    var step = Math.max(2, t.grid_m), f = scene.frame, other = seed ^ 0x5bd1e995;
    if (gridded || table.some(function (q) { return q && q.grid; })) {
      for (var gy = Math.ceil(area[1] / step); gy * step < area[3]; gy++) {
        var y = gy * step - f.cy, row = Math.floor((g.top - y) / cell);
        if (row < 0 || row >= g.rows) continue;
        for (var gx = Math.ceil(area[0] / step); gx * step < area[2]; gx++) {
          var x = gx * step - f.cx, col = Math.floor((x - g.left) / cell);
          if (col < 0 || col >= g.cols) continue;
          var q = table[g.data[row * g.cols + col]];
          if (q && q.grid) place(x, y, q, random(other, gx, gy, 1), random(other, gx, gy, 2), random(other, gx, gy, 3));
        }
      }
    }
    var total = found.length / 6;
    if (total > t.cap) return { count: 0, refused: refusal(total, t.cap, "This gives") };
    // shuffled with the seed, then sorted into squares: any first part of a square is spread over it
    var order = new Uint32Array(total), j, swap;
    for (j = 0; j < total; j++) order[j] = j;
    for (j = total - 1; j > 0; j--) {
      var pick = Math.floor(random(seed, j, 7, 7) * (j + 1));
      swap = order[j]; order[j] = order[pick]; order[pick] = swap;
    }
    var squares = {}, keys = [];
    for (j = 0; j < total; j++) {
      var at = order[j] * 6, name = Math.floor(found[at] / BIN) + "," + Math.floor(found[at + 1] / BIN);
      if (!squares[name]) { squares[name] = []; keys.push(name); }
      squares[name].push(at);
    }
    var data = new Float32Array(total * 6), bins = [], w = 0;
    keys.forEach(function (name) {
      var box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], start = w / 6;
      squares[name].forEach(function (a) {
        for (var v = 0; v < 6; v++) data[w + v] = found[a + v];
        var half = found[a + 4] / 2 + 1;
        box[0] = Math.min(box[0], found[a] - half); box[3] = Math.max(box[3], found[a] + half);
        box[1] = Math.min(box[1], found[a + 1] - half); box[4] = Math.max(box[4], found[a + 1] + half);
        box[2] = Math.min(box[2], found[a + 2] - 1); box[5] = Math.max(box[5], found[a + 2] + found[a + 3] + 1);
        w += 6;
      });
      bins.push({ start: start, count: squares[name].length, box: box });
    });
    return { count: total, removed: removed, data: data, bins: bins, expected: expected };
  }

  function signature(state) {
    var t = state.trees;
    return JSON.stringify([t.source, t.seed, t.cap, t.grid_m, t.area, t.classes]);
  }
  function release(scene) {
    var now = scene.trees;
    if (now && now.vao) { scene.gl.deleteVertexArray(now.vao); scene.gl.deleteBuffer(now.buffer); }
    scene.trees = null;
  }
  function ready(scene, state) {
    var s = L.store(scene);
    return !!(s.roads && s.grids[L.GRID_OF[state.trees.source]]);
  }
  function stale(scene, state) {
    return !!(state.trees.on && !(scene.trees && scene.trees.key === signature(state)));
  }
  function build(scene, manifest, state) {
    if (!stale(scene, state) || !ready(scene, state)) return;
    release(scene);
    var started = performance.now(), made = generate(scene, manifest, state.trees);
    made.key = signature(state);
    made.ms = performance.now() - started;
    scene.trees = made;
  }

  // ==== drawing ===============================================================
  var VS = [
    "layout(location=0) in vec4 aPos; layout(location=1) in vec3 iBase; layout(location=2) in vec3 iSize;",
    "uniform mat4 uMat; uniform vec4 uTile; uniform vec3 uCentre; uniform float uVe, uGrow, uGrowZ, uRound;",
    "out vec3 vRel; out vec3 vWorld; out vec3 vNormal; flat out float vTint; flat out float vPart;",
    "void main(){",
    "  float h = iSize.x, crown = iSize.y, tall = min(h * 0.75, crown * 1.2), wide = crown;",
    "  if (uRound > 0.5) { wide = min(crown, h * 0.9); tall = wide; }",
    "  vec3 p;",
    "  if (aPos.w < 0.5) {",
    "    float r = max(0.08, crown * 0.07) + uGrow;",
    "    p = vec3(aPos.xy * r, aPos.z * (h - tall * 0.7 + 0.4) - 0.4);",
    "  } else p = vec3(aPos.xy * (wide * 0.5 + uGrow), h - tall * 0.5 + aPos.z * (tall * 0.5 + uGrowZ));",
    "  vNormal = vec3(aPos.xy / wide, aPos.z / (tall * uVe));",
    "  vWorld = iBase + p; vTint = iSize.z; vPart = aPos.w < 0.5 ? 0.0 : (uRound > 0.5 ? 2.0 : 1.0);",
    "  vRel = vec3(vWorld.xy - uCentre.xy, vWorld.z * uVe);",
    "  vec4 q = uMat * vec4(vWorld, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z, 1.0);",
    "}"].join("\n");

  var FS = [S.CLIP, S.ENCODE,
    "in vec3 vRel; in vec3 vWorld; in vec3 vNormal; flat in float vTint; flat in float vPart;",
    "uniform vec3 uCrown, uTrunk, uWhite, uLine, uLight, uToViewer; uniform vec4 uPaper;",
    "uniform float uXray; uniform int uStyle;",
    "void main(){",
    "  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));",
    "  if (clipped(vWorld)) discard;",
    "  if (dot(n, uToViewer) < 0.0) n = -n;",
    "  if (vPart > 1.5) n = normalize(vNormal);",
    "#ifdef GBUF",
    "  frag = encode(n, 3u);",
    "#else",
    "  vec3 base = vPart < 0.5 ? uTrunk : uCrown * (0.92 + 0.16 * vTint);",
    "  float lit = max(dot(n, uLight), 0.0), edge = 1.0 - abs(dot(n, uToViewer));",
    "  if (uStyle == 0) frag = vec4(base * (0.62 + 0.38 * lit), 1.0);",
    "  else if (uStyle == 1) frag = vec4(base, 1.0);",
    "  else if (uStyle == 2) frag = vec4(uWhite * (0.78 + 0.2 * lit), 1.0);",
    "  else if (uStyle == 3 || uStyle == 4) frag = uPaper;",
    "  else if (uStyle == 5) frag = vec4(base, 0.8);",
    "  else if (uStyle == 6) frag = vec4(base, clamp(uXray * mix(0.5, 1.3, edge * edge), 0.0, 1.0));",
    "  else frag = vec4(uLine, 1.0);",
    "#endif",
    "}"].join("\n");

  // Unit shapes: a five sided trunk with an icosahedron crown (polygon), or with the
  // same icosahedron split and pushed out to the ball (sphere, split twice where a crown
  // is large in the picture so that its edge stays round). Each has its edges.
  var shape = (function () {
    var trunk = [], i;
    for (i = 0; i < 5; i++) {
      var a = i * 2 * Math.PI / 5, b = (i + 1) * 2 * Math.PI / 5;
      var A = [Math.cos(a), Math.sin(a)], B = [Math.cos(b), Math.sin(b)];
      trunk.push(A[0], A[1], 0, 0, B[0], B[1], 0, 0, B[0], B[1], 1, 0,
                 A[0], A[1], 0, 0, B[0], B[1], 1, 0, A[0], A[1], 1, 0);
    }
    var t = (1 + Math.sqrt(5)) / 2, k = 1 / Math.sqrt(1 + t * t);
    var V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
             [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(function (p) { return [p[0] * k, p[1] * k, p[2] * k]; });
    var F = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
             3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    var ball = V.slice(), made = {};
    function middle(u, w) {
      var name = Math.min(u, w) + "," + Math.max(u, w);
      if (made[name] === undefined) {
        var m = [ball[u][0] + ball[w][0], ball[u][1] + ball[w][1], ball[u][2] + ball[w][2]];
        var len = Math.hypot(m[0], m[1], m[2]);
        made[name] = ball.push([m[0] / len, m[1] / len, m[2] / len]) - 1;
      }
      return made[name];
    }
    function split(faces) {
      var out = [];
      for (var f = 0; f < faces.length; f += 3) {
        var p = faces[f], q = faces[f + 1], r = faces[f + 2], pq = middle(p, q), qr = middle(q, r), rp = middle(r, p);
        out.push(p, pq, rp, q, qr, pq, r, rp, qr, pq, qr, rp);
      }
      return out;
    }
    var G = split(F), H = split(G);
    var all = [];
    function put(v) { all.push(v[0], v[1], v[2], 1); }
    function one(verts, faces) {
      var solid = all.length / 4, seen = {}, i, j;
      Array.prototype.push.apply(all, trunk);
      faces.forEach(function (v) { put(verts[v]); });
      var lines = all.length / 4;
      for (i = 0; i < faces.length; i += 3) {
        for (j = 0; j < 3; j++) {
          var u = faces[i + j], w = faces[i + (j + 1) % 3], name = Math.min(u, w) + "," + Math.max(u, w);
          if (!seen[name]) { seen[name] = true; put(verts[u]); put(verts[w]); }
        }
      }
      all.push(0, 0, 0, 0, 0, 0, 1, 0);
      return { first: solid, solid: lines - solid, line: lines, lines: all.length / 4 - lines };
    }
    var polygon = one(V, F), sphere = one(ball, G), round = one(ball, H);
    return { all: new Float32Array(all), polygon: polygon, sphere: sphere, round: round };
  })();

  function programs(scene) {
    if (!scene.treePrograms) {
      var gl = scene.gl, head = R.HEAD, g = head.replace("#version 300 es\n", "#version 300 es\n#define GBUF\n");
      var mesh = R.buffer(gl, gl.ARRAY_BUFFER, shape.all);
      scene.treePrograms = { solid: R.compile(gl, head + VS, head + FS), g: R.compile(gl, g + VS, g + FS), mesh: mesh };
    }
    return scene.treePrograms;
  }

  function vao(scene) {
    var now = scene.trees, gl = scene.gl;
    if (!now.vao) {
      var P = programs(scene);
      now.vao = gl.createVertexArray();
      gl.bindVertexArray(now.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, P.mesh);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      now.buffer = R.buffer(gl, gl.ARRAY_BUFFER, now.data);
      [1, 2].forEach(function (i) { gl.enableVertexAttribArray(i); gl.vertexAttribDivisor(i, 1); });
      gl.bindVertexArray(null);
    }
    return now;
  }

  function draw(c, g, tile, style) {
    var gl = c.gl, K = c.look, v = c.state.view, now = vao(c.scene), P = programs(c.scene);
    var p = g ? P.g : P.solid, wire = style === 5;
    gl.useProgram(p.p);
    S.camera(gl, p, c, tile); S.box3(gl, p, c);
    var grow = style === 7 ? Math.max(1, K.outline_mm * c.o.pxPerMm) * c.o.mpp : 0;
    gl.uniform3f(p.u.uCentre, v.target[0], v.target[1], 0);
    gl.uniform1f(p.u.uVe, v.ve);
    gl.uniform1f(p.u.uGrow, grow);
    gl.uniform1f(p.u.uGrowZ, grow / v.ve);
    gl.uniform3fv(p.u.uCrown, S.rgb(K.tree_crown));
    gl.uniform3fv(p.u.uTrunk, S.rgb(K.tree_trunk));
    gl.uniform3fv(p.u.uWhite, S.rgb(K.white_building));
    gl.uniform3fv(p.u.uLine, S.rgb(K.outline_colour));
    gl.uniform3fv(p.u.uLight, c.light);
    gl.uniform3fv(p.u.uToViewer, c.toViewer);
    gl.uniform4fv(p.u.uPaper, S.paper(c));
    gl.uniform1f(p.u.uXray, K.xray_alpha);
    gl.uniform1i(p.u.uStyle, style);
    gl.uniform1f(p.u.uRound, K.tree_shape === "sphere" ? 1 : 0);
    // a 4 m crown more than 24 pixels wide gets the rounder ball
    var part = K.tree_shape !== "sphere" ? shape.polygon : !wire && 4 / c.o.mpp > 24 ? shape.round : shape.sphere;
    var moving = c.o.cell === 20 && POYO.app && POYO.app.moving;
    var share = moving && now.count > DRAFT ? DRAFT / now.count : 1;
    gl.bindVertexArray(now.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, now.buffer);
    now.bins.forEach(function (bin) {
      if (!S.inView(c, tile, bin.box)) return;
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, bin.start * 24);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, bin.start * 24 + 12);
      var n = Math.ceil(bin.count * share);
      if (wire) gl.drawArraysInstanced(gl.LINES, part.line, part.lines, n);
      else gl.drawArraysInstanced(gl.TRIANGLES, part.first, part.solid, n);
    });
    gl.bindVertexArray(null);
  }

  // Called by the renderer for every picture. Null when there are no trees to draw.
  function prepare(c) {
    var s = c.state, now = c.scene.trees;
    if (!s.trees.on || !now || !now.count || now.key !== signature(s)) return null;
    var style = S.CODE[c.look.trees];
    if (style === 5) {
      return { see: function (g, tile) { c.gl.depthMask(false); draw(c, false, tile, 5); c.gl.depthMask(true); } };
    }
    if (style === 6) {
      return { glass: function (g, tile) { c.gl.depthMask(false); draw(c, false, tile, 6); c.gl.depthMask(true); } };
    }
    return { solid: function (g, tile) {
      var gl = c.gl;
      if (!g && (style === 3 || style === 4)) {          // a shell turned inside out draws the outline
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
        draw(c, false, tile, 7);
        gl.cullFace(gl.BACK); gl.disable(gl.CULL_FACE);
      }
      draw(c, g, tile, style);
    } };
  }

  // ==== legend ================================================================
  function inside(scene, state) {
    var area = L.region(scene, state), now = scene.trees;
    if (!area.rect || area.inside) return true;
    var r = area.rect;
    return now.bins.some(function (bin) {
      for (var i = bin.start * 6, end = i + bin.count * 6; i < end; i += 6) {
        var x = now.data[i], y = now.data[i + 1];
        if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) return true;
      }
      return false;
    });
  }

  function legend(scene, manifest, state) {
    var now = scene && scene.trees;
    if (!state.trees.on || !now || !now.count || now.key !== signature(state) || !inside(scene, state)) return [];
    var K = state.look, style = K.trees, lined = style === "outline" || style === "contours" || style === "wireframe";
    var notes = [LABEL], table = rules(manifest, state.trees);
    if (table.some(function (q) { return q && q.grid; })) {
      notes.push("Orchard classes use a regular planting grid of " + POYO.fmt(state.trees.grid_m, state.trees.grid_m % 1 ? 1 : 0) + " m.");
    }
    return [{ heading: "Trees", entries: [{
      label: "Illustrative tree",
      colour: lined ? state.sheet.paper_colour : style === "white" ? K.white_building : K.tree_crown,
      border: lined ? K.outline_colour : null, alpha: 1 }], notes: notes }];
  }

  // ==== panel =================================================================
  var ui = POYO.ui, K = ui.kit;
  function app() { return K.app(); }
  function T() { return app().state.trees; }

  // The panel edits a draft. It reaches the picture only through Generate trees.
  var draft = null, synced = "", message = "", said = "", counted = { key: "", text: "" }, waiting = 0;

  function rowsFor(source, chosen) {
    var by = {};
    (chosen || []).forEach(function (e) { by[e[0]] = e; });
    return classList(app().manifest, source).map(function (k) {
      var e = by[k.key], d = e ? e.slice(1) : k.def;
      return { key: k.key, label: k.label, on: chosen && chosen.length ? !!e : k.def[6],
               mode: d[0], density: d[1], h0: d[2], h1: d[3], c0: d[4], c1: d[5] };
    });
  }
  function sync() {
    var key = signature(app().state);
    if (draft && synced === key) return;
    var t = T();
    synced = key;
    draft = { source: t.source, seed: t.seed, cap: t.cap, grid_m: t.grid_m, rows: rowsFor(t.source, t.classes) };
  }
  function settings(area) {
    return { on: true, seed: Math.round(draft.seed), cap: Math.round(draft.cap), source: draft.source,
             grid_m: draft.grid_m, area: area,
             classes: draft.rows.filter(function (r) { return r.on; }).map(function (r) {
               return [r.key, r.mode, r.density, r.h0, Math.max(r.h0, r.h1), r.c0, Math.max(r.c0, r.c1)];
             }) };
  }
  function needed(source) {
    var a = app();
    return Promise.all([L.load(a.scene, a.manifest, "roads"), L.load(a.scene, a.manifest, L.GRID_OF[source])]);
  }
  // a message belongs to the area and settings it was said about
  function about() { return JSON.stringify([draft, areaFor(app())]); }
  function say(text) { message = text; said = about(); ui.refresh(); }

  // Returns a promise so that tests can wait for it.
  function make() {
    sync();
    var a = app(), area = areaFor(a);
    if (area.error) { message = ""; ui.refresh(); return Promise.resolve(false); }   // the line above already says why
    var next = settings(area.rect);
    if (!next.classes.length) { say("Select at least one class."); return Promise.resolve(false); }
    say("Reading data");
    return needed(next.source).then(function () {
      var expected = estimate(a.scene, a.manifest, next, area.rect);
      if (expected > next.cap) { say(refusal(expected, next.cap, "About")); return false; }
      if (expected < 0.5) { say("None of the selected classes lies in this area. No trees were made."); return false; }
      say("Making trees");
      return new Promise(function (done) {
        setTimeout(function () {                 // let the message appear first
          a.state.trees = next;
          POYO.state.sanitise(a.state);
          build(a.scene, a.manifest, a.state);
          synced = signature(a.state);
          message = "";
          a.changed();
          ui.rebuild();
          done(true);
        }, 30);
      });
    }).catch(function (e) { console.error(e); say("Not made: " + e.message); return false; });
  }

  function clear() {
    var a = app();
    sync();
    a.state.trees.on = false;
    a.state.trees.area = [];
    release(a.scene);
    synced = signature(a.state);
    message = "";
    a.changed();
    ui.rebuild();
  }

  // Area and expected number, counted a moment after the view comes to rest.
  function before() {
    var a = app(), area = areaFor(a);
    if (area.error) return area.error;
    var next = settings(area.rect), r = area.rect;
    var key = JSON.stringify([next.source, next.classes, next.grid_m, next.cap, r]);
    if (key === counted.key) return counted.text;
    clearTimeout(waiting);
    waiting = setTimeout(function () {
      needed(next.source).then(function () {
        var n = estimate(a.scene, a.manifest, next, r);
        counted = { key: key, text: "Area: " + POYO.fmt((r[2] - r[0]) * (r[3] - r[1]) / 1e6, 2) + " km² (" + area.from +
          "). About " + count(n) + " trees before buildings, roads and water are removed. Limit " + count(next.cap) + "." +
          (n > next.cap ? " Over the limit: shrink the section box, zoom in or lower the density." : "") };
        ui.refresh();
      }).catch(function (e) { counted = { key: key, text: "Not counted: " + e.message }; ui.refresh(); });
    }, 250);
    return "Counting";
  }

  function after() {
    var now = app().scene && app().scene.trees;
    if (message && said === about()) return message;
    if (!T().on || !now || now.key !== signature(app().state)) return "";
    if (now.refused) return now.refused;
    return "On the sheet: " + count(now.count) + " trees in " + (now.ms < 950 ? "under 1" : POYO.fmt(now.ms / 1000, 1)) + " s. " +
           count(now.removed) + " places on buildings, roads or water were left empty.";
  }

  function field(row, key, min, max, step) {
    return { get: function () { return row()[key]; }, set: function (v) { row()[key] = v; },
             min: min, max: max, step: step };
  }

  ui.PANELS.trees = { title: "Trees", make: function (p) {
    sync();
    function D() { return draft; }
    p.appendChild(K.note(LABEL));
    p.appendChild(K.live(before));
    p.appendChild(K.buttons(K.button("Generate trees", make), K.button("Clear trees", clear)));
    p.appendChild(K.live(after));
    p.appendChild(K.heading("Settings"));
    p.appendChild(K.select("Place on", SOURCES, { get: function () { return draft.source; }, set: function (v) {
      draft.source = v; draft.rows = rowsFor(v, null); message = ""; setTimeout(ui.rebuild, 0);
    } }));
    p.appendChild(K.number("Random seed", field(D, "seed", 0, 999999999, 1)));
    p.appendChild(K.number("Most trees", field(D, "cap", 100, 2000000, 1000)));
    p.appendChild(K.when(function () { return draft.rows.some(function (r) { return r.on && r.mode === "grid"; }); },
      K.number("Orchard grid m", field(D, "grid_m", 2, 50, 0.5))));
    p.appendChild(K.heading("Classes"));
    draft.rows.forEach(function (r, i) {
      function row() { return draft.rows[i] || r; }
      p.appendChild(K.check(r.label, field(row, "on")));
      p.appendChild(K.when(function () { return row().on; },
        K.select("Placing", [["random", "Random"], ["grid", "Orchard grid"]], field(row, "mode")),
        K.when(function () { return row().mode === "random"; }, K.number("Trees per hectare", field(row, "density", 0, 2000, 10))),
        K.number("Height from m", field(row, "h0", 0.3, 40, 0.5)), K.number("Height to m", field(row, "h1", 0.3, 40, 0.5)),
        K.number("Crown from m", field(row, "c0", 0.3, 25, 0.5)), K.number("Crown to m", field(row, "c1", 0.3, 25, 0.5))));
    });
    p.appendChild(K.heading("Appearance"));
    p.appendChild(K.select("Crown shape", [["polygon", "Polygon, flat faces"], ["sphere", "Sphere"]],
      K.prop(function () { return app().state.look; }, "tree_shape")));
    p.appendChild(K.styleSelect("Style", "trees"));
    function look(key) { return K.prop(function () { return app().state.look; }, key); }
    p.appendChild(K.colour("Crown", look("tree_crown")));
    p.appendChild(K.colour("Trunk", look("tree_trunk")));
    p.appendChild(K.note("Press Generate trees again after changing settings or the area. The section box cuts the trees without a cut face."));
  } };

  ui.extraRail.push({ section: "Trees" });
  ui.extraRail.push({ key: "trees", title: "Trees", visible: {
    get: function () { return T().on; },
    set: function (v) { if (v) make(); else clear(); }
  }, meta: function () {
    var now = app().scene && app().scene.trees;
    return T().on && now ? (now.refused ? "over limit" : count(now.count)) : "off";
  } });

  ui.noteExtra.push(function (tab) {
    tab.appendChild(K.heading("Trees"));
    tab.appendChild(K.note(LABEL + " They are placed at random on 5 m land colour cells of the chosen source (a regular orchard grid can be switched on for a class), and left out where they would stand on a building, a road or a river polygon. Number, height and crown size come from the settings, not from survey data."));
  });

  POYO.trees = { prepare: prepare, build: build, stale: stale, legend: legend, make: make, clear: clear,
                 areaFor: areaFor, estimate: estimate, classList: classList, LABEL: LABEL };
})();
