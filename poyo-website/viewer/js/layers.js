// layers.js: data read only when a picture needs it. Class grids drawn as indexed
// colour textures, the road surface, and the extra boundary lines.
"use strict";
(function () {
  var G = POYO.geom, R = POYO.render, ID = POYO.ID;
  var TILE = 2048;
  var CELL_KM2 = 25e-6;

  // ==== names and colours =====================================================
  // English glosses are a translation of the cover names written in the SIOSE records.
  var SIOSE = {
    CHA: ["Rice", "#C9B54A", 0], CHL: ["Herbaceous crops other than rice", "#F5CE55", 0],
    LFC: ["Citrus fruit trees", "#F5A333", 0], LFN: ["Non citrus fruit trees", "#D98A45", 0],
    LOL: ["Olive groves", "#A39A4C", 0], LVI: ["Vineyard", "#B5652A", 0], LOC: ["Other woody crops", "#C7A06A", 0],
    CNF: ["Conifers", "#476712", 1], FDP: ["Evergreen broadleaf trees", "#5F861A", 1],
    MTR: ["Scrub", "#89A752", 1], PST: ["Grassland", "#B9CF8A", 1],
    ACU: ["Watercourses", "#0091B9", 2], ALC: ["Coastal lagoons", "#007496", 2], ALG: ["Lakes and lagoons", "#007496", 2],
    HMA: ["Marshes", "#5DD0C3", 2], LAA: ["Artificial water body", "#00A4A8", 2],
    RMB: ["Dry stream beds", "#BCF0DF", 2],
    SDN: ["Bare soil", "#D9D9D4", 3], PDA: ["Beaches, dunes and sand", "#D9D9D4", 3],
    ARR: ["Rock outcrops", "#B4B4AF", 3], ZQM: ["Burnt areas", "#686863", 3],
    EDF: ["Buildings", "#2D2D2D", 4], VAP: ["Paved streets and parking", "#686863", 4],
    OCT: ["Other constructions", "#4A4A47", 4], ZEV: ["Extraction or dumping", "#8F8F8A", 4],
    SNE: ["Unbuilt ground", "#B4B4AF", 4], ZAU: ["Planted urban green and trees", "#B0C084", 4]
  };
  var MIXED = "#A7A79F";
  // Parcel use types: name, colour, true when it is a crop.
  var CROPS = {
    "Citrus": ["#F08A24", true], "Fruit trees": ["#C8553D", true], "Nut trees": ["#8C5A2B", true],
    "Olive groves": ["#6D9F15", true], "Vineyard": ["#7B3F77", true], "Mixed tree crops": ["#B08D2E", true],
    "Other permanent crops": ["#7A6A45", true], "Arable land": ["#CDBE5F", true],
    "Vegetable gardens": ["#00A36C", true], "Greenhouses and plastic cover": ["#686863", true],
    "Forest": ["#C5D3BA", false], "Pasture and scrub": ["#DCE0C6", false], "Built up": ["#D9D9D4", false],
    "Roads and ways": ["#BDBDB6", false], "Water": ["#0091B9", false],
    "Unproductive land": ["#ECEBE5", false], "Other parcel use": ["#C9C8BD", false]
  };
  // Arable land has its own pair; other crops get a lighter tint when rainfed.
  var ARABLE = { irrigated: "#9CC76B", rainfed: "#E8D48A" };
  var DEPTH = [["Below 0.5 m", 0.25], ["0.5 to 1 m", 0.75], ["1 to 2 m", 1.5], ["2 to 4 m", 3], ["4 to 6 m", 5]];
  var HAZARD = [
    ["Level 1: 25 year frequency, depth over 0.8 m", "#004671"],
    ["Level 2", "#006083"],
    ["Level 3: 25 year frequency, depth under 0.8 m", "#007496"],
    ["Level 4: 100 year frequency, depth under 0.8 m", "#00A4A8"],
    ["Level 5: 500 year frequency, depth over 0.8 m", "#5DD0C3"],
    ["Level 6: 500 year frequency, depth under 0.8 m", "#BCF0DF"],
    ["Geomorphological hazard", "#B4B4AF"]
  ];
  var GRID_OF = { planned: "landuse", observed: "siose", crops: "crops", depth: "flood_depth", hazard: "hazard" };
  var LINE_CHUNKS = { municipal: "municipal_limits", places: "places", railways: "railways",
                      sector: "sector", windows: "pilot_windows", parcels: "parcels" };
  var LABELS = {
    cover: { planned: "Planned land use", observed: "Observed land cover, SIOSE 2014", crops: "Crop types" },
    note: { planned: "Planned use from urban planning zoning, not observed cover.",
            observed: "Observed land cover, SIOSE 2014. Polygons are land cover units, not parcels.",
            crops: "Use of each parcel in the 2026 agricultural register. A crop group, not the species or this year\u2019s sowing." },
    overlay: { depth: "Flood depth classes, satellite estimate", hazard: "Flood hazard zones" },
    line: { municipal: "Municipal limits", places: "Place areas", railways: "Railways, surface",
            sector: "Middle sector", windows: "Pilot windows", parcels: "Parcel outlines in pilot windows" }
  };

  function mix(a, b, t) {
    var x = POYO.hexToRgb(a), y = POYO.hexToRgb(b);
    return "#" + [0, 1, 2].map(function (i) {
      var v = Math.round(255 * (x[i] + (y[i] - x[i]) * t));
      return (v < 16 ? "0" : "") + v.toString(16).toUpperCase();
    }).join("");
  }

  // ==== After the Storm ground colours: the identity's land tokens, muted, with tints
  // derived from them where the data has more classes than the identity.
  var T = POYO.STORM;
  var STORM_GROUP = {
    "Residential": T.urban, "Industrial": T.industrial, "Tertiary": mix(T.urban, T.building, 0.35),
    "Agricultural": T.secano, "Forest and natural": T.forest, "Green space": mix(T.huerta, T.forest, 0.35),
    "Facilities": mix(T.building, T.paper, 0.25), "Infrastructure": mix(T.building, T.ink, 0.18),
    "Corridors and networks": T.rule, "Watercourse": T.waterLight, "Protected for risk": T.stormLight
  };
  var STORM_NAME = {
    "Residential new development": mix(T.urban, T.paper, 0.45), "Historic core": T.building,
    "Industrial new development": mix(T.industrial, T.paper, 0.45),
    "Tertiary new development": mix(T.urban, T.building, 0.12),
    "Agricultural protected": T.huerta,
    "Natural protected municipal": mix(T.forest, T.paper, 0.35), "Natural protected by law": mix(T.forest, T.ink, 0.2),
    "Sports": mix(T.huerta, T.paper, 0.3), "Golf": mix(T.huerta, T.paper, 0.15),
    "Infrastructure water": T.water,
    "Road network": mix(T.rule, T.ink, 0.25), "Railway": T.muted, "Railway corridor": mix(T.muted, T.paper, 0.3),
    "Utility corridor": T.hairline, "Livestock route": mix(T.secano, T.building, 0.45),
    "Parking": mix(T.industrial, T.ink, 0.12)
  };
  var STORM_SIOSE = {
    CHA: mix(T.huerta, T.wetland, 0.5), CHL: T.secano, LFC: T.huerta, LFN: mix(T.huerta, T.secano, 0.5),
    LOL: mix(T.forest, T.secano, 0.55), LVI: mix(T.secano, T.building, 0.55), LOC: mix(T.secano, T.huerta, 0.35),
    CNF: mix(T.forest, T.ink, 0.22), FDP: T.forest, MTR: mix(T.forest, T.paper, 0.35), PST: mix(T.huerta, T.paper, 0.4),
    ACU: T.water, ALC: T.waterLight, ALG: T.waterLight, HMA: T.wetland, LAA: T.waterLight, RMB: T.sea,
    SDN: mix(T.secano, T.paper, 0.45), PDA: mix(T.secano, T.paper, 0.65), ARR: T.hairline,
    ZQM: mix(T.storm, T.paper, 0.35), EDF: T.building, VAP: T.rule, OCT: T.industrial,
    ZEV: mix(T.industrial, T.ink, 0.22), SNE: mix(T.urban, T.paper, 0.35), ZAU: mix(T.huerta, T.forest, 0.5)
  };
  var STORM_CROPS = {
    "Citrus": T.huerta, "Fruit trees": mix(T.secano, T.building, 0.3), "Nut trees": mix(T.building, T.secano, 0.25),
    "Olive groves": T.forest, "Vineyard": mix(T.building, T.ink, 0.3), "Mixed tree crops": mix(T.forest, T.secano, 0.5),
    "Other permanent crops": mix(T.secano, T.ink, 0.35), "Arable land": T.secano,
    "Vegetable gardens": mix(T.huerta, T.wetland, 0.6), "Greenhouses and plastic cover": T.industrial,
    "Forest": mix(T.forest, T.paper, 0.5), "Pasture and scrub": mix(T.huerta, T.paper, 0.55), "Built up": T.urban,
    "Roads and ways": T.rule, "Water": T.water, "Unproductive land": mix(T.hairline, T.paper, 0.55),
    "Other parcel use": mix(T.urban, T.paper, 0.45)
  };

  // The identity's colour for one class of the table below, or null to keep the data colour.
  function stormColour(source, c) {
    if (source === "planned") {
      var name = c.key.indexOf("planned:detail:") === 0 ? c.key.slice(15) : "";
      return STORM_NAME[name] || STORM_GROUP[c.group] || mix(T.urban, T.paper, 0.45);
    }
    if (source === "observed") {
      var base = STORM_SIOSE[c.cover] || mix(T.secano, T.forest, 0.35);
      if (c.water === "sc") base = mix(base, T.hairline, 0.35);
      if (c.mosaic && STORM_SIOSE[c.cover]) base = mix(base, T.paper, 0.35);
      return base;
    }
    if (source === "crops") {
      var type = c.key.split(":")[2], detail = c.key.indexOf("crops:detail:") === 0;
      var tone = STORM_CROPS[type] || mix(T.urban, T.paper, 0.45);
      if (detail && type === "Arable land" && c.water === "irrigated") return mix(T.huerta, T.secano, 0.5);
      if (detail && type !== "Arable land" && c.water === "rainfed") return mix(tone, T.paper, 0.35);
      return tone;
    }
    if (source === "hazard") {
      // hazard is "what happened and what can": storm, darkest for the highest level
      return c.index > 6 ? T.hairline : mix(mix(T.storm, T.ink, 0.45), T.stormLight, (c.index - 1) / 5);
    }
    return null;
  }

  function stormed(set) { return set.palette === "storm"; }

  // Planned use in the identity: solid fills, industrial land hatched at 45 degrees.
  function stormSymbols(manifest, set) {
    if (!stormed(set) || set.source !== "planned" || !manifest.entries.landuse) return null;
    var out = {};
    table(manifest, "planned", set.level).forEach(function (c) {
      if (out[c.key]) return;
      var s = POYO.symbols.solid(stormColour("planned", c));
      if (c.group === "Industrial") {
        s.ops.push({ type: "line", angle: 45, distance: 1.4, width: 0.25, offset: 0, dash: "solid", colour: T.building });
      }
      out[c.key] = s;
    });
    return out;
  }

  // The class list of one grid: every raster index with the key and colour it belongs to.
  // The same list serves the palette, the legend and the inspector table.
  function table(manifest, source, level) {
    var entry = manifest.entries[GRID_OF[source]], out = [];
    if (!entry) return out;
    if (source === "planned") {
      var lead = {};
      entry.classes.forEach(function (c) {
        if (!lead[c.group] || c.km2 > lead[c.group].km2) lead[c.group] = c;
      });
      var groups = [];
      entry.classes.forEach(function (c) {
        if (groups.indexOf(c.group) < 0) groups.push(c.group);
        var byGroup = level === "group";
        out.push({ index: c.index, key: byGroup ? "planned:group:" + c.group : "planned:detail:" + c.name,
                   label: byGroup ? c.group : (c.label || c.name),
                   colour: (byGroup ? lead[c.group].colour : c.colour).toUpperCase(),
                   group: c.group, order: byGroup ? groups.indexOf(c.group) : c.index });
      });
    } else if (source === "observed") {
      entry.classes.forEach(function (c) {
        var info = SIOSE[c.cover], water = c.water === "rr" ? "irrigated" : c.water === "sc" ? "rainfed" : "";
        var label, colour, group, key;
        if (!info) {
          label = c.cover === "mixed" ? "Mixed cover, no single cover reaches 50 %" : c.cover;
          colour = MIXED; group = 5; key = "observed:" + c.cover;
        } else {
          label = info[0] + " (" + (entry.covers[c.cover] || c.cover) + ")" + (water ? ", " + water : "") +
                  (c.mosaic ? ", mosaic" : "");
          colour = info[1]; group = info[2];
          if (c.water === "sc") colour = mix(colour, ID.stone, 0.35);
          if (c.mosaic) colour = mix(colour, ID.paper, 0.45);
          key = "observed:" + c.cover + ":" + (c.water || "none") + ":" + (c.mosaic ? "mosaic" : "single");
        }
        var rank = Object.keys(SIOSE).indexOf(c.cover);
        out.push({ index: c.index, key: key, label: label, colour: colour.toUpperCase(), cover: c.cover,
                   mosaic: !!c.mosaic, water: c.water || "", group: group,
                   order: group * 1000 + (rank < 0 ? 999 : rank * 4) + (c.water === "sc" ? 2 : 0) + (c.mosaic ? 1 : 0) });
      });
    } else if (source === "crops") {
      var types = Object.keys(CROPS);
      entry.classes.forEach(function (c) {
        var info = CROPS[c.type] || ["#ECEBE5", false];
        var split = level !== "group" && info[1] && !!c.water;
        var colour = info[0];
        if (split && c.type === "Arable land") colour = ARABLE[c.water] || colour;
        else if (split && c.water === "rainfed") colour = mix(colour, ID.paper, 0.45);
        var at = types.indexOf(c.type), water = ["irrigated", "rainfed", "not recorded"].indexOf(c.water);
        out.push({ index: c.index, key: split ? "crops:detail:" + c.type + ":" + c.water : "crops:group:" + c.type,
                   label: split ? c.type + ", " + (c.water === "not recorded" ? "water not recorded" : c.water) : c.type,
                   colour: colour.toUpperCase(), crop: info[1], water: c.water,
                   order: (at < 0 ? types.length : at) * 4 + (split ? water : 0) });
      });
    } else if (source === "depth") {
      DEPTH.forEach(function (d, i) {
        out.push({ index: i + 1, key: "depth:" + (i + 1), label: d[0], colour: ID.floodRamp[i], order: i, depth: d[1] });
      });
    } else if (source === "hazard") {
      HAZARD.forEach(function (h, i) {
        out.push({ index: i + 1, key: "hazard:" + (i + 1), label: h[0], colour: h[1], order: i });
      });
    }
    return out;
  }

  // The classes of a paint slot with what the settings do to each of them.
  function resolved(manifest, state, slot) {
    var set = state[slot], source = set.source;
    if (source === "none" || !source) return [];
    var depthRamp = state.look.depth_ramp;
    var chosen = {};
    set.colours.forEach(function (p) { chosen[p[0]] = p[1]; });
    var identity = stormed(state.cover);
    var symbols = slot === "cover" ? (identity ? stormSymbols(manifest, set) : styleSymbols(manifest, set)) : null;
    var level = source === "crops" ? (set.crop_water ? "detail" : "group") : set.level;
    return table(manifest, source, level).map(function (c) {
      var symbol = symbols ? symbols[c.key] || null : null;
      // switched off in the QGIS style and not switched on here: not drawn at all
      var off = !!(symbol && !symbol.on && set.on.indexOf(c.key) < 0 && set.only !== c.key);
      var shown = !off && set.hidden.indexOf(c.key) < 0 && (!set.only || set.only === c.key);
      var colour = chosen[c.key] || (source === "depth" ? depthRamp[c.index - 1] : null) ||
                   (symbol && POYO.symbols.main(symbol)) || (identity && stormColour(source, c)) || c.colour;
      if (symbol && chosen[c.key]) symbol = POYO.symbols.recolour(symbol, chosen[c.key]);
      return { index: c.index, key: c.key, label: c.label, colour: colour, shown: shown, order: c.order,
               group: c.group, cover: c.cover, mosaic: c.mosaic, water: c.water, depth: c.depth, crop: c.crop,
               symbol: symbol, off: off, styled_off: !!(symbols && symbols[c.key] && !symbols[c.key].on),
               paint: shown ? colour : off ? null : slot === "cover" ? set.hidden_colour : null };
    });
  }

  // True when the planned use colours follow the symbols read from the QGIS style.
  function styled(manifest, set) {
    return set.source === "planned" && set.style === "qgis" && !stormed(set) && !!POYO.symbols.style(manifest);
  }

  // Symbol of each class key. A use group takes the symbol of its largest class that is on.
  function styleSymbols(manifest, set) {
    if (!styled(manifest, set)) return null;
    var all = POYO.symbols.style(manifest).classes, entry = manifest.entries.landuse, out = {}, lead = {};
    entry.classes.forEach(function (c) {
      var s = all[c.name] || POYO.symbols.solid(c.colour.toUpperCase());
      if (set.level !== "group") { out["planned:detail:" + c.name] = s; return; }
      var have = lead[c.group];
      if (!have || (s.on && !have.s.on) || (s.on === have.s.on && c.km2 > have.km2)) lead[c.group] = { s: s, km2: c.km2 };
    });
    Object.keys(lead).forEach(function (g) { out["planned:group:" + g] = lead[g].s; });
    return out;
  }

  // ==== loading ===============================================================
  function store(scene) {
    if (!scene.extra) scene.extra = { grids: {}, loading: {}, done: {}, palettes: {}, counts: {} };
    return scene.extra;
  }

  // Names of the data files the picture needs, whether or not they are read yet.
  function wanted(state, manifest) {
    var list = [];
    function add(n) { if (list.indexOf(n) < 0) list.push(n); }
    if (state.cover.source !== "none") add(GRID_OF[state.cover.source]);
    if (manifest && styled(manifest, state.cover)) add("landuse_style");
    if (state.overlay.source !== "none") add(GRID_OF[state.overlay.source]);
    if (state.layers.roads.visible) add("roads");
    Object.keys(LINE_CHUNKS).forEach(function (n) { if (state.layers[n].visible) add(LINE_CHUNKS[n]); });
    if (state.water3d.flood && state.water3d.flood_source !== "at2200") {
      add("flood_depth");
      add("flood_depth_outlines");
    }
    if (state.trees.on) { add("roads"); add(GRID_OF[state.trees.source]); }
    return list;
  }

  function missing(scene, state) {
    var s = store(scene);
    return wanted(state, scene.manifest).filter(function (n) { return !s.done[n]; });
  }

  function load(scene, manifest, name) {
    var s = store(scene);
    if (s.done[name]) return Promise.resolve();
    if (s.loading[name]) return s.loading[name];
    if (!manifest.entries[name]) {
      return Promise.reject(new Error("The data folder has no " + name + " file. Run the export again."));
    }
    var job = POYO.loader.chunk(name).then(function (chunk) {
      prepare(scene, manifest, name, chunk);
      s.done[name] = true;
      delete s.loading[name];
    }, function (error) { delete s.loading[name]; throw error; });
    s.loading[name] = job;
    return job;
  }

  async function ensure(scene, manifest, state, say) {
    var need = missing(scene, state);
    for (var i = 0; i < need.length; i++) {
      if (say) say("Reading " + need[i].replace(/_/g, " "));
      await load(scene, manifest, need[i]);
    }
    return need.length;
  }

  function prepare(scene, manifest, name, chunk) {
    var s = store(scene), a = chunk.arrays, frame = scene.frame;
    var grid10 = scene.grids.terrain_10m;
    if (chunk.meta.kind === "classgrid") {
      var e = manifest.entries[name];
      s.grids[name] = { data: a.classes, late: a.late || null, cols: e.cols, rows: e.rows, cell: e.cell,
                        left: e.x0 - frame.cx, top: e.ytop - frame.cy, tex: null };
      return;
    }
    if (name === "roads") {
      s.roads = roadMesh(scene, a);
      return;
    }
    if (name === "channel") { s.channel = { meta: manifest.entries.channel, arrays: a }; return; }
    if (name === "landuse_style") { outlines(scene, a); return; }
    var layer = Object.keys(LINE_CHUNKS).filter(function (n) { return LINE_CHUNKS[n] === name; })[0];
    if (layer) {
      var set = lineSet(a, frame, layer, manifest);
      scene.lines[layer] = scene.makeLine(G.drape(set.xy, set.starts, set.closed, grid10, 10));
      s["set_" + layer] = set;
      return;
    }
    s[name] = { arrays: a, set: a.poly_ring ? G.polygonSet(a, frame) : null };
  }

  // Polygon outlines of the classes whose symbol has one, one line object per class.
  function outlines(scene, a) {
    var s = store(scene), grid10 = scene.grids.terrain_10m, set = G.polygonSet(a, scene.frame), by = {};
    for (var p = 0; p < set.count; p++) {
      var k = set.polyFeature[p];
      if (!by[k]) by[k] = { xy: [], starts: [0] };
      for (var r = set.polyRing[p]; r < set.polyRing[p + 1]; r++) {
        for (var i = set.ringStart[r]; i < set.ringStart[r + 1]; i++) by[k].xy.push(set.xy[2 * i], set.xy[2 * i + 1]);
        by[k].starts.push(by[k].xy.length / 2);
      }
    }
    s.outlines = Object.keys(by).map(function (k) {
      var line = scene.makeLine(G.drape(new Float32Array(by[k].xy), new Uint32Array(by[k].starts), true, grid10, 10));
      return { index: Number(k), line: line };
    });
  }

  // The outline lines of the land use symbols for this picture.
  function coverLines(scene, manifest, state) {
    var s = store(scene), set = state.cover, out = [];
    if (!s.outlines || !styled(manifest, set) || !(set.opacity > 0) || !state.layers.terrain.visible) return out;
    var all = POYO.symbols.style(manifest).classes, entry = manifest.entries.landuse, list = resolved(manifest, state, "cover");
    s.outlines.forEach(function (o) {
      var cls = entry.classes.filter(function (c) { return c.index === o.index; })[0];
      var r = list.filter(function (c) { return c.index === o.index; })[0];
      var line = cls && all[cls.name] && all[cls.name].outline;
      if (!line || !r || !r.shown || set.level === "group") return;
      var c = POYO.symbols.parse(line.colour);
      out.push({ line: o.line, colour: line.colour.slice(0, 7), a: set.opacity * c[3],
                 mm: line.mm * set.pattern_scale, clip: true });
    });
    return out;
  }

  // Parcels were cut to the pilot windows, so some pieces of outline run along a window
  // edge and are not parcel boundaries. Those pieces are left out.
  function openAtWindows(xy, starts, windows, closed) {
    function onEdge(i, j) {
      for (var w = 0; w < windows.length; w++) {
        var b = windows[w];
        for (var k = 0; k < 4; k++) {
          var axis = k & 1, at = b[k];
          if (Math.abs(xy[2 * i + axis] - at) < 0.15 && Math.abs(xy[2 * j + axis] - at) < 0.15) return true;
        }
      }
      return false;
    }
    var out = [], at = [0], p, i;
    function end() { if (out.length / 2 - at[at.length - 1] > 1) at.push(out.length / 2); else out.length = 2 * at[at.length - 1]; }
    for (p = 0; p + 1 < starts.length; p++) {
      var first = starts[p], last = starts[p + 1];
      for (i = first; i < (closed ? last : last - 1); i++) {
        var j = i + 1 < last ? i + 1 : first;
        if (onEdge(i, j)) { end(); continue; }
        if (out.length / 2 === at[at.length - 1]) out.push(xy[2 * i], xy[2 * i + 1]);
        out.push(xy[2 * j], xy[2 * j + 1]);
      }
      end();
    }
    return { xy: new Float32Array(out), starts: new Uint32Array(at), closed: false };
  }

  // Vertices of a line layer. Rail tunnels are left out: they are not on the ground.
  function lineSet(a, frame, layer, manifest) {
    var xy = G.localXY(a.xy, frame);
    if (layer === "parcels" && manifest.entries.pilot_windows) {
      var windows = manifest.entries.pilot_windows.items.map(function (w) {
        var b = w.bounds;
        return [b[0] - frame.cx, b[1] - frame.cy, b[2] - frame.cx, b[3] - frame.cy];
      });
      return openAtWindows(xy, a.ring_start || a.part_start, windows, !!a.ring_start);
    }
    if (a.ring_start) return { xy: xy, starts: a.ring_start, closed: true };
    var starts = a.part_start;
    if (layer !== "railways") return { xy: xy, starts: starts, closed: false };
    var keep = [], total = 0, p;
    for (p = 0; p + 1 < starts.length; p++) {
      if (a.tunnel[a.part_feature[p]]) continue;
      keep.push(p); total += starts[p + 1] - starts[p];
    }
    var out = new Float32Array(total * 2), at = new Uint32Array(keep.length + 1), n = 0;
    keep.forEach(function (q, i) {
      out.set(xy.subarray(2 * starts[q], 2 * starts[q + 1]), 2 * n);
      n += starts[q + 1] - starts[q]; at[i + 1] = n;
    });
    return { xy: out, starts: at, closed: false };
  }

  // ==== class grid textures ===================================================
  function gridTexture(scene, name) {
    var gl = scene.gl, g = store(scene).grids[name];
    if (g.tex) return g;
    var across = Math.ceil(g.cols / TILE), down = Math.ceil(g.rows / TILE);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8UI, TILE, TILE, across * down, 0, gl.RED_INTEGER,
                  gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, g.cols);
    for (var j = 0; j < down; j++) {
      for (var i = 0; i < across; i++) {
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, j * across + i, Math.min(TILE, g.cols - i * TILE),
                         Math.min(TILE, g.rows - j * TILE), 1, gl.RED_INTEGER, gl.UNSIGNED_BYTE, g.data,
                         j * TILE * g.cols + i * TILE);
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (k) {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, gl.NEAREST);
    });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    g.tex = tex; g.across = across;
    return g;
  }

  function palette(scene, manifest, state, slot) {
    var s = store(scene), gl = scene.gl;
    var list = resolved(manifest, state, slot);
    var key = list.map(function (c) { return c.paint; }).join();
    var have = s.palettes[slot];
    if (have && have.key === key) return have.tex;
    var data = new Uint8Array(256 * 4);
    list.forEach(function (c) {
      if (!c.paint) return;
      var rgb = POYO.hexToRgb(c.paint), o = 4 * c.index;
      data[o] = Math.round(rgb[0] * 255); data[o + 1] = Math.round(rgb[1] * 255);
      data[o + 2] = Math.round(rgb[2] * 255); data[o + 3] = 255;
    });
    if (have) gl.deleteTexture(have.tex);
    var tex = R.texture(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 256, 1, data, gl.NEAREST, 4);
    s.palettes[slot] = { key: key, tex: tex };
    return tex;
  }

  function symbolTexture(scene, manifest, state) {
    var s = store(scene), gl = scene.gl, set = state.cover;
    var list = resolved(manifest, state, "cover").map(function (c) {
      var symbol = !c.shown ? (c.off ? null : POYO.symbols.solid(c.paint)) : c.symbol;
      return { index: c.index, key: c.key, symbol: symbol };
    });
    var key = JSON.stringify(list);
    if (s.symbolTex && s.symbolTex.key === key) return s.symbolTex.tex;
    var packed = POYO.symbols.pack(list);
    if (s.symbolTex) gl.deleteTexture(s.symbolTex.tex);
    var tex = R.texture(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT, packed.width, packed.height, packed.data, gl.NEAREST, 4);
    s.symbolTex = { key: key, tex: tex };
    return tex;
  }

  // What the ground shader has to paint, or null when there is nothing.
  function paintFor(scene, manifest, state) {
    var s = store(scene);
    var out = { slots: [null, null], roads: false };
    ["cover", "overlay"].forEach(function (slot, i) {
      var set = state[slot];
      if (set.source === "none") return;
      var name = GRID_OF[set.source];
      if (!s.grids[name]) return;
      out.slots[i] = { grid: gridTexture(scene, name), palette: palette(scene, manifest, state, slot),
                       alpha: set.opacity, boundaries: set.boundaries,
                       smooth: set.source === "crops" };       // 3 by 3 cells, softer stepped edges
      if (slot === "cover" && (styled(manifest, set) || (stormed(set) && set.source === "planned"))) {
        out.symbols = { tex: symbolTexture(scene, manifest, state), under: set.under === "paper" ? set.under_colour : null,
                        page: set.pattern_space === "page", scale: set.pattern_scale };
      }
    });
    out.roads = !!(state.layers.roads.visible && s.roads && state.layers.roads.opacity > 0);
    return out.slots[0] || out.slots[1] || out.roads ? out : null;
  }

  function dummyArray(scene) {
    var s = store(scene), gl = scene.gl;
    if (s.dummy) return s.dummy;
    s.dummy = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, s.dummy);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8UI, 1, 1, 1, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, new Uint8Array(1));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    return s.dummy;
  }

  // ==== roads: drawn flat from above into a texture, then laid on the ground =====
  var ROAD_VS = R.HEAD + [
    "layout(location=0) in vec2 aPos; layout(location=1) in uint aClass;",
    "uniform vec4 uFoot; uniform vec3 uColours[8]; out vec3 vColour;",
    "void main(){",
    "  vColour = uColours[int(min(aClass, 7u))];",
    "  gl_Position = vec4((aPos - uFoot.xy) * uFoot.zw * 2.0 - 1.0, 0.0, 1.0);",
    "}"].join("\n");
  var ROAD_FS = R.HEAD + "in vec3 vColour; out vec4 frag; void main(){ frag = vec4(vColour, 1.0); }";

  function roadMesh(scene, a) {
    var gl = scene.gl, set = G.polygonSet(a, scene.frame);
    var nv = set.xy.length / 2, cls = new Uint8Array(nv), order = [], p, i;
    for (p = 0; p < set.count; p++) {
      var f = set.polyFeature[p];
      var from = set.ringStart[set.polyRing[p]], to = set.ringStart[set.polyRing[p + 1]];
      cls.fill(a.klass[f], from, to);
      if (!a.tunnel[f]) order.push(p);
    }
    // tracks first, so that larger roads lie on top of them
    order.sort(function (u, v) { return a.klass[set.polyFeature[v]] - a.klass[set.polyFeature[u]] || u - v; });
    var index = new Uint32Array(nv * 3 + 3000), k = 0, tri = [], bins = {};
    order.forEach(function (q) {
      var origin = set.ringStart[set.polyRing[q]];
      tri.length = 0;
      G.triangulate(set, q, tri);
      for (var t = 0; t < tri.length; t++) index[k++] = origin + tri[t];
    });
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    R.buffer(gl, gl.ARRAY_BUFFER, set.xy instanceof Float32Array ? set.xy : new Float32Array(set.xy));
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    R.buffer(gl, gl.ARRAY_BUFFER, cls);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_BYTE, 1, 0);
    R.buffer(gl, gl.ELEMENT_ARRAY_BUFFER, index.subarray(0, k));
    gl.bindVertexArray(null);
    return { vao: vao, count: k, set: set, klass: a.klass, tunnel: a.tunnel,
             program: R.compile(gl, ROAD_VS, ROAD_FS) };
  }

  function roadColours(manifest, state) {
    var L = state.layers.roads, chosen = {};
    state.look.road_colours.forEach(function (p) { chosen[p[0]] = p[1]; });
    var list = manifest.entries.roads ? manifest.entries.roads.classes : [];
    return list.map(function (c) {
      return { index: c.index, name: c.name,
               colour: L.colour_by === "single" ? L.colour : (chosen[c.name] || c.colour) };
    });
  }

  // The piece of ground one tile can show, in local metres: [x0, y0, x1, y1].
  function footprint(c) {
    var m = c.cam.m, t = c.o.tile, box = c.box;
    var mesh = c.scene.terrain[c.o.cell === 20 ? "terrain_20m" : "terrain_10m"];
    var u = [Infinity, Infinity, -Infinity, -Infinity], lo = Infinity, hi = -Infinity;
    mesh.chunks.forEach(function (ch) {
      if (!R.visible(m, t, ch.box)) return;
      u[0] = Math.min(u[0], ch.box[0]); u[1] = Math.min(u[1], ch.box[1]);
      u[2] = Math.max(u[2], ch.box[3]); u[3] = Math.max(u[3], ch.box[4]);
      lo = Math.min(lo, ch.box[2]); hi = Math.max(hi, ch.box[5]);
    });
    if (u[0] > u[2]) return null;
    var det = m[0] * m[5] - m[4] * m[1];
    var scale = Math.hypot(m[0], m[4]) * Math.hypot(m[1], m[5]);
    if (Math.abs(det) > 0.05 * scale) {
      var v = [Infinity, Infinity, -Infinity, -Infinity];
      for (var i = 0; i < 8; i++) {
        var a = ((i & 1 ? 1 : -1) - t[2]) / t[0], b = ((i & 2 ? 1 : -1) - t[3]) / t[1], z = i & 4 ? hi : lo;
        var p = a - m[8] * z - m[12], q = b - m[9] * z - m[13];
        var x = (p * m[5] - m[4] * q) / det, y = (m[0] * q - p * m[1]) / det;
        v[0] = Math.min(v[0], x); v[1] = Math.min(v[1], y); v[2] = Math.max(v[2], x); v[3] = Math.max(v[3], y);
      }
      u = [Math.max(u[0], v[0]), Math.max(u[1], v[1]), Math.min(u[2], v[2]), Math.min(u[3], v[3])];
    }
    if (box && box.mode !== "inside") {
      u = [Math.max(u[0], box.min[0]), Math.max(u[1], box.min[1]), Math.min(u[2], box.max[0]), Math.min(u[3], box.max[1])];
    }
    if (u[2] - u[0] <= 0 || u[3] - u[1] <= 0) return null;
    var pad = Math.max(4, c.o.mpp * 3);
    return [u[0] - pad, u[1] - pad, u[2] + pad, u[3] + pad];
  }

  // Draws the roads of this tile into a texture and returns how to look it up.
  function roadOverlay(scene, manifest, c) {
    var gl = scene.gl, s = store(scene), road = s.roads;
    if (!road) return null;
    var foot = footprint(c);
    if (!foot) return null;
    var cap = Math.min(c.o.cell === 20 ? 2048 : 4096, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    var wide = foot[2] - foot[0], high = foot[3] - foot[1];
    var texel = Math.max(c.o.mpp / 2, wide / cap, high / cap, 0.05);
    var w = Math.max(1, Math.min(cap, Math.ceil(wide / texel))), h = Math.max(1, Math.min(cap, Math.ceil(high / texel)));
    var colours = roadColours(manifest, c.state).map(function (x) { return x.colour; });
    var key = [foot.join(), w, h, colours.join()].join("|");
    var out = { tex: null, xf: [foot[0], foot[1], 1 / wide, 1 / high] };
    var t = s.roadTarget;
    if (t && t.key === key) { out.tex = t.tex; return out; }
    var target = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    var view = Array.prototype.slice.call(gl.getParameter(gl.VIEWPORT));
    if (!t || t.w !== w || t.h !== h) {
      if (t) {
        gl.deleteRenderbuffer(t.rb); gl.deleteFramebuffer(t.msaa); gl.deleteFramebuffer(t.fbo); gl.deleteTexture(t.tex);
      }
      t = { w: w, h: h };
      var samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      t.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
      t.msaa = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaa);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.rb);
      gl.activeTexture(gl.TEXTURE0);
      t.tex = R.texture(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, w, h, null, gl.LINEAR, 4);
      t.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error("The graphics card refused the road texture.");
      }
      s.roadTarget = t;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaa);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    var p = road.program, flat = [];
    for (var i = 0; i < 8; i++) flat.push.apply(flat, POYO.hexToRgb(colours[Math.min(i, colours.length - 1)] || "#616161"));
    gl.useProgram(p.p);
    gl.uniform4f(p.u.uFoot, out.xf[0], out.xf[1], out.xf[2], out.xf[3]);
    gl.uniform3fv(p.u.uColours, flat);
    gl.bindVertexArray(road.vao);
    gl.drawElements(gl.TRIANGLES, road.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msaa);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(view[0], view[1], view[2], view[3]);
    t.key = key; out.tex = t.tex;
    return out;
  }

  // ==== what is inside the picture ============================================
  // The part of the map a count covers: the section box when there is one.
  function region(scene, state) {
    if (!(state.box.enabled && POYO.state.boxIsSet(state.box))) return { rect: null, inside: false };
    var b = POYO.section.local(state, scene.frame);
    return { rect: [b.min[0], b.min[1], b.max[0], b.max[1]], inside: b.mode === "inside" };
  }

  // Cell index range of a local rectangle on a grid: columns c0..c1, rows r0..r1 (ends excluded).
  function cells(g, rect) {
    var c = POYO.clamp;
    return { c0: c(Math.ceil((rect[0] - g.left) / g.cell - 0.5), 0, g.cols),
             c1: c(Math.floor((rect[2] - g.left) / g.cell - 0.5) + 1, 0, g.cols),
             r0: c(Math.ceil((g.top - rect[3]) / g.cell - 0.5), 0, g.rows),
             r1: c(Math.floor((g.top - rect[1]) / g.cell - 0.5) + 1, 0, g.rows) };
  }

  function tally(data, g, rect, out) {
    var k = rect ? cells(g, rect) : { c0: 0, c1: g.cols, r0: 0, r1: g.rows };
    for (var r = k.r0; r < k.r1; r++) {
      var end = r * g.cols + k.c1;
      for (var i = r * g.cols + k.c0; i < end; i++) out[data[i]]++;
    }
    return out;
  }

  function countGrid(scene, name, area) {
    var s = store(scene), g = s.grids[name];
    var key = name + JSON.stringify(area);
    if (s.counts[key]) return s.counts[key];
    var n = tally(g.data, g, area.inside ? null : area.rect, new Float64Array(256));
    if (area.inside) {
      var hole = tally(g.data, g, area.rect, new Float64Array(256));
      for (var i = 0; i < 256; i++) n[i] -= hole[i];
    }
    s.counts[key] = n;
    return n;
  }

  // Basin area inside the region, counted on the 10 m basin mask.
  function regionKm2(scene, state) {
    var s = store(scene), area = region(scene, state);
    var key = "basin" + JSON.stringify(area);
    if (s.counts[key] !== undefined) return s.counts[key];
    var g = scene.sdfGrid, data = scene.sdfBytes;
    function count(rect) {
      var k = rect ? cells(g, rect) : { c0: 0, c1: g.cols, r0: 0, r1: g.rows }, n = 0;
      for (var r = k.r0; r < k.r1; r++) {
        for (var i = r * g.cols + k.c0, end = r * g.cols + k.c1; i < end; i++) if (data[i] >= 128) n++;
      }
      return n;
    }
    var total = area.inside ? count(null) - count(area.rect) : count(area.rect);
    s.counts[key] = total * g.cell * g.cell / 1e6;
    return s.counts[key];
  }

  // Legend rows of a paint slot: shown classes that occur in the region, with area and share.
  function legendRows(scene, manifest, state, slot) {
    var set = state[slot], s = store(scene);
    if (set.source === "none") return null;
    var name = GRID_OF[set.source];
    if (!s.grids[name]) return null;
    var n = countGrid(scene, name, region(scene, state)), total = regionKm2(scene, state);
    var byKey = {}, rows = [], hidden = 0, off = 0;
    resolved(manifest, state, slot).forEach(function (c) {
      var km2 = n[c.index] * CELL_KM2;
      if (!c.shown) { if (c.off) off += km2; else hidden += km2; return; }
      if (!byKey[c.key]) {
        byKey[c.key] = { key: c.key, label: c.label, colour: c.colour, symbol: c.symbol, km2: 0, order: c.order };
        rows.push(byKey[c.key]);
      }
      byKey[c.key].km2 += km2;
    });
    rows = rows.filter(function (r) { return r.km2 > 0; }).sort(function (a, b) { return a.order - b.order; });
    rows.forEach(function (r) { r.share = total > 0 ? 100 * r.km2 / total : 0; });
    return { rows: rows, hidden_km2: hidden, off_km2: off, total_km2: total,
             title: slot === "cover" ? LABELS.cover[set.source] : LABELS.overlay[set.source] };
  }

  function areaText(r) {
    var km = r.km2 < 0.005 ? "<0.01" : POYO.fmt(r.km2, r.km2 < 10 ? 2 : 1);
    var pc = r.share < 0.05 ? "<0.1" : POYO.fmt(r.share, 1);
    return km + " km², " + pc + " %";
  }

  // True when any segment of a draped line lies inside the section box.
  function lineInside(scene, state, line) {
    if (!line || !line.count) return false;
    var area = region(scene, state);
    if (!area.rect || !line.segs) return true;
    var v = line.segs, r = area.rect;
    for (var i = 0; i < v.length; i += 6) {
      var x = (v[i] + v[i + 3]) / 2, y = (v[i + 1] + v[i + 4]) / 2;
      var within = x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
      if (within !== area.inside) return true;
    }
    return false;
  }

  // True when any part of a water or flood mask lies inside the section box.
  function fillInside(scene, state, fill) {
    var area = region(scene, state);
    if (!fill) return false;
    if (!area.rect || !fill.data) return true;
    var g = { left: fill.xf[0], top: fill.xf[1], cell: fill.cell, cols: fill.cols, rows: fill.rows };
    var k = cells(g, area.rect), r, i;
    if (area.inside) {
      for (r = 0; r < g.rows; r++) {
        for (i = 0; i < g.cols; i++) {
          if (fill.data[r * g.cols + i] > 127 && !(r >= k.r0 && r < k.r1 && i >= k.c0 && i < k.c1)) return true;
        }
      }
      return false;
    }
    for (r = k.r0; r < k.r1; r++) for (i = k.c0; i < k.c1; i++) if (fill.data[r * g.cols + i] > 127) return true;
    return false;
  }

  POYO.layers = {
    table: table, resolved: resolved, wanted: wanted, missing: missing, load: load, ensure: ensure,
    store: store, paintFor: paintFor, gridTexture: gridTexture, dummyArray: dummyArray,
    roadOverlay: roadOverlay, roadColours: roadColours, region: region, cells: cells,
    countGrid: countGrid, regionKm2: regionKm2, legendRows: legendRows, areaText: areaText,
    lineInside: lineInside, fillInside: fillInside, mix: mix, styled: styled, coverLines: coverLines,
    GRID_OF: GRID_OF, LINE_CHUNKS: LINE_CHUNKS, LABELS: LABELS, DEPTH: DEPTH, SIOSE: SIOSE
  };
})();
