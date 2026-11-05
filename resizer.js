import { t } from "./i18n.js?v=20261106-header";
import { isModeActive, setModeBusy } from "./workspace-navigation.js?v=20261106-header";

// Editing/export engine ported from raffaele-pet/batch-image-resizer @ 90578aec62b8a62a86da868935547d655bb55859.
(() => {
  "use strict";

  const els = {
    fileInput: document.getElementById("resize-fileInput"),
    addImagesBtn: document.getElementById("resize-addImagesBtn"),
    removeBtn: document.getElementById("resize-removeBtn"),
    undoBtn: document.getElementById("resize-undoBtn"),
    ratioSelect: document.getElementById("resize-ratioSelect"),
    sizeSelect: document.getElementById("resize-sizeSelect"),
    fillBtn: document.getElementById("resize-fillBtn"),
    fitImageBtn: document.getElementById("resize-fitImageBtn"),
    edgePixelBtn: document.getElementById("resize-edgePixelBtn"),
    centerBtn: document.getElementById("resize-centerBtn"),
    zoomOutBtn: document.getElementById("resize-zoomOutBtn"),
    zoomInBtn: document.getElementById("resize-zoomInBtn"),
    fitViewBtn: document.getElementById("resize-fitViewBtn"),
    counterLabel: document.getElementById("resize-counterLabel"),
    exportAllTopBtn: document.getElementById("resize-exportAllTopBtn"),
    workspaceShell: document.getElementById("resizeApp"),
    stageWrap: document.getElementById("resize-stageWrap"),
    canvas: document.getElementById("resize-stageCanvas"),
    emptyState: document.getElementById("resize-emptyState"),
    dropOverlay: document.getElementById("resize-dropOverlay"),
    currentName: document.getElementById("resize-currentName"),
    originalSize: document.getElementById("resize-originalSize"),
    outputSize: document.getElementById("resize-outputSize"),
    imageScaleLabel: document.getElementById("resize-imageScaleLabel"),
    viewScaleLabel: document.getElementById("resize-viewScaleLabel"),
    formatSelect: document.getElementById("resize-formatSelect"),
    qualityRow: document.getElementById("resize-qualityRow"),
    qualityRange: document.getElementById("resize-qualityRange"),
    qualityValue: document.getElementById("resize-qualityValue"),
    namingSelect: document.getElementById("resize-namingSelect"),
    namingCustom: document.getElementById("resize-namingCustom"),
    baseNameInput: document.getElementById("resize-baseNameInput"),
    exportStatus: document.getElementById("resize-exportStatus"),
    prevBtn: document.getElementById("resize-prevBtn"),
    nextBtn: document.getElementById("resize-nextBtn"),
    thumbStrip: document.getElementById("resize-thumbStrip"),
    toast: document.getElementById("resize-toast")
  };

  const ctx = els.canvas.getContext("2d", { alpha: false, desynchronized: true });

  const state = {
    items: [],
    undoStack: [],
    currentIndex: -1,
    ratioText: els.ratioSelect.value,
    sizeMode: els.sizeSelect.value,
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
    cssW: 1,
    cssH: 1,
    raf: 0,
    pointer: null,
    hoveredHandle: null,
    spaceDown: false,
    exporting: false,
    dragDepth: 0,
    toastTimer: 0
  };

  const HANDLE_SIZE = 10;
  const HANDLE_HIT = 16;
  const SNAP_SCREEN_PX = 10;
  const MIN_IMAGE_SIZE = 4;
  const MAX_VIEW_ZOOM = 64;
  const MIN_VIEW_ZOOM = 0.05;
  const MAX_UNDO_STEPS = 50;

  function captureEdit() {
    return {
      items: state.items.map(item => ({ ...item, transform: { ...item.transform } })),
      currentIndex: state.currentIndex,
      ratioText: state.ratioText,
      sizeMode: state.sizeMode,
      viewZoom: state.viewZoom,
      viewPanX: state.viewPanX,
      viewPanY: state.viewPanY
    };
  }

  function editChanged(before) {
    return before.ratioText !== state.ratioText || before.sizeMode !== state.sizeMode ||
      before.items.length !== state.items.length || before.items.some((item, index) => {
        const current = state.items[index];
        return item.id !== current.id || item.edgePixel !== current.edgePixel || Object.keys(item.transform).some(
          key => item.transform[key] !== current.transform[key]
        );
      });
  }

  // Keep shared image resources alive while any undo step can restore them.
  function releaseUnusedImages(previousItems) {
    const retained = new Set([
      ...state.items.map(item => item.url),
      ...state.undoStack.flatMap(edit => edit.items.map(item => item.url))
    ]);
    for (const url of new Set(previousItems.map(item => item.url))) {
      if (!retained.has(url)) URL.revokeObjectURL(url);
    }
  }

  function recordEdit(before) {
    if (!editChanged(before)) return;
    state.undoStack.push(before);
    if (state.undoStack.length > MAX_UNDO_STEPS) {
      releaseUnusedImages(state.undoStack.shift().items);
    }
    updateUI();
  }

  function finishPointerEdit() {
    const ptr = state.pointer;
    if (!ptr) return;
    try { els.canvas.releasePointerCapture(ptr.id); } catch {}
    state.pointer = null;
    els.canvas.classList.remove("dragging");
    if (ptr.beforeEdit) recordEdit(ptr.beforeEdit);
  }

  function undoEdit() {
    if (state.exporting) return;
    finishPointerEdit();
    const before = state.undoStack.pop();
    if (!before) return;
    const previousItems = state.items;
    state.items = before.items;
    state.currentIndex = before.currentIndex;
    state.ratioText = before.ratioText;
    state.sizeMode = before.sizeMode;
    state.viewZoom = before.viewZoom;
    state.viewPanX = before.viewPanX;
    state.viewPanY = before.viewPanY;
    els.ratioSelect.value = state.ratioText;
    els.sizeSelect.value = state.sizeMode;
    state.hoveredHandle = null;
    els.canvas.style.cursor = "default";
    releaseUnusedImages(previousItems);
    buildThumbnails();
    updateUI();
    scheduleDraw();
    toast(t("Ultima modifica annullata."));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function parseRatio(text = state.ratioText, item = null) {
    if (text === "original") {
      if (item && item.naturalWidth && item.naturalHeight) {
        return item.naturalWidth / item.naturalHeight;
      }
      return 1;
    }
    const [a, b] = text.split(":").map(Number);
    return a / b;
  }

  function getLongSideFor(item, sizeMode = state.sizeMode) {
    if (sizeMode === "adaptive") {
      return Math.max(item.naturalWidth, item.naturalHeight);
    }
    return Number(sizeMode);
  }

  function getArtboardSize(item, ratioText = state.ratioText, sizeMode = state.sizeMode) {
    if (!item) return { width: 1920, height: 1080, longSide: 1920 };
    const ratio = parseRatio(ratioText, item);
    const longSide = Math.max(1, Math.round(getLongSideFor(item, sizeMode)));
    let width, height;

    if (Math.abs(ratio - 1) < 1e-9) {
      width = height = longSide;
    } else if (ratio > 1) {
      width = longSide;
      height = Math.max(1, Math.round(longSide / ratio));
    } else {
      height = longSide;
      width = Math.max(1, Math.round(longSide * ratio));
    }

    return { width, height, longSide };
  }

  function currentItem() {
    return state.currentIndex >= 0 ? state.items[state.currentIndex] : null;
  }

  function initTransform(item) {
    const art = getArtboardSize(item);
    const cover = Math.max(art.width / item.naturalWidth, art.height / item.naturalHeight);
    item.transform = {
      x: art.width / 2,
      y: art.height / 2,
      scaleX: cover,
      scaleY: cover
    };
  }

  function sanitizeBaseName(value, fallback = "image") {
    const clean = String(value || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "");
    return clean || fallback;
  }

  function fileStem(name) {
    return String(name).replace(/\.[^.]+$/, "");
  }

  function extensionFor(format) {
    return format === "jpeg" ? "jpg" : format;
  }

  function mimeFor(format) {
    if (format === "jpeg") return "image/jpeg";
    if (format === "webp") return "image/webp";
    return "image/png";
  }

  function outputFileName(item, index) {
    const ext = extensionFor(els.formatSelect.value);
    if (els.namingSelect.value === "original") {
      return `${sanitizeBaseName(fileStem(item.name), "image")}.${ext}`;
    }
    const digits = Math.max(3, String(state.items.length).length);
    const num = String(index + 1).padStart(digits, "0");
    return `${sanitizeBaseName(els.baseNameInput.value, "image")}_${num}.${ext}`;
  }

  function toast(message) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function setExportStatus(text, kind = "") {
    els.exportStatus.textContent = text;
    els.exportStatus.className = `status ${kind}`.trim();
  }

  async function loadImageFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(t("Impossibile leggere {name}", { name: file.name })));
        image.src = url;
      });

      const item = {
        id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
        file,
        name: file.name,
        url,
        image,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        edgePixel: false,
        transform: null
      };
      initTransform(item);
      return item;
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith("image/"));
    if (!files.length) {
      toast(t("Nessuna immagine valida selezionata."));
      return;
    }

    const loaded = [];
    for (const file of files) {
      try {
        loaded.push(await loadImageFile(file));
      } catch (err) {
        console.error(err);
        toast(t("Immagine ignorata: {name}", { name: file.name }));
      }
    }

    if (!loaded.length) return;

    finishPointerEdit();
    const before = captureEdit();
    loaded.forEach(initTransform);
    const wasEmpty = state.items.length === 0;
    state.items.push(...loaded);
    if (wasEmpty) state.currentIndex = 0;
    recordEdit(before);

    buildThumbnails();
    fitView();
    updateUI();
    scheduleDraw();
    toast(t(loaded.length === 1 ? "{count} immagine caricata." : "{count} immagini caricate.", { count: loaded.length }));
  }

  function removeCurrent() {
    if (state.exporting) return;
    finishPointerEdit();
    const item = currentItem();
    if (!item) return;

    const before = captureEdit();
    state.items.splice(state.currentIndex, 1);

    if (!state.items.length) {
      state.currentIndex = -1;
    } else {
      state.currentIndex = Math.min(state.currentIndex, state.items.length - 1);
    }
    recordEdit(before);

    buildThumbnails();
    fitView();
    updateUI();
    scheduleDraw();
  }

  function buildThumbnails() {
    els.thumbStrip.replaceChildren();

    state.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `thumb${index === state.currentIndex ? " active" : ""}`;
      button.title = item.name;
      button.setAttribute("aria-label", `${index + 1}: ${item.name}`);

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = "";

      const badge = document.createElement("span");
      badge.className = "thumb-index";
      badge.textContent = String(index + 1);

      button.append(img, badge);
      button.addEventListener("click", () => setCurrentIndex(index));
      els.thumbStrip.appendChild(button);
    });

    scrollActiveThumbnailIntoView(false);
  }

  function scrollActiveThumbnailIntoView(smooth = true) {
    const active = els.thumbStrip.children[state.currentIndex];
    if (active) {
      active.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "nearest",
        inline: "center"
      });
    }
  }

  function setCurrentIndex(index) {
    if (!state.items.length) return;
    finishPointerEdit();
    const next = clamp(index, 0, state.items.length - 1);
    if (next === state.currentIndex) return;

    state.currentIndex = next;
    Array.from(els.thumbStrip.children).forEach((el, i) => {
      el.classList.toggle("active", i === next);
    });
    fitView();
    updateUI();
    scheduleDraw();
    scrollActiveThumbnailIntoView();
  }

  function moveCurrent(delta) {
    if (!state.items.length) return;
    setCurrentIndex(clamp(state.currentIndex + delta, 0, state.items.length - 1));
  }

  function resizeCanvas() {
    const rect = els.stageWrap.getBoundingClientRect();
    state.cssW = Math.max(1, rect.width);
    state.cssH = Math.max(1, rect.height);
    state.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const width = Math.round(state.cssW * state.dpr);
    const height = Math.round(state.cssH * state.dpr);

    if (els.canvas.width !== width || els.canvas.height !== height) {
      els.canvas.width = width;
      els.canvas.height = height;
    }

    scheduleDraw();
  }

  function getFitScale(art) {
    const pad = 56;
    return Math.max(0.000001, Math.min(
      Math.max(1, state.cssW - pad * 2) / art.width,
      Math.max(1, state.cssH - pad * 2) / art.height
    ));
  }

  function getView(item = currentItem()) {
    const art = getArtboardSize(item);
    const fit = getFitScale(art);
    const scale = fit * state.viewZoom;
    const originX = state.cssW / 2 - art.width * scale / 2 + state.viewPanX;
    const originY = state.cssH / 2 - art.height * scale / 2 + state.viewPanY;
    return { art, fit, scale, originX, originY };
  }

  function artToScreen(x, y, view = getView()) {
    return {
      x: view.originX + x * view.scale,
      y: view.originY + y * view.scale
    };
  }

  function screenToArt(x, y, view = getView()) {
    return {
      x: (x - view.originX) / view.scale,
      y: (y - view.originY) / view.scale
    };
  }

  function fitView() {
    state.viewZoom = 1;
    state.viewPanX = 0;
    state.viewPanY = 0;
    updateUI();
    scheduleDraw();
  }

  function setView100() {
    const item = currentItem();
    if (!item) return;
    const art = getArtboardSize(item);
    const fit = getFitScale(art);
    state.viewZoom = clamp(1 / fit, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    state.viewPanX = 0;
    state.viewPanY = 0;
    updateUI();
    scheduleDraw();
  }

  function zoomViewAt(screenX, screenY, factor) {
    const item = currentItem();
    if (!item) return;

    const oldView = getView(item);
    const point = screenToArt(screenX, screenY, oldView);
    const oldZoom = state.viewZoom;
    const newZoom = clamp(oldZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    if (Math.abs(newZoom - oldZoom) < 1e-9) return;

    state.viewZoom = newZoom;
    const newViewNoAdjust = getView(item);
    const newScreen = artToScreen(point.x, point.y, newViewNoAdjust);
    state.viewPanX += screenX - newScreen.x;
    state.viewPanY += screenY - newScreen.y;

    updateUI();
    scheduleDraw();
  }

  function zoomViewCenter(factor) {
    zoomViewAt(state.cssW / 2, state.cssH / 2, factor);
  }

  function imageBounds(item = currentItem()) {
    if (!item) return null;
    const t = item.transform;
    const w = item.naturalWidth * t.scaleX;
    const h = item.naturalHeight * t.scaleY;
    return {
      left: t.x - w / 2,
      top: t.y - h / 2,
      right: t.x + w / 2,
      bottom: t.y + h / 2,
      width: w,
      height: h
    };
  }

  function snapImageToArtboard(item, view = getView(item)) {
    if (!item) return;

    const art = getArtboardSize(item);
    const bounds = imageBounds(item);
    const threshold = SNAP_SCREEN_PX / Math.max(view.scale, 0.000001);

    const xCandidates = [
      { distance: Math.abs(bounds.left), delta: -bounds.left },
      { distance: Math.abs(art.width - bounds.right), delta: art.width - bounds.right }
    ].sort((a, b) => a.distance - b.distance);

    const yCandidates = [
      { distance: Math.abs(bounds.top), delta: -bounds.top },
      { distance: Math.abs(art.height - bounds.bottom), delta: art.height - bounds.bottom }
    ].sort((a, b) => a.distance - b.distance);

    if (xCandidates[0].distance <= threshold) {
      item.transform.x += xCandidates[0].delta;
    }

    if (yCandidates[0].distance <= threshold) {
      item.transform.y += yCandidates[0].delta;
    }
  }

  function resetImage(mode) {
    if (state.exporting) return;
    finishPointerEdit();
    const item = currentItem();
    if (!item) return;
    const before = captureEdit();
    const art = getArtboardSize(item);

    let scale;
    if (mode === "fit") {
      scale = Math.min(art.width / item.naturalWidth, art.height / item.naturalHeight);
    } else {
      scale = Math.max(art.width / item.naturalWidth, art.height / item.naturalHeight);
    }

    item.transform.x = art.width / 2;
    item.transform.y = art.height / 2;
    item.transform.scaleX = scale;
    item.transform.scaleY = scale;
    recordEdit(before);

    updateUI();
    scheduleDraw();
  }

  function toggleEdgePixel() {
    if (state.exporting) return;
    finishPointerEdit();
    const item = currentItem();
    if (!item) return;
    const before = captureEdit();
    item.edgePixel = !item.edgePixel;
    recordEdit(before);
    updateUI();
    scheduleDraw();
  }

  function centerImage() {
    if (state.exporting) return;
    finishPointerEdit();
    const item = currentItem();
    if (!item) return;
    const before = captureEdit();
    const art = getArtboardSize(item);
    item.transform.x = art.width / 2;
    item.transform.y = art.height / 2;
    recordEdit(before);
    updateUI();
    scheduleDraw();
  }

  function preserveTransformsForSettingsChange(oldRatio, oldSize, newRatio, newSize) {
    state.items.forEach(item => {
      const oldArt = getArtboardSize(item, oldRatio, oldSize);
      const newArt = getArtboardSize(item, newRatio, newSize);
      const t = item.transform;

      const sx = newArt.width / oldArt.width;
      const sy = newArt.height / oldArt.height;
      const longFactor = newArt.longSide / oldArt.longSide;

      t.x *= sx;
      t.y *= sy;
      t.scaleX *= longFactor;
      t.scaleY *= longFactor;
    });
  }

  function handleSettingsChange() {
    finishPointerEdit();
    const before = captureEdit();
    const oldRatio = state.ratioText;
    const oldSize = state.sizeMode;
    const newRatio = els.ratioSelect.value;
    const newSize = els.sizeSelect.value;

    preserveTransformsForSettingsChange(oldRatio, oldSize, newRatio, newSize);
    state.ratioText = newRatio;
    state.sizeMode = newSize;
    recordEdit(before);

    fitView();
    updateUI();
    scheduleDraw();
  }

  function scheduleDraw() {
    if (state.raf) return;
    state.raf = requestAnimationFrame(() => {
      state.raf = 0;
      draw();
    });
  }

  function drawCheckerboard(x, y, w, h, scale) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(x, y, w, h);

    const cell = clamp(12 * Math.sqrt(scale), 7, 16);
    ctx.fillStyle = "#cfcfcf";

    const cols = Math.ceil(w / cell) + 1;
    const rows = Math.ceil(h / cell) + 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if ((row + col) % 2 === 0) {
          ctx.fillRect(x + col * cell, y + row * cell, cell, cell);
        }
      }
    }
    ctx.restore();
  }

  function drawImageContent(out, item, art, originX = 0, originY = 0, scale = 1) {
    const b = imageBounds(item);
    const width = item.naturalWidth;
    const height = item.naturalHeight;

    if (item.edgePixel) {
      // Extend each outermost pixel row/column; corner pixels fill corner gaps.
      // The source image and its transform remain unchanged.
      const columns = [
        { source: 0, size: 1, start: 0, length: Math.max(0, b.left) },
        { source: 0, size: width, start: b.left, length: b.width },
        { source: width - 1, size: 1, start: b.right, length: Math.max(0, art.width - b.right) }
      ];
      const rows = [
        { source: 0, size: 1, start: 0, length: Math.max(0, b.top) },
        { source: 0, size: height, start: b.top, length: b.height },
        { source: height - 1, size: 1, start: b.bottom, length: Math.max(0, art.height - b.bottom) }
      ];
      out.save();
      out.imageSmoothingEnabled = false;
      rows.forEach((row, y) => columns.forEach((column, x) => {
        if ((x === 1 && y === 1) || !column.length || !row.length) return;
        out.drawImage(item.image, column.source, row.source, column.size, row.size,
          originX + column.start * scale, originY + row.start * scale,
          column.length * scale, row.length * scale);
      }));
      out.restore();
    }

    out.drawImage(item.image, originX + b.left * scale, originY + b.top * scale,
      b.width * scale, b.height * scale);
  }

  function draw() {
    const item = currentItem();

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.cssW, state.cssH);
    ctx.fillStyle = "#111418";
    ctx.fillRect(0, 0, state.cssW, state.cssH);

    if (!item) return;

    const view = getView(item);
    const { art, scale, originX, originY } = view;
    const artW = art.width * scale;
    const artH = art.height * scale;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#15171a";
    ctx.fillRect(originX, originY, artW, artH);
    ctx.restore();

    drawCheckerboard(originX, originY, artW, artH, scale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(originX, originY, artW, artH);
    ctx.clip();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawImageContent(ctx, item, art, originX, originY, scale);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(originX) + .5,
      Math.round(originY) + .5,
      Math.round(artW) - 1,
      Math.round(artH) - 1
    );
    ctx.restore();

    drawTransformBox(item, view);
  }

  function getHandlePoints(item = currentItem(), view = getView()) {
    if (!item) return [];
    const b = imageBounds(item);
    const corners = [
      { id: "nw", x: b.left, y: b.top, sx: -1, sy: -1 },
      { id: "ne", x: b.right, y: b.top, sx: 1, sy: -1 },
      { id: "se", x: b.right, y: b.bottom, sx: 1, sy: 1 },
      { id: "sw", x: b.left, y: b.bottom, sx: -1, sy: 1 }
    ];
    return corners.map(h => {
      const s = artToScreen(h.x, h.y, view);
      return { ...h, screenX: s.x, screenY: s.y };
    });
  }

  function drawTransformBox(item, view) {
    const b = imageBounds(item);
    const p1 = artToScreen(b.left, b.top, view);
    const p2 = artToScreen(b.right, b.bottom, view);

    ctx.save();
    ctx.strokeStyle = "#a8c8f6";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(
      Math.round(p1.x) + .5,
      Math.round(p1.y) + .5,
      p2.x - p1.x,
      p2.y - p1.y
    );
    ctx.setLineDash([]);

    for (const h of getHandlePoints(item, view)) {
      const active = state.hoveredHandle === h.id;
      const size = active ? HANDLE_SIZE + 2 : HANDLE_SIZE;
      ctx.fillStyle = "#f4f5f7";
      ctx.strokeStyle = "#20232a";
      ctx.lineWidth = 1;
      ctx.fillRect(h.screenX - size / 2, h.screenY - size / 2, size, size);
      ctx.strokeRect(h.screenX - size / 2 + .5, h.screenY - size / 2 + .5, size - 1, size - 1);
    }
    ctx.restore();
  }

  function hitHandle(screenX, screenY) {
    const item = currentItem();
    if (!item) return null;

    let best = null;
    let bestDist = Infinity;
    for (const h of getHandlePoints(item)) {
      const dx = screenX - h.screenX;
      const dy = screenY - h.screenY;
      const d = Math.hypot(dx, dy);
      if (d <= HANDLE_HIT && d < bestDist) {
        best = h;
        bestDist = d;
      }
    }
    return best;
  }

  function isInsideImage(screenX, screenY) {
    const item = currentItem();
    if (!item) return false;
    const artPoint = screenToArt(screenX, screenY);
    const b = imageBounds(item);
    return artPoint.x >= b.left && artPoint.x <= b.right &&
           artPoint.y >= b.top && artPoint.y <= b.bottom;
  }

  function cursorForHandle(id) {
    if (id === "nw" || id === "se") return "nwse-resize";
    if (id === "ne" || id === "sw") return "nesw-resize";
    return "default";
  }

  function updateHover(screenX, screenY) {
    if (state.pointer) return;
    if (state.spaceDown) {
      els.canvas.style.cursor = "grab";
      return;
    }

    const handle = hitHandle(screenX, screenY);
    const id = handle?.id || null;

    if (id !== state.hoveredHandle) {
      state.hoveredHandle = id;
      scheduleDraw();
    }

    if (handle) {
      els.canvas.style.cursor = cursorForHandle(handle.id);
    } else if (isInsideImage(screenX, screenY)) {
      els.canvas.style.cursor = "move";
    } else {
      els.canvas.style.cursor = "default";
    }
  }

  function pointerPosition(event) {
    const rect = els.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function beginPointer(event) {
    if (state.exporting || state.pointer) return;
    if (event.button !== 0 && event.button !== 1) return;
    const item = currentItem();
    if (!item) return;

    const p = pointerPosition(event);
    const view = getView(item);
    const artP = screenToArt(p.x, p.y, view);

    let mode = null;
    let handle = null;

    if (event.button === 1 || state.spaceDown) {
      mode = "pan-view";
    } else {
      handle = hitHandle(p.x, p.y);
      if (handle) mode = "resize";
      else if (isInsideImage(p.x, p.y)) mode = "move-image";
      else mode = "pan-view";
    }

    state.pointer = {
      id: event.pointerId,
      mode,
      beforeEdit: mode === "pan-view" ? null : captureEdit(),
      handle,
      startScreenX: p.x,
      startScreenY: p.y,
      lastScreenX: p.x,
      lastScreenY: p.y,
      startArtX: artP.x,
      startArtY: artP.y,
      startViewPanX: state.viewPanX,
      startViewPanY: state.viewPanY,
      startTransform: { ...item.transform },
      startBounds: imageBounds(item)
    };

    els.canvas.setPointerCapture(event.pointerId);
    els.canvas.classList.add("dragging");
    event.preventDefault();
  }

  function movePointer(event) {
    const p = pointerPosition(event);

    if (!state.pointer || event.pointerId !== state.pointer.id) {
      updateHover(p.x, p.y);
      return;
    }

    const item = currentItem();
    if (!item) return;

    const ptr = state.pointer;

    if (ptr.mode === "pan-view") {
      state.viewPanX = ptr.startViewPanX + (p.x - ptr.startScreenX);
      state.viewPanY = ptr.startViewPanY + (p.y - ptr.startScreenY);
      scheduleDraw();
      updateUI();
      return;
    }

    const view = getView(item);
    const artP = screenToArt(p.x, p.y, view);

    if (ptr.mode === "move-image") {
      item.transform.x = ptr.startTransform.x + (artP.x - ptr.startArtX);
      item.transform.y = ptr.startTransform.y + (artP.y - ptr.startArtY);
      snapImageToArtboard(item, view);
      scheduleDraw();
      updateUI();
      return;
    }

    if (ptr.mode === "resize") {
      resizeFromHandle(item, ptr, artP, event.altKey, event.shiftKey);
      snapResizedImageToArtboard(item, ptr, event.altKey, event.shiftKey, view);
      scheduleDraw();
      updateUI();
    }
  }

  function resizeFromHandle(item, ptr, p, fromCenter, unlockProportions) {
    const h = ptr.handle;
    const t0 = ptr.startTransform;
    const b0 = ptr.startBounds;
    const signX = h.sx;
    const signY = h.sy;

    if (!unlockProportions) {
      let centerX, centerY, vx, vy, px, py;

      if (fromCenter) {
        centerX = t0.x;
        centerY = t0.y;
        vx = signX * b0.width / 2;
        vy = signY * b0.height / 2;
        px = p.x - centerX;
        py = p.y - centerY;
      } else {
        const anchorX = signX < 0 ? b0.right : b0.left;
        const anchorY = signY < 0 ? b0.bottom : b0.top;
        vx = signX * b0.width;
        vy = signY * b0.height;
        px = p.x - anchorX;
        py = p.y - anchorY;
        centerX = anchorX;
        centerY = anchorY;
      }

      const denom = vx * vx + vy * vy;
      let factor = denom > 0 ? (px * vx + py * vy) / denom : 1;
      factor = Math.max(MIN_IMAGE_SIZE / Math.min(b0.width, b0.height), factor);

      const newW = Math.max(MIN_IMAGE_SIZE, b0.width * factor);
      const newH = Math.max(MIN_IMAGE_SIZE, b0.height * factor);

      item.transform.scaleX = newW / item.naturalWidth;
      item.transform.scaleY = newH / item.naturalHeight;

      if (fromCenter) {
        item.transform.x = t0.x;
        item.transform.y = t0.y;
      } else {
        const anchorX = signX < 0 ? b0.right : b0.left;
        const anchorY = signY < 0 ? b0.bottom : b0.top;
        item.transform.x = anchorX + signX * newW / 2;
        item.transform.y = anchorY + signY * newH / 2;
      }
      return;
    }

    if (fromCenter) {
      const halfW = Math.max(MIN_IMAGE_SIZE / 2, Math.abs(p.x - t0.x));
      const halfH = Math.max(MIN_IMAGE_SIZE / 2, Math.abs(p.y - t0.y));
      item.transform.x = t0.x;
      item.transform.y = t0.y;
      item.transform.scaleX = (halfW * 2) / item.naturalWidth;
      item.transform.scaleY = (halfH * 2) / item.naturalHeight;
    } else {
      const anchorX = signX < 0 ? b0.right : b0.left;
      const anchorY = signY < 0 ? b0.bottom : b0.top;
      const newW = Math.max(MIN_IMAGE_SIZE, Math.abs(p.x - anchorX));
      const newH = Math.max(MIN_IMAGE_SIZE, Math.abs(p.y - anchorY));
      item.transform.x = anchorX + signX * newW / 2;
      item.transform.y = anchorY + signY * newH / 2;
      item.transform.scaleX = newW / item.naturalWidth;
      item.transform.scaleY = newH / item.naturalHeight;
    }
  }

  function snapResizedImageToArtboard(item, ptr, fromCenter, unlockProportions, view) {
    const bounds = imageBounds(item);
    const threshold = SNAP_SCREEN_PX / Math.max(view.scale, 0.000001);
    const anchorX = fromCenter ? ptr.startTransform.x :
      (ptr.handle.sx < 0 ? ptr.startBounds.right : ptr.startBounds.left);
    const anchorY = fromCenter ? ptr.startTransform.y :
      (ptr.handle.sy < 0 ? ptr.startBounds.bottom : ptr.startBounds.top);
    const candidates = [];

    function consider(axis, edge, target, anchor, moving) {
      if (!moving || Math.abs(edge - target) > threshold) return;
      const factor = (target - anchor) / (edge - anchor);
      const width = bounds.width * (axis === "x" || !unlockProportions ? factor : 1);
      const height = bounds.height * (axis === "y" || !unlockProportions ? factor : 1);
      if (!Number.isFinite(factor) || width < MIN_IMAGE_SIZE || height < MIN_IMAGE_SIZE) return;
      candidates.push({ axis, factor, distance: Math.abs(edge - target) });
    }

    consider("x", bounds.left, 0, anchorX, fromCenter || ptr.handle.sx < 0);
    consider("x", bounds.right, view.art.width, anchorX, fromCenter || ptr.handle.sx > 0);
    consider("y", bounds.top, 0, anchorY, fromCenter || ptr.handle.sy < 0);
    consider("y", bounds.bottom, view.art.height, anchorY, fromCenter || ptr.handle.sy > 0);
    candidates.sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return;

    // With locked proportions, one scale factor snaps the nearest moving edge.
    // Free scaling can snap each axis independently. The anchor never moves.
    const factorX = unlockProportions ? candidates.find(c => c.axis === "x")?.factor ?? 1 : candidates[0].factor;
    const factorY = unlockProportions ? candidates.find(c => c.axis === "y")?.factor ?? 1 : candidates[0].factor;
    const width = bounds.width * factorX;
    const height = bounds.height * factorY;
    item.transform.scaleX = width / item.naturalWidth;
    item.transform.scaleY = height / item.naturalHeight;
    item.transform.x = fromCenter ? anchorX : anchorX + ptr.handle.sx * width / 2;
    item.transform.y = fromCenter ? anchorY : anchorY + ptr.handle.sy * height / 2;
  }

  function endPointer(event) {
    if (!state.pointer || event.pointerId !== state.pointer.id) return;
    finishPointerEdit();
    const p = pointerPosition(event);
    updateHover(p.x, p.y);
  }

  function updateUI() {
    setModeBusy("ridimensiona", state.exporting);
    if (!state.exporting) els.exportStatus.textContent = t("Esporta ZIP");
    const item = currentItem();
    const has = Boolean(item);
    const count = state.items.length;

    els.emptyState.classList.toggle("hidden", has);
    els.removeBtn.disabled = !has || state.exporting;
    els.undoBtn.disabled = !state.undoStack.length || state.exporting;
    els.fillBtn.disabled = !has || state.exporting;
    els.fitImageBtn.disabled = !has || state.exporting;
    els.edgePixelBtn.disabled = !has || state.exporting;
    els.edgePixelBtn.setAttribute("aria-pressed", String(Boolean(item?.edgePixel)));
    els.centerBtn.disabled = !has || state.exporting;
    els.exportAllTopBtn.disabled = !has || state.exporting;
    els.prevBtn.disabled = !has || state.currentIndex <= 0 || state.exporting;
    els.nextBtn.disabled = !has || state.currentIndex >= count - 1 || state.exporting;

    els.counterLabel.textContent = count
      ? `${state.currentIndex + 1} / ${count}`
      : t("{count} immagini", { count: 0 });

    if (!item) {
      els.currentName.textContent = "—";
      els.originalSize.textContent = "—";
      els.outputSize.textContent = "—";
      els.imageScaleLabel.textContent = "—";
      els.viewScaleLabel.textContent = "100%";
      return;
    }

    const art = getArtboardSize(item);
    const avgScale = (item.transform.scaleX + item.transform.scaleY) / 2;
    const view = getView(item);

    els.currentName.textContent = item.name;
    els.currentName.title = item.name;
    els.originalSize.textContent = `${item.naturalWidth} × ${item.naturalHeight}`;
    els.outputSize.textContent = `${art.width} × ${art.height}`;
    els.imageScaleLabel.textContent = `${(avgScale * 100).toFixed(avgScale < .1 ? 2 : 1)}%`;
    els.viewScaleLabel.textContent = `${(view.scale * 100).toFixed(view.scale < .1 ? 2 : 1)}%`;
  }

  function buildExportCanvas(item) {
    const art = getArtboardSize(item);
    const canvas = document.createElement("canvas");
    canvas.width = art.width;
    canvas.height = art.height;
    const out = canvas.getContext("2d", { alpha: true });

    if (els.formatSelect.value === "jpeg") {
      out.fillStyle = "#ffffff";
      out.fillRect(0, 0, art.width, art.height);
    } else {
      out.clearRect(0, 0, art.width, art.height);
    }

    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = "high";
    drawImageContent(out, item, art);
    return canvas;
  }

  function canvasToBlob(canvas) {
    const format = els.formatSelect.value;
    const mime = mimeFor(format);
    const quality = Number(els.qualityRange.value) / 100;

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error(t("Impossibile creare il file immagine."))),
        mime,
        format === "png" ? undefined : quality
      );
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }


  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = ((date.getHours() & 0x1F) << 11) |
                 ((date.getMinutes() & 0x3F) << 5) |
                 ((Math.floor(date.getSeconds() / 2)) & 0x1F);
    const day = ((year - 1980) << 9) |
                (((date.getMonth() + 1) & 0x0F) << 5) |
                (date.getDate() & 0x1F);
    return { time, day };
  }

  function makeZipLocalHeader(nameBytes, crc, size, time, day) {
    const b = new ArrayBuffer(30 + nameBytes.length);
    const v = new DataView(b);
    let o = 0;
    v.setUint32(o, 0x04034B50, true); o += 4;
    v.setUint16(o, 20, true); o += 2;
    v.setUint16(o, 0x0800, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, time, true); o += 2;
    v.setUint16(o, day, true); o += 2;
    v.setUint32(o, crc, true); o += 4;
    v.setUint32(o, size, true); o += 4;
    v.setUint32(o, size, true); o += 4;
    v.setUint16(o, nameBytes.length, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    new Uint8Array(b, o).set(nameBytes);
    return new Uint8Array(b);
  }

  function makeZipCentralHeader(nameBytes, crc, size, time, day, offset) {
    const b = new ArrayBuffer(46 + nameBytes.length);
    const v = new DataView(b);
    let o = 0;
    v.setUint32(o, 0x02014B50, true); o += 4;
    v.setUint16(o, 20, true); o += 2;
    v.setUint16(o, 20, true); o += 2;
    v.setUint16(o, 0x0800, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, time, true); o += 2;
    v.setUint16(o, day, true); o += 2;
    v.setUint32(o, crc, true); o += 4;
    v.setUint32(o, size, true); o += 4;
    v.setUint32(o, size, true); o += 4;
    v.setUint16(o, nameBytes.length, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint32(o, 0, true); o += 4;
    v.setUint32(o, offset, true); o += 4;
    new Uint8Array(b, o).set(nameBytes);
    return new Uint8Array(b);
  }

  function makeZipEnd(count, centralSize, centralOffset) {
    const b = new ArrayBuffer(22);
    const v = new DataView(b);
    let o = 0;
    v.setUint32(o, 0x06054B50, true); o += 4;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, 0, true); o += 2;
    v.setUint16(o, count, true); o += 2;
    v.setUint16(o, count, true); o += 2;
    v.setUint32(o, centralSize, true); o += 4;
    v.setUint32(o, centralOffset, true); o += 4;
    v.setUint16(o, 0, true);
    return new Uint8Array(b);
  }

  async function createZip(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, day } = dosDateTime();

    for (const entry of entries) {
      const nameBytes = encoder.encode(entry.name);
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      const crc = crc32(bytes);
      const size = bytes.byteLength;
      const localHeader = makeZipLocalHeader(nameBytes, crc, size, time, day);
      const centralHeader = makeZipCentralHeader(nameBytes, crc, size, time, day, offset);
      localParts.push(localHeader, entry.blob);
      centralParts.push(centralHeader);
      offset += localHeader.byteLength + size;
    }

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);
    const end = makeZipEnd(entries.length, centralSize, centralOffset);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function zipFileName() {
    if (els.namingSelect.value === "sequence") {
      return `${sanitizeBaseName(els.baseNameInput.value, "images")}.zip`;
    }
    return "resized_images.zip";
  }

  async function exportItems(itemsWithIndices) {
    if (state.exporting || !itemsWithIndices.length) return;

    state.exporting = true;
    updateUI();
    const total = itemsWithIndices.length;
    let done = 0;

    try {
      const entries = [];
      for (const { item, index } of itemsWithIndices) {
        setExportStatus(t("Preparazione ZIP {current} / {total}…", { current: done + 1, total }));
        const canvas = buildExportCanvas(item);
        const blob = await canvasToBlob(canvas);
        entries.push({ name: outputFileName(item, index), blob });
        done++;
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      setExportStatus(t("Creazione ZIP…"));
      const zip = await createZip(entries);
      downloadBlob(zip, zipFileName());
      setExportStatus(t(done === 1 ? "{count} immagine aggiunta allo ZIP" : "{count} immagini aggiunte allo ZIP", { count: done }), "good");
      toast(t(done === 1 ? "Esportazione completata: {count} immagine." : "Esportazione completata: {count} immagini.", { count: done }));
    } catch (err) {
      console.error(err);
      setExportStatus(err.message || t("Errore durante l’esportazione"), "bad");
      toast(err.message || t("Esportazione interrotta."));
    } finally {
      state.exporting = false;
      updateUI();
    }
  }

  function exportAll() {
    exportItems(state.items.map((item, index) => ({ item, index })));
  }

  function onWheel(event) {
    if (!currentItem()) return;
    event.preventDefault();
    const p = pointerPosition(event);
    const speed = event.ctrlKey ? 0.0015 : 0.001;
    const factor = Math.exp(-event.deltaY * speed);
    zoomViewAt(p.x, p.y, factor);
  }

  function isTypingTarget(target) {
    return target instanceof HTMLInputElement ||
           target instanceof HTMLSelectElement ||
           target instanceof HTMLTextAreaElement || target.isContentEditable;
  }

  function onKeyDown(event) {
    if (!isModeActive("ridimensiona")) return;
    if (isTypingTarget(event.target)) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey &&
        event.key.toLowerCase() === "z") {
      event.preventDefault();
      undoEdit();
      return;
    }

    if (event.code === "Space") {
      state.spaceDown = true;
      els.canvas.style.cursor = "grab";
      event.preventDefault();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      fitView();
      event.preventDefault();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === "1") {
      setView100();
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowLeft") {
      moveCurrent(-1);
      event.preventDefault();
    } else if (event.key === "ArrowRight") {
      moveCurrent(1);
      event.preventDefault();
    } else if (event.key === "+" || event.key === "=") {
      zoomViewCenter(1.16);
      event.preventDefault();
    } else if (event.key === "-" || event.key === "_") {
      zoomViewCenter(1 / 1.16);
      event.preventDefault();
    } else if ((event.key === "Delete" || event.key === "Backspace") && currentItem()) {
      removeCurrent();
      event.preventDefault();
    }
  }

  function onKeyUp(event) {
    if (!isModeActive("ridimensiona")) return;
    if (event.code === "Space") {
      state.spaceDown = false;
      if (!state.pointer) els.canvas.style.cursor = "default";
      event.preventDefault();
    }
  }

  function handleDragEnter(event) {
    event.preventDefault();
    state.dragDepth++;
    els.dropOverlay.classList.add("show");
  }

  function handleDragLeave(event) {
    event.preventDefault();
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) els.dropOverlay.classList.remove("show");
  }

  function handleDrop(event) {
    event.preventDefault();
    state.dragDepth = 0;
    els.dropOverlay.classList.remove("show");
    addFiles(event.dataTransfer?.files);
  }

  els.addImagesBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    addFiles(els.fileInput.files);
    els.fileInput.value = "";
  });

  els.removeBtn.addEventListener("click", removeCurrent);
  els.undoBtn.addEventListener("click", undoEdit);
  els.ratioSelect.addEventListener("change", handleSettingsChange);
  els.sizeSelect.addEventListener("change", handleSettingsChange);
  els.fillBtn.addEventListener("click", () => resetImage("fill"));
  els.fitImageBtn.addEventListener("click", () => resetImage("fit"));
  els.edgePixelBtn.addEventListener("click", toggleEdgePixel);
  els.centerBtn.addEventListener("click", centerImage);

  els.zoomOutBtn.addEventListener("click", () => zoomViewCenter(1 / 1.16));
  els.zoomInBtn.addEventListener("click", () => zoomViewCenter(1.16));
  els.fitViewBtn.addEventListener("click", fitView);

  els.prevBtn.addEventListener("click", () => moveCurrent(-1));
  els.nextBtn.addEventListener("click", () => moveCurrent(1));

  els.exportAllTopBtn.addEventListener("click", exportAll);

  els.namingSelect.addEventListener("change", () => {
    els.namingCustom.classList.toggle("hidden", els.namingSelect.value !== "sequence");
  });

  els.formatSelect.addEventListener("change", () => {
    els.qualityRow.style.display = els.formatSelect.value === "png" ? "none" : "grid";
  });

  els.qualityRange.addEventListener("input", () => {
    els.qualityValue.textContent = els.qualityRange.value;
  });

  els.canvas.addEventListener("pointerdown", beginPointer);
  els.canvas.addEventListener("pointermove", movePointer);
  els.canvas.addEventListener("pointerup", endPointer);
  els.canvas.addEventListener("pointercancel", endPointer);
  els.canvas.addEventListener("wheel", onWheel, { passive: false });
  els.canvas.addEventListener("contextmenu", e => e.preventDefault());

  document.addEventListener("workspace:modechange", () => {
    finishPointerEdit();
    state.spaceDown = false;
    els.canvas.style.cursor = "default";
    if (isModeActive("ridimensiona")) resizeCanvas();
  });

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });
  window.addEventListener("blur", () => {
    state.spaceDown = false;
    if (!state.pointer) els.canvas.style.cursor = "default";
  });

  els.stageWrap.addEventListener("dragenter", handleDragEnter);
  els.stageWrap.addEventListener("dragover", e => e.preventDefault());
  els.stageWrap.addEventListener("dragleave", handleDragLeave);
  els.stageWrap.addEventListener("drop", handleDrop);

  const resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(els.stageWrap);

  window.addEventListener("pagehide", (event) => {
    // A canceled navigation must retain resources for all three workspaces.
    if (event.persisted) return;
    const urls = new Set([
      ...state.items.map(item => item.url),
      ...state.undoStack.flatMap(edit => edit.items.map(item => item.url))
    ]);
    urls.forEach(url => URL.revokeObjectURL(url));
  });

  document.addEventListener("bib:languagechange", updateUI);
  resizeCanvas();
  updateUI();
  draw();
})();
  
