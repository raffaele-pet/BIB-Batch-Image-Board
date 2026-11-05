# Batch Studio

A browser-local workspace for batch image processing, with comparison, selection, and resizing modes available through the header navigation. Images never leave your browser.

All three modes share one responsive workspace: the same header, preview panel, right-hand inspector, fields, and export area. On smaller screens the inspector moves below the preview. Navigation between `#confronto`, `#selezione`, and `#ridimensiona` keeps each mode's loaded images, settings, and undo history in memory. Keyboard shortcuts affect only the active mode. All interface labels are in Italian.

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

## Ridimensiona immagini

The editing and ZIP-export engine is ported from [batch-image-resizer](https://github.com/raffaele-pet/batch-image-resizer), revision `90578aec62b8a62a86da868935547d655bb55859`. Its operations, defaults, transform calculations, snapping, and output naming are retained. The UI is integrated into Batch Studio, with image thumbnails and navigation in the inspector.

- Upload or drag and drop multiple images. New uploads append to the collection.
- Original ratio or 1:1, 4:5, 5:4, 3:4, 4:3, 2:3, 3:2, 9:16, 16:9, and 21:9.
- Adaptive output sizing (each source image's long edge), or fixed 1024, 2048, 4096, or 8192 pixels.
- Move images, resize with corner handles, fill, fit, and center each composition. Alt scales from the center; Shift unlocks proportions. Moving and scaling snap edges within 10 screen pixels at any view zoom.
- **Edge pixel** extends source edge rows, columns, and corners to fill empty margins. It applies per image, preserves its transform and internal transparency, and is included in exports.
- Undo up to 50 operations with **Annulla modifica** or Ctrl+Z / Cmd+Z, including uploads, removal, composition, Edge pixel, aspect ratio, and output size.
- View zoom with the wheel, +/- buttons or keys. Space+drag or middle-button drag pans the view; Ctrl+0 fits it, Ctrl+1 shows 100%.
- Click thumbnails or use the arrows to select an image. Delete / Backspace removes it from the collection.
- Export the entire collection to ZIP in JPG, PNG, or WebP. JPG/WebP quality ranges from 50 to 100 (default 95); PNG preserves transparency and JPG fills it white.
- Keep original file names or use a custom base name and a progressive sequence, exactly as in the source app.

## Development

There are no runtime dependencies or build steps. Serve this directory with a static HTTP server. With Node.js installed, run `npm test` for selection, ordering, undo, duplicate-name protection, ZIP integrity, and the resizer's original regression suite plus output-preset and shortcut-isolation checks.

## Open the app

Use the published version at:

https://raffaele-pet.github.io/before-after-slider/

Serve the repository through a local HTTP server (JavaScript modules require HTTP). `index.html` defines the shared workspace; `workspace.css` contains its design system. `slider.js`, `selection.js`, and `resizer.js` implement the three modes. `workspace-navigation.js` coordinates mode changes and export locks; `workspace-ui.js` provides shared thumbnail rendering.
