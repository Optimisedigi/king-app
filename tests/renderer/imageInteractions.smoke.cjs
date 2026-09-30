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
          import { useCompositionStore } from './src/renderer/src/stores/compositionStore';
          window.compositionStore = useCompositionStore;
          const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 400;
          const context = canvas.getContext('2d'); context.fillStyle = 'red'; context.fillRect(0, 0, 400, 400);
          const png = canvas.toDataURL();
          context.fillStyle = 'blue'; context.fillRect(0, 0, 400, 400);
          const backgroundPng = canvas.toDataURL();
          const images = ['one', 'two', 'three'].map(id => ({id, url: png, prompt: id, aspectRatio: '1:1', createdAt: '2026-01-01'}));
          window.storedLabels = [{id: 'label-0000000000001-aaaaaaaa', dataUrl: png}];
          window.removedLabels = {};
          let labelCounter = 1;
          window.api = {
            images: {preview: async () => backgroundPng, approvedLabels: async () => window.storedLabels,
              saveApprovedLabel: async data => {
                if(window.failLabelSave) throw new Error('Save failed');
                const item = {id: 'label-' + String(++labelCounter).padStart(13, '0') + '-bbbbbbbb', dataUrl: data};
                window.storedLabels = [...window.storedLabels, item];
                return item;
              },
              removeApprovedLabel: async id => {
                if(window.failLabelRemoval) throw new Error('Removal failed');
                window.removedLabels[id] = window.storedLabels.find(item => item.id === id);
                window.storedLabels = window.storedLabels.filter(item => item.id !== id);
              },
              restoreApprovedLabel: async id => {
                window.storedLabels = [...window.storedLabels, window.removedLabels[id]].sort((a, b) => a.id < b.id ? -1 : 1);
                delete window.removedLabels[id];
              },
              save: async data => {
                window.savedCopy = data.url;
                (window.saveRequests ??= []).push(data);
                return {...images[0], id: 'saved-' + window.saveRequests.length, url: data.url, prompt: data.prompt, createdAt: '2026-02-01', ...(data.sourceName ? {sourceName: data.sourceName} : {})};
              },
              list: async () => ({data: [images[2]], hasMore: false})},
            files: {exportBatch: async items => { window.exportedItems = items; return {success: true, exported: items.length, failed: 0}; }},
            generate: {image: async () => ({success: true, resultUrls: [png]})},
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
          window.labelChoices = () => [...document.querySelectorAll('input[name=saved-label]')].map(input => input.value);
          window.selectedLabelId = () => document.querySelector('input[name=saved-label]:checked')?.value ?? null;
          window.selectedLabelImage = () => document.querySelector('input[name=saved-label]:checked + img');
          window.addPromptPhoto = async name => {
            const input = document.querySelector('form input[type=file]');
            const transfer = new DataTransfer();
            transfer.items.add(new File([await (await fetch(png)).blob()], name, {type:'image/png'}));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', {bubbles:true}));
          };
          window.dropHintShown = () => [...document.querySelectorAll('form [role=status]')].some(s => s.textContent.includes('Drop photos to add them as references'));
          window.dropOnPrompt = async (name, type = 'image/png') => {
            const form = document.querySelector('form');
            const transfer = new DataTransfer();
            const body = type.startsWith('image/') ? await (await fetch(png)).blob() : new Blob(['not an image'], {type});
            transfer.items.add(new File([body], name, {type}));
            form.dispatchEvent(new DragEvent('dragover', {dataTransfer: transfer, bubbles: true, cancelable: true}));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const hint = window.dropHintShown();
            const drop = new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true});
            form.dispatchEvent(drop);
            return {hint, handled: drop.defaultPrevented};
          };
          window.addGalleryImage = image => useImagesStore.setState(state => ({images: [image, ...state.images]}));
          window.pasteOnPrompt = async name => {
            const transfer = new DataTransfer();
            transfer.items.add(new File([await (await fetch(png)).blob()], name, {type: 'image/png'}));
            const paste = new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true});
            document.querySelector('form textarea').dispatchEvent(paste);
            return paste.defaultPrevented;
          };
          window.pasteText = () => {
            const transfer = new DataTransfer();
            transfer.setData('text/plain', 'hello');
            const paste = new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true});
            document.querySelector('form textarea').dispatchEvent(paste);
            return paste.defaultPrevented;
          };
          window.referenceCount = () => document.querySelectorAll('form img[alt="Reference"], form .skeleton-loader').length;
          // Each preview's remove button sits next to its image.
          window.removeAllReferences = () => document.querySelectorAll('form img[alt="Reference"]').forEach(img => img.parentElement.querySelector('button').click());
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
      .block{display:block}.inset-0{inset:0}.h-full{height:100%}.w-full{width:100%}
    </style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    );
    window = new BrowserWindow({
      width: 1100,
      height: 1000,
      show: false,
      // An in-memory session: saved settings (e.g. compositions) never leak between runs.
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        partition: `smoke-${process.pid}-${Date.now()}`,
      },
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
    const firstId = 'label-0000000000001-aaaaaaaa';
    await waitFor('selectedLabelImage()?.complete');
    assert.equal(
      await evaluate('selectedLabelId()'),
      firstId,
      'Existing saved label loads selected',
    );
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("dialog button")].some(button => button.textContent.trim() === "Add another label")',
      ),
      true,
      'A saved label offers adding another, not replacing it',
    );
    // Add a second label: both are kept and the new one is selected.
    await evaluate('selectPhoto()');
    await waitFor(`document.querySelector('img[alt="Source photo for label crop"]')?.complete`);
    await evaluate('clickButton("Save label for reuse")');
    await waitFor('labelChoices().length === 2 && selectedLabelImage()?.complete');
    const secondId = await evaluate('window.storedLabels[1].id');
    assert.deepEqual(
      await evaluate('labelChoices()'),
      [firstId, secondId],
      'Both labels are listed',
    );
    assert.equal(
      await evaluate('selectedLabelId()'),
      secondId,
      'New label is selected after saving',
    );
    // Pick the first label again. Edits made for the other label must not be undoable onto it.
    const undoButtonDisabled = () =>
      evaluate(
        '[...document.querySelectorAll("dialog button")].find(button => button.textContent.trim() === "Undo").disabled',
      );
    await evaluate('document.querySelector("dialog input[type=checkbox]").click()');
    await waitFor('document.querySelector("dialog input[type=checkbox]").checked');
    await evaluate('clickButton("Reveal at brush position")');
    assert.equal(await undoButtonDisabled(), false, 'A brush mark is undoable');
    await evaluate(`document.querySelector('input[value="${firstId}"]').click()`);
    await waitFor(`selectedLabelId() === "${firstId}"`);
    assert.equal(
      await undoButtonDisabled(),
      true,
      'Switching labels clears undo so old brush strokes cannot return on the new label',
    );
    await evaluate('document.querySelector("dialog input[type=checkbox]").click()');
    await waitFor('!document.querySelector("dialog input[type=checkbox]").checked');
    // Failed removal keeps everything.
    await evaluate('window.failLabelRemoval=true;clickButton("Remove selected label")');
    await waitFor(
      '[...document.querySelectorAll("dialog button")].some(button => button.textContent.trim() === "Remove selected label" && !button.disabled)',
    );
    assert.equal(await evaluate('labelChoices().length'), 2, 'Failed removal keeps both labels');
    assert.equal(
      await evaluate('window.storedLabels.length'),
      2,
      'Failed removal keeps stored labels',
    );
    // Removing the selected label keeps the other one and selects it.
    await evaluate('window.failLabelRemoval=false;clickButton("Remove selected label")');
    await waitFor('labelChoices().length === 1');
    assert.deepEqual(
      await evaluate('labelChoices()'),
      [secondId],
      'Only the selected label is removed',
    );
    assert.equal(await evaluate('selectedLabelId()'), secondId, 'Remaining label becomes selected');
    assert.deepEqual(
      await evaluate('window.storedLabels.map(item => item.id)'),
      [secondId],
      'Store removes only the selected label',
    );
    await evaluate('clickButton("Undo removal")');
    await waitFor('labelChoices().length === 2');
    assert.deepEqual(
      await evaluate('labelChoices()'),
      [firstId, secondId],
      'Undo restores the label in order',
    );
    assert.equal(await evaluate('selectedLabelId()'), firstId, 'Restored label is selected');
    await evaluate('selectPhoto()');
    await waitFor(`document.querySelector('img[alt="Source photo for label crop"]')?.complete`);
    assert.equal(
      await evaluate(
        '[...document.querySelectorAll("dialog button")].some(button => button.textContent.trim() === "Save corrected copy")',
      ),
      false,
      'Replacement crop does not offer saving the old label',
    );
    await evaluate('clickButton("Cancel crop")');
    await waitFor(
      `!document.querySelector('img[alt="Source photo for label crop"]') && selectedLabelImage()?.complete`,
    );
    assert.equal(await evaluate('labelChoices().length'), 2, 'Cancel crop keeps every saved label');
    await evaluate('selectPhoto()');
    console.log(
      'PASS multiple saved labels: add, select, remove one, failure preservation, undo removal and cancel',
    );
    await waitFor(`document.querySelector('img[alt="Source photo for label crop"]')?.complete`);
    const rect = await evaluate(
      `(() => { const r = document.querySelector('img[alt="Source photo for label crop"]').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`,
    );
    const x = Math.round(rect.x + rect.width * 0.3);
    const y = Math.round(rect.y + rect.height * 0.3);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    const stepX = rect.width * 0.06;
    const stepY = rect.height * 0.06;
    for (let step = 1; step <= 5; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(x + step * stepX),
        y: Math.round(y + step * stepY),
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
      x: Math.round(x + 5 * stepX),
      y: Math.round(y + 5 * stepY),
    });
    const crop = await evaluate(
      '({events:window.testEvents, values:[...document.querySelectorAll("section input[type=range]")].map(input=>Number(input.value))})',
    );
    assert.deepEqual(crop.events, [], 'Native image dragging must not cancel crop positioning');
    assert.ok(
      crop.values[0] >= 58 && crop.values[0] <= 62 && crop.values[1] >= 58 && crop.values[1] <= 62,
      `Crop centre must follow the drag to about 60%: ${crop.values}`,
    );
    const fit = await evaluate(
      `(() => { const img = document.querySelector('img[alt="Source photo for label crop"]'); const panel = img.parentElement.parentElement; const style = getComputedStyle(panel); const inner = panel.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); return { natural: img.naturalWidth, expected: Math.min(inner, innerHeight * 0.7 * img.naturalWidth / img.naturalHeight) }; })()`,
    );
    assert.ok(
      rect.width > fit.natural,
      `Small crop photo must scale up beyond its ${fit.natural}px size, got ${rect.width}px`,
    );
    assert.ok(
      Math.abs(rect.width - fit.expected) <= 2,
      `Crop photo must fill the panel (expected ${fit.expected}px, got ${rect.width}px)`,
    );
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
    const cropValues = () =>
      evaluate(
        '[...document.querySelectorAll("section input[type=range]")].map(input => Number(input.value))',
      );
    const settle = () =>
      evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    await evaluate('document.querySelectorAll("section input[type=range]")[1].focus()');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up' });
    await settle();
    assert.equal((await cropValues())[1], 50.5, 'Arrow key moves the crop half a percent');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Up', modifiers: ['shift'] });
    await settle();
    assert.equal((await cropValues())[1], 50.6, 'Shift+arrow moves the crop a tenth of a percent');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] });
    await settle();
    assert.equal((await cropValues())[1], 50.5, 'Shift+arrow down reverses a micro move');
    await undo();
    await undo();
    await undo();
    assert.equal((await cropValues())[1], 50, 'Cmd+Z reverses each keyboard nudge');
    await evaluate('setRange("Circle size", 1)');
    await settle();
    assert.equal((await cropValues())[2], 1, 'Crop can shrink to 1% for tiny label details');
    await undo();
    const before = await cropValues();
    const fineStartX = Math.round(rect.x + rect.width * 0.5);
    const fineStartY = Math.round(rect.y + rect.height * 0.5);
    const fineDistance = Math.round(rect.width * 0.2);
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: fineStartX,
      y: fineStartY,
      modifiers: ['shift'],
    });
    for (let step = 1; step <= 4; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: fineStartX,
        y: fineStartY + Math.round((fineDistance * step) / 4),
        modifiers: ['shift', 'leftButtonDown'],
      });
      await settle();
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: fineStartX,
      y: fineStartY + fineDistance,
      modifiers: ['shift'],
    });
    const fine = await cropValues();
    const expectedFineMove = ((fineDistance / rect.height) * 100) / 10;
    assert.equal(fine[0], before[0], 'Shift+drag down does not move the crop sideways');
    assert.ok(
      Math.abs(fine[1] - (before[1] + expectedFineMove)) <= 0.3,
      `Shift+drag moves a tenth as far (expected +${expectedFineMove.toFixed(1)}%, got ${before[1]} -> ${fine[1]})`,
    );
    await undo();
    assert.deepEqual(
      (await cropValues()).slice(0, 2),
      before.slice(0, 2),
      'Cmd+Z reverses a fine drag',
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
    const previousLabels = await evaluate('window.storedLabels.map(item => item.id)');
    await evaluate('window.failLabelSave=true;clickButton("Save label for reuse")');
    await waitFor(
      '[...document.querySelectorAll("dialog button")].some(button => button.textContent.trim() === "Save label for reuse" && !button.disabled)',
    );
    assert.deepEqual(
      await evaluate('window.storedLabels.map(item => item.id)'),
      previousLabels,
      'Failed save keeps the saved labels unchanged',
    );
    assert.ok(
      await evaluate('document.querySelector(\'img[alt="Source photo for label crop"]\')'),
      'Failed replacement retains the crop for retry',
    );
    await evaluate('window.failLabelSave=false;clickButton("Save label for reuse")');
    await waitFor('selectedLabelImage()?.naturalHeight === 512');
    assert.equal(await evaluate('labelChoices().length'), 3, 'Saving adds to the library');
    assert.deepEqual(
      await evaluate(
        `(() => { const image = selectedLabelImage(); const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext("2d"); ctx.drawImage(image,0,0); return [image.naturalWidth, image.naturalHeight, ...ctx.getImageData(0,0,1,1).data]; })()`,
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
    const placementValue = (name) =>
      evaluate(
        `Number([...document.querySelectorAll("dialog label")].find(label => label.textContent.trim().startsWith(${JSON.stringify(name)})).querySelector("input").value)`,
      );
    await evaluate(
      '[...document.querySelectorAll("dialog label")].find(label => label.textContent.trim().startsWith("Up / down")).querySelector("input").focus()',
    );
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
    await settle();
    assert.equal(
      await placementValue('Up / down'),
      41.5,
      'Label up/down arrow moves half a percent',
    );
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down', modifiers: ['shift'] });
    await settle();
    assert.equal(
      await placementValue('Up / down'),
      41.4,
      'Label Shift+arrow moves a tenth of a percent',
    );
    await undo();
    await undo();
    assert.equal(await placementValue('Up / down'), 42, 'Cmd+Z reverses label nudges');
    await evaluate('setRange("Size", 1)');
    await settle();
    assert.equal(await placementValue('Size'), 1, 'Placed label can shrink to 1%');
    await undo();
    // Pointer events only reach the preview when it is on screen, as it is for a user.
    const canvasRect = await evaluate(
      '(() => { document.querySelector("dialog canvas").scrollIntoView({block: "center"}); const r = document.querySelector("dialog canvas").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()',
    );
    const labelX = Math.round(canvasRect.x + canvasRect.width * 0.72);
    const labelY = Math.round(canvasRect.y + canvasRect.height * 0.42);
    const labelDrag = Math.round(canvasRect.height * 0.2);
    window.webContents.sendInputEvent({
      type: 'mouseDown',
      button: 'left',
      clickCount: 1,
      x: labelX,
      y: labelY,
      modifiers: ['shift'],
    });
    for (let step = 1; step <= 4; step++) {
      window.webContents.sendInputEvent({
        type: 'mouseMove',
        x: labelX,
        y: labelY + Math.round((labelDrag * step) / 4),
        modifiers: ['shift', 'leftButtonDown'],
      });
      await settle();
    }
    window.webContents.sendInputEvent({
      type: 'mouseUp',
      button: 'left',
      clickCount: 1,
      x: labelX,
      y: labelY + labelDrag,
      modifiers: ['shift'],
    });
    const expectedLabelMove = ((labelDrag / canvasRect.height) * 100) / 10;
    const labelAfterDrag = await placementValue('Up / down');
    assert.equal(
      await placementValue('Left / right'),
      72,
      'Shift+drag down keeps the label horizontally',
    );
    assert.ok(
      Math.abs(labelAfterDrag - (42 + expectedLabelMove)) <= 0.3,
      `Label Shift+drag moves a tenth as far (expected ${(42 + expectedLabelMove).toFixed(1)}%, got ${labelAfterDrag}%, preview ${JSON.stringify(canvasRect)})`,
    );
    await undo();
    assert.equal(await placementValue('Up / down'), 42, 'Cmd+Z reverses a fine label drag');
    assert.equal(
      await evaluate('!!document.querySelector("[data-testid=brush-overlay]")'),
      false,
      'Brush guide is hidden while the brush is off',
    );
    await evaluate('document.querySelector("dialog input[type=checkbox]").click()');
    await waitFor('document.querySelector("dialog input[type=checkbox]").checked');
    await waitFor('document.querySelector("[data-testid=brush-point]")');
    await evaluate('setRange("Brush left / right", 72); setRange("Brush up / down", 42)');
    const pointBox = await evaluate(
      '(() => { const c = document.querySelector("dialog canvas").getBoundingClientRect(); const b = document.querySelector("[data-testid=brush-point]").getBoundingClientRect(); return {cx: (b.x + b.width / 2 - c.x) / c.width, cy: (b.y + b.height / 2 - c.y) / c.height}; })()',
    );
    assert.ok(
      Math.abs(pointBox.cx - 0.72) < 0.01 && Math.abs(pointBox.cy - 0.42) < 0.01,
      `Slider brush marker sits at the slider position: ${JSON.stringify(pointBox)}`,
    );
    await evaluate('clickButton("Reveal at brush position")');
    await waitFor('labelPixel()[2] === 255');
    await undo();
    assert.deepEqual(
      await evaluate('labelPixel()'),
      [255, 0, 0, 255],
      'Cmd+Z restores the label after a brush mark',
    );
    const previewRect = await evaluate(
      '(() => { document.querySelector("dialog canvas").scrollIntoView({block: "center"}); const r = document.querySelector("dialog canvas").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()',
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
    await waitFor('document.querySelector("[data-testid=brush-cursor]")');
    const cursor = await evaluate(
      '(() => { const c = document.querySelector("dialog canvas"); const r = c.getBoundingClientRect(); const b = document.querySelector("[data-testid=brush-cursor] circle").getBoundingClientRect(); const radius = Number([...document.querySelectorAll("dialog label")].find(l => l.textContent.trim().startsWith("Brush size")).querySelector("input").value); return {width: b.width, expected: radius * 2 * r.width, cx: b.x + b.width / 2, cy: b.y + b.height / 2, strokes: document.querySelectorAll("[data-testid=brush-overlay] g[opacity] > *").length}; })()',
    );
    assert.ok(
      Math.abs(cursor.width - cursor.expected) <= 2,
      `Brush outline matches the real brush size (${cursor.expected}px, got ${cursor.width}px)`,
    );
    assert.ok(
      Math.abs(cursor.cx - (brushX + 10)) <= 2 && Math.abs(cursor.cy - brushY) <= 2,
      `Brush outline follows the pointer: ${JSON.stringify(cursor)}`,
    );
    assert.equal(cursor.strokes, 1, 'The stroke being painted is tinted on the preview');
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
    assert.equal(
      await evaluate(
        'document.querySelectorAll("[data-testid=brush-overlay] g[opacity] > *").length',
      ),
      0,
      'Undo also removes the stroke tint',
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

    // Select all: loads the unloaded page, then exports every image.
    await evaluate(
      'document.querySelector("dialog[open]")?.close(); document.querySelectorAll("dialog").forEach(d => d.remove()); showGallery()',
    );
    await waitFor('document.querySelector("img[alt=one]")');
    const galleryButton = (name) =>
      `[...document.querySelectorAll("button")].find(button => button.textContent.trim() === ${JSON.stringify(name)} && !button.closest("[aria-hidden=true]"))`;
    await waitFor(galleryButton('Select all'));
    assert.equal(
      await evaluate('document.querySelectorAll("img[alt=three]").length'),
      0,
      'The third image starts on an unloaded page',
    );
    await evaluate(`${galleryButton('Select all')}.click()`);
    await waitFor(
      '[...document.querySelectorAll("span")].some(span => span.textContent.trim() === "3 selected")',
    );
    assert.equal(
      await evaluate(`!!${galleryButton('Select all')}`),
      false,
      'Select all hides once every image is selected',
    );
    await evaluate(`${galleryButton('Export')}.click()`);
    await waitFor('Array.isArray(window.exportedItems)');
    assert.deepEqual(
      await evaluate('window.exportedItems.map(item => item.name).sort()'),
      ['one', 'three', 'two'],
      'Export after Select all includes images from pages not loaded yet',
    );
    await waitFor(galleryButton('Select all'));
    // A page that fails to load: select what loaded, say so, and do not hang.
    await evaluate(
      'window.api.images.list = async () => { throw new Error("offline"); }; showGallery()',
    );
    await waitFor(galleryButton('Select all'));
    await evaluate(`${galleryButton('Select all')}.click()`);
    await waitFor(
      '[...document.querySelectorAll("span")].some(span => span.textContent.trim() === "2 selected")',
    );
    await waitFor(`!${galleryButton('Selecting…')}`);
    assert.equal(
      await evaluate(`!!${galleryButton('Select all')}`),
      true,
      'Select all stays available when not everything could be selected',
    );
    console.log(
      'PASS select all loads every page, bulk exports all images, and handles a failed page',
    );

    // Export names: a photo added in the prompt box keeps its original file name
    // through generation, saving and bulk export.
    await evaluate(
      'window.api.images.list = async () => ({data: [], hasMore: false}); window.saveRequests = []; window.exportedItems = undefined; showGallery()',
    );
    await waitFor('document.querySelector("form input[type=file]")');
    await evaluate('addPromptPhoto("IMG_2041 Wedding Cake.png")');
    await waitFor('!document.querySelector("form [aria-busy=true], form .animate-spin")');
    await evaluate(`(() => {
      const box = document.querySelector('form textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'A cake on marble');
      box.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    await waitFor(
      '[...document.querySelectorAll("form button")].some(b => b.textContent.trim() === "Generate" && !b.disabled)',
    );
    // Photos load asynchronously; submit once the reference is ready.
    await evaluate('new Promise(r => setTimeout(r, 300))');
    await evaluate(
      '[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Generate").click()',
    );
    await waitFor('window.saveRequests.length >= 1');
    assert.equal(
      await evaluate('window.saveRequests[0].sourceName'),
      'IMG_2041 Wedding Cake',
      'A generated image is saved with the original name of the photo it came from',
    );
    await waitFor(`${galleryButton('Select all')}`);
    await evaluate(`${galleryButton('Select all')}.click()`);
    await waitFor(`${galleryButton('Export')}`);
    await evaluate(`${galleryButton('Export')}.click()`);
    await waitFor('Array.isArray(window.exportedItems)');
    const exportedNames = await evaluate('window.exportedItems.map(item => item.name)');
    assert.ok(
      exportedNames.includes('IMG_2041 Wedding Cake'),
      `Export uses the original photo name: ${JSON.stringify(exportedNames)}`,
    );
    assert.ok(
      exportedNames.includes('one') && exportedNames.includes('two'),
      `Older images without a stored name still export under their prompt: ${JSON.stringify(exportedNames)}`,
    );
    console.log('PASS exported files keep the original photo name');

    // Drag and drop: a photo dropped on the prompt box is added and keeps its name.
    await evaluate('removeAllReferences()');
    await waitFor('referenceCount() === 0');
    const rejected = await evaluate('dropOnPrompt("notes.txt", "text/plain")');
    assert.equal(rejected.handled, true, 'A dropped file is handled by the prompt box');
    await evaluate('new Promise(r => setTimeout(r, 200))');
    assert.equal(await evaluate('referenceCount()'), 0, 'A dropped non-image file is not added');
    const dropped = await evaluate('dropOnPrompt("Lemon Tart original.png")');
    assert.equal(dropped.hint, true, 'Dragging a photo over the prompt box shows a drop hint');
    assert.equal(dropped.handled, true, 'Dropping a photo is handled, not left to the browser');
    await waitFor('referenceCount() === 1');
    assert.equal(await evaluate('dropHintShown()'), false, 'The drop hint clears after dropping');
    await evaluate('new Promise(r => setTimeout(r, 300))');
    const savesBefore = await evaluate('window.saveRequests.length');
    await evaluate(
      '[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Generate").click()',
    );
    await waitFor(`window.saveRequests.length > ${savesBefore}`);
    assert.equal(
      await evaluate('window.saveRequests.at(-1).sourceName'),
      'Lemon Tart original',
      'An image made from a dropped photo keeps that photo name for export',
    );
    console.log('PASS dropped photos are added and keep their original name');

    const clearReferences = async () => {
      await evaluate('removeAllReferences()');
      await waitFor('referenceCount() === 0');
    };
    const generateAndGetSourceName = async () => {
      await evaluate('new Promise(r => setTimeout(r, 300))');
      const before = await evaluate('window.saveRequests.length');
      await evaluate(
        '[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Generate").click()',
      );
      await waitFor(`window.saveRequests.length > ${before}`);
      return evaluate('window.saveRequests.at(-1).sourceName ?? null');
    };

    // Pasting: text still pastes normally; a copied file keeps its name; a
    // screenshot's stand-in "image.png" is not used as a name.
    await clearReferences();
    assert.equal(await evaluate('pasteText()'), false, 'Pasting text is left to the text box');
    assert.equal(await evaluate('referenceCount()'), 0, 'Pasting text adds no photo');
    assert.equal(
      await evaluate('pasteOnPrompt("Raspberry Tart copied.png")'),
      true,
      'Pasting a photo is handled by the prompt box',
    );
    await waitFor('referenceCount() === 1');
    assert.equal(
      await generateAndGetSourceName(),
      'Raspberry Tart copied',
      'An image made from a pasted photo keeps that photo name',
    );
    await clearReferences();
    await evaluate('pasteOnPrompt("image.png")');
    await waitFor('referenceCount() === 1');
    assert.equal(
      await generateAndGetSourceName(),
      null,
      'A pasted screenshot does not name exports "image"',
    );
    console.log('PASS pasted photos are added and keep real names only');

    // Editing an image keeps the original photo name on the new version.
    await clearReferences();
    await evaluate(
      `addGalleryImage({id: 'named', url: 'local-file:///named.png', prompt: 'Named cake', aspectRatio: '1:1', createdAt: '2026-03-01', sourceName: 'IMG_9 Birthday'})`,
    );
    await waitFor('document.querySelector(\'img[alt="Named cake"]\')');
    // Each card holds its own Edit button; walk up from the image to that card.
    await evaluate(`(() => {
      let node = document.querySelector('img[alt="Named cake"]');
      while (node && !node.querySelector('button[title="Edit"]')) node = node.parentElement;
      node.querySelector('button[title="Edit"]').click();
    })()`);
    await waitFor('referenceCount() === 1');
    await evaluate(`(() => {
      const box = document.querySelector('form textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Add candles');
      box.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    assert.equal(
      await generateAndGetSourceName(),
      'IMG_9 Birthday',
      'Editing an image keeps the original photo name',
    );
    console.log('PASS editing an image keeps its original photo name');

    // Product folders: easy to find above the individual entries, and picking one
    // makes one image per product in that folder, never one combined image.
    await evaluate(`(() => {
      const product = (id, name, folderId, ref) => ({id, name, folderId, referenceImages: [ref], thumbnailUrl: null, createdAt: '2026-01-01'});
      window.api.entities.list = async type => type === 'products' ? [
        product('p1', 'Tall Lemon', 'f1', 'data:image/png;base64,TALL1'),
        product('p2', 'Tall Chocolate', 'f1', 'data:image/png;base64,TALL2'),
        product('p3', 'Short Tart', null, 'data:image/png;base64,SHORT'),
      ] : [];
      window.api.productFolders.list = async () => [{id: 'f1', name: 'Taller Cakes', createdAt: '2026-01-01'}];
      const generate = window.api.generate.image;
      window.generateCalls = [];
      window.api.generate.image = async args => { window.generateCalls.push(args); return generate(args); };
      showGallery();
    })()`);
    await clearReferences();
    const pickerButton =
      '[...document.querySelectorAll("form button[aria-haspopup=listbox]")].find(b => b.textContent.trim() === "Default")';
    await waitFor(pickerButton);
    const folderLabel = 'Folder: Taller Cakes — 2 products, one image each';
    // The prompt box loaded products earlier; refresh so it sees the test folder.
    await evaluate(
      '[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Refresh choices").click()',
    );
    await evaluate('new Promise(r => setTimeout(r, 300))');
    await evaluate(`${pickerButton}.click()`);
    await waitFor(
      `[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim() === ${JSON.stringify(folderLabel)})`,
    );
    const order = await evaluate(
      `[...document.querySelectorAll('[role=listbox] > *')].map(o => o.textContent.trim())`,
    );
    const folderIndex = order.indexOf(folderLabel);
    const firstEntry = order.findIndex((text) => text.startsWith('Product: '));
    assert.ok(
      folderIndex > -1 && firstEntry > -1 && folderIndex < firstEntry,
      `Folders are listed before individual entries: ${JSON.stringify(order)}`,
    );
    const allIndex = order.indexOf('All products — 3 products, one image each');
    assert.ok(
      allIndex > -1 && allIndex < folderIndex,
      `All products stays first: ${JSON.stringify(order)}`,
    );
    await evaluate(
      `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(folderLabel)}).click()`,
    );
    await waitFor(
      `[...document.querySelectorAll('form button[aria-haspopup=listbox]')].some(b => b.textContent.trim() === ${JSON.stringify(folderLabel)})`,
    );
    await evaluate(`(() => {
      const box = document.querySelector('form textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'On a cake stand');
      box.dispatchEvent(new Event('input', {bubbles: true}));
    })()`);
    const savesBeforeFolder = await evaluate('window.saveRequests.length');
    await evaluate('window.generateCalls = []');
    await evaluate(
      '[...document.querySelectorAll("form button")].find(b => b.textContent.trim() === "Generate").click()',
    );
    await waitFor(`window.saveRequests.length >= ${savesBeforeFolder + 2}`);
    await evaluate('new Promise(r => setTimeout(r, 300))');
    assert.deepEqual(
      await evaluate('window.generateCalls.map(call => call.imageUrls)'),
      [['data:image/png;base64,TALL1'], ['data:image/png;base64,TALL2']],
      'A folder batch sends each product only its own photos, one image per product',
    );
    assert.deepEqual(
      await evaluate(`window.saveRequests.slice(${savesBeforeFolder}).map(r => r.sourceName)`),
      ['Tall Lemon', 'Tall Chocolate'],
      'Each folder image is saved and named after its own product',
    );
    console.log('PASS product folders are listed first and make one image per product');

    // Each folder remembers its own composition (e.g. one per cake size).
    const template = (id, name) =>
      `{id: '${id}', name: '${name}', schemaVersion: 1, revision: 1, aspectRatio: '1:1', createdAt: '2026', updatedAt: '2026', angles: {}}`;
    await evaluate(
      `compositionStore.setState({folderLinks: {}, selectedId: null, notice: '', loaded: true, error: '', templates: [${template('t-tall', 'Tall cakes')}, ${template('t-short', 'Standard cakes')}]})`,
    );
    const compositionValue = () =>
      evaluate('document.querySelector("select[aria-label=Composition]").value');
    const chooseComposition = async (id) => {
      await evaluate(`(() => {
        const select = document.querySelector('select[aria-label=Composition]');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '${id}');
        select.dispatchEvent(new Event('change', {bubbles: true}));
      })()`);
      await waitFor(`document.querySelector('select[aria-label=Composition]').value === '${id}'`);
    };
    const pickScope = async (startsWith) => {
      await evaluate('document.querySelector("form button[aria-haspopup=listbox]").click()');
      await waitFor(
        `[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim().startsWith(${JSON.stringify(startsWith)}))`,
      );
      await evaluate(
        `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim().startsWith(${JSON.stringify(startsWith)})).click()`,
      );
      await waitFor(
        `document.querySelector('form button[aria-haspopup=listbox]').textContent.trim().startsWith(${JSON.stringify(startsWith)})`,
      );
      await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    };
    const statusText = () =>
      evaluate(
        '[...document.querySelectorAll("form [role=status]")].map(s => s.textContent.trim()).join(" | ")',
      );

    await waitFor('document.querySelector("select[aria-label=Composition] option[value=t-tall]")');
    await chooseComposition('t-tall');
    const nothingSaved =
      'No composition saved for this folder yet. Choose one and it will be remembered.';
    await pickScope('Unfiled products');
    assert.equal(
      await compositionValue(),
      '',
      'A folder with nothing saved starts at None, not the previous folder’s composition',
    );
    assert.ok(
      (await statusText()).includes(nothingSaved),
      `Explains how to link a folder: ${await statusText()}`,
    );
    // Choosing the composition the previous folder used is remembered for this one too.
    await chooseComposition('t-tall');
    await pickScope('All products');
    await pickScope('Unfiled products');
    assert.equal(
      await compositionValue(),
      't-tall',
      'The composition that was showing before can be linked to a new folder',
    );
    await chooseComposition('t-short');
    await pickScope('Folder: Taller Cakes');
    assert.equal(
      await compositionValue(),
      't-tall',
      'Picking the tall folder brings back its composition',
    );
    assert.ok(
      (await statusText()).includes('Using this folder’s composition: Tall cakes.'),
      `Says which composition the folder uses: ${await statusText()}`,
    );
    await pickScope('Unfiled products');
    assert.equal(
      await compositionValue(),
      't-short',
      'Picking the other folder brings back its own composition',
    );
    await pickScope('All products');
    await chooseComposition('');
    await pickScope('Folder: Taller Cakes');
    assert.equal(
      await compositionValue(),
      't-tall',
      'Changing composition outside a folder does not change what the folder remembers',
    );

    // Folder messages also show in 3-angles mode.
    const angleToggle =
      '[...document.querySelectorAll("form button[aria-pressed]")].find(b => b.textContent.trim() === "3 angles")';
    await evaluate(`${angleToggle}.click()`);
    await waitFor(`${angleToggle}.getAttribute('aria-pressed') === 'true'`);
    await evaluate('compositionStore.setState({folderLinks: {}})');
    await pickScope('All products');
    await pickScope('Unfiled products');
    assert.ok(
      (await statusText()).includes(nothingSaved),
      `Folder messages show in 3-angles mode: ${await statusText()}`,
    );
    await evaluate(`${angleToggle}.click()`);
    await waitFor(`${angleToggle}.getAttribute('aria-pressed') === 'false'`);
    console.log('PASS each product folder remembers its own composition');

    // Prompt box layout: composition sits in the bottom row with the other
    // controls, every control shows a short hint on hover, and no "?" markers remain.
    await evaluate('compositionStore.setState({notice: ""})');
    await pickScope('All products');
    await waitFor('document.querySelector("select[aria-label=Composition]")');
    // The prompt box has two fixed rows. Row 2 sits in a grid beside Generate,
    // so what the rows contain decides the line-up, not label widths.
    const layout = await evaluate(`(() => {
      const row1 = document.querySelector('form [data-controls-row="1"]');
      const row2 = document.querySelector('form [data-controls-row="2"]');
      const generate = document.querySelector('form button[type=submit]');
      const composition = document.querySelector('select[aria-label=Composition]');
      const buttonText = (row) => [...row.querySelectorAll('button')].map(b => b.textContent.trim() || b.getAttribute('aria-label'));
      return {
        row1: buttonText(row1),
        row2: buttonText(row2),
        compositionInRow2: row2.contains(composition),
        compositionInRow1: row1.contains(composition),
        generateBesideRow2: row2.parentElement.contains(generate) && !row2.contains(generate),
        row1Separate: !row1.contains(row2) && !row2.contains(row1),
        questionMarks: [...document.querySelectorAll('form button')].filter(b => b.textContent.trim() === '?').length,
        nativeTitles: [...document.querySelectorAll('form [title]')].map(el => el.getAttribute('title')),
      };
    })()`);
    assert.equal(
      layout.compositionInRow2 && !layout.compositionInRow1,
      true,
      `Composition is in the second row, not the first: ${JSON.stringify(layout)}`,
    );
    assert.equal(layout.generateBesideRow2, true, 'The second row sits beside Generate');
    assert.equal(layout.row1Separate, true, 'The two rows are separate');
    assert.deepEqual(
      layout.row1,
      // No image model is connected in this harness, so its menu is hidden.
      ['Saved prompts', 'All products — 3 products, one image each', 'Refresh choices', '3 angles'],
      'Row 1: what to make',
    );
    assert.deepEqual(
      layout.row2.slice(0, 5),
      ['Fewer images', 'More images', '1:1', 'High', 'PNG'],
      'Row 2 starts with count, ratio, quality and format, as before',
    );
    assert.ok(
      layout.row2.includes('New composition'),
      `New composition sits in row 2: ${JSON.stringify(layout.row2)}`,
    );
    const savedPromptsLabels = layout.row1.filter((text) => /prompts/i.test(text));
    assert.equal(layout.questionMarks, 0, 'No "?" help markers remain');
    assert.deepEqual(layout.nativeTitles, [], 'Slow browser tooltips are replaced by hints');
    assert.deepEqual(savedPromptsLabels, ['Saved prompts'], 'The button reads "Saved prompts"');

    // Move the real pointer over each control, then away to an empty corner.
    const settleFrames = () =>
      evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const hintFor = async (selector) => {
      const point = await evaluate(
        `(() => { const el = ${selector}; el.scrollIntoView({block: 'center'}); const r = el.getBoundingClientRect(); return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}; })()`,
      );
      // Start from outside the control: scrolling under a still pointer is not a hover.
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await settleFrames();
      window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      // Give the pointer event time to arrive, then read the hint (or none).
      const text = await evaluate(
        `new Promise((resolve) => { let frames = 0; (function check() { const hint = document.querySelector('[data-hint]'); if (hint || ++frames > 60) resolve(hint ? hint.textContent.trim() : null); else requestAnimationFrame(check); })(); })`,
      );
      window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
      await waitFor('!document.querySelector("[data-hint]")');
      return text;
    };
    const button = (label) =>
      `[...document.querySelectorAll('form button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
    const expectedHints = [
      [button('Saved prompts'), 'Save or reuse prompt wording'],
      ['document.querySelector("form button[aria-haspopup=listbox]")', 'Products to photograph'],
      [button('Refresh choices'), 'Reload products and folders'],
      [button('3 angles'), 'Eye level, 45° and close-up'],
      [button('More images'), 'Images per product'],
      [button('High'), 'Image quality'],
      [button('PNG'), 'File type'],
      [
        'document.querySelector("select[aria-label=Composition]")',
        'Scene layout for the photo; a folder remembers its own',
      ],
      [button('New composition'), 'Create a scene layout from a photo'],
      [button('Add reference photos'), 'Add product photos, or drop them here'],
      ['document.querySelector("form button[type=submit]")', 'Create the images'],
    ];
    for (const [selector, expected] of expectedHints) {
      assert.equal(await hintFor(selector), expected, `Hovering shows a short hint: ${expected}`);
    }
    assert.equal(
      await evaluate('document.querySelectorAll("[data-hint]").length'),
      0,
      'Hints disappear when the pointer leaves',
    );
    // Keyboard users see the hint too: Tab from the control before it. The hidden
    // test window needs page focus for the browser to treat focus as keyboard focus.
    window.webContents.focus();
    await evaluate(`${button('Refresh choices')}.focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await waitFor(`document.activeElement === ${button('3 angles')}`);
    await waitFor('document.querySelector("[data-hint]")');
    assert.equal(
      await evaluate('document.querySelector("[data-hint]").textContent.trim()'),
      'Eye level, 45° and close-up',
      'Tabbing to a control shows its hint',
    );
    // Escape hides it again without moving focus.
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await waitFor('!document.querySelector("[data-hint]")');
    assert.equal(
      await evaluate(`document.activeElement === ${button('3 angles')}`),
      true,
      'Escape hides the hint and keeps focus',
    );

    // A hint never covers an open menu: not on re-hover, and not when focus
    // moves into the menu.
    await evaluate(`${button('High')}.click()`);
    await waitFor(`${button('High')}.getAttribute('aria-expanded') === 'true'`);
    await waitFor('document.querySelector("[role=option]")');
    const quality = await evaluate(
      `(() => { const r = ${button('High')}.getBoundingClientRect(); return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)}; })()`,
    );
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await settleFrames();
    window.webContents.sendInputEvent({ type: 'mouseMove', x: quality.x, y: quality.y });
    await evaluate('new Promise(r => setTimeout(r, 200))');
    assert.equal(
      await evaluate('document.querySelectorAll("[data-hint]").length'),
      0,
      'Re-hovering a control with its menu open does not cover the menu',
    );
    await evaluate(`${button('High')}.click()`);
    await waitFor(`${button('High')}.getAttribute('aria-expanded') === 'false'`);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    await settleFrames();
    assert.equal(
      await hintFor(button('High')),
      'Image quality',
      'The hint returns once the menu is closed',
    );
    // Keyboard: Tab into the open Saved prompts menu; its hint must stay hidden.
    await evaluate(`${button('Saved prompts')}.click()`);
    await waitFor(`${button('Saved prompts')}.getAttribute('aria-expanded') === 'true'`);
    window.webContents.focus();
    await evaluate(`${button('Saved prompts')}.focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    await waitFor(
      `(() => { const menu = ${button('Saved prompts')}.parentElement; const el = document.activeElement; return menu.contains(el) && el !== ${button('Saved prompts')}; })()`,
    );
    assert.equal(
      await evaluate('document.activeElement.matches(":focus-visible")'),
      true,
      'Focus moved into the menu by keyboard',
    );
    await evaluate('new Promise(r => setTimeout(r, 100))');
    assert.equal(
      await evaluate('document.querySelectorAll("[data-hint]").length'),
      0,
      'Tabbing inside an open menu does not show the hint over it',
    );
    await evaluate(`${button('Saved prompts')}.click()`);
    await waitFor(`${button('Saved prompts')}.getAttribute('aria-expanded') === 'false'`);
    console.log('PASS composition sits in the bottom row and every control has a hover hint');
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
