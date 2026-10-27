import { createMiddleware } from 'hono/factory';
import type { AppEnv, ChaosOptions } from '../context';

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Simula o sistema legado instável: de vez em quando ele "cai" por alguns segundos e
 * todas as requisições recebem 503 até voltar. A falha acontece antes do handler, então
 * nunca deixa escrita pela metade.
 */
export function chaos(options: ChaosOptions) {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let outageUntil = 0;

  return createMiddleware<AppEnv>(async (c, next) => {
    if (options.latencyMs > 0) await sleep(Math.round(random() * options.latencyMs));

    const t = now();
    if (t >= outageUntil && options.failureRate > 0 && random() < options.failureRate) {
      outageUntil = t + options.outageMs;
    }
    if (t < outageUntil) {
      const retryAfter = Math.max(1, Math.ceil((outageUntil - t) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { error: { code: 'service_unavailable', message: 'Sistema de chamados indisponível no momento.' } },
        503,
      );
    }
    await next();
    return undefined;
  });
}
