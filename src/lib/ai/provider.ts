/**
 * Minimal server-side LLM abstraction. Nothing else in this codebase calls a
 * real model today (see AI_MODEL = "synas-demo-deterministic" in ./schemas) —
 * every existing "AI" feature is deterministic templating over real CRM data.
 * This is the one seam for a real provider, kept intentionally small: one
 * bounded, timeout-guarded, JSON-only completion call. Never imported by
 * client code — only ever called from server-side lib/API modules.
 */
export type AIProvider = {
  readonly name: string;
  /** Single structured JSON completion. Resolves to null on any failure (timeout, HTTP error, invalid JSON) — callers must always have a deterministic fallback, never throw. */
  completeJson(input: { system: string; user: string; maxOutputTokens?: number }): Promise<unknown | null>;
};

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_MAX_TOKENS = 400;

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = process.env.OPENAI_MODEL || "gpt-4o-mini",
  ) {}

  async completeJson(input: { system: string; user: string; maxOutputTokens?: number }): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      try {
        return JSON.parse(content);
      } catch {
        return null;
      }
    } catch {
      // Timeout, network error, or anything else — the caller's deterministic
      // fallback takes over. This must never throw into the webhook path.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

let cached: AIProvider | null | undefined;

/**
 * Returns null when no AI credentials are configured (the default — see
 * .env.example). Demo mode, and this whole product, must keep working with
 * no provider: every caller of this function is required to have a safe
 * deterministic path when it returns null.
 */
export function getAIProvider(): AIProvider | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  cached = apiKey ? new OpenAIProvider(apiKey) : null;
  return cached;
}

/** Test-only escape hatch to reset the memoized provider between cases. */
export function _resetAIProviderCacheForTests(): void {
  cached = undefined;
}
