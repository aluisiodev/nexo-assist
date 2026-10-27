import type { ChatMessage, MessageBlock } from '../../../lib/chat';

export type ModelMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string };

/** Quantas mensagens recentes vão para o modelo (custo × contexto). */
export const HISTORY_WINDOW = 14;

/** Uma linha por card, para o modelo saber o que o funcionário viu sem gastar tokens. */
function describeBlocks(blocks: readonly MessageBlock[]): string {
  const notes: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'ticket_list':
        notes.push(`[mostrou a lista: ${b.tickets.map((t) => `${t.id}${t.overdue ? ' (vencido)' : ''}`).join(', ')}]`);
        break;
      case 'ticket_card':
        notes.push(`[mostrou o card do ${b.ticket.id}${b.ticket.overdue ? ', prazo vencido' : ''}]`);
        break;
      case 'ticket_draft':
        notes.push(
          `[mostrou o rascunho ${b.draft.id}, status ${b.draft.status}${b.draft.ticketId ? `, virou ${b.draft.ticketId}` : ''}]`,
        );
        break;
      case 'article':
        notes.push(`[mostrou o artigo "${b.title}"]`);
        break;
      case 'quick_replies':
        notes.push(`[opções: ${b.options.map((o) => o.label).join(' | ')}]`);
        break;
    }
  }
  return notes.join(' ');
}

/**
 * Converte o histórico do chat em mensagens para o modelo. O histórico vem do nosso
 * banco (não usamos a memória do Mastra): uma fonte de verdade, e controle do tamanho.
 */
export function toModelMessages(history: readonly ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of history.slice(-HISTORY_WINDOW)) {
    if (m.role === 'employee') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'agent') {
      const notes = describeBlocks(m.blocks);
      out.push({ role: 'assistant', content: notes ? `${m.text}\n${notes}` : m.text });
    } else if (m.role === 'analyst') {
      out.push({ role: 'assistant', content: `(Analista ${m.authorName ?? ''} escreveu): ${m.text}` });
    } else {
      out.push({ role: 'assistant', content: `[sistema: ${m.text}]` });
    }
  }
  // Os provedores exigem que a conversa comece pelo usuário.
  while (out.length > 0 && out[0]!.role !== 'user') out.shift();
  return out;
}
