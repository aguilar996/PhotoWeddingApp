(function () {
  "use strict";

  var btn = document.getElementById("btn-run");
  var list = document.getElementById("results");
  var summary = document.getElementById("summary");
  var env = document.getElementById("env");
  var state = {};

  env.textContent = "Origen: " + location.origin + " · En línea: " +
                    (navigator.onLine ? "sí" : "no") + " · " + navigator.userAgent;

  function bigString(bytes) {
    return new Array(bytes + 1).join("a");
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (x) {
      return ("0" + x.toString(16)).slice(-2);
    }).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
           hex.slice(16, 20) + "-" + hex.slice(20);
  }

  // Genera una JPEG real diminuta (32×32) en Base64
  function makeJpegBase64() {
    return new Promise(function (resolve, reject) {
      var c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      var ctx = c.getContext("2d");
      ctx.fillStyle = "hsl(" + Math.floor(Math.random() * 360) + ",40%,60%)";
      ctx.fillRect(0, 0, 32, 32);
      c.toBlob(function (blob) {
        if (!blob) { reject(new Error("toBlob")); return; }
        var reader = new FileReader();
        reader.onload = function () {
          var s = String(reader.result || "");
          resolve(s.slice(s.indexOf(",") + 1));
        };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(blob);
      }, "image/jpeg", 0.9);
    });
  }

  function uploadBody(id, b64) {
    return { action: "upload", uploadId: id, filename: "prueba-idempotencia.jpg",
             deviceId: "test-api", data: b64 };
  }

  // Reintenta mientras el servidor diga IN_PROGRESS
  function retryUntilDone(body, left) {
    return Api.post(body, 60000).then(function (r) {
      if (r.data && r.data.error === "IN_PROGRESS" && left > 0) {
        return wait(8000).then(function () { return retryUntilDone(body, left - 1); });
      }
      return r;
    });
  }

  var tests = [
    {
      name: "1 · GET ping",
      run: function () { return Api.get({ action: "ping" }); },
      check: function (r) { return r.ok && r.data.ok === true && r.data.action === "ping"; }
    },
    {
      name: "2 · POST text/plain",
      run: function () { return Api.post({ action: "ping", message: "hola desde el teléfono" }); },
      check: function (r) { return r.ok && r.data.ok === true && r.data.echo === "hola desde el teléfono"; }
    },
    {
      name: "3 · POST grande (1 MB)",
      run: function () { return Api.post({ action: "ping", message: bigString(1024 * 1024) }, 90000); },
      check: function (r) { return r.ok && r.data.error === "PAYLOAD_TOO_LARGE"; }
    },
    {
      name: "4 · Acción desconocida",
      run: function () { return Api.post({ action: "nada" }); },
      check: function (r) { return r.ok && r.data.error === "UNKNOWN_ACTION"; }
    },
    {
      name: "5 · POST application/json (debe bloquearse)",
      run: function () {
        return Api.raw("POST", { body: { action: "ping" }, contentType: "application/json" });
      },
      check: function (r) { return !r.ok && r.status === 0; }
    },
    {
      name: "6 · Subida nueva",
      run: function () {
        return makeJpegBase64().then(function (b64) {
          state.id1 = uuid();
          state.b64 = b64;
          return Api.post(uploadBody(state.id1, b64), 60000);
        }).then(function (r) {
          state.file1 = r.data ? r.data.fileId : "";
          return r;
        });
      },
      check: function (r) {
        return r.ok && r.data.ok === true && r.data.duplicate === false && !!r.data.fileId;
      }
    },
    {
      name: "7 · Mismo uploadId otra vez (no debe duplicar)",
      run: function () { return Api.post(uploadBody(state.id1, state.b64), 60000); },
      check: function (r) {
        return r.ok && r.data.ok === true && r.data.duplicate === true &&
               r.data.fileId === state.file1;
      }
    },
    {
      name: "8 · Respuesta perdida + reintento",
      run: function () {
        var id2 = uuid();
        var body;
        var firstNote = "";
        return makeJpegBase64().then(function (b64) {
          body = uploadBody(id2, b64);
          return Api.raw("POST", { body: body, timeoutMs: 400 });
        }).then(function (first) {
          firstNote = "1.er intento: " + (first.error || ("HTTP " + first.status));
          return wait(12000);
        }).then(function () {
          return retryUntilDone(body, 4);
        }).then(function (r) {
          r.note = firstNote;
          return Api.get({ action: "lookup", uploadId: id2 }).then(function (l) {
            r.lookup = l.data;
            return r;
          });
        });
      },
      check: function (r) {
        return r.ok && r.data.ok === true && !!r.lookup && r.lookup.rows === 1 &&
               r.lookup.driveFiles <= 1;
      }
    },
    {
      name: "9 · Archivo que no es foto (debe rechazarse)",
      run: function () { return Api.post(uploadBody(uuid(), btoa("esto no es una foto"))); },
      check: function (r) { return r.ok && r.data.error === "UNSUPPORTED_TYPE"; }
    }
  ];

  function describe(r) {
    var parts = ["HTTP " + r.status, r.ms + " ms"];
    if (r.data) {
      if (r.data.error) { parts.push("error: " + r.data.error); }
      if (r.data.version) { parts.push("versión: " + r.data.version); }
      if (r.data.echo) { parts.push("eco: " + r.data.echo); }
      if (typeof r.data.duplicate === "boolean") {
        parts.push("duplicado: " + (r.data.duplicate ? "sí" : "no"));
      }
      if (r.data.fileId) { parts.push("fileId " + String(r.data.fileId).slice(0, 6) + "…"); }
    }
    if (r.note) { parts.push(r.note); }
    if (r.lookup) {
      parts.push("filas en hoja: " + r.lookup.rows + " · archivos en Drive: " + r.lookup.driveFiles);
    }
    if (r.error) { parts.push(r.error); }
    return parts.join(" · ");
  }

  function addRow(name, passed, detail) {
    var li = document.createElement("li");
    var icon = document.createElement("span");
    var text = document.createElement("span");
    icon.textContent = passed ? "✅" : "❌";
    text.textContent = name + " — " + detail;
    li.appendChild(icon);
    li.appendChild(text);
    list.appendChild(li);
  }

  function runAll() {
    btn.disabled = true;
    state = {};
    while (list.firstChild) { list.removeChild(list.firstChild); }
    summary.textContent = "Ejecutando pruebas… (unos 30–60 s)";
    var passedCount = 0;

    tests.reduce(function (chain, test) {
      return chain.then(function () {
        return test.run().then(function (r) {
          var passed = false;
          try { passed = !!test.check(r); } catch (e) { passed = false; }
          if (passed) { passedCount++; }
          addRow(test.name, passed, describe(r));
        }, function (err) {
          addRow(test.name, false, "excepción: " + (err && err.message ? err.message : String(err)));
        });
      });
    }, Promise.resolve()).then(function () {
      summary.textContent = passedCount + " de " + tests.length + " pruebas correctas.";
      btn.disabled = false;
    });
  }

  btn.addEventListener("click", runAll);
})();
