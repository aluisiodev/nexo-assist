/**
 * Evals das decisões do agent com os provedores de IA reais (usa as chaves do .env).
 *
 *   npm run evals                     → Gemini e Groq (os que tiverem chave)
 *   npm run evals -- google           → só um provedor
 *   npm run evals -- google vpn       → só os casos cujo id contém "vpn"
 *
 * Cada caso é uma conversa com resultado esperado (ver cases.ts). O script dá uma nota,
 * mostra o que falhou e grava o detalhe em evals/results/. As chaves nunca são exibidas.
 * Sai com código 1 se a nota ficar abaixo de EVALS_MIN_SCORE (padrão 0,8).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LlmResponder } from '../src/server/agent/llm/llm-responder';
import { CASES } from './cases';
import { runCase, summarize, type CaseResult } from './harness';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const PROVIDERS = {
  google: {
    label: 'Gemini',
    model: process.env.LLM_GOOGLE_MODEL || 'gemini-flash-lite-latest',
    toolChoice: 'required' as const,
    hasKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY),
  },
  groq: {
    label: 'Groq',
    model: process.env.LLM_GROQ_MODEL || 'openai/gpt-oss-120b',
    toolChoice: 'auto' as const,
    hasKey: Boolean(process.env.GROQ_API_KEY),
  },
} as const;
type Provider = keyof typeof PROVIDERS;

const args = process.argv.slice(2);
const providerArgs = args.filter((a): a is Provider => a in PROVIDERS);
const filter = args.find((a) => !(a in PROVIDERS));
const targets: Provider[] = providerArgs.length ? providerArgs : ['google', 'groq'];
const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;
const minScore = Number(process.env.EVALS_MIN_SCORE ?? 0.8);

const pct = (n: number) => `${Math.round(n * 100)}%`;

async function evaluate(provider: Provider) {
  const p = PROVIDERS[provider];
  const name = `${p.label} (${p.model})`;
  console.log(`\n══════ Evals · ${name} ══════`);
  if (!p.hasKey) {
    console.log('  (pulado: sem chave no .env)');
    return null;
  }
  const results: CaseResult[] = [];
  for (const c of cases) {
    const result = await runCase(
      (deps) =>
        new LlmResponder({
          name,
          model: `${provider}/${p.model}`,
          deps,
          toolChoice: p.toolChoice,
          ...(provider === 'groq' && p.model.includes('gpt-oss')
            ? { providerOptions: { groq: { reasoningEffort: 'low' } } }
            : {}),
        }),
      c,
    );
    results.push(result);
    const total = result.passed.length + result.failed.length;
    const mark = result.failed.length === 0 ? '✓' : '✗';
    const replies = result.observation.replies;
    const secs = replies.reduce((s, r) => s + r.durationMs, 0) / 1000;
    const tokens = replies.reduce((s, r) => s + r.tokens, 0);
    console.log(
      `  ${mark} ${c.id.padEnd(26)} ${String(result.passed.length).padStart(2)}/${total}  ${secs.toFixed(1)} s  ${tokens} tokens`,
    );
    for (const f of result.failed) console.log(`      ✗ ${f}`);
    if (result.failed.length > 0) {
      const tools = result.observation.tools.join(' → ') || '(nenhuma)';
      console.log(`      · ferramentas: ${tools}`);
      console.log(
        `      · última resposta: ${(result.observation.last?.text ?? '(nenhuma)').replace(/\s+/g, ' ').slice(0, 160)}`,
      );
    }
  }
  const s = summarize(results);
  console.log(
    `\n  Nota: ${s.passedChecks}/${s.checks} verificações (${pct(s.score)}) · ${s.perfectCases}/${s.cases} casos perfeitos · ` +
      `${s.errors} erro(s) · ${s.avgSecondsPerReply.toFixed(1)} s e ${Math.round(s.avgTokensPerReply)} tokens por resposta`,
  );

  const dir = join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${provider}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ provider: name, summary: s, results }, null, 2));
  console.log(`  Detalhes: ${file}`);
  return { name, summary: s };
}

const outcomes = [];
for (const t of targets) outcomes.push(await evaluate(t));
const ran = outcomes.filter((o): o is NonNullable<typeof o> => o !== null);

console.log('\n══════ Resumo ══════');
if (ran.length === 0) console.log('  Nenhum provedor com chave no .env.');
for (const o of ran)
  console.log(`  ${o.name}: ${pct(o.summary.score)} (${o.summary.perfectCases}/${o.summary.cases} casos perfeitos)`);
process.exit(ran.some((o) => o.summary.score < minScore) ? 1 : 0);
