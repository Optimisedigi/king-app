import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShootTemplate } from '../../../src/shared/shootTemplates';
import { useCompositionStore } from '@/stores/compositionStore';

const angle = {
  sourceUrl: 'local-file:///source.png',
  referenceUrl: 'local-file:///reference.png',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  guides: { centreX: 0.5, baseY: 0.8, width: 0.5 },
};
const template = (id: string, name: string, archivedAt?: string): ShootTemplate => ({
  id,
  name,
  schemaVersion: 1,
  revision: 1,
  aspectRatio: '1:1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  angles: { 'eye-level': angle, 'elevated-45': angle },
  ...(archivedAt ? { archivedAt } : {}),
});
const NOTHING_SAVED =
  'No composition saved for this folder yet. Choose one and it will be remembered.';
const TALL = 'folder:tall';
const SHORT = 'folder:unfiled';
const store = () => useCompositionStore.getState();

beforeEach(() => {
  // The node test environment has no localStorage; persistence is not under test here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  useCompositionStore.setState({
    selectedId: null,
    singleShotAngle: 'eye-level',
    angleSelections: {},
    folderLinks: {},
    activeFolder: null,
    templates: [template('t-tall', 'Tall cakes'), template('t-short', 'Standard cakes')],
    loaded: true,
    error: '',
    notice: '',
  });
});

describe('composition per product folder', () => {
  it('remembers the composition chosen for each folder and brings it back', () => {
    store().enterScope(TALL);
    store().select('t-tall');
    store().setAngle('elevated-45');
    expect(store().notice).toBe('Saved as this folder’s composition.');

    store().enterScope(SHORT);
    store().select('t-short');
    store().setAngle('eye-level');

    store().enterScope(TALL);
    expect(store().selectedId).toBe('t-tall');
    expect(store().singleShotAngle).toBe('elevated-45');
    expect(store().notice).toBe('Using this folder’s composition: Tall cakes.');

    store().enterScope(SHORT);
    expect(store().selectedId).toBe('t-short');
    expect(store().singleShotAngle).toBe('eye-level');
  });

  it('starts a folder with nothing saved at None, so another folder’s framing is never reused', () => {
    store().enterScope(TALL);
    store().select('t-tall');
    store().assignAngle('eye-level', { templateId: 't-tall', referenceAngle: 'eye-level' });
    store().enterScope(SHORT);
    expect(store().selectedId).toBeNull();
    expect(store().angleSelections).toEqual({});
    expect(store().notice).toBe(NOTHING_SAVED);
    expect(Object.keys(store().folderLinks)).toEqual([TALL]);
  });

  it('remembers the composition that was showing before, once it is chosen for the new folder', () => {
    // The menu starts at None, so picking the previous composition is a real change.
    store().select('t-tall');
    store().enterScope(SHORT);
    expect(store().selectedId).toBeNull();
    store().select('t-tall');
    store().enterScope('none');
    store().enterScope(SHORT);
    expect(store().selectedId).toBe('t-tall');
  });

  it('does not nag about compositions when none exist', () => {
    useCompositionStore.setState({ templates: [] });
    store().enterScope(TALL);
    expect(store().notice).toBe('');
  });

  it('only links compositions chosen while a folder is picked', () => {
    store().enterScope('product:all');
    store().select('t-short');
    store().enterScope('none');
    store().select('t-tall');
    expect(store().folderLinks).toEqual({});
    expect(store().activeFolder).toBeNull();
  });

  it('switching away from a folder does not change what it remembers', () => {
    store().enterScope(TALL);
    store().select('t-tall');
    store().enterScope('product:all');
    store().select('t-short');
    store().enterScope(TALL);
    expect(store().selectedId).toBe('t-tall');
  });

  it('remembers None for a folder that should use no composition', () => {
    store().select('t-tall');
    store().enterScope(TALL);
    store().select(null);
    store().enterScope('none');
    store().select('t-short');
    store().enterScope(TALL);
    expect(store().selectedId).toBeNull();
    expect(store().notice).toBe('This folder uses no composition.');
  });

  it('falls back to None and says so when the folder’s composition was archived or deleted', () => {
    store().enterScope(TALL);
    store().select('t-tall');
    store().enterScope('none');
    useCompositionStore.setState({
      templates: [template('t-tall', 'Tall cakes', '2026-02-01'), template('t-short', 'Standard')],
      selectedId: 't-short',
    });
    store().enterScope(TALL);
    expect(store().selectedId).toBeNull();
    expect(store().notice).toContain('missing or archived');
  });

  it('remembers 3-angle assignments per folder too', () => {
    store().enterScope(TALL);
    store().assignAngle('eye-level', { templateId: 't-tall', referenceAngle: 'eye-level' });
    store().enterScope(SHORT);
    store().assignAngle('eye-level', { templateId: 't-short', referenceAngle: 'eye-level' });
    store().enterScope(TALL);
    expect(store().angleSelections['eye-level']).toEqual({
      templateId: 't-tall',
      referenceAngle: 'eye-level',
    });
    expect(store().notice).toBe('Using this folder’s 3-angle compositions.');
  });

  it('clears a folder’s stale 3-angle compositions and says so, keeping the valid ones', () => {
    store().enterScope(TALL);
    store().assignAngle('eye-level', { templateId: 't-tall', referenceAngle: 'eye-level' });
    store().assignAngle('elevated-45', { templateId: 't-short', referenceAngle: 'elevated-45' });
    store().enterScope('none');
    useCompositionStore.setState({
      templates: [template('t-tall', 'Tall cakes'), template('t-short', 'Standard', '2026-02-01')],
    });
    store().enterScope(TALL);
    expect(store().angleSelections).toEqual({
      'eye-level': { templateId: 't-tall', referenceAngle: 'eye-level' },
    });
    expect(store().notice).toBe(
      'Some of this folder’s 3-angle compositions are missing or archived and were cleared.',
    );
  });

  it('clears a 3-angle composition whose reference angle was removed', () => {
    store().enterScope(TALL);
    store().assignAngle('elevated-45', { templateId: 't-tall', referenceAngle: 'elevated-45' });
    store().enterScope('none');
    useCompositionStore.setState({
      templates: [{ ...template('t-tall', 'Tall cakes'), angles: { 'eye-level': angle } }],
    });
    store().enterScope(TALL);
    expect(store().angleSelections).toEqual({});
    expect(store().notice).toContain('missing or archived and were cleared');
  });

  it('ignores a damaged saved link instead of applying it', () => {
    useCompositionStore.setState({
      selectedId: 't-short',
      folderLinks: { [TALL]: { selectedId: 42, singleShotAngle: 'sideways' } as never },
    });
    store().enterScope(TALL);
    expect(store().selectedId).toBeNull();
    expect(store().notice).toBe(NOTHING_SAVED);
  });
});
