// loader.js: reads the data folder. Opened from a folder (file://) it adds script
// tags for the .js copies. Served over http it fetches the .bin.gz files.
"use strict";
(function () {
  var DATA = "../data/";
  var pending = {};          // name -> base64 text delivered by a data script

  POYO.chunk = function (name, text) { pending[name] = text; };

  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { s.remove(); resolve(); };
      s.onerror = function () { s.remove(); reject(new Error("Could not read " + src)); };
      document.head.appendChild(s);
    });
  }

  function fromBase64(text) {
    if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(text);
    var bin = atob(text), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function gunzip(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }

  var TYPES = { i2: Int16Array, u1: Uint8Array, u4: Uint32Array, i4: Int32Array,
                f4: Float32Array, f8: Float64Array };

  function parseChunk(buffer, name) {
    var head = new Uint8Array(buffer, 0, 4);
    if (String.fromCharCode.apply(null, head) !== "PYC1") throw new Error(name + " is not a data chunk.");
    var length = new DataView(buffer).getUint32(4, true);
    var header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
    var base = 8 + length, arrays = {};
    header.arrays.forEach(function (a) {
      var T = TYPES[a.type];
      if (!T) throw new Error("Unknown array type " + a.type + " in " + name);
      var count = a.bytes / T.BYTES_PER_ELEMENT;
      arrays[a.name] = new T(buffer, base + a.off, count);
      arrays[a.name].shape = a.shape;
    });
    return { meta: header.meta, arrays: arrays };
  }

  POYO.loader = {
    mode: location.protocol.indexOf("http") === 0 ? "fetch" : "script",

    manifest: async function () {
      if (this.mode === "fetch") {
        try {
          var r = await fetch(DATA + "manifest.json", { cache: "no-cache" });
          if (r.ok) return r.json();
        } catch (e) { /* fall through to the script copy */ }
        this.mode = "script";
      }
      await script(DATA + "manifest.js");
      if (!POYO.manifest) throw new Error("manifest.js did not define the manifest.");
      return POYO.manifest;
    },

    chunk: async function (name) {
      var bytes = null;
      if (this.mode === "fetch") {
        try {
          var r = await fetch(DATA + name + ".bin.gz", { cache: "no-cache" });
          if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
        } catch (e) { bytes = null; }
      }
      if (!bytes) {
        await script(DATA + name + ".js");
        if (pending[name] === undefined) throw new Error(name + ".js did not deliver its data.");
        bytes = fromBase64(pending[name]);
        delete pending[name];
      }
      // a server may already have removed the gzip layer
      var buffer = (bytes[0] === 0x1f && bytes[1] === 0x8b)
        ? await gunzip(bytes) : bytes.slice().buffer;
      return parseChunk(buffer, name);
    }
  };
})();
