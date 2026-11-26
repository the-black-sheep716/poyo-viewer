// export.js: tiled rendering and a streaming PNG writer, so an A0 sheet does not
// need one huge canvas. The PNG holds the picture and its resolution, nothing else.
"use strict";
(function () {
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function chunk(type, data) {
    var out = new Uint8Array(12 + data.length), view = new DataView(out.buffer), i;
    view.setUint32(0, data.length);
    for (i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    var c = 0xffffffff;
    for (i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
    view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
    return out;
  }

  function header(width, height, channels, ppi) {
    var ihdr = new Uint8Array(13), a = new DataView(ihdr.buffer);
    a.setUint32(0, width); a.setUint32(4, height);
    ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
    var phys = new Uint8Array(9), b = new DataView(phys.buffer), ppm = Math.round(ppi / 0.0254);
    b.setUint32(0, ppm); b.setUint32(4, ppm); phys[8] = 1;
    return [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("pHYs", phys)];
  }

  function fileStem(state) {
    var id = (state.sheet.panel_id || "sheet").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "sheet";
    var key = POYO.camera.presetOf(state.view.azimuth, state.view.elevation);
    if (key === "free") key = "az" + Math.round(state.view.azimuth) + "_el" + Math.round(state.view.elevation);
    var paper = state.sheet.paper === "custom"
      ? Math.round(state.sheet.width_mm) + "x" + Math.round(state.sheet.height_mm) + "mm" : state.sheet.paper;
    return [id, key, "scale" + Math.round(state.view.scale), paper, state.sheet.ppi + "ppi"].join("_");
  }

  function annotationLayers(state, blocks) {
    var u = state.sheet.ppi / 25.4;
    return blocks.map(function (b) {
      var x = Math.floor(b.x * u), y = Math.floor(b.y * u);
      var w = Math.ceil((b.x + b.w) * u) - x, h = Math.ceil((b.y + b.h) * u) - y;
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, w); canvas.height = Math.max(1, h);
      var c = canvas.getContext("2d", { willReadFrequently: true });
      c.translate(-x, -y);
      b.draw(c, u);
      var data = c.getImageData(0, 0, canvas.width, canvas.height).data;
      canvas.width = canvas.height = 1;
      return { x: x, y: y, w: Math.max(1, w), h: Math.max(1, h), data: data };
    });
  }

  // Blend the annotation blocks into a band of the page (rows y0 .. y0+rows-1).
  function stamp(band, stride, channels, width, y0, rows, layers) {
    layers.forEach(function (l) {
      var from = Math.max(0, y0 - l.y), to = Math.min(l.h, y0 + rows - l.y);
      for (var j = from; j < to; j++) {
        var row = (l.y + j - y0) * stride + 1;
        for (var i = Math.max(0, -l.x); i < l.w && l.x + i < width; i++) {
          var s = (j * l.w + i) * 4, a = l.data[s + 3];
          if (!a) continue;
          var d = row + (l.x + i) * channels, sa = a / 255, k;
          if (channels === 3) {
            for (k = 0; k < 3; k++) band[d + k] = Math.round(l.data[s + k] * sa + band[d + k] * (1 - sa));
          } else {
            var da = band[d + 3] / 255, oa = sa + da * (1 - sa);
            for (k = 0; k < 3; k++) band[d + k] = Math.round((l.data[s + k] * sa + band[d + k] * da * (1 - sa)) / oa);
            band[d + 3] = Math.round(oa * 255);
          }
        }
      }
    });
  }

  // Clears everything right of x and below y (pixels from the top left of a drawing
  // buffer T pixels tall) in the bound framebuffer.
  function clearOutside(gl, target, T, x, y, clear, wide) {
    var W = wide || T;
    if (x >= W && y >= T) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.enable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    if (x < W) { gl.scissor(Math.max(0, x), 0, W - Math.max(0, x), T); gl.clear(gl.COLOR_BUFFER_BIT); }
    if (y < T) { gl.scissor(0, 0, W, T - Math.max(0, y)); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.disable(gl.SCISSOR_TEST);
  }

  async function deflate(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // The side panel as a picture of its own, at the resolution of the sheet.
  async function panelPicture(state, panel, transparent) {
    var u = state.sheet.ppi / 25.4, channels = transparent ? 4 : 3;
    var W = Math.ceil(panel.w * u), H = Math.ceil(panel.h * u);
    var canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext("2d", { willReadFrequently: true });
    if (!transparent) { c.fillStyle = state.sheet.paper_colour; c.fillRect(0, 0, W, H); }
    panel.blocks.forEach(function (b) { c.save(); b.draw(c, u); c.restore(); });
    var parts = header(W, H, channels, state.sheet.ppi), stride = W * channels + 1, BAND = 512;
    var raw = new Uint8Array(stride * H);
    for (var y0 = 0; y0 < H; y0 += BAND) {
      var rows = Math.min(BAND, H - y0), data = c.getImageData(0, y0, W, rows).data;
      for (var y = 0, s = 0; y < rows; y++) {
        var d = (y0 + y) * stride + 1;
        for (var x = 0; x < W; x++, s += 4, d += channels) {
          raw[d] = data[s]; raw[d + 1] = data[s + 1]; raw[d + 2] = data[s + 2];
          if (channels === 4) raw[d + 3] = data[s + 3];
        }
      }
    }
    canvas.width = canvas.height = 1;
    parts.push(chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0)));
    return { png: new Blob(parts, { type: "image/png" }), width: W, height: H,
             width_mm: +panel.w.toFixed(2), height_mm: +panel.h.toFixed(2) };
  }

  // options: state, manifest, frame, scene, progress(fraction, text), tile
  async function run(options) {
    var state = options.state, scene = options.scene, gl = scene.gl;
    var progress = options.progress || function () {};
    var page = POYO.state.pagePixels(state.sheet), W = page.width, H = page.height;
    var transparent = state.sheet.background === "transparent", channels = transparent ? 4 : 3;
    var mpp = 0.0254 / state.sheet.ppi * state.view.scale;
    var T = Math.min(options.tile || 2048, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    var samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
    var times = { draw: 0, read: 0, compose: 0, compress: 0 }, started = performance.now(), t;

    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    t = performance.now();
    var blocks = POYO.annotate.layout(state, options.manifest, page, scene);
    var layers = annotationLayers(state, blocks);
    // the drawing stays inside its window; the panels get plain paper
    var edge = null;
    if (blocks.window) {
      var perMm = state.sheet.ppi / 25.4;
      edge = { x: Math.round((blocks.window.x + blocks.window.w) * perMm),
               y: Math.round((blocks.window.y + blocks.window.h) * perMm) };
    }
    times.compose += performance.now() - t;

    var objects = [];
    function renderbuffer(format, n) {
      var r = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, r);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, format, T, T);
      objects.push(r);
      return r;
    }
    var draw = gl.createFramebuffer(), resolve = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, draw);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer(gl.RGBA8, samples));
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER,
                               renderbuffer(gl.DEPTH24_STENCIL8, samples));
    var okDraw = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolve);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer(gl.RGBA8, 0));
    var okResolve = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    try {
      if (!okDraw || !okResolve) throw new Error("The graphics card refused the export buffers.");
      var compressor = new CompressionStream("deflate"), writer = compressor.writable.getWriter();
      var parts = header(W, H, channels, state.sheet.ppi), reader = compressor.readable.getReader();
      var failed = null;
      var pump = (async function () {
        for (;;) {
          var piece = await reader.read();
          if (piece.done) break;
          parts.push(new Blob([chunk("IDAT", piece.value)]));
        }
      })().catch(function (e) { failed = e; });

      var pixels = new Uint8Array(T * T * 4), stride = W * channels + 1;
      var previous = new Uint8Array(stride);
      var paper = POYO.hexToRgb(state.sheet.paper_colour);
      var clear = transparent ? [0, 0, 0, 0] : [paper[0], paper[1], paper[2], 1];
      var total = Math.ceil(W / T) * Math.ceil(H / T), done = 0;

      for (var ty = 0; ty < H; ty += T) {
        var rows = Math.min(T, H - ty), band = new Uint8Array(stride * rows);
        for (var tx = 0; tx < W; tx += T) {
          var cols = Math.min(T, W - tx);
          t = performance.now();
          var sx = W / T, sy = H / T;
          var cx = (tx + T / 2) / W * 2 - 1, cy = 1 - (ty + T / 2) / H * 2;
          gl.bindFramebuffer(gl.FRAMEBUFFER, draw);
          gl.viewport(0, 0, T, T);
          scene.render({ state: state, size: { width: W, height: H }, mpp: mpp,
                         tile: [sx, sy, -cx * sx, -cy * sy], pxPerMm: state.sheet.ppi / 25.4,
                         cell: 10, clear: clear });
          if (edge) POYO.exporter.clearOutside(gl, draw, T, edge.x - tx, edge.y - ty, clear);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, draw);
          gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve);
          gl.blitFramebuffer(0, 0, T, T, 0, 0, T, T, gl.COLOR_BUFFER_BIT, gl.NEAREST);
          gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolve);
          times.draw += performance.now() - t;
          t = performance.now();
          gl.readPixels(0, 0, T, T, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          times.read += performance.now() - t;
          t = performance.now();
          for (var y = 0; y < rows; y++) {
            var s = (T - 1 - y) * T * 4, d = y * stride + 1 + tx * channels;
            if (channels === 3) {
              for (var x = 0; x < cols; x++, s += 4, d += 3) {
                band[d] = pixels[s]; band[d + 1] = pixels[s + 1]; band[d + 2] = pixels[s + 2];
              }
            } else {
              for (var i = 0; i < cols; i++, s += 4, d += 4) {
                var a = pixels[s + 3];
                if (!a) continue;
                var f = 255 / a;                          // stored values are premultiplied
                band[d] = Math.min(255, Math.round(pixels[s] * f));
                band[d + 1] = Math.min(255, Math.round(pixels[s + 1] * f));
                band[d + 2] = Math.min(255, Math.round(pixels[s + 2] * f));
                band[d + 3] = a;
              }
            }
          }
          times.compose += performance.now() - t;
          done++;
          progress(0.9 * done / total, "Drawing tile " + done + " of " + total);
          await POYO.nextFrame();
          if (gl.isContextLost()) throw new Error("The graphics context was lost during the export.");
        }
        t = performance.now();
        stamp(band, stride, channels, W, ty, rows, layers);
        // PNG "Up" filter, from the bottom row upwards so each row still sees the original above it
        var last = band.slice((rows - 1) * stride, rows * stride);
        for (var r = rows - 1; r >= 0; r--) {
          var o = r * stride, from = r ? band : previous, p = r ? o - stride : 0;
          band[o] = 2;
          for (var b = 1; b < stride; b++) band[o + b] = band[o + b] - from[p + b];
        }
        previous = last;
        times.compose += performance.now() - t;
        t = performance.now();
        await writer.ready;
        await writer.write(band);
        times.compress += performance.now() - t;
        if (failed) throw failed;
      }
      progress(0.95, "Compressing");
      t = performance.now();
      await writer.close();
      await pump;
      times.compress += performance.now() - t;
      if (failed) throw failed;
      parts.push(chunk("IEND", new Uint8Array(0)));
      var blob = new Blob(parts, { type: "image/png" });
      var stem = fileStem(state);
      var sidecar = POYO.state.toSidecar(state, options.frame, options.manifest, {
        png_file: stem + ".png", tile_px: T, antialias_samples: samples, terrain_cell_m: 10,
        water_and_flood_mask_cell_m: POYO.render.FILL_CELL
      });
      var side = null;
      if (blocks.panel) {
        side = await panelPicture(state, blocks.panel, transparent);
        sidecar.export.panel_file = stem + "_panel.png";
        sidecar.export.panel_size_mm = [side.width_mm, side.height_mm];
        sidecar.export.panel_size_px = [side.width, side.height];
      }
      var seconds = (performance.now() - started) / 1000;
      Object.keys(times).forEach(function (k) { times[k] = +(times[k] / 1000).toFixed(2); });
      progress(1, "Done");
      return { png: blob, sidecar: sidecar, stem: stem, seconds: +seconds.toFixed(2), times: times,
               width: W, height: H, bytes: blob.size, tile: T, samples: samples, panel: side };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(draw); gl.deleteFramebuffer(resolve);
      objects.forEach(function (r) { gl.deleteRenderbuffer(r); });
    }
  }

  // Into the chosen folder when the browser allows it, otherwise as downloads.
  async function save(result, folder) {
    if (result.panel) result.sidecar.export.panel_file = result.stem + "_panel.png";
    var files = [[result.stem + ".png", result.png],
                 [result.stem + ".json", new Blob([JSON.stringify(result.sidecar, null, 2) + "\n"],
                                                  { type: "application/json" })]];
    if (result.panel) files.splice(1, 0, [result.stem + "_panel.png", result.panel.png]);
    if (folder) {
      for (var i = 0; i < files.length; i++) {
        var name = files[i][0], handle = null, n = 1;
        // never overwrite an earlier export
        for (;;) {
          var candidate = n === 1 ? name : name.replace(/(\.\w+)$/, "_" + n + "$1");
          try { await folder.getFileHandle(candidate); n++; }
          catch (e) {
            if (e.name !== "NotFoundError") throw e;
            handle = await folder.getFileHandle(candidate, { create: true });
            break;
          }
        }
        var stream = await handle.createWritable();
        await stream.write(files[i][1]);
        await stream.close();
      }
      return "Saved to the folder “" + folder.name + "”.";
    }
    for (var j = 0; j < files.length; j++) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(files[j][1]);
      a.download = files[j][0];
      document.body.appendChild(a); a.click(); a.remove();
      (function (url) { setTimeout(function () { URL.revokeObjectURL(url); }, 60000); })(a.href);
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    return "Sent to the browser downloads (" + (result.panel ? "drawing, side panel" : "picture") + " and sidecar).";
  }

  POYO.exporter = { run: run, save: save, fileStem: fileStem, clearOutside: clearOutside };
})();
