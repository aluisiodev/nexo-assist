import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Raiz do monorepo, onde fica o .env. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const DEV_API_KEY = 'dev-only-service-desk-key';

/** Variável vazia no .env conta como não definida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema);

const EnvSchema = z.object({
  SERVICE_DESK_PORT: optional(z.coerce.number().int().positive().default(4010)),
  SERVICE_DESK_API_KEY: optional(z.string().min(16, 'precisa ter ao menos 16 caracteres').default(DEV_API_KEY)),
  SERVICE_DESK_DATABASE_URL: optional(z.string().default('file:data/service-desk.db')),
  SERVICE_DESK_DATABASE_AUTH_TOKEN: optional(z.string().optional()),
  CHAOS_FAILURE_RATE: optional(z.coerce.number().min(0).max(1).default(0.05)),
  CHAOS_OUTAGE_MS: optional(z.coerce.number().int().min(0).default(4000)),
  CHAOS_LATENCY_MS: optional(z.coerce.number().int().min(0).default(150)),
  NODE_ENV: optional(z.string().default('development')),
});

export interface ServiceDeskConfig {
  readonly port: number;
  readonly apiKey: string;
  readonly databaseUrl: string;
  /** Token do libSQL remoto (Turso); vazio para arquivo local. */
  readonly databaseAuthToken: string | undefined;
  readonly chaos: { readonly failureRate: number; readonly outageMs: number; readonly latencyMs: number };
  readonly usingDevApiKey: boolean;
}

/** Carrega o .env da raiz (se existir) e valida as variáveis. Falha cedo com mensagem clara. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceDeskConfig {
  const envFile = resolve(REPO_ROOT, '.env');
  if (env === process.env && existsSync(envFile)) process.loadEnvFile(envFile);

  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida do service desk:\n${problems}`);
  }
  const e = parsed.data;
  const usingDevApiKey = e.SERVICE_DESK_API_KEY === DEV_API_KEY;
  if (usingDevApiKey && e.NODE_ENV === 'production') {
    throw new Error('Defina SERVICE_DESK_API_KEY em produção.');
  }
  return {
    port: e.SERVICE_DESK_PORT,
    apiKey: e.SERVICE_DESK_API_KEY,
    databaseUrl: e.SERVICE_DESK_DATABASE_URL,
    databaseAuthToken: e.SERVICE_DESK_DATABASE_AUTH_TOKEN,
    chaos: { failureRate: e.CHAOS_FAILURE_RATE, outageMs: e.CHAOS_OUTAGE_MS, latencyMs: e.CHAOS_LATENCY_MS },
    usingDevApiKey,
  };
}
