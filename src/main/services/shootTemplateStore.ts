import { randomUUID } from 'crypto';
import {
  existsSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  realpathSync,
  unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { writeJsonAtomic, withJsonLock } from './atomicJson';
import { getShootTemplatesDir, getShootTemplatesJsonPath, resolveLocalFileUrl } from './paths';
import {
  isRecord,
  validateTemplate,
  validAssetUrl,
  validTemplateId,
  type ShootTemplate,
} from '../../shared/shootTemplates';

type TemplateContent = Pick<ShootTemplate, 'name' | 'aspectRatio' | 'angles'>;
type PreparedContent = TemplateContent | (() => TemplateContent);
interface ShootTemplateStore {
  list: () => ShootTemplate[];
  get: (id: string) => ShootTemplate | null;
  create: (content: PreparedContent) => Promise<ShootTemplate>;
  update: (id: string, revision: number, content?: PreparedContent) => Promise<ShootTemplate>;
  saveAsset: (bytes: Buffer) => string;
}
export function createShootTemplateStore(deps: {
  metadataPath: () => string;
  assetDir: () => string;
  writeJson?: typeof writeJsonAtomic;
  now?: () => string;
}): ShootTemplateStore {
  const publish = deps.writeJson ?? writeJsonAtomic;
  const now = deps.now ?? (() => new Date().toISOString());
  function read(): ShootTemplate[] {
    const path = deps.metadataPath();
    if (!existsSync(path)) return [];
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(
        'Composition storage is unreadable. Restore shoot-templates.json before saving.',
      );
    }
    if (!isRecord(data) || data.schemaVersion !== 1 || !Array.isArray(data.templates))
      throw new Error('Invalid composition storage; existing data was not changed.');
    const templates = data.templates.map((entry: unknown) => {
      const result = validateTemplate(entry);
      if (!result.ok) throw new Error(result.error);
      return result.value;
    });
    if (new Set(templates.map((template) => template.id)).size !== templates.length)
      throw new Error('Duplicate composition template IDs.');
    return templates;
  }
  function save(templates: ShootTemplate[]): void {
    for (const template of templates) {
      const result = validateTemplate(template);
      if (!result.ok) throw new Error(result.error);
    }
    publish(deps.metadataPath(), { schemaVersion: 1, templates });
  }
  return {
    list(): ShootTemplate[] {
      return read()
        .filter((template) => !template.archivedAt)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    },
    get(id: string): ShootTemplate | null {
      if (!validTemplateId(id)) throw new Error('Invalid template ID.');
      return read().find((template) => template.id === id) ?? null;
    },
    async create(content: PreparedContent): Promise<ShootTemplate> {
      return withJsonLock(deps.metadataPath(), () => {
        const templates = read();
        const timestamp = now();
        const template: ShootTemplate = {
          ...(typeof content === 'function' ? content() : content),
          id: randomUUID(),
          schemaVersion: 1,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        save([...templates, template]);
        return template;
      });
    },
    async update(id: string, revision: number, content?: PreparedContent): Promise<ShootTemplate> {
      if (!validTemplateId(id) || !Number.isSafeInteger(revision) || revision < 1)
        throw new Error('Invalid template revision.');
      return withJsonLock(deps.metadataPath(), () => {
        const templates = read();
        const index = templates.findIndex((template) => template.id === id);
        const previous = templates[index];
        if (!previous || previous.archivedAt) throw new Error('Template is missing or archived.');
        if (previous.revision !== revision)
          throw new Error('This template changed. Reopen it before saving.');
        const timestamp = now();
        const template: ShootTemplate = {
          ...previous,
          ...(typeof content === 'function' ? content() : content),
          revision: revision + 1,
          updatedAt: timestamp,
          ...(!content ? { archivedAt: timestamp } : {}),
        };
        templates[index] = template;
        save(templates);
        return template;
      });
    },
    saveAsset(bytes: Buffer): string {
      if (!bytes.length || bytes.length > 30 * 1024 * 1024)
        throw new Error('Reference must be no larger than 30 MB.');
      const filename = `${randomUUID()}.png`;
      const path = join(deps.assetDir(), filename);
      const temporary = `${path}.tmp`;
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        try {
          writeFileSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        renameSync(temporary, path);
      } finally {
        if (existsSync(temporary)) unlinkSync(temporary);
      }
      return `local-file:///shoot-templates/${filename}`;
    },
  };
}
export const shootTemplateStore = createShootTemplateStore({
  metadataPath: getShootTemplatesJsonPath,
  assetDir: getShootTemplatesDir,
});

export function resolveShootTemplateAsset(url: string): string {
  if (!validAssetUrl(url)) throw new Error('Only owned composition assets can be used.');
  const path = resolveLocalFileUrl(url);
  if (!path || dirname(realpathSync(path)) !== realpathSync(getShootTemplatesDir()))
    throw new Error('Composition reference is missing or outside its asset folder.');
  return path;
}
