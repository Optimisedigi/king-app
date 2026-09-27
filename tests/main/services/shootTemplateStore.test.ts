import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
const runtime = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => runtime.root } }));
import {
  createShootTemplateStore,
  resolveShootTemplateAsset,
} from '../../../src/main/services/shootTemplateStore';
import { getShootTemplatesDir } from '../../../src/main/services/paths';
import type { ShootTemplate } from '../../../src/shared/shootTemplates';
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'composition-test-'));
  directories.push(dir);
  const deps = { metadataPath: () => join(dir, 'shoot-templates.json'), assetDir: () => dir };
  const store = createShootTemplateStore(deps);
  const url = store.saveAsset(Buffer.from('test-only asset'));
  const content: Pick<ShootTemplate, 'name' | 'aspectRatio' | 'angles'> = {
    name: 'Studio',
    aspectRatio: '1:1',
    angles: {
      'eye-level': {
        sourceUrl: url,
        referenceUrl: url,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        guides: { centreX: 0.5, baseY: 0.8, width: 0.6 },
      },
    },
  };
  return { dir, deps, store, content };
}
describe('isolated composition storage', () => {
  it('resolves only owned assets and rejects traversal and symlink escapes', () => {
    const { dir } = setup();
    runtime.root = dir;
    const root = getShootTemplatesDir();
    const name = '11111111-1111-1111-1111-111111111111.png';
    writeFileSync(join(root, name), 'owned');
    expect(resolveShootTemplateAsset(`local-file:///shoot-templates/${name}`)).toBe(
      join(root, name),
    );
    expect(resolveShootTemplateAsset(`local-file://shoot-templates/${name}`)).toBe(
      join(root, name),
    );
    for (const url of [
      'file:///etc/passwd',
      `local-file:///shoot-templates/../${name}`,
      `local-file:///shoot-templates/%2e%2e/${name}`,
    ])
      expect(() => resolveShootTemplateAsset(url)).toThrow();
    const outside = join(dir, 'outside.png');
    writeFileSync(outside, 'not-owned');
    const link = '22222222-2222-2222-2222-222222222222.png';
    symlinkSync(outside, join(root, link));
    expect(() => resolveShootTemplateAsset(`local-file:///shoot-templates/${link}`)).toThrow(
      'outside',
    );
  });
  it('creates, reloads, updates and archives without removing old assets', async () => {
    const { store, deps, content, dir } = setup();
    const created = await store.create(content);
    expect(createShootTemplateStore(deps).get(created.id)).toEqual(created);
    const updated = await store.update(created.id, 1, { ...content, name: 'New' });
    expect(updated.revision).toBe(2);
    await store.update(created.id, 2);
    expect(store.list()).toEqual([]);
    expect(store.get(created.id)?.archivedAt).toBeTruthy();
    const filename = content.angles['eye-level']?.sourceUrl.split('/').pop();
    if (!filename) throw new Error('Fixture must include a source');
    expect(readFileSync(join(dir, filename), 'utf8')).toBe('test-only asset');
  });
  it('serializes simultaneous updates and rejects stale revisions', async () => {
    const { store, content } = setup();
    const saved = await store.create(content);
    const prepare = vi.fn(() => content);
    const results = await Promise.allSettled([
      store.update(saved.id, 1, prepare),
      store.update(saved.id, 1, prepare),
    ]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(store.get(saved.id)?.revision).toBe(2);
  });
  it('retains valid data when publishing fails and does not touch other stores', async () => {
    const { store, deps, content, dir } = setup();
    await store.create(content);
    writeFileSync(join(dir, 'products.json'), 'unchanged');
    const previous = readFileSync(deps.metadataPath(), 'utf8');
    const failing = createShootTemplateStore({
      ...deps,
      writeJson: () => {
        throw new Error('Disk full');
      },
    });
    await expect(failing.create(content)).rejects.toThrow('Disk full');
    expect(readFileSync(deps.metadataPath(), 'utf8')).toBe(previous);
    expect(readFileSync(join(dir, 'products.json'), 'utf8')).toBe('unchanged');
  });
  it('refuses to replace malformed existing JSON', async () => {
    const { store, deps, content } = setup();
    writeFileSync(deps.metadataPath(), '{broken');
    await expect(store.create(content)).rejects.toThrow('unreadable');
    expect(readFileSync(deps.metadataPath(), 'utf8')).toBe('{broken');
  });
});
