// water.js: the water level scenario. Channel water stands in the river polygons, flood water
// lies on the ground inside the satellite depth classes or the 22:00 extent. Both are drawn
// from stated assumptions. Nothing here is a measurement or a hydraulic model.
"use strict";
(function () {
  var S = POYO.styles, R = POYO.render, L = POYO.layers, HEAD = R.HEAD;
  var CHUNK = 254;                 // cells per terrain chunk side, as in render.js
  var NONE = -32768;               // node without a channel bed
  var STEP = 5;                    // metres between wall points
  var EDGES = [0.5, 1, 2, 4];      // depth class edges in metres
  var MIDS = L.DEPTH.map(function (d) { return d[1]; });

  function bin(d) { var k = 0; while (k < 4 && d >= EDGES[k]) k++; return k; }
  function store(scene) {
    if (!scene.water) scene.water = { nodes: {}, meshes: {}, walls: {}, cuts: {}, prog: null };
    return scene.water;
  }

  // ==== rasters ===============================================================
  function coverage(f) {
    return { data: f.data, cols: f.cols, rows: f.rows, cell: f.cell, left: f.xf[0], top: f.xf[1] };
  }
  function at(g, x, y) {
    var c = Math.floor((x - g.left) / g.cell), r = Math.floor((g.top - y) / g.cell);
    return c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.data[r * g.cols + c] : 0;
  }

  // Calls fn(x, y, value) for every raster cell that reaches the threshold.
  function eachWet(g, min, fn) {
    for (var r = 0; r < g.rows; r++) {
      var o = r * g.cols, y = g.top - (r + 0.5) * g.cell;
      for (var c = 0; c < g.cols; c++) {
        if (g.data[o + c] >= min) fn(g.left + (c + 0.5) * g.cell, y, g.data[o + c]);
      }
    }
  }

  function nodeTexture(gl, grid, data) {
    return R.texture(gl, gl.R16I, gl.RED_INTEGER, gl.SHORT, grid.cols, grid.rows, data, gl.NEAREST, 2);
  }

  // The channel bed: lowest ground within one node, smoothed with a 15 m Gaussian inside the
  // river polygons, then carried four nodes outward so that the polygon edge has a value.
  function channelNodes(scene) {
    var st = store(scene);
    if (st.nodes.channel) return st.nodes.channel;
    var started = performance.now(), grid = scene.grids.terrain_10m, cols = grid.cols, rows = grid.rows;
    var mask = coverage(scene.fills.rivers), n = cols * rows;
    var inside = new Uint8Array(n), list = [];
    eachWet(mask, 64, function (x, y) {
      var i = Math.round((x - grid.left) / grid.cell - 0.5), j = Math.round((grid.top - y) / grid.cell - 0.5);
      if (i < 0 || j < 0 || i >= cols || j >= rows) return;
      var k = j * cols + i;
      if (!inside[k]) { inside[k] = 1; list.push(k); }
    });
    var low = new Float32Array(n), bed = new Int16Array(n).fill(NONE);
    list.forEach(function (k) {
      var i = k % cols, j = (k - i) / cols, m = Infinity;
      for (var b = -1; b <= 1; b++) for (var a = -1; a <= 1; a++) {
        var z = grid.at(i + a, j + b); if (z < m) m = z;
      }
      low[k] = m;
    });
    var weights = [], W = 4, sigma = 15 / grid.cell;
    for (var b = -W; b <= W; b++) for (var a = -W; a <= W; a++) {
      weights.push([a, b, Math.exp(-(a * a + b * b) / (2 * sigma * sigma))]);
    }
    function code(z) { return Math.round((z - 500) / 0.05); }
    list.forEach(function (k) {
      var i = k % cols, j = (k - i) / cols, sum = 0, total = 0;
      for (var q = 0; q < weights.length; q++) {
        var u = i + weights[q][0], v = j + weights[q][1];
        if (u < 0 || v < 0 || u >= cols || v >= rows) continue;
        var m = v * cols + u;
        if (!inside[m]) continue;
        sum += weights[q][2] * low[m]; total += weights[q][2];
      }
      bed[k] = code(sum / total);
    });
    var front = list;
    for (var pass = 0; pass < 4; pass++) {
      var found = [], seen = new Set();
      front.forEach(function (k) {
        var i = k % cols, j = (k - i) / cols;
        for (var b = -1; b <= 1; b++) for (var a = -1; a <= 1; a++) {
          var u = i + a, v = j + b, m = v * cols + u;
          if (u < 0 || v < 0 || u >= cols || v >= rows || bed[m] !== NONE || seen.has(m)) continue;
          seen.add(m);
          var sum = 0, count = 0;
          for (var d = -1; d <= 1; d++) for (var c = -1; c <= 1; c++) {
            var s = u + c, t = v + d;
            if (s < 0 || t < 0 || s >= cols || t >= rows || bed[t * cols + s] === NONE) continue;
            sum += bed[t * cols + s]; count++;
          }
          found.push([m, Math.round(sum / count)]);
        }
      });
      front = found.map(function (f) { bed[f[0]] = f[1]; return f[0]; });
    }
    var out = { data: bed, wet: list, tex: nodeTexture(scene.gl, grid, bed), grid: grid };
    out.ms = performance.now() - started;
    st.nodes.channel = out;
    return out;
  }

  // Flood nodes hold a depth class (or 1 for the 22:00 extent): the class at the node, and
  // just outside the water the deepest class nearby, so that edge triangles reach the water.
  function floodNodes(scene, source) {
    var st = store(scene);
    if (st.nodes[source]) return st.nodes[source];
    var started = performance.now(), grid = scene.grids.terrain_10m, cols = grid.cols, rows = grid.rows;
    var g = source === "depth" ? scene.extra.grids.flood_depth : coverage(scene.fills.at2200);
    var min = source === "depth" ? 1 : 128, near = new Int16Array(cols * rows), list = [];
    eachWet(g, min, function (x, y, v) {
      var k = source === "depth" ? v : 1;
      var u = (x - grid.left) / grid.cell - 0.5, w = (grid.top - y) / grid.cell - 0.5;
      var i0 = Math.max(0, Math.floor(u) - 1), i1 = Math.min(cols - 1, Math.floor(u) + 2);
      var j0 = Math.max(0, Math.floor(w) - 1), j1 = Math.min(rows - 1, Math.floor(w) + 2);
      for (var j = j0; j <= j1; j++) {
        for (var i = i0, m = j * cols + i0; i <= i1; i++, m++) {
          if (near[m] < k) { if (!near[m]) list.push(m); near[m] = k; }
        }
      }
    });
    list.forEach(function (m) {
      var i = m % cols, j = (m - i) / cols;
      var own = at(g, grid.left + (i + 0.5) * grid.cell, grid.top - (j + 0.5) * grid.cell);
      if (own >= min) near[m] = source === "depth" ? own : 1;
    });
    var out = { data: near, wet: list, tex: nodeTexture(scene.gl, grid, near), grid: grid };
    out.ms = performance.now() - started;
    st.nodes[source] = out;
    return out;
  }

  // Element buffers that hold only the terrain cells near water.
  function surfaceMesh(scene, source, nodes, cell) {
    var st = store(scene), key = source + cell;
    if (st.meshes[key]) return st.meshes[key];
    var gl = scene.gl, t = scene.terrain["terrain_" + cell + "m"], grid = t.grid, base = nodes.grid;
    var mark = new Uint8Array(grid.cols * grid.rows), bc = base.cols;
    nodes.wet.forEach(function (m) {
      var i = m % bc, j = (m - i) / bc;
      var x = base.left + (i + 0.5) * base.cell, y = base.top - (j + 0.5) * base.cell;
      var u = Math.floor((x - grid.left) / grid.cell - 0.499), v = Math.floor((grid.top - y) / grid.cell - 0.499);
      for (var b = v - 1; b <= v + (cell === 10 ? 0 : 1); b++) {
        for (var a = u - 1; a <= u + (cell === 10 ? 0 : 1); a++) {
          if (a >= 0 && b >= 0 && a < grid.cols && b < grid.rows) mark[b * grid.cols + a] = 1;
        }
      }
    });
    var chunks = [], triangles = 0, scratch = new Uint16Array(CHUNK * CHUNK * 6);
    t.chunks.forEach(function (ch) {
      var nx = Math.min(CHUNK, grid.cols - 1 - ch.c0), ny = Math.min(CHUNK, grid.rows - 1 - ch.r0), k = 0;
      for (var y = 0; y < ny; y++) {
        for (var x = 0; x < nx; x++) {
          if (!mark[(ch.r0 + y) * grid.cols + ch.c0 + x]) continue;
          var a = y * 255 + x, b = a + 255;
          scratch[k++] = a; scratch[k++] = a + 1; scratch[k++] = b;
          scratch[k++] = a + 1; scratch[k++] = b + 1; scratch[k++] = b;
        }
      }
      if (!k) return;
      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scratch.subarray(0, k), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      var box = ch.box.slice(); box[5] += 60;
      chunks.push({ c0: ch.c0, r0: ch.r0, count: k, vao: vao, box: box });
      triangles += k / 3;
    });
    st.meshes[key] = { chunks: chunks, grid: grid, tex: t.tex, triangles: triangles };
    return st.meshes[key];
  }

  // ==== what one body of water is =============================================
  // Returns the parts the state asks for and for which the data are read.
  function parts(scene, state) {
    var w = state.water3d, out = [];
    if (w.flood && !S.floodHidden(state)) {
      if (w.flood_source === "at2200") {
        if (scene.fills.at2200) {
          out.push({ key: "flood", source: "at2200", code: 2, single: w.depth_2200_m });
        }
      } else if (scene.extra && scene.extra.grids.flood_depth && scene.extra.flood_depth_outlines) {
        out.push({ key: "flood", source: "depth", code: 1 });
      }
    }
    if (w.channel && scene.fills.rivers) {
      var level = w.channel_mode === "level";
      out.push({ key: "channel", source: "channel", code: level ? 3 : 0, level: level,
                 depth: w.channel_depth_m, at: w.channel_level_m });
    }
    return out;
  }

  // Depth of water and height of its surface at a point, or null where it is dry.
  function sampler(scene, part, grid) {
    if (part.source === "channel") {
      var nodes = channelNodes(scene), mask = coverage(scene.fills.rivers), base = nodes.grid;
      var bed = function (x, y) {
        var u = (x - base.left) / base.cell - 0.5, v = (base.top - y) / base.cell - 0.5;
        var i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, sum = 0, total = 0;
        for (var n = 0; n < 4; n++) {
          var a = i + (n & 1), b = j + (n >> 1);
          if (a < 0 || b < 0 || a >= base.cols || b >= base.rows) continue;
          var q = nodes.data[b * base.cols + a];
          if (q === NONE) continue;
          var k = ((n & 1) ? fx : 1 - fx) * ((n >> 1) ? fy : 1 - fy) + 0.001;
          sum += k * (q * 0.05 + 500); total += k;
        }
        return total > 0 ? sum / total : null;
      };
      return {
        wet: function (x, y) { return at(mask, x, y) >= 128; },
        top: function (x, y, ground) {
          if (part.level) return part.at;
          var z = bed(x, y);
          return z === null ? ground - 1 : z + part.depth;
        },
        bed: bed
      };
    }
    var g = part.source === "depth" ? scene.extra.grids.flood_depth : coverage(scene.fills.at2200);
    var depth = function (x, y) {
      var v = at(g, x, y);
      if (part.source === "depth") return v ? MIDS[v - 1] : 0;
      return v >= 128 ? part.single : 0;
    };
    return {
      wet: function (x, y) { return depth(x, y) > 0; },
      depth: depth,
      top: function (x, y, ground) { return ground + depth(x, y); }
    };
  }

  function mesh(gl, list) {
    var data = new Float32Array(list), vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = R.buffer(gl, gl.ARRAY_BUFFER, data);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.bindVertexArray(null);
    return { vao: vao, buffer: buf, count: data.length / 6 };
  }
  function drop(gl, m) { if (m) { gl.deleteVertexArray(m.vao); gl.deleteBuffer(m.buffer); } }

  // Upright sides where the water ends and the ground beside it is lower than its surface.
  function walls(scene, part, cell) {
    var st = store(scene), key = JSON.stringify([part, cell]), have = st.walls[part.key + cell];
    if (have && have.key === key) return have;
    if (have) drop(scene.gl, have.mesh);
    var grid = scene.grids["terrain_" + cell + "m"], f = sampler(scene, part, grid), list = [];
    var set = part.source === "channel" ? scene.fills.rivers.set
      : part.source === "at2200" ? scene.fills.at2200.set : scene.extra.flood_depth_outlines.set;
    var reach = 4;
    for (var p = 0; p < set.count; p++) {
      for (var r = set.polyRing[p]; r < set.polyRing[p + 1]; r++) {
        var s = set.ringStart[r], e = set.ringStart[r + 1];
        for (var i = s; i < e; i++) {
          var j = i + 1 < e ? i + 1 : s;
          var ax = set.xy[2 * i], ay = set.xy[2 * i + 1], dx = set.xy[2 * j] - ax, dy = set.xy[2 * j + 1] - ay;
          var len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          var nx = dy / len, ny = -dx / len, steps = Math.ceil(len / STEP);
          for (var q = 0; q < steps; q++) {
            var t0 = q / steps, t1 = (q + 1) / steps, tm = (t0 + t1) / 2;
            var mx = ax + dx * tm, my = ay + dy * tm;
            var one = f.wet(mx + nx * reach, my + ny * reach), two = f.wet(mx - nx * reach, my - ny * reach);
            if (one === two || !scene.inside(mx, my)) continue;     // inside the water, or a sliver
            var ox = one ? -nx : nx, oy = one ? -ny : ny;           // toward the dry side
            var ends = [t0, t1].map(function (t) {
              var x = ax + dx * t, y = ay + dy * t, g = grid.height(x, y);
              var top = part.source === "channel" ? f.top(x - ox * 2, y - oy * 2, g)
                                                  : g + f.depth(mx - ox * reach, my - oy * reach);
              return { x: x, y: y, g: g, top: Math.max(g, top) };
            });
            var a = ends[0], b = ends[1];
            if (a.top - a.g < 0.05 && b.top - b.g < 0.05) continue;
            var da = a.top - a.g, db = b.top - b.g;
            list.push(a.x, a.y, a.g - 0.3, da, ox, oy, b.x, b.y, b.g - 0.3, db, ox, oy, b.x, b.y, b.top, db, ox, oy,
                      a.x, a.y, a.g - 0.3, da, ox, oy, b.x, b.y, b.top, db, ox, oy, a.x, a.y, a.top, da, ox, oy);
          }
        }
      }
    }
    st.walls[part.key + cell] = { key: key, mesh: mesh(scene.gl, list) };
    return st.walls[part.key + cell];
  }

  // Water cut by the four upright planes of the section box.
  function cutFaces(c, part, cell) {
    var scene = c.scene, st = store(scene), box = c.box, datum = c.state.terrain.datum_m;
    var key = JSON.stringify([part, cell, box, datum]), have = st.cuts[part.key + cell];
    if (have && have.key === key) return have;
    if (have) have.planes.forEach(function (q) { drop(scene.gl, q.mesh); if (q.line.count) scene.gl.deleteVertexArray(q.line.vao); });
    var grid = scene.grids["terrain_" + cell + "m"], f = sampler(scene, part, grid);
    var floor = Math.max(datum, box.min[2]), ceil = box.max[2];
    var planes = POYO.section.verticalPlanes(box).map(function (p, index) {
      var axis = p[0], value = p[1], lo = p[2], hi = p[3], tri = [], line = [];
      var n = Math.max(1, Math.ceil((hi - lo) / Math.max(1.5, (hi - lo) / 30000)));
      var normal = [0, 0];
      normal[axis] = (index % 2 ? 1 : -1) * (box.mode === "inside" ? -1 : 1);
      var last = null;
      for (var k = 0; k <= n; k++) {
        var s = lo + (hi - lo) * k / n, x = axis === 0 ? value : s, y = axis === 0 ? s : value, now = null;
        if (f.wet(x, y) && scene.inside(x, y)) {
          var g = grid.height(x, y), top = f.top(x, y, g);
          if (top > g + 0.005) now = { x: x, y: y, g: g, top: top, d: top - g };
        }
        if (now && last) {
          var a0 = Math.max(floor, last.g), a1 = Math.max(a0, Math.min(ceil, last.top));
          var b0 = Math.max(floor, now.g), b1 = Math.max(b0, Math.min(ceil, now.top));
          if (a1 - a0 > 0.001 || b1 - b0 > 0.001) {
            tri.push(last.x, last.y, a0, last.d, normal[0], normal[1], now.x, now.y, b0, now.d, normal[0], normal[1],
                     now.x, now.y, b1, now.d, normal[0], normal[1], last.x, last.y, a0, last.d, normal[0], normal[1],
                     now.x, now.y, b1, now.d, normal[0], normal[1], last.x, last.y, a1, last.d, normal[0], normal[1]);
            if (last.top <= ceil && now.top <= ceil && last.top >= floor && now.top >= floor) {
              line.push(last.x, last.y, last.top, now.x, now.y, now.top);
            }
          }
        }
        last = now;
      }
      return { normal: normal, mesh: mesh(scene.gl, tri),
               line: line.length ? scene.makeLine(new Float32Array(line)) : { count: 0 } };
    });
    st.cuts[part.key + cell] = { key: key, planes: planes };
    return st.cuts[part.key + cell];
  }

  // ==== shaders ===============================================================
  var VS = [
    "uniform isampler2D uHeight, uNode; uniform mat4 uMat; uniform vec4 uTile; uniform ivec2 uChunk, uSize, uNodeSize;",
    "uniform vec2 uOrigin, uCode; uniform vec3 uNodeXf; uniform float uCell, uRelief, uLevel, uChannelDepth, uBias, uCapZ;",
    "uniform float uDepths[6]; uniform int uSource, uCap;",
    "out vec3 vPos; out vec3 vNormal; out float vGround; out float vTop;",
    "float h(ivec2 c){ c = clamp(c, ivec2(0), uSize - 1); return float(texelFetch(uHeight, c, 0).r) * uCode.x + uCode.y; }",
    "int node(ivec2 c, int other){",
    "  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, uNodeSize))) return other;",
    "  return texelFetch(uNode, c, 0).r;",
    "}",
    "void main(){",
    "  ivec2 c = uChunk + ivec2(gl_VertexID % 255, gl_VertexID / 255);",
    "  float z = h(c);",
    "  vec2 xy = vec2(uOrigin.x + float(c.x) * uCell, uOrigin.y - float(c.y) * uCell);",
    "  vec2 g = vec2(xy.x - uNodeXf.x, uNodeXf.y - xy.y) * uNodeXf.z;",
    "  float top; vec3 normal = vec3(0.0, 0.0, 1.0);",
    "  if (uSource == 3) top = uLevel;",
    "  else if (uSource == 0) {",
    "    ivec2 i = ivec2(floor(g)); vec2 f = g - floor(g); float s = 0.0, w = 0.0;",
    "    for (int n = 0; n < 4; n++) {",
    "      ivec2 o = ivec2(n & 1, n >> 1); int v = node(i + o, -32768);",
    "      if (v == -32768) continue;",
    "      vec2 q = mix(1.0 - f, f, vec2(o)); float k = q.x * q.y + 0.001;",
    "      s += k * (float(v) * 0.05 + 500.0); w += k;",
    "    }",
    "    top = w > 0.0 ? s / w + uChannelDepth : z - 1.0;",
    "  } else {",
    "    int k = node(ivec2(floor(g + 0.5)), 0);",
    "    top = z + (k > 0 ? uDepths[min(k, 5)] : 0.0);",
    "    float dx = (h(c + ivec2(1,0)) - h(c - ivec2(1,0))) / (2.0 * uCell);",
    "    float dy = (h(c - ivec2(0,1)) - h(c + ivec2(0,1))) / (2.0 * uCell);",
    "    normal = vec3(-dx * uRelief, -dy * uRelief, 1.0);",
    "  }",
    "  vNormal = normal; vGround = z; vTop = top;",
    "  vPos = vec3(xy, uCap == 1 ? uCapZ : top);",
    "  vec4 q = uMat * vec4(vPos, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - uBias, 1.0);",
    "}"].join("\n");

  var COLOUR = [
    "uniform int uStyle, uColourBy; uniform vec3 uRamp5[5], uColour, uWhite, uLight; uniform vec4 uPaper;",
    "uniform float uOpacity, uXray;",
    "vec3 water(float d){",
    "  int b = d < 0.5 ? 0 : d < 1.0 ? 1 : d < 2.0 ? 2 : d < 4.0 ? 3 : 4;",
    "  return uColourBy == 0 ? uRamp5[b] : uColour;",
    "}",
    "void over(inout vec3 p, inout float pa, vec3 c, float a){ p = c * a + p * (1.0 - a); pa = a + pa * (1.0 - a); }"].join("\n");

  function surfaceFS() {
    return ["precision highp usampler2DArray;", S.CLIP, S.STROKE, S.CONTOUR, S.GRID, S.ENCODE, COLOUR,
      "in vec3 vPos; in vec3 vNormal; in float vGround; in float vTop;",
      "uniform sampler2D uSdf, uMask; uniform vec4 uSdfXf, uMaskXf, uGridXf; uniform usampler2DArray uClass;",
      "uniform ivec2 uGridSize; uniform int uSource, uCap; uniform float uDepths[6], uSingle, uCapZ, uShade, uFlat, uEdgePx;",
      "uniform vec3 uEdgeColour, uContourColour, uWireColour;",
      "int cls(ivec2 c){",
      "  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, uGridSize))) return 0;",
      "  return int(texelFetch(uClass, ivec3(c.x & 2047, c.y & 2047, (c.y >> 11) * int(uGridXf.w) + (c.x >> 11)), 0).r);",
      "}",
      "float mask(vec2 p){",
      "  vec2 uv = (p - uMaskXf.xy) * uMaskXf.zw;",
      "  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;",
      "  return textureLod(uMask, uv, 0.0).r;",
      "}",
      "// depth of flood water at a ground position (channel: 1 inside the polygons), 0 when dry",
      "float wetAt(vec2 p){",
      "  if (uSource == 1) {",
      "    int k = cls(ivec2(floor(vec2(p.x - uGridXf.x, uGridXf.y - p.y) * uGridXf.z)));",
      "    return k > 0 ? uDepths[min(k, 5)] : 0.0;",
      "  }",
      "  if (mask(p) < 0.5) return 0.0;",
      "  return uSource == 2 ? uSingle : 1.0;",
      "}",
      "void main(){",
      "  vec2 p = vPos.xy, dx = dFdx(p), dy = dFdy(p);",
      "  float level = contour(vTop, length(vec2(dFdx(vTop), dFdy(vTop))));",
      "  vec2 gxy = vec2(length(vec2(dFdx(vPos.x), dFdy(vPos.x))), length(vec2(dFdx(vPos.y), dFdy(vPos.y))));",
      "  float grid_ = gridLines(p, gxy);",
      "  float deep = vTop - vGround, deepStep = max(fwidth(deep), 1e-5);",
      "  bool channel = uSource == 0 || uSource == 3;",
      "  if (texture(uSdf, (p - uSdfXf.xy) * uSdfXf.zw).r < 0.5) discard;",
      "  if (uCap == 0) { if (clipped(vPos)) discard; }",
      "  else if (any(lessThan(p, uBoxMin.xy)) || any(greaterThan(p, uBoxMax.xy)) || vGround >= uCapZ || vTop <= uCapZ) discard;",
      "  float here = wetAt(p);",
      "  if (here <= 0.0 || (channel && deep <= 0.0)) discard;",
      "#ifdef GBUF",
      "  frag = encode(vec3(0.0, 0.0, 1.0), 3u);",
      "#else",
      "  vec3 col = water(channel ? deep : here);",
      "  float lit = dot(normalize(vNormal), uLight);",
      "  float k = clamp(1.0 + uShade * (lit - uFlat) * 1.2, 0.55, 1.1);",
      "  float kw = clamp(0.93 + uShade * (lit - uFlat) * 0.9, 0.6, 1.0);",
      "  vec4 base = vec4(col, uOpacity);",
      "  if (uStyle == 0) base = vec4(clamp(col * k, 0.0, 1.0), uOpacity);",
      "  else if (uStyle == 2) base = vec4(uWhite * kw, uOpacity);",
      "  else if (uStyle == 3 || uStyle == 4) base = vec4(uPaper.rgb, uPaper.a * uOpacity);",
      "  else if (uStyle == 5) base = vec4(0.0);",
      "  else if (uStyle == 6) base = vec4(clamp(col * k, 0.0, 1.0), uXray * uOpacity);",
      "  float pa = base.a; vec3 q = base.rgb * pa;",
      "  if (uStyle >= 3 && uStyle <= 5 && uCap == 0 && uEdgePx > 0.0) {",
      "    float r = max(uEdgePx * 0.5, 0.75);",
      "    bool edge = wetAt(p + dx * r) <= 0.0 || wetAt(p - dx * r) <= 0.0 ||",
      "                wetAt(p + dy * r) <= 0.0 || wetAt(p - dy * r) <= 0.0 || (channel && deep < deepStep * r);",
      "    if (edge) over(q, pa, uEdgeColour, uOpacity * min(1.0, uEdgePx));",
      "  }",
      "  if (uStyle == 4) over(q, pa, uContourColour, level * uOpacity);",
      "  if (uStyle == 5) over(q, pa, uWireColour, grid_ * uOpacity);",
      "  if (pa < 0.003 && uStyle >= 5) discard;",
      "  frag = vec4(pa > 0.0 ? q / pa : vec3(0.0), pa);",
      "#endif",
      "}"].join("\n");
  }

  var SIDE_VS = [
    "layout(location=0) in vec4 aPos; layout(location=1) in vec2 aN;",
    "uniform mat4 uMat; uniform vec4 uTile; uniform float uBias;",
    "out vec3 vPos; out float vDeep; out vec2 vN;",
    "void main(){",
    "  vPos = aPos.xyz; vDeep = aPos.w; vN = aN;",
    "  vec4 q = uMat * vec4(aPos.xyz, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - uBias, 1.0);",
    "}"].join("\n");

  function sideFS() {
    return [S.CLIP, S.ENCODE, COLOUR,
      "in vec3 vPos; in float vDeep; in vec2 vN; uniform int uFace;",
      "void main(){",
      "  if (uFace == 0 && clipped(vPos)) discard;",
      "#ifdef GBUF",
      "  frag = encode(vec3(0.0, 0.0, 1.0), 3u);",
      "#else",
      "  vec3 col = water(vDeep);",
      "  float k = uFace == 1 ? 1.0 : 0.72 + 0.26 * max(dot(normalize(vN), normalize(uLight.xy + vec2(1e-5))), 0.0);",
      "  vec4 base = vec4(col * (uFace == 1 ? 1.0 : 0.86), uOpacity);",
      "  if (uStyle == 0) base = vec4(col * k, uOpacity);",
      "  else if (uStyle == 2) base = vec4(uWhite * k, uOpacity);",
      "  else if (uStyle == 3 || uStyle == 4) base = vec4(uPaper.rgb, uPaper.a * uOpacity);",
      "  else if (uStyle == 5) base = vec4(0.0);",
      "  else if (uStyle == 6) base = vec4(col * k, uXray * uOpacity);",
      "  if (base.a < 0.003) discard;",
      "  frag = base;",
      "#endif",
      "}"].join("\n");
  }

  function programs(scene) {
    var st = store(scene);
    if (st.prog) return st.prog;
    var gl = scene.gl, made = {};
    function lazy(name, vs, fs, define) {
      Object.defineProperty(made, name, { get: function () {
        var head = define ? HEAD.replace("#version 300 es\n", "#version 300 es\n#define " + define + "\n") : HEAD;
        var p = R.compile(gl, head + vs, head + fs());
        Object.defineProperty(made, name, { value: p });
        return p;
      }, configurable: true });
    }
    lazy("surface", VS, surfaceFS); lazy("surfaceG", VS, surfaceFS, "GBUF");
    lazy("side", SIDE_VS, sideFS); lazy("sideG", SIDE_VS, sideFS, "GBUF");
    st.prog = made;
    return made;
  }

  // ==== drawing ===============================================================
  function styleOf(c, part) { return part.key === "channel" ? c.look.water : c.look.flood; }

  function colourUniforms(c, p, part) {
    var gl = c.gl, s = c.state, w = s.water3d, K = c.look, ramp = [];
    s.look.water_ramp.forEach(function (h) { ramp.push.apply(ramp, S.rgb(h)); });
    gl.uniform1i(p.u.uStyle, S.CODE[styleOf(c, part)]);
    gl.uniform1i(p.u.uColourBy, w.colour_by === "single" ? 1 : 0);
    gl.uniform3fv(p.u.uRamp5, ramp);
    gl.uniform3fv(p.u.uColour, S.rgb(w.colour));
    gl.uniform3fv(p.u.uWhite, S.rgb(part.key === "channel" ? K.white_water : K.white_flood));
    gl.uniform3fv(p.u.uLight, c.light);
    gl.uniform4fv(p.u.uPaper, S.paper(c));
    gl.uniform1f(p.u.uOpacity, w.opacity);
    gl.uniform1f(p.u.uXray, K.xray_alpha);
  }

  function drawSurface(c, part, g, tile, capZ) {
    var gl = c.gl, scene = c.scene, o = c.o, s = c.state, K = c.look, T = s.terrain;
    var cell = o.cell === 20 ? 20 : 10;
    var nodes = part.source === "channel" ? channelNodes(scene) : floodNodes(scene, part.source);
    var m = surfaceMesh(scene, part.source, nodes, cell), grid = m.grid, base = nodes.grid;
    var p = programs(scene)[g ? "surfaceG" : "surface"], half = c.cam.depthHalf;
    gl.useProgram(p.p);
    S.camera(gl, p, c, tile); S.box3(gl, p, c);
    gl.uniform2i(p.u.uSize, grid.cols, grid.rows);
    gl.uniform2f(p.u.uOrigin, grid.left + 0.5 * grid.cell, grid.top - 0.5 * grid.cell);
    gl.uniform1f(p.u.uCell, grid.cell);
    gl.uniform2f(p.u.uCode, grid.scale, grid.offset);
    gl.uniform2i(p.u.uNodeSize, base.cols, base.rows);
    gl.uniform3f(p.u.uNodeXf, base.left + 0.5 * base.cell, base.top - 0.5 * base.cell, 1 / base.cell);
    gl.uniform1i(p.u.uSource, part.code);
    gl.uniform1f(p.u.uLevel, part.at || 0);
    gl.uniform1f(p.u.uChannelDepth, part.depth || 0);
    gl.uniform1f(p.u.uSingle, part.single || 0);
    var depths = part.source === "at2200" ? [0, part.single, 0, 0, 0, 0] : [0].concat(MIDS);
    gl.uniform1fv(p.u.uDepths, depths);
    gl.uniform1f(p.u.uRelief, T.shading_relief);
    gl.uniform1f(p.u.uShade, T.hillshade);
    gl.uniform1f(p.u.uFlat, Math.sin(T.light_altitude * POYO.DEG));
    gl.uniform1i(p.u.uCap, capZ === null ? 0 : 1);
    gl.uniform1f(p.u.uCapZ, capZ === null ? 0 : capZ);
    // shallow water would otherwise flicker against the ground it lies on
    gl.uniform1f(p.u.uBias, (capZ === null ? (cell === 20 ? 0.5 : 0.12) : 0.7) / half);
    colourUniforms(c, p, part);
    gl.uniform4fv(p.u.uSdfXf, scene.sdfXf);
    var layer = s.layers[part.key === "channel" ? "rivers" : "flood"];
    gl.uniform1f(p.u.uEdgePx, Math.max(layer.outline_mm, 0.1) * o.pxPerMm);
    gl.uniform3fv(p.u.uEdgeColour, S.rgb(layer.outline_colour));
    S.contourUniforms(gl, p, c); S.wireUniforms(gl, p, c);
    var fill = part.source === "channel" ? scene.fills.rivers : part.source === "at2200" ? scene.fills.at2200 : null;
    var classes = part.source === "depth" ? L.gridTexture(scene, "flood_depth") : null;
    S.bind(gl, p, "uHeight", 0, m.tex);
    S.bind(gl, p, "uNode", 1, nodes.tex);
    S.bind(gl, p, "uSdf", 2, scene.sdf);
    S.bind(gl, p, "uMask", 3, fill ? fill.tex : scene.empty);
    gl.uniform4fv(p.u.uMaskXf, fill ? fill.xf : [0, 0, 1, 1]);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, classes ? classes.tex : L.dummyArray(scene));
    gl.uniform1i(p.u.uClass, 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform4f(p.u.uGridXf, classes ? classes.left : 0, classes ? classes.top : 0,
                 classes ? 1 / classes.cell : 1, classes ? classes.across : 1);
    gl.uniform2i(p.u.uGridSize, classes ? classes.cols : 0, classes ? classes.rows : 0);
    for (var q = 0; q < m.chunks.length; q++) {
      var ch = m.chunks[q];
      if (!S.inView(c, tile, ch.box)) continue;
      gl.uniform2i(p.u.uChunk, ch.c0, ch.r0);
      gl.bindVertexArray(ch.vao);
      gl.drawElements(gl.TRIANGLES, ch.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  function drawSides(c, part, g, tile) {
    var gl = c.gl, scene = c.scene, w = c.state.water3d, cell = c.o.cell === 20 ? 20 : 10;
    if (styleOf(c, part) === "wireframe") return;
    var wall = w.walls ? walls(scene, part, cell) : null;
    var cut = c.box ? cutFaces(c, part, cell) : null;
    if (!(wall && wall.mesh.count) && !cut) return;
    var p = programs(scene)[g ? "sideG" : "side"], half = c.cam.depthHalf;
    gl.useProgram(p.p);
    S.camera(gl, p, c, tile); S.box3(gl, p, c);
    colourUniforms(c, p, part);
    if (wall && wall.mesh.count) {
      gl.uniform1i(p.u.uFace, 0);
      gl.uniform1f(p.u.uBias, 0.1 / half);
      gl.bindVertexArray(wall.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, wall.mesh.count);
    }
    if (cut) {
      gl.uniform1i(p.u.uFace, 1);
      gl.uniform1f(p.u.uBias, 0.6 / half);
      cut.planes.forEach(function (q) {
        if (!q.mesh.count || !looking(c, q.normal)) return;
        gl.bindVertexArray(q.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, q.mesh.count);
      });
    }
  }
  function looking(c, normal) { return normal[0] * c.toViewer[0] + normal[1] * c.toViewer[1] > 1e-5; }

  function draw(c, part, g, tile) {
    drawSurface(c, part, g, tile, null);
    var z = S.horizontalCut(c);
    if (z !== null) drawSurface(c, part, g, tile, z);
    drawSides(c, part, g, tile);
  }

  // The water line on each cut face.
  function waterLines(c, list, tile) {
    var gl = c.gl, o = c.o, cut = c.state.box.cut, cell = o.cell === 20 ? 20 : 10;
    if (!c.box || cut.line_mm <= 0) return;
    var p = c.P.line, width = cut.line_mm * 0.6 * o.pxPerMm, colour = S.rgb(cut.line_colour);
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uMat, false, c.cam.m);
    gl.uniform4fv(p.u.uTile, tile);
    gl.uniform2f(p.u.uPage, o.size.width, o.size.height);
    gl.uniform1i(p.u.uClip, 0);
    gl.uniform1f(p.u.uHalf, Math.max(width / 2, 0.5));
    gl.uniform4f(p.u.uColour, colour[0], colour[1], colour[2], Math.min(1, width));
    gl.uniform1f(p.u.uBias, (width * o.mpp + 2) / c.cam.depthHalf);
    gl.uniform1f(p.u.uMin, 0.35);
    gl.depthMask(false);
    list.forEach(function (part) {
      if (styleOf(c, part) === "wireframe") return;
      cutFaces(c, part, cell).planes.forEach(function (q) {
        if (!q.line.count || !looking(c, q.normal)) return;
        gl.bindVertexArray(q.line.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, q.line.count);
      });
    });
    gl.depthMask(true);
  }

  // Called by the renderer for every picture. Null when there is no water to draw.
  function prepare(c) {
    var w = c.state.water3d;
    if (!(w.channel || w.flood) || w.opacity <= 0) return null;
    var list = parts(c.scene, c.state);
    if (!list.length) return null;
    function kind(part) {
      var style = styleOf(c, part);
      if (style === "wireframe") return "see";
      return style === "xray" || w.opacity < 0.999 ? "glass" : "solid";
    }
    function of(k) { return list.filter(function (p) { return kind(p) === k; }); }
    return {
      parts: list,
      solid: function (g, tile) { of("solid").forEach(function (p) { draw(c, p, g, tile); }); },
      see: function (g, tile) {
        var some = of("see");
        if (!some.length) return;
        c.gl.depthMask(false);
        some.forEach(function (p) { draw(c, p, false, tile); });
        c.gl.depthMask(true);
      },
      glass: function (g, tile) {
        var some = of("glass");
        // depth first, so that overlapping water is tinted once, by whatever is nearest
        if (some.length) {
          S.solidOrGlass(c.gl, true, function () { some.forEach(function (p) { draw(c, p, false, tile); }); });
        }
        waterLines(c, list, tile);
      }
    };
  }

  // ==== legend ================================================================
  function presentIn(scene, state, raster, min) {
    var area = L.region(scene, state);
    if (!area.rect || area.inside) return true;
    var k = L.cells(raster, area.rect);
    for (var r = k.r0; r < k.r1; r++) {
      for (var i = r * raster.cols + k.c0, end = r * raster.cols + k.c1; i < end; i++) {
        if (raster.data[i] >= min) return true;
      }
    }
    return false;
  }

  function legend(scene, manifest, state) {
    var w = state.water3d;
    if (!scene || !(w.channel || w.flood) || w.opacity <= 0) return [];
    var K = state.look, single = w.colour_by === "single", use = {}, entries = [], notes = [], shown = [];
    parts(scene, state).forEach(function (part) {
      if (part.source === "channel") {
        if (!presentIn(scene, state, coverage(scene.fills.rivers), 128)) return;
        notes.push(part.level ? "Channel water: flat level at " + POYO.fmt(part.at, 1) + " m, inside the river polygons."
          : "Channel water: smoothed channel bed plus " + POYO.fmt(part.depth, 1) + " m.");
        var last = part.level ? 4 : bin(part.depth + 0.5);
        for (var i = 0; i <= last; i++) use[i] = true;
      } else if (part.source === "at2200") {
        if (!presentIn(scene, state, coverage(scene.fills.at2200), 128)) return;
        notes.push("Flood water: extent at 22:00 with one assumed depth of " + POYO.fmt(part.single, 1) + " m.");
        use[bin(part.single)] = true;
      } else {
        var counts = L.countGrid(scene, "flood_depth", L.region(scene, state)), any = false;
        MIDS.forEach(function (d, i) { if (counts[i + 1] > 0) { use[i] = true; any = true; } });
        if (!any) return;
        notes.push("Flood water: ground plus the satellite depth class. A class depth is a class estimate.");
      }
      shown.push(part);
    });
    if (!shown.length) return [];
    function swatch(label, colour, part) {
      var style = part.key === "channel" ? K.water : K.flood;
      var lined = style === "outline" || style === "contours" || style === "wireframe";
      var layer = state.layers[part.key === "channel" ? "rivers" : "flood"];
      return { label: label, colour: lined ? state.sheet.paper_colour : style === "white"
                 ? (part.key === "channel" ? K.white_water : K.white_flood) : colour,
               border: lined ? layer.outline_colour : null, alpha: w.opacity };
    }
    var flood = shown.filter(function (p) { return p.key === "flood"; })[0];
    if (single) {
      shown.forEach(function (p) {
        entries.push(swatch(p.key === "channel" ? "Channel water" : "Flood water", w.colour, p));
      });
    } else {
      [0, 1, 2, 3, 4].forEach(function (i) {
        if (!use[i]) return;
        var label = L.DEPTH[i][0];
        if (i === 4 && shown.some(function (p) { return p.key === "channel"; })) label = "4 m and deeper";
        entries.push(swatch(label, K.water_ramp[i], flood || shown[0]));
      });
    }
    notes.unshift("Water level scenario, not measured.");
    return [{ heading: single ? "Water level scenario" : "Water level scenario, depth", entries: entries, notes: notes }];
  }

  // ==== panel =================================================================
  var ui = POYO.ui, K = ui.kit;
  function app() { return K.app(); }
  function W() { return app().state.water3d; }
  function set(key, min, max, step) { return K.range(W, key, min, max, step); }

  ui.PANELS.water3d = { title: "Water model", make: function (p) {
    p.appendChild(K.note("Water level scenario, not measured. It shows where a chosen level or class depth would stand on the ground. It is not a flow model."));
    p.appendChild(K.heading("Channel water"));
    p.appendChild(K.check("Fill the river channels", K.prop(W, "channel")));
    p.appendChild(K.when(function () { return W().channel; },
      K.select("Surface", [["depth", "Bed plus a depth"], ["level", "Flat level"]], K.prop(W, "channel_mode")),
      K.when(function () { return W().channel_mode === "depth"; }, K.slider("Depth m", set("channel_depth_m", 0, 10, 0.1))),
      K.when(function () { return W().channel_mode === "level"; }, K.number("Level m", set("channel_level_m", -10, 1100, 0.5))),
      K.styleSelect("Style", "water"),
      K.note("The bed is the lowest ground within 10 m, smoothed over 15 m, inside the 30 river polygons.")));
    p.appendChild(K.heading("Flood water"));
    p.appendChild(K.check("Raise the flood water surface", K.prop(W, "flood")));
    p.appendChild(K.when(function () { return W().flood; },
      K.select("From", [["depth", "Satellite depth classes"], ["at2200", "Extent at 22:00, one depth"]], K.prop(W, "flood_source")),
      K.when(function () { return W().flood_source === "at2200"; }, K.slider("Assumed depth m", set("depth_2200_m", 0, 6, 0.1))),
      K.styleSelect("Style", "flood"),
      K.live(function () {
        return W().flood_source === "depth"
          ? "Class depths used: " + L.DEPTH.map(function (d) { return POYO.fmt(d[1], d[1] % 1 ? 2 : 0) + " m"; }).join(", ") + ". A class depth is an estimate."
          : "The depth is your assumption. The 22:00 extent carries no depth.";
      }),
      K.live(function () {
        return app().state.layers.flood.hide_in_elevation && app().state.view.elevation <= 0.01
          ? "Hidden in this elevation. Change it under Flood extent." : "";
      })));
    p.appendChild(K.heading("Appearance"));
    p.appendChild(K.select("Colour", [["depth", "Depth ramp"], ["single", "One water colour"]], K.prop(W, "colour_by")));
    var ramp = K.el("div", {});
    L.DEPTH.forEach(function (d, i) {
      ramp.appendChild(K.colour(d[0], {
        get: function () { return app().state.look.water_ramp[i]; },
        set: function (v) { app().state.look.water_ramp[i] = v; }
      }));
    });
    p.appendChild(K.when(function () { return W().colour_by === "depth"; }, ramp,
      K.note("The identity water ramp. It is separate from the colours of the painted depth classes.")));
    p.appendChild(K.when(function () { return W().colour_by === "single"; }, K.colour("Water", K.prop(W, "colour"))));
    p.appendChild(K.slider("Opacity", set("opacity", 0, 1, 0.05)));
    p.appendChild(K.check("Side walls", K.prop(W, "walls")));
    p.appendChild(K.note("Turning on the section box cuts the water too, with a water line on the cut face."));
  } };

  ui.extraRail.push({ section: "Water" });
  ui.extraRail.push({ key: "water3d", title: "Water model", visible: {
    get: function () { var w = W(); return w.channel || w.flood; },
    set: function (v) {
      var w = W();
      if (v) w.channel = true; else { w.channel = false; w.flood = false; }
      setTimeout(ui.rebuild, 0);
    }
  }, meta: function () {
    var w = W();
    return w.channel && w.flood ? "channel, flood" : w.channel ? "channel" : w.flood ? "flood" : "off";
  } });

  ui.noteExtra.push(function (tab) {
    tab.appendChild(K.heading("Water model"));
    tab.appendChild(K.note("Water level scenario, not measured. Channel water fills the river polygons from a bed taken as the smoothed lowest ground of the 10 m terrain, plus a chosen depth, or up to a flat level. Flood water lies on the ground at the mid value of the satellite depth class, or at one assumed depth inside the 22:00 extent. No flow, timing or volume is modelled."));
  });

  POYO.water = { prepare: prepare, legend: legend, parts: parts, channelNodes: channelNodes,
                 floodNodes: floodNodes, sampler: sampler };
})();
