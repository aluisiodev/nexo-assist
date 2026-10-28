/**
 * Limite de velocidade por chave (ex.: funcionário), no formato "balde de fichas":
 * cabem `limit` mensagens seguidas e uma ficha volta a cada `windowMs / limit`.
 * Quem passa do limite espera só até a próxima ficha (com 10 por minuto, até 6 s),
 * e não o minuto inteiro como numa janela fixa.
 *
 * Fica em memória: basta para um processo. Com várias instâncias, trocaria por Redis.
 */
export type RateLimitResult = { readonly ok: true } | { readonly ok: false; readonly retryAfterSec: number };

export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    /** Mensagens seguidas permitidas (e o total por janela); 0 desliga o limite. */
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registra um evento e diz se ele está dentro do limite. */
  hit(key: string): RateLimitResult {
    if (this.limit <= 0) return { ok: true };
    const t = this.now();
    const perMs = this.limit / this.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: this.limit, at: t };
    const tokens = Math.min(this.limit, bucket.tokens + (t - bucket.at) * perMs);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, at: t });
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
    }
    this.buckets.set(key, { tokens: tokens - 1, at: t });
    return { ok: true };
  }
}
