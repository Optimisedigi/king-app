import { createServer, type Server } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { shell } from 'electron';
import { getOAuthTokens, setOAuthTokens, clearOAuthTokens } from './apiKeyStore';
import log from 'electron-log/main';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access api.connectors.read api.connectors.invoke';

export interface OpenAITokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId?: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return {};
  try {
    const payload = Buffer.from(parts[1]!, 'base64url');
    return JSON.parse(payload.toString()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI token exchange failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

async function refreshTokens(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI token refresh failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token?: string;
  }>;
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Listen on the fixed port 1455 for the OpenAI OAuth callback.
 * Matches the registered redirect_uri for client app_EMoamEEZ73f0CkXaXp7hrann.
 */
function listenForCallback(expectedState: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let receivedCode: string | null = null;

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url || '', 'http://localhost');

      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      if (url.searchParams.get('state') !== expectedState) {
        res.statusCode = 400;
        res.end('State mismatch');
        return;
      }

      receivedCode = url.searchParams.get('code');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#2e7d32">Login successful!</h1><p>You can close this tab and return to OptiMate.</p></div></body></html>',
      );

      server.close();
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(1455, '127.0.0.1');

    const timeout = setTimeout(() => {
      if (!receivedCode) server.close();
    }, timeoutMs);
    timeout.unref();

    server.on('close', () => {
      clearTimeout(timeout);
      if (receivedCode) {
        resolve(receivedCode);
      } else {
        reject(new Error('Server closed without receiving code'));
      }
    });
  });
}

export async function loginOpenAI(): Promise<OpenAITokens> {
  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('hex');

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'login');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'optimate');

  const authUrl = url.toString();
  log.info('[openaiOAuth] opening browser for consent');
  await shell.openExternal(authUrl);

  const code = await listenForCallback(state, 120_000);
  const tokenResponse = await exchangeCode(code, REDIRECT_URI, verifier);

  const idTokenPayload = tokenResponse.id_token ? decodeJwtPayload(tokenResponse.id_token) : {};
  const accountId = (idTokenPayload.chatgpt_account_id as string) ?? (idTokenPayload.sub as string);

  const tokens: OpenAITokens = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token ?? '',
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
    accountId,
  };

  await setOAuthTokens('openai', tokens);
  log.info('[openaiOAuth] login successful, account:', accountId);
  return tokens;
}

export async function getValidAccessToken(): Promise<string> {
  const stored = await getOAuthTokens('openai');
  if (!stored) throw new Error('Not connected. Log in via the APIs page.');

  const tokens = stored as OpenAITokens;

  // Token still valid (with 60s buffer)
  if (tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }

  // Refresh
  if (!tokens.refreshToken) {
    throw new Error('No refresh token. Log in again via the APIs page.');
  }

  log.info('[openaiOAuth] refreshing expired token');
  const refreshed = await refreshTokens(tokens.refreshToken);

  const idTokenPayload = refreshed.id_token ? decodeJwtPayload(refreshed.id_token) : {};
  const updatedTokens: OpenAITokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    accountId: tokens.accountId ?? (idTokenPayload.chatgpt_account_id as string),
  };

  await setOAuthTokens('openai', updatedTokens);
  return updatedTokens.accessToken;
}

export async function getStatus(): Promise<{ connected: boolean; accountId?: string }> {
  const stored = await getOAuthTokens('openai');
  if (!stored) return { connected: false };
  const tokens = stored as OpenAITokens;
  return { connected: true, accountId: tokens.accountId };
}

export async function logout(): Promise<void> {
  await clearOAuthTokens('openai');
  log.info('[openaiOAuth] logged out');
}
