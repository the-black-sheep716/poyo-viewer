// styles.js: the section box and the render styles. Used only when something differs
// from the plain Stage 1 picture; render.js keeps that path unchanged.
"use strict";
(function () {
  var R = POYO.render;
  var HEAD = R.HEAD;
  var CODE = { shaded: 0, flat: 1, white: 2, outline: 3, contours: 4, wireframe: 5, xray: 6 };
  var BASE = { paper: 0, ramp: 1, shaded: 2, none: 3 };
  var FILL = { solid: 0, hatch: 1, none: 2 };
  var MARGIN = 8;                      // spare pixels around a tile for the outline pass

  // ==== shared shader parts
  var CLIP = [
    "uniform int uClip; uniform vec3 uBoxMin, uBoxMax;",
    "bool clipped(vec3 p){",
    "  if (uClip == 0) return false;",
    "  bool within = all(greaterThanEqual(p, uBoxMin)) && all(lessThanEqual(p, uBoxMax));",
    "  return uClip == 1 ? !within : within;",
    "}"].join("\n");

  var STROKE = [
    "float stroke(float dist, float width){",
    "  return clamp(max(width, 1.0) * 0.5 + 0.5 - dist, 0.0, 1.0) * min(1.0, width);",
    "}",
    "// lines thin out and disappear where they would merge into a tone",
    "float thin(float spacing, float width){",
    "  float w = max(width, 1.0); return clamp((spacing - 1.6 * w) / (2.0 * w), 0.0, 1.0);",
    "}"].join("\n");

  var CONTOUR = [
    "uniform vec4 uContour;             // interval m, index every n, width px, index width px",
    "float contour(float z, float perPixel){",
    "  if (perPixel < 1e-5) return 0.0;  // level ground carries no line",
    "  float step_ = uContour.x;",
    "  float c = stroke(abs(z - step_ * floor(z / step_ + 0.5)) / perPixel, uContour.z) * thin(step_ / perPixel, uContour.z);",
    "  if (uContour.y >= 1.0) {",
    "    float big = step_ * uContour.y;",
    "    c = max(c, stroke(abs(z - big * floor(z / big + 0.5)) / perPixel, uContour.w) * thin(big / perPixel, uContour.w));",
    "  }",
    "  return c;",
    "}"].join("\n");

  var GRID = [
    "uniform vec4 uWire;                // spacing m, width px, offset x, offset y",
    "float gridLines(vec2 p, vec2 perPixel){",
    "  float s = uWire.x; vec2 q = p + uWire.zw; vec2 g = max(perPixel, vec2(1e-5));",
    "  vec2 d = abs(q - s * floor(q / s + 0.5)) / g;",
    "  float a = perPixel.x < 1e-5 ? 0.0 : stroke(d.x, uWire.y) * thin(s / g.x, uWire.y);",
    "  float b = perPixel.y < 1e-5 ? 0.0 : stroke(d.y, uWire.y) * thin(s / g.y, uWire.y);",
    "  return max(a, b);",
    "}"].join("\n");

  var ENCODE = [
    "#ifdef GBUF",
    "out uvec4 frag;",
    "uniform vec3 uBasisR, uBasisU, uBasisF;",
    "uvec4 encode(vec3 n, uint id){",
    "  vec3 v = vec3(dot(uBasisR, n), dot(uBasisU, n), dot(uBasisF, n));",
    "  if (v.z > 0.0) v = -v;",
    "  return uvec4(uvec3(clamp(v * 127.0 + 128.0, 0.0, 255.0)), id);",
    "}",
    "#else",
    "out vec4 frag;",
    "#endif"].join("\n");

  // ==== painted ground: class grids looked up through a palette, and the road texture
  var PAINT = [
    "#ifdef PAINT",
    "precision highp usampler2DArray;",
    "uniform usampler2DArray uClass0, uClass1;",
    "uniform sampler2D uPal0, uPal1, uRoads;",
    "uniform vec4 uGridXf;              // west edge, north edge, cells per metre, tiles across",
    "uniform ivec2 uGridSize, uPaintOn;",
    "uniform vec2 uPaintAlpha, uBoundPx;",
    "uniform vec3 uBoundColour; uniform vec4 uRoadXf; uniform float uRoadAlpha, uPaintShade;",
    "// symbols of the planned use classes, sizes in millimetres on the page",
    "uniform sampler2D uSym; uniform int uSymOn, uPatPage; uniform float uPatScale; uniform vec4 uUnder, uPageMap;",
    "uniform int uSmooth;",
    "vec4 comp(vec4 under, vec4 top){ return top + under * (1.0 - top.a); }",
    "vec4 tint(vec4 c, float a){ return vec4(c.rgb, 1.0) * (c.a * a); }",
    "float segment(vec2 p, vec2 a, vec2 b){ vec2 q = p - a, d = b - a; return length(q - d * clamp(dot(q, d) / dot(d, d), 0.0, 1.0)); }",
    "float markSdf(int m, vec2 p, float r){",
    "  if (m == 1) {",
    "    float k = 1.7320508, h = r * 0.8660254; p.y = -p.y; p.x = abs(p.x) - h; p.y += h / k;",
    "    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;",
    "    p.x -= clamp(p.x, -2.0 * h, 0.0); return -length(p) * sign(p.y);",
    "  }",
    "  if (m == 2) return max(abs(p.x), abs(p.y)) - r;",
    "  if (m == 3) return (abs(p.x) + abs(p.y) - r) * 0.7071068;",
    "  if (m == 5) p = vec2(p.x + p.y, p.y - p.x) * 0.7071068;",
    "  if (m >= 4) return min(segment(p, vec2(-r, 0.0), vec2(r, 0.0)), segment(p, vec2(0.0, -r), vec2(0.0, r)));",
    "  return length(p) - r;",
    "}",
    "float span(float t, float a, float b, float pw){ return b > a ? clamp(min(t - a, b - t) / pw + 0.5, 0.0, 1.0) : 0.0; }",
    "vec4 symbolAt(int k, vec2 pm, float pw){",
    "  if (k == 0) return vec4(0.0);",
    "  vec4 sum = uUnder;",
    "  int n = int(texelFetch(uSym, ivec2(0, k), 0).r + 0.5);",
    "  for (int j = 0; j < 4; j++) {",
    "    if (j >= n) break;",
    "    int at = 1 + j * 5;",
    "    vec4 p0 = texelFetch(uSym, ivec2(at, k), 0), p1 = texelFetch(uSym, ivec2(at + 1, k), 0);",
    "    vec4 c1 = texelFetch(uSym, ivec2(at + 2, k), 0), c2 = texelFetch(uSym, ivec2(at + 3, k), 0);",
    "    vec4 p4 = texelFetch(uSym, ivec2(at + 4, k), 0);",
    "    if (p0.x < 1.5) { sum = comp(sum, tint(c1, 1.0)); continue; }",
    "    if (p0.x < 2.5) {",
    "      float ca = cos(p0.y), sa = sin(p0.y); vec2 cell = p0.zw; float r = p1.x; int m = int(p1.y + 0.5);",
    "      float sw = p1.w > 0.0 ? p1.w : max(pw, 0.085), thin = p1.w > 0.0 ? 1.0 : 0.7;   // hairlines print light",
    "      vec2 q = vec2(ca * pm.x + sa * pm.y, -sa * pm.x + ca * pm.y);",
    "      q.x -= p4.x * mod(floor(q.y / cell.y + 0.5), 2.0);",
    "      vec2 l = q - cell * floor(q / cell + 0.5);",
    "      vec2 s = vec2(ca * l.x - sa * l.y, sa * l.x + ca * l.y);",
    "      float ct = cos(p1.z), st = sin(p1.z);",
    "      float d = markSdf(m, vec2(ct * s.x + st * s.y, -st * s.x + ct * s.y), r);",
    "      float f = m < 4 ? clamp(0.5 - d / pw, 0.0, 1.0) : 0.0;",
    "      float e = clamp(0.5 - (abs(d) - 0.5 * max(sw, pw)) / pw, 0.0, 1.0) * min(1.0, sw / pw) * thin;",
    "      vec4 sharp = comp(tint(c1, f), tint(c2, e));",
    "      float area = m == 1 ? 1.299 * r * r : m == 2 ? 4.0 * r * r : m == 3 ? 2.0 * r * r : m >= 4 ? 0.0 : 3.1416 * r * r;",
    "      float round_ = m == 1 ? 5.196 * r : m == 2 ? 8.0 * r : m == 3 ? 5.657 * r : m >= 4 ? 4.0 * r : 6.2832 * r;",
    "      float per = cell.x * cell.y, least = min(cell.x, cell.y);",
    "      vec4 even_ = comp(tint(c1, min(1.0, area / per)), tint(c2, min(1.0, thin * round_ * sw / per)));",
    "      sum = comp(sum, mix(sharp, even_, clamp((pw - 0.25 * least) / (0.25 * least), 0.0, 1.0)));",
    "      continue;",
    "    }",
    "    float gap = p0.z, wide = p0.w;",
    "    float across = dot(pm, vec2(sin(p0.y), cos(p0.y))) - p1.x;",
    "    float d = abs(across - gap * floor(across / gap + 0.5));",
    "    float c = clamp(0.5 - (d - 0.5 * max(wide, pw)) / pw, 0.0, 1.0) * min(1.0, wide / pw);",
    "    float duty = 1.0;",
    "    if (p4.w > 0.0) {",
    "      float period = p4.w * wide, t = mod(dot(pm, vec2(cos(p0.y), -sin(p0.y))), period);",
    "      float a1 = p1.y * wide, b0 = a1 + p1.z * wide, b1 = b0 + p1.w * wide, d0 = b1 + p4.x * wide, d1 = d0 + p4.y * wide;",
    "      float on = max(max(span(t, 0.0, a1, pw), span(t, period, period + a1, pw)), max(span(t, b0, b1, pw), span(t, d0, d1, pw)));",
    "      duty = (p1.y + p1.w + p4.y) / p4.w;",
    "      c *= mix(on, duty, clamp((pw - 0.5 * wide) / wide, 0.0, 1.0));",
    "    }",
    "    float flat_ = min(1.0, wide / gap) * duty;",
    "    sum = comp(sum, tint(c1, mix(c, flat_, clamp((pw - 0.25 * gap) / (0.25 * gap), 0.0, 1.0))));",
    "  }",
    "  return sum;",
    "}",
    "int cls(usampler2DArray t, ivec2 c){",
    "  if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, uGridSize))) return 0;",
    "  return int(texelFetch(t, ivec3(c.x & 2047, c.y & 2047, (c.y >> 11) * int(uGridXf.w) + (c.x >> 11)), 0).r);",
    "}",
    "vec4 pal(sampler2D t, int k){ vec4 v = texelFetch(t, ivec2(k, 0), 0); return vec4(v.rgb * v.a, v.a); }",
    "// The edge between two classes is placed from the four nearest cells, so it stays",
    "// smooth when a cell covers many pixels. Where a pixel covers many cells it is averaged.",
    "vec4 look(sampler2D table, int k, bool sym, vec2 pm, float pw){ return sym ? symbolAt(k, pm, pw) : pal(table, k); }",
    "vec4 paint(usampler2DArray t, sampler2D table, vec2 g, vec2 dx, vec2 dy, float boundPx, bool sym, bool fine, vec2 pm,",
    "           float pw, out float line){",
    "  float cpp = max(length(dx), length(dy));",
    "  line = 0.0;",
    "  if (cpp >= 1.0) {",
    "    vec4 sum = look(table, cls(t, ivec2(floor(g - 0.375 * dx - 0.125 * dy))), sym, pm, pw)",
    "             + look(table, cls(t, ivec2(floor(g + 0.125 * dx - 0.375 * dy))), sym, pm, pw)",
    "             + look(table, cls(t, ivec2(floor(g + 0.375 * dx + 0.125 * dy))), sym, pm, pw)",
    "             + look(table, cls(t, ivec2(floor(g - 0.125 * dx + 0.375 * dy))), sym, pm, pw);",
    "    return sum * 0.25;",
    "  }",
    "  vec2 h = g - 0.5;",
    "  int k[9]; float w[9]; int n = 4;",
    "  if (sym || fine) {                                 // 3 by 3 cells, smoother diagonal edges",
    "    ivec2 mid = ivec2(floor(g)); vec2 s = h - vec2(mid);",
    "    vec3 wx = vec3(0.5 * (0.5 - s.x) * (0.5 - s.x), 0.75 - s.x * s.x, 0.5 * (0.5 + s.x) * (0.5 + s.x));",
    "    vec3 wy = vec3(0.5 * (0.5 - s.y) * (0.5 - s.y), 0.75 - s.y * s.y, 0.5 * (0.5 + s.y) * (0.5 + s.y));",
    "    n = 9;",
    "    for (int i = 0; i < 9; i++) { k[i] = cls(t, mid + ivec2(i % 3 - 1, i / 3 - 1)); w[i] = wx[i % 3] * wy[i / 3]; }",
    "  } else {",
    "    ivec2 i0 = ivec2(floor(h)); vec2 f = h - floor(h);",
    "    k[0] = cls(t, i0); k[1] = cls(t, i0 + ivec2(1,0)); k[2] = cls(t, i0 + ivec2(0,1)); k[3] = cls(t, i0 + ivec2(1,1));",
    "    w[0] = (1.0 - f.x) * (1.0 - f.y); w[1] = f.x * (1.0 - f.y); w[2] = (1.0 - f.x) * f.y; w[3] = f.x * f.y;",
    "  }",
    "  int a = k[0], b = k[0]; float wa = -1.0, wb = 0.0;",
    "  for (int i = 0; i < n; i++) {",
    "    float s = 0.0; for (int j = 0; j < n; j++) if (k[j] == k[i]) s += w[j];",
    "    if (s > wa) { wa = s; a = k[i]; }",
    "  }",
    "  for (int i = 0; i < n; i++) {",
    "    if (k[i] == a) continue;",
    "    float s = 0.0; for (int j = 0; j < n; j++) if (k[j] == k[i]) s += w[j];",
    "    if (s > wb) { wb = s; b = k[i]; }",
    "  }",
    "  vec4 ca = look(table, a, sym, pm, pw);",
    "  if (wb <= 0.0) return ca;",
    "  float d = (wa - wb) * 0.5 / max(cpp, 1e-4);        // distance to the edge in pixels",
    "  vec4 cb = look(table, b, sym, pm, pw);",
    "  if (boundPx > 0.0 && (sym ? texelFetch(uSym, ivec2(0, a), 0).g != texelFetch(uSym, ivec2(0, b), 0).g : ca != cb)) {",
    "    line = clamp(max(boundPx, 1.0) * 0.5 + 0.5 - d, 0.0, 1.0) * min(1.0, boundPx) * clamp(2.0 - 2.0 * cpp, 0.0, 1.0);",
    "  }",
    "  return mix(cb, ca, clamp(0.5 + d, 0.0, 1.0));",
    "}",
    "#endif"].join("\n");

  // ==== ground
  var TERRAIN_FS = [CLIP, STROKE, CONTOUR, GRID, ENCODE, PAINT,
    "in vec3 vPos; in vec3 vNormal;",
    "uniform sampler2D uSdf, uRamp, uFill0, uFill1;",
    "uniform vec4 uSdfXf, uFillXf0, uFillXf1, uColour0, uColour1, uPaper;",
    "uniform vec3 uWhite0, uWhite1, uLight, uFlatColour, uWhite, uToViewer, uContourColour, uWireColour;",
    "uniform vec2 uRampRange; uniform float uShade, uFlat, uOpacity, uGround, uVe, uXray;",
    "uniform int uStyle, uFillStyle0, uFillStyle1, uBase;",
    "float fillAlpha(sampler2D tex, vec4 xf){",
    "  vec2 uv = (vPos.xy - xf.xy) * xf.zw;",
    "  vec2 size = vec2(textureSize(tex, 0));",
    "  float perPixel = max(length(dFdx(uv * size)), length(dFdy(uv * size)));",
    "  float a = texture(tex, uv).r;",
    "  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);",
    "  return inside * mix(a, smoothstep(0.25, 0.75, a), clamp(1.5 - perPixel * 1.5, 0.0, 1.0));",
    "}",
    "void over(inout vec3 p, inout float pa, vec3 c, float a){ p = c * a + p * (1.0 - a); pa = a + pa * (1.0 - a); }",
    "void main(){",
    "  float a0 = fillAlpha(uFill0, uFillXf0) * uColour0.a;",
    "  float a1 = fillAlpha(uFill1, uFillXf1) * uColour1.a;",
    "  vec3 q = vec3(vPos.xy, vPos.z * uVe);",
    "  vec3 face = normalize(cross(dFdx(q), dFdy(q)));",
    "  float gz = length(vec2(dFdx(vPos.z), dFdy(vPos.z)));",
    "  vec2 gxy = vec2(length(vec2(dFdx(vPos.x), dFdy(vPos.x))), length(vec2(dFdx(vPos.y), dFdy(vPos.y))));",
    "  float level = contour(vPos.z, gz), grid_ = gridLines(vPos.xy, gxy);",
    "#ifdef PAINT",
    "  vec2 at = vec2(vPos.x - uGridXf.x, uGridXf.y - vPos.y) * uGridXf.z;",
    "  vec2 atDx = dFdx(at), atDy = dFdy(at);",
    "  vec2 pm = uPatPage == 1 ? gl_FragCoord.xy * uPageMap.xy + uPageMap.zw : vec2(vPos.x, -vPos.y) * uPatScale;",
    "  float pw = max(max(length(dFdx(pm)), length(dFdy(pm))), 1e-4);",
    "#endif",
    "  if (texture(uSdf, (vPos.xy - uSdfXf.xy) * uSdfXf.zw).r < 0.5) discard;",
    "  if (clipped(vPos)) discard;",
    "#ifdef GBUF",
    "  frag = encode(face, 1u);",
    "#else",
    "  float t = clamp((vPos.z - uRampRange.x) / (uRampRange.y - uRampRange.x), 0.0, 1.0);",
    "  vec3 ramp = texture(uRamp, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb;",
    "  float lit = dot(normalize(vNormal), uLight);",
    "  float k = clamp(1.0 + uShade * (lit - uFlat) * 1.2, 0.3, 1.12);",
    "  float kw = clamp(0.93 + uShade * (lit - uFlat) * 0.9, 0.5, 1.0);",
    "  vec3 shaded = clamp(ramp * k, 0.0, 1.0);",
    "  vec4 base = vec4(shaded, 1.0);",
    "  if (uStyle == 1) base = vec4(uFlatColour, 1.0);",
    "  else if (uStyle == 2) base = vec4(uWhite * kw, 1.0);",
    "  else if (uStyle == 3) base = uPaper;",
    "  else if (uStyle == 4) base = uBase == 0 ? uPaper : uBase == 1 ? vec4(ramp, 1.0) : uBase == 2 ? vec4(shaded, 1.0) : vec4(0.0);",
    "  else if (uStyle == 5) base = vec4(0.0);",
    "  else if (uStyle == 6) {",
    "    float edge = 1.0 - abs(dot(face, uToViewer));",
    "    base = vec4(shaded, clamp(uXray * mix(0.5, 2.0, edge * edge), 0.0, 1.0));",
    "  }",
    "  float pa = uGround * uOpacity * base.a; vec3 p = base.rgb * pa;",
    "#ifdef PAINT",
    "  if (uStyle != 5) {",
    "    float tone = mix(1.0, uStyle == 2 ? kw : k, uPaintShade);",
    "    float strength = uGround * uOpacity * (uStyle == 6 ? uXray : 1.0);",
    "    for (int s = 0; s < 2; s++) {",
    "      if (uPaintOn[s] == 0) continue;",
    "      float line;",
    "      vec4 v = s == 0 ? paint(uClass0, uPal0, at, atDx, atDy, uBoundPx.x, uSymOn == 1, uSmooth == 1, pm, pw, line)",
    "                      : paint(uClass1, uPal1, at, atDx, atDy, uBoundPx.y, false, false, pm, pw, line);",
    "      float f = uPaintAlpha[s] * strength;",
    "      p = clamp(v.rgb * tone, 0.0, 1.0) * f + p * (1.0 - v.a * f); pa = v.a * f + pa * (1.0 - v.a * f);",
    "      if (line > 0.0) over(p, pa, uBoundColour, line * strength);",
    "    }",
    "    if (uRoadAlpha > 0.0) {",
    "      vec2 uv = (vPos.xy - uRoadXf.xy) * uRoadXf.zw;",
    "      if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {",
    "        vec4 road = textureLod(uRoads, uv, 0.0);",
    "        float f = uRoadAlpha * strength;",
    "        p = clamp(road.rgb * tone, 0.0, 1.0) * f + p * (1.0 - road.a * f); pa = road.a * f + pa * (1.0 - road.a * f);",
    "      }",
    "    }",
    "  }",
    "#endif",
    "  for (int i = 0; i < 2; i++) {",
    "    int fs = i == 0 ? uFillStyle0 : uFillStyle1;",
    "    vec3 c = i == 0 ? uColour0.rgb : uColour1.rgb; float a = i == 0 ? a0 : a1;",
    "    if (fs == 1) c = clamp(c * k, 0.0, 1.0);",
    "    else if (fs == 2) c = (i == 0 ? uWhite0 : uWhite1) * kw;",
    "    else if (fs == 3) a = 0.0;",
    "    else if (fs == 4) a *= level;",
    "    else if (fs == 5) a *= grid_;",
    "    else if (fs == 6) a *= uXray;",
    "    over(p, pa, c, a);",
    "  }",
    "  if (uStyle == 4) over(p, pa, uContourColour, level * uGround * uOpacity);",
    "  if (uStyle == 5) over(p, pa, uWireColour, grid_ * uGround * uOpacity);",
    "  // surfaces that hide others must keep writing depth even when they show nothing",
    "  if (pa < 0.003 && (uStyle >= 5 || uGround < 0.5)) discard;",
    "  frag = vec4(pa > 0.0 ? p / pa : vec3(0.0), pa);",
    "#endif",
    "}"].join("\n");

  var SKIRT_VS = [
    "layout(location=0) in vec4 aPos; layout(location=1) in vec2 aOut;",
    "uniform mat4 uMat; uniform vec4 uTile; uniform float uDatum; out vec2 vOut; out vec3 vPos;",
    "void main(){",
    "  vec3 p = vec3(aPos.xy, aPos.w > 0.5 ? min(uDatum, aPos.z) : aPos.z);",
    "  vOut = aOut; vPos = p;",
    "  vec4 q = uMat * vec4(p, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z, 1.0);",
    "}"].join("\n");

  var SKIRT_FS = [CLIP, STROKE, CONTOUR, GRID, ENCODE,
    "in vec2 vOut; in vec3 vPos;",
    "uniform vec4 uColour, uPaper; uniform vec3 uLight, uWhite, uContourColour, uWireColour;",
    "uniform float uXray, uVe; uniform int uStyle, uBase;",
    "void main(){",
    "  float gz = length(vec2(dFdx(vPos.z), dFdy(vPos.z)));",
    "  vec2 gxy = vec2(length(vec2(dFdx(vPos.x), dFdy(vPos.x))), length(vec2(dFdx(vPos.y), dFdy(vPos.y))));",
    "  float level = contour(vPos.z, gz), grid_ = gridLines(vPos.xy, gxy);",
    "  vec3 q = vec3(vPos.xy, vPos.z * uVe);",
    "  vec3 face = normalize(cross(dFdx(q), dFdy(q)));",
    "  if (clipped(vPos)) discard;",
    "#ifdef GBUF",
    "  frag = encode(face, 2u);",
    "#else",
    "  vec2 n = normalize(vOut + vec2(1e-6)), l = normalize(uLight.xy + vec2(1e-6));",
    "  float k = 0.9 + 0.2 * dot(n, l);",
    "  vec3 shaded = clamp(uColour.rgb * k, 0.0, 1.0);",
    "  vec4 base = vec4(shaded, 1.0);",
    "  if (uStyle == 1) base = vec4(uColour.rgb, 1.0);",
    "  else if (uStyle == 2) base = vec4(uWhite * (0.84 + 0.1 * dot(n, l)), 1.0);",
    "  else if (uStyle == 3) base = uPaper;",
    "  else if (uStyle == 4) base = uBase == 0 ? uPaper : uBase == 1 ? vec4(uColour.rgb, 1.0) : uBase == 2 ? vec4(shaded, 1.0) : vec4(0.0);",
    "  else if (uStyle == 5) base = vec4(0.0);",
    "  else if (uStyle == 6) base = vec4(shaded, uXray * 0.6);",
    "  float pa = base.a * uColour.a; vec3 p = base.rgb * pa;",
    "  float line = uStyle == 4 ? level : uStyle == 5 ? grid_ : 0.0;",
    "  line *= uColour.a;",
    "  p = (uStyle == 4 ? uContourColour : uWireColour) * line + p * (1.0 - line); pa = line + pa * (1.0 - line);",
    "  if (pa < 0.003 && uStyle >= 5) discard;",
    "  frag = vec4(pa > 0.0 ? p / pa : vec3(0.0), pa);",
    "#endif",
    "}"].join("\n");

  // ==== page position, for hatches fixed to the paper
  var POCHE = [
    "uniform int uFill; uniform vec4 uCut; uniform vec3 uBack; uniform vec3 uHatch;  // angle, spacing px, width px",
    "uniform vec4 uViewport, uTileP; uniform vec2 uPagePx;",
    "vec4 poche(){",
    "  if (uFill == 0) return uCut;",
    "  if (uFill == 2) return vec4(uCut.rgb, 0.0);",
    "  vec2 ndc = ((gl_FragCoord.xy - uViewport.xy) / uViewport.zw * 2.0 - 1.0 - uTileP.zw) / uTileP.xy;",
    "  vec2 px = (ndc * 0.5 + 0.5) * uPagePx;",
    "  float m = mod(dot(px, vec2(-sin(uHatch.x), cos(uHatch.x))), uHatch.y);",
    "  float c = clamp(max(uHatch.z, 1.0) * 0.5 + 0.5 - min(m, uHatch.y - m), 0.0, 1.0) * min(1.0, uHatch.z);",
    "  return vec4(mix(uBack, uCut.rgb, c), uCut.a);",
    "}"].join("\n");

  // ==== buildings
  var BUILDING_VS = [
    "layout(location=0) in vec3 aPos; layout(location=1) in uint aId;",
    "uniform sampler2D uData; uniform mat4 uMat; uniform vec4 uTile; uniform vec3 uCentre;",
    "uniform float uVe, uDefault, uIndustrial, uFlat, uBias, uCapZ; uniform int uCap;",
    "uniform vec3 uColours[3];",
    "out vec3 vRel; out vec3 vWorld; flat out vec3 vColour; flat out int vSource; flat out int vId;",
    "void main(){",
    "  int id = int(aId >> 1u); bool top = (aId & 1u) == 1u;",
    "  vec4 d = texelFetch(uData, ivec2(id % 2048, id / 2048), 0);",
    "  int code = int(d.w + 0.5); int source = code % 4; bool industry = code >= 4;",
    "  float h = source == 2 ? (industry ? uIndustrial : uDefault) : d.z;",
    "  float z = top ? d.y + h : d.x - 0.5;",
    "  float bias = 0.0;",
    "  if (uFlat > 0.5) { z = aPos.z + 0.4; bias = uBias; }",
    "  if (uCap == 1) {",
    "    // a horizontal cut: every vertex drops to the cut height, so only the plan shape is left",
    "    if (uFlat > 0.5 || !(d.x - 0.5 < uCapZ && uCapZ < d.y + h)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
    "    z = uCapZ; bias = uBias;",
    "  }",
    "  vColour = uColours[source]; vSource = source; vId = id;",
    "  vWorld = vec3(aPos.xy, z);",
    "  vRel = vec3(aPos.xy - uCentre.xy, z * uVe);",
    "  vec4 q = uMat * vec4(aPos.xy, z, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - bias, 1.0);",
    "}"].join("\n");

  var BUILDING_FS = [CLIP, STROKE, CONTOUR, ENCODE,
    "in vec3 vRel; in vec3 vWorld; flat in vec3 vColour; flat in int vSource; flat in int vId;",
    "uniform vec3 uLight, uToViewer, uWhite, uWhiteAssumed, uContourColour; uniform vec4 uPaper;",
    "uniform float uOpacity, uXray; uniform int uStyle, uBase;",
    "void main(){",
    "  vec3 n = normalize(cross(dFdx(vRel), dFdy(vRel)));",
    "  float gz = length(vec2(dFdx(vWorld.z), dFdy(vWorld.z)));",
    "  float level = contour(vWorld.z, gz);",
    "  if (clipped(vWorld)) discard;",
    "  if (dot(n, uToViewer) < 0.0) n = -n;",
    "#ifdef GBUF",
    "  frag = encode(n, uint(4 + vId % 252));",
    "#else",
    "  bool roof = abs(n.z) > 0.7;",
    "  float k = roof ? 1.0 : 0.64 + 0.28 * max(dot(n, uLight), 0.0);",
    "  vec4 base = vec4(vColour * k, 1.0);",
    "  if (uStyle == 1) base = vec4(vColour, 1.0);",
    "  else if (uStyle == 2) base = vec4((vSource == 2 ? uWhiteAssumed : uWhite) * (roof ? 1.0 : 0.76 + 0.18 * max(dot(n, uLight), 0.0)), 1.0);",
    "  // line styles keep assumed heights apart from known ones with a tinted fill",
    "  vec4 blank = vSource == 2 ? vec4(uWhiteAssumed, 1.0) : uPaper;",
    "  if (uStyle == 3) base = blank;",
    "  else if (uStyle == 4) base = uBase == 1 ? vec4(vColour, 1.0) : uBase == 2 ? vec4(vColour * k, 1.0) : (uBase == 0 || vSource == 2) ? blank : vec4(0.0);",
    "  else if (uStyle == 6) {",
    "    float edge = 1.0 - abs(dot(n, uToViewer));",
    "    base = vec4(vColour * k, clamp(uXray * mix(0.3, 0.8, edge * edge), 0.0, 1.0));",
    "  }",
    "  float pa = base.a * uOpacity; vec3 p = base.rgb * pa;",
    "  if (uStyle == 4 && !roof) { float a = level * uOpacity; p = uContourColour * a + p * (1.0 - a); pa = a + pa * (1.0 - a); }",
    "  frag = vec4(pa > 0.0 ? p / pa : vec3(0.0), pa);",
    "#endif",
    "}"].join("\n");

  var BCAP_FS = [CLIP, POCHE, ENCODE,
    "in vec3 vRel; in vec3 vWorld; flat in vec3 vColour; flat in int vSource; flat in int vId;",
    "void main(){",
    "  if (any(lessThan(vWorld.xy, uBoxMin.xy)) || any(greaterThan(vWorld.xy, uBoxMax.xy))) discard;",
    "#ifdef GBUF",
    "  frag = encode(vec3(0.0, 0.0, 1.0), 3u);",
    "#else",
    "  frag = poche();",
    "  if (frag.a < 0.003) discard;",
    "#endif",
    "}"].join("\n");

  // ==== cut faces
  var CAP_VS = [
    "layout(location=0) in vec3 aPos; uniform mat4 uMat; uniform vec4 uTile; uniform float uBias;",
    "void main(){",
    "  vec4 q = uMat * vec4(aPos, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - uBias, 1.0);",
    "}"].join("\n");

  var CAP_FS = [POCHE, ENCODE,
    "void main(){",
    "#ifdef GBUF",
    "  frag = encode(vec3(0.0, 0.0, 1.0), 3u);",
    "#else",
    "  frag = poche();",
    "  if (frag.a < 0.003) discard;",
    "#endif",
    "}"].join("\n");

  var HCAP_VS = [
    "uniform mat4 uMat; uniform vec4 uTile; uniform float uBias, uCapZ; uniform vec3 uBoxMin, uBoxMax; out vec2 vXY;",
    "const vec2 CORNER[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(1,1), vec2(0,0), vec2(1,1), vec2(0,1));",
    "void main(){",
    "  vXY = mix(uBoxMin.xy, uBoxMax.xy, CORNER[gl_VertexID]);",
    "  vec4 q = uMat * vec4(vXY, uCapZ, 1.0);",
    "  gl_Position = vec4(q.xy * uTile.xy + uTile.zw, q.z - uBias, 1.0);",
    "}"].join("\n");

  // The ground above the cut height shows as a filled face, with its edge drawn.
  var HCAP_FS = [POCHE, STROKE, ENCODE,
    "in vec2 vXY;",
    "uniform isampler2D uHeight; uniform sampler2D uSdf; uniform vec4 uSdfXf, uLine;",
    "uniform vec2 uOrigin, uCode, uAcross, uUp; uniform ivec2 uSize; uniform float uCell, uCapZ, uLinePx;",
    "float h(ivec2 c){ c = clamp(c, ivec2(0), uSize - 1); return float(texelFetch(uHeight, c, 0).r) * uCode.x + uCode.y; }",
    "void main(){",
    "  vec2 g = vec2(vXY.x - uOrigin.x, uOrigin.y - vXY.y) / uCell;",
    "  ivec2 i = ivec2(floor(g)); vec2 f = g - floor(g);",
    "  float z; vec2 slope;                  // rise per cell, east and south",
    "  float e = h(i + ivec2(1,0)), s = h(i + ivec2(0,1));",
    "  if (f.x + f.y <= 1.0) { float a = h(i); slope = vec2(e - a, s - a); z = a + dot(f, slope); }",
    "  else { float d = h(i + ivec2(1,1)); slope = vec2(d - s, d - e); z = d - dot(vec2(1.0) - f, slope); }",
    "  vec2 grad = vec2(slope.x, -slope.y) / uCell;",
    "  float perPixel = length(vec2(dot(grad, uAcross), dot(grad, uUp)));",
    "  if (z <= uCapZ) discard;",
    "  if (texture(uSdf, (vXY - uSdfXf.xy) * uSdfXf.zw).r < 0.5) discard;",
    "#ifdef GBUF",
    "  frag = encode(vec3(0.0, 0.0, 1.0), 3u);",
    "#else",
    "  vec4 fill = poche();",
    "  float a = uLinePx > 0.0 && perPixel > 1e-5 ? stroke((z - uCapZ) / perPixel, uLinePx * 2.0) : 0.0;",
    "  float pa = a + fill.a * (1.0 - a);",
    "  if (pa < 0.003) discard;",
    "  frag = vec4((uLine.rgb * a + fill.rgb * fill.a * (1.0 - a)) / pa, pa);",
    "#endif",
    "}"].join("\n");

  // ==== lines that respect the box
  var LINE_BODY = [
    "  vec4 a = uMat * vec4(A, 1.0), b = uMat * vec4(B, 1.0);",
    "  vec2 pa = (a.xy * 0.5 + 0.5) * uPage, pb = (b.xy * 0.5 + 0.5) * uPage;",
    "  vec2 d = pb - pa; float len = length(d);",
    "  vec2 t = len > 1e-4 ? d / len : vec2(1.0, 0.0); vec2 n = vec2(-t.y, t.x);",
    "  vec2 c = CORNER[gl_VertexID]; float reach = uHalf + 1.0; float side = c.x * 2.0 - 1.0;",
    "  vec2 p = mix(pa, pb, c.x) + t * side * reach + n * c.y * reach;",
    "  vLocal = vec2(c.x * len + side * reach, c.y * reach); vLength = len; vA = A; vB = B;",
    "  vec2 ndc = p / uPage * 2.0 - 1.0;",
    "  gl_Position = vec4(ndc * uTile.xy + uTile.zw, mix(a.z, b.z, c.x) - uBias, 1.0);",
    "}"].join("\n");
  var LINE_HEAD = [
    "uniform mat4 uMat; uniform vec4 uTile; uniform vec2 uPage; uniform float uHalf, uBias;",
    "out vec2 vLocal; flat out float vLength; flat out vec3 vA; flat out vec3 vB;",
    "const vec2 CORNER[6] = vec2[6](vec2(0,-1), vec2(1,-1), vec2(1,1), vec2(0,-1), vec2(1,1), vec2(0,1));"].join("\n");
  var LINE_VS = [
    "layout(location=0) in vec3 aStart; layout(location=1) in vec3 aEnd;", LINE_HEAD,
    "void main(){", "  vec3 A = aStart, B = aEnd;", LINE_BODY].join("\n");
  var WIRE_VS = [
    "layout(location=0) in vec4 aSeg; layout(location=1) in uint aInfo;", LINE_HEAD,
    "uniform sampler2D uData; uniform float uDefault, uIndustrial, uFlat;",
    "flat out float vAssumed;",
    "void main(){",
    "  int id = int(aInfo >> 2u); int kind = int(aInfo & 3u);",
    "  vec4 data = texelFetch(uData, ivec2(id % 2048, id / 2048), 0);",
    "  int code = int(data.w + 0.5); int source = code % 4;",
    "  float h = source == 2 ? (code >= 4 ? uIndustrial : uDefault) : data.z;",
    "  float foot = data.x - 0.5, roof = data.y + h;",
    "  vec3 A = vec3(aSeg.xy, kind == 0 ? roof : foot), B = vec3(aSeg.zw, kind == 1 ? foot : roof);",
    "  vAssumed = source == 2 ? 1.0 : 0.0;",
    "  if (uFlat > 0.5) {",
    "    if (kind != 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }",
    "    A.z = data.y + 0.4; B.z = A.z;",
    "  }", LINE_BODY].join("\n");

  var LINE_FS = [CLIP,
    "in vec2 vLocal; flat in float vLength; flat in vec3 vA; flat in vec3 vB; out vec4 frag;",
    "uniform vec4 uColour; uniform float uHalf, uMin;",
    "#ifdef WIRE",
    "flat in float vAssumed; uniform vec3 uAssumed;",
    "#endif",
    "void main(){",
    "  float along = clamp(vLocal.x, 0.0, vLength);",
    "  float cover = clamp(uHalf + 0.5 - length(vec2(vLocal.x - along, vLocal.y)), 0.0, 1.0);",
    "  if (cover < uMin) discard;",
    "  if (clipped(mix(vA, vB, vLength > 1e-4 ? along / vLength : 0.5))) discard;",
    "  vec3 colour = uColour.rgb;",
    "#ifdef WIRE",
    "  if (vAssumed > 0.5) colour = uAssumed;",
    "#endif",
    "  frag = vec4(colour, uColour.a * cover);",
    "}"].join("\n");

  // ==== outlines: find edges in a larger picture of depth, direction and identity
  var FULL_VS = "void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }";

  var MASK_FS = [
    "precision highp usampler2D; uniform usampler2D uG; uniform sampler2D uDepth; out vec4 frag;",
    "uniform float uStep, uRange, uThreshold, uCos; uniform int uGroundOn, uBuildingsOn;",
    "vec3 dir(uvec4 g){ return normalize((vec3(g.rgb) - 128.0) / 127.0); }",
    "void main(){",
    "  ivec2 p = ivec2(gl_FragCoord.xy), size = textureSize(uG, 0);",
    "  uvec4 g = texelFetch(uG, p, 0); frag = vec4(0.0);",
    "  uint id = g.a; if (id == 0u || id == 3u) return;",
    "  bool building = id >= 4u;",
    "  if (building ? uBuildingsOn == 0 : uGroundOn == 0) return;",
    "  vec3 n = dir(g); float d = texelFetch(uDepth, p, 0).r * uRange;",
    "  ivec2 STEP[4] = ivec2[4](ivec2(1,0), ivec2(0,1), ivec2(-1,0), ivec2(0,-1));",
    "  for (int i = 0; i < 4; i++) {",
    "    ivec2 q = p + STEP[i];",
    "    if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;",
    "    uvec4 o = texelFetch(uG, q, 0);",
    "    if (o.a == 0u) { frag = vec4(1.0); return; }                       // against the paper",
    "    float e = texelFetch(uDepth, q, 0).r * uRange;",
    "    vec3 gap = vec3(vec2(STEP[i]) * uStep, e - d);",
    "    // something behind that does not continue this surface. At a ridge the near surface is",
    "    // seen edge on, so the surface behind is asked too.",
    "    if (e - d > uThreshold && max(abs(dot(n, gap)), abs(dot(dir(o), gap))) > uThreshold) { frag = vec4(1.0); return; }",
    "    if (building) {",
    "      if (o.a != id && o.a != 3u) {",
    "        if (d < e - 0.3 || (abs(d - e) <= 0.3 && (o.a < 4u || id < o.a))) { frag = vec4(1.0); return; }",
    "      } else if (o.a == id && i < 2 && dot(n, dir(o)) < uCos) { frag = vec4(1.0); return; }",
    "    } else if (id == 1u && o.a == 2u) { frag = vec4(1.0); return; }      // the rim of the solid",
    "  }",
    "}"].join("\n");

  var DIST_FS = [
    "uniform sampler2D uMask; uniform int uReach; out vec4 frag;",
    "void main(){",
    "  ivec2 p = ivec2(gl_FragCoord.xy); int w = textureSize(uMask, 0).x; float best = 1.0;",
    "  for (int k = 0; k <= uReach; k++) {",
    "    bool hit = (p.x + k < w && texelFetch(uMask, p + ivec2(k, 0), 0).r > 0.5) ||",
    "               (p.x - k >= 0 && texelFetch(uMask, p - ivec2(k, 0), 0).r > 0.5);",
    "    if (hit) { best = float(k) / 255.0; break; }",
    "  }",
    "  frag = vec4(best);",
    "}"].join("\n");

  var COMP_FS = [
    "uniform sampler2D uDist; uniform int uReach; uniform float uScale, uWidth, uMargin;",
    "uniform vec4 uColour, uViewport; out vec4 frag;",
    "void main(){",
    "  vec2 s = (gl_FragCoord.xy - uViewport.xy + uMargin) * uScale;",
    "  ivec2 base = ivec2(floor(s)); int h = textureSize(uDist, 0).y; float near = 1e5;",
    "  for (int k = -uReach; k <= uReach; k++) {",
    "    int y = base.y + k; if (y < 0 || y >= h) continue;",
    "    float x = texelFetch(uDist, ivec2(base.x, y), 0).r * 255.0;",
    "    if (x > 254.5) continue;",
    "    near = min(near, length(vec2(x, float(y) + 0.5 - s.y)));",
    "  }",
    "  float a = clamp(max(uWidth, 1.0) * 0.5 + 0.5 - near / uScale, 0.0, 1.0) * min(1.0, uWidth);",
    "  if (a < 0.003) discard;",
    "  frag = vec4(uColour.rgb, uColour.a * a);",
    "}"].join("\n");

  // ==== helpers
  function programs(scene) {
    if (scene.styled) return scene.styled;
    var gl = scene.gl;
    function make(vs, fs, define) {
      var head = define ? HEAD.replace("#version 300 es\n", "#version 300 es\n#define " + define + "\n") : HEAD;
      return R.compile(gl, head + vs, head + fs);
    }
    var made = {};
    function lazy(name, vs, fs, define) {
      Object.defineProperty(made, name, { get: function () {
        var p = make(vs, fs, define);
        Object.defineProperty(made, name, { value: p });
        return p;
      }, configurable: true });
    }
    var tv = R.TERRAIN_VS.slice(HEAD.length);
    lazy("terrain", tv, TERRAIN_FS); lazy("terrainG", tv, TERRAIN_FS, "GBUF");
    lazy("terrainP", tv, TERRAIN_FS, "PAINT");
    lazy("skirt", SKIRT_VS, SKIRT_FS); lazy("skirtG", SKIRT_VS, SKIRT_FS, "GBUF");
    lazy("building", BUILDING_VS, BUILDING_FS); lazy("buildingG", BUILDING_VS, BUILDING_FS, "GBUF");
    lazy("bcap", BUILDING_VS, BCAP_FS); lazy("bcapG", BUILDING_VS, BCAP_FS, "GBUF");
    lazy("cap", CAP_VS, CAP_FS); lazy("capG", CAP_VS, CAP_FS, "GBUF");
    lazy("hcap", HCAP_VS, HCAP_FS); lazy("hcapG", HCAP_VS, HCAP_FS, "GBUF");
    lazy("line", LINE_VS, LINE_FS); lazy("wire", WIRE_VS, LINE_FS, "WIRE");
    lazy("mask", FULL_VS, MASK_FS); lazy("dist", FULL_VS, DIST_FS); lazy("comp", FULL_VS, COMP_FS);
    scene.styled = made;
    return made;
  }

  function rgb(hex) { return POYO.hexToRgb(hex); }
  function bind(gl, p, name, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.u[name], unit);
    gl.activeTexture(gl.TEXTURE0);
  }
  function box3(gl, p, c) {
    var b = c.box;
    gl.uniform1i(p.u.uClip, b ? (b.mode === "inside" ? 2 : 1) : 0);
    gl.uniform3fv(p.u.uBoxMin, b ? b.min : [0, 0, 0]);
    gl.uniform3fv(p.u.uBoxMax, b ? b.max : [0, 0, 0]);
  }
  // Tiles that lie wholly outside the section box are not sent to the graphics card at all.
  function inView(c, tile, box) {
    var b = c.box, m = 50;
    if (b && b.mode !== "inside" && (box[3] < b.min[0] - m || box[0] > b.max[0] + m ||
                                     box[4] < b.min[1] - m || box[1] > b.max[1] + m)) return false;
    return R.visible(c.cam.m, tile, box);
  }
  function camera(gl, p, c, tile) {
    gl.uniformMatrix4fv(p.u.uMat, false, c.cam.m);
    gl.uniform4fv(p.u.uTile, tile);
    gl.uniform3fv(p.u.uBasisR, c.cam.basis.r);
    gl.uniform3fv(p.u.uBasisU, c.cam.basis.u);
    gl.uniform3fv(p.u.uBasisF, c.cam.basis.f);
  }
  function contourUniforms(gl, p, c) {
    var K = c.look;
    gl.uniform4f(p.u.uContour, K.contour_interval_m, K.contour_index,
                 K.contour_mm * c.o.pxPerMm, K.contour_index_mm * c.o.pxPerMm);
    gl.uniform3fv(p.u.uContourColour, rgb(K.contour_colour));
    gl.uniform1i(p.u.uBase, BASE[K.contour_base]);
  }
  function wireUniforms(gl, p, c) {
    var K = c.look, s = K.wire_spacing_m, f = c.scene.frame;
    function wrap(v) { return v - s * Math.floor(v / s); }
    gl.uniform4f(p.u.uWire, s, K.wire_mm * c.o.pxPerMm, wrap(f.cx), wrap(f.cy));
    gl.uniform3fv(p.u.uWireColour, rgb(K.wire_colour));
  }
  // paper behind line styles; nothing on a transparent sheet
  function paper(c) {
    var sh = c.state.sheet, p = rgb(sh.paper_colour);
    return [p[0], p[1], p[2], sh.background === "transparent" ? 0 : 1];
  }
  function pocheUniforms(gl, p, c, fill, colour) {
    var cut = c.state.box.cut, o = c.o, col = rgb(colour);
    gl.uniform1i(p.u.uFill, FILL[fill]);
    gl.uniform4f(p.u.uCut, col[0], col[1], col[2], 1);
    gl.uniform3fv(p.u.uBack, rgb(cut.hatch_back));
    gl.uniform3f(p.u.uHatch, cut.hatch_angle * POYO.DEG, Math.max(2, cut.hatch_spacing_mm * o.pxPerMm),
                 cut.hatch_line_mm * o.pxPerMm);
    gl.uniform4fv(p.u.uViewport, c.viewport);
    gl.uniform4fv(p.u.uTileP, o.tile);
    gl.uniform2f(p.u.uPagePx, o.size.width, o.size.height);
  }
  // depth first for see-through layers, so back faces do not add up
  function solidOrGlass(gl, translucent, draw) {
    if (!translucent) { draw(); return; }
    gl.colorMask(false, false, false, false); draw();
    gl.colorMask(true, true, true, true); gl.depthMask(false); draw(); gl.depthMask(true);
  }

  // ==== cut faces, rebuilt only when the box or what it cuts changes
  function upload(gl, list, components, instanced) {
    var data = new Float32Array(list), vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = R.buffer(gl, gl.ARRAY_BUFFER, data);
    if (instanced) {
      for (var i = 0; i < 2; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12);
        gl.vertexAttribDivisor(i, 1);
      }
    } else { gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, components, gl.FLOAT, false, 12, 0); }
    gl.bindVertexArray(null);
    return { vao: vao, buffer: buf, count: data.length / (instanced ? 6 : 3) };
  }
  function drop(gl, mesh) { if (mesh) { gl.deleteVertexArray(mesh.vao); gl.deleteBuffer(mesh.buffer); } }

  function capKey(c) {
    var s = c.state, b = s.box, B = s.layers.buildings;
    return JSON.stringify([b.mode, b.min, b.max, s.terrain.datum_m, s.layers.terrain.visible, B.visible, B.flat,
                           B.default_height_m, B.industrial_height_m]);
  }

  // Geometry of the four vertical cut faces. No colour is stored in it.
  function caps(scene, c) {
    var cell = c.o.cell === 20 ? 20 : 10, key = capKey(c);
    scene.caps = scene.caps || {};
    var have = scene.caps[cell];
    if (have && have.key === key) return have;
    var gl = scene.gl, started = performance.now(), S = POYO.section;
    if (have) have.planes.forEach(function (q) {
      ["ground", "groundLine", "building", "buildingLine"].forEach(function (k) { drop(gl, q[k]); });
    });
    var grid = scene.grids["terrain_" + cell + "m"], s = c.state, L = s.layers, box = c.box;
    var bl = scene.buildings, cut = 0, groundArea = 0, builtArea = 0;
    var o = { grid: grid, sdf: scene.sdfBytes, sdfGrid: scene.sdfGrid, datum: s.terrain.datum_m,
              zmin: box.min[2], zmax: box.max[2] };
    var withBuildings = bl && L.buildings.visible && !L.buildings.flat;
    if (withBuildings && !bl.boxes) bl.boxes = S.polygonBoxes(bl.set);
    var bo = { grid: L.terrain.visible ? grid : null, zmin: Math.max(box.min[2], s.terrain.datum_m), zmax: box.max[2],
               heights: { other: L.buildings.default_height_m, industrial: L.buildings.industrial_height_m } };
    var planes = S.verticalPlanes(box).map(function (p, i) {
      var ground = new S.Faces(), built = new S.Faces();
      if (L.terrain.visible) S.terrainFace(ground, o, p[0], p[1], p[2], p[3]);
      if (withBuildings) cut += S.buildingFace(built, bl, bo, p[0], p[1], p[2], p[3]);
      groundArea += ground.area; builtArea += built.area;
      // which way the face looks: out of the box, or into the hole
      var normal = [0, 0, 0];
      normal[p[0]] = (i % 2 ? 1 : -1) * (box.mode === "inside" ? -1 : 1);
      return { normal: normal, ground: upload(gl, ground.tri, 3), groundLine: upload(gl, ground.line, 3, true),
               building: upload(gl, built.tri, 3), buildingLine: upload(gl, built.line, 3, true) };
    });
    var made = { key: key, planes: planes, groundArea_m2: groundArea, buildingArea_m2: builtArea, buildingCuts: cut };
    made.ms = performance.now() - started;
    scene.caps[cell] = made;
    return made;
  }

  // Faces that look away from the viewer are the far side of the cut and are not drawn.
  function facing(c) {
    return c.caps.planes.filter(function (q) {
      return q.normal[0] * c.toViewer[0] + q.normal[1] * c.toViewer[1] > 1e-5;
    });
  }

  // Heights at which horizontal cuts are drawn, or null.
  function horizontalCut(c) {
    var b = c.box, datum = c.state.terrain.datum_m;
    if (!b || !c.state.box.cut.horizontal) return null;
    var z = b.mode === "inside" ? b.min[2] : b.max[2];
    return z > datum ? z : null;
  }

  // ==== building edges for the wireframe, made the first time they are asked for
  function wire(scene) {
    if (scene.wire) return scene.wire;
    var gl = scene.gl, bl = scene.buildings, set = bl.set, limit = Math.cos(12 * POYO.DEG);
    var nv = set.xy.length / 2, data = new ArrayBuffer(nv * 3 * 20), f32 = new Float32Array(data), u32 = new Uint32Array(data);
    var n = 0, bins = [];
    function put(ax, ay, bx, by, info) {
      var o = n * 5;
      f32[o] = ax; f32[o + 1] = ay; f32[o + 2] = bx; f32[o + 3] = by; u32[o + 4] = info; n++;
    }
    bl.bins.forEach(function (bin) {
      var start = n;
      bin.polys.forEach(function (p) {
        var f = set.polyFeature[p];
        for (var r = set.polyRing[p]; r < set.polyRing[p + 1]; r++) {
          var a = set.ringStart[r], e = set.ringStart[r + 1];
          if (e - a > 1 && set.xy[2 * a] === set.xy[2 * e - 2] && set.xy[2 * a + 1] === set.xy[2 * e - 1]) e--;
          for (var i = a; i < e; i++) {
            var j = i + 1 < e ? i + 1 : a, h = i > a ? i - 1 : e - 1;
            var x = set.xy[2 * i], y = set.xy[2 * i + 1], X = set.xy[2 * j], Y = set.xy[2 * j + 1];
            put(x, y, X, Y, f * 4);                    // roof edge
            put(x, y, X, Y, f * 4 + 1);                // foot edge
            var ux = x - set.xy[2 * h], uy = y - set.xy[2 * h + 1], vx = X - x, vy = Y - y;
            var l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
            if (l > 0 && (ux * vx + uy * vy) / l < limit) put(x, y, x, y, f * 4 + 2);   // corner post
          }
        }
      });
      bins.push({ start: start, count: n - start, box: bin.box });
    });
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = R.buffer(gl, gl.ARRAY_BUFFER, new Uint8Array(data, 0, n * 20));
    gl.enableVertexAttribArray(0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    scene.wire = { vao: vao, buffer: buf, bins: bins, count: n };
    return scene.wire;
  }

  // Elevations can leave the flood out, where it would only show as a stripe.
  function floodHidden(state) {
    return !!(state.layers.flood.hide_in_elevation && state.view.elevation <= 0.01);
  }

  // ==== drawing the groups
  function fillsOf(c) {
    var s = c.state, L = s.layers, scene = c.scene, K = c.look;
    return s.fill_order.map(function (name) {
      if (name === "rivers") {
        if (!L.rivers.visible || !scene.fills.rivers) return null;
        return { f: scene.fills.rivers, colour: L.rivers.colour, a: L.rivers.opacity, layer: L.rivers, key: "rivers",
                 style: K.water, white: K.white_water };
      }
      if (L.flood.source === "none" || floodHidden(s)) return null;
      var key = L.flood.source;
      if (!scene.fills[key]) return null;
      return { f: scene.fills[key], colour: key === "satellite" ? L.flood.satellite_colour : L.flood.at2200_colour,
               a: L.flood.opacity, layer: L.flood, key: key, style: K.flood, white: K.white_flood };
    });
  }

  function drawWalls(c, g, tile) {
    var gl = c.gl, scene = c.scene, T = c.state.terrain, L = c.state.layers, K = c.look;
    if (!L.terrain.visible || !scene.skirt) return;
    var p = c.P[g ? "skirtG" : "skirt"];
    gl.useProgram(p.p);
    camera(gl, p, c, tile); box3(gl, p, c);
    gl.uniform1f(p.u.uDatum, T.datum_m);
    var base = rgb(T.base_colour);
    gl.uniform4f(p.u.uColour, base[0], base[1], base[2], L.terrain.opacity);
    gl.uniform4fv(p.u.uPaper, paper(c));
    gl.uniform3fv(p.u.uLight, c.light);
    gl.uniform3fv(p.u.uWhite, rgb(K.white_ground));
    gl.uniform1f(p.u.uXray, K.xray_alpha);
    gl.uniform1f(p.u.uVe, c.state.view.ve);
    gl.uniform1i(p.u.uStyle, CODE[K.ground]);
    contourUniforms(gl, p, c); wireUniforms(gl, p, c);
    gl.bindVertexArray(scene.skirt.vao);
    function draw() { gl.drawArrays(gl.TRIANGLES, 0, scene.skirt.count); }
    if (g || c.groundSee) draw();
    else solidOrGlass(gl, L.terrain.opacity < 1, draw);
  }

  function drawTerrain(c, g, tile) {
    var gl = c.gl, scene = c.scene, o = c.o, s = c.state, L = s.layers, T = s.terrain, K = c.look;
    var mesh = scene.terrain[o.cell === 20 ? "terrain_20m" : "terrain_10m"];
    var fills = c.fills;
    if (!mesh || !(L.terrain.visible || (!g && (fills[0] || fills[1])))) return;
    var painted = !g && c.paint;
    var p = c.P[g ? "terrainG" : painted ? "terrainP" : "terrain"], grid = mesh.grid;
    var alt = T.light_altitude * POYO.DEG;
    gl.useProgram(p.p);
    camera(gl, p, c, tile); box3(gl, p, c);
    gl.uniform2i(p.u.uSize, grid.cols, grid.rows);
    gl.uniform2f(p.u.uOrigin, grid.left + 0.5 * grid.cell, grid.top - 0.5 * grid.cell);
    gl.uniform1f(p.u.uCell, grid.cell);
    gl.uniform2f(p.u.uCode, grid.scale, grid.offset);
    gl.uniform1f(p.u.uRelief, T.shading_relief);
    gl.uniform2f(p.u.uRampRange, T.low_m, Math.max(T.low_m + 1, T.high_m));
    gl.uniform3fv(p.u.uLight, c.light);
    gl.uniform1f(p.u.uShade, T.hillshade);
    gl.uniform1f(p.u.uFlat, Math.sin(alt));
    gl.uniform1f(p.u.uOpacity, L.terrain.opacity);
    gl.uniform1f(p.u.uGround, L.terrain.visible ? 1 : 0);
    gl.uniform4fv(p.u.uSdfXf, scene.sdfXf);
    gl.uniform1i(p.u.uStyle, CODE[K.ground]);
    gl.uniform4fv(p.u.uPaper, paper(c));
    gl.uniform3fv(p.u.uFlatColour, rgb(K.flat_ground));
    gl.uniform3fv(p.u.uWhite, rgb(K.white_ground));
    gl.uniform3fv(p.u.uToViewer, c.toViewer);
    gl.uniform1f(p.u.uVe, s.view.ve);
    gl.uniform1f(p.u.uXray, K.xray_alpha);
    contourUniforms(gl, p, c); wireUniforms(gl, p, c);
    bind(gl, p, "uHeight", 0, mesh.tex);
    bind(gl, p, "uSdf", 1, scene.sdf);
    bind(gl, p, "uRamp", 2, scene.ramp);
    bind(gl, p, "uFill0", 3, fills[0] ? fills[0].f.tex : scene.empty);
    bind(gl, p, "uFill1", 4, fills[1] ? fills[1].f.tex : scene.empty);
    for (var n = 0; n < 2; n++) {
      var fl = fills[n], col = fl ? rgb(fl.colour) : [0, 0, 0];
      gl.uniform4f(p.u["uColour" + n], col[0], col[1], col[2], fl ? fl.a : 0);
      gl.uniform4fv(p.u["uFillXf" + n], fl ? fl.f.xf : [0, 0, 1, 1]);
      gl.uniform1i(p.u["uFillStyle" + n], fl ? CODE[fl.style] : 0);
      gl.uniform3fv(p.u["uWhite" + n], rgb(fl ? fl.white : "#FFFFFF"));
    }
    if (painted) paintUniforms(c, p, tile);
    var seen = mesh.chunks.filter(function (ch) { return inView(c, tile, ch.box); });
    function draw() {
      for (var q = 0; q < seen.length; q++) {
        gl.uniform2i(p.u.uChunk, seen[q].c0, seen[q].r0);
        gl.bindVertexArray(seen[q].vao);
        gl.drawElements(gl.TRIANGLES, seen[q].count, gl.UNSIGNED_SHORT, 0);
      }
    }
    var glass = !L.terrain.visible || (L.terrain.opacity < 1 && K.ground !== "outline");
    if (g || c.groundSee) draw(); else solidOrGlass(gl, glass, draw);
  }

  function symbolUniforms(c, p, tile) {
    var gl = c.gl, o = c.o, sym = c.paint.symbols;
    bind(gl, p, "uSym", 10, sym ? sym.tex : c.scene.empty);
    gl.uniform1i(p.u.uSymOn, sym ? 1 : 0);
    gl.uniform1i(p.u.uPatPage, sym && sym.page ? 1 : 0);
    var ppm = o.pxPerMm * (sym ? sym.scale : 1);
    gl.uniform1f(p.u.uPatScale, 1 / (o.mpp * ppm));
    var under = sym && sym.under ? rgb(sym.under) : null;
    gl.uniform4f(p.u.uUnder, under ? under[0] : 0, under ? under[1] : 0, under ? under[2] : 0, under ? 1 : 0);
    // millimetres on the whole page from the pixel position inside this tile
    var vp = gl.getParameter(gl.VIEWPORT), W = o.size.width, H = o.size.height;
    var x0 = (((-2 * vp[0] / vp[2] - 1 - tile[2]) / tile[0]) * 0.5 + 0.5) * W;
    var y0 = (((-2 * vp[1] / vp[3] - 1 - tile[3]) / tile[1]) * 0.5 + 0.5) * H;
    gl.uniform4f(p.u.uPageMap, W / (vp[2] * tile[0]) / ppm, -H / (vp[3] * tile[1]) / ppm, x0 / ppm, (H - y0) / ppm);
  }

  function paintUniforms(c, p, tile) {
    symbolUniforms(c, p, tile);
    var gl = c.gl, scene = c.scene, s = c.state, paint = c.paint, grid = null;
    var on = [0, 0], alpha = [0, 0], bound = [0, 0], width = s.cover.boundary_mm * c.o.pxPerMm;
    [5, 7].forEach(function (unit, i) {
      var slot = paint.slots[i];
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, slot ? slot.grid.tex : POYO.layers.dummyArray(scene));
      gl.uniform1i(p.u["uClass" + i], unit);
      bind(gl, p, "uPal" + i, unit + 1, slot ? slot.palette : scene.empty);
      if (!slot) return;
      grid = slot.grid; on[i] = 1; alpha[i] = slot.alpha; bound[i] = slot.boundaries ? width : 0;
    });
    gl.uniform4f(p.u.uGridXf, grid ? grid.left : 0, grid ? grid.top : 0, grid ? 1 / grid.cell : 1, grid ? grid.across : 1);
    gl.uniform2i(p.u.uGridSize, grid ? grid.cols : 0, grid ? grid.rows : 0);
    gl.uniform2i(p.u.uPaintOn, on[0], on[1]);
    gl.uniform1i(p.u.uSmooth, paint.slots[0] && paint.slots[0].smooth ? 1 : 0);
    gl.uniform2f(p.u.uPaintAlpha, alpha[0], alpha[1]);
    gl.uniform2f(p.u.uBoundPx, bound[0], bound[1]);
    gl.uniform3fv(p.u.uBoundColour, rgb(s.cover.boundary_colour));
    gl.uniform1f(p.u.uPaintShade, s.cover.shading);
    var road = c.roads;
    bind(gl, p, "uRoads", 9, road ? road.tex : scene.empty);
    gl.uniform4fv(p.u.uRoadXf, road ? road.xf : [0, 0, 1, 1]);
    gl.uniform1f(p.u.uRoadAlpha, road ? s.layers.roads.opacity : 0);
  }

  function buildingUniforms(c, p, tile) {
    var gl = c.gl, B = c.state.layers.buildings, v = c.state.view, K = c.look;
    camera(gl, p, c, tile); box3(gl, p, c);
    gl.uniform3f(p.u.uCentre, v.target[0], v.target[1], 0);
    gl.uniform1f(p.u.uVe, v.ve);
    gl.uniform1f(p.u.uDefault, B.default_height_m);
    gl.uniform1f(p.u.uIndustrial, B.industrial_height_m);
    gl.uniform1f(p.u.uFlat, B.flat ? 1 : 0);
    gl.uniform1f(p.u.uBias, 12 / c.cam.depthHalf);
    gl.uniform1i(p.u.uCap, 0);
    var cols = [B.floors_colour, B.explicit_colour, B.none_colour].map(rgb);
    gl.uniform3fv(p.u.uColours, [].concat(cols[0], cols[1], cols[2]));
    gl.uniform3fv(p.u.uLight, c.light);
    gl.uniform3fv(p.u.uToViewer, c.toViewer);
    gl.uniform1f(p.u.uOpacity, B.opacity);
    gl.uniform1i(p.u.uStyle, CODE[K.buildings]);
    gl.uniform3fv(p.u.uWhite, rgb(K.white_building));
    gl.uniform3fv(p.u.uWhiteAssumed, rgb(K.white_assumed));
    gl.uniform4fv(p.u.uPaper, paper(c));
    gl.uniform1f(p.u.uXray, K.xray_alpha);
    contourUniforms(gl, p, c);
    // on buildings the level lines have their own, finer interval
    var w = K.contour_mm * c.o.pxPerMm;
    gl.uniform4f(p.u.uContour, K.building_contour_m, 0, w, w);
    bind(gl, p, "uData", 0, c.scene.buildings.tex);
    gl.bindVertexArray(c.scene.buildings.vao);
  }

  function drawBins(c, tile) {
    var gl = c.gl, bins = c.scene.buildings.bins;
    for (var q = 0; q < bins.length; q++) {
      if (inView(c, tile, bins[q].box)) {
        gl.drawElements(gl.TRIANGLES, bins[q].count, gl.UNSIGNED_INT, bins[q].start * 4);
      }
    }
  }

  function drawBuildings(c, g, tile, translucent) {
    var p = c.P[g ? "buildingG" : "building"];
    c.gl.useProgram(p.p);
    buildingUniforms(c, p, tile);
    solidOrGlass(c.gl, translucent, function () { drawBins(c, tile); });
  }

  function drawCaps(c, g, tile, sidesOnly) {
    var gl = c.gl, made = c.caps, cut = c.state.box.cut, L = c.state.layers, scene = c.scene;
    if (!made) return;
    var half = c.cam.depthHalf;
    function faces(mesh, fill, colour, metres) {
      if (!mesh.count || fill === "none") return;
      var p = c.P[g ? "capG" : "cap"];
      gl.useProgram(p.p);
      camera(gl, p, c, tile);
      gl.uniform1f(p.u.uBias, metres / half);
      pocheUniforms(gl, p, c, fill, colour);
      gl.bindVertexArray(mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    var near = facing(c);
    near.forEach(function (q) { faces(q.ground, cut.ground_fill, cut.ground_colour, 0.5); });
    near.forEach(function (q) { faces(q.building, cut.buildings_fill, cut.building_colour, 1.0); });
    if (sidesOnly) return;

    var z = horizontalCut(c);
    if (z === null) return;
    var mesh = scene.terrain[c.o.cell === 20 ? "terrain_20m" : "terrain_10m"];
    if (L.terrain.visible && (cut.ground_fill !== "none" || cut.line_mm > 0)) {
      var h = c.P[g ? "hcapG" : "hcap"], grid = mesh.grid, line = rgb(cut.line_colour);
      gl.useProgram(h.p);
      camera(gl, h, c, tile); box3(gl, h, c);
      gl.uniform1f(h.u.uBias, 0.5 / half);
      gl.uniform1f(h.u.uCapZ, z);
      pocheUniforms(gl, h, c, cut.ground_fill, cut.ground_colour);
      gl.uniform2i(h.u.uSize, grid.cols, grid.rows);
      gl.uniform2f(h.u.uOrigin, grid.left + 0.5 * grid.cell, grid.top - 0.5 * grid.cell);
      gl.uniform1f(h.u.uCell, grid.cell);
      gl.uniform2f(h.u.uCode, grid.scale, grid.offset);
      gl.uniform4fv(h.u.uSdfXf, scene.sdfXf);
      gl.uniform4f(h.u.uLine, line[0], line[1], line[2], 1);
      gl.uniform1f(h.u.uLinePx, cut.line_mm * c.o.pxPerMm);
      // ground distance covered by one pixel across and up the sheet, on a level plane
      var v = c.state.view, az = v.azimuth * POYO.DEG, up = c.o.mpp / Math.max(0.05, Math.sin(v.elevation * POYO.DEG));
      gl.uniform2f(h.u.uAcross, Math.cos(az) * c.o.mpp, -Math.sin(az) * c.o.mpp);
      gl.uniform2f(h.u.uUp, Math.sin(az) * up, Math.cos(az) * up);
      bind(gl, h, "uHeight", 0, mesh.tex);
      bind(gl, h, "uSdf", 1, scene.sdf);
      gl.bindVertexArray(scene.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    if (scene.buildings && L.buildings.visible && !L.buildings.flat && cut.buildings_fill !== "none") {
      var b = c.P[g ? "bcapG" : "bcap"];
      gl.useProgram(b.p);
      buildingUniforms(c, b, tile);
      gl.uniform1i(b.u.uCap, 1);
      gl.uniform1f(b.u.uCapZ, z);
      gl.uniform1f(b.u.uBias, 1.0 / half);
      pocheUniforms(gl, b, c, cut.buildings_fill, cut.building_colour);
      drawBins(c, tile);
    }
  }

  // level lines alone do not describe a building, so its edges come with them
  function edged(style) { return style === "outline" || style === "contours"; }

  // ==== outline pass
  function surface(gl, width, height, internal, format, type) {
    var t = R.texture(gl, internal, format, type, width, height, null, gl.NEAREST, 1);
    var f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fbo: f };
  }
  function edgeBuffers(scene, width, height) {
    var gl = scene.gl, have = scene.edge;
    if (have && have.width === width && have.height === height) return have;
    if (have) {
      [have.g, have.mask, have.dist].forEach(function (s) { gl.deleteTexture(s.tex); gl.deleteFramebuffer(s.fbo); });
      gl.deleteTexture(have.depth);
    }
    var g = surface(gl, width, height, gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE);
    var depth = R.texture(gl, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, width, height, null, gl.NEAREST, 4);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("The graphics card refused the outline buffers.");
    }
    scene.edge = { width: width, height: height, g: g, depth: depth,
                   mask: surface(gl, width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE),
                   dist: surface(gl, width, height, gl.R8, gl.RED, gl.UNSIGNED_BYTE) };
    return scene.edge;
  }

  function outlines(c) {
    var gl = c.gl, scene = c.scene, o = c.o, K = c.look, L = c.state.layers;
    var target = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), vp = c.viewport;
    var max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    var fine = o.cell === 20 ? 1 : 2;
    while (fine > 1 && (Math.max(vp[2], vp[3]) + 2 * MARGIN) * fine > max) fine--;
    var width = (vp[2] + 2 * MARGIN) * fine, height = (vp[3] + 2 * MARGIN) * fine;
    var e = edgeBuffers(scene, width, height);
    var kx = vp[2] / (vp[2] + 2 * MARGIN), ky = vp[3] / (vp[3] + 2 * MARGIN), t = o.tile;
    var tile = [t[0] * kx, t[1] * ky, t[2] * kx, t[3] * ky];

    gl.bindFramebuffer(gl.FRAMEBUFFER, e.g.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    // everything that hides something else, whatever its own style
    if (!c.groundSee) { drawWalls(c, true, tile); drawTerrain(c, true, tile); }
    if (c.buildingsSolid) drawBuildings(c, true, tile, false);
    c.extras.forEach(function (x) { if (x.solid) x.solid(true, tile); });
    drawCaps(c, true, tile);

    gl.disable(gl.DEPTH_TEST);
    var mpp = o.mpp / fine, width_px = K.outline_mm * o.pxPerMm;
    var reach = Math.min(40, Math.ceil((width_px / 2 + 0.5) * fine) + 1);
    function pass(program, fbo, set) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.useProgram(program.p);
      set(program);
      gl.bindVertexArray(scene.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    pass(c.P.mask, e.mask.fbo, function (p) {
      bind(gl, p, "uG", 0, e.g.tex); bind(gl, p, "uDepth", 1, e.depth);
      gl.uniform1f(p.u.uStep, mpp);
      gl.uniform1f(p.u.uRange, 2 * c.cam.depthHalf);
      // never finer than the picture itself can show
      gl.uniform1f(p.u.uThreshold, Math.max(K.outline_depth_m, mpp * 1.5));
      gl.uniform1f(p.u.uCos, Math.cos(K.outline_angle_deg * POYO.DEG));
      gl.uniform1i(p.u.uGroundOn, L.terrain.visible && K.ground === "outline" ? 1 : 0);
      gl.uniform1i(p.u.uBuildingsOn, L.buildings.visible && edged(K.buildings) ? 1 : 0);
    });
    pass(c.P.dist, e.dist.fbo, function (p) {
      bind(gl, p, "uMask", 0, e.mask.tex);
      gl.uniform1i(p.u.uReach, reach);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    gl.enable(gl.BLEND);
    var col = rgb(K.outline_colour);
    pass(c.P.comp, target, function (p) {
      bind(gl, p, "uDist", 0, e.dist.tex);
      gl.uniform1i(p.u.uReach, reach);
      gl.uniform1f(p.u.uScale, fine);
      gl.uniform1f(p.u.uWidth, width_px);
      gl.uniform1f(p.u.uMargin, MARGIN);
      gl.uniform4f(p.u.uColour, col[0], col[1], col[2], 1);
      gl.uniform4fv(p.u.uViewport, vp);
    });
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.enable(gl.DEPTH_TEST);
  }

  // ==== lines
  function drawLines(c) {
    var gl = c.gl, scene = c.scene, o = c.o, s = c.state, L = s.layers, K = c.look, list = [];
    c.fills.forEach(function (fl) {
      // line styles always show where the water was
      var lined = fl && (fl.style === "outline" || fl.style === "contours" || fl.style === "wireframe");
      if (!fl || !(fl.layer.outline || lined)) return;
      list.push({ line: scene.lines["outline_" + fl.key], colour: fl.layer.outline_colour,
                  a: fl.layer.opacity, mm: fl.layer.outline_mm, clip: true });
    });
    if (c.paint && c.paint.symbols) {
      list.push.apply(list, POYO.layers.coverLines(scene, scene.manifest, s));
    }
    s.line_order.forEach(function (name) {
      var l = L[name];
      if (!l.visible) return;
      var item = { line: scene.lines[name], colour: l.colour, a: l.opacity, mm: l.width_mm, clip: true };
      if (name === "streams") {
        if (K.water === "white") item.colour = K.white_line;
        if (K.water === "xray") item.a *= K.xray_alpha;
      }
      list.push(item);
    });
    var layerLines = list.length;               // everything after this lies on a cut face
    if (c.caps) {
      var cut = s.box.cut;
      facing(c).forEach(function (q) {
        [q.groundLine, q.buildingLine].forEach(function (line) {
          list.push({ line: line, colour: cut.line_colour, a: 1, mm: cut.line_mm, clip: false });
        });
      });
    }
    var p = c.P.line;
    function begin() {
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uMat, false, c.cam.m);
      gl.uniform4fv(p.u.uTile, o.tile);
      gl.uniform2f(p.u.uPage, o.size.width, o.size.height);
      box3(gl, p, c);
      gl.depthMask(false);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    }
    // Draped lines are drawn a little toward the viewer so that they are not lost in the ground.
    // That would also let lines just behind a cut face show through it, so the side faces are
    // painted again over them. The depth test leaves anything nearer than a face untouched.
    function coverBehindCuts() {
      if (!c.caps) return;
      gl.disable(gl.STENCIL_TEST);
      gl.depthMask(true);
      drawCaps(c, false, o.tile, true);
      begin();
    }
    begin();
    list.forEach(function (item, index) {
      if (index === layerLines) coverBehindCuts();
      if (!item.line || !item.line.count || item.mm <= 0 || item.a <= 0) return;
      var width = item.mm * o.pxPerMm, colour = rgb(item.colour);
      gl.uniform1f(p.u.uHalf, Math.max(width / 2, 0.5));
      gl.uniform4f(p.u.uColour, colour[0], colour[1], colour[2], item.a * Math.min(1, width));
      // cut edges sit exactly on their face, layer lines float a little above the ground
      gl.uniform1f(p.u.uBias, (item.clip ? 1.5 * width * o.mpp + 15 : width * o.mpp + 1.5) / c.cam.depthHalf);
      gl.uniform1i(p.u.uClip, item.clip && c.box ? (c.box.mode === "inside" ? 2 : 1) : 0);
      gl.stencilFunc(gl.NOTEQUAL, index + 1, 0xff);
      gl.bindVertexArray(item.line.vao);
      var bands = o.cell === 20 ? R.DRAFT_BANDS : R.BANDS;
      for (var q = 0; q < bands.length; q++) {
        gl.uniform1f(p.u.uMin, bands[q]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, item.line.count);
      }
    });
    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(true);
  }

  function drawWire(c, strength) {
    var gl = c.gl, o = c.o, B = c.state.layers.buildings, K = c.look, w = wire(c.scene), p = c.P.wire;
    gl.useProgram(p.p);
    camera(gl, p, c, o.tile); box3(gl, p, c);
    var width = K.wire_mm * o.pxPerMm, colour = rgb(K.wire_colour);
    gl.uniform2f(p.u.uPage, o.size.width, o.size.height);
    gl.uniform1f(p.u.uHalf, Math.max(width / 2, 0.5));
    gl.uniform4f(p.u.uColour, colour[0], colour[1], colour[2], strength * B.opacity * Math.min(1, width));
    gl.uniform1f(p.u.uBias, (width * o.mpp + 2) / c.cam.depthHalf);
    gl.uniform3fv(p.u.uAssumed, rgb(K.white_assumed));
    gl.uniform1f(p.u.uMin, 0.004);
    gl.uniform1f(p.u.uDefault, B.default_height_m);
    gl.uniform1f(p.u.uIndustrial, B.industrial_height_m);
    gl.uniform1f(p.u.uFlat, B.flat ? 1 : 0);
    bind(gl, p, "uData", 0, c.scene.buildings.tex);
    gl.bindVertexArray(w.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, w.buffer);
    gl.depthMask(false);
    w.bins.forEach(function (bin) {
      if (!bin.count || !inView(c, o.tile, bin.box)) return;
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, bin.start * 20);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 20, bin.start * 20 + 16);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, bin.count);
    });
    gl.depthMask(true);
  }

  // ==== the whole picture
  function render(scene, o) {
    var gl = scene.gl, s = o.state, v = s.view, L = s.layers, T = s.terrain, K = s.look;
    scene.setRamp(T);
    var cam = POYO.camera.matrix(v, o.size, o.mpp, scene.bounds(s));
    var az = T.light_azimuth * POYO.DEG, alt = T.light_altitude * POYO.DEG;
    var B = L.buildings, hasBuildings = !!(scene.buildings && B.visible && B.opacity > 0);
    var c = {
      gl: gl, scene: scene, state: s, o: o, cam: cam, look: K, P: programs(scene),
      light: [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)],
      toViewer: [-cam.basis.f[0], -cam.basis.f[1], -cam.basis.f[2]],
      box: s.box.enabled && POYO.state.boxIsSet(s.box) ? POYO.section.local(s, scene.frame) : null,
      viewport: Array.prototype.slice.call(gl.getParameter(gl.VIEWPORT)),
      groundSee: K.ground === "wireframe" || K.ground === "xray"
    };
    var buildingsSee = K.buildings === "wireframe" || K.buildings === "xray";
    var buildingsGlass = !buildingsSee && B.opacity < 1 && K.buildings !== "outline";
    c.buildingsSolid = hasBuildings && !buildingsSee && !buildingsGlass;
    c.fills = fillsOf(c);
    c.caps = c.box ? caps(scene, c) : null;
    c.paint = L.terrain.visible ? POYO.layers.paintFor(scene, scene.manifest, s) : null;
    c.roads = c.paint && c.paint.roads ? POYO.layers.roadOverlay(scene, scene.manifest, c) : null;
    // water and trees, when they are on
    c.extras = [POYO.trees, POYO.water].map(function (m) { return m ? m.prepare(c) : null; })
      .filter(function (x) { return x; });
    function each(phase, a, b) { c.extras.forEach(function (x) { if (x[phase]) x[phase](a, b); }); }

    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    var k = o.clear;
    gl.clearColor(k[0] * k[3], k[1] * k[3], k[2] * k[3], k[3]);
    gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    if (!c.groundSee) { drawWalls(c, false, o.tile); drawTerrain(c, false, o.tile); }
    if (c.buildingsSolid) drawBuildings(c, false, o.tile, false);
    each("solid", false, o.tile);
    drawCaps(c, false, o.tile);
    var edges = (L.terrain.visible && K.ground === "outline") || (hasBuildings && edged(K.buildings));
    if (edges) outlines(c);
    if (c.groundSee) {
      gl.depthMask(false);
      drawWalls(c, false, o.tile); drawTerrain(c, false, o.tile);
      gl.depthMask(true);
    }
    if (hasBuildings && K.buildings === "xray") {
      gl.depthMask(false); drawBuildings(c, false, o.tile, false); gl.depthMask(true);
      drawWire(c, 0.6);                                  // ghosted faces keep their edges
    }
    if (hasBuildings && K.buildings === "wireframe") drawWire(c, 1);
    each("see", false, o.tile);
    drawLines(c);
    each("glass", false, o.tile);
    if (hasBuildings && buildingsGlass) drawBuildings(c, false, o.tile, true);
    gl.bindVertexArray(null);
  }

  // True when anything newer than Stage 1 has to be drawn.
  function extras(s) {
    if (!s.cover) return false;
    if (s.cover.source !== "none" || s.overlay.source !== "none") return true;
    if (s.layers.roads.visible || s.water3d.channel || s.water3d.flood || s.trees.on) return true;
    if (floodHidden(s) && s.layers.flood.source !== "none") return true;
    return POYO.state.LINES3.some(function (n) { return s.layers[n].visible; });
  }

  // True when the picture is the plain Stage 1 one, which render.js draws itself.
  function isPlain(state) {
    var K = state.look, P = POYO.state.PLAIN;
    if (state.box && state.box.enabled && POYO.state.boxIsSet(state.box)) return false;
    if (extras(state)) return false;
    return !K || POYO.state.GROUPS.every(function (g) { return K[g] === P[g]; });
  }

  POYO.styles = { render: render, isPlain: isPlain, floodHidden: floodHidden, programs: programs,
                  CLIP: CLIP, STROKE: STROKE, ENCODE: ENCODE, GRID: GRID, POCHE: POCHE, CODE: CODE,
                  bind: bind, box3: box3, camera: camera, rgb: rgb, paper: paper, facing: facing,
                  pocheUniforms: pocheUniforms, solidOrGlass: solidOrGlass, inView: inView,
                  horizontalCut: horizontalCut, upload: upload, drop: drop, wireUniforms: wireUniforms,
                  contourUniforms: contourUniforms, CONTOUR: CONTOUR };
})();
