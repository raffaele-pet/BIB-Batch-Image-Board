import { t } from "./i18n.js?v=20261107-home";
import { updateThumbnail } from "./workspace-ui.js";
import { setModeBusy } from "./workspace-navigation.js?v=20261107-home";

const stage = document.getElementById("stage");
const canvas = document.getElementById("viewer");
const ctx = canvas.getContext("2d", { alpha: false });
const beforeInput = document.getElementById("beforeInput");
const afterInput = document.getElementById("afterInput");
const recordButton = document.getElementById("recordButton");
const fileNameInput = document.getElementById("fileName");
const durationInput = document.getElementById("durationSeconds");
const formatSelect = document.getElementById("videoFormat");
const viewXInput = document.getElementById("viewX");
const viewYInput = document.getElementById("viewY");
const viewZoomInput = document.getElementById("viewZoom");
const resetViewButton = document.getElementById("resetViewButton");
const viewInputs = [viewXInput, viewYInput, viewZoomInput];
const toolbar = document.getElementById("toolbar");
const EXPORT_SIZE = 1080;

const state = {
  before: null,
  after: null,
  slider: 0.5,
  zoom: 1,
  panX: 0,
  panY: 0,
  cssSize: 0,
  dpr: 1,
  pointerMode: null,
  pointerId: null,
  lastX: 0,
  lastY: 0,
  pointerStartX: 0,
  pointerStartY: 0,
  pointerMoved: false,
  recording: false,
  raf: 0,
  renderRaf: 0,
  syncInputsOnRender: false,
  cancelRecordingAnimation: null
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value, digits) {
  return Number(value.toFixed(digits)).toString();
}

function isReady() {
  return Boolean(state.before && state.after);
}

function sanitizeFileName(value, extension) {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
  const safe = trimmed || "before-after";
  const base = safe.replace(/\.(webm|mp4)$/i, "");
  return `${base}.${extension}`;
}

function setReadyState() {
  const ready = isReady();
  recordButton.disabled = !ready || state.recording;
  beforeInput.disabled = state.recording;
  afterInput.disabled = state.recording;
  fileNameInput.disabled = state.recording;
  durationInput.disabled = state.recording;
  formatSelect.disabled = state.recording;
  resetViewButton.disabled = state.recording;
  viewInputs.forEach((input) => {
    input.disabled = state.recording;
  });
  document.querySelectorAll("[data-slider-pick]").forEach((button) => { button.disabled = state.recording; });
  setModeBusy("confronto", state.recording);
  document.getElementById("recordLabel").textContent = t(state.recording ? "Registrazione in corso…" : "Registra video");
  stage.classList.toggle("has-before", Boolean(state.before));
  stage.classList.toggle("has-after", Boolean(state.after));
}

function getDurationMs() {
  const seconds = clamp(parseNumber(durationInput.value, 4), 0.5, 120);
  durationInput.value = formatNumber(seconds, 1);
  return seconds * 1000;
}

function updateViewInputs() {
  if (document.activeElement !== viewXInput) {
    viewXInput.value = formatNumber(state.panX, 2);
  }

  if (document.activeElement !== viewYInput) {
    viewYInput.value = formatNumber(state.panY, 2);
  }

  if (document.activeElement !== viewZoomInput) {
    viewZoomInput.value = formatNumber(state.zoom * 100, 2);
  }
}

function applyViewInputs() {
  state.panX = parseNumber(viewXInput.value, state.panX);
  state.panY = parseNumber(viewYInput.value, state.panY);
  const zoomPercent = parseNumber(viewZoomInput.value, state.zoom * 100);
  state.zoom = clamp(zoomPercent / 100, 0.05, 512);
  updateViewInputs();
  draw();
}

function resetNavigation() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  updateViewInputs();
  draw();
}

function scheduleDraw(syncInputs = false) {
  state.syncInputsOnRender ||= syncInputs;

  if (state.renderRaf) {
    return;
  }

  state.renderRaf = requestAnimationFrame(() => {
    state.renderRaf = 0;

    if (state.syncInputsOnRender) {
      updateViewInputs();
      state.syncInputsOnRender = false;
    }

    draw();
  });
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("Impossibile leggere questa immagine.")));
    };

    image.src = url;
  });
}

function drawImage(image, targetCtx, size, panScale) {
  if (!image) {
    return;
  }

  const baseScale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const width = image.naturalWidth * baseScale * state.zoom;
  const height = image.naturalHeight * baseScale * state.zoom;
  const x = (size - width) / 2 + state.panX * panScale;
  const y = (size - height) / 2 + state.panY * panScale;

  targetCtx.drawImage(image, x, y, width, height);
}

function drawDivider(targetCtx, x, size, markerScale) {
  const handleWidth = 30 * markerScale;
  const handleHeight = 44 * markerScale;
  const handleRadius = 15 * markerScale;
  const chevronWidth = 5 * markerScale;
  const chevronHeight = 10 * markerScale;
  const chevronGap = 3 * markerScale;

  targetCtx.save();
  targetCtx.strokeStyle = "rgba(255,255,255,0.95)";
  targetCtx.lineWidth = Math.max(2, 2 * markerScale);
  targetCtx.shadowColor = "rgba(0,0,0,0.75)";
  targetCtx.shadowBlur = 7 * markerScale;
  targetCtx.beginPath();
  targetCtx.moveTo(x, 0);
  targetCtx.lineTo(x, size);
  targetCtx.stroke();

  targetCtx.fillStyle = "#f7f8fb";
  targetCtx.shadowBlur = 12 * markerScale;
  targetCtx.beginPath();
  targetCtx.roundRect(
    x - handleWidth / 2,
    size / 2 - handleHeight / 2,
    handleWidth,
    handleHeight,
    handleRadius
  );
  targetCtx.fill();

  targetCtx.shadowBlur = 0;
  targetCtx.strokeStyle = "#111214";
  targetCtx.lineWidth = Math.max(1.5, 1.8 * markerScale);
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";
  targetCtx.beginPath();
  targetCtx.moveTo(x - chevronGap, size / 2 - chevronHeight / 2);
  targetCtx.lineTo(x - chevronGap - chevronWidth, size / 2);
  targetCtx.lineTo(x - chevronGap, size / 2 + chevronHeight / 2);
  targetCtx.moveTo(x + chevronGap, size / 2 - chevronHeight / 2);
  targetCtx.lineTo(x + chevronGap + chevronWidth, size / 2);
  targetCtx.lineTo(x + chevronGap, size / 2 + chevronHeight / 2);
  targetCtx.stroke();
  targetCtx.restore();
}

function drawScene(targetCtx, size, panScale, markerScale) {
  targetCtx.clearRect(0, 0, size, size);
  targetCtx.fillStyle = "#111418";
  targetCtx.fillRect(0, 0, size, size);

  const sliderX = state.slider * size;

  if (state.before) {
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(0, 0, sliderX, size);
    targetCtx.clip();
    drawImage(state.before, targetCtx, size, panScale);
    targetCtx.restore();
  }

  if (state.after) {
    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.rect(sliderX, 0, size - sliderX, size);
    targetCtx.clip();
    drawImage(state.after, targetCtx, size, panScale);
    targetCtx.restore();
  }

  if (isReady()) {
    drawDivider(targetCtx, state.slider * size, size, markerScale);
  }
}

function draw() {
  if (!state.cssSize) {
    return;
  }

  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  drawScene(ctx, state.cssSize, 1, 1);
}

function drawRecordingFrame(targetCtx) {
  if (!state.cssSize) {
    return;
  }

  const scale = EXPORT_SIZE / state.cssSize;
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawScene(targetCtx, EXPORT_SIZE, scale, scale);
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const size = Math.max(1, Math.floor(rect.width));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  state.cssSize = size;
  state.dpr = dpr;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  draw();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - rect.left, 0, state.cssSize),
    y: clamp(event.clientY - rect.top, 0, state.cssSize)
  };
}

function updateCursor(event) {
  if (!isReady() || state.recording) {
    canvas.classList.remove("is-sliding");
    return;
  }

  const point = canvasPoint(event);
  const sliderX = state.slider * state.cssSize;
  canvas.classList.toggle("is-sliding", Math.abs(point.x - sliderX) <= 18);
}

async function handleImageInput(event, slot) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    state[slot] = await loadImage(file);
    document.getElementById(slot + "FileName").textContent = file.name;
    document.getElementById(slot + "FileName").title = file.name;
    updateThumbnail(slot + "Thumb", state[slot]);
    resetNavigation();
    setReadyState();
    draw();
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
}

function handleWheel(event) {
  if (state.recording || (!state.before && !state.after)) {
    return;
  }

  event.preventDefault();

  const point = canvasPoint(event);
  const oldZoom = state.zoom;
  const zoomFactor = Math.exp(-event.deltaY * 0.0015);
  const nextZoom = clamp(oldZoom * zoomFactor, 0.05, 512);

  const center = state.cssSize / 2;
  const localX = point.x - center - state.panX;
  const localY = point.y - center - state.panY;
  const scale = nextZoom / oldZoom;

  state.panX = point.x - center - localX * scale;
  state.panY = point.y - center - localY * scale;
  state.zoom = nextZoom;
  scheduleDraw(true);
}

function handlePointerDown(event) {
  if (state.recording) {
    return;
  }

  const point = canvasPoint(event);
  const sliderX = state.slider * state.cssSize;

  state.pointerId = event.pointerId;
  state.lastX = point.x;
  state.lastY = point.y;
  state.pointerStartX = point.x;
  state.pointerStartY = point.y;
  state.pointerMoved = false;
  state.pointerMode = isReady() && Math.abs(point.x - sliderX) <= 22 ? "slider" : "pan";
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add(state.pointerMode === "pan" ? "is-dragging" : "is-sliding");

  if (state.pointerMode === "slider") {
    state.slider = clamp(point.x / state.cssSize, 0, 1);
    scheduleDraw();
  }
}

function handlePointerMove(event) {
  if (state.recording) {
    return;
  }

  if (state.pointerMode && state.pointerId === event.pointerId) {
    const point = canvasPoint(event);
    const distance = Math.hypot(
      point.x - state.pointerStartX,
      point.y - state.pointerStartY
    );

    if (distance > 5) {
      state.pointerMoved = true;
    }

    if (state.pointerMode === "slider") {
      state.slider = clamp(point.x / state.cssSize, 0, 1);
    } else if (state.before || state.after) {
      state.panX += point.x - state.lastX;
      state.panY += point.y - state.lastY;
      state.lastX = point.x;
      state.lastY = point.y;
    }

    scheduleDraw(state.pointerMode === "pan");
    return;
  }

  updateCursor(event);
}

function handlePointerUp(event) {
  if (state.pointerId !== event.pointerId) {
    return;
  }

  const point = canvasPoint(event);
  const shouldOpenImage = state.pointerMode === "pan" && !state.pointerMoved;

  state.pointerMode = null;
  state.pointerId = null;
  canvas.classList.remove("is-dragging", "is-sliding");

  if (shouldOpenImage) {
    const sliderX = state.slider * state.cssSize;
    const input = point.x < sliderX ? beforeInput : afterInput;
    input.click();
  }
}

function selectRecorderSettings(format) {
  const typesByFormat = {
    mp4: [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1.42001E",
      "video/mp4;codecs=avc1.640028",
      "video/mp4;codecs=avc1",
      "video/mp4;codecs=h264",
      "video/mp4"
    ],
    webm: [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm"
    ]
  };

  const mimeType = typesByFormat[format].find((type) => MediaRecorder.isTypeSupported(type));
  return mimeType ? { extension: format, mimeType } : null;
}

function downloadBlob(blob, extension, requestedName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = sanitizeFileName(requestedName, extension);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function animateRecording(duration, targetCtx) {
  return new Promise((resolve) => {
    const half = duration / 2;
    const start = performance.now();
    let finishTimeout = 0;

    function finish() {
      state.cancelRecordingAnimation = null;
      resolve();
    }

    function frame(now) {
      const elapsed = clamp(now - start, 0, duration);

      if (elapsed <= half) {
        state.slider = elapsed / half;
      } else {
        state.slider = 1 - (elapsed - half) / half;
      }

      draw();
      drawRecordingFrame(targetCtx);

      if (elapsed < duration) {
        state.raf = requestAnimationFrame(frame);
      } else {
        state.slider = 0;
        draw();
        drawRecordingFrame(targetCtx);
        finishTimeout = setTimeout(finish, 120);
      }
    }

    state.cancelRecordingAnimation = () => {
      cancelAnimationFrame(state.raf);
      clearTimeout(finishTimeout);
      finish();
    };

    state.slider = 0;
    draw();
    drawRecordingFrame(targetCtx);
    state.raf = requestAnimationFrame(frame);
  });
}

async function record() {
  if (!isReady() || state.recording) {
    return;
  }

  if (typeof MediaRecorder === "undefined") {
    alert(t("La registrazione non è supportata da questo browser."));
    return;
  }

  const format = formatSelect.value;
  const recorderSettings = selectRecorderSettings(format);
  if (!recorderSettings) {
    alert(t("{format} non è supportato da questo browser. Scegli un altro formato.", { format: format.toUpperCase() }));
    return;
  }

  const recordingCanvas = document.createElement("canvas");
  recordingCanvas.width = EXPORT_SIZE;
  recordingCanvas.height = EXPORT_SIZE;

  if (!recordingCanvas.captureStream) {
    alert(t("La registrazione non è supportata da questo browser."));
    return;
  }

  const recordingCtx = recordingCanvas.getContext("2d", { alpha: false });
  const previousSlider = state.slider;
  const requestedName = fileNameInput.value;
  const chunks = [];
  let recorderFailed = false;
  let cleanupDone = false;
  let recorder;

  recordingCtx.imageSmoothingEnabled = true;
  recordingCtx.imageSmoothingQuality = "high";
  drawRecordingFrame(recordingCtx);

  const stream = recordingCanvas.captureStream(60);

  try {
    recorder = new MediaRecorder(stream, {
      mimeType: recorderSettings.mimeType,
      videoBitsPerSecond: 12000000
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    alert(t("Impossibile avviare la registrazione nel formato selezionato."));
    return;
  }

  state.recording = true;
  toolbar.classList.add("recording");
  setReadyState();

  function restoreRecordingState() {
    if (cleanupDone) {
      return;
    }

    cleanupDone = true;
    stream.getTracks().forEach((track) => track.stop());
    state.recording = false;
    state.slider = previousSlider;
    toolbar.classList.remove("recording");
    setReadyState();
    draw();
  }

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size) {
      chunks.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder.mimeType || recorderSettings.mimeType });

    if (!recorderFailed && blob.size) {
      downloadBlob(blob, recorderSettings.extension, requestedName);
    } else if (!recorderFailed) {
      alert(t("La registrazione non ha prodotto un video. Riprova."));
    }

    restoreRecordingState();
  };

  recorder.onerror = () => {
    recorderFailed = true;
    state.cancelRecordingAnimation?.();
    alert(t("Si è verificato un errore durante la registrazione."));
  };

  try {
    recorder.start();
    await animateRecording(getDurationMs(), recordingCtx);

    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  } catch (error) {
    recorderFailed = true;
    state.cancelRecordingAnimation?.();

    if (recorder.state !== "inactive") {
      recorder.stop();
    } else {
      restoreRecordingState();
    }

    alert(t("Impossibile completare la registrazione del video."));
  }
}

beforeInput.addEventListener("change", (event) => handleImageInput(event, "before"));
afterInput.addEventListener("change", (event) => handleImageInput(event, "after"));
document.querySelectorAll("[data-slider-pick]").forEach((button) => {
  button.addEventListener("click", () => document.getElementById(button.dataset.sliderPick).click());
});
recordButton.addEventListener("click", record);
durationInput.addEventListener("change", getDurationMs);
resetViewButton.addEventListener("click", resetNavigation);
viewInputs.forEach((input) => {
  input.addEventListener("change", applyViewInputs);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
});
canvas.addEventListener("wheel", handleWheel, { passive: false });
canvas.addEventListener("keydown", (event) => {
  if (state.recording || !isReady() || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  state.slider = event.key === "Home" ? 0 : event.key === "End" ? 1 : clamp(state.slider + (event.key === "ArrowLeft" ? -0.02 : 0.02), 0, 1);
  draw();
});
canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointercancel", handlePointerUp);
canvas.addEventListener("mouseleave", () => {
  if (!state.pointerMode) {
    canvas.classList.remove("is-sliding");
  }
});

new ResizeObserver(resizeCanvas).observe(stage);
setReadyState();
updateViewInputs();
resizeCanvas();

document.addEventListener("bib:languagechange", setReadyState);
