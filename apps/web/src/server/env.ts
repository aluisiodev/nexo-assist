import 'server-only';
import { z } from 'zod';

const blankAsUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankAsUndefined, schema);

const EnvSchema = z.object({
  NODE_ENV: opt(z.enum(['development', 'production', 'test']).default('development')),
  SERVICE_DESK_URL: opt(z.url().default('http://localhost:4010')),
  SERVICE_DESK_API_KEY: opt(z.string().min(16).default('dev-only-service-desk-key')),
  APP_DATABASE_URL: opt(z.string().default('file:data/app.db')),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cached: AppEnv | undefined;

/** Variáveis do app, validadas uma vez. O .env da raiz é carregado pelo next.config.ts. */
export function env(): AppEnv {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida do app web:\n${problems}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.SERVICE_DESK_API_KEY === 'dev-only-service-desk-key') {
    throw new Error('Defina SERVICE_DESK_API_KEY em produção.');
  }
  cached = parsed.data;
  return cached;
}
