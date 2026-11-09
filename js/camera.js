(function () {
  "use strict";

  var video = document.getElementById("camera-video");
  var viewfinder = document.getElementById("viewfinder");
  var btnOpen = document.getElementById("btn-open");
  var btnClose = document.getElementById("btn-close");
  var btnSwitch = document.getElementById("btn-switch");
  var btnShutter = document.getElementById("btn-shutter");
  var shutterRow = document.getElementById("shutter-row");
  var statusEl = document.getElementById("camera-status");
  var resEl = document.getElementById("vf-res");
  var flashEl = document.getElementById("vf-flash");
  var diagCamera = document.getElementById("diag-camera");

  var stream = null;
  var facing = "environment";
  var starting = false;

  // Requisitos de Safari/iOS (también están en el HTML, se refuerzan aquí)
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function setState(state) {
    viewfinder.setAttribute("data-state", state);
  }

  function showIdleControls() {
    btnOpen.hidden = false;
    btnOpen.disabled = false;
    shutterRow.hidden = true;
  }

  function showLiveControls() {
    btnOpen.hidden = true;
    shutterRow.hidden = false;
  }

  function cameraSupported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(function (track) {
        try { track.stop(); } catch (e) { /* ignorar */ }
      });
    }
    stream = null;
    video.srcObject = null;
    viewfinder.classList.remove("is-mirrored");
    resEl.textContent = "—";
  }

  function errorMessage(err) {
    var name = err && err.name ? err.name : "";
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return "No fue posible acceder a la cámara. Revisa el permiso de cámara de Safari (o de tu navegador) o selecciona las fotos desde tu galería.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No encontramos ninguna cámara en este dispositivo. Puedes seleccionar las fotos desde tu galería.";
      case "NotReadableError":
      case "TrackStartError":
        return "La cámara está siendo usada por otra aplicación. Ciérrala e inténtalo de nuevo.";
      case "AbortError":
        return "La cámara se interrumpió. Inténtalo de nuevo.";
      default:
        return "No fue posible acceder a la cámara. Revisa el permiso de cámara o selecciona las fotos desde tu galería.";
    }
  }

  // getUserMedia se llama de forma síncrona dentro del toque del usuario (requisito iOS)
  function requestStream(facingMode) {
    var preferred = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      }
    };
    return navigator.mediaDevices.getUserMedia(preferred).catch(function (err) {
      var retryable = err && (err.name === "OverconstrainedError" ||
                              err.name === "ConstraintNotSatisfiedError" ||
                              err.name === "TypeError");
      if (!retryable) { throw err; }
      // Fallback 1: solo facingMode. Fallback 2: cualquier cámara.
      return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facingMode } })
        .catch(function () {
          return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        });
    });
  }

  function actualFacing() {
    if (!stream) { return ""; }
    var track = stream.getVideoTracks()[0];
    var settings = track && track.getSettings ? track.getSettings() : {};
    return settings.facingMode || facing;
  }

  function updateInfo() {
    if (!stream || !video.videoWidth) { return; }
    var side = actualFacing() === "user" ? "delantera" : "trasera";
    var res = video.videoWidth + " × " + video.videoHeight;
    resEl.textContent = res;
    if (diagCamera) {
      diagCamera.textContent = "✅ Cámara activa — " + res + " · " + side;
    }
  }

  function onTrackEnded() {
    stopStream();
    setState("idle");
    showIdleControls();
    setStatus("La cámara se detuvo. Toca «Abrir cámara» para continuar.", false);
  }

  function startCamera() {
    if (starting) { return; }

    if (!window.isSecureContext) {
      setStatus("La cámara requiere una conexión segura (HTTPS).", true);
      return;
    }
    if (!cameraSupported()) {
      setStatus("Este navegador no permite usar la cámara en vivo. Abre la página en Safari o Chrome, o selecciona las fotos desde tu galería.", true);
      return;
    }

    starting = true;
    stopStream();
    setState("loading");
    setStatus("Abriendo la cámara…", false);
    btnOpen.disabled = true;

    requestStream(facing)
      .then(function (newStream) {
        stream = newStream;
        video.srcObject = newStream;
        var track = newStream.getVideoTracks()[0];
        if (track) { track.addEventListener("ended", onTrackEnded); }
        var playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          return playPromise.catch(function () { /* autoplay muted ya lo cubre */ });
        }
        return null;
      })
      .then(function () {
        viewfinder.classList.toggle("is-mirrored", actualFacing() === "user");
        setState("live");
        showLiveControls();
        setStatus("", false);
        updateInfo();
      })
      .catch(function (err) {
        console.error("Error de cámara:", err);
        stopStream();
        setState("idle");
        showIdleControls();
        setStatus(errorMessage(err), true);
        if (diagCamera) {
          diagCamera.textContent = "❌ Cámara — " + (err && err.name ? err.name : "error desconocido");
        }
      })
      .then(function () {
        starting = false;
        btnOpen.disabled = false;
      });
  }

  function closeCamera() {
    stopStream();
    setState("idle");
    showIdleControls();
    setStatus("", false);
  }

  function switchCamera() {
    facing = facing === "environment" ? "user" : "environment";
    startCamera();
  }

  function shutter() {
    flashEl.classList.remove("is-active");
    void flashEl.offsetWidth; // reinicia la animación
    flashEl.classList.add("is-active");
    setStatus("La captura se activará en la Fase 3.", false);
  }

  btnOpen.addEventListener("click", startCamera);
  btnClose.addEventListener("click", closeCamera);
  btnSwitch.addEventListener("click", switchCamera);
  btnShutter.addEventListener("click", shutter);
  video.addEventListener("loadedmetadata", updateInfo);
  video.addEventListener("resize", updateInfo);

  // Si el invitado sale de Safari, liberamos la cámara (iOS la congela igualmente)
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && stream) {
      closeCamera();
      setStatus("Cámara pausada. Toca «Abrir cámara» para continuar.", false);
    }
  });
})();
