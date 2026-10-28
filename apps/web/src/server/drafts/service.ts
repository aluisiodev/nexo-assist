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

  /**
   * Desfaz um rascunho de um turno descartado (a resposta nunca chegou ao funcionário).
   * O que estava pendente antes do turno, e que este substituiu, volta a ficar pendente.
   */
  async discard(draftId: string, previous: DraftView | null, now: Date): Promise<void> {
    await this.drafts.settle(draftId, 'cancelled', null, now);
    if (previous?.status !== 'pending' || previous.id === draftId) return;
    await this.drafts.reopen(previous.id, now);
    const restored = await this.drafts.findById(previous.id);
    if (restored) await this.refreshBlock(restored);
  }

  withStatus(draft: Draft, status: DraftView['status'], ticketId: string | null): Draft {
    return { ...draft, view: { ...draft.view, status, ticketId } as DraftView };
  }
}
