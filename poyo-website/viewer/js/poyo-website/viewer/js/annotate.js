// annotate.js: everything printed on top of the sheet. The same code draws the
// preview on screen and the export, so what you see is what is exported.
// All positions and sizes are millimetres on paper.
"use strict";
(function () {
  var ID = POYO.ID;
  var BODY = "'Poyo Inter', Arial, sans-serif";
  var TITLE = "'Poyo Inter Display', 'Poyo Inter', Arial, sans-serif";
  var measureCtx = null;

  function font(weight, size, family) { return weight + " " + size + "px " + family; }

  function width(text, weight, size, family) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = font(weight, size * 20, family);
    return measureCtx.measureText(text).width / 20;
  }

  function wrap(text, weight, size, family, max) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var next = line ? line + " " + w : w;
      if (line && width(next, weight, size, family) > max) { lines.push(line); line = w; }
      else line = next;
    });
    if (line) lines.push(line);
    return lines;
  }

  // A block is a list of items stacked downwards.
  function Stack(maxWidth) { this.items = []; this.height = 0; this.width = 0; this.max = maxWidth; }
  Stack.prototype.add = function (h, w, draw) {
    this.items.push({ y: this.height, draw: draw });
    this.height += h;
    if (w > this.width) this.width = w;
  };
  Stack.prototype.gap = function (h) { this.height += h; };
  Stack.prototype.text = function (text, size, o) {
    o = o || {};
    var weight = o.weight || 400, family = o.family || BODY, indent = o.indent || 0;
    var lines = wrap(text, weight, size, family, this.max - indent), self = this;
    lines.forEach(function (line) {
      self.add(size * 1.32, indent + width(line, weight, size, family), function (c, x, y, u) {
        c.fillStyle = o.colour || ID.ink;
        c.font = font(weight, size * u, family);
        c.textBaseline = "alphabetic"; c.textAlign = "left";
        c.fillText(line, (x + indent) * u, (y + size * 1.02) * u);
      });
    });
  };
  Stack.prototype.entry = function (label, size, symbol) {
    var indent = size * 2.6, lines = wrap(label, 400, size, BODY, this.max - indent);
    var h = Math.max(1, lines.length) * size * 1.32 + size * 0.22, w = 0;
    lines.forEach(function (l) { w = Math.max(w, indent + width(l, 400, size, BODY)); });
    this.add(h, w, function (c, x, y, u) {
      symbol(c, x * u, (y + size * 0.22) * u, size * 1.9 * u, size * 0.95 * u, u);
      c.fillStyle = ID.ink; c.font = font(400, size * u, BODY);
      c.textBaseline = "alphabetic"; c.textAlign = "left";
      lines.forEach(function (line, i) {
        c.fillText(line, (x + indent) * u, (y + size * 1.02 + i * size * 1.32) * u);
      });
    });
  };

  function swatch(colour, outline) {
    return function (c, x, y, w, h, u) {
      c.fillStyle = colour; c.fillRect(x, y, w, h);
      c.strokeStyle = outline || ID.slate; c.lineWidth = 0.18 * u; c.strokeRect(x, y, w, h);
    };
  }
  function stroke(colour, mm) {
    return function (c, x, y, w, h, u) {
      c.fillStyle = colour;
      var t = Math.max(mm * u, 1);
      c.fillRect(x, y + h / 2 - t / 2, w, t);
    };
  }

  function niceDown(value) {
    var p = Math.pow(10, Math.floor(Math.log10(value))), f = value / p;
    return (f >= 5 ? 5 : f >= 2.5 ? 2.5 : f >= 2 ? 2 : 1) * p;
  }
  function metres(v) {
    return v >= 1000 ? POYO.fmt(v / 1000, (v / 1000) % 1 ? (((v / 100) % 1) ? 2 : 1) : 0) + " km"
                     : POYO.fmt(v, v % 1 ? 1 : 0) + " m";
  }

  function floodName(source) {
    if (source === "satellite") return "Satellite flood extent (CEMS)";
    if (source === "at2200") return "Flood extent at 22:00 (method undocumented)";
    return "No flood layer shown";
  }

  function floodNote(source, manifest) {
    if (source !== "satellite") return "";
    var a = manifest.entries.flood_satellite, b = manifest.entries.flood_2200;
    if (!a || !b) return "The satellite extent under-maps built-up land.";
    return "The satellite extent under-maps built-up land: " + POYO.fmt(a.urban_area_km2, 3) +
           " km² on urban land, against " + POYO.fmt(b.urban_area_km2, 2) +
           " km² in the 22:00 extent.";
  }

  function heightLabel(B) {
    var d = String(B.default_height_m), i = String(B.industrial_height_m);
    return "no height data, default applied (" + d + " m" +
           (B.industrial_height_m !== B.default_height_m ? ", industrial " + i + " m" : "") + ")";
  }

  function titleBlock(state, manifest, k, max, full) {
    var s = new Stack(max), v = state.view;
    if (full) {
      s.text(POYO.camera.viewName(v), 10.5 * k, { weight: 700, family: TITLE });
      s.gap(1.5 * k);
    }
    s.text("Vertical exaggeration × " + POYO.fmt(v.ve, v.ve % 1 ? 1 : 0), 5.6 * k, { weight: 600 });
    s.text(floodName(state.layers.flood.source), 5.6 * k, { weight: 600 });
    var note = floodNote(state.layers.flood.source, manifest);
    if (note && !full) s.text(note, 4.2 * k, { colour: ID.graphite });
    return s;
  }

  function scaleBlock(state, k, max, full) {
    var s = new Stack(max), v = state.view, N = v.scale;
    var length = niceDown(max * 0.9 * N / 1000), bar = length * 1000 / N, size = 4.6 * k;
    s.add(size * 1.5 + 3 * k, bar + size * 3, function (c, x, y, u) {
      var top = y + size * 1.5;
      for (var i = 0; i < 4; i++) {
        c.fillStyle = i % 2 ? ID.paper : ID.ink;
        c.fillRect((x + bar * i / 4) * u, top * u, bar / 4 * u, 2.2 * k * u);
      }
      c.strokeStyle = ID.ink; c.lineWidth = 0.2 * u;
      c.strokeRect(x * u, top * u, bar * u, 2.2 * k * u);
      c.fillStyle = ID.ink; c.font = font(400, size * u, BODY); c.textBaseline = "alphabetic";
      c.textAlign = "left"; c.fillText("0", x * u, (y + size) * u);
      c.textAlign = "center"; c.fillText(metres(length / 2), (x + bar / 2) * u, (y + size) * u);
      c.fillText(metres(length), (x + bar) * u, (y + size) * u);
    });
    s.gap(1.6 * k);
    var flat = v.elevation >= 89.99;
    s.text("Scale 1:" + POYO.fmtInt(N) + (flat ? "" : " across the sheet"), 5.6 * k, { weight: 600 });
    if (v.elevation <= 0.01 && v.ve !== 1) {
      // second bar: heights have their own scale when exaggerated
      var vN = N / v.ve, tall = niceDown(24 * k * vN / 1000), mm = tall * 1000 / vN;
      s.gap(1.5 * k);
      s.add(mm + 1.5 * k, 60 * k, function (c, x, y, u) {
        for (var i = 0; i < 2; i++) {
          c.fillStyle = i % 2 ? ID.paper : ID.ink;
          c.fillRect(x * u, (y + mm * i / 2) * u, 2.2 * k * u, mm / 2 * u);
        }
        c.strokeStyle = ID.ink; c.lineWidth = 0.2 * u; c.strokeRect(x * u, y * u, 2.2 * k * u, mm * u);
        c.fillStyle = ID.ink; c.font = font(400, size * u, BODY); c.textAlign = "left";
        c.textBaseline = "middle";
        c.fillText(metres(tall) + " of height", (x + 4.5 * k) * u, (y + mm / 2) * u);
      });
    }
    if (full) {
      POYO.camera.lengthStatement(v).forEach(function (line) { s.text(line, 4.2 * k); });
      s.gap(2 * k);
      var b = POYO.camera.basis(v.azimuth, v.elevation);
      var nx = b.r[1], ny = b.u[1];                       // north on the sheet
      var words = flat ? (Math.abs(v.azimuth) < 0.01 ? "North is up"
                          : "Top of the sheet points " + POYO.camera.compass(v.azimuth))
                       : "Looking " + POYO.camera.compass(v.azimuth);
      var arrow = Math.hypot(nx, ny) > 0.25, box = 15 * k;
      s.add(arrow ? box : 6 * k, (arrow ? box + 3 * k : 0) + width(words, 400, 4.6 * k, BODY), function (c, x, y, u) {
        if (arrow) {
          c.save();
          c.translate((x + box / 2) * u, (y + box / 2) * u);
          c.rotate(Math.atan2(nx, ny));
          c.fillStyle = ID.ink;
          c.beginPath();
          c.moveTo(0, -box * 0.18 * u); c.lineTo(box * 0.2 * u, box * 0.47 * u);
          c.lineTo(0, box * 0.32 * u); c.lineTo(-box * 0.2 * u, box * 0.47 * u);
          c.closePath(); c.fill();
          c.restore();
          var turn = Math.atan2(nx, ny);                  // the letter stays upright
          c.fillStyle = ID.ink; c.font = font(600, 4.6 * k * u, BODY);
          c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText("N", (x + box / 2 + Math.sin(turn) * box * 0.37) * u,
                     (y + box / 2 - Math.cos(turn) * box * 0.37) * u);
        }
        c.fillStyle = ID.ink; c.font = font(400, 4.6 * k * u, BODY); c.textAlign = "left";
        c.textBaseline = "middle";
        c.fillText(words, (x + (arrow ? box + 3 * k : 0)) * u, (y + (arrow ? box / 2 : 3 * k)) * u);
      });
    }
    if (state.sheet.credits) { s.gap(2 * k); s.text(state.sheet.credits, 4 * k, { colour: ID.graphite }); }
    return s;
  }

  function legendBlock(state, manifest, k, max) {
    var s = new Stack(max), L = state.layers, size = 4.8 * k;
    var lines = { basin: "Basin boundary", streams: "Streams" };
    state.line_order.slice().reverse().forEach(function (n) {
      if (L[n].visible && L[n].opacity > 0) s.entry(lines[n], size, stroke(L[n].colour, L[n].width_mm));
    });
    if (L.rivers.visible && L.rivers.opacity > 0) {
      s.entry("River channels", size, swatch(L.rivers.colour));
    }
    if (L.flood.source !== "none") {
      var colour = L.flood.source === "satellite" ? L.flood.satellite_colour : L.flood.at2200_colour;
      s.gap(1.2 * k);
      s.entry(floodName(L.flood.source), size, swatch(colour));
      s.text("Colour shows where water was mapped, not how deep it was.", 4 * k, { colour: ID.graphite });
      var note = floodNote(L.flood.source, manifest);
      if (note) s.text(note, 4 * k, { colour: ID.graphite });
    }
    var B = L.buildings;
    if (B.visible && B.opacity > 0) {
      s.gap(2.2 * k);
      s.text(B.flat ? "Buildings, footprints shown flat" : "Buildings, source of height", size, { weight: 600 });
      s.entry("from floor count (3 m per floor assumed)", size, swatch(B.floors_colour));
      s.entry("explicit height tag", size, swatch(B.explicit_colour));
      s.entry(heightLabel(B), size, swatch(B.none_colour));
    }
    var T = state.terrain;
    if (L.terrain.visible && L.terrain.opacity > 0) {
      s.gap(2.2 * k);
      s.text("Ground elevation, m", size, { weight: 600 });
      var barW = Math.min(max, 74 * k), span = Math.max(1, T.high_m - T.low_m);
      s.add(size * 2.6, barW, function (c, x, y, u) {
        var g = c.createLinearGradient(x * u, 0, (x + barW) * u, 0);
        g.addColorStop(0, T.low_colour);
        g.addColorStop(POYO.clamp((T.mid_m - T.low_m) / span, 0, 1), T.mid_colour);
        g.addColorStop(1, T.high_colour);
        c.fillStyle = g; c.fillRect(x * u, (y + 0.6) * u, barW * u, size * 0.9 * u);
        c.strokeStyle = ID.slate; c.lineWidth = 0.18 * u;
        c.strokeRect(x * u, (y + 0.6) * u, barW * u, size * 0.9 * u);
        c.fillStyle = ID.ink; c.font = font(400, 4 * k * u, BODY); c.textBaseline = "alphabetic";
        var base = (y + size * 2.15) * u;
        c.textAlign = "left"; c.fillText(POYO.fmtInt(T.low_m), x * u, base);
        c.textAlign = "center";
        var mid = (T.mid_m - T.low_m) / span;
        if (mid > 0.1 && mid < 0.88) c.fillText(POYO.fmtInt(T.mid_m), (x + barW * mid) * u, base);
        c.textAlign = "right"; c.fillText(POYO.fmtInt(T.high_m), (x + barW) * u, base);
      });
      var datum = T.datum_m < 0 ? "−" + POYO.fmtInt(-T.datum_m) : POYO.fmtInt(T.datum_m);
      s.text("Shaded relief. Solid base drawn down to " + datum + " m.", 4 * k, { colour: ID.graphite });
    }
    return s;
  }

  // Blocks with their position on a page of page.width_mm x page.height_mm.
  function layout(state, manifest, page) {
    var sheet = state.sheet, full = sheet.annotations === "full";
    var base = POYO.clamp(Math.min(page.width_mm, page.height_mm) / 841, 0.35, 1.2);
    var k = base * sheet.text_size, margin = 14 * base, pad = 4 * k, blocks = [];
    var paper = sheet.paper_colour;

    function block(stack, x, y) {
      var w = stack.width + 2 * pad, h = stack.height + 2 * pad;
      var b = { x: x === "right" ? page.width_mm - margin - w : x,
                y: y === "bottom" ? page.height_mm - margin - h : y, w: w, h: h };
      b.draw = function (c, u) {
        c.globalAlpha = 0.93; c.fillStyle = paper;
        c.fillRect(b.x * u, b.y * u, b.w * u, b.h * u);
        c.globalAlpha = 1;
        stack.items.forEach(function (item) { item.draw(c, b.x + pad, b.y + pad + item.y, u); });
      };
      blocks.push(b);
      return b;
    }

    var top = margin;
    if (sheet.panel_id) {
      // 72 point Arial on A0
      var size = 25.4 * Math.min(1, base), id = new Stack(page.width_mm);
      id.add(size * 1.05, width(sheet.panel_id, 400, size, "Arial, sans-serif"), function (c, x, y, u) {
        c.fillStyle = ID.ink; c.font = font(400, size * u, "Arial, sans-serif");
        c.textAlign = "left"; c.textBaseline = "alphabetic";
        c.fillText(sheet.panel_id, x * u, (y + size * 0.86) * u);
      });
      var b = block(id, margin, margin);
      top = b.y + b.h + 3 * k;
    }
    block(titleBlock(state, manifest, k, 150 * k, full), margin, top);
    block(scaleBlock(state, k, 128 * k, full), margin, "bottom");
    if (full) {
      var legend = legendBlock(state, manifest, k, 118 * k);
      if (legend.height > 0) block(legend, "right", "bottom");
    }
    return blocks;
  }

  POYO.annotate = { layout: layout, floodName: floodName, floodNote: floodNote, heightLabel: heightLabel };
})();
