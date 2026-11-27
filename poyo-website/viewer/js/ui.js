// ui.js: toolbar, layer rail, inspector and export drawer. Controls read and write
// the state, then ask for a redraw.
"use strict";
(function () {
  var refreshers = [], app = null, kept = null;

  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") node.textContent = attrs[k];
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) node.appendChild(arguments[i]);
    return node;
  }

  function row(label, control, extra) {
    var r = el("label", { class: "row" }, el("span", { class: "label", text: label }), control);
    if (extra) r.appendChild(extra);
    return r;
  }

  function bind(refresh) { refreshers.push(refresh); refresh(); }

  // o: min, max, step, get, set
  function slider(label, o) {
    var range = el("input", { type: "range", min: o.min, max: o.max, step: o.step, "aria-label": label });
    var num = el("input", { type: "number", min: o.min, max: o.max, step: "any", class: "num", "aria-label": label + " value" });
    range.addEventListener("input", function () { o.set(Number(range.value)); num.value = range.value; app.changed(true); });
    range.addEventListener("change", function () { app.changed(); });
    num.addEventListener("change", function () {
      if (num.value === "") return;
      o.set(POYO.clamp(Number(num.value), o.min, o.max)); app.changed(); sync();
    });
    function sync() { var v = +Number(o.get()).toFixed(3); range.value = v; if (document.activeElement !== num) num.value = v; }
    bind(sync);
    return row(label, range, num);
  }

  function number(label, o) {
    var num = el("input", { type: "number", min: o.min, max: o.max, step: o.step || "any", class: "wide" });
    num.addEventListener("change", function () {
      if (num.value === "") return;
      o.set(POYO.clamp(Number(num.value), o.min, o.max)); app.changed(); refresh();
    });
    bind(function () { if (document.activeElement !== num) num.value = o.get(); });
    return row(label, num);
  }

  function colour(label, o) {
    var c = el("input", { type: "color" });
    var hex = el("input", { type: "text", class: "hex", maxlength: 7, "aria-label": label + " hex" });
    c.addEventListener("input", function () { o.set(c.value.toUpperCase()); hex.value = c.value.toUpperCase(); app.changed(); });
    hex.addEventListener("change", function () {
      var v = hex.value.trim();
      if (v.charAt(0) !== "#") v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { o.set(v.toUpperCase()); app.changed(); }
      sync();
    });
    function sync() { c.value = o.get().toLowerCase(); if (document.activeElement !== hex) hex.value = o.get().toUpperCase(); }
    bind(sync);
    return row(label, c, hex);
  }

  function check(label, o) {
    var box = el("input", { type: "checkbox" });
    box.addEventListener("change", function () { o.set(box.checked); app.changed(); refresh(); });
    bind(function () { box.checked = !!o.get(); });
    return el("label", { class: "check" }, box, el("span", { text: label }));
  }

  function select(label, options, o) {
    var s = el("select");
    options.forEach(function (p) { s.appendChild(el("option", { value: p[0], text: p[1] })); });
    s.addEventListener("change", function () { o.set(s.value); app.changed(); refresh(); });
    bind(function () { s.value = String(o.get()); });
    return row(label, s);
  }

  function text(label, o, placeholder) {
    var t = el("input", { type: "text", class: "wide", placeholder: placeholder || "" });
    t.addEventListener("input", function () { o.set(t.value); app.changed(); });
    bind(function () { if (document.activeElement !== t) t.value = o.get(); });
    return row(label, t);
  }

  function button(label, fn, cls) {
    return el("button", { type: "button", class: cls || "", text: label, onclick: fn });
  }

  function heading(t) { return el("h3", { text: t }); }
  function note(t) { return el("p", { class: "note", text: t }); }
  function prop(obj, key) { return { get: function () { return obj()[key]; }, set: function (v) { obj()[key] = v; } }; }
  function range(obj, key, min, max, step) {
    var p = prop(obj, key); p.min = min; p.max = max; p.step = step; return p;
  }
  function buttons() {
    var d = el("div", { class: "buttons" });
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) d.appendChild(arguments[i]);
    return d;
  }
  // A group of controls that shows only when it applies.
  function when(test) {
    var d = el("div", { class: "group" });
    for (var i = 1; i < arguments.length; i++) d.appendChild(arguments[i]);
    bind(function () { d.hidden = !test(); });
    return d;
  }
  function live(compute) {
    var n = note("");
    bind(function () { var t = compute(); n.textContent = t; n.hidden = !t; });
    return n;
  }
  // A text button in place of the browser file field.
  function fileButton(label, id, onFile) {
    var input = el("input", { type: "file", accept: ".json,application/json", id: id, class: "hidden-file", tabindex: -1, "aria-label": label });
    input.addEventListener("change", function () { if (input.files[0]) onFile(input.files[0]); input.value = ""; });
    return el("span", {}, button(label, function () { input.click(); }), input);
  }

  function refresh() { refreshers.forEach(function (f) { f(); }); }

  function S() { return app.state; }
  function look() { return app.state.look; }

  var STYLE_NAMES = { shaded: "Shaded", flat: "Flat colour", white: "White model", outline: "Outline only",
                      contours: "Contours", wireframe: "Wireframe", xray: "X ray" };
  function styleSelect(label, group) {
    return select(label, POYO.state.STYLES.map(function (s) { return [s, STYLE_NAMES[s]]; }), prop(look, group));
  }
  function is(group) {
    var list = Array.prototype.slice.call(arguments, 1);
    return function () { return list.indexOf(look()[group]) >= 0; };
  }
  function orderButtons(listName, name, title) {
    var make = function (label, dir) {
      var b = button(label, function () { app.reorder(listName, name, dir); }, "mini");
      b.setAttribute("aria-label", label + ": " + title);
      bind(function () {
        var list = S()[listName], at = list.indexOf(name);
        b.disabled = at + dir < 0 || at + dir >= list.length;
      });
      return b;
    };
    return el("div", { class: "row" }, el("span", { class: "label", text: "Draw order" }),
              el("div", { class: "presets" }, make("Move up", 1), make("Move down", -1)));
  }

  function outlineControls() {
    return [
      colour("Edge colour", prop(look, "outline_colour")),
      slider("Edge width mm", range(look, "outline_mm", 0.05, 0.8, 0.01)),
      slider("Edge depth step m", range(look, "outline_depth_m", 0.5, 30, 0.5)),
      slider("Edge angle", range(look, "outline_angle_deg", 5, 89, 1)),
      note("Edges are drawn where one surface passes in front of another or turns sharply. These settings are shared by ground and buildings.")
    ];
  }
  function contourBaseControl() {
    return select("Under the lines", [["paper", "Paper colour"], ["ramp", "Flat colours"], ["shaded", "Shaded colours"], ["none", "Nothing"]],
                  prop(look, "contour_base"));
  }
  function group(test, list) { return when.apply(null, [test].concat(list)); }

  // ==== inspector panels
  var PANELS = {};

  PANELS.terrain = { title: "Ground", make: function (p) {
    var T = function () { return S().terrain; }, o = function () { return S().layers.terrain; };
    var ramped = function () {
      var k = look().ground;
      return k === "shaded" || k === "xray" || (k === "contours" && (look().contour_base === "ramp" || look().contour_base === "shaded"));
    };
    p.appendChild(styleSelect("Render style", "ground"));
    p.appendChild(slider("Opacity", range(o, "opacity", 0, 1, 0.05)));
    p.appendChild(group(is("ground", "flat"), [colour("Ground colour", prop(look, "flat_ground"))]));
    p.appendChild(group(is("ground", "white"), [colour("Ground colour", prop(look, "white_ground"))]));
    p.appendChild(group(is("ground", "xray"), [slider("See through", range(look, "xray_alpha", 0.03, 1, 0.01))]));
    p.appendChild(group(is("ground", "outline"), outlineControls()));
    p.appendChild(group(is("ground", "wireframe"), [
      number("Grid spacing m", range(look, "wire_spacing_m", 10, 5000)),
      colour("Line colour", prop(look, "wire_colour")),
      slider("Line width mm", range(look, "wire_mm", 0.03, 1, 0.01))
    ]));
    p.appendChild(group(is("ground", "contours"), [
      number("Interval m", range(look, "contour_interval_m", 1, 500)),
      number("Heavier every", range(look, "contour_index", 0, 20)),
      colour("Line colour", prop(look, "contour_colour")),
      slider("Line width mm", range(look, "contour_mm", 0.03, 1, 0.01)),
      slider("Heavy width mm", range(look, "contour_index_mm", 0.03, 2, 0.01)),
      contourBaseControl(),
      note("Contours come from the 10 m ground grid. Intervals below about 5 m show the grid more than the ground.")
    ]));
    p.appendChild(group(ramped, [
      heading("Elevation colours"),
      colour("Low colour", prop(T, "low_colour")),
      colour("Middle colour", prop(T, "mid_colour")),
      colour("High colour", prop(T, "high_colour")),
      number("Low at m", range(T, "low_m", -50, 1100)),
      number("Middle at m", range(T, "mid_m", -50, 1100)),
      number("High at m", range(T, "high_m", -50, 1500))
    ]));
    p.appendChild(group(function () { return ramped() || look().ground === "white"; }, [
      heading("Light"),
      slider("Hillshade", range(T, "hillshade", 0, 1, 0.05)),
      slider("Light azimuth", range(T, "light_azimuth", 0, 360, 5)),
      slider("Light altitude", range(T, "light_altitude", 5, 90, 5)),
      slider("Relief in shading", range(T, "shading_relief", 1, 6, 0.5))
    ]));
    p.appendChild(heading("Solid base"));
    p.appendChild(colour("Side walls", prop(T, "base_colour")));
    p.appendChild(number("Base datum m", range(T, "datum_m", -2000, 0)));
  } };

  PANELS.buildings = { title: "Buildings", make: function (p) {
    var b = function () { return S().layers.buildings; };
    var bySource = function () {
      var k = look().buildings;
      return k === "shaded" || k === "flat" || k === "xray" ||
             (k === "contours" && (look().contour_base === "ramp" || look().contour_base === "shaded"));
    };
    p.appendChild(styleSelect("Render style", "buildings"));
    p.appendChild(slider("Opacity", range(b, "opacity", 0, 1, 0.05)));
    p.appendChild(group(bySource, [
      colour("From floor count", prop(b, "floors_colour")),
      colour("Explicit height tag", prop(b, "explicit_colour")),
      colour("No height data", prop(b, "none_colour"))
    ]));
    p.appendChild(group(is("buildings", "white"), [
      colour("Known height", prop(look, "white_building")),
      colour("No height data", prop(look, "white_assumed"))
    ]));
    p.appendChild(group(is("buildings", "outline", "contours", "wireframe"), [
      colour("No height data", prop(look, "white_assumed"))
    ]));
    p.appendChild(group(is("buildings", "xray"), [slider("See through", range(look, "xray_alpha", 0.03, 1, 0.01))]));
    p.appendChild(group(is("buildings", "wireframe", "xray"), [
      colour("Line colour", prop(look, "wire_colour")),
      slider("Line width mm", range(look, "wire_mm", 0.03, 1, 0.01))
    ]));
    p.appendChild(group(is("buildings", "contours"), [
      number("Level lines every m", range(look, "building_contour_m", 0.5, 100)),
      colour("Level line colour", prop(look, "contour_colour")),
      contourBaseControl()
    ]));
    p.appendChild(group(is("buildings", "outline", "contours"), outlineControls()));
    p.appendChild(heading("Heights"));
    p.appendChild(number("Default height m", range(b, "default_height_m", 0, 100)));
    p.appendChild(number("Industrial default m", range(b, "industrial_height_m", 0, 100)));
    p.appendChild(check("Flat footprints (no extrusion)", prop(b, "flat")));
    p.appendChild(note("Defaults apply only to buildings with no height data. Industrial means mapped as industrial or warehouse. Vertical exaggeration also applies to buildings."));
  } };

  PANELS.rivers = { title: "River channels", make: function (p) {
    var r = function () { return S().layers.rivers; };
    p.appendChild(styleSelect("Water style", "water"));
    p.appendChild(note("The water style applies to river channels and streams."));
    p.appendChild(group(function () { return look().water !== "white" && look().water !== "outline"; }, [colour("Fill", prop(r, "colour"))]));
    p.appendChild(group(is("water", "white"), [colour("White model fill", prop(look, "white_water")),
                                               colour("Stream lines", prop(look, "white_line"))]));
    p.appendChild(slider("Opacity", range(r, "opacity", 0, 1, 0.05)));
    p.appendChild(check("Draw outline", prop(r, "outline")));
    p.appendChild(colour("Outline", prop(r, "outline_colour")));
    p.appendChild(slider("Outline mm", range(r, "outline_mm", 0.05, 2, 0.05)));
    p.appendChild(orderButtons("fill_order", "rivers", "River channels"));
  } };

  PANELS.flood = { title: "Flood extent", make: function (p) {
    var f = function () { return S().layers.flood; };
    var choice = el("div", { class: "radios", role: "radiogroup", "aria-label": "Flood product" });
    [["satellite", "Satellite flood extent"], ["at2200", "Flood extent at 22:00 (method undocumented)"], ["none", "No flood layer"]]
      .forEach(function (o) {
        var radio = el("input", { type: "radio", name: "flood", value: o[0] });
        radio.addEventListener("change", function () { f().source = o[0]; app.changed(); });
        bind(function () { radio.checked = f().source === o[0]; });
        choice.appendChild(el("label", { class: "check" }, radio, el("span", { text: o[1] })));
      });
    p.appendChild(choice);
    p.appendChild(live(function () { return POYO.annotate.floodNote(f().source, app.manifest); }));
    p.appendChild(styleSelect("Render style", "flood"));
    p.appendChild(group(function () { return look().flood !== "white" && look().flood !== "outline"; }, [
      colour("Satellite fill", prop(f, "satellite_colour")),
      colour("22:00 fill", prop(f, "at2200_colour"))
    ]));
    p.appendChild(group(is("flood", "white"), [colour("White model fill", prop(look, "white_flood"))]));
    p.appendChild(slider("Opacity", range(f, "opacity", 0, 1, 0.05)));
    p.appendChild(check("Draw outline", prop(f, "outline")));
    p.appendChild(colour("Outline", prop(f, "outline_colour")));
    p.appendChild(slider("Outline mm", range(f, "outline_mm", 0.05, 2, 0.05)));
    p.appendChild(orderButtons("fill_order", "flood", "Flood extent"));
    p.appendChild(check("Hide flood in elevations", prop(f, "hide_in_elevation")));
    p.appendChild(note("Seen exactly from the side, flood on the ground only shows as a stripe, so elevations leave it out unless this is off."));
  } };

  function linePanel(name, title) {
    return { title: title, make: function (p) {
      var o = function () { return S().layers[name]; };
      p.appendChild(colour("Colour", prop(o, "colour")));
      p.appendChild(slider("Opacity", range(o, "opacity", 0, 1, 0.05)));
      p.appendChild(slider("Width mm", range(o, "width_mm", 0.05, 3, 0.05)));
      if (name === "streams") {
        p.appendChild(styleSelect("Water style", "water"));
        p.appendChild(group(is("water", "white"), [colour("White model line", prop(look, "white_line"))]));
      }
      p.appendChild(orderButtons("line_order", name, title));
    } };
  }
  PANELS.streams = linePanel("streams", "Streams");
  PANELS.basin = linePanel("basin", "Basin boundary");
  POYO.linePanel = linePanel;

  PANELS.box = { title: "Section box", make: function (p) {
    var B = function () { return S().box; }, C = function () { return S().box.cut; };
    var set = function () { return POYO.state.boxIsSet(B()); };
    p.appendChild(check("Section box on", { get: function () { return B().enabled; },
                                            set: function (v) { POYO.boxtools.enable(app, v); } }));
    p.appendChild(select("Clip", [["outside", "Show the inside of the box"], ["inside", "Remove the inside of the box"]], prop(B, "mode")));
    var status = el("p", { class: "note", id: "box-status", role: "status" });
    p.appendChild(buttons(
      button("Draw in plan", function () { app.startDrawing(); }),
      button("Set from view", function () { var r = POYO.boxtools.fromView(app); status.textContent = r.message; app.changed(); }),
      button("Fit to basin", function () { POYO.boxtools.fitBasin(app); app.changed(); }),
      button("Reset", function () { POYO.boxtools.reset(app); status.textContent = "Box and cut style reset."; app.changed(); })
    ));
    p.appendChild(status);
    p.appendChild(heading("Limits, EPSG:25830 metres"));
    [["East from", "min", 0, 600000, 800000], ["East to", "max", 0, 600000, 800000],
     ["North from", "min", 1, 4300000, 4420000], ["North to", "max", 1, 4300000, 4420000],
     ["Height from", "min", 2, -2000, 3000], ["Height to", "max", 2, -2000, 3000]].forEach(function (f) {
      var r = number(f[0], { min: f[3], max: f[4],
        get: function () { return set() ? +B()[f[1]][f[2]].toFixed(2) : ""; },
        set: function (v) { POYO.boxtools.typed(app, f[1], f[2], v); } });
      r.querySelector("input").setAttribute("data-box", f[1] + f[2]);
      p.appendChild(r);
    });
    p.appendChild(check("Show frame and handles", { get: function () { return app.showHandles; },
                                                     set: function (v) { app.showHandles = v; } }));
    p.appendChild(note("Drag a magenta square on the sheet to move one face. A face seen along its own axis has no handle."));
    p.appendChild(heading("Cut faces"));
    var fills = [["solid", "Solid"], ["hatch", "Hatch"], ["none", "Not filled"]];
    p.appendChild(select("Ground", fills, prop(C, "ground_fill")));
    p.appendChild(colour("Ground cut", prop(C, "ground_colour")));
    p.appendChild(select("Buildings", fills, prop(C, "buildings_fill")));
    p.appendChild(colour("Building cut", prop(C, "building_colour")));
    p.appendChild(group(function () { return C().ground_fill === "hatch" || C().buildings_fill === "hatch"; }, [
      colour("Hatch ground", prop(C, "hatch_back")),
      slider("Hatch angle", range(C, "hatch_angle", -90, 90, 5)),
      slider("Hatch spacing mm", range(C, "hatch_spacing_mm", 0.3, 10, 0.1)),
      slider("Hatch line mm", range(C, "hatch_line_mm", 0.05, 2, 0.05))
    ]));
    p.appendChild(slider("Cut line mm", range(C, "line_mm", 0, 2, 0.05)));
    p.appendChild(colour("Cut line", prop(C, "line_colour")));
    p.appendChild(check("Fill horizontal cuts too", prop(C, "horizontal")));
    p.appendChild(note("The four side faces are filled for ground and buildings. The top and bottom faces clip; filling them can be switched off."));
  } };

  PANELS.view = { title: "View", make: viewPanel };
  function viewPanel(tab) {
    var s = function () { return app.state.view; };
    var presets = POYO.camera.PRESETS;
    function presetRow(title, keys, names) {
      var box = el("div", { class: "presets" });
      keys.forEach(function (k, i) {
        var b = button(names[i], function () { app.setPreset(k); });
        b.title = presets[k].label;
        bind(function () { b.classList.toggle("on", POYO.camera.presetOf(s().azimuth, s().elevation) === k); });
        box.appendChild(b);
      });
      return el("div", { class: "row" }, el("span", { class: "label", text: title }), box);
    }
    tab.appendChild(presetRow("Plan", ["plan"], ["Plan"]));
    tab.appendChild(presetRow("Elevation from", ["elev_s", "elev_e", "elev_n", "elev_w"], ["S", "E", "N", "W"]));
    tab.appendChild(presetRow("Isometric from", ["iso_ne", "iso_se", "iso_sw", "iso_nw"], ["NE", "SE", "SW", "NW"]));
    tab.appendChild(check("Fit the basin when choosing a view", { get: function () { return app.fitOnPreset; }, set: function (v) { app.fitOnPreset = v; } }));
    tab.appendChild(slider("Azimuth", range(s, "azimuth", 0, 359.9, 0.5)));
    tab.appendChild(slider("Elevation", range(s, "elevation", 0, 90, 0.5)));
    tab.appendChild(slider("Exaggeration", range(s, "ve", 1, 10, 0.5)));
    tab.appendChild(live(function () {
      return POYO.camera.viewName(s()) + ". " + POYO.camera.lengthStatement(s()).join(" ");
    }));
    tab.appendChild(heading("Scale"));
    tab.appendChild(number("1 :", { min: 200, max: 1000000, step: 100,
      get: function () { return Math.round(s().scale); }, set: function (v) { s().scale = v; } }));
    var common = [[0, "choose"]].concat([1000, 2000, 5000, 10000, 20000, 25000, 50000, 60000, 75000, 100000, 150000, 200000]
      .map(function (n) { return [n, "1:" + POYO.fmtInt(n)]; }));
    tab.appendChild(select("Common scales", common, { get: function () { return 0; }, set: function (v) { if (+v) s().scale = +v; } }));
    tab.appendChild(buttons(button("Fit basin to sheet", function () { app.fit(); })));
    tab.appendChild(check("Always use the lighter 20 m ground on screen", { get: function () { return app.light; }, set: function (v) { app.light = v; } }));
    tab.appendChild(note("Drag to orbit. Right drag or Shift drag to move. Wheel or pinch to change scale. Exports always use the 10 m ground."));
  }

  PANELS.sheet = { title: "Sheet and frame", make: function (tab) {
    var s = function () { return app.state.sheet; };
    var newSheet = function () { return s().layout !== "stage1"; };
    var paperProp = { get: function () { return s().paper; }, set: function (v) {
      if (v === "custom") { var mm = POYO.state.paperSize(s()); s().width_mm = mm[0]; s().height_mm = mm[1]; }
      s().paper = v; if (app.fitOnPreset) app.fit(); } };
    tab.appendChild(select("Paper", [["A0", "A0"], ["A1", "A1"], ["A2", "A2"], ["A3", "A3"], ["A4", "A4"], ["custom", "Custom"]], paperProp));
    tab.appendChild(select("Orientation", [["landscape", "Landscape"], ["portrait", "Portrait"]], {
      get: function () { return s().orientation; }, set: function (v) { s().orientation = v; if (app.fitOnPreset) app.fit(); } }));
    var w = number("Width mm", range(s, "width_mm", 50, 1500)), h = number("Height mm", range(s, "height_mm", 50, 1500));
    tab.appendChild(group(function () { return s().paper === "custom"; }, [w, h]));
    tab.appendChild(number("Resolution ppi", range(s, "ppi", 50, 400)));
    tab.appendChild(select("Background", [["paper", "Paper colour"], ["transparent", "Transparent"]], prop(s, "background")));
    tab.appendChild(live(function () {
      var p = POYO.state.pagePixels(s());
      return POYO.fmtInt(p.width) + " × " + POYO.fmtInt(p.height) + " pixels, " + POYO.fmt(p.width * p.height / 1e6, 1) + " megapixels.";
    }));
    ui.sheetExtra.forEach(function (add) { add(tab, newSheet); });

    tab.appendChild(heading("Title block and legend"));
    tab.appendChild(select("Sheet design", [["stage3", "Panel column, never over the drawing"],
      ["stage2", "Stage 2 sheet, blocks over the drawing"], ["stage1", "Stage 1 sheet"]], prop(s, "layout")));
    tab.appendChild(group(function () { return s().layout === "stage3"; }, [
      select("Panel column", [["auto", "Right, or below on portrait"], ["right", "Right"], ["bottom", "Below"]], prop(s, "panel_side"))]));
    tab.appendChild(group(newSheet, [
      check("Title block", prop(s, "title_block")),
      check("Legend", prop(s, "legend")),
      check("Panel ID at top left", prop(s, "id_mark"))
    ]));
    tab.appendChild(group(newSheet, [
      select("Side panel", [["separate", "Saved as its own file"], ["on_sheet", "On the sheet"]], {
        get: function () { return s().panel_export; }, set: function (v) {
          s().panel_export = v; if (v === "separate") s().layout = "stage3"; if (app.fitOnPreset) app.fit(); } })
    ]));
    tab.appendChild(group(function () { return newSheet() && s().panel_export === "separate"; }, [
      note("The export saves the drawing without the panel, and a second picture ending in _panel at the same resolution. Place both at 100 percent to combine them. The panel ID stays on the drawing unless you untick it above.")
    ]));
    tab.appendChild(group(newSheet, [
      select("Panel look", [["storm", "Paper and Water"], ["chronogram", "Chronogram"], ["riverscape", "Riverscape boxes"]],
             prop(s, "design"))
    ]));
    tab.appendChild(group(function () { return newSheet() && s().design !== "riverscape"; }, [
      text("Small title", prop(s, "kicker"), "line above the view name"),
      text("Note", prop(s, "note"), "optional note under the title"),
      colour("Hairlines", prop(s, "rule_colour"))
    ]));
    tab.appendChild(group(function () { return newSheet() && s().design === "chronogram"; }, [
      colour("Title tab", prop(s, "tab_colour"))
    ]));
    tab.appendChild(group(function () { return !newSheet(); }, [
      select("Annotations", [["full", "Full"], ["minimal", "Minimal"]], prop(s, "annotations")),
      note("This is the sheet of an export made with the Stage 1 viewer, kept so that it reproduces exactly.")
    ]));
    tab.appendChild(text("Panel ID", prop(s, "panel_id"), "optional, top left of the sheet"));
    tab.appendChild(slider("Text size", range(s, "text_size", 0.5, 2, 0.05)));

    tab.appendChild(heading("Credits"));
    tab.appendChild(text("Credits line", prop(s, "credits"), "your own wording"));
    tab.appendChild(group(newSheet, [check("Add the source statements of the layers shown", prop(s, "auto_sources"))]));
    var sources = el("details", {}, el("summary", { text: "Source statements" }));
    [["terrain", "Ground"], ["basin", "Basin boundary"], ["rivers", "River channels"], ["streams", "Streams"],
     ["buildings", "Buildings"], ["satellite", "Satellite flood"], ["at2200", "22:00 flood"],
     ["landuse", "Planned land use"], ["siose", "Observed land cover"], ["crops", "Crop types"], ["depth", "Flood depth classes"],
     ["hazard", "Flood hazard zones"], ["roads", "Roads"], ["railways", "Railways"], ["places", "Place areas"],
     ["municipal", "Municipal limits"], ["sector", "Sector and windows"], ["parcels", "Parcel outlines"]].forEach(function (k) {
      sources.appendChild(text(k[1], prop(function () { return s().sources; }, k[0]), "source not documented"));
    });
    if (app.openSources) sources.open = true;
    sources.addEventListener("toggle", function () { app.openSources = sources.open; });
    tab.appendChild(group(newSheet, [sources]));
    tab.appendChild(live(function () {
      if (!newSheet()) return "";
      var m = POYO.annotate.missingSources(app.state);
      return m.length ? "No source statement yet for: " + m.join(", ") + ". Borrowed material must be credited." : "";
    }));
    tab.appendChild(live(function () { return "On the sheet: " + (POYO.annotate.credits(app.state) || "no credits"); }));

    tab.appendChild(heading("Sheet colours"));
    tab.appendChild(colour("Paper", prop(s, "paper_colour")));
    tab.appendChild(group(newSheet, [
      colour("Text", prop(s, "ink")), colour("Notes", prop(s, "body_ink")), colour("Headings and rules", prop(s, "muted_ink"))
    ]));
    tab.appendChild(buttons(button("Open the export drawer", function () { app.togglePanel("drawer", true); })));
  } };

  // ==== saved views
  PANELS.views = { title: "Saved views", make: function (p) {
    var list = app.views, name = el("input", { type: "text", class: "wide", id: "view-name", placeholder: "name of the view" });
    var status = el("p", { class: "note", role: "status", id: "views-status" });
    p.appendChild(row("Name", name));
    p.appendChild(buttons(button("Save the current view", function () {
      var i = list.add(app, name.value); name.value = ""; status.textContent = "Saved “" + list.views[i].name + "”."; ui.rebuild();
    })));
    var host = el("div", { id: "view-list" });
    list.views.forEach(function (v, i) {
      var title = el("input", { type: "text", class: "wide", value: v.name, "aria-label": "Name of view " + (i + 1) });
      title.addEventListener("change", function () { list.rename(i, title.value); ui.rebuild(); });
      var cam = v.sidecar.camera;
      var remove = button("Remove", function () {
        if (remove.getAttribute("data-sure")) { list.remove(i); ui.rebuild(); return; }
        remove.setAttribute("data-sure", "1"); remove.textContent = "Click again to remove";
        setTimeout(function () { remove.removeAttribute("data-sure"); remove.textContent = "Remove"; }, 3000);
      }, "mini");
      var up = button("Up", function () { list.move(i, -1); ui.rebuild(); }, "mini");
      var down = button("Down", function () { list.move(i, 1); ui.rebuild(); }, "mini");
      up.disabled = i === 0; down.disabled = i === list.views.length - 1;
      host.appendChild(el("div", { class: "item" }, title,
        el("p", { class: "note figures", text: cam.view_name + ", 1:" + POYO.fmtInt(cam.scale_denominator) +
                  (v.sidecar.section_box ? ", section box" : "") }),
        buttons(button("Apply", function () { app.applyView(i); }, "mini"),
                button("Update", function () { list.update(app, i); status.textContent = "Updated “" + v.name + "”."; ui.rebuild(); }, "mini"),
                up, down, remove)));
    });
    p.appendChild(host);
    p.appendChild(status);
    p.appendChild(buttons(
      button("Save list to a file", function () {
        app.saveJson("views.json", list.toJSON()).then(function (m) { if (m) status.textContent = m; });
      }),
      fileButton("Load list from a file", "views-file", function (file) {
        file.text().then(function (t) {
          var r = list.load(JSON.parse(t));
          app.viewsMessage = r.added + " views added" + (r.skipped ? ", " + r.skipped + " not readable" : "") + ".";
          ui.rebuild();
        }).catch(function (e) { status.textContent = "Could not load the list: " + e.message; });
      })
    ));
    if (app.viewsMessage) { status.textContent = app.viewsMessage; app.viewsMessage = ""; }
    p.appendChild(buttons(button("Export all saved views", function () { app.exportViews(); })));
    p.appendChild(note(list.stored
      ? "The list is kept in this browser on this computer. Save it to a file to keep it safely or to share it."
      : "This browser will not keep the list. Save it to a file before closing."));
  } };

  // ==== themes
  PANELS.themes = { title: "Themes", make: function (p) {
    p.appendChild(live(function () { return "Current theme: " + S().theme_name + "."; }));
    var status = el("p", { class: "note", role: "status", id: "theme-status" });
    app.allThemes().forEach(function (t) {
      var apply = button("Apply", function () { app.applyTheme(t.theme); }, "mini");
      apply.setAttribute("aria-label", "Apply " + t.theme.name);
      var forget = t.builtin ? null : button("Forget", function () { app.forgetTheme(t.theme.name); }, "mini");
      var line = el("div", { class: "item line" }, el("span", { class: "grow", text: t.theme.name }), apply, forget);
      bind(function () { line.classList.toggle("selected", S().theme_name === t.theme.name); });
      p.appendChild(line);
    });
    p.appendChild(buttons(fileButton("Load a theme file", "theme-file", function (f) { app.loadTheme(f); })));
    if (app.themeMessage) { status.textContent = app.themeMessage; }
    p.appendChild(status);
    p.appendChild(heading("Save the current look"));
    var name = el("input", { type: "text", class: "wide", id: "theme-name", placeholder: "My theme" });
    p.appendChild(row("Name", name));
    p.appendChild(buttons(button("Save as theme file", function () {
      var t = POYO.themes.capture(S(), name.value || "My theme", app.dark ? "dark" : "paper");
      app.saveJson(POYO.themes.fileName(t), t).then(function (m) {
        if (!m) return;
        app.keepTheme(t); S().theme_name = t.name; app.themeMessage = m; ui.rebuild(); app.changed();
      });
    })));
    p.appendChild(note("A theme holds colours, line weights, render styles and cut faces. Edit the file in any text editor, then load it again. Loading a theme never moves the camera or the section box."));
  } };

  // ==== data notes and report
  PANELS.notes = { title: "Data notes", make: function (tab) {
    var m = app.manifest, E = m.entries;
    tab.appendChild(note("Data built " + m.build_date + ". Coordinates " + m.crs + "."));
    var B = E.buildings, F = E.flood_2200, Sa = E.flood_satellite, D = E.dem_check, G = E.terrain_10m;
    [
      "Ground: 10 m grid, each value the mean of four 5 m cells (" + POYO.fmt(G.min_m, 2) + " to " + POYO.fmt(G.max_m, 2) +
        " m). The 5 m source inside the basin runs from " + POYO.fmt(D.min_m, 2) + " to " + POYO.fmt(D.max_m, 2) + " m. The moving view uses a 20 m grid.",
      "Water and flood fills are painted on the ground from " + POYO.render.FILL_CELL + " m masks, so edges are soft below that size. Turn on outlines for hard edges.",
      "Lines are draped on the 10 m ground and drawn slightly towards the viewer so the ground does not cut them.",
      "Buildings: " + POYO.fmtInt(B.feature_count) + ". Height from floor count (3 m per floor assumed) " + POYO.fmtInt(B.by_source.floors) +
        ", explicit height tag " + POYO.fmtInt(B.by_source.explicit) + ", no height data " + POYO.fmtInt(B.by_source.none) +
        " (" + POYO.fmt(100 * B.no_height_share_of_footprint_area, 1) + "% of footprint area; " + POYO.fmtInt(B.industrial_without_height) +
        " of them industrial or warehouse). Roofs are flat, set above the highest ground under the footprint.",
      "Satellite flood extent: " + POYO.fmt(Sa.area_km2, 2) + " km², of which " + POYO.fmt(Sa.urban_area_km2, 3) +
        " km² on urban land. Source: Copernicus Emergency Management Service.",
      "Flood extent at 22:00: " + POYO.fmt(F.area_km2, 2) + " km², of which " + POYO.fmt(F.urban_area_km2, 2) + " km² on urban land. Its method is not documented.",
      "Section box: cut faces of the ground follow the 10 m grid, so features narrower than about 20 m are smoothed or missed in a section.",
      "Contours are drawn from the same grid, not from surveyed contour lines."
    ].forEach(function (t) { tab.appendChild(note(t)); });
    ui.noteExtra.forEach(function (add) { add(tab, m); });
    tab.appendChild(heading("Data files"));
    Object.keys(E).sort().forEach(function (key) {
      var e = E[key], list = el("dl");
      function item(k, v) { if (v === undefined || v === null || v === "") return; list.appendChild(el("dt", { text: k })); list.appendChild(el("dd", { text: String(v) })); }
      item("Source layer", e.source_layer);
      item("Source file", e.source_file);
      item("Features", e.feature_count === undefined ? undefined : POYO.fmtInt(e.feature_count));
      item("Cells in basin", e.cells_in_basin === undefined ? undefined : POYO.fmtInt(e.cells_in_basin));
      item("Source CRS", e.source_crs);
      item("Clip", e.clip);
      item("Built", e.built);
      // One difference was reviewed and accepted: the older figure was a count of raster cells.
      function accepted(c) { return key === "basin" && c.item === "area km2" && c.actual === 416.51 && c.expected === 416.52; }
      var failed = (e.checks || []).filter(function (c) { return !c.ok; });
      var bad = failed.filter(function (c) { return !accepted(c); });
      item("Checks", (e.checks || []).length ? (bad.length ? bad.map(function (c) {
        return "MISMATCH " + c.item + ": found " + c.actual + ", expected " + c.expected; }).join("; ")
        : failed.length ? "Area 416.51 km² accepted. The earlier 416.52 was a cell count."
        : "all " + e.checks.length + " match") : undefined);
      tab.appendChild(el("details", {}, el("summary", { text: key.replace(/_/g, " ") + (bad.length ? " (mismatch)" : "") }), list));
    });
  } };

  PANELS.report = { title: "System report", make: function (tab) {
    tab.appendChild(buttons(
      button("Measure rotation speed", function () { app.measure(); }),
      button("Measure plane drag", function () { app.measureDrag(); }),
      button("Copy report", function () { app.copyReport(); })));
    tab.appendChild(note("Plane drag turns every layer on, moves one face of the section box and times each step. The view is restored afterwards."));
    tab.appendChild(el("textarea", { id: "report", readonly: "", rows: 22, "aria-label": "System report" }));
  } };

  // ==== toolbar
  function toolbar() {
    var host = document.getElementById("presets"), actions = document.getElementById("actions");
    host.textContent = ""; actions.textContent = "";
    var names = [["plan", "Plan"], ["elev_s", "S"], ["elev_e", "E"], ["elev_n", "N"], ["elev_w", "W"],
                 ["iso_ne", "NE"], ["iso_se", "SE"], ["iso_sw", "SW"], ["iso_nw", "NW"]];
    names.forEach(function (n, i) {
      if (i === 1 || i === 5) host.appendChild(el("span", { class: "tag", text: i === 1 ? "Elev" : "Iso" }));
      var b = button(n[1], function () { app.setPreset(n[0]); });
      b.title = POYO.camera.PRESETS[n[0]].label + " (key " + (i + 1) + ")";
      b.setAttribute("aria-label", POYO.camera.PRESETS[n[0]].label);
      bind(function () { b.classList.toggle("on", POYO.camera.presetOf(S().view.azimuth, S().view.elevation) === n[0]); });
      host.appendChild(b);
    });
    var fit = button("Fit", function () { app.fit(); }); fit.title = "Fit the basin to the sheet (key F)";
    host.appendChild(fit);
    function toggle(label, key, get, flip) {
      var b = button(label, function () { flip(); });
      b.id = "bar-" + key;
      bind(function () { b.classList.toggle("on", !!get()); b.setAttribute("aria-pressed", !!get()); });
      actions.appendChild(b);
    }
    toggle("Box", "box", function () { return S().box.enabled; }, function () { app.toggle("box"); });
    toggle("Title block", "title", function () { return S().sheet.title_block; }, function () { app.toggle("title"); });
    toggle("Legend", "legend", function () { return S().sheet.legend; }, function () { app.toggle("legend"); });
    toggle("Dark", "dark", function () { return app.dark; }, function () { app.toggle("dark"); });
    toggle("Export", "export", function () { return app.panels.drawer; }, function () { app.togglePanel("drawer"); });
  }

  // ==== layer rail
  var lastFlood = "satellite";
  function rail() {
    var host = document.getElementById("rail");
    host.textContent = "";
    function section(t) { host.appendChild(el("h2", { text: t })); }
    function line(key, title, visible, meta) {
      var r = el("div", { class: "layer" });
      if (visible) {
        var box = el("input", { type: "checkbox", "aria-label": "Show " + title });
        box.addEventListener("change", function () { visible.set(box.checked); app.changed(); });
        bind(function () { box.checked = !!visible.get(); });
        r.appendChild(box);
      } else r.appendChild(el("span", { class: "gap" }));
      var b = button(title, function () { app.select(key); }, "name");
      b.setAttribute("data-panel", key);
      r.appendChild(b);
      var m = el("span", { class: "meta" });
      r.appendChild(m);
      bind(function () {
        r.classList.toggle("selected", app.panel === key && app.panels.inspector);
        m.textContent = meta ? meta() : "";
      });
      host.appendChild(r);
    }
    function layerVisible(n) { return prop(function () { return S().layers[n]; }, "visible"); }
    function styleOf(g) { return function () { return STYLE_NAMES[look()[g]].toLowerCase().replace(" colour", "").replace(" model", "").replace(" only", ""); }; }
    section("Layers");
    var cards = {
      basin: function () { line("basin", "Basin boundary", layerVisible("basin")); },
      streams: function () { line("streams", "Streams", layerVisible("streams"), styleOf("water")); },
      rivers: function () { line("rivers", "River channels", layerVisible("rivers"), styleOf("water")); },
      flood: function () {
        line("flood", "Flood extent", {
          get: function () { return S().layers.flood.source !== "none"; },
          set: function (v) {
            var f = S().layers.flood;
            if (!v) { lastFlood = f.source === "none" ? lastFlood : f.source; f.source = "none"; } else f.source = lastFlood;
          }
        }, function () { var s = S().layers.flood.source; return s === "satellite" ? "satellite" : s === "at2200" ? "22:00" : "off"; });
      }
    };
    Object.keys(POYO.layers.LINE_CHUNKS).forEach(function (n) {
      cards[n] = function () { line(n, ui.LINE_TITLES[n], layerVisible(n)); };
    });
    S().line_order.slice().reverse().forEach(function (n) { cards[n](); });
    S().fill_order.slice().reverse().forEach(function (n) { cards[n](); });
    line("buildings", "Buildings", layerVisible("buildings"), styleOf("buildings"));
    line("terrain", "Ground", layerVisible("terrain"), styleOf("ground"));
    ui.extraRail.forEach(function (card) {
      if (card.section) section(card.section);
      else line(card.key, card.title, card.visible, card.meta);
    });
    section("Section");
    line("box", "Section box", { get: function () { return S().box.enabled; }, set: function (v) { POYO.boxtools.enable(app, v); } },
         function () { return S().box.enabled ? (S().box.mode === "inside" ? "removes inside" : "shows inside") : ""; });
    section("Drawing");
    line("view", "View");
    line("sheet", "Sheet and frame", null, function () { return S().sheet.paper === "custom" ? "custom" : S().sheet.paper; });
    ui.drawingRail.forEach(function (card) { line(card.key, card.title, null, card.meta); });
    line("views", "Saved views", null, function () { return app.views.views.length || ""; });
    line("themes", "Themes");
    section("About");
    line("notes", "Data notes");
    line("report", "System report");
    host.appendChild(buttons(button("Reset all styles", function () { app.resetStyles(); })));
  }

  function inspector() {
    var host = document.getElementById("panel"), def = PANELS[app.panel] || PANELS.view;
    var scroll = host.getAttribute("data-open") === app.panel ? host.scrollTop : 0;
    host.textContent = "";
    host.setAttribute("data-open", app.panel);
    document.getElementById("inspector-title").textContent = def.title;
    def.make(host);
    host.scrollTop = scroll;
  }

  // ==== export drawer. Built once, so a running export keeps its progress bar.
  function drawer() {
    var host = document.getElementById("drawer");
    if (!kept) {
      var go = button("Export PNG and sidecar", function () { app.exportNow(); }, "primary");
      go.id = "export-button";
      var all = button("Export all saved views", function () { app.exportViews(); });
      all.id = "export-views";
      var choose = window.showDirectoryPicker ? button("Choose export folder", function () { app.chooseFolder(); }) : null;
      var parts = {
        size: note(""), folder: note(""), go: go, all: all,
        progress: el("progress", { id: "export-progress", max: 1, value: 0, hidden: "" }),
        status: el("p", { id: "export-status", class: "note", role: "status" })
      };
      host.textContent = "";
      host.appendChild(el("div", { class: "phead" }, el("h2", { text: "Export" }),
                          button("Hide", function () { app.togglePanel("drawer", false); }, "mini")));
      host.appendChild(el("div", { class: "columns" },
        el("div", {}, buttons(go, all), parts.size),
        el("div", {}, buttons(choose, fileButton("Load a sidecar", "sidecar-file", function (f) { app.loadSidecar(f); })), parts.folder),
        el("div", { class: "grow" }, parts.progress, parts.status)));
      kept = parts;
      ui.drawerExtra.forEach(function (add) { add(host, parts); });
    }
    bind(function () {
      var s = S().sheet, p = POYO.state.pagePixels(s);
      kept.size.textContent = (s.paper === "custom" ? "Custom" : s.paper + " " + s.orientation) + ", " + s.ppi + " ppi, " +
        POYO.fmtInt(p.width) + " × " + POYO.fmtInt(p.height) + " pixels.";
      kept.folder.textContent = app.folder ? "Folder: " + app.folder.name : "No folder chosen. Files go to the browser downloads.";
      kept.all.textContent = "Export all saved views" + (app.views.views.length ? " (" + app.views.views.length + ")" : "");
      kept.all.disabled = !app.views.views.length || app.busy;
    });
  }

  var ui = {
    extraRail: [], drawingRail: [], sheetExtra: [], drawerExtra: [], noteExtra: [], LINE_TITLES: {},
    kit: { el: el, row: row, bind: bind, slider: slider, number: number, colour: colour, check: check, select: select,
           text: text, button: button, heading: heading, note: note, prop: prop, range: range, buttons: buttons,
           when: when, live: live, fileButton: fileButton, group: group, styleSelect: styleSelect,
           orderButtons: orderButtons, is: is, app: function () { return app; } },
    build: function (theApp) {
      app = theApp;
      document.getElementById("inspector-close").onclick = function () { app.togglePanel("inspector", false); };
      ui.rebuild = function () {
        refreshers = [];
        toolbar(); rail(); inspector(); drawer();
        app.fillReport();
      };
      ui.rebuild();
    },
    refresh: refresh,
    rebuild: function () {},
    PANELS: PANELS
  };
  POYO.ui = ui;
})();
