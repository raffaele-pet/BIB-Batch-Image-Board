const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadEditor(modeActive = true) {
  const elements = new Map();
  const context2d = new Proxy({}, { get: () => () => {} });
  class Element {
    constructor() {
      this.value = '';
      this.children = [];
      this.style = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    getContext() { return context2d; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; }
    addEventListener() {}
    setAttribute() {}
    setPointerCapture() {}
    releasePointerCapture() {}
    scrollIntoView() {}
    replaceChildren() { this.children = []; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
  }
  const revoked = [];
  const sandbox = {
    isModeActive: () => modeActive,
    t: (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`),
    setModeBusy() {},
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
      },
      createElement: () => new Element()
    },
    window: { devicePixelRatio: 1, addEventListener() {} },
    URL: { revokeObjectURL: url => revoked.push(url) },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: () => 1,
    setTimeout: () => 1,
    clearTimeout() {},
    HTMLInputElement: class {}, HTMLSelectElement: class {}, HTMLTextAreaElement: class {},
    console
  };
  sandbox.document.getElementById('resize-ratioSelect').value = 'original';
  sandbox.document.getElementById('resize-sizeSelect').value = 'adaptive';
  const script = fs.readFileSync(path.join(__dirname, '..', 'resizer.js'), 'utf8').replace(/^import .*;$/gm, '');
  const exposed = script.replace(/\}\)\(\);\s*$/, `globalThis.editor = {
    state, els, captureEdit, recordEdit, undoEdit, removeCurrent, imageBounds,
    resizeFromHandle, snapResizedImageToArtboard, snapImageToArtboard,
    resetImage, centerImage, handleSettingsChange, onKeyDown, finishPointerEdit,
    toggleEdgePixel, drawImageContent, getArtboardSize, outputFileName, buildExportCanvas
  }; })();`);
  vm.runInNewContext(exposed, sandbox);
  return { ...sandbox.editor, revoked };
}

function item(id = 'one', width = 1000, height = 800) {
  return { id, name: `${id}.png`, url: `blob:${id}`, naturalWidth: width,
    naturalHeight: height, image: {}, transform: { x: 500, y: 400, scaleX: 0.6, scaleY: 0.6 } };
}

function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('scale snapping preserves the anchor and proportions at every corner and zoom', () => {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const scale of [0.25, 1, 4]) {
    const e = loadEditor();
    const image = item();
    const ptr = { handle: { sx, sy }, startTransform: { ...image.transform }, startBounds: e.imageBounds(image) };
    const anchorX = sx < 0 ? ptr.startBounds.right : ptr.startBounds.left;
    const anchorY = sy < 0 ? ptr.startBounds.bottom : ptr.startBounds.top;
    const width = Math.abs((sx < 0 ? 0 : 1000) - anchorX);
    const height = width * 0.8;
    const p = { x: anchorX + sx * (width - 3 / scale), y: anchorY + sy * (height - 2.4 / scale) };
    e.resizeFromHandle(image, ptr, p, false, false);
    e.snapResizedImageToArtboard(image, ptr, false, false, { scale, art: { width: 1000, height: 800 } });
    const b = e.imageBounds(image);
    near(sx < 0 ? b.left : b.right, sx < 0 ? 0 : 1000);
    near(sx < 0 ? b.right : b.left, anchorX);
    near(sy < 0 ? b.bottom : b.top, anchorY);
    near(b.width / b.height, 1.25);
  }
});

test('free scaling snaps horizontal and vertical edges independently', () => {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const e = loadEditor();
    const image = item();
    const ptr = { handle: { sx, sy }, startTransform: { ...image.transform }, startBounds: e.imageBounds(image) };
    e.resizeFromHandle(image, ptr, { x: sx < 0 ? 5 : 995, y: sy < 0 ? 6 : 794 }, false, true);
    e.snapResizedImageToArtboard(image, ptr, false, true, { scale: 1, art: { width: 1000, height: 800 } });
    const b = e.imageBounds(image);
    near(sx < 0 ? b.left : b.right, sx < 0 ? 0 : 1000);
    near(sy < 0 ? b.top : b.bottom, sy < 0 ? 0 : 800);
  }
});

test('center scaling snaps either side without moving the center', () => {
  for (const unlock of [false, true]) {
    const e = loadEditor();
    const image = item();
    const ptr = { handle: { sx: 1, sy: 1 }, startTransform: { ...image.transform }, startBounds: e.imageBounds(image) };
    e.resizeFromHandle(image, ptr, { x: 996, y: 796.8 }, true, unlock);
    e.snapResizedImageToArtboard(image, ptr, true, unlock, { scale: 1, art: { width: 1000, height: 800 } });
    const b = e.imageBounds(image);
    near(b.left, 0); near(b.right, 1000); near(b.top, 0); near(b.bottom, 800);
    near(image.transform.x, 500); near(image.transform.y, 400);
  }
});

test('scaling outside the threshold does not snap; minimum size stays proportional', () => {
  const e = loadEditor();
  const image = item();
  const ptr = { handle: { sx: 1, sy: 1 }, startTransform: { ...image.transform }, startBounds: e.imageBounds(image) };
  e.resizeFromHandle(image, ptr, { x: 970, y: 776 }, false, false);
  const before = { ...image.transform };
  e.snapResizedImageToArtboard(image, ptr, false, false, { scale: 1, art: { width: 1000, height: 800 } });
  assert.deepEqual(image.transform, before);
  e.resizeFromHandle(image, ptr, { x: -1000, y: -1000 }, false, false);
  const b = e.imageBounds(image);
  near(b.width / b.height, 1.25);
  assert.ok(b.width >= 4 && b.height >= 4);
});

test('repeated undo restores deleted images, order, selection and transforms', () => {
  const e = loadEditor();
  e.state.items = [item('a'), item('b'), item('c')];
  e.state.currentIndex = 1;
  const original = e.captureEdit();
  e.removeCurrent(); e.removeCurrent(); e.removeCurrent();
  assert.equal(e.state.currentIndex, -1);
  assert.deepEqual(e.revoked, []);
  e.undoEdit(); e.undoEdit(); e.undoEdit();
  assert.equal(e.state.items.map(i => i.id).join(','), 'a,b,c');
  assert.equal(e.state.currentIndex, 1);
  assert.deepEqual(e.state.items[1].transform, original.items[1].transform);
  assert.equal(e.els.thumbStrip.children.length, 3);
  assert.equal(e.els.undoBtn.disabled, true);
});

test('one drag is one edit; no-op gestures and view pans do not consume history', () => {
  const e = loadEditor();
  e.state.items = [item()]; e.state.currentIndex = 0;
  const start = e.captureEdit();
  e.state.pointer = { id: 1, beforeEdit: start };
  e.state.items[0].transform.x += 30;
  e.state.items[0].transform.x += 40;
  e.finishPointerEdit();
  assert.equal(e.state.undoStack.length, 1);
  e.undoEdit(); near(e.state.items[0].transform.x, 500);
  e.state.pointer = { id: 2, beforeEdit: e.captureEdit() };
  e.finishPointerEdit();
  e.state.pointer = { id: 3, beforeEdit: null };
  e.finishPointerEdit();
  assert.equal(e.state.undoStack.length, 0);
});

test('undo reverses settings and actions while respecting export and text input', () => {
  const e = loadEditor();
  e.state.items = [item()]; e.state.currentIndex = 0;
  const original = e.captureEdit();
  e.els.ratioSelect.value = '1:1'; e.els.sizeSelect.value = '2048';
  e.handleSettingsChange(); e.resetImage('fit');
  e.undoEdit(); e.undoEdit();
  assert.equal(e.els.ratioSelect.value, 'original');
  assert.equal(e.els.sizeSelect.value, 'adaptive');
  assert.deepEqual(e.state.items[0].transform, original.items[0].transform);
  e.removeCurrent();
  const key = { target: { isContentEditable: true }, ctrlKey: true, key: 'z', preventDefault() {} };
  e.onKeyDown(key); assert.equal(e.state.items.length, 0);
  e.state.exporting = true; e.undoEdit(); assert.equal(e.state.items.length, 0);
  e.state.exporting = false; key.target = {}; key.ctrlKey = false; key.metaKey = true;
  e.onKeyDown(key); assert.equal(e.state.items.length, 1);
});

test('history is bounded and releases URLs only when restoration is impossible', () => {
  const e = loadEditor();
  e.state.items = [item('deleted'), item('kept')]; e.state.currentIndex = 0;
  e.removeCurrent();
  for (let i = 0; i < 50; i++) {
    const before = e.captureEdit(); e.state.items[0].transform.x++; e.recordEdit(before);
  }
  assert.equal(e.state.undoStack.length, 50);
  assert.deepEqual(e.revoked, ['blob:deleted']);
  const before = e.captureEdit();
  e.state.items.push(item('upload')); e.recordEdit(before);
  e.undoEdit(); assert.ok(e.revoked.includes('blob:upload'));
  assert.ok(!e.revoked.includes('blob:kept'));
});

test('edge pixel is per image, preserves composition, and supports undo and removal recovery', () => {
  const e = loadEditor();
  e.state.items = [item('a'), item('b')]; e.state.currentIndex = 0;
  const original = { ...e.state.items[0].transform };
  e.toggleEdgePixel();
  assert.equal(e.state.items[0].edgePixel, true);
  assert.equal(Boolean(e.state.items[1].edgePixel), false);
  assert.deepEqual(e.state.items[0].transform, original);
  e.removeCurrent(); e.undoEdit();
  assert.equal(e.state.items[0].edgePixel, true);
  e.undoEdit();
  assert.equal(Boolean(e.state.items[0].edgePixel), false);
  e.state.exporting = true; e.toggleEdgePixel();
  assert.equal(Boolean(e.state.items[0].edgePixel), false);
});

test('edge rendering extends rows, columns and corners only when enabled', () => {
  const e = loadEditor();
  const image = item();
  const calls = [];
  const out = { save() {}, restore() {}, drawImage(...args) { calls.push(args); } };
  const art = { width: 1000, height: 800 };
  e.drawImageContent(out, image, art);
  assert.equal(calls.length, 1);
  image.edgePixel = true; calls.length = 0;
  e.drawImageContent(out, image, art);
  assert.equal(calls.length, 9);
  assert.deepEqual(calls[0].slice(1), [0, 0, 1, 1, 0, 0, 200, 160]);
  assert.deepEqual(calls[1].slice(1), [0, 0, 1000, 1, 200, 0, 600, 160]);
  assert.deepEqual(calls[7].slice(1), [999, 799, 1, 1, 800, 640, 200, 160]);
  assert.deepEqual(calls[8].slice(1), [200, 160, 600, 480]);
});

test('every original aspect ratio and output-size preset remains available', () => {
  const e = loadEditor();
  const source = item('source', 1000, 600);
  const ratios = { original: [1000, 600], '1:1': [1000, 1000], '4:5': [800, 1000],
    '5:4': [1000, 800], '3:4': [750, 1000], '4:3': [1000, 750], '2:3': [667, 1000],
    '3:2': [1000, 667], '9:16': [563, 1000], '16:9': [1000, 563], '21:9': [1000, 429] };
  for (const [ratio, expected] of Object.entries(ratios)) {
    const art = e.getArtboardSize(source, ratio, 'adaptive');
    assert.deepEqual([art.width, art.height], expected, ratio);
  }
  for (const size of ['1024', '2048', '4096', '8192']) {
    const art = e.getArtboardSize(source, '1:1', size);
    assert.equal(art.width, Number(size));
    assert.equal(art.height, Number(size));
  }
  assert.equal(e.getArtboardSize(item('other', 300, 500), 'original', 'adaptive').longSide, 500);
});

test('original and sequential naming preserve source semantics across all formats', () => {
  const e = loadEditor();
  e.state.items = [item('one'), item('two')];
  e.els.namingSelect.value = 'original';
  for (const [format, extension] of [['jpeg', 'jpg'], ['png', 'png'], ['webp', 'webp']]) {
    e.els.formatSelect.value = format;
    assert.equal(e.outputFileName({ name: 'holiday.original.jpeg' }, 1), `holiday.original.${extension}`);
  }
  e.els.namingSelect.value = 'sequence';
  e.els.baseNameInput.value = 'Session / 01';
  assert.equal(e.outputFileName(item('two'), 1), 'Session - 01_002.webp');
});

test('background resizer never captures shortcuts intended for another mode', () => {
  const e = loadEditor(false);
  e.state.items = [item()]; e.state.currentIndex = 0;
  e.state.viewZoom = 2;
  let prevented = false;
  for (const key of ['Delete', 'ArrowRight', '0', 'z']) {
    e.onKeyDown({ target: {}, key, ctrlKey: true, preventDefault() { prevented = true; } });
  }
  assert.equal(prevented, false);
  assert.equal(e.state.items.length, 1);
  assert.equal(e.state.viewZoom, 2);
});
