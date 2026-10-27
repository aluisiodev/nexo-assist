import type { ChatMessage, DraftView } from '../../lib/chat';
import type { ConversationRepository } from '../conversations/repository';
import type { Draft, DraftRepository, NewDraft } from './repository';

/**
 * Ciclo de vida dos rascunhos e o reflexo disso no chat: quando um rascunho muda de
 * status, o card dele na mensagem original também muda (os botões somem).
 */
export class DraftService {
  constructor(
    readonly drafts: DraftRepository,
    private readonly conversations: ConversationRepository,
  ) {}

  /** Cria um rascunho pendente; o anterior (se houver) vira "substituído" no chat. */
  async create(conversationId: string, employeeId: string, draft: NewDraft, now: Date): Promise<Draft> {
    const previous = await this.drafts.findPending(conversationId);
    const created = await this.drafts.create(conversationId, employeeId, draft, now);
    if (previous) await this.refreshBlock({ ...previous, view: { ...previous.view, status: 'superseded' } });
    return created;
  }

  /** Reescreve o card do rascunho na mensagem em que ele aparece. */
  async refreshBlock(draft: Draft): Promise<ChatMessage | null> {
    if (!draft.messageId) return null;
    const message = await this.conversations.findMessage(draft.messageId);
    if (!message) return null;
    const blocks = message.blocks.map((b) =>
      b.type === 'ticket_draft' && b.draft.id === draft.view.id
        ? { type: 'ticket_draft' as const, draft: draft.view }
        : b,
    );
    return this.conversations.replaceBlocks(message.id, blocks);
  }

  withStatus(draft: Draft, status: DraftView['status'], ticketId: string | null): Draft {
    return { ...draft, view: { ...draft.view, status, ticketId } as DraftView };
  }
}
