import { t } from "./i18n.js?v=20261106-header";
const modes = {
  confronto: { app: "sliderApp", link: "sliderMode", title: "Confronto immagini", short: "Confronto", description: "Due immagini, ogni dettaglio. Confronta e crea un prima e dopo." },
  selezione: { app: "selectionApp", link: "selectionMode", title: "Selezione immagini", short: "Selezione", description: "Confronta le tue raccolte e conserva le immagini che preferisci." },
  ridimensiona: { app: "resizeApp", link: "resizeMode", title: "Ridimensiona immagini", short: "Ridimensiona", description: "Imposta formato e composizione, poi esporta l’intera raccolta." }
};
const locks = new Set();
let currentMode = null;

export function isModeActive(mode) { return currentMode === mode; }

export function setModeBusy(mode, busy) {
  if (busy) locks.add(mode);
  else locks.delete(mode);
  for (const definition of Object.values(modes)) {
    document.getElementById(definition.link).setAttribute("aria-disabled", String(Boolean(locks.size)));
  }
}

function showMode(mode) {
  if (!modes[mode] || locks.size) return false;
  currentMode = mode;
  for (const [key, definition] of Object.entries(modes)) {
    document.getElementById(definition.app).hidden = key !== mode;
    const link = document.getElementById(definition.link);
    if (key === mode) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.getElementById("workspaceTitle").textContent = t(modes[mode].title);
  document.getElementById("workspaceDescription").textContent = t(modes[mode].description);
  document.title = `${t(modes[mode].short)} — BIB`;
  document.dispatchEvent(new CustomEvent("workspace:modechange", { detail: { mode } }));
  return true;
}

for (const [mode, definition] of Object.entries(modes)) {
  document.getElementById(definition.link).addEventListener("click", (event) => {
    event.preventDefault();
    if (showMode(mode)) history.replaceState(null, "", `#${mode}`);
  });
}
window.addEventListener("hashchange", () => {
  const mode = location.hash.slice(1);
  if (!modes[mode]) return;
  if (!showMode(mode)) history.replaceState(null, "", `#${currentMode}`);
});
showMode(modes[location.hash.slice(1)] ? location.hash.slice(1) : "confronto");

document.addEventListener("bib:languagechange", () => {
  const mode = modes[currentMode];
  document.getElementById("workspaceTitle").textContent = t(mode.title);
  document.getElementById("workspaceDescription").textContent = t(mode.description);
  document.title = `${t(mode.short)} — BIB`;
});
