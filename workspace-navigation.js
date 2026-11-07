import { t } from "./i18n.js?v=20261107-home";
const modes = {
  confronto: { app: "sliderApp", link: "sliderMode", title: "Confronto immagini", short: "Confronto", description: "Due immagini, ogni dettaglio. Confronta e crea un prima e dopo." },
  selezione: { app: "selectionApp", link: "selectionMode", title: "Selezione immagini", short: "Selezione", description: "Confronta le tue raccolte e conserva le immagini che preferisci." },
  ridimensiona: { app: "resizeApp", link: "resizeMode", title: "Ridimensiona immagini", short: "Ridimensiona", description: "Imposta formato e composizione, poi esporta l’intera raccolta." }
};
const locks = new Set();
const workspace = document.getElementById("workspace");
const home = document.getElementById("home");
const heading = document.getElementById("workspaceHeading");
const routes = document.querySelectorAll("[data-mode]");
let currentMode = "";

export function isModeActive(mode) { return currentMode === mode; }

export function setModeBusy(mode, busy) {
  if (busy) locks.add(mode);
  else locks.delete(mode);
  for (const link of routes) link.setAttribute("aria-disabled", String(Boolean(locks.size)));
}

function updateHeading() {
  const mode = modes[currentMode];
  document.title = mode ? `${t(mode.short)} — BIB` : "BIB — Batch Image Board";
  if (!mode) return;
  document.getElementById("workspaceTitle").textContent = t(mode.title);
  document.getElementById("workspaceDescription").textContent = t(mode.description);
}

function showMode(mode) {
  if (locks.size) return false;
  currentMode = mode;
  home.hidden = Boolean(mode);
  heading.hidden = !mode;
  const brand = document.querySelector(".brand");
  if (mode) brand.removeAttribute("aria-current");
  else brand.setAttribute("aria-current", "page");
  for (const [key, definition] of Object.entries(modes)) {
    document.getElementById(definition.app).hidden = key !== mode;
    const link = document.getElementById(definition.link);
    if (key === mode) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  updateHeading();
  document.dispatchEvent(new CustomEvent("workspace:modechange", { detail: { mode } }));
  return true;
}

function modeUrl(mode) {
  return mode ? `#${mode}` : location.pathname + location.search;
}

function modeFromHash() {
  const mode = location.hash.slice(1);
  return Object.hasOwn(modes, mode) ? mode : "";
}

for (const link of routes) {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const mode = link.dataset.mode;
    if (mode === currentMode || !showMode(mode)) return;
    history.pushState(null, "", modeUrl(mode));
    workspace.focus();
  });
}
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  workspace.focus();
});
window.addEventListener("hashchange", () => {
  if (!showMode(modeFromHash())) history.replaceState(null, "", modeUrl(currentMode));
});
showMode(modeFromHash());
document.addEventListener("bib:languagechange", updateHeading);
