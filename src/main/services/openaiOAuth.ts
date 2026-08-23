import { beginOAuth } from './oauthBroker';
import { getOAuthTokens, setOAuthTokens, clearOAuthTokens } from './apiKeyStore';
import log from 'electron-log/main';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const SCOPES = ['openid', 'profile', 'email', 'offline_access'];

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

export async function loginOpenAI(): Promise<OpenAITokens> {
  const flow = await beginOAuth({
    service: 'openai',
    scopes: SCOPES,
    pkce: true,
    buildAuthUrl: ({ redirectUri, state, codeChallenge }) => {
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge ?? '',
        code_challenge_method: 'S256',
      });
      return `${AUTH_URL}?${params.toString()}`;
    },
  });

  const callback = await flow.callback;
  const tokenResponse = await exchangeCode(callback.code, flow.redirectUri, flow.codeVerifier!);

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
