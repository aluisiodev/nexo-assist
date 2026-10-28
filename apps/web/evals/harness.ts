import type { HandoffReason, SupportGroup } from '@nexo/domain';
import type { ChatMessage, DraftView } from '../src/lib/chat';
import type { TurnDeps } from '../src/server/agent/llm/turn';
import type { AgentResponder } from '../src/server/agent/types';
import type { SessionUser } from '../src/server/auth/sessions';
import { ConversationService } from '../src/server/conversations/service';
import { ANA, createConversationRepo, createServiceDesk, draftsFor, NOW } from '../test/helpers';

/**
 * Evals das decisões do agent: cada caso é uma conversa com o resultado esperado
 * (ferramentas chamadas, rascunho ou não, transferência, o que pode ou não aparecer).
 * Roda contra o service desk real em memória, com os dados de exemplo e o relógio
 * fixo numa terça às 10:00, então só o modelo varia entre uma execução e outra.
 */

export interface ReplyObservation {
  readonly text: string;
  readonly intent: string | undefined;
  readonly confidence: number | undefined;
  readonly engine: string;
  readonly tools: readonly string[];
  readonly question: string | undefined;
  readonly options: readonly string[];
  readonly durationMs: number;
  readonly tokens: number;
}

/** O que aconteceu na conversa, do jeito que os critérios precisam ver. */
export interface Observation {
  readonly replies: readonly ReplyObservation[];
  /** Ferramentas chamadas em toda a conversa, na ordem. */
  readonly tools: readonly string[];
  /** Rascunhos montados (estado final). */
  readonly drafts: readonly DraftView[];
  readonly handoff: { readonly reason: HandoffReason; readonly group: SupportGroup } | null;
  readonly ticketsShown: readonly string[];
  readonly articlesShown: readonly string[];
  /** Chamados que passaram a existir no service desk (deve ficar vazio: só o funcionário confirma). */
  readonly ticketsCreated: readonly string[];
  /** Respostas que falharam (erro do provedor ou resposta descartada). */
  readonly errors: number;
  readonly last: ReplyObservation | undefined;
}

export interface Check {
  readonly label: string;
  readonly ok: (o: Observation) => boolean;
}

export interface EvalCase {
  readonly id: string;
  readonly title: string;
  /** Regra do Anexo A (ou do PRD) que o caso verifica. */
  readonly rule: string;
  readonly user?: SessionUser;
  readonly turns: readonly string[];
  readonly checks: readonly Check[];
}

export interface CaseResult {
  readonly id: string;
  readonly title: string;
  readonly passed: readonly string[];
  readonly failed: readonly string[];
  readonly observation: Observation;
}

export type ResponderFactory = (deps: TurnDeps) => AgentResponder;

/** Conversa o caso do começo ao fim, num ambiente novo (bancos temporários). */
export async function runCase(makeResponder: ResponderFactory, c: EvalCase): Promise<CaseResult> {
  const user = c.user ?? ANA;
  const repo = await createConversationRepo();
  const sd = await createServiceDesk();
  const drafts = draftsFor(repo);
  const service = new ConversationService({
    repo,
    responder: makeResponder({ serviceDesk: sd.access, drafts }),
    serviceDesk: sd.access,
    drafts,
    clock: () => NOW,
    log: () => {},
  });

  const ticketIds = async () =>
    new Set((await sd.client.forActor(user.employeeId).listTickets({ status: 'all' })).map((t) => t.id));
  const before = await ticketIds();

  const agentMessages: ChatMessage[] = [];
  for (const text of c.turns) {
    const { messages } = await service.sendEmployeeMessage(user, text);
    agentMessages.push(...messages.filter((m) => m.role === 'agent'));
  }

  // Estado final (cards de rascunho atualizados, transferência registrada).
  const snapshot = await service.snapshotFor(user);
  const conversation = await repo.findById(snapshot.conversation.id);
  const finalById = new Map(snapshot.messages.map((m) => [m.id, m]));
  const replies = agentMessages.map((m) => toReply(finalById.get(m.id) ?? m));
  const blocks = agentMessages.flatMap((m) => (finalById.get(m.id) ?? m).blocks);

  const observation: Observation = {
    replies,
    tools: replies.flatMap((r) => r.tools),
    drafts: blocks.flatMap((b) => (b.type === 'ticket_draft' ? [b.draft] : [])),
    handoff:
      conversation?.handoffReason && conversation.handoffGroup
        ? { reason: conversation.handoffReason, group: conversation.handoffGroup }
        : null,
    ticketsShown: blocks.flatMap((b) =>
      b.type === 'ticket_card' ? [b.ticket.id] : b.type === 'ticket_list' ? b.tickets.map((t) => t.id) : [],
    ),
    articlesShown: blocks.flatMap((b) => (b.type === 'article' ? [b.id] : [])),
    ticketsCreated: [...(await ticketIds())].filter((id) => !before.has(id)),
    errors: replies.filter((r) => r.intent === 'erro').length,
    last: replies.at(-1),
  };

  const passed: string[] = [];
  const failed: string[] = [];
  // Com erro do provedor, nada foi decidido: "não abriu chamado" passaria à toa.
  const broken = observation.errors > 0 || replies.length === 0;
  for (const check of c.checks) (!broken && check.ok(observation) ? passed : failed).push(check.label);
  return { id: c.id, title: c.title, passed, failed, observation };
}

function toReply(m: ChatMessage): ReplyObservation {
  const quick = m.blocks.find((b) => b.type === 'quick_replies');
  return {
    text: m.text,
    intent: m.trace?.intent,
    confidence: m.trace?.confidence,
    engine: m.trace?.engine ?? '',
    tools: m.trace?.tools ?? [],
    question: quick?.type === 'quick_replies' ? quick.question : undefined,
    options: quick?.type === 'quick_replies' ? quick.options.map((o) => o.label) : [],
    durationMs: m.trace?.durationMs ?? 0,
    tokens: m.trace?.tokens ?? 0,
  };
}

export interface Summary {
  readonly checks: number;
  readonly passedChecks: number;
  readonly perfectCases: number;
  readonly cases: number;
  readonly score: number;
  readonly errors: number;
  readonly avgSecondsPerReply: number;
  readonly avgTokensPerReply: number;
}

export function summarize(results: readonly CaseResult[]): Summary {
  const checks = results.reduce((n, r) => n + r.passed.length + r.failed.length, 0);
  const passedChecks = results.reduce((n, r) => n + r.passed.length, 0);
  const replies = results.flatMap((r) => r.observation.replies).filter((r) => r.intent !== 'erro');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    checks,
    passedChecks,
    perfectCases: results.filter((r) => r.failed.length === 0).length,
    cases: results.length,
    score: checks ? passedChecks / checks : 0,
    errors: results.reduce((n, r) => n + r.observation.errors, 0),
    avgSecondsPerReply: avg(replies.map((r) => r.durationMs / 1000)),
    avgTokensPerReply: avg(replies.map((r) => r.tokens)),
  };
}
