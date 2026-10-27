/**
 * Verificação do agent com os provedores de IA reais (usa as chaves do .env).
 *
 *   npm run agent:smoke            → testa Gemini e Groq
 *   npm run agent:smoke -- groq    → testa só um provedor
 *
 * Roda o service desk em memória (dados de exemplo, sem tocar nos seus bancos) e
 * conversa como a Ana em alguns cenários do PRD. Mostra, para cada resposta, quem
 * respondeu, as ações, a decisão, o tempo e os tokens. As chaves nunca são exibidas.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, openDatabase, seed } from '@nexo/service-desk';
import { createServiceDeskClient } from '@nexo/service-desk-client';
import type { ChatMessage } from '../src/lib/chat';
import { LlmResponder } from '../src/server/agent/llm/llm-responder';
import type { ServiceDeskAccess } from '../src/server/agent/types';
import type { SessionUser } from '../src/server/auth/sessions';
import { ConversationRepository } from '../src/server/conversations/repository';
import { ConversationService } from '../src/server/conversations/service';
import { openAppDatabase } from '../src/server/db/open';
import { DraftRepository } from '../src/server/drafts/repository';
import { DraftService } from '../src/server/drafts/service';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const ANA: SessionUser = {
  employeeId: 'emp-ana',
  name: 'Ana Souza',
  email: 'ana.souza@nexo.com.br',
  department: 'Financeiro',
  role: 'employee',
  supportGroup: null,
};

const PROVIDERS = {
  google: {
    label: 'Gemini',
    model: process.env.LLM_GOOGLE_MODEL || 'gemini-flash-lite-latest',
    hasKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY),
    keyName: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  groq: {
    label: 'Groq',
    model: process.env.LLM_GROQ_MODEL || 'openai/gpt-oss-120b',
    hasKey: Boolean(process.env.GROQ_API_KEY),
    keyName: 'GROQ_API_KEY',
  },
} as const;
type Provider = keyof typeof PROVIDERS;

const SCENARIOS: { title: string; turns: string[]; confirmDraft?: boolean }[] = [
  { title: 'Dúvida respondida pela central de ajuda', turns: ['Qual o horário de atendimento do service desk?'] },
  { title: 'Consulta de chamado sem número (Tela 3)', turns: ['Qual o status do meu chamado?'] },
  {
    title: 'Abertura de chamado com confirmação (Tela 2)',
    turns: [
      'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.',
      'Só eu. Tenho reunião com um cliente às 14h e preciso da VPN funcionando.',
    ],
    confirmDraft: true,
  },
  { title: 'Assunto fora de TI', turns: ['Quanto vou receber de vale-refeição este mês?'] },
];

async function buildService(provider: Provider) {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-smoke-'));
  const sdDb = await openDatabase(`file:${join(dir, 'sd.db')}`);
  await seed(sdDb, new Date());
  const apiKey = 'smoke-test-key-0123456789';
  const app = createApp({ db: sdDb, apiKey, chaos: { failureRate: 0, outageMs: 0, latencyMs: 0 } });
  const options = {
    baseUrl: 'http://service-desk.local',
    apiKey,
    fetch: ((input, init) => Promise.resolve(app.request(String(input), init))) as typeof fetch,
  };
  const client = createServiceDeskClient(options);
  const serviceDesk: ServiceDeskAccess = {
    forActor: (id, o) =>
      createServiceDeskClient({ ...options, ...(o?.onRetry ? { onRetry: o.onRetry } : {}) }).forActor(id, {
        viaAgent: true,
      }),
    searchArticles: (q, limit) => client.searchArticles(q, limit),
  };
  const appDb = await openAppDatabase(`file:${join(dir, 'app.db')}`);
  const repo = new ConversationRepository(appDb);
  const drafts = new DraftService(new DraftRepository(appDb), repo);
  const p = PROVIDERS[provider];
  const responder = new LlmResponder({
    name: `${p.label} (${p.model})`,
    model: `${provider}/${p.model}`,
    deps: { serviceDesk, drafts },
  });
  return new ConversationService({ repo, responder, serviceDesk, drafts, log: () => {} });
}

function show(m: ChatMessage) {
  if (m.role === 'employee') return console.log(`\n  👤 Ana: ${m.text}`);
  if (m.role === 'system') return console.log(`  ⚙  ${m.text}`);
  const t = m.trace;
  console.log(`  🤖 Nexo Assist: ${m.text.replace(/\n+/g, ' ')}`);
  if (t) {
    for (const s of t.steps)
      console.log(`     ${s.status === 'error' ? '✗' : '✓'} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`);
    const conf = t.confidence !== undefined ? `${Math.round(t.confidence * 100)}%` : '—';
    console.log(
      `     · intenção: ${t.intent ?? '—'} | segurança: ${conf} | ${t.engine} | ${((t.durationMs ?? 0) / 1000).toFixed(1)} s | ${t.tokens ?? '?'} tokens`,
    );
    if (t.reasoning) console.log(`     · por quê: ${t.reasoning}`);
  }
  for (const b of m.blocks) {
    if (b.type === 'ticket_draft') {
      const d = b.draft;
      const extra =
        d.kind === 'create'
          ? ` prioridade ${d.data.priority}, ${d.data.category}, "${d.data.title}"`
          : ` ${d.kind} ${d.data.ticketId}`;
      console.log(`     [rascunho ${d.id} · ${d.status}${d.ticketId ? ` → ${d.ticketId}` : ''}]${extra}`);
    } else if (b.type === 'ticket_card')
      console.log(`     [card ${b.ticket.id}${b.ticket.overdue ? ' · vencido' : ''}]`);
    else if (b.type === 'ticket_list') console.log(`     [lista: ${b.tickets.map((x) => x.id).join(', ')}]`);
    else if (b.type === 'article') console.log(`     [artigo: ${b.title}]`);
    else if (b.type === 'quick_replies') console.log(`     [opções: ${b.options.map((o) => o.label).join(' | ')}]`);
  }
}

async function run(provider: Provider) {
  const p = PROVIDERS[provider];
  console.log(`\n══════ ${p.label} · ${p.model} ══════`);
  if (!p.hasKey) {
    console.log(`  (pulado: ${p.keyName} não está no .env)`);
    return { provider, ok: 0, failed: 0, skipped: true };
  }
  const service = await buildService(provider);
  let ok = 0;
  let failed = 0;
  for (const scenario of SCENARIOS) {
    console.log(`\n▶ ${scenario.title}`);
    await service.startNew(ANA);
    for (const text of scenario.turns) {
      const { messages } = await service.sendEmployeeMessage(ANA, text);
      messages.forEach(show);
      const reply = messages.filter((m) => m.role === 'agent').at(-1);
      if (reply?.trace?.intent === 'erro') failed++;
      else ok++;
    }
    if (scenario.confirmDraft) {
      const snapshot = await service.snapshotFor(ANA);
      const draft = snapshot.messages
        .flatMap((m) => m.blocks)
        .find((b) => b.type === 'ticket_draft' && b.draft.status === 'pending');
      if (draft?.type === 'ticket_draft') {
        console.log(`\n  👤 Ana clica em Confirmar (${draft.draft.id})`);
        (await service.confirmDraft(ANA, draft.draft.id)).messages.filter((m) => m.role !== 'employee').forEach(show);
      } else {
        console.log('  (o agent não montou rascunho neste cenário)');
      }
    }
  }
  return { provider, ok, failed, skipped: false };
}

const arg = process.argv[2] as Provider | undefined;
const targets: Provider[] = arg && arg in PROVIDERS ? [arg] : ['google', 'groq'];
const results = [];
for (const t of targets) results.push(await run(t));

console.log('\n══════ Resumo ══════');
for (const r of results) {
  console.log(
    `  ${PROVIDERS[r.provider].label}: ${r.skipped ? 'sem chave' : `${r.ok} resposta(s) ok, ${r.failed} com erro`}`,
  );
}
process.exit(results.some((r) => r.failed > 0) ? 1 : 0);
