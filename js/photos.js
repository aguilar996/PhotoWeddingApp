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
  var OFFLINE_MSG = "Sin conexión. Tus fotos están guardadas y se subirán solas cuando vuelva la conexión.";
  var PAUSED_MSG = "Subida en pausa. Tus fotos siguen guardadas en este teléfono.";

  var input = document.getElementById("file-input");
  var tray = document.getElementById("tray");
  var trayEmpty = document.getElementById("tray-empty");
  var trayCount = document.getElementById("tray-count");
  var statusEl = document.getElementById("picker-status");
  var uploadBtn = document.getElementById("btn-upload");
  var cancelBtn = document.getElementById("btn-cancel");
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
  var paused = false;                // solo en esta visita; al reabrir la página se reanuda
  var currentAbort = null;
  var timer = null;
  var progTimer = null;
  var batchDone = 0;
  var rateBps = 250000;
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
      if (
