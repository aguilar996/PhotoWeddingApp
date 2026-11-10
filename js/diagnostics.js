(function () {
  "use strict";

  var errorsBox = document.getElementById("diag-errors");

  function showError(text) {
    if (!errorsBox) { return; }
    errorsBox.hidden = false;
    var li = document.createElement("li");
    li.textContent = "❌ " + text;
    errorsBox.appendChild(li);
  }

  // Captura errores de los scripts que se cargan después de este
  window.addEventListener("error", function (e) {
    var file = e && e.filename ? String(e.filename).split("/").pop() : "?";
    var line = e && e.lineno ? e.lineno : "?";
    var msg = e && e.message ? e.message : "Error desconocido";
    showError(msg + " · archivo: " + file + " · línea: " + line);
  });

  window.addEventListener("unhandledrejection", function (e) {
    var r = e ? e.reason : null;
    showError("Promesa: " + (r && r.message ? r.message : String(r)));
  });

  function addRow(label, ok, detail) {
    var list = document.getElementById("diag-list");
    if (!list) { return; }
    var li = document.createElement("li");
    var icon = document.createElement("span");
    var text = document.createElement("span");
    icon.textContent = ok ? "✅" : "❌";
    text.textContent = label + (detail ? " — " + detail : "");
    li.appendChild(icon);
    li.appendChild(text);
    list.appendChild(li);
  }

  function runChecks() {
    var hasMediaDevices = !!navigator.mediaDevices;
    var hasGetUserMedia = hasMediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
    var hasIndexedDB = false;
    try { hasIndexedDB = !!window.indexedDB; } catch (e) { hasIndexedDB = false; }

    addRow("Conexión HTTPS", location.protocol === "https:", location.protocol);
    addRow("Contexto seguro", window.isSecureContext === true, "");
    addRow("navigator.mediaDevices disponible", hasMediaDevices, "");
    addRow("getUserMedia disponible", hasGetUserMedia, "");
    addRow("IndexedDB disponible", hasIndexedDB, "");
    addRow("Conectado a Internet", navigator.onLine === true, "");

    var ua = document.getElementById("diag-ua");
    if (ua) { ua.textContent = "Navegador: " + navigator.userAgent; }
  }

  // Comprueba que cada archivo JS se cargó
  function checkModules() {
    addRow("config.js cargado", !!window.APP_CONFIG, "");
    addRow("api.js cargado", !!window.Api, "");
    addRow("queue.js cargado", !!window.PhotoQueue, "");
    addRow("photos.js cargado", window.PHOTOS_LOADED === true, "");
  }

  runChecks();
  window.addEventListener("load", checkModules);
})();
