// annotate3.js: the Stage 3 sheet. The title block and the legend have their own
// column (landscape) or strip (portrait), so they never cover the drawing. The
// legend lists only what has content inside the section box.
// All positions and sizes are millimetres on paper.
"use strict";
(function () {
  var kit = POYO.sheetKit, before = POYO.annotate;

  // ==== what is inside the section box ========================================
  // The box footprint and heights in local metres; rect is null without a box.
  function region(scene, state) {
    var area = POYO.layers.region(scene, state);
    if (area.rect) area.z = [state.box.min[2], state.box.max[2]];
    return area;
  }

  function cached(scene, state, name, work) {
    var area = region(scene, state);
    if (!area.rect) return work(area);
    var key = name + JSON.stringify(area);
    if (!scene.legendCache) scene.legendCache = {};
    if (scene.legendCache[key] === undefined) scene.legendCache[key] = work(area);
    return scene.legendCache[key];
  }

  // Is something between heights lo and hi at x, y left on show by the box?
  function within(area, x, y, lo, hi) {
    var r = area.rect;
    var boxed = x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3] &&
                (lo === undefined || (hi >= area.z[0] && lo <= area.z[1]));
    return boxed !== area.inside;
  }

  function buildingsInside(scene, state) {
    var b = scene.buildings;
    if (!b) return false;
    var tall = state.layers.buildings.flat ? 0 : 60;
    return cached(scene, state, "buildings" + tall, function (area) {
      if (!area.rect) return true;
      var set = b.set, r = area.rect;
      for (var n = 0; n < b.bins.length; n++) {
        var bin = b.bins[n];
        if (!area.inside && (bin.box[0] > r[2] || bin.box[3] < r[0] || bin.box[1] > r[3] || bin.box[4] < r[1])) continue;
        for (var q = 0; q < bin.polys.length; q++) {
          var p = bin.polys[q], f = set.polyFeature[p], i = set.ringStart[set.polyRing[p]];
          var height = b.source[f] === 2 ? state.layers.buildings.default_height_m : b.height[f];
          if (within(area, set.xy[2 * i], set.xy[2 * i + 1], b.base[f], b.roof[f] + (tall ? height : 0))) return true;
        }
      }
      return false;
    });
  }

  function lineShown(line, area) {
    if (!line || !line.count) return false;
    if (!area.rect || !line.segs) return true;
    var v = line.segs;
    for (var i = 0; i < v.length; i += 6) {
      var z = (v[i + 2] + v[i + 5]) / 2;
      if (within(area, (v[i] + v[i + 3]) / 2, (v[i + 1] + v[i + 4]) / 2, z, z)) return true;
    }
    return false;
  }

  function fillShown(scene, fill, area) {
    if (!fill) return false;
    if (!area.rect || !fill.data) return true;
    var left = fill.xf[0], top = fill.xf[1], cell = fill.cell, ground = scene.grids.terrain_10m;
    var c0 = 0, c1 = fill.cols, r0 = 0, r1 = fill.rows;
    if (!area.inside) {
      c0 = POYO.clamp(Math.floor((area.rect[0] - left) / cell), 0, fill.cols);
      c1 = POYO.clamp(Math.ceil((area.rect[2] - left) / cell), 0, fill.cols);
      r0 = POYO.clamp(Math.floor((top - area.rect[3]) / cell), 0, fill.rows);
      r1 = POYO.clamp(Math.ceil((top - area.rect[1]) / cell), 0, fill.rows);
    }
    for (var r = r0; r < r1; r++) {
      for (var c = c0; c < c1; c++) {
        if (fill.data[r * fill.cols + c] <= 127) continue;
        var x = left + (c + 0.5) * cell, y = top - (r + 0.5) * cell, z = ground.height(x, y);
        if (within(area, x, y, z, z)) return true;
      }
    }
    return false;
  }

  // Road classes drawn inside the box. Tunnels are never drawn.
  function roadClasses(scene, state) {
    var road = scene.extra && scene.extra.roads;
    if (!road) return [];
    return cached(scene, state, "roadclasses", function (area) {
      var set = road.set, found = [];
      for (var p = 0; p < set.count; p++) {
        var f = set.polyFeature[p], k = road.klass[f];
        if (found[k] || road.tunnel[f]) continue;
        if (!area.rect) { found[k] = true; continue; }
        var ring = set.polyRing[p];
        for (var i = set.ringStart[ring]; i < set.ringStart[ring + 1]; i++) {
          if (within(area, set.xy[2 * i], set.xy[2 * i + 1])) { found[k] = true; break; }
        }
      }
      var out = [];
      found.forEach(function (yes, i) { if (yes) out.push(i); });
      return out;
    });
  }

  function present(scene, state, name) {
    if (!scene) return true;
    if (!region(scene, state).rect) return true;
    if (name === "terrain") return POYO.layers.regionKm2(scene, state) > 0;
    if (name === "buildings") return buildingsInside(scene, state);
    if (name === "rivers" || name === "satellite" || name === "at2200") {
      return cached(scene, state, "fill:" + name, function (area) { return fillShown(scene, scene.fills[name], area); });
    }
    return cached(scene, state, "line:" + name + ":" + (scene.lines[name] ? 1 : 0), function (area) {
      return lineShown(scene.lines[name], area);
    });
  }

  // ==== the legend ============================================================
  function seen(l) { return !!(l && l.visible && l.opacity > 0); }

  function classSection(s, heading, scene, manifest, state, slot, k, ink) {
    var set = state[slot];
    if (set.source === "none" || !scene || !(set.opacity > 0)) return;
    var table = POYO.layers.legendRows(scene, manifest, state, slot);
    if (!table || !(table.rows.length || table.hidden_km2 > 0.005)) return;
    var size = 3.35 * k, small = 3 * k, boxed = kit.boxOn(state);
    heading(table.title);
    if (slot === "cover") {
      s.text(POYO.layers.LABELS.note[set.source], small, { colour: ink.body });
      if (set.source === "observed") {
        s.text("English cover names are a translation of the names in the source records.", small, { colour: ink.body });
      }
      s.gap(0.8 * k);
    }
    var under = set.under === "paper" ? set.under_colour : "#FFFFFF";
    table.rows.forEach(function (r) {
      s.entry(r.label + ", " + POYO.layers.areaText(r), size,
              r.symbol ? POYO.symbols.swatch(r.symbol, under, set.pattern_scale) : kit.swatch(r.colour));
    });
    if (slot === "cover" && table.hidden_km2 > 0.005) {
      var share = table.total_km2 > 0 ? 100 * table.hidden_km2 / table.total_km2 : 0;
      s.entry("Other classes, one tone, " + POYO.layers.areaText({ km2: table.hidden_km2, share: share }), size,
              kit.swatch(set.hidden_colour));
    }
    if (set.boundaries) {
      s.entry("Class boundaries", size,
              kit.stroke(slot === "cover" ? set.boundary_colour : kit.inks(state.sheet).body,
                         slot === "cover" ? set.boundary_mm : 0.1));
    }
    s.text("Area and share of the basin" + (boxed ? " within the section box footprint" : "") + ", counted on a 5 m grid." +
           (slot === "cover" && table.off_km2 > 0.005 ?
            " Uses switched off in the map style are left blank, " + POYO.fmt(table.off_km2, 2) + " km²." : ""),
           small, { colour: ink.body });
  }

  function roadSection(s, heading, scene, manifest, state, k, ink) {
    var L = state.layers.roads;
    if (!seen(L) || !scene) return;
    var present = roadClasses(scene, state);
    if (!present.length) return;
    var size = 3.35 * k;
    heading("Roads, surface");
    if (L.colour_by === "single") s.entry("Road surface", size, kit.swatch(L.colour));
    else {
      POYO.layers.roadColours(manifest, state).forEach(function (c) {
        if (present.indexOf(c.index) >= 0) s.entry(c.name, size, kit.swatch(c.colour));
      });
    }
  }

  // Sections written by the water and tree modules, in one common shape.
  function moduleSection(s, heading, module, scene, manifest, state, k, ink) {
    if (!module || !module.legend) return;
    (module.legend(scene, manifest, state) || []).forEach(function (part) {
      heading(part.heading);
      (part.entries || []).forEach(function (e) {
        s.entry(e.label, 3.5 * k, kit.swatch(e.colour, e.border, e.alpha));
      });
      (part.notes || []).forEach(function (t) { s.text(t, 3 * k, { colour: ink.body }); });
    });
  }

  function legendColumn(state, manifest, scene, k, ink, width) {
    var column = new kit.Column(width, ink);
    kit.legend(state, manifest, k, ink, {
      column: column,
      present: function (name) { return present(scene, state, name); },
      line: function (s, name) {
        if (POYO.state.LINES3.indexOf(name) < 0) return false;
        var l = state.layers[name];
        if (seen(l) && l.width_mm > 0 && scene && scene.lines[name] && present(scene, state, name)) {
          s.entry(POYO.layers.LABELS.line[name], 3.9 * k, kit.stroke(l.colour, l.width_mm));
        }
        return true;
      },
      sections: function (s, heading) {
        moduleSection(s, heading, POYO.water, scene, manifest, state, k, ink);
        classSection(s, heading, scene, manifest, state, "cover", k, ink);
        classSection(s, heading, scene, manifest, state, "overlay", k, ink);
        roadSection(s, heading, scene, manifest, state, k, ink);
        moduleSection(s, heading, POYO.trees, scene, manifest, state, k, ink);
      }
    });
    return column;
  }

  // ==== flowing one long column into several ==================================
  function units(items) {
    var out = [], open = null;
    items.forEach(function (it) {
      if (!open) open = { top: it.y, bottom: it.y + it.h, items: [] };
      open.items.push(it);
      open.bottom = Math.max(open.bottom, it.y + it.h);
      if (!it.keep) { out.push(open); open = null; }
    });
    if (open) out.push(open);
    return out;
  }

  function cut(list, target) {
    var cols = [], col = null, tall = 0;
    list.forEach(function (u) {
      if (!col || u.bottom - col.top > target) { col = { top: u.top, items: [] }; cols.push(col); }
      col.items.push.apply(col.items, u.items);
      tall = Math.max(tall, u.bottom - col.top);
    });
    return { cols: cols, h: tall };
  }

  // The lowest height at which the column fits into n columns.
  function flow(column, n) {
    var list = units(column.items);
    if (!list.length) return { cols: [], h: 0 };
    var lo = list.reduce(function (m, u) { return Math.max(m, u.bottom - u.top); }, 0);
    var hi = list[list.length - 1].bottom - list[0].top;
    if (cut(list, lo).cols.length <= n) return cut(list, lo);
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      if (cut(list, mid).cols.length <= n) hi = mid; else lo = mid;
    }
    return cut(list, hi + 1e-6);
  }

  function flowPanel(split, wide, colW, gap, pad, ink, chrono) {
    var h = split.h + 2 * pad;
    return {
      w: wide, h: h,
      draw: function (c, x, y, u) {
        c.fillStyle = ink.paper; c.fillRect(x * u, y * u, wide * u, h * u);
        split.cols.forEach(function (col, i) {
          var left = x + pad + i * (colW + gap);
          col.items.forEach(function (it) { it.draw(c, left, y + pad + it.y - col.top, u); });
        });
        if (chrono) {                             // an ink rule above the legend, no box
          c.fillStyle = ink.ink; c.fillRect((x + pad) * u, y * u, (wide - 2 * pad) * u, Math.max(0.45 * u, 1));
          return;
        }
        c.strokeStyle = ink.muted; c.lineWidth = Math.max(0.15 * u, 0.5);
        c.strokeRect(x * u + c.lineWidth / 2, y * u + c.lineWidth / 2, wide * u - c.lineWidth, h * u - c.lineWidth);
      }
    };
  }

  function arrange(make, wide, n, kk, ink, room) {
    var pad = 3 * kk, gap = 5 * kk, colW = (wide - 2 * pad - (n - 1) * gap) / n;
    var split = flow(make(kk, colW), n);
    var fits = split.h + 2 * pad <= room + 1e-6;
    return { split: split, wide: wide, colW: colW, gap: gap, pad: pad, fits: fits };
  }

  // Last resort on a page too small for the whole list: say so, never cut silently.
  function trimmed(a, room, kk, ink) {
    var limit = room - 2 * a.pad - 5 * kk;
    a.split.cols.forEach(function (col) {
      col.items = col.items.filter(function (it) { return it.y + it.h - col.top <= limit; });
    });
    var note = new kit.Column(a.colW, ink);
    note.text("The list is longer than the page. The sidecar names every setting.", 3 * kk, { weight: 600 });
    if (a.split.cols.length) {
      var first = a.split.cols[0];
      note.items.forEach(function (it) { first.items.push({ y: first.top + limit + it.y, h: it.h, draw: it.draw }); });
    }
    a.split.h = room - 2 * a.pad;
    return a;
  }

  function usesClasses(state) {
    return state.cover.source !== "none" || state.overlay.source !== "none" || seen(state.layers.roads);
  }

  // ==== the sheet =============================================================
  function sheet3(state, manifest, page, scene) {
    var sheet = state.sheet, ink = kit.inks(sheet);
    var W = page.width_mm, H = page.height_mm;
    var base = POYO.clamp(Math.min(W, H) / 841, 0.35, 1.2);
    var k = base * sheet.text_size, margin = 14 * base, blocks = [];
    var side = sheet.panel_side === "right" || sheet.panel_side === "bottom" ? sheet.panel_side
             : W >= H || sheet.panel_export === "separate" ? "right" : "bottom";   // a panel of its own is a column
    var chrono = sheet.design === "chronogram";
    function place(thing, x, y, role) {
      var b = { x: x, y: y, w: thing.w, h: thing.h, role: role };
      b.draw = function (c, u) { thing.draw(c, b.x, b.y, u); };
      blocks.push(b);
      return b;
    }

    var layered = state.layers.flood.source !== "none", raised = !!state.water3d.flood;
    var hidden = POYO.styles && POYO.styles.floodHidden(state) && (layered || raised);
    var said = hidden ? "Flood hidden in this elevation"
             : raised && !layered ? "Water level scenario, not measured" : "";
    var title = null;
    if (sheet.title_block) title = kit.titleBlock(state, manifest, k, ink, said ? { floodText: said } : null);
    // the list beside the drawing: the legend, or the statements a bare sheet still needs
    var make = null;
    if (sheet.legend) {
      make = function (kk, width) { return legendColumn(state, manifest, scene, kk, ink, width); };
    } else if (!title) {
      make = function (kk, width) {
        var col = new kit.Column(width, ink);
        if (state.layers.flood.source !== "none" && !hidden) {
          col.text(kit.floodName(state.layers.flood.source), 4 * kk, { weight: 600 });
          var note = kit.floodNote(state.layers.flood.source, manifest);
          if (note) col.text(note, 3.2 * kk, { colour: ink.body });
        }
        var line = kit.credits(state);
        if (line) col.text(line, 3.2 * kk, { colour: ink.body });
        col.text("Vertical exaggeration " + kit.times(state.view.ve) + ". Scale 1:" +
                 POYO.fmtInt(state.view.scale) + ".", 3.2 * kk, { colour: ink.body });
        return col;
      };
    }

    var room, best = null, i, j, area = { x: 0, y: 0, w: W, h: H };
    if (title || make) {
      if (side === "right") {
        var panelW = Math.min(title ? title.w : 196 * k, W * 0.6);
        room = H - 2 * margin - (title ? title.h + 4 * k : 0);
        if (make) {
          var start = usesClasses(state) ? 2 : 1;
          var tries = [[1, start], [1, 2], [1.5, 3], [2, 4]], scales = [1, 0.9, 0.8, 0.7];
          for (i = 0; i < tries.length && !(best && best.fits); i++) {
            var wide = Math.min(panelW * tries[i][0], W * 0.62);
            for (j = 0; j < scales.length && !(best && best.fits); j++) {
              best = arrange(make, wide, tries[i][1], k * scales[j], ink, room);
              best.k = k * scales[j];
            }
          }
          if (!best.fits) best = trimmed(best, room, best.k, ink);
        }
        var column = make ? best.wide : panelW;
        if (title) column = Math.max(column, title.w);
        if (make && best.split.cols.length) {
          place(flowPanel(best.split, best.wide, best.colW, best.gap, best.pad, ink, chrono),
                W - margin - best.wide, margin + (chrono && title ? title.h + 4 * k : 0), "legend");
        }
        if (title) place(title, W - margin - title.w, chrono ? margin : H - margin - title.h, "title");
        area = { x: 0, y: 0, w: Math.max(10, W - 2 * margin - column), h: H };
      } else {
        var beside = title ? title.w + 4 * k : 0;
        var legendW = W - 2 * margin - beside;
        var under = false;
        if (make && legendW < 90 * k) { legendW = W - 2 * margin; under = true; }
        var limit = H * 0.46;
        if (make) {
          var factors = [1, 0.9, 0.8, 0.7, 0.62];
          for (j = 0; j < factors.length && !(best && best.fits); j++) {
            var kk = k * factors[j];
            var most = Math.max(1, Math.floor((legendW - 6 * kk + 5 * kk) / (80 * kk + 5 * kk)));
            best = arrange(make, legendW, most, kk, ink, under && title ? limit - title.h - 4 * k : limit);
            best.k = kk;
          }
          if (!best.fits) best = trimmed(best, under && title ? limit - title.h - 4 * k : limit, best.k, ink);
        }
        var list = make && best.split.cols.length
          ? flowPanel(best.split, best.wide, best.colW, best.gap, best.pad, ink, chrono) : null;
        var strip = Math.max(title ? title.h : 0, list ? list.h : 0);
        if (under && title && list) strip = title.h + 4 * k + list.h;
        if (list) place(list, margin, H - margin - (under && title ? title.h + 4 * k : 0) - list.h, "legend");
        if (title) place(title, W - margin - title.w, H - margin - title.h, "title");
        area = { x: 0, y: 0, w: W, h: Math.max(10, H - strip - 2 * margin) };
      }
      // a hairline between the drawing and the panels
      var rule = side === "right" ? { x: area.w, y: 0, w: 0.3, h: H } : { x: 0, y: area.h, w: W, h: 0.3 };
      blocks.push({ x: rule.x, y: rule.y, w: rule.w, h: rule.h, role: "rule", draw: function (c, u) {
        c.fillStyle = chrono ? ink.rule : ink.muted;
        c.fillRect(rule.x * u, rule.y * u, Math.max(rule.w * u, side === "right" ? 0.6 : 1),
                   Math.max(rule.h * u, side === "right" ? 1 : 0.6));
      } });
    }

    if (sheet.id_mark && sheet.panel_id) {
      // 72 point Arial on A0, top left
      var size = 25.4 * Math.min(1, base), pad = 3 * base, style = { family: "Arial, sans-serif" };
      var wideId = kit.width(sheet.panel_id, size, style);
      place({ w: wideId + 2 * pad, h: size * 1.05 + 2 * pad, draw: function (c, x, y, u) {
        c.fillStyle = ink.paper; c.fillRect(x * u, y * u, (wideId + 2 * pad) * u, (size * 1.05 + 2 * pad) * u);
        kit.put(c, sheet.panel_id, x + pad, y + pad + size * 0.86, size, u,
                { family: "Arial, sans-serif", colour: ink.ink });
      } }, margin, margin, "id");
    }
    var panelSheet = null;
    if (sheet.panel_export === "separate") {
      // the drawing takes the whole sheet; title and legend are stacked for their own file
      var parts = blocks.filter(function (b) { return b.role === "title" || b.role === "legend"; });
      parts.sort(function (a, b) { return (a.role === "title" ? 0 : 1) - (b.role === "title" ? 0 : 1); });
      if (!chrono) parts.reverse();
      if (parts.length) {
        var wide2 = parts.reduce(function (m, b) { return Math.max(m, b.w); }, 0), down = margin;
        parts.forEach(function (b, n) {
          if (n) down += 4 * k;
          b.x = margin; b.y = down; down += b.h;
        });
        panelSheet = { w: wide2 + 2 * margin, h: down + margin, blocks: parts };
      }
      blocks = blocks.filter(function (b) { return b.role === "id"; });
      area = { x: 0, y: 0, w: W, h: H };
    }
    blocks.window = area;
    blocks.side = side;
    blocks.panel = panelSheet;
    return blocks;
  }

  // True when the sheet needs something only the Stage 3 legend can list.
  function hasNew(state) {
    return state.cover.source !== "none" || state.overlay.source !== "none" || state.layers.roads.visible ||
           POYO.state.LINES3.some(function (n) { return state.layers[n].visible; }) ||
           !!(state.water3d.channel || state.water3d.flood || state.trees.on);
  }
  function isStage3(state) {
    var l = state.sheet.layout;
    return l === "stage3" || (l === "stage2" && hasNew(state));
  }
  function layout(state, manifest, page, scene) {
    if (!isStage3(state)) return before.layout(state, manifest, page);
    return sheet3(state, manifest, page, scene || (POYO.app && POYO.app.scene) || null);
  }
  // The part of the page the drawing may use, in millimetres, or null for the whole page.
  function drawingWindow(state, manifest, page, scene) {
    if (!isStage3(state)) return null;
    return layout(state, manifest, page, scene).window;
  }

  POYO.annotate = { layout: layout, window: drawingWindow, isStage3: isStage3, floodName: before.floodName,
                    floodNote: before.floodNote, heightLabel: before.heightLabel, credits: before.credits,
                    missingSources: before.missingSources, present: present };
})();
