(function () {
  "use strict";

  var list = document.getElementById("diag-list");

  function addRow(label, ok, detail) {
    var li = document.createElement("li");
    var icon = document.createElement("span");
    var text = document.createElement("span");
    icon.textContent = ok ? "✅" : "❌";
    text.textContent = label + (detail ? " — " + detail : "");
    li.appendChild(icon);
    li.appendChild(text);
    list.appendChild(li);
  }

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

  document.getElementById("diag-ua").textContent = "Navegador: " + navigator.userAgent;
})();
