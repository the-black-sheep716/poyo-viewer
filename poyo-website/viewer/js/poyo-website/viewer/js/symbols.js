// symbols.js: the land use symbols read from the QGIS style (cell 19). Solid fills, point
// patterns, line patterns and polygon outlines, sized in millimetres as in QGIS. The same
// description feeds the ground shader and the legend swatches.
"use strict";
(function () {
  var MARKS = { circle: 0, triangle: 1, square: 2, diamond: 3, cross: 4, x: 5 };
  // Dash lengths in line widths (on, off, on, off, on, off) as drawn with square line caps.
  var DASH = { solid: null, dash: [5, 1], dot: [2, 1], "dash dot": [5, 1, 2, 1], "dash dot dot": [5, 1, 2, 1, 2, 1] };
  var OPS = 4, PER_OP = 5, WIDE = 1 + OPS * PER_OP;
  var RAD = Math.PI / 180;

  function style(manifest) {
    var e = manifest && manifest.entries && manifest.entries.landuse_style;
    return e && e.classes ? e : null;
  }

  function parse(hex) {
    if (!hex) return [0, 0, 0, 0];
    return [1, 3, 5, 7].map(function (i) { return i < hex.length ? parseInt(hex.substr(i, 2), 16) / 255 : 1; });
  }

  function rgba(hex) {
    var c = parse(hex);
    return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + c[3] + ")";
  }

  // The one colour that stands for a symbol: its fill, else its first pattern colour.
  function main(symbol) {
    if (!symbol) return null;
    var fill = symbol.ops.filter(function (o) { return o.type === "fill"; })[0];
    var op = fill || symbol.ops[0];
    if (!op) return symbol.outline ? symbol.outline.colour.slice(0, 7) : null;
    var c = op.type === "point" ? (op.fill || op.stroke) : op.colour;
    return c ? c.slice(0, 7).toUpperCase() : null;
  }

  // A copy of a symbol with its main colour replaced.
  function recolour(symbol, hex) {
    var copy = JSON.parse(JSON.stringify(symbol));
    var fill = copy.ops.filter(function (o) { return o.type === "fill"; })[0];
    var op = fill || copy.ops[0];
    if (!op) { copy.ops = [{ type: "fill", colour: hex }]; return copy; }
    function swap(old) { return hex + (old && old.length > 7 ? old.slice(7) : ""); }
    if (op.type === "point") {
      if (op.fill) op.fill = swap(op.fill); else op.stroke = swap(op.stroke);
    } else op.colour = swap(op.colour);
    return copy;
  }

  function solid(hex) { return { on: true, ops: [{ type: "fill", colour: hex }], outline: null }; }

  // ==== data for the ground shader ============================================
  function encode(data, row, symbol) {
    var ops = symbol ? symbol.ops.slice(0, OPS) : [], base = row * WIDE * 4;
    data[base] = ops.length;
    ops.forEach(function (o, j) {
      var at = base + (1 + j * PER_OP) * 4;
      function put(texel, v) { for (var i = 0; i < 4; i++) data[at + texel * 4 + i] = v[i] || 0; }
      if (o.type === "fill") {
        put(0, [1]); put(2, parse(o.colour));
      } else if (o.type === "point") {
        put(0, [2, o.angle * RAD, Math.max(o.dx, 0.05), Math.max(o.dy, 0.05)]);
        put(1, [o.size / 2, MARKS[o.marker] || 0, o.marker_angle * RAD, o.stroke_mm]);
        put(2, parse(o.fill)); put(3, parse(o.stroke));
        put(4, [o.shift || 0]);
      } else {
        var d = DASH[o.dash] === undefined ? DASH.dash : DASH[o.dash], period = 0;
        if (d) d.forEach(function (v) { period += v; });
        d = d || [];
        put(0, [3, o.angle * RAD, Math.max(o.distance, 0.05), Math.max(o.width, 0.01)]);
        put(1, [o.offset || 0, d[0], d[1], d[2]]);
        put(2, parse(o.colour));
        put(4, [d[3], d[4], d[5], period]);
      }
    });
  }

  // list: [{ index, key, symbol }] with symbol null where nothing is drawn. Classes that share
  // a key (the detailed uses of one use group) get no boundary line between them.
  function pack(list) {
    var data = new Float32Array(WIDE * 256 * 4), keys = [];
    list.forEach(function (c) {
      if (keys.indexOf(c.key) < 0) keys.push(c.key);
      encode(data, c.index, c.symbol);
      data[c.index * WIDE * 4 + 1] = keys.indexOf(c.key) + 1;
    });
    return { data: data, width: WIDE, height: 256 };
  }

  // ==== legend swatches =======================================================
  function marker(c, kind, r) {
    c.beginPath();
    if (kind === "circle") c.arc(0, 0, r, 0, 2 * Math.PI);
    else if (kind === "triangle") {
      c.moveTo(0, -r); c.lineTo(0.866 * r, 0.5 * r); c.lineTo(-0.866 * r, 0.5 * r); c.closePath();
    } else if (kind === "square") c.rect(-r, -r, 2 * r, 2 * r);
    else if (kind === "diamond") { c.moveTo(0, -r); c.lineTo(r, 0); c.lineTo(0, r); c.lineTo(-r, 0); c.closePath(); }
    else {
      var k = kind === "x" ? 0.707 * r : 0;
      if (kind === "x") { c.moveTo(-k, -k); c.lineTo(k, k); c.moveTo(-k, k); c.lineTo(k, -k); }
      else { c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); }
    }
  }

  // Draws a symbol into the rectangle (x, y, w, h) of a canvas with u pixels per millimetre.
  function draw(c, symbol, x, y, w, h, u, scale) {
    var k = u * (scale || 1), cx = x + w / 2, cy = y + h / 2, reach = Math.hypot(w, h) / 2;
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    symbol.ops.forEach(function (o) {
      c.save();
      if (o.type === "fill") {
        c.fillStyle = rgba(o.colour); c.fillRect(x, y, w, h);
      } else if (o.type === "point") {
        var dx = o.dx * k, dy = o.dy * k, a = o.angle * RAD, r = o.size * k / 2;
        var nx = Math.ceil((reach + r) / dx) + 1, ny = Math.ceil((reach + r) / dy) + 1;
        for (var j = -ny; j <= ny; j++) {
          for (var i = -nx; i <= nx; i++) {
            var qx = i * dx + ((j % 2) ? (o.shift || 0) * k : 0), qy = j * dy;
            var px = cx + Math.cos(a) * qx - Math.sin(a) * qy, py = cy + Math.sin(a) * qx + Math.cos(a) * qy;
            if (px < x - r || px > x + w + r || py < y - r || py > y + h + r) continue;
            c.save(); c.translate(px, py); c.rotate(o.marker_angle * RAD);
            marker(c, o.marker, r);
            if (o.fill) { c.fillStyle = rgba(o.fill); c.fill(); }
            if (o.stroke) { c.strokeStyle = rgba(o.stroke); c.lineWidth = o.stroke_mm > 0 ? o.stroke_mm * k : Math.max(1, 0.085 * u); c.stroke(); }
            c.restore();
          }
        }
      } else {
        var t = o.angle * RAD, gap = o.distance * k, wide = o.width * k;
        var ux = Math.cos(t), uy = -Math.sin(t), vx = Math.sin(t), vy = Math.cos(t);
        var dash = DASH[o.dash] === undefined ? DASH.dash : DASH[o.dash];
        c.strokeStyle = rgba(o.colour); c.lineWidth = wide;
        if (dash) c.setLineDash(dash.map(function (v) { return v * wide; }));
        var n = Math.ceil((reach + wide) / gap) + 1;
        for (var m = -n; m <= n; m++) {
          var s = m * gap + (o.offset || 0) * k;
          c.beginPath();
          c.moveTo(cx + vx * s - ux * reach, cy + vy * s - uy * reach);
          c.lineTo(cx + vx * s + ux * reach, cy + vy * s + uy * reach);
          c.stroke();
        }
      }
      c.restore();
    });
    c.restore();
  }

  // A legend swatch with the same signature as the plain colour swatches.
  function swatch(symbol, under, scale, border) {
    return function (c, x, y, w, h, u) {
      if (under) { c.fillStyle = under; c.fillRect(x, y, w, h); }
      draw(c, symbol, x, y, w, h, u, scale);
      var line = symbol.outline;
      c.strokeStyle = line ? rgba(line.colour) : (border || "#B4B4AF");
      c.lineWidth = (line ? Math.max(line.mm * (scale || 1), 0.12) : 0.14) * u;
      c.strokeRect(x, y, w, h);
    };
  }

  // A small canvas for the class table of the inspector.
  function preview(symbol, under, scale) {
    var ratio = window.devicePixelRatio || 1, el = document.createElement("canvas");
    el.width = Math.round(30 * ratio); el.height = Math.round(18 * ratio);
    el.className = "symbol";
    var c = el.getContext("2d");
    if (symbol) swatch(symbol, under, scale)(c, 0.5, 0.5, el.width - 1, el.height - 1, ratio * 96 / 25.4);
    return el;
  }

  POYO.symbols = { style: style, parse: parse, main: main, recolour: recolour, solid: solid, pack: pack,
                   draw: draw, swatch: swatch, preview: preview, WIDE: WIDE };
})();
