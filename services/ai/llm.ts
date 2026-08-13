/**
 * Penyedia LLM — DeepSeek (REST kompatibel OpenAI, tanpa SDK).
 *
 * Dipindahkan utuh dari monolit ke ai-service. Inilah alasan utama ai-service
 * dipisah: panggilan ke penyedia eksternal bisa menggantung sampai 30 detik,
 * dan di dalam satu proses bersama, request kasir ikut mengantre di belakangnya.
 * Sebagai proses tersendiri, DeepSeek yang lambat hanya memperlambat AI.
 *
 * Kunci API dibaca dari environment dan tidak pernah di-hardcode, tidak pernah
 * dicatat di log, dan dibersihkan dari pesan error lewat scrubSecret().
 */

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * The API key is read from the environment and nowhere else — it is never
 * hardcoded, never logged, and never echoed into a response body.
 * Returns null when the key is absent, which is the signal every route uses to
 * fall back to its offline canned answer instead of failing.
 */
export function getLlmConfig(): LlmConfig | null {
  const apiKey = (process.env.DEEPSEEK_API_KEY || '').trim();
  if (!apiKey) return null;

  const rawBase = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').trim();
  const baseUrl = rawBase.replace(/\/+$/, '');
  const model = (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim() || 'deepseek-chat';

  return { apiKey, baseUrl, model };
}

/** Provider name shown in logs and status text. Never includes the key. */
export const LLM_PROVIDER_LABEL = 'DeepSeek';
/** A hung provider must never pin an Express worker forever. */
export const LLM_TIMEOUT_MS = 30_000;
const LLM_DEFAULT_MAX_TOKENS = 1500;

interface LlmCallOptions {
  system?: string;
  user: string;
  /** Ask the provider for a strict JSON object reply. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Caller-owned cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
}

interface LlmCallResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string } | null;
}

/** Defensive: strip the key from any text before it can reach a log or a client. */
function scrubSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

/**
 * The single transport every AI route in this file goes through.
 * Throws on timeout and on any non-2xx reply; the thrown message is scrubbed of
 * the API key so it is safe to log.
 */
export async function callLlm(opts: LlmCallOptions): Promise<LlmCallResult> {
  const cfg = getLlmConfig();
  if (!cfg) {
    throw new Error('LLM provider belum dikonfigurasi di server ini.');
  }

  const messages: { role: 'system' | 'user'; content: string }[] = [];
  if (opts.system && opts.system.trim()) {
    messages.push({ role: 'system', content: opts.system });
  }

  let userContent = opts.user;
  if (opts.json) {
    // DeepSeek rejects response_format=json_object unless the literal word
    // "json" appears somewhere in the prompt.
    const haystack = `${opts.system || ''}\n${userContent}`.toLowerCase();
    if (!haystack.includes('json')) {
      userContent = `${userContent}\n\nBalas hanya dengan satu objek json valid.`;
    }
  }
  messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: false,
    max_tokens: opts.maxTokens ?? LLM_DEFAULT_MAX_TOKENS,
    temperature: opts.temperature ?? 0.7,
  };
  if (opts.json) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LLM_TIMEOUT_MS);

  const external = opts.signal;
  const forwardAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        detail = '';
      }
      throw new Error(
        scrubSecret(
          `${LLM_PROVIDER_LABEL} menolak permintaan (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
          cfg.apiKey
        )
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content ?? '';

    return {
      text: typeof text === 'string' ? text : '',
      promptTokens: Number(data.usage?.prompt_tokens ?? 0) || 0,
      completionTokens: Number(data.usage?.completion_tokens ?? 0) || 0,
    };
  } catch (err: unknown) {
    const aborted =
      timedOut ||
      (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted')));
    if (aborted && !(external && external.aborted)) {
      throw new Error(`Permintaan ke ${LLM_PROVIDER_LABEL} melewati batas waktu ${LLM_TIMEOUT_MS / 1000} detik.`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(scrubSecret(message, cfg.apiKey));
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener('abort', forwardAbort);
  }
}
