(function () {
  "use strict";

  var btn = document.getElementById("btn-stress");
  var devicesSel = document.getElementById("s-devices");
  var photosSel = document.getElementById("s-photos");
  var summary = document.getElementById("s-summary");
  var log = document.getElementById("s-log");

  var BASE_DELAY = 2000;
  var MAX_DELAY = 30000;
  var MAX_ATTEMPTS = 6;
  var PERMANENT = ["UNSUPPORTED_TYPE", "FILE_TOO_LARGE", "EMPTY_FILE", "INVALID_DATA",
                   "INVALID_UPLOAD_ID", "MISSING_DATA", "CONFLICT"];

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function addLog(text) {
    var li = document.createElement("li");
    li.textContent = text;
    log.insertBefore(li, log.firstChild);
    while (log.children.length > 200) { log.removeChild(log.lastChild); }
  }

  // Foto sintética con ruido (≈1–2 MB) para simular un tamaño real
  function makePhoto() {
    return new Promise(function (resolve, reject) {
      var c = document.createElement("canvas");
      c.width = 1600;
      c.height = 1200;
      var ctx = c.getContext("2d");
      var img = ctx.createImageData(c.width, c.height);
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        d[i] = Math.random() * 255;
        d[i + 1] = Math.random() * 255;
        d[i + 2] = Math.random() * 255;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      c.toBlob(function (blob) {
        if (!blob) { reject(new Error("toBlob")); return; }
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result || "");
          resolve({ b64: s.slice(s.indexOf(",") + 1), size: blob.size });
        };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.8);
    });
  }

  function backoff(attempt) {
    var base = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt - 1));
    return base + Math.floor(Math.random() * Math.min(5000, base * 0.5));
  }

  // Un «teléfono» virtual: sube sus fotos de una en una, con reintentos
  function runDevice(n, photos, photo, stats) {
    var chain = Promise.resolve();
    for (var p = 1; p <= photos; p++) {
      (function (pIndex) {
        chain = chain.then(function () {
          var id = uuid();
          var started = Date.now();
          var attempt = 0;

          function tryOnce() {
            attempt++;
            return Api.post({
              action: "upload",
              uploadId: id,
              filename: "stress-" + n + "-" + pIndex + ".jpg",
              deviceId: "test-api",
              data: photo.b64
            }, 120000).then(function (r) {
              var d = r.data || {};
              if (r.ok && d.ok === true && d.uploadId === id && d.fileId) {
                var ms = Date.now() - started;
                stats.ok++;
                stats.times.push(ms);
                if (attempt > 1) { stats.retried++; }
                if (d.duplicate) { stats.dup++; }
                addLog("✅ Tel " + n + " · foto " + pIndex + " · " + (ms / 1000).toFixed(1) +
                       " s · intento " + attempt + (d.duplicate ? " · ya existía" : ""));
                return;
              }
              var code = d.error || r.error || ("HTTP " + r.status);
              stats.errors[code] = (stats.errors[code] || 0) + 1;
              if (PERMANENT.indexOf(code) !== -1 || attempt >= MAX_ATTEMPTS) {
                stats.fail++;
                addLog("❌ Tel " + n + " · foto " + pIndex + " · " + code + " · intento " + attempt);
                return;
              }
              var delay = backoff(attempt);
              addLog("↻ Tel " + n + " · foto " + pIndex + " · " + code + " · reintento en " +
                     (delay / 1000).toFixed(1) + " s");
              return wait(delay).then(tryOnce);
            });
          }
          return tryOnce();
        });
      })(p);
    }
    return chain;
  }

  function percentile(arr, q) {
    if (!arr.length) { return 0; }
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  }

  function run() {
    var devices = parseInt(devicesSel.value, 10);
    var photos = parseInt(photosSel.value, 10);
    btn.disabled = true;
    while (log.firstChild) { log.removeChild(log.firstChild); }
    summary.textContent = "Generando foto de prueba…";

    makePhoto().then(function (photo) {
      var stats = { ok: 0, fail: 0, retried: 0, dup: 0, times: [], errors: {} };
      var total = devices * photos;
      var t0 = Date.now();
      summary.textContent = "Subiendo " + total + " fotos desde " + devices + " teléfonos simulados (" +
                            (photo.size / 1048576).toFixed(1) + " MB cada una)…";

      var all = [];
      for (var n = 1; n <= devices; n++) {
        // Arranque escalonado 0–2 s, como invitados reales
        (function (num) {
          all.push(wait(Math.random() * 2000).then(function () {
            return runDevice(num, photos, photo, stats);
          }));
        })(n);
      }

      return Promise.all(all).then(function () {
        var secsTotal = ((Date.now() - t0) / 1000).toFixed(0);
        var errs = Object.keys(stats.errors).map(function (k) {
          return k + " ×" + stats.errors[k];
        }).join(", ") || "ninguno";
        summary.textContent =
          "✅ " + stats.ok + " de " + total + " subidas · ❌ " + stats.fail + " fallidas · " +
          stats.retried + " necesitaron reintento · total " + secsTotal + " s · " +
          "mediana " + (percentile(stats.times, 0.5) / 1000).toFixed(1) + " s · " +
          "p90 " + (percentile(stats.times, 0.9) / 1000).toFixed(1) + " s · " +
          "errores transitorios: " + errs;
      });
    }).catch(function (err) {
      summary.textContent = "Error: " + (err && err.message ? err.message : String(err));
    }).then(function () {
      btn.disabled = false;
    });
  }

  btn.addEventListener("click", run);
})();
