// panels3.js: inspector panels of the layers and drawings added after Stage 2.
"use strict";
(function () {
  var ui = POYO.ui, K = ui.kit, L = POYO.layers, PANELS = ui.PANELS;
  function app() { return K.app(); }
  function S() { return K.app().state; }

  // ==== line layers ===========================================================
  var LINE_NOTES = {
    municipal: "Limits derived by joining the planning zoning polygons that share a municipality code. Slivers under 2 ha are left out. Not an official boundary.",
    places: "Areas of mixed kinds (a county, villages, places). They do not form a complete set of municipal boundaries.",
    railways: "Rail and metro lines clipped to the basin. Tunnel sections are not drawn.",
    sector: "Outline of the middle sector, sub basin 200324.",
    windows: "The three pilot windows of the A0 drawings at 1:2,000, shown as frames.",
    parcels: "Parcel outlines inside the three pilot windows only. The data has gaps in windows B and C, so blank ground there does not mean there are no parcels."
  };
  var TITLES = { municipal: "Municipal limits", places: "Place areas", railways: "Railways", sector: "Middle sector",
                 windows: "Pilot windows", parcels: "Parcel outlines" };
  Object.keys(TITLES).forEach(function (name) {
    ui.LINE_TITLES[name] = TITLES[name];
    var base = POYO.linePanel(name, TITLES[name]);
    PANELS[name] = { title: TITLES[name], make: function (p) {
      p.appendChild(K.check("Show", K.prop(function () { return S().layers[name]; }, "visible")));
      base.make(p);
      p.appendChild(K.note(LINE_NOTES[name]));
    } };
  });

  // ==== class tables ==========================================================
  function areas(source) {
    var a = app(), name = L.GRID_OF[source];
    if (!name || !L.store(a.scene).grids[name]) return null;
    return L.countGrid(a.scene, name, L.region(a.scene, a.state));
  }

  function classTable(p, slot) {
    var a = app(), set = function () { return S()[slot]; };
    var list = L.resolved(a.manifest, a.state, slot);
    if (!list.length) return;
    var counts = areas(set().source), rows = [], byKey = {};
    list.forEach(function (c) {
      if (!byKey[c.key]) { byKey[c.key] = { c: c, km2: 0 }; rows.push(byKey[c.key]); }
      if (counts) byKey[c.key].km2 += counts[c.index] * 25e-6;
    });
    rows.sort(function (x, y) { return x.c.order - y.c.order; });
    var boxed = a.state.box.enabled && POYO.state.boxIsSet(a.state.box);
    p.appendChild(K.heading("Classes"));
    var styled = slot === "cover" && L.styled(a.manifest, a.state.cover);
    p.appendChild(K.buttons(
      K.button("Show all", function () {
        set().hidden = []; set().only = "";
        if (styled) set().on = rows.filter(function (r) { return r.c.styled_off; }).map(function (r) { return r.c.key; });
        a.changed(); ui.rebuild(); }, "mini"),
      K.button("Hide all", function () { set().hidden = rows.map(function (r) { return r.c.key; }); set().only = ""; a.changed(); ui.rebuild(); }, "mini"),
      styled ? K.button("As in QGIS", function () { set().hidden = []; set().only = ""; set().on = []; set().colours = []; a.changed(); ui.rebuild(); }, "mini")
             : K.button("Default colours", function () { set().colours = []; a.changed(); ui.rebuild(); }, "mini")));
    if (slot === "cover" && a.state.cover.source === "crops") {
      p.appendChild(K.buttons(K.button("Crops only", function () {
        set().only = "";
        set().hidden = rows.filter(function (r) { return !r.c.crop; }).map(function (r) { return r.c.key; });
        a.changed(); ui.rebuild(); }, "mini")));
    }
    if (counts) p.appendChild(K.note("Areas are counted from the 5 m raster " + (boxed ? "inside the section box." : "in the basin.")));
    var host = K.el("div", { class: "classes" });
    rows.forEach(function (r) {
      if (counts && r.km2 <= 0) return;
      var key = r.c.key;
      var box = K.el("input", { type: "checkbox", "aria-label": "Show " + r.c.label });
      box.addEventListener("change", function () {
        var off = r.c.styled_off;                    // switched off in the QGIS style
        var h = set().hidden.filter(function (k) { return k !== key; });
        if (!box.checked && !off) h.push(key);
        set().hidden = h;
        if (off) {
          var on = set().on.filter(function (k) { return k !== key; });
          if (box.checked) on.push(key);
          set().on = on;
        }
        if (set().only && set().only !== key) set().only = "";
        a.changed();
      });
      var col = K.el("input", { type: "color", "aria-label": "Colour of " + r.c.label });
      col.addEventListener("input", function () {
        var list2 = set().colours.filter(function (q) { return q[0] !== key; });
        list2.push([key, col.value.toUpperCase()]);
        set().colours = list2;
        a.changed();
      });
      var only = K.button("Only", function () { set().only = set().only === key ? "" : key; a.changed(); }, "mini");
      only.setAttribute("aria-label", "Only " + r.c.label);
      var picture = K.el("span", {}), drawn = "";
      K.bind(function () {
        var now = L.resolved(a.manifest, a.state, slot).filter(function (c) { return c.key === key; })[0];
        box.checked = !!now && now.shown;
        if (now) col.value = now.colour.toLowerCase();
        only.classList.toggle("on", set().only === key);
        if (styled && now) {
          var cover = a.state.cover, under = cover.under === "paper" ? cover.under_colour : "#FFFFFF";
          var sign = JSON.stringify([now.symbol, under, cover.pattern_scale]);
          if (sign !== drawn) {
            drawn = sign;
            picture.textContent = "";
            if (now.symbol) picture.appendChild(POYO.symbols.preview(now.symbol, under, cover.pattern_scale));
          }
        }
      });
      var name = K.el("span", { class: "grow", text: r.c.label });
      if (counts) name.appendChild(K.el("span", { class: "figures area", text: " " + (r.km2 < 0.005 ? "<0.01" : POYO.fmt(r.km2, 2)) + " km²" }));
      // with the QGIS style the symbol covers the colour picker, so a click still opens the picker
      host.appendChild(styled ? K.el("div", { class: "class styled" }, box, K.el("span", { class: "chip" }, picture, col), name, only)
                              : K.el("div", { class: "class" }, box, col, name, only));
    });
    p.appendChild(host);
  }

  function sourceSelect(label, slot, options) {
    return K.select(label, options, { get: function () { return S()[slot].source; }, set: function (v) {
      var set = S()[slot];
      set.source = v; set.only = ""; set.hidden = [];
      setTimeout(ui.rebuild, 0);
    } });
  }

  PANELS.cover = { title: "Land use and crops", make: function (p) {
    var set = function () { return S().cover; };
    p.appendChild(sourceSelect("Ground colours", "cover", [["none", "None"], ["planned", "Planned use"],
      ["observed", "Observed cover SIOSE 2014"], ["crops", "Crop types"]]));
    p.appendChild(K.when(function () { return set().source === "planned"; },
      K.select("Detail", [["detail", "Detailed uses"], ["group", "Use groups"]], { get: function () { return set().level; },
        set: function (v) { set().level = v; set().only = ""; set().hidden = []; setTimeout(ui.rebuild, 0); } })));
    p.appendChild(K.when(function () { return set().source === "crops"; },
      K.check("Split irrigated and rainfed", { get: function () { return set().crop_water; },
        set: function (v) { set().crop_water = v; set().only = ""; set().hidden = []; setTimeout(ui.rebuild, 0); } })));
    p.appendChild(K.live(function () { var s = set().source; return s === "none" ? "" : L.LABELS.note[s]; }));
    p.appendChild(K.live(function () {
      return set().source === "observed"
        ? "Mosaics take the colour of their largest cover in a lighter tint, and are called mixed when no cover reaches half. English names are a translation."
        : "";
    }));
    var hasStyle = !!POYO.symbols.style(app().manifest);
    var planned = function () { return hasStyle && set().source === "planned"; };
    var styled = function () { return L.styled(app().manifest, set()); };
    p.appendChild(K.when(planned,
      K.select("Colours", [["qgis", "My QGIS style"], ["solid", "Solid colours"]],
        { get: function () { return set().style; },
          set: function (v) { set().style = v; set().colours = []; set().only = ""; setTimeout(ui.rebuild, 0); } })));
    p.appendChild(K.when(styled,
      K.select("Under patterns", [["paper", "White, as in QGIS"], ["ground", "The ground style"]], K.prop(set, "under")),
      K.select("Patterns sit", [["ground", "On the ground"], ["page", "Flat on the page"]], K.prop(set, "pattern_space")),
      K.slider("Pattern size", K.range(set, "pattern_scale", 0.25, 4, 0.05)),
      K.note("Symbols read from the QGIS layer " + (hasStyle ? POYO.symbols.style(app().manifest).style_layer : "") +
             ". Sizes are millimetres on the printed sheet. Classes switched off there start unticked here.")));
    p.appendChild(K.slider("Opacity", K.range(set, "opacity", 0, 1, 0.05)));
    p.appendChild(K.slider("Ground shading", K.range(set, "shading", 0, 1, 0.05)));
    p.appendChild(K.check("Class boundary lines", K.prop(set, "boundaries")));
    p.appendChild(K.when(function () { return set().boundaries; },
      K.colour("Boundary", K.prop(set, "boundary_colour")),
      K.slider("Boundary mm", K.range(set, "boundary_mm", 0.03, 0.5, 0.01)),
      K.note("Boundaries are found on the 5 m raster, so they sit within about 2.5 m of the polygon edge. They fade out where a pixel covers more than about 5 m.")));
    p.appendChild(K.colour("Classes you untick", K.prop(set, "hidden_colour")));
    classTable(p, "cover");
  } };

  PANELS.overlay = { title: "Hazard and depth classes", make: function (p) {
    var set = function () { return S().overlay; };
    p.appendChild(sourceSelect("Show", "overlay", [["none", "None"], ["depth", "Flood depth classes"], ["hazard", "Flood hazard zones"]]));
    p.appendChild(K.live(function () {
      var s = set().source;
      return s === "depth" ? "Depth classes estimated from satellite images. A class is an estimate, not a measurement."
        : s === "hazard" ? "Hazard zones as mapped. They describe probability and depth classes, not the 2024 flood." : "";
    }));
    p.appendChild(K.slider("Opacity", K.range(set, "opacity", 0, 1, 0.05)));
    p.appendChild(K.check("Class boundary lines", K.prop(set, "boundaries")));
    p.appendChild(K.note("Drawn over the land colours. Boundary colour and width are the ones set for land use."));
    classTable(p, "overlay");
  } };

  PANELS.roads = { title: "Roads", make: function (p) {
    var a = app(), set = function () { return S().layers.roads; };
    p.appendChild(K.check("Show road surfaces", K.prop(set, "visible")));
    p.appendChild(K.select("Colour", [["class", "By road class"], ["single", "One road network colour"]], K.prop(set, "colour_by")));
    p.appendChild(K.when(function () { return set().colour_by === "single"; }, K.colour("Road network", K.prop(set, "colour"))));
    var host = K.el("div", {});
    L.roadColours(a.manifest, a.state).forEach(function (c) {
      host.appendChild(K.colour(c.name.replace(" / ", " and "), {
        get: function () {
          return L.roadColours(a.manifest, S()).filter(function (x) { return x.name === c.name; })[0].colour.toUpperCase();
        },
        set: function (v) {
          var list = S().look.road_colours.filter(function (q) { return q[0] !== c.name; });
          list.push([c.name, v]);
          S().look.road_colours = list;
        }
      }));
    });
    p.appendChild(K.when(function () { return set().colour_by === "class"; }, host,
      K.buttons(K.button("Default colours", function () { S().look.road_colours = []; a.changed(); }, "mini"))));
    p.appendChild(K.slider("Opacity", K.range(set, "opacity", 0, 1, 0.05)));
    p.appendChild(K.note("Road polygons painted on the ground. Tunnels are left out. Bridges lie on the ground, because their height is not in the data."));
  } };

  // ==== data notes ============================================================
  ui.noteExtra.push(function (tab, m) {
    var E = m.entries, n = POYO.fmtInt, list = [];
    if (E.landuse) list.push("Planned land use: " + n(E.landuse.feature_count) + " zoning polygons, " + E.landuse.classes.length +
      " detailed uses in " + Object.keys(E.landuse.classes.reduce(function (a, c) { a[c.group] = 1; return a; }, {})).length +
      " groups, painted from a 5 m grid. Planned use, not observed cover. " +
      (E.landuse_style ? "Symbols follow the QGIS style of " + E.landuse_style.style_layer +
        ". Areas of narrow strips under 5 m can break up in the drawing." : "Colours follow the QGIS style of the layer."));
    if (E.siose) list.push("Observed land cover, SIOSE 2014: " + n(E.siose.feature_count) + " polygons cut to the basin, " +
      n(E.siose.agriculture_110) + " coded as agriculture, median " + POYO.fmt(E.siose.median_ha, 1) +
      " ha. They are land cover units, not parcels. A compound unit takes its largest cover when that reaches half, drawn lighter; " +
      n(E.siose.mixed_polygons) + " units stay mixed. An earlier count gave 4,245 polygons; the difference was not investigated.");
    if (E.crops) list.push("Crop types: " + n(E.crops.feature_count) + " parcels touching the basin, from the " + E.crops.campaign +
      " campaign of the agricultural parcel register (data dated 15 December 2025), painted from a 5 m grid. Each parcel has one use, such as citrus, vineyard or arable land. The species and the crop sown in a given year are not in it, and rice counts as arable land. Irrigated or rainfed is as registered. Crops cover " +
      POYO.fmt(E.crops.crop_km2, 1) + " of " + POYO.fmt(E.crops.basin_km2, 1) + " km².");
    if (E.landuse) list.push("Class edges: all land colour grids are 5 m, so an edge lies within about 2.5 m of the polygon. That is 0.25 mm at 1:10,000 and 1.25 mm at 1:2,000, where edges look slightly scalloped.");
    if (E.roads) list.push("Roads and paths: " + n(E.roads.feature_count) + " surface polygons from OpenStreetMap, September 2026, drawn flat on the ground. Tunnels are left out.");
    var total = function (e) { var c = (e.checks || []).filter(function (x) { return x.item === "layer features"; })[0];
      return c ? " of the layer\u2019s " + n(c.actual) : ""; };
    if (E.flood_depth) list.push("Flood depth classes: " + n(E.flood_depth.feature_count) + total(E.flood_depth) + " polygons fall in the basin, from the satellite depth product of Copernicus activation EMSR773. A class is an estimate, not a measurement.");
    if (E.hazard) list.push("Flood hazard zones, PATRICOVA: " + n(E.hazard.feature_count) + total(E.hazard) + " polygons fall in the basin. Planning classes of probability and depth, not the 2024 flood.");
    if (E.railways) list.push("Railways: " + n(E.railways.feature_count) + " line features cut to the basin; " + n(E.railways.tunnels) + " tunnel sections are not drawn.");
    if (E.municipal_limits) list.push("Municipal limits: " + n(E.municipal_limits.feature_count) + " units derived by joining planning zoning polygons by municipality code, parts under 2 ha left out. Not an official boundary.");
    if (E.places) list.push("Place areas: " + n(E.places.feature_count) + " OpenStreetMap areas of mixed kinds. Not a complete set of municipalities.");
    if (E.parcels) list.push("Parcel outlines: " + n(E.parcels.feature_count) + " SIGPAC outlines inside the three pilot windows only, FEGA, CC BY 4.0. Windows B and C have gaps.");
    if (!list.length) return;
    tab.appendChild(K.heading("Added layers"));
    list.forEach(function (t) { tab.appendChild(K.note(t)); });
  });

  // ==== rail ==================================================================
  var lastSource = { cover: "planned", overlay: "depth" };
  function sourceCard(slot, title, names) {
    return { key: slot, title: title, visible: {
      get: function () { return S()[slot].source !== "none"; },
      set: function (v) {
        var set = S()[slot];
        if (!v) { if (set.source !== "none") lastSource[slot] = set.source; set.source = "none"; }
        else set.source = lastSource[slot];
        setTimeout(ui.rebuild, 0);
      }
    }, meta: function () { return names[S()[slot].source] || "off"; } };
  }
  ui.extraRail.push({ section: "Ground colours" });
  ui.extraRail.push(sourceCard("cover", "Land use and crops", { planned: "planned", observed: "observed", crops: "crops" }));
  ui.extraRail.push(sourceCard("overlay", "Hazard and depth", { depth: "depth", hazard: "hazard" }));
  ui.extraRail.push({ key: "roads", title: "Roads", visible: K.prop(function () { return S().layers.roads; }, "visible") });
})();
