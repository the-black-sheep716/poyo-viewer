// views.js: saved views. Each one is a complete sidecar (camera, section box, theme
// and layer states), so a view and an export are reproducible in the same way.
// The list is kept in the browser and can be saved to and loaded from a file.
"use strict";
(function () {
  var FORMAT = "poyo-views-1", STORE = "poyo_views_v1";

  // Browser storage can be missing or refuse to write. The list then lives in memory.
  function read(key) {
    try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch (e) { return null; }
  }
  function write(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  function valid(v) {
    return !!(v && typeof v.name === "string" && v.sidecar && POYO.state.schemaOf(v.sidecar));
  }

  function List() {
    var kept = read(STORE);
    this.views = kept && kept.format === FORMAT && Array.isArray(kept.views) ? kept.views.filter(valid) : [];
    this.stored = true;
  }
  List.prototype.keep = function () { this.stored = write(STORE, this.toJSON()); };
  List.prototype.toJSON = function () { return { format: FORMAT, views: this.views }; };

  // A name not yet taken, so every view can be told apart in files.
  List.prototype.free = function (name, except) {
    var base = String(name || "").trim() || "View " + (this.views.length + 1), out = base, n = 1, self = this;
    while (self.views.some(function (v, i) { return i !== except && v.name === out; })) out = base + " " + (++n);
    return out;
  };

  function snapshot(app) {
    return POYO.state.toSidecar(app.state, app.frame, app.manifest, null);
  }
  List.prototype.add = function (app, name) {
    this.views.push({ name: this.free(name || POYO.camera.viewName(app.state.view)), sidecar: snapshot(app) });
    this.keep();
    return this.views.length - 1;
  };
  List.prototype.update = function (app, i) {
    if (!this.views[i]) return;
    this.views[i].sidecar = snapshot(app);
    this.keep();
  };
  List.prototype.rename = function (i, name) {
    if (!this.views[i]) return;
    this.views[i].name = this.free(name, i);
    this.keep();
  };
  List.prototype.remove = function (i) {
    this.views.splice(i, 1);
    this.keep();
  };
  List.prototype.move = function (i, dir) {
    var j = i + dir;
    if (!this.views[i] || j < 0 || j >= this.views.length) return;
    var v = this.views.splice(i, 1)[0];
    this.views.splice(j, 0, v);
    this.keep();
  };
  // Views from a file are added after the ones already listed.
  List.prototype.load = function (json) {
    if (!json || json.format !== FORMAT || !Array.isArray(json.views)) {
      throw new Error("This is not a saved views file.");
    }
    var self = this, added = 0, skipped = 0;
    json.views.forEach(function (v) {
      if (!valid(v)) { skipped++; return; }
      var same = self.views.some(function (o) {
        return o.name === v.name && JSON.stringify(o.sidecar) === JSON.stringify(v.sidecar);
      });
      if (same) return;
      self.views.push({ name: self.free(v.name), sidecar: v.sidecar });
      added++;
    });
    this.keep();
    return { added: added, skipped: skipped };
  };

  function slug(name) {
    return String(name).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "view";
  }

  // Export every view in turn, then put the screen back as it was.
  // save(result) writes one picture and its sidecar.
  async function exportAll(app, list, progress, save) {
    var before = app.state, done = [], failed = [];
    try {
      for (var i = 0; i < list.views.length; i++) {
        var v = list.views[i];
        try {
          app.state = POYO.state.fromSidecar(v.sidecar, app.frame);
          var result = await app.renderExport(function (f, t) {
            progress((i + f) / list.views.length, "View " + (i + 1) + " of " + list.views.length + ", " + v.name + ". " + t);
          });
          result.stem = result.stem + "_" + slug(v.name);
          result.sidecar.export.png_file = result.stem + ".png";
          await save(result);
          done.push({ name: v.name, stem: result.stem, seconds: result.seconds, bytes: result.bytes });
        } catch (e) {
          console.error(e);
          failed.push(v.name + ": " + e.message);
        }
        app.state = before;
      }
    } finally {
      app.state = before;
      app.requestRender();
    }
    return { done: done, failed: failed };
  }

  POYO.views = { FORMAT: FORMAT, STORE: STORE, List: List, exportAll: exportAll, slug: slug, read: read, write: write };
})();
