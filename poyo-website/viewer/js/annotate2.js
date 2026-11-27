// annotate2.js: the Stage 2 sheet. A title block bottom right, a legend bottom left
// and the panel ID top left. The same code draws the preview and the export.
// annotate.js still draws the Stage 1 sheet, so Stage 1 sidecars reproduce exactly.
// All positions and sizes are millimetres on paper.
"use strict";
(function () {
  var first = POYO.annotate;
  var BODY = "'Poyo Inter', Arial, sans-serif";
  var FIGURES = "'Poyo Inter Tabular', 'Poyo Inter', Arial, sans-serif";
  var TITLE = "'Poyo Inter Display', 'Poyo Inter', Arial, sans-serif";
  var TRACK = 0.09;                                  // letter spacing of headings, in em
  var measureCtx = null;

  // Paper and Water sheets are set in Arial with no text under 10 pt (on A2 and larger).
  var STORM_FACE = "Arial, 'Liberation Sans', Helvetica, sans-serif";
  var typeface = null;                                   // set while such a sheet is laid out or drawn
  function withFace(next, work) {
    var before = typeface;
    typeface = next;
    try { return work(); } finally { typeface = before; }
  }
  function least(size) { return typeface && typeface.min ? Math.max(size, typeface.min) : size; }
  function font(weight, size, family) { return weight + " " + size + "px " + (typeface ? STORM_FACE : family); }

  function width(text, size, o) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = font(o.weight || 400, size * 20, o.family || FIGURES);
    if (measureCtx.letterSpacing !== undefined) measureCtx.letterSpacing = (o.track ? o.track * size * 20 : 0) + "px";
    return measureCtx.measureText(text).width / 20;
  }

  function wrap(text, size, o, max) {
    var words = typeface ? String(text).replace(/(\d) (%|km²|km|m)(?![A-Za-z²])/g, "$1\u00a0$2").split(/[ \t\r\n]+/)
                     : String(text).split(/\s+/), lines = [], line = "";
    words.forEach(function (w) {
      var next = line ? line + " " + w : w;
      if (line && width(next, size, o) > max) { lines.push(line); line = w; }
      else line = next;
    });
    if (line) lines.push(line);
    // a single word longer than the column is broken, so it cannot run off the sheet
    var out = [];
    lines.forEach(function (l) {
      while (l.length > 1 && width(l, size, o) > max) {
        var n = l.length - 1;
        while (n > 1 && width(l.slice(0, n), size, o) > max) n--;
        out.push(l.slice(0, n)); l = l.slice(n);
      }
      out.push(l);
    });
    return out;
  }

  function put(c, text, x, y, size, u, o) {
    c.fillStyle = o.colour;
    c.font = font(o.weight || 400, size * u, o.family || FIGURES);
    if (c.letterSpacing !== undefined) c.letterSpacing = (o.track ? o.track * size * u : 0) + "px";
    c.textAlign = o.align || "left"; c.textBaseline = o.baseline || "alphabetic";
    c.fillText(text, x * u, y * u);
    if (c.letterSpacing !== undefined) c.letterSpacing = "0px";
  }

  function inks(sheet) {
    return { ink: sheet.ink, body: sheet.body_ink, muted: sheet.muted_ink, paper: sheet.paper_colour,
             rule: sheet.rule_colour, tab: sheet.tab_colour };
  }

  // A column of items stacked downwards.
  function Column(max, ink) { this.max = max; this.ink = ink; this.items = []; this.height = 0; this.width = 0; }
  Column.prototype.add = function (h, w, draw) {
    var item = { y: this.height, h: h, draw: draw };
    this.items.push(item);
    this.height += h;
    if (w > this.width) this.width = w;
    return item;
  };
  Column.prototype.gap = function (h) { if (this.height) this.height += h; };
  Column.prototype.text = function (text, size, o) {
    var self = this;
    o = o || {};
    size = least(size);
    var style = { weight: o.weight, family: o.family, track: o.track, colour: o.colour || this.ink.ink };
    wrap(text, size, style, this.max).forEach(function (line, i, all) {
      var item = self.add(size * 1.36, width(line, size, style), function (c, x, y, u) {
        put(c, line, x, y + size * 1.02, size, u, style);
      });
      item.keep = i < all.length - 1;            // a column break does not split one statement
    });
  };
  Column.prototype.label = function (text, size, colour) {
    this.text(text.toUpperCase(), size, { weight: typeface ? 700 : 600, track: typeface ? 0.1 : TRACK,
                                          colour: colour || this.ink.muted });
    if (this.items.length) this.items[this.items.length - 1].keep = true;
  };
  Column.prototype.entry = function (text, size, symbol) {
    size = least(size);
    var indent = size * 2.7, style = { colour: this.ink.ink };
    var lines = wrap(text, size, style, this.max - indent), w = 0, self = this;
    lines.forEach(function (l) { w = Math.max(w, indent + width(l, size, style)); });
    this.add(Math.max(1, lines.length) * size * 1.36 + size * 0.25, w, function (c, x, y, u) {
      symbol(c, x * u, (y + size * 0.22) * u, size * 1.9 * u, size * 0.95 * u, u, self.ink);
      lines.forEach(function (line, i) { put(c, line, x + indent, y + size * 1.02 + i * size * 1.36, size, u, style); });
    });
  };

  // ==== legend symbols, drawn in pixels
  function swatch(fill, border, alpha) {
    return function (c, x, y, w, h, u, ink) {
      if (fill) { c.globalAlpha = alpha === undefined ? 1 : alpha; c.fillStyle = fill; c.fillRect(x, y, w, h); c.globalAlpha = 1; }
      c.strokeStyle = border || ink.muted; c.lineWidth = 0.18 * u; c.strokeRect(x, y, w, h);
    };
  }
  function stroke(colour, mm) {
    return function (c, x, y, w, h, u) {
      var t = Math.max(mm * u, 1);
      c.fillStyle = colour; c.fillRect(x, y + h / 2 - t / 2, w, t);
    };
  }
  function clipTo(c, x, y, w, h, draw) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); draw(); c.restore(); }
  function hatched(back, colour, angle, spacing, line, border) {
    return function (c, x, y, w, h, u, ink) {
      c.fillStyle = back; c.fillRect(x, y, w, h);
      clipTo(c, x, y, w, h, function () {
        c.translate(x + w / 2, y + h / 2);
        c.rotate(-angle * POYO.DEG);
        c.fillStyle = colour;
        var step = Math.max(spacing * u, 2), t = Math.max(line * u, 0.6), r = w;
        for (var o = -r; o <= r; o += step) c.fillRect(-r, o - t / 2, 2 * r, t);
      });
      c.strokeStyle = border || ink.muted; c.lineWidth = 0.18 * u; c.strokeRect(x, y, w, h);
    };
  }
  function grid(colour) {
    return function (c, x, y, w, h, u) {
      var t = Math.max(0.18 * u, 0.6);
      c.fillStyle = colour;
      for (var i = 0; i <= 4; i++) c.fillRect(x + (w - t) * i / 4, y, t, h);
      for (var j = 0; j <= 2; j++) c.fillRect(x, y + (h - t) * j / 2, w, t);
    };
  }
  function levels(colour) {
    return function (c, x, y, w, h, u) {
      c.strokeStyle = colour;
      [0.12, 0.5, 0.88].forEach(function (f, i) {
        c.lineWidth = Math.max((i === 1 ? 0.35 : 0.15) * u, 0.5);
        c.beginPath(); c.moveTo(x, y + h * f);
        c.bezierCurveTo(x + w * 0.35, y + h * (f - 0.28), x + w * 0.6, y + h * (f + 0.28), x + w, y + h * f);
        c.stroke();
      });
    };
  }

  // ==== words
  function floodName(source) {
    if (source === "satellite") return "Satellite flood extent";
    if (source === "at2200") return "Flood extent at 22:00 (method undocumented)";
    return "No flood layer shown";
  }
  var floodNote = first.floodNote, heightLabel = first.heightLabel;

  function shown(state) {
    var L = state.layers, seen = function (l) { return !!(l && l.visible && l.opacity > 0); };
    var cover = state.cover || {}, over = state.overlay || {}, water = state.water3d || {}, trees = state.trees || {};
    var hidden = !!(POYO.styles && POYO.styles.floodHidden && POYO.styles.floodHidden(state));
    var paint = function (set, source) { return set.source === source && set.opacity > 0; };
    return {
      terrain: seen(L.terrain), rivers: seen(L.rivers), streams: seen(L.streams),
      buildings: seen(L.buildings), basin: seen(L.basin),
      satellite: !hidden && L.flood.source === "satellite" && L.flood.opacity > 0,
      at2200: !hidden && ((L.flood.source === "at2200" && L.flood.opacity > 0) ||
                          !!(water.flood && water.flood_source === "at2200" && water.opacity > 0)),
      channel: !!(water.channel && water.opacity > 0),
      depth: paint(over, "depth") || !!(water.flood && !hidden && water.flood_source !== "at2200" && water.opacity > 0),
      hazard: paint(over, "hazard"),
      landuse: paint(cover, "planned") || !!(trees.on && trees.source === "planned"),
      siose: paint(cover, "observed") || !!(trees.on && trees.source === "observed"),
      crops: paint(cover, "crops") || !!(trees.on && trees.source === "crops"),
      roads: seen(L.roads), railways: seen(L.railways), places: seen(L.places), municipal: seen(L.municipal),
      sector: seen(L.sector) || seen(L.windows), parcels: seen(L.parcels)
    };
  }
  var CREDIT_ORDER = ["terrain", "basin", "rivers", "streams", "buildings", "satellite", "at2200", "depth",
                      "landuse", "siose", "crops", "hazard", "roads", "railways", "places", "municipal", "sector", "parcels"];
  var CREDIT_NAMES = { terrain: "Ground", basin: "Basin boundary", rivers: "River channels",
                       streams: "Streams", buildings: "Buildings", satellite: "Satellite flood extent",
                       at2200: "Flood extent at 22:00", depth: "Flood depth classes", landuse: "Planned land use",
                       siose: "Land cover", crops: "Crop types", hazard: "Flood hazard zones", roads: "Roads", railways: "Railways",
                       places: "Place areas", municipal: "Municipal limits",
                       sector: "Study sector and pilot windows", parcels: "Parcel outlines" };
  function used(on, k) { return on[k] || (k === "rivers" && on.channel); }

  // Source statements for what is on the sheet, followed by the free credits line.
  function credits(state) {
    var out = [], on = shown(state), sheet = state.sheet;
    if (sheet.auto_sources) {
      CREDIT_ORDER.forEach(function (k) {
        var t = String(sheet.sources[k] || "").trim();
        if (used(on, k) && t && out.indexOf(t) < 0) out.push(t);
      });
    }
    var own = String(sheet.credits || "").trim();
    if (own) out.push(own);
    return out.join(" ");
  }
  function missingSources(state) {
    var on = shown(state);
    return CREDIT_ORDER.filter(function (k) { return used(on, k) && !String(state.sheet.sources[k] || "").trim(); })
      .map(function (k) { return CREDIT_NAMES[k]; });
  }

  function niceDown(value) {
    var p = Math.pow(10, Math.floor(Math.log10(value))), f = value / p;
    return (f >= 5 ? 5 : f >= 2.5 ? 2.5 : f >= 2 ? 2 : 1) * p;
  }
  function metres(v) {
    return v >= 1000 ? POYO.fmt(v / 1000, (v / 1000) % 1 ? (((v / 100) % 1) ? 2 : 1) : 0) + " km"
                     : POYO.fmt(v, v % 1 ? 1 : 0) + " m";
  }
  function signed(v) { return v < 0 ? "minus " + POYO.fmtInt(-v) : POYO.fmtInt(v); }
  function times(v) { return "× " + POYO.fmt(v, v % 1 ? 1 : 0); }
  function northWords(v) {
    if (v.elevation >= 89.99) {
      return Math.abs(v.azimuth) < 0.01 ? "North is up" : "Top of the sheet points " + POYO.camera.compass(v.azimuth);
    }
    return "Looking " + POYO.camera.compass(v.azimuth);
  }
  function boxWords(b) {
    function f(n) { return POYO.fmt(n, Math.abs(n % 1) > 0.001 ? 1 : 0); }
    return "East " + f(b.min[0]) + " to " + f(b.max[0]) + ". North " + f(b.min[1]) + " to " + f(b.max[1]) +
           ". Height " + signed(b.min[2]) + " to " + signed(b.max[2]) + " m. " +
           (b.mode === "inside" ? "The model inside the box is removed." : "The model inside the box is shown.");
  }
  function boxOn(state) { return !!(state.box && state.box.enabled && POYO.state.boxIsSet(state.box)); }

  // ==== title block: rows of cells divided by hairlines
  function titleBlock(state, manifest, k, ink, opts) {
    var storm = state.sheet.design === "storm";
    var W = (storm ? 220 : 196) * k, pad = 3 * k, v = state.view, sheet = state.sheet;
    var label = least(2.7 * k), value = least(4.5 * k), small = least(3.4 * k), big = least(6.4 * k);
    var rows = [];
    function cell(share, fill) {
      var col = new Column(W * share - 2 * pad, ink);
      fill(col);
      return { share: share, col: col };
    }
    function row() { rows.push(Array.prototype.slice.call(arguments)); }

    // the chronogram look opens with its tab, kicker, title and note
    var chrono = storm || sheet.design === "chronogram";
    if (storm) {
      row(cell(1, function (s) {
        s.add(2.4 * k, 20 * k, function (c, x, y, u) {
          c.fillStyle = ink.ink; c.fillRect(x * u, y * u, (W - 2 * pad) * u, Math.max(0.5 * u, 1));
        });
        var kicker = String(sheet.kicker || "").trim(), words = String(sheet.note || "").trim();
        if (kicker) s.text(kicker.toUpperCase(), 3.9 * k, { weight: 700, track: 0.1, colour: ink.muted });
        s.gap(1.6 * k);
        s.text(POYO.camera.viewName(v).toUpperCase(), 8.47 * k, { weight: 700, track: 0.1 });
        if (words) { s.gap(2.8 * k); s.text(words, 4.6 * k, { colour: ink.body }); }
      }));
    } else if (chrono) {
      row(cell(1, function (s) {
        s.add(4.4 * k, 20 * k, function (c, x, y, u) {
          c.fillStyle = ink.tab; c.fillRect(x * u, (y + 0.6 * k) * u, 20 * k * u, 1.4 * k * u);
        });
        var kicker = String(sheet.kicker || "").trim(), words = String(sheet.note || "").trim();
        if (kicker) s.text(kicker.toUpperCase(), 3.2 * k, { weight: 700, track: 0.1, colour: ink.body });
        s.gap(1.2 * k);
        s.text(POYO.camera.viewName(v), 10 * k, { weight: 700, family: TITLE, track: -0.02 });
        if (words) {
          s.gap(2.8 * k);
          s.text("NOTE", label, { weight: 500, track: 0.11, colour: ink.muted });
          s.text(words, 3.8 * k, { colour: ink.body });
        }
      }));
    } else row(cell(1, function (s) { s.text(POYO.camera.viewName(v), 8 * k, { weight: 700, family: TITLE }); }));
    row(cell(0.36, function (s) {
          s.label("Scale", label); s.text("1:" + POYO.fmtInt(v.scale), big, { weight: 600 });
          if (v.elevation < 89.99) s.text("across the sheet", small, { colour: ink.body });
        }),
        cell(0.30, function (s) {
          s.label("Vertical exaggeration", label); s.text(times(v.ve), big, { weight: 600 });
        }),
        cell(0.34, function (s) {
          s.label("North", label);
          var b = POYO.camera.basis(v.azimuth, v.elevation), nx = b.r[1], ny = b.u[1];
          var arrow = Math.hypot(nx, ny) > 0.25, box = 13 * k, words = northWords(v);
          if (!arrow) { s.text(words, value); return; }
          var lines = wrap(words, small, {}, s.max - box - 2 * k);
          s.add(box + 0.6 * k, s.max, function (c, x, y, u) {
            var turn = Math.atan2(nx, ny);
            c.save();
            c.translate((x + box / 2) * u, (y + box / 2) * u);
            c.rotate(turn);
            c.fillStyle = ink.ink;
            c.beginPath();
            c.moveTo(0, -box * 0.16 * u); c.lineTo(box * 0.2 * u, box * 0.46 * u);
            c.lineTo(0, box * 0.31 * u); c.lineTo(-box * 0.2 * u, box * 0.46 * u);
            c.closePath(); c.fill();
            c.restore();
            put(c, "N", x + box / 2 + Math.sin(turn) * box * 0.37, y + box / 2 - Math.cos(turn) * box * 0.37,
                small, u, { weight: 600, colour: ink.ink, align: "center", baseline: "middle" });
            lines.forEach(function (line, i) {
              put(c, line, x + box + 2 * k, y + box / 2 + (i - (lines.length - 1) / 2) * small * 1.36, small, u,
                  { colour: ink.ink, baseline: "middle" });
            });
          });
        }));

    // scale bar, with a second bar for heights when an elevation is exaggerated
    var tallBar = v.elevation <= 0.01 && v.ve !== 1;
    var barCell = cell(tallBar ? 0.7 : 1, function (s) {
      var N = v.scale, length = niceDown(Math.min(s.max * 0.86, 110 * k) * N / 1000), bar = length * 1000 / N;
      s.add(small * 1.5 + 2.2 * k, bar + small * 3, function (c, x, y, u) {
        var top = y + small * 1.45;
        for (var i = 0; i < 4; i++) {
          c.fillStyle = i % 2 ? ink.paper : ink.ink;
          c.fillRect((x + bar * i / 4) * u, top * u, bar / 4 * u, 2 * k * u);
        }
        c.strokeStyle = ink.ink; c.lineWidth = 0.18 * u; c.strokeRect(x * u, top * u, bar * u, 2 * k * u);
        put(c, "0", x, y + small, small, u, { colour: ink.ink });
        put(c, metres(length / 2), x + bar / 2, y + small, small, u, { colour: ink.ink, align: "center" });
        put(c, metres(length), x + bar, y + small, small, u, { colour: ink.ink, align: "center" });
      });
      s.gap(1.6 * k);
      POYO.camera.lengthStatement(v).forEach(function (line) { s.text(line, small, { colour: ink.body }); });
    });
    if (tallBar) {
      row(barCell, cell(0.3, function (s) {
        s.label("Height", label);
        var vN = v.scale / v.ve, tall = niceDown(20 * k * vN / 1000), mm = tall * 1000 / vN;
        s.gap(0.8 * k);
        s.add(mm + 1 * k, s.max, function (c, x, y, u) {
          for (var i = 0; i < 2; i++) {
            c.fillStyle = i % 2 ? ink.paper : ink.ink;
            c.fillRect(x * u, (y + mm * i / 2) * u, 2 * k * u, mm / 2 * u);
          }
          c.strokeStyle = ink.ink; c.lineWidth = 0.18 * u; c.strokeRect(x * u, y * u, 2 * k * u, mm * u);
          put(c, metres(tall), x + 4.2 * k, y + mm / 2, small, u, { colour: ink.ink, baseline: "middle" });
        });
      }));
    } else row(barCell);

    row(cell(0.5, function (s) {
          s.label("Coordinate system", label);
          s.text("ETRS89 / UTM zone 30N", value); s.text("EPSG:25830, metres", small, { colour: ink.body });
        }),
        cell(0.5, function (s) {
          s.label("Flood", label); s.text((opts && opts.floodText) || floodName(state.layers.flood.source), value);
        }));
    if (boxOn(state)) {
      row(cell(1, function (s) { s.label("Section box", label); s.text(boxWords(state.box), small); }));
    }
    var note = floodNote(state.layers.flood.source, manifest);
    if (note && !sheet.legend && !(opts && opts.floodText)) {
      row(cell(1, function (s) { s.text(note, small, { colour: ink.body }); }));
    }
    var line = credits(state), id = String(sheet.panel_id || "");
    if (line || id) {
      var cells = [];
      if (line) cells.push(cell(id ? 0.72 : 1, function (s) { s.label("Credits", label); s.text(line, small); }));
      if (id) cells.push(cell(line ? 0.28 : 1, function (s) { s.label("Panel", label); s.text(id, big, { weight: 600 }); }));
      rows.push(cells);
    }

    var heights = rows.map(function (r) {
      return r.reduce(function (m, c) { return Math.max(m, c.col.height); }, 0) + 2 * pad * 0.85;
    });
    var H = heights.reduce(function (a, b) { return a + b; }, 0);
    return {
      w: W, h: H,
      draw: function (c, bx, by, u) {
        c.fillStyle = ink.paper; c.fillRect(bx * u, by * u, W * u, H * u);
        var y = by;
        rows.forEach(function (r, i) {
          var x = bx;
          r.forEach(function (cl, j) {
            cl.col.items.forEach(function (item) { item.draw(c, x + pad, y + pad * 0.85 + item.y, u); });
            if (j && !chrono) { c.fillStyle = ink.muted; c.fillRect(x * u, y * u, Math.max(0.15 * u, 0.5), heights[i] * u); }
            x += W * cl.share;
          });
          if (i) {
            var inset = storm ? pad : 0;
            c.fillStyle = chrono ? ink.rule : ink.muted;
            c.fillRect((bx + inset) * u, y * u, (W - 2 * inset) * u, Math.max((chrono ? 0.25 : 0.15) * u, 0.5));
          }
          y += heights[i];
        });
        if (chrono) return;                       // open layout, no box around it
        var t = 0.35;
        c.strokeStyle = ink.ink; c.lineWidth = Math.max(t * u, 1);
        c.strokeRect(bx * u + c.lineWidth / 2, by * u + c.lineWidth / 2, W * u - c.lineWidth, H * u - c.lineWidth);
      }
    };
  }

  // ==== legend
  function rampItem(s, state, ink, k) {
    var T = state.terrain, barW = Math.min(s.max, 70 * k), span = Math.max(1, T.high_m - T.low_m), size = least(3.4 * k);
    s.add(size * 3, barW, function (c, x, y, u) {
      var g = c.createLinearGradient(x * u, 0, (x + barW) * u, 0);
      g.addColorStop(0, T.low_colour);
      g.addColorStop(POYO.clamp((T.mid_m - T.low_m) / span, 0, 1), T.mid_colour);
      g.addColorStop(1, T.high_colour);
      c.fillStyle = g; c.fillRect(x * u, (y + 0.6) * u, barW * u, size * 1.1 * u);
      c.strokeStyle = ink.muted; c.lineWidth = 0.18 * u;
      c.strokeRect(x * u, (y + 0.6) * u, barW * u, size * 1.1 * u);
      var base = y + size * 2.55, mid = (T.mid_m - T.low_m) / span;
      put(c, signed(T.low_m), x, base, size, u, { colour: ink.ink });
      if (mid > 0.12 && mid < 0.86) put(c, signed(T.mid_m), x + barW * mid, base, size, u, { colour: ink.ink, align: "center" });
      put(c, signed(T.high_m), x + barW, base, size, u, { colour: ink.ink, align: "right" });
    });
  }

  // o is given by the Stage 3 sheet: its own column, a content filter and extra sections.
  function legend(state, manifest, k, ink, o) {
    var s = (o && o.column) || new Column(112 * k, ink), L = state.layers, K = state.look, on = shown(state);
    var size = 3.9 * k, label = 2.7 * k, small = 3.2 * k, paper = ink.paper;
    var lineStyle = function (v) { return v === "outline" || v === "contours" || v === "wireframe"; };
    function heading(t) {
      s.gap((typeface ? 4 : 2.6) * k);
      if (typeface) s.label(t, 4.94 * k, ink.ink); else s.label(t, label);
      s.add(0.8 * k, 0, function () {}).keep = true;
    }
    if (o && o.present) {
      ["terrain", "rivers", "streams", "buildings", "basin", "satellite", "at2200"].forEach(function (n) {
        on[n] = on[n] && o.present(n);
      });
    }

    state.line_order.slice().reverse().forEach(function (n) {
      if (o && o.line && o.line(s, n)) return;
      if (n !== "basin" && n !== "streams") return;
      if (!on[n]) return;
      var colour = n === "streams" && K.water === "white" ? K.white_line : L[n].colour;
      s.entry(n === "basin" ? "Basin boundary" : "Streams", size, stroke(colour, L[n].width_mm));
    });
    function fill(name, colour, white, style, outline) {
      if (style === "white") return s.entry(name, size, swatch(white));
      if (style === "xray") return s.entry(name + ", see through", size, swatch(colour, null, Math.max(0.25, K.xray_alpha)));
      if (lineStyle(style)) return s.entry(name + (style === "outline" ? ", edges" : ""), size, swatch(null, outline));
      s.entry(name, size, swatch(colour));
    }
    if (on.rivers) fill("River channels", L.rivers.colour, K.white_water, K.water, L.rivers.outline_colour);
    if (L.flood.source !== "none" && L.flood.opacity > 0 && (on.satellite || on.at2200)) {
      var colour = on.satellite ? L.flood.satellite_colour : L.flood.at2200_colour;
      s.gap(1 * k);
      fill(floodName(L.flood.source), colour, K.white_flood, K.flood, L.flood.outline_colour);
      s.text("Colour shows where water was mapped, not how deep it was.", small, { colour: ink.body });
      var note = floodNote(L.flood.source, manifest);
      if (note) s.text(note, small, { colour: ink.body });
    }

    if (o && o.sections) o.sections(s, heading);

    if (on.buildings) {
      var B = L.buildings, style = K.buildings;
      heading(B.flat ? "Buildings, footprints shown flat" : "Buildings, source of height");
      var known = "height from floor count or height tag", none = heightLabel(B);
      var plain = style === "shaded" || style === "flat" || style === "xray" ||
                  (style === "contours" && (K.contour_base === "ramp" || K.contour_base === "shaded"));
      if (plain) {
        var a = style === "xray" ? Math.max(0.35, K.xray_alpha) : 1;
        s.entry("from floor count (3 m per floor assumed)", size, swatch(B.floors_colour, null, a));
        s.entry("explicit height tag", size, swatch(B.explicit_colour, null, a));
        s.entry(none, size, swatch(B.none_colour, null, a));
      } else if (style === "white") {
        s.entry(known, size, swatch(K.white_building));
        s.entry(none, size, swatch(K.white_assumed));
      } else if (style === "wireframe") {
        s.entry(known, size, stroke(K.wire_colour, 0.3));
        s.entry(none, size, stroke(K.white_assumed, 0.3));
      } else {
        s.entry(known, size, swatch(K.contour_base === "none" && style === "contours" ? null : paper, K.outline_colour));
        s.entry(none, size, swatch(K.white_assumed, K.outline_colour));
      }
      if (style === "contours" && !B.flat) {
        s.text("Level lines on walls every " + metres(K.building_contour_m) + ".", small, { colour: ink.body });
      }
    }

    if (on.terrain) {
      var T = state.terrain, g = K.ground;
      heading("Ground");
      if (g === "shaded" || g === "xray") {
        rampItem(s, state, ink, k);
        s.text("Elevation in metres. " + (g === "xray" ? "Shown see through." : "Shaded relief."), small, { colour: ink.body });
      } else if (g === "flat") s.entry("Ground, one tone", size, swatch(K.flat_ground));
      else if (g === "white") s.entry("Ground, white model with shaded relief", size, swatch(K.white_ground));
      else if (g === "outline") s.entry("Ridges and outer edges of the ground", size, stroke(K.outline_colour, K.outline_mm));
      else if (g === "wireframe") {
        s.entry("Ground grid, one line every " + metres(K.wire_spacing_m), size, grid(K.wire_colour));
      } else {
        s.entry("Contours every " + metres(K.contour_interval_m) +
                (K.contour_index > 1 ? ", heavier every " + metres(K.contour_interval_m * K.contour_index) : ""),
                size, levels(K.contour_colour));
        if (K.contour_base === "ramp" || K.contour_base === "shaded") {
          rampItem(s, state, ink, k);
          s.text("Elevation in metres.", small, { colour: ink.body });
        }
      }
      if (state.view.elevation < 89.99 || boxOn(state)) {
        var floor = boxOn(state) && state.box.mode !== "inside" && state.box.min[2] > T.datum_m ? state.box.min[2] : null;
        s.text(floor === null ? "Solid base drawn down to " + signed(T.datum_m) + " m."
                              : "The ground is solid down to the box floor at " + (floor % 1 ? (floor < 0 ? "minus " : "") + POYO.fmt(Math.abs(floor), 1) : signed(floor)) + " m.",
               small, { colour: ink.body });
      }
    }

    if (boxOn(state)) {
      var cut = state.box.cut, any = false;
      var face = function (name, how, colour) {
        if (how === "none") return;
        if (!any) { heading("Cut faces"); any = true; }
        s.entry(name, size, how === "hatch"
          ? hatched(cut.hatch_back, colour, cut.hatch_angle, cut.hatch_spacing_mm, cut.hatch_line_mm, cut.line_colour)
          : swatch(colour, cut.line_colour));
      };
      if (on.terrain) face("Ground, cut", cut.ground_fill, cut.ground_colour);
      if (on.buildings && !L.buildings.flat) face("Buildings, cut", cut.buildings_fill, cut.building_colour);
    }
    return s;
  }

  function panel(column, k, ink, pad) {
    var w = column.width + 2 * pad, h = column.height + 2 * pad;
    return {
      w: w, h: h,
      draw: function (c, x, y, u) {
        c.fillStyle = ink.paper; c.fillRect(x * u, y * u, w * u, h * u);
        column.items.forEach(function (item) { item.draw(c, x + pad, y + pad + item.y, u); });
        c.strokeStyle = ink.muted; c.lineWidth = Math.max(0.15 * u, 0.5);
        c.strokeRect(x * u + c.lineWidth / 2, y * u + c.lineWidth / 2, w * u - c.lineWidth, h * u - c.lineWidth);
      }
    };
  }

  function sheet2(state, manifest, page) {
    var sheet = state.sheet, ink = inks(sheet);
    var base = POYO.clamp(Math.min(page.width_mm, page.height_mm) / 841, 0.35, 1.2);
    var k = base * sheet.text_size, margin = 14 * base, blocks = [];
    function place(thing, x, y, role) {
      var b = { x: x, y: y, w: thing.w, h: thing.h, role: role };
      b.draw = function (c, u) { thing.draw(c, b.x, b.y, u); };
      blocks.push(b);
      return b;
    }
    if (sheet.id_mark && sheet.panel_id) {
      // 72 point Arial on A0, top left
      var size = 25.4 * Math.min(1, base), pad = 3 * base, style = { family: "Arial, sans-serif" };
      var wide = width(sheet.panel_id, size, style);
      place({ w: wide + 2 * pad, h: size * 1.05 + 2 * pad, draw: function (c, x, y, u) {
        c.fillStyle = ink.paper; c.fillRect(x * u, y * u, (wide + 2 * pad) * u, (size * 1.05 + 2 * pad) * u);
        put(c, sheet.panel_id, x + pad, y + pad + size * 0.86, size, u,
            { family: "Arial, sans-serif", colour: ink.ink });
      } }, margin, margin, "id");
    }
    var title = null;
    if (sheet.title_block) {
      title = titleBlock(state, manifest, k, ink);
      place(title, page.width_mm - margin - title.w, page.height_mm - margin - title.h, "title");
    }
    var column = null;
    if (sheet.legend) {
      column = legend(state, manifest, k, ink);
    } else if (!title) {
      // whatever is switched off, the flood on show is named and sources are credited
      column = new Column(130 * k, ink);
      if (state.layers.flood.source !== "none") {
        column.text(floodName(state.layers.flood.source), 4 * k, { weight: 600 });
        var note = floodNote(state.layers.flood.source, manifest);
        if (note) column.text(note, 3.2 * k, { colour: ink.body });
      }
      var line = credits(state);
      if (line) column.text(line, 3.2 * k, { colour: ink.body });
      column.text("Vertical exaggeration " + times(state.view.ve) + ". Scale 1:" + POYO.fmtInt(state.view.scale) + ".",
                  3.2 * k, { colour: ink.body });
    }
    if (column && column.height > 0) {
      var thing = panel(column, k, ink, 3 * k);
      var y = page.height_mm - margin - thing.h;
      // on a narrow page the legend sits above the title block instead of under it
      if (title && margin + thing.w + 4 * k > page.width_mm - margin - title.w) y -= title.h + 4 * k;
      place(thing, margin, y, "legend");
    }
    return blocks;
  }

  function layout(state, manifest, page) {
    return state.sheet.layout === "stage1" ? first.layout(state, manifest, page) : sheet2(state, manifest, page);
  }

  POYO.sheetKit = { Column: Column, put: put, wrap: wrap, width: width, inks: inks, swatch: swatch, stroke: stroke,
                    grid: grid, levels: levels, hatched: hatched, titleBlock: titleBlock, legend: legend,
                    shown: shown, credits: credits, floodName: floodName, floodNote: floodNote, boxOn: boxOn,
                    signed: signed, metres: metres, times: times, niceDown: niceDown, withFace: withFace };
  POYO.annotate1 = first;
  POYO.annotate = { layout: layout, floodName: floodName, floodNote: floodNote, heightLabel: heightLabel,
                    credits: credits, missingSources: missingSources };
})();
