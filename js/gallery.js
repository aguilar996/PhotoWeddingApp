(function () {
  "use strict";

  var FILE_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
  var AUTO_REFRESH_MS = 120000;   // solo al volver a la pestaña, si pasaron 2 min

  var grid = document.getElementById("g-grid");
  var countEl = document.getElementById("g-count");
  var statusEl = document.getElementById("g-status");
  var emptyEl = document.getElementById("g-empty");
  var refreshBtn = document.getElementById("g-refresh");
  var diagEl = document.getElementById("g-diag");

  var loading = false;
  var lastLoad = 0;
  var signature = "";
  var stats = { primary: 0, fallback: 0, broken: 0 };
  var listInfo = "";

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function updateDiag() {
    diagEl.textContent = listInfo + " · miniaturas: " + stats.primary + " principal · " +
      stats.fallback + " alternativa · " + stats.broken + " fallidas";
  }

  function thumbUrls(id) {
    var safe = encodeURIComponent(id);
    return [
      "https://drive.google.com/thumbnail?id=" + safe + "&sz=w600",
      "https://lh3.googleusercontent.com/d/" + safe + "=w600"
    ];
  }

  function viewUrl(id) {
    return "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
  }

  function makeCard(item, index) {
    var a = document.createElement("a");
    a.className = "g-item";
    a.href = viewUrl(item.id);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "Abrir la foto " + (index + 1) + " en Google Drive");

    var img = document.createElement("img");
    img.alt = "Foto compartida " + (index + 1);
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";

    var urls = thumbUrls(item.id);
    var attempt = 0;

    img.addEventListener("load", function () {
      a.classList.add("is-loaded");
      if (attempt === 0) { stats.primary++; } else { stats.fallback++; }
      updateDiag();
    });

    img.addEventListener("error", function () {
      attempt++;
      if (attempt < urls.length) {
        img.src = urls[attempt];
      } else {
        a.classList.add("is-broken");
        stats.broken++;
        updateDiag();
      }
    });

    img.src = urls[0];
    a.appendChild(img);
    return a;
  }

  function render(items) {
    var sig = items.map(function (it) { return it.id; }).join(",");
    if (sig === signature) { return; }   // sin cambios: no recarga imágenes
    signature = sig;
    stats = { primary: 0, fallback: 0, broken: 0 };

    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    var frag = document.createDocumentFragment();
    items.forEach(function (item, index) {
      frag.appendChild(makeCard(item, index));
    });
    grid.appendChild(frag);

    var n = items.length;
    countEl.textContent = n === 1 ? "1 foto compartida" : n + " fotos compartidas";
    emptyEl.hidden = n > 0;
  }

  function load() {
    if (loading) { return; }
    if (!window.Api) {
      setStatus("No se pudo cargar la conexión. Recarga la página.", true);
      return;
    }
    loading = true;
    refreshBtn.disabled = true;
    setStatus("Cargando fotos…", false);

    window.Api.get({ action: "gallery" }, 30000).then(function (r) {
      var d = r.data || {};
      if (r.ok && d.ok === true && Array.isArray(d.items)) {
        var items = d.items.filter(function (it) {
          return it && FILE_ID_RE.test(String(it.id || ""));
        });
        render(items);
        lastLoad = Date.now();
        setStatus("", false);
        listInfo = "Lista: " + items.length + " · caché del servidor: " +
                   (d.cached ? "sí" : "no") + " · " + r.ms + " ms · " + (d.version || "");
        updateDiag();
      } else {
        setStatus("No pudimos cargar la galería. Toca «Actualizar» para intentarlo de nuevo.", true);
        listInfo = "Error: " + (d.error || r.error || ("HTTP " + r.status));
        updateDiag();
      }
    }).then(function () {
      loading = false;
      refreshBtn.disabled = false;
    });
  }

  refreshBtn.addEventListener("click", load);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && Date.now() - lastLoad > AUTO_REFRESH_MS) { load(); }
  });

  load();
})();
