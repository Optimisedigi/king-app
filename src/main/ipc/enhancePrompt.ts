import OpenAI, { APIError } from 'openai';
import log from 'electron-log/main';
import { getApiKey, getOAuthTokens } from '../services/apiKeyStore';
import { getValidAccessToken } from '../services/openaiOAuth';
import {
  ENHANCER_MODEL,
  ENHANCER_SYSTEM_PROMPT,
  MAX_ENHANCE_PROMPT_LENGTH,
  buildEnhanceUserMessage,
  cleanEnhancedPrompt,
  normaliseEnhanceInput,
} from '../services/promptEnhancer';
import { secureHandle } from './validateSender';

export type EnhancePromptResult =
  | { success: true; prompt: string }
  | { success: false; error: string };

const ENHANCE_TIMEOUT_MS = 60_000;

/**
 * GPT-6 models on the ChatGPT sign-in route use the Codex "responses-lite"
 * transport, which requires a current Codex client identity (>= 0.155.0).
 * The headers and body fields below mirror the installed ggcoder Codex
 * provider (`@kenkaiiii/gg-ai`, `streamOpenAICodex`), which sends exactly
 * these for every `gpt-6-` model. The image path in `generate.ts` does not
 * need them because its host model is not a GPT-6 model.
 */
const CODEX_CLIENT_VERSION = '0.155.1';

async function oauthAccountId(): Promise<string | null> {
  const stored = (await getOAuthTokens('openai')) as { accountId?: unknown } | null;
  if (!stored) return null;
  return typeof stored.accountId === 'string' ? stored.accountId : '';
}

/** Collects the assistant's text from a Codex SSE stream. */
export async function readCodexText(response: Response): Promise<string> {
  if (!response.body) throw new Error('OpenAI returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamed = '';
  let finalText = '';

  const handle = (event: Record<string, unknown>): void => {
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      streamed += event.delta;
    } else if (event.type === 'response.output_item.done') {
      const item = event.item as { type?: string; content?: unknown } | undefined;
      if (item?.type === 'message' && Array.isArray(item.content)) {
        finalText += item.content
          .map((part: { type?: string; text?: unknown }) =>
            part.type === 'output_text' && typeof part.text === 'string' ? part.text : '',
          )
          .join('');
      }
    } else if (event.type === 'response.failed' || event.type === 'error') {
      const response = event.response as { error?: { message?: string } } | undefined;
      const message =
        response?.error?.message ?? (typeof event.message === 'string' ? event.message : '');
      throw new Error(message || 'OpenAI could not enhance this prompt.');
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.startsWith('data: ')) continue;
      const json = raw.slice(6);
      if (json === '[DONE]') continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(json) as Record<string, unknown>;
      } catch {
        continue; // Skip malformed SSE lines.
      }
      handle(event);
    }
  }
  return finalText || streamed;
}

async function enhanceViaOAuth(
  instructions: string,
  userMessage: string,
  accountId: string,
  signal: AbortSignal,
): Promise<string> {
  const accessToken = await getValidAccessToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
    'User-Agent': `codex_cli_rs/${CODEX_CLIENT_VERSION}`,
    version: CODEX_CLIENT_VERSION,
    'X-OpenAI-Internal-Codex-Responses-Lite': 'true',
  };
  if (accountId) headers['chatgpt-account-id'] = accountId;

  const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model: ENHANCER_MODEL,
      // ChatGPT-account sign-in rejects the request unless this is explicit.
      store: false,
      stream: true,
      instructions,
      input: [{ role: 'user', content: [{ type: 'input_text', text: userMessage }] }],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      // GPT-6 models need at least low effort; low keeps Enhance quick.
      reasoning: { effort: 'low', context: 'all_turns' },
      text: { verbosity: 'low' },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI OAuth request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return readCodexText(res);
}

async function enhanceViaApiKey(
  apiKey: string,
  instructions: string,
  userMessage: string,
  signal: AbortSignal,
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create(
    {
      model: ENHANCER_MODEL,
      instructions,
      input: userMessage,
      reasoning: { effort: 'low' },
      store: false,
    },
    { signal },
  );
  return response.output_text;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'Enhance took too long. Your prompt was kept as it was.';
  }
  if (error instanceof APIError) {
    if (error.status === 401) return 'OpenAI rejected the API key. Update it on the APIs page.';
    if (error.status === 429) return 'OpenAI rate or credit limit reached. Try again shortly.';
    if (error.status === 404 || (error.status === 400 && /\bmodel\b/i.test(error.message))) {
      return 'This OpenAI key cannot use GPT-6 Luna. Sign in with ChatGPT on the APIs page to use Enhance.';
    }
  }
  const message = error instanceof Error ? error.message : '';
  if (/\((401|403)\)/.test(message)) {
    return 'ChatGPT sign-in has expired. Log in again on the APIs page.';
  }
  return message || 'Could not enhance the prompt. Your prompt was kept as it was.';
}

export function registerEnhancePromptHandlers(): void {
  secureHandle('prompt:enhance', async (_event, raw: unknown): Promise<EnhancePromptResult> => {
    const started = Date.now();
    let route = 'none';
    try {
      const { prompt, context, preferApiKey } = normaliseEnhanceInput(raw);
      const userMessage = buildEnhanceUserMessage(prompt, context);
      const signal = AbortSignal.timeout(ENHANCE_TIMEOUT_MS);

      const accountId = await oauthAccountId();
      const apiKey = getApiKey('openai');
      const useOAuth = accountId !== null && (!preferApiKey || !apiKey);
      let text: string;
      if (useOAuth) {
        route = 'oauth';
        text = await enhanceViaOAuth(ENHANCER_SYSTEM_PROMPT, userMessage, accountId, signal);
      } else if (apiKey) {
        route = 'api-key';
        text = await enhanceViaApiKey(apiKey, ENHANCER_SYSTEM_PROMPT, userMessage, signal);
      } else {
        return {
          success: false,
          error:
            'Enhance needs OpenAI. Sign in with ChatGPT or add an OpenAI key on the APIs page.',
        };
      }

      const enhanced = cleanEnhancedPrompt(text);
      if (!enhanced) throw new Error('OpenAI returned no text. Your prompt was kept as it was.');
      if (enhanced.length > MAX_ENHANCE_PROMPT_LENGTH) {
        throw new Error('The enhanced prompt was too long. Your prompt was kept as it was.');
      }
      log.info('[enhancePrompt] done', {
        route,
        model: ENHANCER_MODEL,
        inChars: prompt.length,
        outChars: enhanced.length,
        ms: Date.now() - started,
      });
      return { success: true, prompt: enhanced };
    } catch (error) {
      log.error('[enhancePrompt] failed', {
        route,
        model: ENHANCER_MODEL,
        ms: Date.now() - started,
        status: error instanceof APIError ? error.status : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: friendlyError(error) };
    }
  });
}
