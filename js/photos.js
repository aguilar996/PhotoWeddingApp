(function () {
  "use strict";

  var MAX_BYTES = 6 * 1024 * 1024;   // 6 MB
  var MAX_ITEMS = 100;
  var ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
  var UPLOAD_TIMEOUT_MS = 120000;
  var REMOVE_DELAY_MS = 1200;
  var BASE_DELAY_MS = 2000;
  var MAX_DELAY_MS = 60000;
  var MAX_AUTO_ATTEMPTS = 8;
  var PERMANENT = ["UNSUPPORTED_TYPE", "FILE_TOO_LARGE", "EMPTY_FILE", "INVALID_DATA",
                   "INVALID_UPLOAD_ID", "MISSING_DATA", "CONFLICT", "NO_LOCAL_DATA"];
  var ACTIVE = ["En espera", "Subiendo", "Reintentar"];

  var input = document.getElementById("file-input");
  var tray = document.getElementById("tray");
  var trayEmpty = document.getElementById("tray-empty");
  var trayCount = document.getElementById("tray-count");
  var statusEl = document.getElementById("picker-status");
  var uploadBtn = document.getElementById("btn-upload");
  var uploadStatus = document.getElementById("upload-status");
  var netStatus = document.getElementById("net-status");
  var progress = document.getElementById("progress");
  var progressBar = document.getElementById("progress-bar");
  var diagFiles = document.getElementById("diag-files");
  var diagUploads = document.getElementById("diag-uploads");
  var diagStorage = document.getElementById("diag-storage");

  var items = [];
  var metaEls = {};
  var busy = false;
  var running = false;
  var timer = null;
  var progTimer = null;
  var batchDone = 0;
  var rateBps = 250000;              // velocidad estimada (bytes/s), se ajusta sola
  var persistent = true;
  var persistGranted = null;
  var ready;

  /* ---------- Utilidades ---------- */

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function setUploadStatus(message, isError) {
    uploadStatus.textContent = message || "";
    uploadStatus.classList.toggle("is-error", !!isError);
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

  function deviceId() {
    try {
      var id = localStorage.getItem("ngd-device-id");
      if (!id) {
        id = uuid();
        localStorage.setItem("ngd-device-id", id);
      }
      return id;
    } catch (e) {
      return "sin-id";
    }
  }

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) { return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"; }
    if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function secs(ms) {
    if (typeof ms !== "number" || isNaN(ms)) { return "?"; }
    return (ms / 1000).toFixed(1) + " s";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function timestamp(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function readBuffer(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(blob);
    });
  }

  function readBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || "");
        var comma = s.indexOf(",");
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function readHead(blob) {
    return readBuffer(blob.slice(0, 16)).then(function (buf) { return new Uint8Array(buf); });
  }

  function ascii(bytes, start, end) {
    var s = "";
    for (var i = start; i < end && i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
    return s;
  }

  function detectType(b) {
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) { return "image/jpeg"; }
    if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") { return "image/png"; }
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") { return "image/webp"; }
    if (ascii(b, 4, 8) === "ftyp") {
      var brand = ascii(b, 8, 12);
      if (brand === "avif" || brand === "avis") { return "image/avif"; }
      if (HEIF_BRANDS.indexOf(brand) !== -1) { return "image/heic"; }
    }
    return "";
  }

  function safeFilename(original, ext, source) {
    var base = String(original || "").split(/[\\/]/).pop();
    base = base.replace(/\.[^.]*$/, "");
    base = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
    if (!base) { base = (source === "camera" ? "camara-" : "foto-") + timestamp(new Date()); }
    return base + "." + ext;
  }

  function addLog(listEl, text) {
    if (!listEl) { return; }
    var li = document.createElement("li");
    li.textContent = text;
    listEl.insertBefore(li, listEl.firstChild);
    while (listEl.children.length > 30) { listEl.removeChild(listEl.lastChild); }
  }

  function logDiag(name, declared, detected, size, result) {
    addLog(diagFiles, result + " " + (name || "(cámara)") +
      " · declarado: " + (declared || "vacío") +
      " · real: " + (detected || "desconocido") +
      " · " + formatSize(size));
  }

  function updateStorage() {
    if (!diagStorage) { return; }
    var base = (persistent ? "✅ IndexedDB activo" : "❌ IndexedDB no disponible") +
               " — " + items.length + " en cola";
    var persistText = persistGranted === null ? "" :
      (persistGranted ? " · almacenamiento persistente: sí" : " · almacenamiento persistente: no");
    if (!persistent || !window.PhotoQueue) {
      diagStorage.textContent = base;
      return;
    }
    window.PhotoQueue.estimate().then(function (e) {
      var extra = (e && e.quota) ? " · uso " + formatSize(e.usage || 0) + " de " + formatSize(e.quota) : "";
      diagStorage.textContent = base + extra + persistText;
    });
  }

  /* ---------- Modelo en memoria ---------- */

  function toItem(record, blob) {
    return {
      uploadId: record.uploadId,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
      createdAt: record.createdAt,
      status: record.status,
      attempts: record.attempts || 0,
      progress: record.progress || 0,
      nextAttemptAt: record.nextAttemptAt || 0,
      permanent: !!record.permanent,
      lastError: record.lastError || "",
      source: record.source,
      url: URL.createObjectURL(blob)
    };
  }

  function findItem(uploadId) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].uploadId === uploadId) { return items[i]; }
    }
    return null;
  }

  function dropFromMemory(uploadId) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].uploadId === uploadId) {
        URL.revokeObjectURL(items[i].url);
        items.splice(i, 1);
        return;
      }
    }
  }

  function count(statuses) {
    var n = 0;
    items.forEach(function (it) { if (statuses.indexOf(it.status) !== -1) { n++; } });
    return n;
  }

  function setItemStatus(item, status, changes) {
    item.status = status;
    var update = { status: status };
    if (changes) {
      Object.keys(changes).forEach(function (k) {
        item[k] = changes[k];
        update[k] = changes[k];
      });
    }
    render();
    if (!persistent) { return Promise.resolve(); }
    return window.PhotoQueue.update(item.uploadId, update).catch(function (err) {
      console.error("No se pudo actualizar el estado:", err);
    });
  }

  /* ---------- Añadir y eliminar ---------- */

  function saveError(err) {
    if (err && err.name === "QuotaExceededError") {
      return "No queda espacio en el teléfono para guardar más fotos. Elimina algunas e inténtalo de nuevo.";
    }
    return "No se pudo guardar la foto en el teléfono. Inténtalo de nuevo.";
  }

  function addBlob(blob, source, originalName) {
    return ready.then(function () {
      if (items.length >= MAX_ITEMS) {
        return "Has alcanzado el máximo de " + MAX_ITEMS + " fotos en espera.";
      }
      if (!blob || !blob.size) {
        return "El archivo está vacío.";
      }

      return readHead(blob).then(function (head) {
        var detected = detectType(head);

        if (detected === "image/heic" || detected === "image/avif") {
          logDiag(originalName, blob.type, detected, blob.size, "❌");
          return "Esta foto está en formato HEIC. Elígela desde «Fototeca» en lugar de «Archivos», o configura la cámara en «Más compatible».";
        }
        if (!ALLOWED[detected]) {
          logDiag(originalName, blob.type, detected, blob.size, "❌");
          return "Formato no compatible. Usa fotos JPEG, PNG o WebP.";
        }
        if (blob.size > MAX_BYTES) {
          logDiag(originalName, blob.type, detected, blob.size, "❌");
          return "La foto supera el máximo de 6 MB (" + formatSize(blob.size) + ").";
        }

        return readBuffer(blob).then(function (buffer) {
          var now = new Date().toISOString();
          var record = {
            uploadId: uuid(),
            data: buffer,
            filename: safeFilename(originalName, ALLOWED[detected], source),
            mimeType: detected,
            size: blob.size,
            createdAt: now,
            updatedAt: now,
            status: "En espera",
            attempts: 0,
            progress: 0,
            nextAttemptAt: 0,
            permanent: false,
            lastError: "",
            source: source
          };

          var save = persistent ? window.PhotoQueue.put(record) : Promise.resolve();
          return save.then(function () {
            items.push(toItem(record, blob));
            logDiag(originalName, blob.type, detected, blob.size, "✅");
            render();
            updateStorage();
            pump();
            return null;
          }, function (err) {
            console.error("Error IndexedDB:", err);
            logDiag(originalName, blob.type, detected, blob.size, "❌ (guardado)");
            return saveError(err);
          });
        });
      });
    }).catch(function (err) {
      console.error("Error al leer:", err);
      return "No se pudo leer el archivo.";
    });
  }

  function removeItem(uploadId) {
    var item = findItem(uploadId);
    if (item && (item.status === "Subiendo" || item.status === "Subida")) { return; }
    var del = persistent ? window.PhotoQueue.remove(uploadId) : Promise.resolve();
    del.then(function () {
      dropFromMemory(uploadId);
      setStatus("", false);
      render();
      updateStorage();
    }, function () {
      setStatus("No se pudo eliminar la foto. Inténtalo de nuevo.", true);
    });
  }

  // Solo se llama tras confirmación del servidor (mismo uploadId + fileId)
  function finalizeUploaded(uploadId) {
    return wait(REMOVE_DELAY_MS).then(function () {
      return window.PhotoQueue.remove(uploadId);
    }).then(function () {
      dropFromMemory(uploadId);
      render();
      updateStorage();
    }, function (err) {
      // Queda marcada como «Subida»; se limpiará al volver a abrir la página
      console.error("No se pudo limpiar la foto subida:", err);
    });
  }

  /* ---------- Interfaz ---------- */

  function labelFor(item) {
    var text = item.status;
    if (item.status === "Subiendo") { text = "Subiendo " + (item.progress || 0) + " %"; }
    return text + " · " + formatSize(item.size);
  }

  function updateProgress() {
    var active = count(ACTIVE);
    if (!running && active === 0) {
      progress.hidden = true;
      progressBar.style.width = "0%";
      return;
    }
    var total = batchDone + active;
    var current = 0;
    items.forEach(function (it) {
      if (it.status === "Subiendo") { current = (it.progress || 0) / 100; }
    });
    var pct = total ? Math.round(((batchDone + current) / total) * 100) : 0;
    progress.hidden = false;
    progressBar.style.width = pct + "%";
    progress.setAttribute("aria-valuenow", String(pct));
  }

  function render() {
    while (tray.firstChild) { tray.removeChild(tray.firstChild); }
    metaEls = {};

    items.forEach(function (item, index) {
      var li = document.createElement("li");
      li.className = "thumb";
      li.classList.toggle("is-uploading", item.status === "Subiendo");
      li.classList.toggle("is-error", item.status === "Error");

      var img = document.createElement("img");
      img.src = item.url;
      img.alt = "Foto " + (index + 1);
      img.decoding = "async";

      var meta = document.createElement("span");
      meta.className = "thumb-meta";
      meta.textContent = labelFor(item);
      metaEls[item.uploadId] = meta;

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "thumb-remove";
      btn.setAttribute("aria-label", "Eliminar foto " + (index + 1));
      btn.textContent = "×";
      btn.disabled = item.status === "Subiendo" || item.status === "Subida";
      btn.addEventListener("click", function () { removeItem(item.uploadId); });

      li.appendChild(img);
      li.appendChild(meta);
      li.appendChild(btn);

      if (item.status === "Error") {
        var retry = document.createElement("button");
        retry.type = "button";
        retry.className = "thumb-retry";
        retry.setAttribute("aria-label", "Reintentar foto " + (index + 1));
        retry.title = item.lastError || "Reintentar";
        retry.textContent = "↻";
        retry.addEventListener("click", function () { retryItem(item.uploadId); });
        li.appendChild(retry);
      }

      tray.appendChild(li);
    });

    var n = items.length;
    trayCount.textContent = n === 1 ? "1 foto" : n + " fotos";
    trayEmpty.hidden = n > 0;

    var errors = count(["Error"]);
    var retrying = count(["Reintentar"]);
    var waiting = count(["En espera"]);
    if (running) {
      uploadBtn.hidden = false;
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Subiendo…";
    } else if (errors || retrying) {
      uploadBtn.hidden = false;
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Reintentar ahora";
    } else if (waiting) {
      uploadBtn.hidden = false;
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Subir ahora";
    } else {
      uploadBtn.hidden = true;
    }

    updateProgress();
  }

  function showNet(online) {
    netStatus.hidden = online;
    if (!online) {
      netStatus.textContent = "Sin conexión. Tus fotos están guardadas en este teléfono y se subirán solas cuando vuelva la conexión.";
    }
  }

  /* ---------- Progreso estimado ---------- */

  function stopEstimate() {
    if (progTimer) { clearInterval(progTimer); }
    progTimer = null;
  }

  function startEstimate(item) {
    stopEstimate();
    var t0 = Date.now();
    var expected = 3000 + (item.size * 1.37 / rateBps) * 1000;
    progTimer = setInterval(function () {
      var f = Math.min(0.92, (Date.now() - t0) / expected);
      item.progress = Math.round(f * 100);
      var m = metaEls[item.uploadId];
      if (m) { m.textContent = labelFor(item); }
      updateProgress();
    }, 300);
  }

  /* ---------- Subida ---------- */

  function backoff(attempt) {
    var base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, attempt - 1));
    var jitter = Math.floor(Math.random() * Math.min(5000, base * 0.5));
    return base + jitter;
  }

  function handleFailure(item, attempts, code, totalMs) {
    var permanent = PERMANENT.indexOf(code) !== -1;

    if (!permanent && navigator.onLine === false) {
      addLog(diagUploads, "⏸ " + item.filename + " · sin conexión · " + code);
      showNet(false);
      return setItemStatus(item, "Reintentar", {
        attempts: Math.max(0, attempts - 1), nextAttemptAt: 0, lastError: code, progress: 0
      });
    }

    if (permanent || attempts >= MAX_AUTO_ATTEMPTS) {
      addLog(diagUploads, "❌ " + item.filename + " · intento " + attempts + " · " + secs(totalMs) +
             " · " + code + (permanent ? " (no se reintentará)" : " (máximo de intentos)"));
      return setItemStatus(item, "Error", { lastError: code, permanent: permanent, progress: 0 });
    }

    var delay = backoff(attempts);
    addLog(diagUploads, "↻ " + item.filename + " · intento " + attempts + " · " + secs(totalMs) +
           " · " + code + " · nuevo intento en " + secs(delay));
    return setItemStatus(item, "Reintentar", {
      lastError: code, nextAttemptAt: Date.now() + delay, progress: 0
    });
  }

  function uploadOne(item) {
    var attempts = (item.attempts || 0) + 1;
    var started = Date.now();
    var prepMs = 0;
    var tRequest = 0;

    return setItemStatus(item, "Subiendo", { attempts: attempts, progress: 0 })
      .then(function () {
        return window.PhotoQueue.get(item.uploadId);
      })
      .then(function (rec) {
        if (!rec || !rec.data) { throw new Error("NO_LOCAL_DATA"); }
        var localBlob = new Blob([rec.data], { type: rec.mimeType });
        return readBase64(localBlob);
      })
      .then(function (b64) {
        prepMs = Date.now() - started;
        tRequest = Date.now();
        startEstimate(item);
        return window.Api.post({
          action: "upload",
          uploadId: item.uploadId,
          filename: item.filename,
          mimeType: item.mimeType,
          size: item.size,
          deviceId: deviceId(),
          data: b64
        }, UPLOAD_TIMEOUT_MS);
      })
      .then(function (r) {
        stopEstimate();
        var totalMs = Date.now() - started;
        var requestMs = Date.now() - tRequest;
        var d = r.data || {};
        var confirmed = r.ok && d.ok === true && d.uploadId === item.uploadId && !!d.fileId;

        if (confirmed) {
          if (requestMs > 500) {
            var sample = item.size * 1.37 / (requestMs / 1000);
            rateBps = Math.round(rateBps * 0.6 + sample * 0.4);
          }
          var t = d.timings || {};
          addLog(diagUploads, "✅ " + item.filename + " · " + formatSize(item.size) +
                 " · intento " + attempts +
                 " · total " + secs(totalMs) +
                 " · preparar " + secs(prepMs) +
                 " · servidor " + secs(t.serverMs) +
                 " (drive " + secs(t.driveMs) + ")" +
                 (d.duplicate ? " · ya existía, sin copia nueva" : "") +
                 " · " + (d.version || ""));
          batchDone++;
          return setItemStatus(item, "Subida", {
            progress: 100, fileId: d.fileId, lastError: "", nextAttemptAt: 0
          }).then(function () {
            finalizeUploaded(item.uploadId);
          });
        }

        var code = d.error || r.error || ("HTTP " + r.status);
        return handleFailure(item, attempts, code, totalMs);
      })
      .catch(function (err) {
        stopEstimate();
        var code = (err && err.message) || "ERROR_LOCAL";
        return handleFailure(item, attempts, code, Date.now() - started);
      });
  }

  function finishBatch() {
    var errors = count(["Error"]);
    if (errors) {
      setUploadStatus(errors === 1 ? "Una foto no se pudo subir. Toca «Reintentar ahora»." :
                      errors + " fotos no se pudieron subir. Toca «Reintentar ahora».", true);
    } else if (batchDone > 0) {
      setUploadStatus(batchDone === 1 ? "Foto subida. ¡Gracias!" :
                      batchDone + " fotos subidas. ¡Gracias!", false);
    }
    batchDone = 0;
  }

  // Motor único: nunca hay dos subidas a la vez desde el mismo teléfono
  function pump() {
    if (running || !persistent || !window.Api) { render(); return; }
    if (timer) { clearTimeout(timer); timer = null; }
    if (navigator.onLine === false) {
      showNet(false);
      render();
      return;
    }

    var now = Date.now();
    var next = null;
    var soonest = Infinity;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var due = it.status === "En espera" ||
                (it.status === "Reintentar" && (it.nextAttemptAt || 0) <= now);
      if (!next && due) { next = it; }
      if (it.status === "Reintentar" && (it.nextAttemptAt || 0) > now) {
        soonest = Math.min(soonest, it.nextAttemptAt);
      }
    }

    if (!next) {
      if (soonest < Infinity) {
        timer = setTimeout(pump, soonest - now + 50);
        setUploadStatus("Conexión inestable. Reintentaremos automáticamente en " +
                        Math.ceil((soonest - now) / 1000) + " s.", false);
      } else {
        finishBatch();
      }
      render();
      return;
    }

    running = true;
    var total = batchDone + count(ACTIVE);
    setUploadStatus("Subiendo foto " + (batchDone + 1) + " de " + total + "…", false);
    uploadOne(next)
      .catch(function (err) { console.error("Fallo inesperado:", err); })
      .then(function () {
        running = false;
        updateStorage();
        pump();
      });
  }

  // Devuelve a la cola lo que falló por red (no los errores permanentes)
  function revive(resetSchedule) {
    var changes = [];
    items.forEach(function (it) {
      if (it.status === "Error" && !it.permanent) {
        changes.push(setItemStatus(it, "En espera", { attempts: 0, lastError: "" }));
      } else if (resetSchedule && it.status === "Reintentar") {
        changes.push(setItemStatus(it, "Reintentar", { nextAttemptAt: 0 }));
      }
    });
    Promise.all(changes).then(pump);
  }

  function retryItem(uploadId) {
    var it = findItem(uploadId);
    if (!it || it.status !== "Error") { return; }
    setItemStatus(it, "En espera", { attempts: 0, permanent: false, lastError: "" }).then(pump);
  }

  function retryNow() {
    var changes = [];
    items.forEach(function (it) {
      if (it.status === "Error") {
        changes.push(setItemStatus(it, "En espera", { attempts: 0, permanent: false, lastError: "" }));
      } else if (it.status === "Reintentar") {
        changes.push(setItemStatus(it, "Reintentar", { nextAttemptAt: 0 }));
      }
    });
    setUploadStatus("", false);
    Promise.all(changes).then(pump);
  }

  /* ---------- Arranque ---------- */

  function loadSaved() {
    if (!window.PhotoQueue) { return Promise.reject(new Error("PhotoQueue no cargado")); }
    return window.PhotoQueue.getAll().then(function (records) {
      var recovered = 0;
      var fixes = [];
      records.forEach(function (r) {
        if (!r) { return; }
        // Ya confirmada por el servidor: solo falta limpiarla del teléfono
        if (r.status === "Subida") {
          fixes.push(window.PhotoQueue.remove(r.uploadId).catch(function () { return null; }));
          return;
        }
        if (!r.data) { return; }
        // Se cerró a mitad de una subida: vuelve a la cola (el servidor evita duplicados)
        if (r.status === "Subiendo") {
          r.status = "Reintentar";
          r.nextAttemptAt = 0;
          fixes.push(window.PhotoQueue.update(r.uploadId, { status: "Reintentar", nextAttemptAt: 0 }));
        }
        var savedBlob = new Blob([r.data], { type: r.mimeType });
        items.push(toItem(r, savedBlob));
        recovered++;
      });
      render();
      if (recovered) {
        setStatus(recovered === 1 ? "1 foto pendiente recuperada de tu teléfono." :
                  recovered + " fotos pendientes recuperadas de tu teléfono.", false);
      }
      window.PhotoQueue.persist().then(function (granted) {
        persistGranted = !!granted;
        updateStorage();
      });
      return Promise.all(fixes);
    });
  }

  ready = loadSaved().catch(function (err) {
    console.error("IndexedDB no disponible:", err);
    persistent = false;
    render();
    setStatus("Este navegador no permite guardar fotos en el teléfono. No cierres la página hasta subirlas.", true);
  }).then(function () {
    updateStorage();
    showNet(navigator.onLine !== false);
    pump();
  });

  function handleFiles(files) {
    if (busy || !files.length) { return; }
    busy = true;
    setStatus("Preparando " + files.length + (files.length === 1 ? " foto…" : " fotos…"), false);

    var added = 0;
    var errors = [];

    files.reduce(function (chain, file) {
      return chain.then(function () {
        return addBlob(file, "gallery", file.name).then(function (reason) {
          if (reason) { errors.push(reason); } else { added++; }
        });
      });
    }, Promise.resolve()).then(function () {
      busy = false;
      if (errors.length) {
        var msg = added + (added === 1 ? " foto añadida. " : " fotos añadidas. ") +
                  errors.length + (errors.length === 1 ? " rechazada: " : " rechazadas: ") + errors[0];
        setStatus(msg, true);
      } else {
        setStatus(added + (added === 1 ? " foto añadida." : " fotos añadidas."), false);
      }
    });
  }

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    handleFiles(files);
  });

  uploadBtn.addEventListener("click", retryNow);

  window.addEventListener("online", function () {
    showNet(true);
    revive(true);
  });

  window.addEventListener("offline", function () {
    showNet(false);
    render();
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { revive(false); }
  });

  document.addEventListener("wedding:photo", function (e) {
    var d = e.detail || {};
    addBlob(d.blob, d.source || "camera", d.name || "").then(function (reason) {
      if (reason) { setStatus(reason, true); } else { setStatus("Foto guardada.", false); }
    });
  });

  render();
})();
window.PHOTOS_LOADED = true;
