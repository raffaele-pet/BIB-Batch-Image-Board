# BIB — Batch Image Board

A browser-based workspace for batch image processing. Images stay on your device.

- **Resize:** arrange and resize a collection, then export it as a ZIP.
- **Compare:** inspect two images with a before-and-after slider and export a video.
- **Select:** compare two collections, discard unwanted images, and save the results.

Switch between English and Italian using the flags in the header. Each mode keeps its images and edits while you switch sections.

[Open BIB](https://raffaele-pet.github.io/bib/)

## Development

No dependencies or build step. Serve this directory with a static HTTP server.

Run `npm test` with Node.js to execute the regression tests.

The resize engine comes from [batch-image-resizer](https://github.com/raffaele-pet/batch-image-resizer).
