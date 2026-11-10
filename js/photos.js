(function () {
  "use strict";

  var MAX_BYTES = 6 * 1024 * 1024;   // 6 MB
  var MAX_ITEMS = 100;
  var ALLOWED = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

  var input = document.getElementById("file-input");
  var tray = document.getElementById("tray");
  var trayEmpty = document.getElementById("tray-empty");
  var trayCount = document.getElementById("tray-count");
  var statusEl = document.getElementById("picker-status");
  var diagFiles = document.getElementById("diag-files");
  var diagStorage = document.getElementById("diag-storage");

  var items = [];
  var busy = false;
  var persistent = true;
  var persistGranted = null;
  var ready;

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
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

  function formatSize(bytes) {
    if (bytes >= 1024 * 1024 * 1024) { return (bytes / (1024 * 1024 * 1024)).toFixed(1) + " GB"; }
    if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function timestamp(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  // FileReader: compatible con versiones antiguas de Safari
  function readBuffer(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(blob);
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

  function logDiag(name, declared, detected, size, result) {
    if (!diagFiles) { return; }
    var li = document.createElement("li");
    li.textContent = result + " " + (name || "(cámara)") +
      " · declarado: " + (declared || "vacío") +
      " · real: " + (detected || "desconocido") +
      " · " + formatSize(size);
    diagFiles.insertBefore(li, diagFiles.firstChild);
    while (diagFiles.children.length > 20) { diagFiles.removeChild(diagFiles.lastChild); }
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
      attempts: record.attempts,
      progress: record.progress,
      source: record.source,
      url: URL.createObjectURL(blob)
    };
  }

  function saveError(err) {
    if (err && err.name === "QuotaExceededError") {
      return "No queda espacio en el teléfono para guardar más fotos. Elimina algunas e inténtalo de nuevo.";
    }
    return "No se pudo guardar la foto en el teléfono. Inténtalo de nuevo.";
  }

  // Devuelve null si se añadió, o un texto con el motivo del rechazo
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
    var del = persistent ? window.PhotoQueue.remove(uploadId) : Promise.resolve();
    del.then(function () {
      for (var i = 0; i < items.length; i++) {
        if (items[i].uploadId === uploadId) {
          URL.revokeObjectURL(items[i].url);
          items.splice(i, 1);
          break;
        }
      }
      render();
      updateStorage();
    }, function () {
      setStatus("No se pudo eliminar la foto. Inténtalo de nuevo.", true);
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
      btn.addEventListener("click", function () { removeItem(item.uploadId); });

      li.appendChild(img);
      li.appendChild(meta);
      li.appendChild(btn);
      tray.appendChild(li);
    });

    var n = items.length;
    trayCount.textContent = n === 1 ? "1 foto" : n + " fotos";
    trayEmpty.hidden = n > 0;
  }

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

  // Recupera la cola guardada al abrir la página
  function loadSaved() {
    if (!window.PhotoQueue) { return Promise.reject(new Error("PhotoQueue no cargado")); }
    return window.PhotoQueue.getAll().then(function (records) {
      var recovered = 0;
      records.forEach(function (r) {
        if (!r || !r.data) { return; }
        var blob = new Blob([r.data], { type: r.mimeType });
        items.push(toItem(r, blob));
        recovered++;
      });
      render();
      if (recovered) {
        setStatus(recovered === 1 ? "1 foto recuperada de tu teléfono." :
                  recovered + " fotos recuperadas de tu teléfono.", false);
      }
      window.PhotoQueue.persist().then(function (granted) {
        persistGranted = !!granted;
        updateStorage();
      });
    });
  }

  ready = loadSaved().catch(function (err) {
    console.error("IndexedDB no disponible:", err);
    persistent = false;
    render();
    setStatus("Este navegador no permite guardar fotos en el teléfono. No cierres la página hasta subirlas.", true);
  }).then(function () {
    updateStorage();
  });

  input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    handleFiles(files);
  });

  document.addEventListener("wedding:photo", function (e) {
    var d = e.detail || {};
    addBlob(d.blob, d.source || "camera", d.name || "").then(function (reason) {
      if (reason) { setStatus(reason, true); } else { setStatus("Foto guardada.", false); }
    });
  });

  render();
})();
