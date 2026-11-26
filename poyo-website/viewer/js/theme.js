// theme.js: a theme is a small JSON file holding colours, line weights and render
// styles. Loading one never touches the camera, the section box, which layers are
// on, the flood product, the paper size or the building heights.
"use strict";
(function () {
  var ID = POYO.ID;
  var FORMAT = "poyo-theme-1";

  // What a theme may set. Anything else in a file is ignored and reported.
  var KEYS = {
    sheet: ["paper_colour", "ink", "body_ink", "muted_ink"],
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
                "look.contour_base": ["paper", "ramp", "shaded", "none"], "look.trees": POYO.state.STYLES };
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

  function builtin() { return [paper(), dark(), white()]; }

  function fileName(theme) {
    var s = String(theme.name || "theme").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return (s || "theme") + ".json";
  }

  POYO.themes = { FORMAT: FORMAT, KEYS: KEYS, capture: capture, apply: apply, check: check,
                  builtin: builtin, fileName: fileName };
})();
