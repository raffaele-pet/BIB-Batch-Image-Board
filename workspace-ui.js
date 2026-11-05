export function updateThumbnail(id, image) {
  const thumbnail = document.getElementById(id);
  if (!image) {
    thumbnail.hidden = true;
    thumbnail.removeAttribute("src");
    return;
  }
  const preview = document.createElement("canvas");
  const scale = Math.min(80 / image.naturalWidth, 80 / image.naturalHeight);
  preview.width = Math.max(1, Math.round(image.naturalWidth * scale));
  preview.height = Math.max(1, Math.round(image.naturalHeight * scale));
  preview.getContext("2d").drawImage(image, 0, 0, preview.width, preview.height);
  try {
    thumbnail.src = preview.toDataURL("image/png");
    thumbnail.hidden = false;
  } catch {
    // Thumbnail restrictions must not interrupt the main image workflow.
    thumbnail.hidden = true;
  }
}
