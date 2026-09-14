import {
  listSavedPrompts,
  addSavedPrompt,
  updateSavedPrompt,
  deleteSavedPrompt,
} from '../services/savedPromptStore';
import { secureHandle } from './validateSender';

export function registerSavedPromptHandlers(): void {
  secureHandle('savedPrompts:list', async () => listSavedPrompts());

  secureHandle('savedPrompts:create', async (_event, data: { title: string; prompt: string }) => {
    if (!data || typeof data !== 'object') throw new Error('Invalid saved prompt payload');
    // The store validates and trims the fields themselves.
    return addSavedPrompt(data);
  });

  secureHandle(
    'savedPrompts:update',
    async (_event, id: string, data: { title?: string; prompt?: string }) => {
      if (typeof id !== 'string' || !id) throw new Error('Invalid saved prompt id');
      if (!data || typeof data !== 'object') throw new Error('Invalid saved prompt payload');
      return updateSavedPrompt(id, data);
    },
  );

  secureHandle('savedPrompts:delete', async (_event, id: string) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid saved prompt id');
    const success = await deleteSavedPrompt(id);
    return { success };
  });
}
