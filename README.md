# Batch Studio

A browser-local workspace for batch image processing, with comparison and selection modes available through the header navigation. Images never leave your browser.

Both modes share one responsive workspace: the same header, preview dimensions, right-hand inspector, source cards, fields, and export area. On smaller screens the inspector moves below the preview. Navigation between `#confronto` and `#selezione` keeps loaded images and selections in memory. All interface labels are in Italian.

## Before / After

- separate uploads for the Before and After images
- comparison using a draggable slider
- synchronized zooming and panning with the mouse
- manual X, Y, and zoom controls
- 1080x1080 recording in MP4 or WebM format
- configurable video duration and file name

## Seleziona immagini

- Load one or multiple images, or an entire folder (including subfolders), independently on the left and right. A new load replaces that side.
- Each collection is sorted naturally by relative path/name (`2` before `10`) and paired by position. Different collection sizes are supported: unmatched images are kept too.
- Drag the divider to compare. Images fit the viewer without pan/zoom controls or recording; export keeps their original dimensions.
- Click the × in either top corner to exclude that image from export. That slot stays empty; the next image does not shift into its place. Original files are never deleted or modified.
- Use ← / → buttons or arrow keys to change pairs. Ctrl+Z (⌘Z on macOS) or **Annulla** restores the last excluded image and returns to its pair. Undo works across pairs. The focused slider uses arrow keys to move its divider instead.
- Switch modes without losing the loaded images or selection. Selection is in memory; save before closing or refreshing the page.
- Choose PNG or JPG and **Salva immagini**. All retained images are exported, including both images in a pair when neither was excluded, and images in pairs you have not visited.
- Export order is pair 1 left, pair 1 right, pair 2 left, pair 2 right, etc., skipping exclusions. Names have a progressive prefix (`0001_name.png`) so equal source names are both saved. Existing destination files get a new suffix rather than being overwritten.
- Direct folder export uses the File System Access API on supported browsers (Chrome, Edge, and compatible browsers) over HTTPS or localhost. Otherwise choose/download a ZIP and extract it into your preferred folder. ZIP export is also available on supported browsers.
- PNG preserves transparency; JPG uses a white background for transparent areas and quality 95%. Raster export uses the first frame of animated images and does not retain source metadata.
- If a browser cannot decode an image, the app reports it. Exclude that image or replace the source before exporting. Failed folder exports report how many files were already saved; selections remain available for retry.

## Development

There are no runtime dependencies or build steps. Serve this directory with a static HTTP server. With Node.js installed, run `npm test` for selection, ordering, undo, duplicate-name protection, and ZIP integrity tests.

## Open the app

Use the published version at:

https://raffaele-pet.github.io/before-after-slider/

Serve the repository through a local HTTP server (JavaScript modules require HTTP). `index.html` defines the shared workspace, `workspace.css` contains its design system, and `slider.js` and `selection.js` implement the two modes. `workspace-ui.js` provides shared thumbnail rendering.
