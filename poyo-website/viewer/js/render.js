// render.js: the WebGL2 renderer. One scene, drawn to the screen or to export tiles.
"use strict";
(function () {
  var G = POYO.geom;
  var CHUNK = 254;                 // cells per terrain chunk side (255 x 255 vertices)
  var FILL_CELL = 5;               // metres per pixel of the water and flood masks
  var SDF_RANGE = 40;
  var BUILDING_BIN = 2000;         // metres

  var HEAD = "#version 300 es\nprecision highp float;\nprecision highp int;\n" +
             "precision highp isampler2D;\nprecision highp sampler2D;\n";

  var TERRAIN_VS = HEAD + [
    "uniform isampler2D uHeight; uniform mat4 uMat; uniform vec4 uTile; uniform ivec2 uChunk; uniform ivec2 uSize;",
    "uniform vec2 uOrigin; uniform float uCell; uniform vec2 uCode; uniform float uRelief;",
    "out vec3 vPos; out vec3 vNormal;",
    "float h(ivec2 c){ c = clamp(c, ivec2(0), uSize - 1); return float(texelFetch(uHeight, c, 0).r) * uCode.x + uCode.y; }",
    "void main(){",
    "  ivec2 c = uChunk + ivec2(gl_VertexID % 255, gl_VertexID / 255);",
    "  float z = h(c);",
    "  vec3 p = vec3(uOrigin.x + float(c.x) * uCell, uOrigin.y - float(c.y) * uCell, z);",
    "  float dx = (h(c + ivec2(1,0)) - h(c - ivec2(1,0))) / (2.0 * uCell);",
    "  float dy = (h(c - ivec2(0,1)) - h(c + ivec2(0,1))) / (2.0 * uCell);",
    "  vNormal = vec3(-dx * uRelief, -dy * uRelief, 1.0);",
    "  vPos = p;",
    "  vec4 q = uMat * vec4(p, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z, 1.0);",
    "}"].join("\n");

  var TERRAIN_FS = HEAD + [
    "in vec3 vPos; in vec3 vNormal; out vec4 frag;",
    "uniform sampler2D uSdf, uRamp, uFill0, uFill1;",
    "uniform vec4 uSdfXf, uFillXf0, uFillXf1, uColour0, uColour1;",
    "uniform vec2 uRampRange; uniform vec3 uLight; uniform float uShade, uFlat, uOpacity, uGround;",
    "float fillAlpha(sampler2D tex, vec4 xf){",
    "  vec2 uv = (vPos.xy - xf.xy) * xf.zw;",
    "  vec2 size = vec2(textureSize(tex, 0));",
    "  float perPixel = max(length(dFdx(uv * size)), length(dFdy(uv * size)));",
    "  float a = texture(tex, uv).r;",
    "  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);",
    "  // sharpen only where a mask pixel covers more than one screen pixel",
    "  return inside * mix(a, smoothstep(0.25, 0.75, a), clamp(1.5 - perPixel * 1.5, 0.0, 1.0));",
    "}",
    "void main(){",
    "  float a0 = fillAlpha(uFill0, uFillXf0) * uColour0.a;",
    "  float a1 = fillAlpha(uFill1, uFillXf1) * uColour1.a;",
    "  if (texture(uSdf, (vPos.xy - uSdfXf.xy) * uSdfXf.zw).r < 0.5) discard;",
    "  float t = clamp((vPos.z - uRampRange.x) / (uRampRange.y - uRampRange.x), 0.0, 1.0);",
    "  vec3 col = texture(uRamp, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;",
    "  float lit = dot(normalize(vNormal), uLight);",
    "  col = clamp(col * clamp(1.0 + uShade * (lit - uFlat) * 1.2, 0.3, 1.12), 0.0, 1.0);",
    "  float pa = uGround * uOpacity; vec3 p = col * pa;",
    "  p = uColour0.rgb * a0 + p * (1.0 - a0); pa = a0 + pa * (1.0 - a0);",
    "  p = uColour1.rgb * a1 + p * (1.0 - a1); pa = a1 + pa * (1.0 - a1);",
    "  if (pa < 0.003) discard;",
    "  frag = vec4(p / pa, pa);",
    "}"].join("\n");

  var SKIRT_VS = HEAD + [
    "layout(location=0) in vec4 aPos; layout(location=1) in vec2 aOut;",
    "uniform mat4 uMat; uniform vec4 uTile; uniform float uDatum; out vec2 vOut;",
    "void main(){",
    "  vec3 p = vec3(aPos.xy, aPos.w > 0.5 ? min(uDatum, aPos.z) : aPos.z);",
    "  vOut = aOut;",
    "  vec4 q = uMat * vec4(p, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z, 1.0);",
    "}"].join("\n");

  var SKIRT_FS = HEAD + [
    "in vec2 vOut; out vec4 frag; uniform vec4 uColour; uniform vec3 uLight;",
    "void main(){",
    "  vec2 n = normalize(vOut + vec2(1e-6)), l = normalize(uLight.xy + vec2(1e-6));",
    "  float k = 0.9 + 0.2 * dot(n, l);",
    "  frag = vec4(clamp(uColour.rgb * k, 0.0, 1.0), uColour.a);",
    "}"].join("\n");

  var BUILDING_VS = HEAD + [
    "layout(location=0) in vec3 aPos; layout(location=1) in uint aId;",
    "uniform sampler2D uData; uniform mat4 uMat; uniform vec4 uTile; uniform vec3 uCentre;",
    "uniform float uVe, uDefault, uIndustrial, uFlat, uBias;",
    "uniform vec3 uColours[3]; out vec3 vRel; flat out vec3 vColour;",
    "void main(){",
    "  int id = int(aId >> 1u); bool top = (aId & 1u) == 1u;",
    "  vec4 d = texelFetch(uData, ivec2(id % 2048, id / 2048), 0);",
    "  int code = int(d.w + 0.5); int source = code % 4; bool industry = code >= 4;",
    "  float h = source == 2 ? (industry ? uIndustrial : uDefault) : d.z;",
    "  float z = top ? d.y + h : d.x - 0.5;",
    "  float bias = 0.0;",
    "  if (uFlat > 0.5) { z = aPos.z + 0.4; bias = uBias; }",
    "  vColour = uColours[source];",
    "  vRel = vec3(aPos.xy - uCentre.xy, z * uVe);",
    "  vec4 q = uMat * vec4(aPos.xy, z, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - bias, 1.0);",
    "}"].join("\n");

  var BUILDING_FS = HEAD + [
    "in vec3 vRel; flat in vec3 vColour; out vec4 frag;",
    "uniform vec3 uLight, uToViewer; uniform float uOpacity;",
    "void main(){",
    "  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));",
    "  if (dot(n, uToViewer) < 0.0) n = -n;",
    "  float k = abs(n.z) > 0.7 ? 1.0 : 0.64 + 0.28 * max(dot(n, uLight), 0.0);",
    "  frag = vec4(vColour * k, uOpacity);",
    "}"].join("\n");

  // Lines are screen space capsules, so their width is exact on paper.
  // A pixel is painted by the first band it reaches, so short overlapping segments
  // give it (nearly) their highest coverage instead of whichever segment came first.
  var BANDS = [0.999, 0.85, 0.7, 0.55, 0.4, 0.27, 0.15, 0.06, 0.004];
  var DRAFT_BANDS = [0.999, 0.6, 0.25, 0.004];
  var LINE_VS = HEAD + [
    "layout(location=0) in vec3 aStart; layout(location=1) in vec3 aEnd;",
    "uniform mat4 uMat; uniform vec4 uTile; uniform vec2 uPage; uniform float uHalf, uBias;",
    "out vec2 vLocal; flat out float vLength;",
    "const vec2 CORNER[6] = vec2[6](vec2(0,-1), vec2(1,-1), vec2(1,1), vec2(0,-1), vec2(1,1), vec2(0,1));",
    "void main(){",
    "  vec4 a = uMat * vec4(aStart, 1.0), b = uMat * vec4(aEnd, 1.0);",
    "  vec2 pa = (a.xy * 0.5 + 0.5) * uPage, pb = (b.xy * 0.5 + 0.5) * uPage;",
    "  vec2 d = pb - pa; float len = length(d);",
    "  vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);",
    "  vec2 c = CORNER[gl_VertexID]; float reach = uHalf + 1.0; float side = c.x * 2.0 - 1.0;",
    "  vec2 p = mix(pa, pb, c.x) + t * side * reach + n * c.y * reach;",
    "  vLocal = vec2(c.x * len + side * reach, c.y * reach); vLength = len;",
    "  vec2 ndc = p / uPage * 2.0 - 1.0;",
    "  gl_Position = vec4(ndc * uTile.xy + uTile.zw, mix(a.z, b.z, c.x) - uBias, 1.0);",
    "}"].join("\n");

  var LINE_FS = HEAD + [
    "in vec2 vLocal; flat in float vLength; out vec4 frag;",
    "uniform vec4 uColour; uniform float uHalf, uMin;",
    "void main(){",
    "  float dx = vLocal.x - clamp(vLocal.x, 0.0, vLength);",
    "  float cover = clamp(uHalf + 0.5 - length(vec2(dx, vLocal.y)), 0.0, 1.0);",
    "  // drawn in bands from solid core to faint edge; the stencil lets each pixel in once",
    "  if (cover < uMin) discard;",
    "  frag = vec4(uColour.rgb, uColour.a * cover);",
    "}"].join("\n");

  function compile(gl, vs, fs) {
    function shader(type, source) {
      var s = gl.createShader(type);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Shader: " + gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Program: " + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p: p, u: u };
  }

  function texture(gl, internal, format, type, w, h, data, filter, align) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, align || 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function buffer(gl, target, data) {
    var b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  }

  // ==== scene
  function Scene(gl) {
    this.gl = gl;
    var max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (max < 8192) throw new Error("This graphics card allows textures of only " + max + " pixels. 8192 is needed.");
    this.programs = {
      terrain: compile(gl, TERRAIN_VS, TERRAIN_FS), skirt: compile(gl, SKIRT_VS, SKIRT_FS),
      building: compile(gl, BUILDING_VS, BUILDING_FS), line: compile(gl, LINE_VS, LINE_FS)
    };
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    this.terrain = {}; this.fills = {}; this.lines = {}; this.buildings = null; this.grids = {};
    this.empty = texture(gl, gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1, 1, new Uint8Array(1), gl.LINEAR);
    this.emptyVao = gl.createVertexArray();
    this.ramp = null; this.rampKey = "";
    this.stats = {};
  }

  Scene.prototype.addBasin = function (outline, grid10) {
    var gl = this.gl;
    var sdf = G.distanceField(outline, grid10, SDF_RANGE);
    this.sdfBytes = sdf; this.sdfGrid = grid10;
    this.sdf = texture(gl, gl.R8, gl.RED, gl.UNSIGNED_BYTE, grid10.cols, grid10.rows, sdf, gl.LINEAR);
    this.sdfXf = [grid10.left, grid10.top, 1 / (grid10.cols * grid10.cell), -1 / (grid10.rows * grid10.cell)];
    var segs = G.drape(outline.xy, outline.ringStart, true, grid10, grid10.cell);
    this.lines.basin = this.makeLine(segs);
    // walls of the solid: two triangles under every outline segment
    var n = segs.length / 6, v = new Float32Array(n * 36), o = 0;
    // Shading uses the wall direction averaged over about 600 m, because the outline
    // follows raster cells and shading each 10 m facet would stripe the walls.
    var area = 0, k;
    for (k = 0; k < n * 6; k += 6) {
      area += (segs[k] - segs[0]) * (segs[k + 4] - segs[1]) - (segs[k + 3] - segs[0]) * (segs[k + 1] - segs[1]);
    }
    var turn = area > 0 ? 1 : -1, reach = Math.min(30, Math.floor(n / 4));
    function outward(j) {                    // at the start of segment j
      var from = ((j - reach) % n + n) % n * 6, to = (j + reach) % n * 6;
      var dx = segs[to] - segs[from], dy = segs[to + 1] - segs[from + 1], len = Math.hypot(dx, dy) || 1;
      return [turn * dy / len, -turn * dx / len];
    }
    function put(i, base, out) {
      v[o++] = segs[i]; v[o++] = segs[i + 1]; v[o++] = segs[i + 2]; v[o++] = base;
      v[o++] = out[0]; v[o++] = out[1];
    }
    for (var s = 0; s < n; s++) {
      var a = s * 6, b = a + 3, na = outward(s), nb = outward(s + 1);
      put(a, 0, na); put(b, 0, nb); put(b, 1, nb);
      put(a, 0, na); put(b, 1, nb); put(a, 1, na);
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer(gl, gl.ARRAY_BUFFER, v);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 16);
    gl.bindVertexArray(null);
    this.skirt = { vao: vao, count: n * 6 };
  };

  Scene.prototype.inside = function (x, y) {
    var g = this.sdfGrid;
    var c = Math.floor((x - g.left) / g.cell), r = Math.floor((g.top - y) / g.cell);
    return c >= 0 && r >= 0 && c < g.cols && r < g.rows && this.sdfBytes[r * g.cols + c] >= 128;
  };

  Scene.prototype.addTerrain = function (key, grid) {
    var gl = this.gl;
    this.grids[key] = grid;
    var tex = texture(gl, gl.R16I, gl.RED_INTEGER, gl.SHORT, grid.cols, grid.rows, grid.raw, gl.NEAREST, 2);
    var sdf = this.sdfBytes, g10 = this.sdfGrid;
    function near(c, r) {
      var x = grid.left + (c + 0.5) * grid.cell, y = grid.top - (r + 0.5) * grid.cell;
      var i = Math.floor((x - g10.left) / g10.cell), j = Math.floor((g10.top - y) / g10.cell);
      i = i < 0 ? 0 : i >= g10.cols ? g10.cols - 1 : i;
      j = j < 0 ? 0 : j >= g10.rows ? g10.rows - 1 : j;
      return sdf[j * g10.cols + i] > 0;
    }
    var chunks = [], full = null, triangles = 0;
    for (var r0 = 0; r0 < grid.rows - 1; r0 += CHUNK) {
      for (var c0 = 0; c0 < grid.cols - 1; c0 += CHUNK) {
        var nx = Math.min(CHUNK, grid.cols - 1 - c0), ny = Math.min(CHUNK, grid.rows - 1 - r0);
        var index = new Uint16Array(nx * ny * 6), k = 0, zlo = Infinity, zhi = -Infinity;
        var above = new Uint8Array(nx + 1), below = new Uint8Array(nx + 1), i;
        for (i = 0; i <= nx; i++) above[i] = near(c0 + i, r0) ? 1 : 0;
        for (var y = 0; y < ny; y++) {
          for (i = 0; i <= nx; i++) below[i] = near(c0 + i, r0 + y + 1) ? 1 : 0;
          for (var x = 0; x < nx; x++) {
            if (!(above[x] || above[x + 1] || below[x] || below[x + 1])) continue;
            var a = y * 255 + x, b = a + 255;
            index[k++] = a; index[k++] = a + 1; index[k++] = b;
            index[k++] = a + 1; index[k++] = b + 1; index[k++] = b;
            var z = grid.at(c0 + x, r0 + y);
            if (z < zlo) zlo = z;
            if (z > zhi) zhi = z;
          }
          var swap = above; above = below; below = swap;
        }
        if (!k) continue;
        var chunk = { c0: c0, r0: r0, count: k };
        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        if (k === CHUNK * CHUNK * 6) {
          if (!full) full = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, index);
          else gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, full);
        } else buffer(gl, gl.ELEMENT_ARRAY_BUFFER, index.subarray(0, k));
        gl.bindVertexArray(null);
        chunk.vao = vao;
        var x0 = grid.left + (c0 + 0.5) * grid.cell, y0 = grid.top - (r0 + 0.5) * grid.cell;
        chunk.box = [x0, y0 - ny * grid.cell, zlo - 60, x0 + nx * grid.cell, y0, zhi + 60];
        chunks.push(chunk);
        triangles += k / 3;
      }
    }
    this.terrain[key] = { grid: grid, tex: tex, chunks: chunks, triangles: triangles };
  };

  Scene.prototype.addFill = function (key, set) {
    var gl = this.gl;
    var m = G.rasterCoverage(set, FILL_CELL, 2);
    var tex = texture(gl, gl.R8, gl.RED, gl.UNSIGNED_BYTE, m.cols, m.rows, m.data, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (this.aniso) {
      gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
    var sum = 0;
    for (var i = 0; i < m.data.length; i++) sum += m.data[i];
    this.fills[key] = { tex: tex, xf: [m.left, m.top, 1 / (m.cols * m.cell), -1 / (m.rows * m.cell)],
                        area_km2: sum / 255 * m.cell * m.cell / 1e6, cols: m.cols, rows: m.rows,
                        // kept for the water surface and for the legend
                        data: m.data, cell: m.cell, set: set };
    this.lines["outline_" + key] = this.makeLine(
      G.drape(set.xy, set.ringStart, true, this.grids.terrain_10m, 10));
  };

  Scene.prototype.makeLine = function (segs) {
    var gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer(gl, gl.ARRAY_BUFFER, segs);
    for (var i = 0; i < 2; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12);
      gl.vertexAttribDivisor(i, 1);
    }
    gl.bindVertexArray(null);
    return { vao: vao, count: segs.length / 6, segs: segs };
  };

  Scene.prototype.addStreams = function (arrays, frame) {
    this.lines.streams = this.makeLine(G.drape(G.localXY(arrays.xy, frame), arrays.part_start, false,
                                                this.grids.terrain_10m, 10));
  };

  Scene.prototype.addBuildings = function (arrays, frame) {
    var gl = this.gl, grid = this.grids.terrain_10m;
    var set = G.polygonSet(arrays, frame), features = arrays.height.length;
    var nv = set.xy.length / 2, ground = new Float32Array(nv);
    var base = new Float32Array(features).fill(Infinity), roof = new Float32Array(features).fill(-Infinity);
    var p, i, f;
    this.frame = frame;
    for (p = 0; p < set.count; p++) {
      f = set.polyFeature[p];
      for (i = set.ringStart[set.polyRing[p]]; i < set.ringStart[set.polyRing[p + 1]]; i++) {
        var z = grid.height(set.xy[2 * i], set.xy[2 * i + 1]);
        ground[i] = z;
        if (z < base[f]) base[f] = z;
        if (z > roof[f]) roof[f] = z;
      }
    }
    // data texture: lowest ground, highest ground, height, source and industrial flag
    var rows = Math.ceil(features / 2048), data = new Float32Array(2048 * rows * 4);
    for (f = 0; f < features; f++) {
      data[4 * f] = base[f]; data[4 * f + 1] = roof[f];
      data[4 * f + 2] = arrays.source[f] === 2 ? -1 : arrays.height[f];
      data[4 * f + 3] = arrays.source[f] + 4 * arrays.industrial[f];
    }
    var tex = texture(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT, 2048, rows, data, gl.NEAREST, 4);
    // vertices: bottom and top copy of every ring vertex
    var vbuf = new ArrayBuffer(nv * 2 * 16), vf = new Float32Array(vbuf), vu = new Uint32Array(vbuf);
    for (p = 0; p < set.count; p++) {
      f = set.polyFeature[p];
      for (i = set.ringStart[set.polyRing[p]]; i < set.ringStart[set.polyRing[p + 1]]; i++) {
        for (var t = 0; t < 2; t++) {
          var o = (2 * i + t) * 4;
          vf[o] = set.xy[2 * i]; vf[o + 1] = set.xy[2 * i + 1]; vf[o + 2] = ground[i];
          vu[o + 3] = f * 2 + t;
        }
      }
    }
    // group by map square so parts outside a view or tile are skipped
    var order = new Array(set.count), keys = new Int32Array(set.count);
    for (p = 0; p < set.count; p++) {
      var s = set.ringStart[set.polyRing[p]];
      keys[p] = (Math.floor(set.xy[2 * s + 1] / BUILDING_BIN) + 500) * 1000 +
                Math.floor(set.xy[2 * s] / BUILDING_BIN) + 500;
      order[p] = p;
    }
    order.sort(function (a, b) { return keys[a] - keys[b] || a - b; });
    var index = new Uint32Array(nv * 6 + (nv + set.count * 2 + 8000) * 3), k = 0, bins = [], bin = null;
    var roofTriangles = 0, tri = [];
    for (var q = 0; q < order.length; q++) {
      p = order[q];
      if (!bin || bin.key !== keys[p]) {
        bin = { key: keys[p], start: k, count: 0, polys: [],
                box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
        bins.push(bin);
      }
      f = set.polyFeature[p];
      bin.polys.push(p);
      var first = set.polyRing[p], last = set.polyRing[p + 1], origin = set.ringStart[first];
      for (var r = first; r < last; r++) {
        var a0 = set.ringStart[r], a1 = set.ringStart[r + 1];
        for (i = a0; i < a1; i++) {
          var j = i + 1 < a1 ? i + 1 : a0;
          index[k++] = 2 * i; index[k++] = 2 * j; index[k++] = 2 * j + 1;
          index[k++] = 2 * i; index[k++] = 2 * j + 1; index[k++] = 2 * i + 1;
          var x = set.xy[2 * i], y = set.xy[2 * i + 1], box = bin.box;
          if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (base[f] - 2 < box[2]) box[2] = base[f] - 2;
          if (x > box[3]) box[3] = x; if (y > box[4]) box[4] = y; if (roof[f] + 100 > box[5]) box[5] = roof[f] + 100;
        }
      }
      tri.length = 0;
      G.triangulate(set, p, tri);
      for (i = 0; i < tri.length; i++) index[k++] = 2 * (origin + tri[i]) + 1;
      roofTriangles += tri.length / 3;
      bin.count = k - bin.start;
    }
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer(gl, gl.ARRAY_BUFFER, vbuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 16, 12);
    buffer(gl, gl.ELEMENT_ARRAY_BUFFER, index.subarray(0, k));
    gl.bindVertexArray(null);
    this.buildings = { vao: vao, tex: tex, bins: bins, features: features, set: set,
                       triangles: k / 3, roofTriangles: roofTriangles,
                       // kept for the cut faces of the section box
                       base: base, roof: roof, height: arrays.height, source: arrays.source,
                       industrial: arrays.industrial };
  };

  Scene.prototype.setRamp = function (t) {
    var key = [t.low_colour, t.mid_colour, t.high_colour, t.low_m, t.mid_m, t.high_m].join("|");
    if (key === this.rampKey) return;
    var gl = this.gl, data = new Uint8Array(256 * 4);
    var a = POYO.hexToRgb(t.low_colour), b = POYO.hexToRgb(t.mid_colour), c = POYO.hexToRgb(t.high_colour);
    var span = Math.max(1, t.high_m - t.low_m), mid = POYO.clamp(t.mid_m, t.low_m, t.high_m);
    for (var i = 0; i < 256; i++) {
      var h = t.low_m + span * i / 255, from = a, to = b;
      var k = mid > t.low_m ? (h - t.low_m) / (mid - t.low_m) : 1;
      if (h > mid) { from = b; to = c; k = t.high_m > mid ? (h - mid) / (t.high_m - mid) : 1; }
      k = POYO.clamp(k, 0, 1);
      for (var n = 0; n < 3; n++) data[4 * i + n] = Math.round(255 * (from[n] + (to[n] - from[n]) * k));
      data[4 * i + 3] = 255;
    }
    if (this.ramp) gl.deleteTexture(this.ramp);
    this.ramp = texture(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 256, 1, data, gl.LINEAR);
    this.rampKey = key;
  };

  // true when a box is at least partly inside the tile
  function visible(m, tile, box) {
    var left = 0, right = 0, below = 0, above = 0;
    for (var i = 0; i < 8; i++) {
      var x = box[i & 1 ? 3 : 0], y = box[i & 2 ? 4 : 1], z = box[i & 4 ? 5 : 2];
      var cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) * tile[0] + tile[2];
      var cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) * tile[1] + tile[3];
      if (cx < -1.02) left++; if (cx > 1.02) right++;
      if (cy < -1.02) below++; if (cy > 1.02) above++;
    }
    return left < 8 && right < 8 && below < 8 && above < 8;
  }

  Scene.prototype.bounds = function (state) {
    var g = this.grids.terrain_10m;
    return { min: [g.left, g.top - g.rows * g.cell, Math.min(-20, state.terrain.datum_m)],
             max: [g.left + g.cols * g.cell, g.top, 1200] };
  };

  // o: state, size {width,height} of the full page in pixels, mpp, tile [sx,sy,ox,oy],
  //    pxPerMm, cell (10 or 20), clear [r,g,b,a]
  Scene.prototype.render = function (o) {
    if (POYO.styles.isPlain(o.state)) this.renderPlain(o);
    else POYO.styles.render(this, o);
  };

  // The Stage 1 picture. Left as it was, so Stage 1 sidecars reproduce their pixels.
  Scene.prototype.renderPlain = function (o) {
    var gl = this.gl, s = o.state, v = s.view, L = s.layers, T = s.terrain, P = this.programs;
    this.setRamp(T);
    var cam = POYO.camera.matrix(v, o.size, o.mpp, this.bounds(s));
    var m = cam.m, tile = o.tile;
    var az = T.light_azimuth * POYO.DEG, alt = T.light_altitude * POYO.DEG;
    var light = [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];
    var toViewer = [-cam.basis.f[0], -cam.basis.f[1], -cam.basis.f[2]];

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var c = o.clear;
    gl.clearColor(c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]);
    gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    var self = this;
    // depth first for see-through layers, so back faces do not add up
    function solidOrGlass(translucent, draw) {
      if (!translucent) { draw(); return; }
      gl.colorMask(false, false, false, false); draw();
      gl.colorMask(true, true, true, true); gl.depthMask(false); draw(); gl.depthMask(true);
    }

    // fills, bottom to top
    var fills = s.fill_order.map(function (name) {
      if (name === "rivers") {
        if (!L.rivers.visible || !self.fills.rivers) return null;
        return { f: self.fills.rivers, colour: L.rivers.colour, a: L.rivers.opacity, layer: L.rivers, key: "rivers" };
      }
      if (L.flood.source === "none") return null;
      var key = L.flood.source;
      if (!self.fills[key]) return null;
      return { f: self.fills[key], colour: key === "satellite" ? L.flood.satellite_colour : L.flood.at2200_colour,
               a: L.flood.opacity, layer: L.flood, key: key };
    });

    // walls of the solid
    if (L.terrain.visible && this.skirt) {
      var sk = P.skirt;
      gl.useProgram(sk.p);
      gl.uniformMatrix4fv(sk.u.uMat, false, m);
      gl.uniform4fv(sk.u.uTile, tile);
      gl.uniform1f(sk.u.uDatum, T.datum_m);
      var base = POYO.hexToRgb(T.base_colour);
      gl.uniform4f(sk.u.uColour, base[0], base[1], base[2], L.terrain.opacity);
      gl.uniform3fv(sk.u.uLight, light);
      gl.bindVertexArray(this.skirt.vao);
      solidOrGlass(L.terrain.opacity < 1, function () { gl.drawArrays(gl.TRIANGLES, 0, self.skirt.count); });
    }

    // ground with the water and flood fills painted on it
    var key = o.cell === 20 ? "terrain_20m" : "terrain_10m";
    var mesh = this.terrain[key];
    if (mesh && (L.terrain.visible || fills[0] || fills[1])) {
      var tp = P.terrain, g = mesh.grid;
      gl.useProgram(tp.p);
      gl.uniformMatrix4fv(tp.u.uMat, false, m);
      gl.uniform4fv(tp.u.uTile, tile);
      gl.uniform2i(tp.u.uSize, g.cols, g.rows);
      gl.uniform2f(tp.u.uOrigin, g.left + 0.5 * g.cell, g.top - 0.5 * g.cell);
      gl.uniform1f(tp.u.uCell, g.cell);
      gl.uniform2f(tp.u.uCode, g.scale, g.offset);
      gl.uniform1f(tp.u.uRelief, T.shading_relief);
      gl.uniform2f(tp.u.uRampRange, T.low_m, Math.max(T.low_m + 1, T.high_m));
      gl.uniform3fv(tp.u.uLight, light);
      gl.uniform1f(tp.u.uShade, T.hillshade);
      gl.uniform1f(tp.u.uFlat, Math.sin(alt));
      gl.uniform1f(tp.u.uOpacity, L.terrain.opacity);
      gl.uniform1f(tp.u.uGround, L.terrain.visible ? 1 : 0);
      gl.uniform4fv(tp.u.uSdfXf, this.sdfXf);
      var units = [["uHeight", mesh.tex], ["uSdf", this.sdf], ["uRamp", this.ramp],
                   ["uFill0", fills[0] ? fills[0].f.tex : this.empty],
                   ["uFill1", fills[1] ? fills[1].f.tex : this.empty]];
      for (var i = 0; i < units.length; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, units[i][1]);
        gl.uniform1i(tp.u[units[i][0]], i);
      }
      gl.activeTexture(gl.TEXTURE0);
      for (var n = 0; n < 2; n++) {
        var fl = fills[n], col = fl ? POYO.hexToRgb(fl.colour) : [0, 0, 0];
        gl.uniform4f(tp.u["uColour" + n], col[0], col[1], col[2], fl ? fl.a : 0);
        gl.uniform4fv(tp.u["uFillXf" + n], fl ? fl.f.xf : [0, 0, 1, 1]);
      }
      var seen = mesh.chunks.filter(function (ch) { return visible(m, tile, ch.box); });
      var see = !L.terrain.visible || L.terrain.opacity < 1;
      solidOrGlass(see, function () {
        for (var q = 0; q < seen.length; q++) {
          gl.uniform2i(tp.u.uChunk, seen[q].c0, seen[q].r0);
          gl.bindVertexArray(seen[q].vao);
          gl.drawElements(gl.TRIANGLES, seen[q].count, gl.UNSIGNED_SHORT, 0);
        }
      });
    }

    var B = L.buildings, bl = this.buildings;
    function drawBuildings() {
      var bp = P.building;
      gl.useProgram(bp.p);
      gl.uniformMatrix4fv(bp.u.uMat, false, m);
      gl.uniform4fv(bp.u.uTile, tile);
      gl.uniform3f(bp.u.uCentre, v.target[0], v.target[1], 0);
      gl.uniform1f(bp.u.uVe, v.ve);
      gl.uniform1f(bp.u.uDefault, B.default_height_m);
      gl.uniform1f(bp.u.uIndustrial, B.industrial_height_m);
      gl.uniform1f(bp.u.uFlat, B.flat ? 1 : 0);
      gl.uniform1f(bp.u.uBias, 12 / cam.depthHalf);
      var cols = [B.floors_colour, B.explicit_colour, B.none_colour].map(POYO.hexToRgb);
      gl.uniform3fv(bp.u.uColours, [].concat(cols[0], cols[1], cols[2]));
      gl.uniform3fv(bp.u.uLight, light);
      gl.uniform3fv(bp.u.uToViewer, toViewer);
      gl.uniform1f(bp.u.uOpacity, B.opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bl.tex);
      gl.uniform1i(bp.u.uData, 0);
      gl.bindVertexArray(bl.vao);
      var seen = bl.bins.filter(function (bin) { return visible(m, tile, bin.box); });
      solidOrGlass(B.opacity < 1, function () {
        for (var q = 0; q < seen.length; q++) gl.drawElements(gl.TRIANGLES, seen[q].count, gl.UNSIGNED_INT, seen[q].start * 4);
      });
    }
    if (bl && B.visible && B.opacity >= 1) drawBuildings();

    // lines: fill outlines first, then the line layers in their order
    var list = [];
    fills.forEach(function (fl) {
      if (fl && fl.layer.outline) {
        list.push({ line: self.lines["outline_" + fl.key], colour: fl.layer.outline_colour,
                    a: fl.layer.opacity, mm: fl.layer.outline_mm });
      }
    });
    s.line_order.forEach(function (name) {
      var l = L[name];
      if (l.visible) list.push({ line: self.lines[name], colour: l.colour, a: l.opacity, mm: l.width_mm });
    });
    var lp = P.line;
    gl.useProgram(lp.p);
    gl.uniformMatrix4fv(lp.u.uMat, false, m);
    gl.uniform4fv(lp.u.uTile, tile);
    gl.uniform2f(lp.u.uPage, o.size.width, o.size.height);
    gl.depthMask(false);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    list.forEach(function (item, index) {
      if (!item.line || !item.line.count || item.mm <= 0 || item.a <= 0) return;
      var width = item.mm * o.pxPerMm, rgb = POYO.hexToRgb(item.colour);
      gl.uniform1f(lp.u.uHalf, Math.max(width / 2, 0.5));
      gl.uniform4f(lp.u.uColour, rgb[0], rgb[1], rgb[2], item.a * Math.min(1, width));
      gl.uniform1f(lp.u.uBias, (1.5 * width * o.mpp + 15) / cam.depthHalf);
      gl.stencilFunc(gl.NOTEQUAL, index + 1, 0xff);
      gl.bindVertexArray(item.line.vao);
      var bands = o.cell === 20 ? DRAFT_BANDS : BANDS;
      for (var q = 0; q < bands.length; q++) {
        gl.uniform1f(lp.u.uMin, bands[q]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, item.line.count);
      }
    });
    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(true);

    if (bl && B.visible && B.opacity < 1 && B.opacity > 0) drawBuildings();
    gl.bindVertexArray(null);
  };

  POYO.render = { Scene: Scene, FILL_CELL: FILL_CELL, SDF_RANGE: SDF_RANGE, HEAD: HEAD, TERRAIN_VS: TERRAIN_VS,
                  BANDS: BANDS, DRAFT_BANDS: DRAFT_BANDS, compile: compile, texture: texture, buffer: buffer,
                  visible: visible };
})();
