(function () {
  "use strict";

  var btn = document.getElementById("btn-run");
  var list = document.getElementById("results");
  var summary = document.getElementById("summary");
  var env = document.getElementById("env");

  env.textContent = "Origen: " + location.origin + " · En línea: " +
                    (navigator.onLine ? "sí" : "no") + " · " + navigator.userAgent;

  function bigString(bytes) {
    return new Array(bytes + 1).join("a");
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
    }
  ];

  function describe(r) {
    var parts = ["HTTP " + r.status, r.ms + " ms"];
    if (r.data) {
      if (r.data.error) { parts.push("error: " + r.data.error); }
      if (r.data.version) { parts.push("versión: " + r.data.version); }
      if (r.data.echo) { parts.push("eco: " + r.data.echo); }
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
    while (list.firstChild) { list.removeChild(list.firstChild); }
    summary.textContent = "Ejecutando pruebas…";
    var passedCount = 0;

    tests.reduce(function (chain, test) {
      return chain.then(function () {
        return test.run().then(function (r) {
          var passed = false;
          try { passed = !!test.check(r); } catch (e) { passed = false; }
          if (passed) { passedCount++; }
          addRow(test.name, passed, describe(r));
        });
      });
    }, Promise.resolve()).then(function () {
      summary.textContent = passedCount + " de " + tests.length + " pruebas correctas.";
      btn.disabled = false;
    });
  }

  btn.addEventListener("click", runAll);
})();
