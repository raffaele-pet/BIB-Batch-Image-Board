import { t } from "./i18n.js?v=20261107-home";
import { createSelection, pairCount, importFiles, excludeImage, undoExclusion, navigate, exportEntries } from "./selection-model.js?v=20261107-home";
import { ImageZip } from "./selection-zip.js?v=20261107-home";
import { updateThumbnail } from "./workspace-ui.js";
import { isModeActive, setModeBusy } from "./workspace-navigation.js?v=20261107-home";

const $ = (id) => document.getElementById(id);
const selection = createSelection();
const app = $("selectionApp");
const stage = $("selectionStage");
const canvas = $("selectionCanvas");
const context = canvas.getContext("2d");
let busy = false;
let dirty = false;
let slider = 0.5;
let renderVersion = 0;
let previews = { left: null, right: null };
let dragging = null;

function refreshControls() {
  const total = pairCount(selection);
  const kept = selection.left.concat(selection.right).filter((entry) => !entry.excluded).length;
  $("pairCounter").textContent = `${total ? selection.index + 1 : 0} / ${total}`;
  $("keptCount").textContent = t("{count} da salvare", { count: kept });
  $("previousPair").disabled = busy || selection.index === 0;
  $("nextPair").disabled = busy || selection.index >= total - 1;
  $("undoSelection").disabled = busy || !selection.history.length;
  $("saveSelection").disabled = busy || !kept;
  $("saveLabel").textContent = t(busy ? "Creazione ZIP…" : "Esporta ZIP");
  $("imageFormat").disabled = busy;
  $("selectionNaming").disabled = busy;
  $("selectionBaseName").disabled = busy;
  $("selectionHandle").tabIndex = total && !busy ? 0 : -1;
  $("selectionHandle").setAttribute("aria-disabled", String(busy || !total));
  setModeBusy("selezione", busy);
  app.querySelectorAll("[data-pick], input[type=file]").forEach((input) => { input.disabled = busy; });
  for (const side of ["left", "right"]) {
    const collection = selection[side];
    const entry = collection[selection.index];
    const title = side === "left" ? "Left" : "Right";
    $(side + "Count").textContent = t(collection.length === 1 ? "{count} immagine" : "{count} immagini", { count: collection.length });
    $("remove" + title).disabled = busy || !entry || entry.excluded;
  }
}

function showEmptySide(side, showUpload, message = "") {
  const element = $(side + "Empty");
  const error = element.querySelector(".selection-preview-error");
  element.querySelector(".stage-import").hidden = !showUpload;
  error.textContent = message;
  error.hidden = !message;
  element.hidden = !showUpload && !message;
}

function decode(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t("Impossibile leggere “{name}”.", { name: file.name }))); };
    image.src = url;
  });
}

async function renderPair() {
  const version = ++renderVersion;
  previews = { left: null, right: null };
  stage.classList.toggle("has-images", Boolean(pairCount(selection)));
  refreshControls();
  for (const side of ["left", "right"]) {
    updateThumbnail(side + "Thumb", null);
    const entry = selection[side][selection.index];
    showEmptySide(side, !entry || entry.excluded);
  }
  draw();
  await Promise.all(["left", "right"].map(async (side) => {
    const entry = selection[side][selection.index];
    if (!entry || entry.excluded) return;
    try {
      const image = await decode(entry.file);
      if (version !== renderVersion) return;
      previews[side] = image;
      updateThumbnail(side + "Thumb", image);
    } catch (error) {
      if (version !== renderVersion) return;
      showEmptySide(side, false, error.message);
    }
    draw();
  }));
}

function draw() {
  if (!isModeActive("selezione")) return;
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  for (const side of ["left", "right"]) {
    const image = previews[side];
    if (!image) continue;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    context.save();
    context.beginPath();
    context.rect(side === "left" ? 0 : slider * width, 0, side === "left" ? slider * width : (1 - slider) * width, height);
    context.clip();
    context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    context.restore();
  }
  $("selectionDivider").style.left = `${slider * 100}%`;
  $("selectionHandle").setAttribute("aria-valuenow", String(Math.round(slider * 100)));
  // Keep the upload controls within the visible portion of their side.
  $("leftEmpty").style.width = `${slider * 100}%`;
  $("rightEmpty").style.width = `${(1 - slider) * 100}%`;
}
new ResizeObserver(draw).observe(stage);

for (const side of ["left", "right"]) {
  for (const suffix of ["Files", "Folder"]) {
    $(side + suffix).addEventListener("change", (event) => {
      if (busy || !event.target.files.length) return;
      const files = Array.from(event.target.files);
      const count = importFiles(selection, side, files);
      event.target.value = "";
      if (!count) { alert(t("Nessuna immagine trovata nella selezione.")); return; }
      slider = 0.5;
      dirty = true;
      renderPair();
    });
  }
  $("remove" + (side === "left" ? "Left" : "Right")).addEventListener("click", () => {
    if (busy || !excludeImage(selection, side)) return;
    slider = 0.5;
    dirty = true;
    renderPair();
  });
}
app.querySelectorAll("[data-pick]").forEach((button) => {
  button.addEventListener("click", () => $(button.dataset.pick).click());
});

function move(delta) {
  if (busy) return;
  navigate(selection, delta);
  renderPair();
}
function undo() {
  if (busy || !undoExclusion(selection)) return;
  dirty = true;
  renderPair();
}
$("previousPair").addEventListener("click", () => move(-1));
$("nextPair").addEventListener("click", () => move(1));
$("undoSelection").addEventListener("click", undo);
document.addEventListener("keydown", (event) => {
  if (!isModeActive("selezione") || busy || event.target.closest("input, select, textarea, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
    event.preventDefault(); undo();
  } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.target !== $("selectionHandle")) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
    }
  }
});

function setSlider(value) { slider = Math.max(0, Math.min(1, value)); draw(); }
stage.addEventListener("pointerdown", (event) => {
  if (busy || !pairCount(selection) || event.button !== 0 || event.target.closest("button")) return;
  dragging = event.pointerId;
  stage.setPointerCapture(event.pointerId);
  setSlider((event.clientX - stage.getBoundingClientRect().left) / stage.clientWidth);
});
stage.addEventListener("pointermove", (event) => {
  if (dragging === event.pointerId) setSlider((event.clientX - stage.getBoundingClientRect().left) / stage.clientWidth);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) stage.addEventListener(type, () => { dragging = null; });
$("selectionHandle").addEventListener("keydown", (event) => {
  if (busy) return;
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    setSlider(event.key === "Home" ? 0 : event.key === "End" ? 1 : slider + (event.key === "ArrowLeft" ? -0.02 : 0.02));
  }
});

async function convert(file, format) {
  const image = await decode(file);
  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const ctx = output.getContext("2d");
  if (!ctx || !output.width || !output.height) throw new Error(t("Dimensioni non supportate: {name}", { name: file.name }));
  if (format === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, output.width, output.height); }
  ctx.drawImage(image, 0, 0);
  try {
    return await new Promise((resolve, reject) => output.toBlob((blob) => {
      if (blob && blob.type === (format === "jpg" ? "image/jpeg" : "image/png")) resolve(blob);
      else reject(new Error(t("Conversione non riuscita: {name}", { name: file.name })));
    }, format === "jpg" ? "image/jpeg" : "image/png", 0.95));
  } finally { output.width = output.height = 0; }
}

function download(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "immagini-selezionate.zip";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

$("selectionNaming").addEventListener("change", () => {
  $("selectionNamingCustom").hidden = $("selectionNaming").value !== "sequence";
});

$("saveSelection").addEventListener("click", async () => {
  if (busy) return;
  const format = $("imageFormat").value;
  const baseName = $("selectionNaming").value === "sequence" ? $("selectionBaseName").value : null;
  const entries = exportEntries(selection, format, baseName);
  if (!entries.length) return;
  let completed = 0;
  busy = true;
  refreshControls();
  try {
    const zip = new ImageZip();
    for (const entry of entries) {
      $("saveLabel").textContent = t("Preparazione ZIP {current} / {total}…", { current: completed + 1, total: entries.length });
      const blob = await convert(entry.file, format);
      await zip.add(entry.name, blob);
      completed++;
    }
    download(zip.toBlob());
    dirty = false;
  } catch (error) {
    alert(`${t(error.message)} ${t("Lo ZIP non è stato scaricato.")} ${t("La selezione è conservata: puoi correggere e riprovare.")}`);
  } finally { busy = false; refreshControls(); }
});

window.addEventListener("beforeunload", (event) => {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ""; }
});
refreshControls();
document.addEventListener("workspace:modechange", (event) => {
  if (event.detail.mode === "selezione") renderPair();
});
if (isModeActive("selezione")) renderPair();

document.addEventListener("bib:languagechange", () => {
  refreshControls();
  if (isModeActive("selezione")) renderPair();
});
