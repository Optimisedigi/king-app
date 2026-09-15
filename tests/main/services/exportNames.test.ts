import { describe, it, expect } from 'vitest';
import { safeFileStem, extensionFor, uniqueFilename } from '../../../src/main/services/exportNames';

describe('safeFileStem', () => {
  it('keeps ordinary product names readable', () => {
    expect(safeFileStem('Chocolate Profiterole Cake')).toBe('Chocolate Profiterole Cake');
  });

  it('strips path separators so a name cannot escape the folder', () => {
    expect(safeFileStem('../../etc/passwd')).not.toContain('/');
    expect(safeFileStem('..\\..\\windows')).not.toContain('\\');
    expect(safeFileStem('a/b/c')).toBe('a b c');
  });

  it('removes characters Windows rejects in filenames', () => {
    expect(safeFileStem('cake: 45° <shot>?"|*')).toBe('cake 45° shot');
  });

  it('falls back when nothing usable remains', () => {
    expect(safeFileStem('')).toBe('image');
    expect(safeFileStem('///')).toBe('image');
    expect(safeFileStem('...')).toBe('image');
  });

  it('avoids reserved Windows device names', () => {
    expect(safeFileStem('CON')).toBe('CON-file');
    expect(safeFileStem('lpt1')).toBe('lpt1-file');
  });

  it('drops trailing dots and spaces that the OS would strip anyway', () => {
    expect(safeFileStem('cake...')).toBe('cake');
    expect(safeFileStem('cake   ')).toBe('cake');
  });

  it('caps very long prompts so the filename stays valid', () => {
    expect(safeFileStem('x'.repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe('extensionFor', () => {
  it('keeps supported image extensions', () => {
    expect(extensionFor('a.png')).toBe('.png');
    expect(extensionFor('a.JPG')).toBe('.jpg');
    expect(extensionFor('a.jpeg')).toBe('.jpeg');
    expect(extensionFor('a.webp')).toBe('.webp');
  });

  it('defaults to .png for anything else', () => {
    expect(extensionFor(undefined)).toBe('.png');
    expect(extensionFor('a.txt')).toBe('.png');
    expect(extensionFor('noextension')).toBe('.png');
  });
});

describe('uniqueFilename', () => {
  it('uses the plain name when it is free', () => {
    expect(uniqueFilename('cake', '.png', new Set())).toBe('cake.png');
  });

  it('never overwrites an earlier file in the same export', () => {
    const used = new Set<string>();
    const names = [1, 2, 3].map(() => uniqueFilename('cake', '.png', used));
    expect(names).toEqual(['cake.png', 'cake-2.png', 'cake-3.png']);
    expect(new Set(names).size).toBe(3);
  });

  it('treats names differing only by case as the same file', () => {
    const used = new Set<string>();
    uniqueFilename('Cake', '.png', used);
    expect(uniqueFilename('cake', '.png', used)).toBe('cake-2.png');
  });
});
