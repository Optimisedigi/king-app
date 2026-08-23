import { loginOpenAI, getStatus, logout } from '../services/openaiOAuth';
import { secureHandle } from './validateSender';

export function registerOpenAIOAuthHandlers(): void {
  secureHandle('openaiOAuth:login', async () => {
    const tokens = await loginOpenAI();
    return { connected: true, accountId: tokens.accountId };
  });

  secureHandle('openaiOAuth:status', async () => {
    return getStatus();
  });

  secureHandle('openaiOAuth:logout', async () => {
    await logout();
  });
}
