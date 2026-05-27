// Thin Anthropic Messages API wrapper for edge functions.
// Returns parsed JSON content. Callers pass a JSON Schema description in the
// system prompt; we don't validate strictly server-side — the strict shape
// check happens on the client where the suggestion is rendered.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export class AnthropicError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface CallOptions {
  system: string;
  user: string;
  maxTokens?: number;
}

export async function callAnthropicJson<T>(opts: CallOptions): Promise<T> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new AnthropicError(500, 'ANTHROPIC_API_KEY is not configured');
  }

  const body = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  };

  // One retry on transient 5xx / network failures.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (res.status >= 500 && attempt === 0) {
          lastErr = new AnthropicError(res.status, text || 'Anthropic 5xx');
          continue;
        }
        throw new AnthropicError(res.status, text || `Anthropic ${res.status}`);
      }

      const json = await res.json() as { content?: { type: string; text?: string }[] };
      const text = json.content?.find(b => b.type === 'text')?.text ?? '';
      return extractJson<T>(text);
    } catch (err) {
      if (attempt === 0 && !(err instanceof AnthropicError)) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new AnthropicError(500, 'Anthropic call failed');
}

// Models occasionally wrap JSON in ```json fences or add prose. Strip both.
function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  // Fenced block
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  // Find first { or [ and last } or ] to be tolerant of trailing prose
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  const start = firstObj === -1 ? firstArr : (firstArr === -1 ? firstObj : Math.min(firstObj, firstArr));
  if (start === -1) throw new AnthropicError(502, 'Anthropic response had no JSON');
  const endChar = candidate[start] === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(endChar);
  if (end === -1 || end < start) throw new AnthropicError(502, 'Anthropic response JSON unterminated');
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (err) {
    throw new AnthropicError(502, `Anthropic JSON parse failed: ${(err as Error).message}`);
  }
}
