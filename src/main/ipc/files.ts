import { dialog, BrowserWindow, app } from 'electron';
import { writeFileSync, readFileSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import log from 'electron-log/main';
import { resolveLocalFileUrl } from '../services/paths';
import { safeFileStem, extensionFor, uniqueFilename } from '../services/exportNames';
import { openZipWriter } from '../services/zipWriter';
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

    // Exports are named after the user's original photos, so the folder may
    // already hold those originals. Treat every existing name as taken so an
    // export is numbered ("Cake-2.png") instead of overwriting a file.
    const used = new Set<string>(readdirSync(directory).map((name) => name.toLowerCase()));
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
        // 'wx' fails rather than overwrite a file created since the folder was read.
        writeFileSync(target, readFileSync(localPath), { flag: 'wx' });
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

  /**
   * Save many images into one zip file the user names once.
   *
   * Same rules as the folder export: only saved `local-file://` images, names
   * sanitised and de-duplicated inside the zip. No zip is created if none of
   * the images could be read.
   */
  secureHandle('files:exportZip', async (_event, items: ExportItem[]) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { success: false as const, exported: 0, failed: 0 };
    if (!Array.isArray(items) || items.length === 0) {
      return { success: false as const, exported: 0, failed: 0 };
    }
    if (items.length > MAX_EXPORT_ITEMS) {
      throw new Error(`You can export up to ${MAX_EXPORT_ITEMS} images at once.`);
    }

    const now = new Date();
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');
    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Save the selected images as a zip',
      defaultPath: join(app.getPath('downloads'), `OptiMate images ${day}.zip`),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (!filePath) return { success: false as const, cancelled: true, exported: 0, failed: 0 };

    const started = Date.now();
    const zip = await openZipWriter(filePath, now);
    const used = new Set<string>();
    let exported = 0;
    let failed = 0;
    try {
      for (const item of items) {
        const localPath =
          item && typeof item.url === 'string' ? resolveLocalFileUrl(item.url) : null;
        if (!localPath) {
          failed++;
          continue;
        }
        let data: Buffer;
        try {
          data = await readFile(localPath);
        } catch (error) {
          log.error('[files:exportZip] failed to read an image', {
            message: error instanceof Error ? error.message : String(error),
          });
          failed++;
          continue;
        }
        const stem = safeFileStem(typeof item.name === 'string' ? item.name : '');
        await zip.add(uniqueFilename(stem, extensionFor(item.filename), used), data);
        exported++;
      }
      if (exported === 0) {
        await zip.abort();
        return { success: false as const, exported, failed };
      }
      await zip.finish();
    } catch (error) {
      await zip.abort();
      log.error('[files:exportZip] failed to write the zip', {
        exported,
        failed,
        elapsedMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    log.info('[files:exportZip] saved zip', { exported, failed, elapsedMs: Date.now() - started });
    return { success: true as const, filePath, exported, failed };
  });
}
