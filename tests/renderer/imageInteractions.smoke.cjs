// Run with: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron tests/renderer/imageInteractions.smoke.cjs
// Exercises actual React components with Chromium pointer and keyboard events.
const { app, BrowserWindow } = require('electron');
const { build } = require('esbuild');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function run() {
  console.log('Starting image interaction smoke checks');
  await app.whenReady();
  app.on('window-all-closed', () => {});
  const root = path.resolve(__dirname, '../..');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'optimate-interaction-'));
  let window;
  try {
    const bundle = await build({
      stdin: {
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { ApprovedLabelEditor } from './src/renderer/src/components/image/ApprovedLabelEditor';
          import ImagePage from './src/renderer/src/pages/ImagePage';
          import { useImagesStore } from './src/renderer/src/stores/imagesStore';
          const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
          const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 400, 400);
          const png = canvas.toDataURL();
          context.fillStyle = 'blue'; context.fillRect(0, 0, 400, 400);
          const backgroundPng = canvas.toDataURL();
          const images = ['one', 'two', 'three'].map(id => ({id, url: png, prompt: id, aspectRatio: '1:1', createdAt: '2026-01-01'}));
          window.api = {
            images: {preview: async () => backgroundPng, approvedLabel: async () => null,
              saveApprovedLabel: async data => { window.savedLabel = data; },
              save: async data => { window.savedCopy = data.url; return {...images[0], id:'saved-copy', url:data.url}; },
              list: async () => ({data: [images[2]], hasMore: false})},
            entities: {list: async () => []}, productFolders: {list: async () => []},
            apiKeys: {list: async () => []}, openaiOAuth: {status: async () => ({connected: false})},
            shootTemplates: {list: async () => []},
          };
          window.testEvents = [];
          for (const type of ['pointercancel', 'dragstart']) {
            document.addEventListener(type, () => window.testEvents.push(type), true);
          }
          const root = createRoot(document.getElementById('root'));
          root.render(<ApprovedLabelEditor image={images[0]} onClose={() => {}} onSaved={() => {}} />);
          window.selectPhoto = async () => {
            const input = document.querySelector('input[type=file]');
            const transfer = new DataTransfer();
            transfer.items.add(new File([await (await fetch(png)).blob()], 'label.png', {type:'image/png'}));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', {bubbles:true}));
          };
          window.setRange = (name, value) => {
            const label = [...document.querySelectorAll('dialog label')].find(item => item.textContent.trim().startsWith(name));
            const input = label.querySelector('input[type=range]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
            input.dispatchEvent(new Event('input', {bubbles:true}));
          };
          window.clickButton = name => [...document.querySelectorAll('dialog button')].find(button => button.textContent.trim() === name).click();
          window.previewPixel = (x, y) => [...document.querySelector('dialog canvas').getContext('2d').getImageData(x, y, 1, 1).data];
          window.labelPixel = () => window.previewPixel(288, 168);
          window.showGallery = () => {
            useImagesStore.setState({images: images.slice(0, 2), isLoading:false, hasHydrated:true, hasMore:true, cursor:'next'});
            root.render(<ImagePage />);
          };
        `,
        resolveDir: root,
        loader: 'jsx',
      },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'iife',
      alias: { '@': path.join(root, 'src/renderer/src') },
      loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' },
      jsx: 'automatic',
    });
    const html = path.join(directory, 'index.html');
    await fs.writeFile(
      html,
      `<style>
      body{margin:0}dialog{width:1000px;max-height:90vh}img{max-width:100%}
      .max-h-52{max-height:208px}.relative{position:relative}.absolute{position:absolute}
      .pointer-events-none{pointer-events:none}.w-fit{width:fit-content}.rounded-full{border-radius:50%}
      .border-2{border:2px solid white}canvas{max-width:400px;max-height:150px}
    </style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    );
    window = new BrowserWindow({
      width: 1100,
      height: 1000,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    await window.loadFile(html);
    console.log('Loaded interaction harness');
    const evaluate = (expression) => window.webContents.executeJavaScript(expression);
    const waitFor = async (condition) =>
      evaluate(`new Promise((resolve, reject) => {
      let frames = 0;
      const check = () => { if (${condition}) resolve(); else if (++frames > 300) reject(new Error('Timed out: ' + ${JSON.stringify(condition)})); else requestAnimationFrame(check); };
      check();
    })`);
    await waitFor(
      'typeof selectPhoto === "function" && document.querySelector("input[type=file]")',
    );
    await evaluate('selectPhoto()');
    await waitFor(`document.querySelector('img[alt="Source photo for label crop"]')?.complete`);
    const rect = await evaluate(
      `(() => { const r = document.querySelector('img[alt="Source photo for label crop"]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`,
    );
    const x = Math.round(rect.x + rect.width * 0.3);
    const y = Math.round(rect.y + rect.height * 0.3);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    for (let step = 1; step <= 5; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: x + step * 10,
        y: y + step * 10,
        modifiers: ['leftButtonDown'],
      });
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: x + 50,
      y: y + 50,
    });
    const crop = await evaluate(
      '({events:window.testEvents, values:[...document.querySelectorAll("section input[type=range]")].map(input=>Number(input.value))})',
    );
    assert.deepEqual(crop.events, [], 'Native image dragging must not cancel crop positioning');
    assert.ok(crop.values[0] > 45 && crop.values[1] > 45, 'Crop centre must follow the drag');
    const undo = async () => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers: ['meta'] });
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    };
    await undo();
    assert.deepEqual(
      await evaluate(
        '[...document.querySelectorAll("section input[type=range]")].slice(0, 2).map(input => Number(input.value))',
      ),
      [50, 50],
      'One Cmd+Z reverses a complete crop drag',
    );
    await evaluate(
      `const size = document.querySelectorAll('section input[type=range]')[2]; size.focus()`,
    );
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await waitFor('Number(document.querySelectorAll("section input[type=range]")[2].value) > 40');
    await undo();
    assert.equal(
      await evaluate('Number(document.querySelectorAll("section input[type=range]")[2].value)'),
      40,
      'Cmd+Z reverses a size change',
    );
    await evaluate('document.querySelector("input[value=rectangle]").click()');
    await waitFor('document.querySelector("input[value=rectangle]").checked');
    await undo();
    assert.equal(
      await evaluate('document.querySelector("input[value=circle]").checked'),
      true,
      'Cmd+Z reverses shape selection',
    );
    await evaluate('document.querySelector("input[value=rectangle]").click()');
    await waitFor('document.querySelectorAll("section input[type=range]").length === 4');
    await evaluate('setRange("Crop height", 20)');
    await waitFor('Number(document.querySelectorAll("section input[type=range]")[3].value) === 20');
    await evaluate('clickButton("Save label for reuse")');
    await waitFor(
      `document.querySelector('img[alt="Saved approved label"]')?.naturalHeight === 512`,
    );
    assert.deepEqual(
      await evaluate(
        `(() => { const image = document.querySelector('img[alt="Saved approved label"]'); const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext("2d"); ctx.drawImage(image,0,0); return [image.naturalWidth, image.naturalHeight, ...ctx.getImageData(0,0,1,1).data]; })()`,
      ),
      [1024, 512, 255, 0, 0, 255],
      'Rectangle export keeps proportions and opaque corners',
    );
    await evaluate('setRange("Left / right", 80)');
    await undo();
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("dialog label")].find(label => label.textContent.trim().startsWith("Left / right")).querySelector("input").value',
      ),
      '72',
      'Cmd+Z restores label placement',
    );
    await evaluate('document.querySelector("dialog input[type=checkbox]").click()');
    await waitFor('document.querySelector("dialog input[type=checkbox]").checked');
    await evaluate('setRange("Brush left / right", 72); setRange("Brush up / down", 42)');
    await evaluate('clickButton("Reveal at brush position")');
    await waitFor('labelPixel()[2] === 255');
    await undo();
    assert.deepEqual(
      await evaluate('labelPixel()'),
      [255, 0, 0, 255],
      'Cmd+Z restores the label after a brush mark',
    );
    const previewRect = await evaluate(
      '(() => { const r = document.querySelector("dialog canvas").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()',
    );
    const brushX = Math.round(previewRect.x + previewRect.width * 0.72);
    const brushY = Math.round(previewRect.y + previewRect.height * 0.42);
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: brushX,
      y: brushY,
    });
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: brushX + 10,
      y: brushY,
      modifiers: ['leftButtonDown'],
    });
    await waitFor('labelPixel()[2] === 255');
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: brushX + 10,
      y: brushY,
    });
    await undo();
    assert.deepEqual(
      await evaluate('labelPixel()'),
      [255, 0, 0, 255],
      'One Cmd+Z reverses a complete brush stroke',
    );
    console.log(
      'PASS crop drag, keyboard resize, rectangle export and Cmd+Z crop/placement/brush undo',
    );

    const featherSamples = {
      left: [246, 168],
      right: [330, 168],
      top: [288, 148],
      bottom: [288, 188],
    };
    for (const [edge, [px, py]] of Object.entries(featherSamples)) {
      await evaluate(`setRange('Feather ${edge}', 25)`);
      await waitFor(`previewPixel(${px}, ${py})[2] > 15`);
      const blended = await evaluate(`previewPixel(${px}, ${py})`);
      assert.ok(
        blended[0] > 0 && blended[0] < 240 && blended[2] > 15,
        `${edge} feather blends label into original`,
      );
      assert.deepEqual(
        await evaluate('labelPixel()'),
        [255, 0, 0, 255],
        'Feathering preserves the label centre',
      );
      for (const [otherEdge, [ox, oy]] of Object.entries(featherSamples)) {
        if (otherEdge !== edge)
          assert.deepEqual(
            await evaluate(`previewPixel(${ox}, ${oy})`),
            [255, 0, 0, 255],
            'Other edges stay sharp',
          );
      }
      await undo();
      assert.deepEqual(
        await evaluate(`previewPixel(${px}, ${py})`),
        [255, 0, 0, 255],
        'Cmd+Z reverses feathering',
      );
    }
    await evaluate('setRange("Rotation", 45)');
    await waitFor(
      '[...document.querySelectorAll("dialog label")].find(label => label.textContent.trim().startsWith("Rotation")).querySelector("input").value === "45" && previewPixel(260,140)[0] === 255',
    );
    // Local point (-40, 0), rotated 45° around (288, 168), is inside the left edge.
    assert.deepEqual(
      await evaluate('previewPixel(260,140)'),
      [255, 0, 0, 255],
      'Rotation sample must be opaque label before feathering, not background',
    );
    await evaluate('setRange("Feather left", 25)');
    await waitFor('previewPixel(260,140)[2] > 15');
    const rotatedEdge = await evaluate('previewPixel(260,140)');
    assert.ok(
      rotatedEdge[0] > 0 && rotatedEdge[0] < 240 && rotatedEdge[2] > 15,
      'Feathering blends an interior pixel along the rotated left edge',
    );
    assert.deepEqual(
      await evaluate('labelPixel()'),
      [255, 0, 0, 255],
      'Rotated feathering keeps centre opaque',
    );
    await undo();
    assert.deepEqual(
      await evaluate('previewPixel(260,140)'),
      [255, 0, 0, 255],
      'Undo restores the same rotated edge to opaque label',
    );
    await undo();
    await evaluate('setRange("Feather left", 25)');
    await waitFor('previewPixel(246,168)[2] > 15');
    await evaluate('clickButton("Reveal at brush position")');
    await waitFor('labelPixel()[2] === 255');
    await undo();
    assert.deepEqual(
      await evaluate('labelPixel()'),
      [255, 0, 0, 255],
      'Brush undo keeps the active feathering',
    );
    const previewEdge = await evaluate('previewPixel(246,168)');
    await evaluate('clickButton("Save corrected copy")');
    await waitFor('typeof window.savedCopy === "string"');
    const exported = await evaluate(
      `(async () => { const image = new Image(); image.src = window.savedCopy; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d'); context.drawImage(image,0,0); return [...context.getImageData(246,168,1,1).data]; })()`,
    );
    assert.deepEqual(
      exported,
      previewEdge,
      'Corrected copy exports the same feathering as the preview',
    );
    console.log(
      'PASS independent feather edges, centre preservation, undo, rotation and saved copy',
    );

    await evaluate('showGallery()');
    await waitFor('document.querySelector("img[alt=one]")');
    await evaluate('document.querySelector("img[alt=one]").parentElement.click()');
    await waitFor('document.querySelector("img[loading=eager]")?.alt === "one"');
    const key = async (keyCode) => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    };
    await key('Right');
    await waitFor('document.querySelector("img[loading=eager]")?.alt === "two"');
    await key('Right');
    await waitFor('document.querySelector("img[loading=eager]")?.alt === "three"');
    await key('Right');
    assert.equal(
      await evaluate('document.querySelector("img[loading=eager]").alt'),
      'three',
      'Stop at final image',
    );
    await key('Left');
    await waitFor('document.querySelector("img[loading=eager]")?.alt === "two"');
    await evaluate('document.querySelector("img[loading=eager]").parentElement.click()');
    await key('Left');
    await waitFor('document.querySelector("img[loading=eager]")?.alt === "one"');
    await key('Left');
    assert.equal(
      await evaluate('document.querySelector("img[loading=eager]").alt'),
      'one',
      'Stop at first image',
    );
    await evaluate(
      'const input = document.createElement("input"); document.body.append(input); input.focus()',
    );
    await key('Right');
    assert.equal(
      await evaluate('document.querySelector("img[loading=eager]").alt'),
      'one',
      'Do not navigate while editing a field',
    );
    await evaluate(
      'document.activeElement.remove(); const dialog = document.createElement("dialog"); document.body.append(dialog); dialog.showModal()',
    );
    await key('Right');
    assert.equal(
      await evaluate('document.querySelector("img[loading=eager]").alt'),
      'one',
      'Do not navigate behind a dialog',
    );
    console.log(
      'PASS image arrows, expanded view, pagination, boundaries, input and dialog guards',
    );
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    await fs.rm(directory, { recursive: true });
  }
}

run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
