import { dialog, BrowserWindow, app } from 'electron';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import log from 'electron-log/main';
import { resolveLocalFileUrl } from '../services/paths';
import { safeFileStem, extensionFor, uniqueFilename } from '../services/exportNames';
import { secureHandle } from './validateSender';

/** One image in a bulk export. */
interface ExportItem {
  url: string;
  /** Base name for the file, before sanitising and de-duplication. */
  name: string;
  /** Stored filename, used only to pick the extension. */
  filename?: string;
}

/** Guards against a malformed payload asking for an unbounded write loop. */
const MAX_EXPORT_ITEMS = 500;

export function registerFileHandlers(): void {
  secureHandle('files:download', async (_event, url: string, filename: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false };

    const { filePath } = await dialog.showSaveDialog(win, {
      defaultPath: join(app.getPath('downloads'), filename),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });

    if (!filePath) return { success: false, cancelled: true };

    let buffer: Buffer;

    if (url.startsWith('local-file://')) {
      const localPath = resolveLocalFileUrl(url);
      if (!localPath) {
        throw new Error('Invalid local file path');
      }
      buffer = readFileSync(localPath);
    } else {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to download');
      }
      buffer = Buffer.from(await response.arrayBuffer());
    }

    writeFileSync(filePath, buffer);

    return { success: true, filePath };
  });

  /**
   * Save many images into one folder the user picks once.
   *
   * Only `local-file://` URLs are accepted: everything the app has generated is
   * already saved locally, and that keeps this handler from being turned into a
   * fetch-anything primitive.
   */
  secureHandle('files:exportBatch', async (_event, items: ExportItem[]) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false as const, exported: 0, failed: 0 };
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false as const, exported: 0, failed: 0 };
    }
    if (items.length > MAX_EXPORT_ITEMS) {
      throw new Error(`You can export up to ${MAX_EXPORT_ITEMS} images at once.`);
    }

    const { filePaths } = await dialog.showOpenDialog(win, {
      title: 'Choose a folder to export into',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Export here',
    });

    const directory = filePaths?.[0];
    if (!directory) return { success: false as const, cancelled: true, exported: 0, failed: 0 };

    const used = new Set<string>();
    let exported = 0;
    let failed = 0;

    for (const item of items) {
      try {
        if (!item || typeof item.url !== 'string') {
          failed++;
          continue;
        }

        const localPath = resolveLocalFileUrl(item.url);
        if (!localPath) {
          failed++;
          continue;
        }

        const stem = safeFileStem(typeof item.name === 'string' ? item.name : '');
        const target = join(directory, uniqueFilename(stem, extensionFor(item.filename), used));
        writeFileSync(target, readFileSync(localPath));
        exported++;
      } catch (error) {
        log.error('[files:exportBatch] failed to export an image', {
          message: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }
    }

    return { success: exported > 0, directory, exported, failed };
  });
}
