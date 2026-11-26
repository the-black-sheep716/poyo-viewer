// state.js: everything that changes a picture, and the sidecar file that stores it.
"use strict";
(function () {
  var ID = POYO.ID;

  var GROUPS = ["ground", "buildings", "water", "flood"];
  var STYLES = ["shaded", "flat", "white", "outline", "contours", "wireframe", "xray"];
  // What each group looks like when nothing is chosen. These four are the Stage 1 picture.
  var PLAIN = { ground: "shaded", buildings: "shaded", water: "flat", flood: "flat" };
  // Credit text for the sources that are documented. Others are left empty on purpose.
  var SOURCES = {
    satellite: "Satellite flood extent: Copernicus Emergency Management Service.",
    at2200: "", buildings: "Buildings: © OpenStreetMap contributors.", rivers: "River channels: MITECO.",
    streams: "", terrain: "", basin: ""
  };
  // Stage 3 sources. "source not documented" is written where the files carry no statement.
  var SOURCES3 = {
    satellite: SOURCES.satellite, at2200: "Flood extent at 22:00: source not documented.",
    buildings: SOURCES.buildings, rivers: SOURCES.rivers, streams: "Streams: source not documented.",
    terrain: "Ground: source not documented.", basin: "Basin boundary: source not documented.",
    landuse: "Planned land use: source not documented.", siose: "Land cover: SIOSE 2014, Comunitat Valenciana.",
    crops: "Parcel use: SIGPAC 2026, Institut Cartogràfic Valencià, Generalitat Valenciana, CC BY.",
    depth: "Flood depth classes: Copernicus Emergency Management Service.",
    hazard: "Flood hazard zones: PATRICOVA, from the competition data.",
    roads: "Roads: © OpenStreetMap contributors.", railways: "Railways: © OpenStreetMap contributors.",
    places: "Place areas: © OpenStreetMap contributors.",
    municipal: "Municipal limits: derived from planning zoning, source not documented.",
    sector: "Study sector and pilot windows: drawn for this study.",
    parcels: "Parcel outlines: SIGPAC, FEGA, CC BY 4.0."
  };
  var LINES3 = ["parcels", "places", "municipal", "railways", "windows", "sector"];

  function defaults() {
    return {
      view: { azimuth: 0, elevation: 90, ve: 1, target: [0, 0, 0], scale: 60000 },
      sheet: { paper: "A0", orientation: "landscape", width_mm: 1189, height_mm: 841, ppi: 200,
               background: "paper", paper_colour: ID.paper, panel_id: "ID_1", credits: "",
               annotations: "full", text_size: 1,
               layout: "stage3", title_block: true, legend: true, id_mark: true,
               panel_side: "auto", margin_mm: 10, frame_name: "",
               auto_sources: true, sources: POYO.deepCopy(SOURCES3),
               ink: ID.ink, body_ink: ID.graphite, muted_ink: ID.slate },
      layers: {
        terrain: { visible: true, opacity: 1 },
        rivers: { visible: true, colour: ID.water, opacity: 1,
                  outline: false, outline_colour: ID.floodRamp[4], outline_mm: 0.15 },
        flood: { source: "satellite", satellite_colour: ID.floodRamp[2], at2200_colour: ID.floodRamp[1],
                 opacity: 0.85, outline: false, outline_colour: ID.floodRamp[3], outline_mm: 0.2,
                 hide_in_elevation: true },
        roads: { visible: false, colour_by: "class", colour: "#616161", opacity: 1 },
        municipal: { visible: false, colour: ID.slate, opacity: 1, width_mm: 0.35 },
        places: { visible: false, colour: ID.slate, opacity: 1, width_mm: 0.2 },
        railways: { visible: false, colour: ID.graphite, opacity: 1, width_mm: 0.4 },
        sector: { visible: false, colour: ID.magenta, opacity: 1, width_mm: 0.6 },
        windows: { visible: false, colour: ID.magenta, opacity: 1, width_mm: 0.4 },
        parcels: { visible: false, colour: ID.slate, opacity: 1, width_mm: 0.1 },
        streams: { visible: true, colour: ID.water, opacity: 1, width_mm: 0.25 },
        basin: { visible: true, colour: ID.ink, opacity: 1, width_mm: 0.6 },
        buildings: { visible: true, opacity: 1, flat: false, floors_colour: ID.graphite,
                     explicit_colour: ID.slate, none_colour: ID.paper,
                     default_height_m: 3, industrial_height_m: 3 }
      },
      fill_order: ["rivers", "flood"],            // bottom to top
      line_order: LINES3.concat(["streams", "basin"]),   // bottom to top
      // painted ground colours, from the indexed class grids
      cover: { source: "none", level: "detail", only: "", hidden: [], colours: [], hidden_colour: ID.line,
               boundaries: false, boundary_colour: ID.graphite, boundary_mm: 0.1, shading: 0, opacity: 1,
               // planned use follows the symbols of the QGIS style when they were exported
               style: "qgis", on: [], under: "paper", under_colour: "#FFFFFF", pattern_space: "ground",
               pattern_scale: 1,
               // crop types: one colour per type, or irrigated and rainfed apart
               crop_water: false },
      overlay: { source: "none", only: "", hidden: [], colours: [], boundaries: false, opacity: 0.8 },
      // water level scenario: solid water, off by default
      water3d: { channel: false, channel_mode: "depth", channel_depth_m: 2, channel_level_m: 100,
                 flood: false, flood_source: "depth", depth_2200_m: 1, colour_by: "depth", colour: ID.water, opacity: 0.85,
                 walls: true },
      trees: { on: false, seed: 1, cap: 150000, source: "planned", grid_m: 6, area: [], classes: [] },
      profile: { path: [], width_mm: 800, height_mm: 260, ve: 10, buildings_width_m: 100, ticks: "",
                 flood_depth: false, municipal_ticks: true, subbasin_ticks: true },
      elevation: { from: "S", slice_m: 0, trees: true },
      vector: { ppi: 150, simplify_mm: 0.05, contours: false, tree_crown_cap: 5000 },
      terrain: { low_colour: ID.stone, mid_colour: ID.line, high_colour: ID.paper,
                 mid_m: 350, low_m: 0, high_m: 1050, hillshade: 0.6, light_azimuth: 315,
                 light_altitude: 45, shading_relief: 2, base_colour: ID.slate, datum_m: -50 },
      look: {
        ground: PLAIN.ground, buildings: PLAIN.buildings, water: PLAIN.water, flood: PLAIN.flood,
        flat_ground: ID.line,
        white_ground: "#FFFFFF", white_building: "#FFFFFF", white_assumed: ID.stone,
        white_water: ID.stone, white_flood: ID.line, white_line: ID.slate,
        contour_interval_m: 10, contour_index: 5, contour_mm: 0.1, contour_index_mm: 0.25,
        contour_colour: ID.graphite, contour_base: "paper", building_contour_m: 3,
        wire_spacing_m: 200, wire_mm: 0.1, wire_colour: ID.slate,
        outline_mm: 0.18, outline_colour: ID.ink, outline_depth_m: 2.5, outline_angle_deg: 30,
        xray_alpha: 0.3,
        trees: "shaded", tree_crown: "#6B8638", tree_trunk: ID.slate, depth_ramp: ID.floodRamp.slice(),
        water_ramp: ID.floodRamp.slice(),
        road_colours: []
      },
      box: { enabled: false, mode: "outside", min: [0, 0, 0], max: [0, 0, 0],
             cut: { ground_fill: "solid", ground_colour: ID.stone,
                    buildings_fill: "solid", building_colour: ID.ink,
                    hatch_back: ID.paper, hatch_angle: 45, hatch_spacing_mm: 1.5, hatch_line_mm: 0.25,
                    line_mm: 0.35, line_colour: ID.ink, horizontal: true } },
      theme_name: "Poyo Riverscape paper"
    };
  }

  function paperSize(sheet) {
    if (sheet.paper === "custom") return [sheet.width_mm, sheet.height_mm];
    var s = POYO.PAPERS[sheet.paper] || POYO.PAPERS.A0;
    return sheet.orientation === "landscape" ? [s[1], s[0]] : [s[0], s[1]];
  }

  function pagePixels(sheet) {
    var mm = paperSize(sheet);
    return { width: Math.round(mm[0] / 25.4 * sheet.ppi), height: Math.round(mm[1] / 25.4 * sheet.ppi),
             width_mm: mm[0], height_mm: mm[1] };
  }

  // Keep every value inside what the viewer can draw, whatever a file contains.
  function sanitise(s) {
    var c = POYO.clamp, v = s.view, sh = s.sheet, b = s.layers.buildings;
    v.azimuth = ((Number(v.azimuth) % 360) + 360) % 360 || 0;
    v.elevation = c(Number(v.elevation) || 0, 0, 90);
    v.ve = c(Number(v.ve) || 1, 1, 10);
    v.scale = c(Number(v.scale) || 60000, 200, 1000000);
    v.target = [0, 1, 2].map(function (i) { return Number(v.target && v.target[i]) || 0; });
    sh.ppi = c(Math.round(Number(sh.ppi) || 200), 50, 400);
    sh.width_mm = c(Number(sh.width_mm) || 841, 50, 1500);
    sh.height_mm = c(Number(sh.height_mm) || 1189, 50, 1500);
    sh.text_size = c(Number(sh.text_size) || 1, 0.5, 2);
    if (sh.paper !== "custom" && !POYO.PAPERS[sh.paper]) sh.paper = "A0";
    b.default_height_m = c(Number(b.default_height_m), 0, 100);
    b.industrial_height_m = c(Number(b.industrial_height_m), 0, 100);
    ["fill_order", "line_order"].forEach(function (key) {
      var want = defaults()[key], got = (s[key] || []).filter(function (n) { return want.indexOf(n) >= 0; });
      want.forEach(function (n) { if (got.indexOf(n) < 0) got.push(n); });
      s[key] = got;
    });
    if (["satellite", "at2200", "none"].indexOf(s.layers.flood.source) < 0) s.layers.flood.source = "satellite";
    var d = defaults(), k = s.look;
    GROUPS.forEach(function (g) { if (STYLES.indexOf(k[g]) < 0) k[g] = PLAIN[g]; });
    function num(o, key, lo, hi) {
      var n = Number(o[key]);
      o[key] = isFinite(n) ? c(n, lo, hi) : d.look[key];
    }
    num(k, "contour_interval_m", 1, 500); num(k, "contour_index", 0, 20); num(k, "building_contour_m", 0.5, 100);
    num(k, "contour_mm", 0.03, 2); num(k, "contour_index_mm", 0.03, 2);
    num(k, "wire_spacing_m", 10, 5000); num(k, "wire_mm", 0.03, 2);
    num(k, "outline_mm", 0.05, 0.8); num(k, "outline_depth_m", 0.2, 200);
    num(k, "outline_angle_deg", 5, 89); num(k, "xray_alpha", 0.03, 1);
    k.contour_index = Math.round(k.contour_index);
    if (["paper", "ramp", "shaded", "none"].indexOf(k.contour_base) < 0) k.contour_base = "paper";
    sanitiseBox(s.box);
    if (["stage1", "stage2", "stage3"].indexOf(sh.layout) < 0) sh.layout = "stage3";
    sanitise3(s);
    return s;
  }

  function sanitise3(s) {
    var c = POYO.clamp, d = defaults();
    function num(o, key, lo, hi, def) { var n = Number(o[key]); o[key] = isFinite(n) ? c(n, lo, hi) : def; }
    function word(o, key, list) { if (list.indexOf(o[key]) < 0) o[key] = list[0]; }
    function strings(o, key) { if (!Array.isArray(o[key])) o[key] = []; o[key] = o[key].filter(function (v) { return typeof v === "string"; }); }
    function pairs(o, key) {
      if (!Array.isArray(o[key])) o[key] = [];
      o[key] = o[key].filter(function (v) { return Array.isArray(v) && typeof v[0] === "string" && /^#[0-9a-fA-F]{6}$/.test(v[1]); });
    }
    var sh = s.sheet;
    word(sh, "panel_side", ["auto", "right", "bottom"]); num(sh, "margin_mm", 0, 100, 10);
    word(s.cover, "source", ["none", "planned", "observed", "crops"]); word(s.cover, "level", ["detail", "group"]);
    s.cover.crop_water = s.cover.crop_water === true;
    strings(s.cover, "hidden"); pairs(s.cover, "colours");
    num(s.cover, "boundary_mm", 0.03, 1, 0.1); num(s.cover, "shading", 0, 1, 0); num(s.cover, "opacity", 0, 1, 1);
    word(s.cover, "style", ["qgis", "solid"]); strings(s.cover, "on"); word(s.cover, "under", ["paper", "ground"]);
    word(s.cover, "pattern_space", ["ground", "page"]); num(s.cover, "pattern_scale", 0.25, 4, 1);
    if (!/^#[0-9a-fA-F]{6}$/.test(s.cover.under_colour)) s.cover.under_colour = "#FFFFFF";
    word(s.overlay, "source", ["none", "depth", "hazard"]); strings(s.overlay, "hidden"); pairs(s.overlay, "colours");
    num(s.overlay, "opacity", 0, 1, 0.8);
    var w = s.water3d;
    word(w, "channel_mode", ["depth", "level"]); word(w, "colour_by", ["depth", "single"]);
    word(w, "flood_source", ["depth", "at2200"]);
    num(w, "channel_depth_m", 0, 50, 2); num(w, "channel_level_m", -10, 1100, 100);
    num(w, "depth_2200_m", 0, 20, 1); num(w, "opacity", 0, 1, 0.85);
    var t = s.trees;
    word(t, "source", ["planned", "observed", "crops"]);
    num(t, "seed", 0, 999999999, 1); t.seed = Math.round(t.seed);
    num(t, "cap", 100, 2000000, 150000); t.cap = Math.round(t.cap); num(t, "grid_m", 2, 50, 6);
    if (!Array.isArray(t.area) || t.area.length !== 4 || !t.area.every(isFinite)) t.area = [];
    if (!Array.isArray(t.classes)) t.classes = [];
    t.classes = t.classes.filter(function (v) { return Array.isArray(v) && v.length === 7 && typeof v[0] === "string"; });
    if (!t.area.length) t.on = false;
    var p = s.profile;
    if (!Array.isArray(p.path)) p.path = [];
    num(p, "width_mm", 100, 3000, 800); num(p, "height_mm", 80, 1500, 260); num(p, "ve", 1, 100, 10);
    num(p, "buildings_width_m", 0, 600, 100);
    word(s.elevation, "from", ["S", "N", "E", "W"]); num(s.elevation, "slice_m", 0, 5000, 0);
    num(s.vector, "ppi", 50, 300, 150); num(s.vector, "simplify_mm", 0, 2, 0.05);
    num(s.vector, "tree_crown_cap", 0, 50000, 5000);
    word(s.layers.roads, "colour_by", ["class", "single"]); num(s.layers.roads, "opacity", 0, 1, 1);
    if (STYLES.indexOf(s.look.trees) < 0) s.look.trees = "shaded";
    ["depth_ramp", "water_ramp"].forEach(function (key) {
      var ramp = s.look[key];
      if (!Array.isArray(ramp) || ramp.length !== 5 || !ramp.every(function (v) { return /^#[0-9a-fA-F]{6}$/.test(v); })) {
        s.look[key] = d.look[key];
      }
    });
    pairs(s.look, "road_colours");
  }

  function sanitiseBox(b) {
    var c = POYO.clamp, d = defaults().box;
    b.mode = b.mode === "inside" ? "inside" : "outside";
    ["min", "max"].forEach(function (k) {
      b[k] = [0, 1, 2].map(function (i) { return Number(b[k] && b[k][i]) || 0; });
    });
    for (var i = 0; i < 3; i++) {
      if (b.min[i] > b.max[i]) { var t = b.min[i]; b.min[i] = b.max[i]; b.max[i] = t; }
    }
    var cut = b.cut;
    ["ground_fill", "buildings_fill"].forEach(function (k) {
      if (["solid", "hatch", "none"].indexOf(cut[k]) < 0) cut[k] = "solid";
    });
    [["hatch_angle", -180, 180], ["hatch_spacing_mm", 0.3, 20], ["hatch_line_mm", 0.05, 3], ["line_mm", 0, 3]]
      .forEach(function (r) {
        var n = Number(cut[r[0]]);
        cut[r[0]] = isFinite(n) ? c(n, r[1], r[2]) : d.cut[r[0]];
      });
  }

  // True when the box has a size the viewer can use.
  function boxIsSet(b) {
    return b.max[0] - b.min[0] >= 1 && b.max[1] - b.min[1] >= 1 && b.max[2] - b.min[2] >= 0.5;
  }

  // The sidecar holds no user, machine or path information.
  // Schema 1 was written by the Stage 1 viewer. Schema 2 adds the section box,
  // render styles, theme name and the choice of sheet layout. Schema 3 adds ground
  // colours, water surfaces, trees, extra layers, frames, profile and vector settings.
  var SCHEMA = 3;

  function toSidecar(state, frame, manifest, extra) {
    var s = POYO.deepCopy(state), page = pagePixels(state.sheet), v = state.view;
    return {
      format: "poyo-sidecar-3",
      schema_version: SCHEMA,
      viewer_version: POYO.APP_VERSION,
      data_build_date: manifest.build_date,
      camera: {
        projection: "orthographic", crs: POYO.CRS,
        view_name: POYO.camera.viewName(v),
        azimuth_deg: v.azimuth, elevation_deg: v.elevation,
        vertical_exaggeration: v.ve,
        scale_denominator: v.scale,
        target_m: [v.target[0] + frame.cx, v.target[1] + frame.cy, v.target[2]],
        local_origin_m: [frame.cx, frame.cy]
      },
      page: {
        paper: s.sheet.paper, orientation: s.sheet.orientation,
        width_mm: page.width_mm, height_mm: page.height_mm, ppi: s.sheet.ppi,
        width_px: page.width, height_px: page.height, background: s.sheet.background
      },
      section_box: s.box.enabled
        ? { crs: POYO.CRS, clip: s.box.mode, min_m: s.box.min.slice(), max_m: s.box.max.slice() } : null,
      theme: s.theme_name,
      settings: s,
      export: extra || null
    };
  }

  function schemaOf(json) {
    if (json && json.format === "poyo-sidecar-1") return 1;
    if (json && json.format === "poyo-sidecar-2" && json.schema_version === 2) return 2;
    if (json && json.format === "poyo-sidecar-3" && json.schema_version === 3) return 3;
    return 0;
  }

  function fromSidecar(json, frame) {
    var schema = schemaOf(json);
    if (!schema) {
      if (json && typeof json.format === "string" && json.format.indexOf("poyo-sidecar-") === 0) {
        throw new Error("This sidecar was written by a newer viewer.");
      }
      throw new Error("This is not a viewer sidecar file.");
    }
    var s = defaults();
    if (schema < 3) {
      // an older viewer knew nothing of these, so they start as they behaved then
      s.sheet.layout = "stage2";
      s.sheet.sources = POYO.deepCopy(SOURCES3);
      Object.keys(SOURCES).forEach(function (k) { s.sheet.sources[k] = SOURCES[k]; });
      s.layers.flood.hide_in_elevation = false;
    }
    POYO.mergeKnown(s, json.settings);
    // a file written before the QGIS symbols existed was drawn with solid colours
    var kept = json.settings && json.settings.cover;
    if (kept && kept.style === undefined) s.cover.style = "solid";
    if (schema === 1) {
      // keep the Stage 1 sheet, so the same file gives the same picture
      s.sheet.layout = "stage1";
      s.theme_name = "Stage 1 sidecar";
    }
    var cam = json.camera;
    if (cam) {
      s.view.azimuth = cam.azimuth_deg; s.view.elevation = cam.elevation_deg;
      s.view.ve = cam.vertical_exaggeration; s.view.scale = cam.scale_denominator;
      // keep the stored local target, so the same file draws the same pixels
      var same = cam.local_origin_m && cam.local_origin_m[0] === frame.cx &&
                 cam.local_origin_m[1] === frame.cy && json.settings;
      if (same) s.view.target = json.settings.view.target.slice();
      else s.view.target = [cam.target_m[0] - frame.cx, cam.target_m[1] - frame.cy, cam.target_m[2]];
    }
    return sanitise(s);
  }

  POYO.state = { defaults: defaults, sanitise: sanitise, paperSize: paperSize,
                 pagePixels: pagePixels, toSidecar: toSidecar, fromSidecar: fromSidecar,
                 schemaOf: schemaOf, boxIsSet: boxIsSet, GROUPS: GROUPS, STYLES: STYLES, PLAIN: PLAIN,
                 SOURCES: SOURCES, SOURCES3: SOURCES3, LINES3: LINES3 };
})();
