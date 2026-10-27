import type { HandoffReason, SupportGroup } from '@nexo/domain';
import type { ActorServiceDeskClient, RetryInfo, ServiceDeskClient } from '@nexo/service-desk-client';
import type { AgentTrace, ChatMessage, MessageBlock } from '../../lib/chat';
import type { SessionUser } from '../auth/sessions';
import type { Conversation } from '../conversations/repository';

/**
 * Contrato entre o chat e "quem responde". O agent com LLM (Mastra) e o modo básico
 * (regras, sem IA) implementam a mesma interface; o serviço de conversas não sabe
 * qual está em uso. É isso que permite o plano B/C quando um provedor de IA falha.
 */
export interface AgentContext {
  readonly conversation: Conversation;
  readonly user: SessionUser;
  /** Histórico da conversa, incluindo a mensagem atual (última). */
  readonly history: readonly ChatMessage[];
  readonly text: string;
  /** Id da mensagem atual: base para chaves de idempotência das ações. */
  readonly messageId: string;
  readonly now: Date;
}

export interface AgentReplyMessage {
  readonly text: string;
  readonly blocks?: readonly MessageBlock[];
  readonly trace: AgentTrace;
}

export interface HandoffRequest {
  readonly reason: HandoffReason;
  readonly group: SupportGroup;
  /** Resumo do caso para o analista não precisar perguntar tudo de novo. */
  readonly summary: string;
  readonly confidence?: number;
  /** Chamado relacionado, que também é transferido no service desk. */
  readonly ticketId?: string;
}

export interface AgentReply {
  readonly messages: readonly AgentReplyMessage[];
  readonly handoff?: HandoffRequest;
}

export interface AgentResponder {
  /** Nome exibido no registro de decisões (ex.: "gemini-flash-lite" ou "modo básico"). */
  readonly name: string;
  respond(ctx: AgentContext): Promise<AgentReply>;
}

/** Acesso ao service desk para uma resposta, com observação dos retries (vão para o trace). */
export interface ServiceDeskAccess {
  forActor(employeeId: string, opts?: { onRetry?: (info: RetryInfo) => void }): ActorServiceDeskClient;
  searchArticles: ServiceDeskClient['searchArticles'];
}
