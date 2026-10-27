/**
 * Limite de velocidade por chave (ex.: funcionário), em janela deslizante.
 * Protege a cota de IA contra cliques repetidos ou scripts; uso normal nunca chega nele.
 *
 * Fica em memória: basta para um processo. Com várias instâncias, trocaria por Redis.
 */
export type RateLimitResult = { readonly ok: true } | { readonly ok: false; readonly retryAfterSec: number };

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    /** Máximo de eventos por janela; 0 desliga o limite. */
    private readonly limit: number,
    private readonly windowMs: number = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registra um evento e diz se ele está dentro do limite. */
  hit(key: string): RateLimitResult {
    if (this.limit <= 0) return { ok: true };
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => at > t - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0]!;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + this.windowMs - t) / 1000)) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { ok: true };
  }
}
