import { createSelection, pairCount, importFiles, excludeImage, undoExclusion, navigate, exportEntries } from "./selection-model.js";
import { ImageZip } from "./selection-zip.js";
import { writeFolderImage } from "./selection-folder.js";
import { updateThumbnail } from "./workspace-ui.js";

const $ = (id) => document.getElementById(id);
const selection = createSelection();
const app = $("selectionApp");
const stage = $("selectionStage");
const canvas = $("selectionCanvas");
const context = canvas.getContext("2d");
const modeButtons = [$("sliderMode"), $("selectionMode")];
let active = false;
let busy = false;
let dirty = false;
let slider = 0.5;
let renderVersion = 0;
let previews = { left: null, right: null };
let dragging = null;

function setMode(next) {
  if (busy || document.querySelector(".recording")) return false;
  active = next;
  $("sliderApp").hidden = next;
  app.hidden = !next;
  modeButtons.forEach((button, i) => {
    if (Boolean(i) === next) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $("workspaceTitle").textContent = next ? "Selezione immagini" : "Confronto immagini";
  $("workspaceDescription").textContent = next ? "Confronta le tue raccolte e conserva le immagini che preferisci." :
    "Due immagini, ogni dettaglio. Confronta e crea un prima e dopo.";
  document.title = `${next ? "Selezione" : "Confronto"} — Batch Studio`;
  if (next) renderPair();
  return true;
}
modeButtons.forEach((link, i) => link.addEventListener("click", (event) => {
  event.preventDefault();
  if (setMode(Boolean(i))) history.replaceState(null, "", link.getAttribute("href"));
}));
window.addEventListener("hashchange", () => {
  if (!["#selezione", "#confronto"].includes(location.hash)) return;
  if (!setMode(location.hash === "#selezione")) history.replaceState(null, "", active ? "#selezione" : "#confronto");
});

function refreshControls() {
  const total = pairCount(selection);
  const kept = selection.left.concat(selection.right).filter((entry) => !entry.excluded).length;
  $("pairCounter").textContent = `${total ? selection.index + 1 : 0} / ${total}`;
  $("keptCount").textContent = `${kept} da salvare`;
  $("previousPair").disabled = busy || selection.index === 0;
  $("nextPair").disabled = busy || selection.index >= total - 1;
  $("undoSelection").disabled = busy || !selection.history.length;
  $("saveSelection").disabled = busy || !kept;
  $("saveLabel").textContent = busy ? "Salvataggio…" : "Salva immagini";
  $("imageFormat").disabled = busy;
  $("saveDestination").disabled = busy;
  $("selectionHandle").tabIndex = total && !busy ? 0 : -1;
  $("selectionHandle").setAttribute("aria-disabled", String(busy || !total));
  modeButtons.forEach((button) => { button.setAttribute("aria-disabled", String(busy)); });
  app.querySelectorAll("[data-pick], input[type=file]").forEach((input) => { input.disabled = busy; });
  for (const side of ["left", "right"]) {
    const collection = selection[side];
    const entry = collection[selection.index];
    const title = side === "left" ? "Left" : "Right";
    $(side + "Count").textContent = `${collection.length} ${collection.length === 1 ? "immagine" : "immagini"}`;
    $("remove" + title).disabled = busy || !entry || entry.excluded;
    const name = entry ? (entry.file.webkitRelativePath || entry.file.name) + (entry.excluded ? " · esclusa" : "") : "Nessuna immagine";
    $(side + "Name").textContent = name;
    $(side + "Name").title = name;
  }
}

function emptyLabel(side, message) {
  const element = $(side + "Empty");
  if (message === "initial") {
    // Keep the same empty-state structure as the comparison workspace.
    element.replaceChildren();
    const content = document.createElement("div");
    content.className = "empty-content";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "empty-icon");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-folder");
    icon.append(use);
    const title = document.createElement("strong");
    title.textContent = side === "left" ? "Sinistra" : "Destra";
    const text = document.createElement("span");
    text.textContent = "Carica immagini o una cartella";
    content.append(icon, title, text);
    element.append(content);
  } else element.textContent = message;
  element.hidden = !message;
}

function decode(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Impossibile leggere “${file.name}”.`)); };
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
    emptyLabel(side, !entry ? (selection[side].length ? "Nessuna immagine in questa posizione" : "initial") :
      entry.excluded ? "Immagine esclusa · Ctrl+Z per ripristinare" : "Caricamento…");
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
      emptyLabel(side, "");
    } catch (error) {
      if (version !== renderVersion) return;
      emptyLabel(side, error.message);
    }
    draw();
  }));
}

function draw() {
  if (!active) return;
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
  // Empty-side labels follow the reveal boundary, so an excluded side stays empty.
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
      if (!count) { alert("Nessuna immagine trovata nella selezione."); return; }
      slider = 0.5;
      dirty = true;
      renderPair();
    });
  }
  $("remove" + (side === "left" ? "Left" : "Right")).addEventListener("click", () => {
    if (busy || !excludeImage(selection, side)) return;
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
  if (!active || busy || event.target.closest("input, select, textarea, [contenteditable=true]")) return;
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
  if (busy || event.button !== 0 || event.target.closest("button")) return;
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
  if (!ctx || !output.width || !output.height) throw new Error(`Dimensioni non supportate: ${file.name}`);
  if (format === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, output.width, output.height); }
  ctx.drawImage(image, 0, 0);
  try {
    return await new Promise((resolve, reject) => output.toBlob((blob) => {
      if (blob && blob.type === (format === "jpg" ? "image/jpeg" : "image/png")) resolve(blob);
      else reject(new Error(`Conversione non riuscita: ${file.name}`));
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

const folderSupported = typeof window.showDirectoryPicker === "function";
if (!folderSupported) {
  $("saveDestination").querySelector('[value="folder"]').disabled = true;
  $("saveDestination").value = "zip";
}

$("saveSelection").addEventListener("click", async () => {
  if (busy) return;
  const format = $("imageFormat").value;
  const entries = exportEntries(selection, format);
  if (!entries.length) return;
  const inFolder = $("saveDestination").value === "folder";
  let completed = 0;
  busy = true;
  refreshControls();
  try {
    // Call the picker before any await to retain the browser's user activation.
    const folder = inFolder ? await window.showDirectoryPicker({ mode: "readwrite", id: "selected-images" }) : null;
    const occupied = new Set();
    if (folder) for await (const name of folder.keys()) occupied.add(name.toLowerCase());
    const zip = folder ? null : new ImageZip();
    for (const entry of entries) {
      $("saveLabel").textContent = `Salvataggio ${completed + 1} / ${entries.length}`;
      const blob = await convert(entry.file, format);
      if (folder) {
        await writeFolderImage(folder, entry.name, blob, occupied);
      } else await zip.add(entry.name, blob);
      completed++;
    }
    if (zip) download(zip.toBlob());
    dirty = false;
  } catch (error) {
    if (error.name !== "AbortError" || completed) {
      alert(`${error.message} ${inFolder ? `${completed} di ${entries.length} immagini salvate.` : "Lo ZIP non è stato scaricato."} La selezione è conservata: puoi correggere e riprovare.`);
    }
  } finally { busy = false; refreshControls(); }
});

window.addEventListener("beforeunload", (event) => {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ""; }
});
refreshControls();
setMode(location.hash === "#selezione");
