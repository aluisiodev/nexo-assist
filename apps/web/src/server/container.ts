import 'server-only';
import { createServiceDeskClient, type ServiceDeskClient } from '@nexo/service-desk-client';
import { BasicResponder } from './agent/basic-responder';
import type { AgentResponder, ServiceDeskAccess } from './agent/types';
import { SessionRepository } from './auth/sessions';
import { ConversationRepository } from './conversations/repository';
import { ConversationService } from './conversations/service';
import { openAppDatabase } from './db/open';
import { env } from './env';

export interface Container {
  readonly sessions: SessionRepository;
  readonly conversations: ConversationService;
  readonly conversationRepo: ConversationRepository;
  readonly serviceDesk: ServiceDeskClient;
  readonly serviceDeskAccess: ServiceDeskAccess;
  readonly responder: AgentResponder;
}

/**
 * Monta as dependências uma única vez por processo. Fica em globalThis para sobreviver
 * ao hot reload do `next dev` sem abrir conexões novas a cada edição.
 */
const holder = globalThis as typeof globalThis & { __nexoContainer?: Promise<Container> };

async function build(): Promise<Container> {
  const e = env();
  const db = await openAppDatabase(e.APP_DATABASE_URL);
  const clientOptions = { baseUrl: e.SERVICE_DESK_URL, apiKey: e.SERVICE_DESK_API_KEY } as const;
  const serviceDesk = createServiceDeskClient(clientOptions);

  const serviceDeskAccess: ServiceDeskAccess = {
    // Um cliente por resposta, para registrar no trace as tentativas extras daquela resposta.
    forActor: (employeeId, opts) =>
      createServiceDeskClient({ ...clientOptions, ...(opts?.onRetry ? { onRetry: opts.onRetry } : {}) }).forActor(
        employeeId,
        {
          viaAgent: true,
        },
      ),
    searchArticles: (q, limit) => serviceDesk.searchArticles(q, limit),
  };

  // Etapa atual: modo básico. O agent com LLM entra aqui, com o modo básico como reserva.
  const responder: AgentResponder = new BasicResponder(serviceDeskAccess);
  const conversationRepo = new ConversationRepository(db);

  return {
    sessions: new SessionRepository(db),
    conversationRepo,
    conversations: new ConversationService({ repo: conversationRepo, responder, serviceDesk: serviceDeskAccess }),
    serviceDesk,
    serviceDeskAccess,
    responder,
  };
}

export function container(): Promise<Container> {
  holder.__nexoContainer ??= build().catch((err: unknown) => {
    holder.__nexoContainer = undefined;
    throw err;
  });
  return holder.__nexoContainer;
}
