(function () {
  "use strict";

  var config = window.APP_CONFIG || {};

  // Envía una petición y devuelve siempre un objeto; nunca lanza error.
  // options.signal permite cancelarla desde fuera (botón «Cancelar subida»).
  function call(method, options) {
    options = options || {};
    var started = Date.now();
    var timeoutMs = options.timeoutMs || config.REQUEST_TIMEOUT_MS || 45000;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timedOut = false;
    var cancelled = false;

    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) { controller.abort(); }
    }, timeoutMs);

    var external = options.signal;
    function onExternalAbort() {
      cancelled = true;
      if (controller) { controller.abort(); }
    }
    if (external) {
      if (external.aborted) {
        onExternalAbort();
      } else {
        external.addEventListener("abort", onExternalAbort);
      }
    }

    var url = config.API_URL;
    var init = {
      method: method,
      redirect: "follow",     // Apps Script responde con una redirección
      cache: "no-store",
      credentials: "omit"     // sin cookies de Google
    };
    if (controller) { init.signal = controller.signal; }

    if (method === "GET") {
      var params = options.params || {};
      var query = Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
      });
      query.push("_t=" + Date.now());
      url += "?" + query.join("&");
    } else {
      // text/plain evita la petición previa OPTIONS, que Apps Script no admite
      init.headers = { "Content-Type": options.contentType || "text/plain;charset=utf-8" };
      init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body || {});
    }

    return fetch(url, init).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        return {
          ok: res.ok && data !== null,
          status: res.status,
          data: data,
          error: data === null ? "RESPUESTA_NO_JSON" : "",
          ms: Date.now() - started
        };
      });
    }).catch(function (err) {
      var code;
      if (cancelled) {
        code = "CANCELLED";
      } else if (timedOut) {
        code = "TIMEOUT";
      } else {
        code = (err && err.name ? err.name : "Error") + (err && err.message ? ": " + err.message : "");
      }
      return { ok: false, status: 0, data: null, error: code, ms: Date.now() - started };
    }).then(function (result) {
      clearTimeout(timer);
      if (external) { external.removeEventListener("abort", onExternalAbort); }
      return result;
    });
  }

  window.Api = {
    get: function (params, timeoutMs) {
      return call("GET", { params: params, timeoutMs: timeoutMs });
    },
    post: function (body, timeoutMs, signal) {
      return call("POST", { body: body, timeoutMs: timeoutMs, signal: signal });
    },
    raw: call
  };
})();
