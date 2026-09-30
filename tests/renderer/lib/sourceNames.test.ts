import { describe, expect, it } from 'vitest';
import {
  fileStem,
  isGenericClipboardName,
  sourceNameForReferences,
} from '../../../src/renderer/src/lib/sourceNames';

const cheesecake = {
  name: 'Blueberry Cheesecake',
  referenceImages: [
    'local-file:///entities/products/a.webp',
    'local-file:///entities/products/b.webp',
  ],
  originalFilenames: ['IMG_2041 blueberry.webp', ''],
};
const tart = {
  name: 'Lemon Tart',
  referenceImages: ['local-file:///entities/products/c.jpg'],
};

describe('fileStem', () => {
  it.each([
    ['blueberry cheesecake.webp', 'blueberry cheesecake'],
    ['IMG_2041.JPG', 'IMG_2041'],
    ['archive.tar.gz', 'archive.tar'],
    ['no-extension', 'no-extension'],
    ['  spaced.png  ', 'spaced'],
    ['.hidden', '.hidden'],
  ])('%j → %j', (input, expected) => {
    expect(fileStem(input)).toBe(expected);
  });
});

describe('isGenericClipboardName', () => {
  it.each([
    'image.png',
    'Image.PNG',
    'image (2).jpg',
    'blob.png',
    'Pasted Image.png',
    'clipboard.webp',
  ])('treats %j as a stand-in name, not a real file name', (name) =>
    expect(isGenericClipboardName(name)).toBe(true),
  );
  it.each(['IMG_2041.png', 'image of cake.png', 'my image.png', 'Lemon Tart.jpg'])(
    'keeps real file name %j',
    (name) => expect(isGenericClipboardName(name)).toBe(false),
  );
});

describe('sourceNameForReferences', () => {
  it('uses the original file name stored with a saved product photo', () => {
    expect(sourceNameForReferences([cheesecake.referenceImages[0]!], [cheesecake, tart])).toBe(
      'IMG_2041 blueberry',
    );
  });

  it("falls back to the product's name when no original file name was stored", () => {
    expect(sourceNameForReferences([cheesecake.referenceImages[1]!], [cheesecake])).toBe(
      'Blueberry Cheesecake',
    );
    expect(sourceNameForReferences(tart.referenceImages, [cheesecake, tart])).toBe('Lemon Tart');
  });

  it('uses the file name of a photo added in the prompt box', () => {
    const added = new Map([['data:image/png;base64,AAA', 'Wedding cake FINAL.png']]);
    expect(sourceNameForReferences(['data:image/png;base64,AAA'], [tart], added)).toBe(
      'Wedding cake FINAL',
    );
  });

  it('names after the first identifiable photo, in order', () => {
    const added = new Map([['data:x', 'second.png']]);
    expect(
      sourceNameForReferences(
        ['https://unknown/x.png', tart.referenceImages[0]!, 'data:x'],
        [tart],
        added,
      ),
    ).toBe('Lemon Tart');
  });

  it('returns undefined when no photo can be identified', () => {
    expect(sourceNameForReferences([], [tart])).toBeUndefined();
    expect(sourceNameForReferences(['https://unknown/x.png'], [tart])).toBeUndefined();
  });
});
