// theme.js: a theme is a small JSON file holding colours, line weights and render
// styles. Loading one never touches the camera, the section box, which layers are
// on, the flood product, the paper size or the building heights.
"use strict";
(function () {
  var ID = POYO.ID;
  var FORMAT = "poyo-theme-1";

  // What a theme may set. Anything else in a file is ignored and reported.
  var KEYS = {
    sheet: ["paper_colour", "ink", "body_ink", "muted_ink", "design", "tab_colour", "rule_colour"],
    layers: {
      terrain: ["opacity"],
      rivers: ["colour", "opacity", "outline", "outline_colour", "outline_mm"],
      flood: ["satellite_colour", "at2200_colour", "opacity", "outline", "outline_colour", "outline_mm"],
      streams: ["colour", "opacity", "width_mm"],
      basin: ["colour", "opacity", "width_mm"],
      buildings: ["opacity", "floors_colour", "explicit_colour", "none_colour"],
      roads: ["colour", "opacity"],
      municipal: ["colour", "opacity", "width_mm"], places: ["colour", "opacity", "width_mm"],
      railways: ["colour", "opacity", "width_mm"], sector: ["colour", "opacity", "width_mm"],
      windows: ["colour", "opacity", "width_mm"], parcels: ["colour", "opacity", "width_mm"]
    },
    cover: ["hidden_colour", "boundary_colour"],
    terrain: ["low_colour", "mid_colour", "high_colour", "mid_m", "low_m", "high_m", "hillshade",
              "light_azimuth", "light_altitude", "shading_relief", "base_colour"],
    look: Object.keys(POYO.state.defaults().look),
    cut: Object.keys(POYO.state.defaults().box.cut)
  };

  // The parts of a state a theme covers, as plain objects: path name, object, keys.
  function parts(state, settings, visit) {
    visit("sheet", state.sheet, settings.sheet, KEYS.sheet);
    Object.keys(KEYS.layers).forEach(function (n) {
      visit("layers." + n, state.layers[n], (settings.layers || {})[n], KEYS.layers[n]);
    });
    visit("terrain", state.terrain, settings.terrain, KEYS.terrain);
    visit("look", state.look, settings.look, KEYS.look);
    visit("cover", state.cover, settings.cover, KEYS.cover);
    visit("cut", state.box.cut, settings.cut, KEYS.cut);
  }

  function capture(state, name, mode) {
    var settings = { sheet: {}, layers: {}, terrain: {}, look: {}, cut: {}, cover: {} };
    Object.keys(KEYS.layers).forEach(function (n) { settings.layers[n] = {}; });
    parts(state, settings, function (path, from, to, keys) {
      keys.forEach(function (k) { to[k] = POYO.deepCopy(from[k]); });
    });
    return { format: FORMAT, name: String(name || "My theme"), interface: mode === "dark" ? "dark" : "paper",
             settings: settings };
  }

  function isColourKey(k) { return k !== "road_colours" && /colour|ink$|^hatch_back$|^tree_(crown|trunk)$/.test(k); }
  var HEX = /^#[0-9a-fA-F]{6}$/;
  // settings that take one word from a short list
  var FILLS = ["solid", "hatch", "none"];
  var WORDS = { "cut.ground_fill": FILLS, "cut.buildings_fill": FILLS,
                "look.contour_base": ["paper", "ramp", "shaded", "none"], "look.trees": POYO.state.STYLES,
                "sheet.design": ["riverscape", "chronogram"] };
  POYO.state.GROUPS.forEach(function (g) { WORDS["look." + g] = POYO.state.STYLES; });

  function check(theme) {
    if (!theme || theme.format !== FORMAT || !theme.settings || typeof theme.settings !== "object") {
      throw new Error("This is not a viewer theme file.");
    }
    return theme;
  }

  // Returns a list of entries that were not used, so a typing mistake is not silent.
  function apply(state, theme) {
    check(theme);
    var skipped = [], settings = theme.settings;
    Object.keys(settings).forEach(function (k) { if (!KEYS[k]) skipped.push(k); });
    Object.keys(settings.layers || {}).forEach(function (k) { if (!KEYS.layers[k]) skipped.push("layers." + k); });
    var used = [];
    parts(state, settings, function (path, to, from, keys) {
      if (!from || typeof from !== "object") return;
      Object.keys(from).forEach(function (k) {
        var v = from[k], words = WORDS[path + "." + k];
        if (keys.indexOf(k) < 0 || typeof v !== typeof to[k] || Array.isArray(v) !== Array.isArray(to[k]) ||
            (isColourKey(k) && !HEX.test(v)) ||
            (typeof v === "number" && !isFinite(v)) || (words && words.indexOf(v) < 0)) {
          skipped.push(path + "." + k);
          return;
        }
        to[k] = isColourKey(k) ? v.toUpperCase() : v;
        used.push([path + "." + k, to, k, JSON.stringify(to[k])]);
      });
    });
    state.theme_name = String(theme.name || "Unnamed theme");
    if (state.sheet.layout === "stage1") state.sheet.layout = "stage3";
    POYO.state.sanitise(state);
    // a number outside its range is pulled back to the limit, and that is said too
    used.forEach(function (u) {
      var now = JSON.stringify(u[1][u[2]]);
      if (now !== u[3]) skipped.push(u[0] + " (set to " + now + ")");
    });
    return skipped;
  }

  // ==== the three built in themes
  function paper() {
    var d = POYO.state.defaults();
    return capture(d, "Poyo Riverscape paper", "paper");
  }

  // The same logic on a dark ground. The identity gives ramps for light grounds only,
  // so the ramps here are built from its neutrals: dim is shallow or minor, bright is
  // deep or major. The water colour is carried over unchanged.
  function dark() {
    var d = POYO.state.defaults();
    d.sheet.paper_colour = ID.ink; d.sheet.ink = ID.paper; d.sheet.body_ink = ID.line; d.sheet.muted_ink = ID.stone;
    var T = d.terrain;
    T.low_colour = ID.graphite; T.mid_colour = "#3A3A38"; T.high_colour = ID.slate; T.base_colour = "#3A3A38";
    var L = d.layers;
    L.basin.colour = ID.paper;
    L.buildings.floors_colour = ID.line; L.buildings.explicit_colour = ID.stone; L.buildings.none_colour = ID.ink;
    var K = d.look;
    K.flat_ground = ID.graphite;
    K.contour_colour = ID.line; K.wire_colour = ID.stone; K.outline_colour = ID.paper;
    K.white_assumed = ID.slate;
    // flood depth classes, shallow to deep
    K.depth_ramp = [ID.slate, "#8F8F8A", ID.stone, ID.line, ID.paper];
    K.road_colours = [["Motorway / trunk", ID.paper], ["Primary", ID.line], ["Secondary", ID.stone],
                      ["Tertiary", "#8F8F8A"], ["Local street", "#8F8F8A"], ["Service", ID.slate],
                      ["Track / path", "#4A4A47"]];
    L.roads.colour = "#8F8F8A";
    L.municipal.colour = ID.stone; L.places.colour = "#8F8F8A"; L.railways.colour = ID.line; L.parcels.colour = ID.stone;
    d.cover.hidden_colour = "#3A3A38"; d.cover.boundary_colour = ID.line;
    K.tree_trunk = ID.stone;
    var C = d.box.cut;
    C.ground_colour = ID.stone; C.building_colour = ID.paper; C.hatch_back = ID.ink; C.line_colour = ID.paper;
    return capture(d, "Dark interface", "dark");
  }

  // Ground, buildings and water in white. The flood keeps its colour, because it is
  // what the drawing is about.
  function white() {
    var d = POYO.state.defaults();
    d.look.ground = "white"; d.look.buildings = "white"; d.look.water = "white"; d.look.flood = "flat";
    d.terrain.base_colour = ID.line;
    return capture(d, "White model", "paper");
  }

  // ==== the presets of the chronogram app (Poyo Chronogram Studio 4.8), colour for colour.
  // [name, paper, ink, muted, rule, accent, title tab, water, ecological, planning]
  var CHRONOGRAM = [
    ["Signal", "#FFFFFF", "#000000", "#5B5B5B", "#CFCFCF", "#FF3B00", "#FF3B00", "#0091B9", "#7CB518"],
    ["Riverscape", "#FFFFFF", "#0B0B0B", "#6E6E6E", "#D6D6D6", "#E6007E", "#F5B700", "#0091B9", "#7CB518"],
    ["Riverscape ink", "#0B0B0B", "#F7F7F5", "#B4B4AF", "#3A3A38", "#FF3D9E", "#F5B700", "#0091B9", "#9BD02D"],
    ["Violet", "#FFFFFF", "#12081F", "#6B6280", "#DDD6EA", "#7B2CF5", "#F5B700", "#0091B9", "#7CB518"],
    ["Editorial", "#F4EFE6", "#1B1713", "#6F655A", "#D9D0C1", "#D6361F", "#F0A500", "#0091B9", "#6F9A1C"],
    ["Night", "#0D0D0F", "#F3F1EC", "#9B9AA0", "#2B2B31", "#FF2D95", "#FFC400", "#1FB2E8", "#9BE22D"],
    ["Blueprint", "#0A2540", "#EAF4FF", "#8DB1D6", "#1D4770", "#FFD60A", "#5AD1FF", "#00B4FF", "#A3E635"]
  ];

  function mix(a, b, t) {
    return "#" + [1, 3, 5].map(function (i) {
      var u = parseInt(a.slice(i, i + 2), 16), v = parseInt(b.slice(i, i + 2), 16);
      return (256 + Math.round(u + (v - u) * t)).toString(16).slice(1);
    }).join("").toUpperCase();
  }

  // Ground and buildings are steps between paper and ink, water is always a tint or a
  // shade of the preset's blue, and the accent marks the tab and the study outlines.
  // Painted land colours are not part of a theme and keep their own style.
  function chronogram(row) {
    var paperC = row[1], ink = row[2], muted = row[3], rule = row[4], accent = row[5], tab = row[6], water = row[7];
    var night = parseInt(paperC.slice(1, 3), 16) < 128;
    function tone(t) { return mix(paperC, ink, t); }
    function blue(t) { return mix(paperC, water, t); }
    var d = POYO.state.defaults();
    var S = d.sheet;
    S.design = "chronogram"; S.paper_colour = paperC; S.ink = ink; S.body_ink = tone(0.85); S.muted_ink = muted;
    S.tab_colour = tab; S.rule_colour = rule;
    var T = d.terrain;
    T.low_colour = tone(night ? 0.10 : 0.22); T.mid_colour = tone(night ? 0.18 : 0.11);
    T.high_colour = tone(night ? 0.30 : 0.02); T.base_colour = tone(0.35);
    var L = d.layers;
    L.rivers.colour = water; L.rivers.outline_colour = mix(water, ink, 0.35);
    L.streams.colour = water;
    L.flood.satellite_colour = blue(0.62); L.flood.at2200_colour = blue(0.42);
    L.flood.outline_colour = mix(water, ink, 0.2);
    L.basin.colour = ink;
    L.buildings.floors_colour = ink; L.buildings.explicit_colour = muted; L.buildings.none_colour = paperC;
    L.roads.colour = muted; L.municipal.colour = muted; L.places.colour = tone(0.45); L.railways.colour = tone(0.85);
    L.sector.colour = accent; L.windows.colour = accent; L.parcels.colour = muted;
    var K = d.look;
    K.flat_ground = tone(0.10);
    if (night) {
      K.white_ground = tone(0.16); K.white_building = tone(0.30);
    } else { K.white_ground = "#FFFFFF"; K.white_building = "#FFFFFF"; }
    K.white_assumed = rule; K.white_water = rule; K.white_flood = tone(0.10); K.white_line = muted;
    K.contour_colour = tone(0.85); K.wire_colour = muted; K.outline_colour = ink;
    K.tree_crown = row[8]; K.tree_trunk = muted;
    K.depth_ramp = [blue(0.22), blue(0.45), blue(0.72), water, mix(water, ink, 0.4)];
    K.water_ramp = K.depth_ramp.slice();
    K.road_colours = [["Motorway / trunk", ink], ["Primary", tone(0.85)], ["Secondary", muted],
                      ["Tertiary", tone(0.50)], ["Local street", tone(0.50)], ["Service", tone(0.38)],
                      ["Track / path", tone(0.25)]];
    d.cover.hidden_colour = rule; d.cover.boundary_colour = tone(0.85);
    d.water3d.colour = water;
    var C = d.box.cut;
    C.ground_colour = tone(night ? 0.55 : 0.25); C.building_colour = ink; C.hatch_back = paperC; C.line_colour = ink;
    return capture(d, "Chronogram " + row[0], night ? "dark" : "paper");
  }

  function builtin() {
    var list = CHRONOGRAM.map(chronogram);
    return [list[0], paper(), dark(), white()].concat(list.slice(1));
  }

  // The state a new session starts with: the Signal look, side panel in its own file.
  function fresh(state) {
    apply(state, chronogram(CHRONOGRAM[0]));
    state.sheet.panel_export = "separate";
    return state;
  }

  function fileName(theme) {
    var s = String(theme.name || "theme").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return (s || "theme") + ".json";
  }

  POYO.themes = { FORMAT: FORMAT, KEYS: KEYS, capture: capture, apply: apply, check: check,
                  builtin: builtin, fileName: fileName, fresh: fresh };
})();
