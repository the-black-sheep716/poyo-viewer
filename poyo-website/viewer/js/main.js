// main.js: loads the data, owns the screen view and connects the panels.
"use strict";
(function () {
  var started = performance.now();
  var app = {
    state: POYO.state.defaults(), manifest: null, frame: null, scene: null, gl: null,
    folder: null, fitOnPreset: true, light: false, moving: false, busy: false,
    timings: [], rotation: null, lastExport: null, drag: null,
    // interface only, never part of a sidecar
    panel: "view", panels: { rail: true, inspector: true, drawer: false }, dark: false,
    showHandles: true, drawing: null, grab: null, hover: "", views: null, customThemes: []
  };
  POYO.app = app;

  var UI_STORE = "poyo_ui_v1", THEME_STORE = "poyo_themes_v1", HINT = 24;
  var canvas, overlay, checker, stage, pending = false, settle = 0, samples = null, handlesOnScreen = [];

  function $(id) { return document.getElementById(id); }

  function step(text) {
    var now = performance.now();
    if (app.timings.length) app.timings[app.timings.length - 1].ms = Math.round(now - app.timings[app.timings.length - 1].at);
    if (text) {
      app.timings.push({ name: text, at: now, ms: 0 });
      $("loading-text").textContent = text;
    }
    return new Promise(function (r) { setTimeout(r, 20); });     // let the message appear
  }

  async function loadFonts() {
    if (!window.FontFace || !POYO.fontData) return;
    await Promise.all(POYO.fontData.map(function (f) {
      var bin = atob(f.data), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var faces = [new FontFace(f.family, bytes.slice().buffer, { weight: String(f.weight) })];
      // the same letters with equal width figures, for coordinates, scales and angles
      if (f.family === "Poyo Inter") {
        faces.push(new FontFace("Poyo Inter Tabular", bytes.slice().buffer,
                                { weight: String(f.weight), featureSettings: '"tnum"' }));
      }
      return Promise.all(faces.map(function (face) {
        return face.load().then(function (loaded) { document.fonts.add(loaded); }).catch(function () {});
      }));
    }));
  }

  // ==== screen layout. The canvas fills the stage; the sheet sits in the part the panels leave free.
  function layout() {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
    var mm = POYO.state.paperSize(app.state.sheet), pad = 20;
    var left = app.panels.rail ? $("rail").offsetWidth : 0, right = app.panels.inspector ? $("inspector").offsetWidth : 0;
    var bottom = app.panels.drawer ? $("drawer").offsetHeight : HINT;
    var freeW = Math.max(80, w - left - right), freeH = Math.max(80, h - bottom);
    var scale = Math.max(0.02, Math.min((freeW - 2 * pad) / mm[0], (freeH - 2 * pad) / mm[1]));
    var cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    var devPerMm = scale * cw / w;                       // device pixels per paper millimetre
    var N = app.state.view.scale;
    var centreX = left + freeW / 2, centreY = freeH / 2;
    return { dpr: dpr, cssW: w, cssH: h, width: cw, height: ch, mm: mm,
             frameW: Math.max(1, mm[0] * scale), frameH: Math.max(1, mm[1] * scale),
             centreX: centreX, centreY: centreY, pxPerM: scale * 1000 / N,
             tile: [1, 1, (centreX - w / 2) / w * 2, -(centreY - h / 2) / h * 2],
             devPerMm: devPerMm, mpp: N / 1000 / devPerMm };   // ground metres per device pixel
  }

  function boxShown() { return app.state.box.enabled && POYO.state.boxIsSet(app.state.box); }

  function draw() {
    pending = false;
    if (!app.scene || app.busy) return;
    readMissing();
    var q = layout(), s = app.state, gl = app.gl;
    if (canvas.width !== q.width || canvas.height !== q.height) { canvas.width = q.width; canvas.height = q.height; }
    var see = s.sheet.background === "transparent";
    checker.hidden = !see;
    if (see) {
      checker.style.left = (q.centreX - q.frameW / 2) + "px"; checker.style.top = (q.centreY - q.frameH / 2) + "px";
      checker.style.width = q.frameW + "px"; checker.style.height = q.frameH + "px";
    }
    var paper = POYO.hexToRgb(s.sheet.paper_colour);
    var clear = see ? [0, 0, 0, 0] : [paper[0], paper[1], paper[2], 1];
    var shown = s;
    // while a new box is being drawn the whole model is on show
    if (app.drawing) shown = Object.assign({}, s, { box: Object.assign({}, s.box, { enabled: false }) });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    app.scene.render({ state: shown, size: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
                       mpp: q.mpp, tile: q.tile, pxPerMm: q.devPerMm,
                       cell: app.moving || app.light ? 20 : 10, clear: clear });
    var blocks = drawOverlay(q);
    // inside the sheet, only the drawing window shows the model
    if (blocks && blocks.window) {
      var kx = gl.drawingBufferWidth / q.cssW, ky = gl.drawingBufferHeight / q.cssH;
      var right = (q.centreX - q.frameW / 2) * kx, top = (q.centreY - q.frameH / 2) * ky, w = blocks.window;
      var x0 = Math.round(right + (w.x + w.w) / q.mm[0] * q.frameW * kx);
      var y0 = Math.round(top + (w.y + w.h) / q.mm[1] * q.frameH * ky);
      var x1 = Math.round(right + q.frameW * kx), y1 = Math.round(top + q.frameH * ky);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
      var H = gl.drawingBufferHeight;
      if (x1 > x0) { gl.scissor(x0, H - y1, x1 - x0, y1 - Math.round(top)); gl.clear(gl.COLOR_BUFFER_BIT); }
      if (y1 > y0) { gl.scissor(Math.round(right), H - y1, x1 - Math.round(right), y1 - y0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.disable(gl.SCISSOR_TEST);
    }
    $("title-view").textContent = POYO.camera.viewName(s.view);
    $("title-scale").textContent = "1:" + POYO.fmtInt(s.view.scale) + "  ·  × " + s.view.ve + " vertical" +
                                   (boxShown() ? "  ·  section box" : "");
    $("title-flood").textContent = POYO.annotate.floodName(s.layers.flood.source);
  }

  function drawOverlay(q) {
    var d = q.dpr, w = q.width, h = q.height;
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    var c = overlay.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    var kx = w / q.cssW, ky = h / q.cssH;
    var fx = (q.centreX - q.frameW / 2) * kx, fy = (q.centreY - q.frameH / 2) * ky,
        fw = q.frameW * kx, fh = q.frameH * ky;
    // quieten what lies outside the sheet
    c.fillStyle = app.dark ? "rgba(0,0,0,0.5)" : "rgba(45,45,45,0.14)";
    c.beginPath(); c.rect(0, 0, w, h); c.rect(fx, fy, fw, fh); c.fill("evenodd");
    c.save();
    c.translate(fx, fy);
    var page = { width_mm: q.mm[0], height_mm: q.mm[1] }, u = fw / q.mm[0];
    var blocks = POYO.annotate.layout(app.state, app.manifest, page, app.scene);
    blocks.forEach(function (b) { c.save(); b.draw(c, u); c.restore(); });
    c.restore();
    c.strokeStyle = app.dark ? "#8F8F8A" : "#686863"; c.lineWidth = Math.max(1, d);
    c.strokeRect(fx, fy, fw, fh);

    var accent = app.dark ? "#FF3D9E" : "#E6007E";
    handlesOnScreen = [];
    c.setTransform(kx, 0, 0, ky, 0, 0);                     // CSS pixels from here on
    if (app.drawing && app.drawing.from) {
      var f = app.drawing.from, t = app.drawing.to;
      c.strokeStyle = accent; c.lineWidth = 1.5;
      c.strokeRect(Math.min(f[0], t[0]), Math.min(f[1], t[1]), Math.abs(t[0] - f[0]), Math.abs(t[1] - f[1]));
      return blocks;
    }
    if (!app.drawing && app.showHandles && boxShown()) {
      c.strokeStyle = app.dark ? "#B4B4AF" : "#686863"; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath();
      POYO.boxtools.edges(app, q).forEach(function (e) { c.moveTo(e[0][0], e[0][1]); c.lineTo(e[1][0], e[1][1]); });
      c.stroke(); c.setLineDash([]);
      handlesOnScreen = POYO.boxtools.handles(app, q);
      var active = app.grab ? app.grab.handle.name : app.hover;
      handlesOnScreen.forEach(function (hd) {
        var on = hd.name === active, r = on ? 5.5 : 4.5;
        c.fillStyle = on ? accent : (app.dark ? "#0B0B0B" : "#FFFFFF");
        c.fillRect(hd.x - r, hd.y - r, 2 * r, 2 * r);
        c.strokeStyle = accent; c.lineWidth = 1.5; c.strokeRect(hd.x - r, hd.y - r, 2 * r, 2 * r);
      });
    }
    return blocks;
  }

  // ==== data that is read only when a picture needs it
  function busyText(text) { var el = $("title-busy"); if (el) el.textContent = text || ""; }

  // Everything a picture of this state needs, read and built before it is drawn.
  app.prepare = async function (state, say) {
    await POYO.layers.ensure(app.scene, app.manifest, state, say || busyText);
    if (POYO.trees) POYO.trees.build(app.scene, app.manifest, state);
  };

  var failedRead = "";
  function needsWork(state) {
    return POYO.layers.missing(app.scene, state).length > 0 ||
           !!(POYO.trees && POYO.trees.stale(app.scene, state));
  }
  function readMissing() {
    if (app.reading || !needsWork(app.state)) return;
    var key = JSON.stringify([POYO.layers.wanted(app.state, app.manifest), app.state.trees]);
    if (key === failedRead) return;
    busyText("Reading data");
    app.reading = new Promise(function (r) { setTimeout(r, 30); })     // let the message appear
      .then(function () { return app.prepare(app.state); })
      .then(function () { busyText(""); }, function (e) {
        console.error(e);
        failedRead = key;
        busyText("Not read: " + e.message);
      })
      .then(function () {
        app.reading = null;
        POYO.ui.rebuild();
        app.requestRender();
      });
  }

  app.layout = layout;                       // where the sheet sits on screen

  app.requestRender = function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(draw);
  };

  // Use the light ground while something is moving, then redraw in full.
  function stir() {
    app.moving = true;
    clearTimeout(settle);
    settle = setTimeout(function () { app.moving = false; app.requestRender(); }, 280);
  }

  app.changed = function (moving) {
    POYO.state.sanitise(app.state);
    if (moving) stir();
    POYO.ui.refresh();
    app.requestRender();
  };

  // ==== fitting
  function samplePoints() {
    if (samples) return samples;
    var g = app.scene.grids.terrain_20m, pts = [];
    for (var r = 0; r < g.rows; r += 8) {
      for (var c = 0; c < g.cols; c += 8) {
        if (g.mask[r * g.cols + c]) pts.push([g.left + (c + 0.5) * g.cell, g.top - (r + 0.5) * g.cell, g.at(c, r)]);
      }
    }
    var set = app.outline;
    for (var i = 0; i < set.xy.length / 2; i += 4) {
      pts.push([set.xy[2 * i], set.xy[2 * i + 1], app.state.terrain.datum_m]);
      pts.push([set.xy[2 * i], set.xy[2 * i + 1], app.scene.grids.terrain_10m.height(set.xy[2 * i], set.xy[2 * i + 1])]);
    }
    samples = pts;
    return pts;
  }

  function niceScale(n) {
    var p = Math.pow(10, Math.floor(Math.log10(n)) - 1), lead = n / (p * 10);
    var stepSize = lead < 2 ? p * 1 : lead < 5 ? p * 2.5 : p * 5;
    return Math.ceil(n / stepSize - 1e-9) * stepSize;
  }

  // the eight corners of the section box, in local metres
  function boxPoints() {
    var b = POYO.section.local(app.state, app.frame), out = [];
    for (var i = 0; i < 8; i++) {
      out.push([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
    }
    return out;
  }

  // Sets scale and target so that the basin, or the section box, fills the drawing window.
  app.fit = function (what) {
    var v = app.state.view, mm = POYO.state.paperSize(app.state.sheet);
    var onBox = what === "box" && boxShown();
    var b = POYO.camera.basis(v.azimuth, v.elevation), datum = app.state.terrain.datum_m;
    var pts = onBox ? boxPoints() : samplePoints();
    if (onBox) datum = -Infinity;
    var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    pts.forEach(function (p) {
      var z = Math.max(p[2], datum) * v.ve;
      var x = b.r[0] * p[0] + b.r[1] * p[1] + b.r[2] * z, y = b.u[0] * p[0] + b.u[1] * p[1] + b.u[2] * z;
      if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
      if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    });
    var cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
    var page = { width_mm: mm[0], height_mm: mm[1] }, need, area = null;
    if (POYO.annotate.isStage3(app.state)) {
      var margin = app.state.sheet.margin_mm;
      // the window depends a little on the legend, which depends on the view, so settle twice
      for (var turn = 0; turn < 2; turn++) {
        area = POYO.annotate.window(app.state, app.manifest, page, app.scene);
        need = Math.max((hi[0] - lo[0]) / (Math.max(10, area.w - 2 * margin) / 1000),
                        (hi[1] - lo[1]) / (Math.max(10, area.h - 2 * margin) / 1000));
        v.scale = POYO.clamp(niceScale(need), 200, 1000000);
      }
      // the target is the middle of the page, so shift it by the offset of the window
      cx -= (area.x + area.w / 2 - mm[0] / 2) / 1000 * v.scale;
      cy -= (mm[1] / 2 - area.y - area.h / 2) / 1000 * v.scale;
    } else {
      need = Math.max((hi[0] - lo[0]) / (mm[0] / 1000 * 0.92), (hi[1] - lo[1]) / (mm[1] / 1000 * 0.80));
      v.scale = POYO.clamp(niceScale(need), 200, 1000000);
    }
    v.target = [b.r[0] * cx + b.u[0] * cy, b.r[1] * cx + b.u[1] * cy, (b.r[2] * cx + b.u[2] * cy) / v.ve];
    app.changed();
  };

  app.setPreset = function (key) {
    var p = POYO.camera.PRESETS[key], v = app.state.view;
    v.azimuth = p.azimuth; v.elevation = p.elevation;
    if (app.fitOnPreset) app.fit(); else app.changed();
  };

  app.reorder = function (listName, name, dir) {
    var list = app.state[listName], at = list.indexOf(name), to = at + dir;
    if (to < 0 || to >= list.length) return;
    list.splice(at, 1); list.splice(to, 0, name);
    POYO.ui.rebuild();
    app.changed();
  };

  app.resetStyles = function () {
    var d = POYO.state.defaults();
    app.state.layers = d.layers; app.state.terrain = d.terrain;
    app.state.fill_order = d.fill_order; app.state.line_order = d.line_order;
    app.state.look = d.look; app.state.box.cut = d.box.cut; app.state.theme_name = d.theme_name;
    ["paper_colour", "ink", "body_ink", "muted_ink"].forEach(function (k) { app.state.sheet[k] = d.sheet[k]; });
    var m = app.manifest.entries.buildings.default_height_m;
    app.state.layers.buildings.default_height_m = m; app.state.layers.buildings.industrial_height_m = m;
    app.setDark(false);
    POYO.ui.rebuild();
    app.changed();
  };

  // ==== interface
  function panelClasses() {
    stage.classList.toggle("no-rail", !app.panels.rail);
    stage.classList.toggle("no-inspector", !app.panels.inspector);
    stage.classList.toggle("drawer-open", app.panels.drawer);
    $("hint").hidden = app.panels.drawer;
  }
  app.togglePanel = function (name, on) {
    app.panels[name] = on === undefined ? !app.panels[name] : !!on;
    panelClasses();
    POYO.ui.refresh();
    app.requestRender();
    if (name === "drawer" && app.panels.drawer) $("export-button").focus({ preventScroll: true });
  };
  app.select = function (key) {
    app.panel = key; app.panels.inspector = true;
    panelClasses();
    POYO.ui.rebuild();
    app.requestRender();
  };
  app.setDark = function (on) {
    app.dark = !!on;
    document.body.classList.toggle("dark", app.dark);
    POYO.views.write(UI_STORE, { dark: app.dark });
    POYO.ui.refresh();
    app.requestRender();
  };
  app.toggle = function (what) {
    var sheet = app.state.sheet;
    if (what === "dark") return app.setDark(!app.dark);
    if (what === "box") POYO.boxtools.enable(app, !app.state.box.enabled);
    else {
      var key = what === "title" ? "title_block" : "legend";
      // the Stage 1 sheet has neither, so asking for one moves to the new sheet
      if (sheet.layout === "stage1") { sheet.layout = "stage3"; sheet[key] = true; } else sheet[key] = !sheet[key];
    }
    app.changed();
  };

  var HINT_TEXT = null;
  app.startDrawing = function () {
    var v = app.state.view;
    v.azimuth = 0; v.elevation = 90;
    app.drawing = { from: null, to: null };
    if (HINT_TEXT === null) HINT_TEXT = $("hint").textContent;
    $("hint").textContent = "Drag a rectangle on the plan to set the section box. Esc cancels.";
    canvas.style.cursor = "crosshair";
    app.changed();
  };
  app.stopDrawing = function () {
    if (!app.drawing) return;
    app.drawing = null;
    $("hint").textContent = HINT_TEXT;
    canvas.style.cursor = "";
    app.changed();
  };

  // ==== mouse, touch, keys
  function interaction() {
    var pointers = new Map(), mode = null;
    function at(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function handleAt(p) {
      var best = null, near = 12;
      handlesOnScreen.forEach(function (h) {
        var d = Math.max(Math.abs(h.x - p[0]), Math.abs(h.y - p[1]));
        if (d <= near) { near = d; best = h; }
      });
      return best;
    }
    function hover(p) {
      var h = p && !app.drawing ? handleAt(p) : null, name = h ? h.name : "";
      if (!app.drawing) {
        canvas.style.cursor = h ? (Math.abs(h.vec[0]) > Math.abs(h.vec[1]) ? "ew-resize" : "ns-resize") : "";
      }
      if (name !== app.hover) { app.hover = name; app.requestRender(); }
    }
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("blur", function () { canvas.classList.remove("by-pointer"); });
    canvas.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      canvas.classList.add("by-pointer");     // no focus ring round the drawing after a click
      canvas.focus();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      var p = at(e), h = e.button === 0 && !e.shiftKey && !app.drawing && pointers.size === 1 ? handleAt(p) : null;
      if (app.drawing && e.button === 0) { mode = "rect"; app.drawing.from = p; app.drawing.to = p; }
      else if (h) {
        mode = "handle";
        app.grab = { handle: h, start: app.state.box[h.side][h.axis], from: p };
      } else mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? "pan" : "orbit";
      if (mode === "orbit" && app.scene) {
        POYO.camera.groundTarget(app.state.view, app.scene.grids.terrain_20m, function (x, y) { return app.scene.inside(x, y); });
      }
      app.requestRender();
    });
    function release(e) {
      pointers.delete(e.pointerId);
      if (pointers.size) return;
      if (mode === "rect" && app.drawing && app.drawing.from) {
        var f = app.drawing.from, t = app.drawing.to, q = layout(), v = app.state.view;
        if (Math.abs(t[0] - f[0]) > 6 && Math.abs(t[1] - f[1]) > 6 && e.type === "pointerup") {
          // plan view with north up, so screen right is east and screen up is north
          var east = function (p) { return v.target[0] + (p[0] - q.centreX) / q.pxPerM; };
          var north = function (p) { return v.target[1] - (p[1] - q.centreY) / q.pxPerM; };
          POYO.boxtools.fromRect(app, east(f), north(f), east(t), north(t));
          app.stopDrawing();
          app.select("box");
        } else { app.drawing.from = app.drawing.to = null; app.requestRender(); }
      }
      if (mode === "handle") { app.grab = null; app.changed(); }
      mode = null;
    }
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("pointerleave", function () { if (!pointers.size) hover(null); });
    canvas.addEventListener("pointermove", function (e) {
      if (app.busy) return;
      if (!pointers.has(e.pointerId)) { hover(at(e)); return; }
      var last = pointers.get(e.pointerId), dx = e.clientX - last[0], dy = e.clientY - last[1];
      var v = app.state.view, q = layout(), perCss = q.mpp * q.width / q.cssW;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (mode === "rect") { if (app.drawing) { app.drawing.to = at(e); app.requestRender(); } return; }
      if (mode === "handle" && app.grab) {
        var p = at(e), g = app.grab;
        POYO.boxtools.dragged(app, g.handle, g.start, p[0] - g.from[0], p[1] - g.from[1]);
        app.changed(true);
        return;
      }
      if (pointers.size === 2) {
        // two fingers: pinch to scale, drag to move
        var ids = Array.from(pointers.keys()), other = pointers.get(ids[0] === e.pointerId ? ids[1] : ids[0]);
        var before = Math.hypot(last[0] - other[0], last[1] - other[1]);
        var after = Math.hypot(e.clientX - other[0], e.clientY - other[1]);
        if (before > 5 && after > 5) zoom(before / after, (e.clientX + other[0]) / 2, (e.clientY + other[1]) / 2);
        POYO.camera.shift(v, -dx / 2 * perCss, dy / 2 * perCss);
      } else if (mode === "pan" || app.drawing) {
        POYO.camera.shift(v, -dx * perCss, dy * perCss);
      } else {
        v.azimuth += dx * 0.3;
        v.elevation = POYO.clamp(v.elevation + dy * 0.3, 0, 90);
      }
      app.changed(true);
    });
    // keep the ground point under the pointer where it is
    function zoom(factor, clientX, clientY) {
      var v = app.state.view, q = layout(), rect = canvas.getBoundingClientRect();
      var ox = (clientX - rect.left - q.centreX) * q.width / q.cssW;
      var oy = -(clientY - rect.top - q.centreY) * q.height / q.cssH;
      var scale = POYO.clamp(v.scale * factor, 200, 1000000), mpp = q.mpp * scale / v.scale;
      POYO.camera.shift(v, ox * (q.mpp - mpp), oy * (q.mpp - mpp));
      v.scale = scale;
    }
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (app.busy) return;
      var delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
      zoom(Math.exp(POYO.clamp(delta, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      app.state.view.scale = Math.round(app.state.view.scale);
      app.changed(true);
    }, { passive: false });

    var PRESET_KEYS = ["plan", "elev_s", "elev_e", "elev_n", "elev_w", "iso_ne", "iso_se", "iso_sw", "iso_nw"];
    document.addEventListener("keydown", function (e) {
      if (!app.ready) return;
      // square brackets need AltGr on Spanish and Norwegian keyboards
      var altGr = e.getModifierState && e.getModifierState("AltGraph");
      if ((e.ctrlKey || e.metaKey || e.altKey) && !altGr) return;
      var t = e.target, tag = t && t.tagName;
      if (e.key === "Escape") {
        if (app.drawing) app.stopDrawing();
        else if (app.panels.drawer) app.togglePanel("drawer", false);
        else if (t && t.blur) t.blur();
        return;
      }
      if (tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && t.type !== "checkbox")) return;
      if (app.busy) return;
      var v = app.state.view, q = layout(), move = 40 * q.mpp, done = true, moved = false, key = e.key.toLowerCase();
      if (/^[1-9]$/.test(e.key)) app.setPreset(PRESET_KEYS[+e.key - 1]);
      else if (key === "f") app.fit();
      else if (key === "b") app.toggle("box");
      else if (key === "t") app.toggle("title");
      else if (key === "l") app.toggle("legend");
      else if (key === "d") app.toggle("dark");
      else if (key === "e") app.togglePanel("drawer");
      else if (e.key === "[") app.togglePanel("rail");
      else if (e.key === "]") app.togglePanel("inspector");
      else {
        moved = true;
        if (e.key === "ArrowLeft") e.shiftKey ? POYO.camera.shift(v, -move, 0) : v.azimuth -= 5;
        else if (e.key === "ArrowRight") e.shiftKey ? POYO.camera.shift(v, move, 0) : v.azimuth += 5;
        else if (e.key === "ArrowUp") e.shiftKey ? POYO.camera.shift(v, 0, move) : v.elevation += 5;
        else if (e.key === "ArrowDown") e.shiftKey ? POYO.camera.shift(v, 0, -move) : v.elevation -= 5;
        else if (e.key === "+" || e.key === "=") v.scale = Math.round(v.scale / 1.15);
        else if (e.key === "-" || e.key === "_") v.scale = Math.round(v.scale * 1.15);
        else done = false;
      }
      if (done) { e.preventDefault(); if (moved) app.changed(true); }
    });
    $("rail-edge").addEventListener("click", function () { app.togglePanel("rail"); });
    $("inspector-edge").addEventListener("click", function () { app.togglePanel("inspector"); });
  }

  // ==== themes, views and files
  var builtin = null;
  app.allThemes = function () {
    if (!builtin) builtin = POYO.themes.builtin();
    var out = builtin.map(function (t) { return { theme: t, builtin: true }; });
    app.customThemes.forEach(function (t) {
      var same = out.filter(function (o) { return o.theme.name === t.name; })[0];
      if (same) { same.theme = t; same.builtin = false; } else out.push({ theme: t, builtin: false });
    });
    return out;
  };
  app.keepTheme = function (theme) {
    app.customThemes = app.customThemes.filter(function (t) { return t.name !== theme.name; }).concat([theme]);
    POYO.views.write(THEME_STORE, app.customThemes);
  };
  app.forgetTheme = function (name) {
    app.customThemes = app.customThemes.filter(function (t) { return t.name !== name; });
    POYO.views.write(THEME_STORE, app.customThemes);
    app.themeMessage = "";
    POYO.ui.rebuild();
  };
  app.applyTheme = function (theme) {
    var skipped = POYO.themes.apply(app.state, theme);
    app.themeMessage = "Applied “" + app.state.theme_name + "”." +
      (skipped.length ? " Not used, check the spelling or value: " + skipped.join(", ") + "." : "");
    app.setDark(theme.interface === "dark");
    app.changed();
    POYO.ui.rebuild();
  };
  app.loadTheme = async function (file) {
    try {
      var theme = POYO.themes.check(JSON.parse(await file.text()));
      app.keepTheme(theme);
      app.applyTheme(theme);
    } catch (e) {
      app.themeMessage = "Could not load the theme: " + e.message;
      POYO.ui.rebuild();
    }
  };

  // Write a small JSON file where the user says, or as a download. Returns a message.
  app.saveJson = async function (name, data) {
    var body = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
    if (window.showSaveFilePicker) {
      try {
        var handle = await window.showSaveFilePicker({ suggestedName: name, id: "poyo-json",
          types: [{ description: "JSON file", accept: { "application/json": [".json"] } }] });
        var stream = await handle.createWritable();
        await stream.write(body); await stream.close();
        return "Saved “" + handle.name + "”.";
      } catch (e) {
        if (e.name === "AbortError") return "";
        console.warn("The browser would not save through the file window: " + e.message);
      }
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(body); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    return "Sent “" + name + "” to the browser downloads.";
  };

  app.applyView = function (i) {
    var v = app.views.views[i];
    if (!v) return;
    var same = app.applySidecar(v.sidecar);
    app.viewsMessage = "Showing “" + v.name + "”." + (same ? "" : " It was saved with a different data build.");
    POYO.ui.rebuild();
  };

  app.exportViews = async function () {
    if (app.busy || !app.views.views.length) return;
    app.togglePanel("drawer", true);
    var bar = $("export-progress"), status = $("export-status"), buttons = [$("export-button"), $("export-views")];
    bar.hidden = false; buttons.forEach(function (b) { b.disabled = true; });
    try {
      var r = await POYO.views.exportAll(app, app.views,
        function (f, t) { bar.value = f; status.textContent = t; },
        function (result) { return POYO.exporter.save(result, app.folder); });
      var total = r.done.reduce(function (n, d) { return n + d.seconds; }, 0);
      app.lastBatch = { count: r.done.length, seconds: +total.toFixed(1), failed: r.failed.length };
      status.textContent = r.done.length + " of " + app.views.views.length + " views exported in " + POYO.fmt(total, 1) +
        " s drawing time" + (app.folder ? " to the folder “" + app.folder.name + "”." : " to the browser downloads.") +
        (r.failed.length ? " Failed: " + r.failed.join("; ") : "");
    } finally {
      bar.hidden = true; buttons.forEach(function (b) { b.disabled = false; });
      POYO.ui.refresh();
      app.fillReport();
    }
  };

  // ==== export
  app.chooseFolder = async function () {
    try {
      app.folder = await window.showDirectoryPicker({ mode: "readwrite", id: "poyo-exports" });
    } catch (e) {
      if (e.name !== "AbortError") $("export-status").textContent = "This browser would not open the folder: " + e.message;
      return;
    }
    POYO.ui.refresh();
  };

  app.renderExport = async function (progress, tile) {
    app.busy = true;
    try {
      var state = POYO.deepCopy(app.state);
      await app.prepare(state, function (t) { if (progress) progress(0, t); });
      return await POYO.exporter.run({ state: state, manifest: app.manifest, frame: app.frame,
                                       scene: app.scene, progress: progress, tile: tile });
    } finally {
      app.busy = false;
      app.requestRender();
    }
  };

  app.exportNow = async function () {
    if (app.busy) return;
    var bar = $("export-progress"), status = $("export-status"), go = $("export-button");
    bar.hidden = false; go.disabled = true;
    try {
      var result = await app.renderExport(function (f, t) { bar.value = f; status.textContent = t; });
      var where = await POYO.exporter.save(result, app.folder);
      app.lastExport = { seconds: result.seconds, bytes: result.bytes, width: result.width, height: result.height,
                         times: result.times, samples: result.samples };
      status.textContent = result.stem + ".png, " + POYO.fmtInt(result.width) + " × " + POYO.fmtInt(result.height) +
        ", " + POYO.fmt(result.bytes / 1048576, 1) + " MB in " + result.seconds + " s. " + where;
    } catch (e) {
      console.error(e);
      status.textContent = "Export failed: " + e.message;
    } finally {
      bar.hidden = true; go.disabled = false;
      app.fillReport();
    }
  };

  app.applySidecar = function (json) {
    app.state = POYO.state.fromSidecar(json, app.frame);
    POYO.ui.rebuild();
    app.changed();
    return json.data_build_date === app.manifest.build_date;
  };

  app.loadSidecar = async function (file) {
    try {
      var same = app.applySidecar(JSON.parse(await file.text()));
      $("export-status").textContent = "Sidecar loaded." + (same ? "" :
        " It was made with a different data build, so the picture may differ.");
    } catch (e) {
      $("export-status").textContent = "Could not load the sidecar: " + e.message;
    }
  };

  // ==== measurements
  app.measure = async function () {
    if (app.busy) return;
    var gl = app.gl, keep = app.state.view.azimuth, out = {}, pixel = new Uint8Array(4);
    say("Measuring, the view will turn for a few seconds.");
    await new Promise(function (r) { setTimeout(r, 100); });
    function frame() { return new Promise(function (r) { requestAnimationFrame(r); }); }
    var modes = [["moving_20m", true], ["still_10m", false]];
    for (var i = 0; i < modes.length; i++) {
      app.moving = modes[i][1];
      var times = [], gaps = [], last = await frame(), began = performance.now();
      for (var n = 0; n < 72 && performance.now() - began < 8000; n++) {
        app.state.view.azimuth = (keep + n * 5) % 360;
        var t = performance.now();
        draw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);     // wait for the card
        times.push(performance.now() - t);
        var now = await frame();
        gaps.push(now - last); last = now;
      }
      function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
      out[modes[i][0]] = { frame_ms: +median(times).toFixed(1), shown_per_second: +(1000 / median(gaps)).toFixed(1), frames: times.length };
    }
    app.moving = false; app.state.view.azimuth = keep;
    app.rotation = out;
    app.changed();
    app.fillReport();
  };

  // Time to move one face of the section box with every layer on.
  app.measureDrag = async function () {
    if (app.busy) return;
    var gl = app.gl, keep = app.state, pixel = new Uint8Array(4);
    var s = POYO.deepCopy(keep), L = s.layers;
    say("Measuring, one face of the box will move for a few seconds.");
    await new Promise(function (r) { setTimeout(r, 100); });
    function frame() { return new Promise(function (r) { requestAnimationFrame(r); }); }
    function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
    try {
      app.state = s;
      ["terrain", "rivers", "streams", "basin", "buildings"].forEach(function (n) {
        L[n].visible = true; if (!(L[n].opacity > 0)) L[n].opacity = 1;
      });
      if (L.flood.source === "none") L.flood.source = "satellite";
      var own = s.box.enabled && POYO.state.boxIsSet(s.box);
      if (!own) {
        var t = s.view.target;
        s.box.min = [0, 0, 0]; s.box.max = [0, 0, 0];
        POYO.boxtools.fromRect(app, t[0] - 1000, t[1] - 1000, t[0] + 1000, t[1] + 1000);
      }
      var max = s.box.max[0], stepM = Math.max(5, Math.round((max - s.box.min[0]) / 100));
      var out = { own: own, size: [max - s.box.min[0], s.box.max[1] - s.box.min[1]] };
      var runs = [["moving", true, 40], ["released", false, 8]];
      for (var i = 0; i < runs.length; i++) {
        var times = [], cuts = [], last = await frame(), gaps = [], began = performance.now();
        for (var n = 0; n < runs[i][2] && performance.now() - began < 15000; n++) {
          app.moving = runs[i][1];
          s.box.max[0] = max - stepM * (1 + (n % 20 < 10 ? n % 20 : 20 - n % 20));
          var t0 = performance.now();
          draw();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          times.push(performance.now() - t0);
          var made = app.scene.caps && app.scene.caps[app.moving || app.light ? 20 : 10];
          if (made) { cuts.push(made.ms); out.buildings = made.buildingCuts; }
          var now = await frame(); gaps.push(now - last); last = now;
        }
        out[runs[i][0]] = { frame_ms: +median(times).toFixed(1), worst_ms: +Math.max.apply(null, times).toFixed(1),
                            faces_ms: cuts.length ? +median(cuts).toFixed(1) : 0,
                            shown_per_second: +(1000 / median(gaps)).toFixed(1), steps: times.length };
      }
      app.drag = out;
    } finally {
      app.state = keep; app.moving = false;
      app.changed();
      app.fillReport();
    }
  };

  app.report = function () {
    var gl = app.gl, d = gl.getExtension("WEBGL_debug_renderer_info"), q = layout();
    var lines = ["Poyo viewer " + POYO.APP_VERSION + ", data built " + app.manifest.build_date,
      "Browser: " + navigator.userAgent,
      "Opened as: " + (location.protocol === "file:" ? "file from a folder" : location.protocol),
      "Renderer: " + gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      "Max texture " + gl.getParameter(gl.MAX_TEXTURE_SIZE) + ", max samples " + gl.getParameter(gl.MAX_SAMPLES),
      "Drawing area " + q.width + " x " + q.height + " pixels, pixel ratio " + q.dpr,
      "First load: " + POYO.fmt(app.loadSeconds, 1) + " s"];
    app.timings.forEach(function (t) { lines.push("  " + t.name + ": " + t.ms + " ms"); });
    if (app.rotation) {
      Object.keys(app.rotation).forEach(function (k) {
        var r = app.rotation[k];
        lines.push("Rotation " + k + ": " + r.frame_ms + " ms per frame, " + r.shown_per_second + " frames per second shown (" + r.frames + " frames)");
      });
    } else lines.push("Rotation: not measured");
    if (app.drag) {
      var g = app.drag;
      lines.push("Plane drag, all layers on, box " + Math.round(g.size[0]) + " x " + Math.round(g.size[1]) + " m" +
                 (g.own ? " (your box)" : " (test box around the view centre)") + ", " + (g.buildings || 0) + " building cut faces");
      ["moving", "released"].forEach(function (k) {
        var r = g[k];
        lines.push("  " + k + ": " + r.frame_ms + " ms per step (worst " + r.worst_ms + "), of which rebuilding cut faces " +
                   r.faces_ms + " ms, " + r.shown_per_second + " pictures per second shown (" + r.steps + " steps)");
      });
    } else lines.push("Plane drag: not measured");
    if (app.lastExport) {
      var x = app.lastExport;
      lines.push("Last export: " + x.width + " x " + x.height + ", " + POYO.fmt(x.bytes / 1048576, 1) + " MB, " + x.seconds +
        " s (draw " + x.times.draw + ", read " + x.times.read + ", compose " + x.times.compose + ", compress " + x.times.compress +
        "), smoothing " + x.samples + " samples");
    } else lines.push("Last export: none");
    if (app.lastBatch) lines.push("Last batch: " + app.lastBatch.count + " views, " + app.lastBatch.seconds + " s, " + app.lastBatch.failed + " failed");
    var K = app.state.look;
    lines.push("Styles: ground " + K.ground + ", buildings " + K.buildings + ", water " + K.water + ", flood " + K.flood +
               "; section box " + (boxShown() ? "on" : "off"));
    return lines.join("\n");
  };
  app.fillReport = function () { var r = $("report"); if (r && app.scene) r.value = app.report(); };
  // The report box only exists while the report panel is open.
  function say(text) { var r = $("report"); if (r) r.value = text; }
  app.copyReport = function () {
    var r = $("report");
    app.fillReport();
    r.select();
    if (navigator.clipboard) navigator.clipboard.writeText(r.value).catch(function () { document.execCommand("copy"); });
    else document.execCommand("copy");
  };

  // ==== start
  async function boot() {
    canvas = $("gl"); overlay = $("overlay"); checker = $("checker"); stage = $("stage");
    var kept = POYO.views.read(UI_STORE);
    if (kept && kept.dark) { app.dark = true; document.body.classList.add("dark"); }
    try {
      await step("Fonts");
      await loadFonts();
      var gl = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true, stencil: true,
                                             powerPreference: "high-performance" });
      if (!gl) throw new Error("This browser does not offer WebGL2.");
      app.gl = gl;
      canvas.addEventListener("webglcontextlost", function (e) {
        e.preventDefault();
        $("loading").hidden = false;
        $("loading-text").textContent = "The graphics context was lost. Reload the page.";
      });
      if (typeof DecompressionStream === "undefined") throw new Error("This browser is too old: it cannot unpack the data.");
      var G = POYO.geom;
      await step("Reading the manifest");
      var manifest = await POYO.loader.manifest();
      if (manifest.format !== "poyo-data-1") throw new Error("The data folder has an unknown format.");
      app.manifest = manifest;
      await step("Basin outline");
      var basin = await POYO.loader.chunk("basin"), xy = basin.arrays.xy;
      var lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (var i = 0; i < xy.length; i++) { var k = i & 1; if (xy[i] < lo[k]) lo[k] = xy[i]; if (xy[i] > hi[k]) hi[k] = xy[i]; }
      var ox = manifest.origin[0], oy = manifest.origin[1];
      app.frame = { ox: ox, oy: oy, cx: Math.round(ox + (lo[0] + hi[0]) / 200), cy: Math.round(oy + (lo[1] + hi[1]) / 200) };
      app.outline = G.polygonSet(basin.arrays, app.frame, "outline_");
      await step("Ground, 10 m");
      var c10 = await POYO.loader.chunk("terrain_10m");
      var g10 = new G.Grid(c10.meta, c10.arrays, app.frame);
      await step("Ground, 20 m");
      var c20 = await POYO.loader.chunk("terrain_20m");
      var g20 = new G.Grid(c20.meta, c20.arrays, app.frame);
      await step("Building the ground");
      var scene = new POYO.render.Scene(gl);
      scene.frame = app.frame;
      scene.manifest = manifest;
      scene.addBasin(app.outline, g10);
      scene.addTerrain("terrain_10m", g10);
      scene.addTerrain("terrain_20m", g20);
      var fills = [["rivers", "river_polygons", "River channels"], ["satellite", "flood_satellite", "Satellite flood extent"],
                   ["at2200", "flood_2200", "Flood extent at 22:00"]];
      for (var f = 0; f < fills.length; f++) {
        await step(fills[f][2]);
        var chunk = await POYO.loader.chunk(fills[f][1]);
        scene.addFill(fills[f][0], G.polygonSet(chunk.arrays, app.frame));
      }
      await step("Streams");
      scene.addStreams((await POYO.loader.chunk("streams")).arrays, app.frame);
      await step("Buildings");
      var buildings = await POYO.loader.chunk("buildings");
      await step("Building the buildings");
      scene.addBuildings(buildings.arrays, app.frame);
      var error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error("The graphics card reported error " + error + " while loading.");
      app.scene = scene;
      var height = manifest.entries.buildings.default_height_m;
      app.state.layers.buildings.default_height_m = height;
      app.state.layers.buildings.industrial_height_m = height;
      await step("First picture");
      app.views = new POYO.views.List();
      app.customThemes = (POYO.views.read(THEME_STORE) || []).filter(function (t) {
        try { POYO.themes.check(t); return true; } catch (e) { return false; }
      });
      if (window.innerWidth < 1100) app.panels.inspector = false;
      panelClasses();
      POYO.ui.build(app);
      interaction();
      new ResizeObserver(app.requestRender).observe(stage);
      app.fit();
      draw();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      await step(null);
      app.loadSeconds = (performance.now() - started) / 1000;
      $("loading").hidden = true;
      app.requestRender();
      app.fillReport();
      app.ready = true;
    } catch (e) {
      console.error(e);
      app.failed = String(e && e.message || e);
      $("loading").classList.add("failed");
      $("loading-text").textContent = app.failed;
      $("loading-help").hidden = false;
    }
  }

  boot();
})();
