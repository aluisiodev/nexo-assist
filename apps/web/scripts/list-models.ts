/**
 * Lista os modelos que as suas chaves do .env conseguem usar (Gemini e Groq).
 *
 *   npm run agent:models
 *
 * Use para escolher LLM_GOOGLE_MODEL e LLM_GROQ_MODEL. As chaves nunca são exibidas.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

async function groq(): Promise<void> {
  const key = process.env.GROQ_API_KEY;
  console.log('\n══ Groq ══');
  if (!key) return console.log('  (sem GROQ_API_KEY no .env)');
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return console.log(`  erro HTTP ${res.status}`);
  const body = (await res.json()) as { data: { id: string; active?: boolean; context_window?: number }[] };
  const ids = body.data
    .filter((m) => m.active !== false && !/whisper|tts|guard|orpheus|playai/i.test(m.id))
    .map((m) => m.id)
    .sort();
  for (const id of ids) console.log(`  ${id}`);
  console.log(`\n  Atual: ${process.env.LLM_GROQ_MODEL || 'openai/gpt-oss-120b (padrão)'}`);
}

async function google(): Promise<void> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  console.log('\n══ Gemini ══');
  if (!key) return console.log('  (sem GOOGLE_GENERATIVE_AI_API_KEY no .env)');
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key },
  });
  if (!res.ok) return console.log(`  erro HTTP ${res.status}`);
  const body = (await res.json()) as { models: { name: string; supportedGenerationMethods?: string[] }[] };
  const ids = body.models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name))
    .filter((m) => !/image|tts|live|embedding|audio/i.test(m.name))
    .map((m) => m.name.replace('models/', ''))
    .sort();
  for (const id of ids) console.log(`  ${id}`);
  console.log(`\n  Atual: ${process.env.LLM_GOOGLE_MODEL || 'gemini-flash-lite-latest (padrão)'}`);
}

await groq().catch((e: unknown) => console.log(`  falha: ${e instanceof Error ? e.message : String(e)}`));
await google().catch((e: unknown) => console.log(`  falha: ${e instanceof Error ? e.message : String(e)}`));
