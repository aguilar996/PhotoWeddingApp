(function () {
  "use strict";

  var MAX_BYTES = 6 * 1024 * 1024;   // 6 MB
  var MAX_ITEMS = 100;
  var ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
  var UPLOAD_TIMEOUT_MS = 120000;
  var REMOVE_DELAY_MS = 1200;
  var PENDING = ["En espera", "Reintentar", "Error"];

  var input = document.getElementById("file-input");
  var tray = document.getElementById("tray");
  var trayEmpty = document.getElementById("tray-empty");
  var trayCount = document.getElementById("tray-count");
  var statusEl = document.getElementById("picker-status");
  var uploadBtn = document.getElementById("btn-upload");
  var uploadStatus = document.getElementById("upload-status");
  var diagFiles = document.getElementById("diag-files");
  var diagUploads = document.getElementById("diag-uploads");
  var diagStorage = document.getElementById("diag-storage");

  var items = [];
  var busy = false;
  var uploading = false;
  var persistent = true;
  var persistGranted = null;
  var ready;

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
    while (listEl.children.length > 20) { listEl.removeChild(listEl.lastChild); }
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

  function nextPending() {
    for (var i = 0; i < items.length; i++) {
      if (PENDING.indexOf(items[i].status) !== -1) { return items[i]; }
    }
    return null;
  }

  function pendingCount() {
    var n = 0;
    items.forEach(function (it) { if (PENDING.indexOf(it.status) !== -1) { n++; } });
    return n;
  }

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
            lastError: "",
            source: source
          };

          var save = persistent ? window.PhotoQueue.put(record) : Promise.resolve();
          return save.then(function () {
            items.push(toItem(record, blob));
            logDiag(originalName, blob.type, detected, blob.size, "✅");
            render();
            updateStorage();
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
    if (item && item.status === "Subiendo") { return; }
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

  function render() {
    while (tray.firstChild) { tray.removeChild(tray.firstChild); }

    items.forEach(function (item, index) {
      var li = document.createElement("li");
      li.className = "thumb";

      var img = document.createElement("img");
      img.src = item.url;
      img.alt = "Foto " + (index + 1);
      img.decoding = "async";

      var meta = document.createElement("span");
      meta.className = "thumb-meta";
      meta.textContent = item.status + " · " + formatSize(item.size);

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
      tray.appendChild(li);
    });

    var n = items.length;
    trayCount.textContent = n === 1 ? "1 foto" : n + " fotos";
    trayEmpty.hidden = n > 0;

    var pending = pendingCount();
    uploadBtn.disabled = uploading || pending === 0;
    uploadBtn.textContent = uploading ? "Subiendo…" :
      (pending ? "Subir siguiente foto (" + pending + " pendientes)" : "No hay fotos pendientes");
  }

  function setItemStatus(item, status, changes) {
    item.status = status;
    if (changes && typeof changes.attempts === "number") { item.attempts = changes.attempts; }
    render();
    if (!persistent) { return Promise.resolve(); }
    var update = { status: status };
    if (changes) {
      Object.keys(changes).forEach(function (k) { update[k] = changes[k]; });
    }
    return window.
