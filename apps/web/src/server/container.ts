import 'server-only';
import { createServiceDeskClient, type ServiceDeskClient } from '@nexo/service-desk-client';
import { buildResponder } from './agent/build-responder';
import { ConsoleService } from './console/service';
import type { AgentResponder, ServiceDeskAccess } from './agent/types';
import { SessionRepository } from './auth/sessions';
import { ConversationRepository } from './conversations/repository';
import { ConversationService } from './conversations/service';
import { openAppDatabase } from './db/open';
import { DraftRepository } from './drafts/repository';
import { DraftService } from './drafts/service';
import { env } from './env';
import { AiBudget } from './limits/ai-budget';
import { SlidingWindowRateLimiter } from './limits/rate-limiter';

export interface Container {
  readonly sessions: SessionRepository;
  readonly conversations: ConversationService;
  /** Console do analista (fila, conversa, ações). */
  readonly console: ConsoleService;
  readonly conversationRepo: ConversationRepository;
  readonly serviceDesk: ServiceDeskClient;
  readonly serviceDeskAccess: ServiceDeskAccess;
  readonly responder: AgentResponder;
  /** Mensagens por minuto por funcionário. */
  readonly chatRateLimit: SlidingWindowRateLimiter;
}

/**
 * Monta as dependências uma única vez por processo. Fica em globalThis para sobreviver
 * ao hot reload do `next dev` sem abrir conexões novas a cada edição.
 */
const holder = globalThis as typeof globalThis & { __nexoContainer?: Promise<Container> };

async function build(): Promise<Container> {
  const e = env();
  const db = await openAppDatabase(e.APP_DATABASE_URL, e.APP_DATABASE_AUTH_TOKEN);
  const clientOptions = { baseUrl: e.SERVICE_DESK_URL, apiKey: e.SERVICE_DESK_API_KEY } as const;
  const serviceDesk = createServiceDeskClient(clientOptions);

  const serviceDeskAccess: ServiceDeskAccess = {
    // Um cliente por resposta, para registrar no trace as tentativas extras daquela resposta.
    forActor: (employeeId, opts) =>
      createServiceDeskClient({ ...clientOptions, ...(opts?.onRetry ? { onRetry: opts.onRetry } : {}) }).forActor(
        employeeId,
        { viaAgent: true },
      ),
    searchArticles: (q, limit) => serviceDesk.searchArticles(q, limit),
  };

  const conversationRepo = new ConversationRepository(db);
  const drafts = new DraftService(new DraftRepository(db), conversationRepo);

  const { responder, chain } = buildResponder(
    {
      provider: e.LLM_PROVIDER,
      fallbackProvider: e.LLM_FALLBACK_PROVIDER,
      googleModel: e.LLM_GOOGLE_MODEL,
      groqModel: e.LLM_GROQ_MODEL,
      hasGoogleKey: Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY ?? e.GOOGLE_API_KEY),
      hasGroqKey: Boolean(e.GROQ_API_KEY),
    },
    { serviceDesk: serviceDeskAccess, drafts },
    new AiBudget(db, e.AI_DAILY_CALL_LIMIT),
  );
  console.log(`[agent] quem responde, em ordem: ${chain.join(' → ')}`);
  console.log(
    `[limites] ${e.CHAT_RATE_LIMIT_PER_MINUTE || 'sem limite de'} mensagens/min por funcionário · ` +
      `${e.AI_DAILY_CALL_LIMIT || 'sem cota de'} respostas com IA/dia`,
  );

  const conversations = new ConversationService({
    repo: conversationRepo,
    responder,
    serviceDesk: serviceDeskAccess,
    drafts,
  });

  return {
    sessions: new SessionRepository(db),
    conversationRepo,
    conversations,
    console: new ConsoleService({ repo: conversationRepo, conversations, serviceDesk }),
    serviceDesk,
    serviceDeskAccess,
    responder,
    chatRateLimit: new SlidingWindowRateLimiter(e.CHAT_RATE_LIMIT_PER_MINUTE),
  };
}

export function container(): Promise<Container> {
  holder.__nexoContainer ??= build().catch((err: unknown) => {
    holder.__nexoContainer = undefined;
    throw err;
  });
  return holder.__nexoContainer;
}
