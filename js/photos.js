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

  var items = [];
  var busy = false;

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
    if (bytes >= 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(1) + " MB"; }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function timestamp(d) {
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
           pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  // Lee los primeros bytes (FileReader: compatible con Safari antiguo)
  function readHead(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(new Uint8Array(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(blob.slice(0, 16));
    });
  }

  function ascii(bytes, start, end) {
    var s = "";
    for (var i = start; i < end && i < bytes.length; i++) { s += String.fromCharCode(bytes[i]); }
    return s;
  }

  // Tipo real según la "firma" del archivo
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

  // Devuelve null si se añadió, o un texto con el motivo del rechazo
  function addBlob(blob, source, originalName) {
    if (items.length >= MAX_ITEMS) {
      return Promise.resolve("Has alcanzado el máximo de " + MAX_ITEMS + " fotos en espera.");
    }
    if (!blob || !blob.size) {
      return Promise.resolve("El archivo está vacío.");
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

      var item = {
        uploadId: uuid(),
        blob: blob,
        filename: safeFilename(originalName, ALLOWED[detected], source),
        mimeType: detected,
        size: blob.size,
        createdAt: new Date().toISOString(),
        status: "En espera",
        attempts: 0,
        progress: 0,
        source: source,
        url: URL.createObjectURL(blob)
      };
      items.push(item);
      logDiag(originalName, blob.type, detected, blob.size, "✅");
      render();
      return null;
    }).catch(function () {
      return "No se pudo leer el archivo.";
    });
  }

  function removeItem(uploadId) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].uploadId === uploadId) {
        URL.revokeObjectURL(items[i].url);
        items.splice(i, 1);
        break;
      }
    }
    render();
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

  // Procesa los archivos de uno en uno (menos memoria en iPhone)
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
    input.value = ""; // permite volver a elegir las mismas fotos
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
