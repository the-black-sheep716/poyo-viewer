// Poyo basin viewer. Classic scripts only, so the viewer opens from a folder.
// core.js: namespace, constants and small helpers. Loaded first.
"use strict";
var POYO = window.POYO || {};
window.POYO = POYO;

POYO.APP_VERSION = "final.1";
POYO.CRS = "EPSG:25830";
POYO.DEG = Math.PI / 180;

// Neutrals, water and flood depth ramp of the Poyo Riverscape identity.
POYO.ID = {
  ink: "#0B0B0B", graphite: "#2D2D2D", slate: "#686863", stone: "#B4B4AF",
  line: "#D9D9D4", paper: "#F7F7F5", water: "#0091B9",
  floodRamp: ["#BCF0DF", "#5DD0C3", "#00A4A8", "#007496", "#004671"],
  yellow: "#F5B700", magenta: "#E6007E"
};

// "Paper and Water" identity: land use muted, water in its own blues, one story
// colour per map (storm: what happened, action: proposals, system: governance and time).
POYO.STORM = {
  paper: "#F4F1EA", white: "#FBFAF6", ink: "#2A2925", muted: "#5C5850", rule: "#8A8478", hairline: "#BDB6A6",
  waterDeep: "#2B6680", water: "#5E9BB3", waterLight: "#A9CBD8", sea: "#D3E4E8",
  storm: "#45525C", stormLight: "#C4CBCF", action: "#A84B27", actionLight: "#EBC3AE",
  system: "#66466A", systemLight: "#D9C8D8",
  forest: "#8C9B6A", secano: "#DDCFA3", huerta: "#B9C49A", wetland: "#C3DAD3",
  urban: "#CFC8BB", building: "#8F887C", industrial: "#B9B2A6"
};

POYO.PAPERS = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };

POYO.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

POYO.hexToRgb = function (hex) {
  var h = String(hex).replace("#", "");
  return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255,
          parseInt(h.substr(4, 2), 16) / 255];
};

POYO.fmtInt = function (n) { return Math.round(n).toLocaleString("en-US"); };
POYO.fmt = function (n, d) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

POYO.deepCopy = function (o) { return JSON.parse(JSON.stringify(o)); };

// Copy values of src into dst, keeping only keys that dst already has and the same kind.
POYO.mergeKnown = function (dst, src) {
  if (!src || typeof src !== "object") return dst;
  Object.keys(dst).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) return;
    var a = dst[k], b = src[k];
    if (a && typeof a === "object" && !Array.isArray(a)) POYO.mergeKnown(a, b);
    else if (Array.isArray(a) && Array.isArray(b)) dst[k] = POYO.deepCopy(b);
    else if (a === null || typeof a === typeof b) dst[k] = b;
  });
  return dst;
};

POYO.nextFrame = function () {
  return new Promise(function (resolve) {
    // setTimeout keeps working in a background tab, requestAnimationFrame does not
    setTimeout(resolve, 0);
  });
};
