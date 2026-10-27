import { normalizeText, PRIORITY_LABELS, TICKET_STATUS_LABELS, type SupportGroup, type TicketView } from '@nexo/domain';
import { ServiceDeskError, type RetryInfo } from '@nexo/service-desk-client';
import type { AgentStep, AgentTrace, MessageBlock, QuickReply } from '../../lib/chat';
import { toTicketSummary } from './ticket-summary';
import type { AgentContext, AgentReply, AgentResponder, HandoffRequest, ServiceDeskAccess } from './types';

export const BASIC_ENGINE = 'modo básico (sem IA)';

const TICKET_ID = /\b(INC|REQ)[\s-]?(\d{3,})\b/i;
const COMMENT = /^\s*(INC|REQ)[\s-]?(\d{3,})\s*[:\-–]\s*(.{10,})$/is;
const WANTS_ANALYST = /\b(analista|atendente|humano|pessoa de verdade|falar com alguem)\b/;
const ASKS_STATUS = /\b(status|meus chamados|meu chamado|chamados abertos|andamento)\b/;
const HOW_TO_COMMENT = /\b(como adiciono|adicionar (uma )?informac|complementar)\b/;
const WANTS_NEW_TICKET = /\b(abrir|abre|criar|registrar|novo)\b.{0,12}\bchamado\b/;
const THANKS = /\b(obrigad[oa]|valeu|resolveu|deu certo|funcionou)\b/;
const DECLINE = /^(nao|nao obrigad[oa]|nao, obrigad[oa]|tudo certo)\b/;
const OUT_OF_SCOPE =
  /\b(ferias|salario|holerite|vale refeicao|vale alimentacao|reembolso|beneficio|plano de saude|folha de pagamento|ponto eletronico|limpeza|ar condicionado|estacionamento)\b/;

const ANALYST_OPTIONS: QuickReply[] = [{ label: 'Falar com um analista' }];

/**
 * Modo básico: responde por regras, sem LLM. Serve como plano C quando nenhum provedor
 * de IA está configurado ou disponível. Consulta chamados, mostra prazos, busca na
 * central de ajuda e transfere para um analista; não abre chamados por conversa.
 */
export class BasicResponder implements AgentResponder {
  readonly name = BASIC_ENGINE;

  constructor(private readonly serviceDesk: ServiceDeskAccess) {}

  async respond(ctx: AgentContext): Promise<AgentReply> {
    const started = Date.now();
    const steps: AgentStep[] = [];
    const onRetry = (info: RetryInfo) =>
      steps.push({
        label: 'sistema de chamados instável, tentei de novo',
        detail: `${info.reason} em ${info.method} ${info.path}`,
        status: 'error',
      });
    const sd = this.serviceDesk.forActor(ctx.user.employeeId, { onRetry });
    const t = normalizeText(ctx.text);

    const trace = (fields: Omit<AgentTrace, 'engine' | 'steps' | 'durationMs'>): AgentTrace => ({
      engine: BASIC_ENGINE,
      steps,
      durationMs: Date.now() - started,
      ...fields,
    });

    try {
      // 1) Complementar um chamado: "INC-20311: agora também trava o Excel"
      const comment = COMMENT.exec(ctx.text);
      if (comment) {
        const id = `${comment[1]!.toUpperCase()}-${comment[2]}`;
        const info = comment[3]!.trim();
        const ticket = await sd.addComment(id, { body: info }, `msg-${ctx.messageId}`);
        steps.push({ label: `atualizou o ${id}`, detail: `Informação adicionada: "${info}"` });
        return {
          messages: [
            {
              text: `Pronto, adicionei a informação ao ${id}. O analista vai ver isso no histórico do chamado.`,
              blocks: [{ type: 'ticket_card', ticket: toTicketSummary(ticket) }],
              trace: trace({
                intent: 'complementar_chamado',
                understood: `Quer acrescentar informação ao ${id}.`,
                confidence: 0.95,
                reasoning: 'A mensagem segue o formato "número do chamado: informação".',
              }),
            },
          ],
        };
      }

      // 2) Pediu um analista
      if (WANTS_ANALYST.test(t)) {
        const ticket = await this.lastTicketInContext(ctx, sd);
        const group: SupportGroup = ticket?.sla.overdue ? 'N2' : 'N1';
        const handoff: HandoffRequest = {
          reason: ticket?.sla.overdue ? 'overdue' : 'employee_request',
          group,
          summary: this.summarize(ctx, ticket),
          confidence: 0.95,
          ...(ticket ? { ticketId: ticket.id } : {}),
        };
        steps.push({ label: 'preparou o resumo para o analista' });
        return {
          messages: [
            {
              text: `Encaminhei para o Suporte ${group}. Enquanto um analista não assume, eu fico em pausa nesta conversa.`,
              trace: trace({
                intent: 'falar_com_analista',
                understood: 'Quer falar com uma pessoa do service desk.',
                confidence: 0.95,
                reasoning: ticket
                  ? `Pedido explícito de analista. O ${ticket.id} ${ticket.sla.overdue ? 'está vencido, então vai para o N2' : 'segue com o N1'}.`
                  : 'Pedido explícito de analista (regra de transferência do Anexo A).',
              }),
            },
          ],
          handoff,
        };
      }

      // 3) Como complementar um chamado
      if (HOW_TO_COMMENT.test(t)) {
        const id = TICKET_ID.exec(ctx.text)?.[0]?.toUpperCase().replace(/\s/, '-') ?? 'INC-20311';
        return {
          messages: [
            {
              text: `Escreva a informação começando pelo número do chamado, por exemplo: "${id}: o problema agora acontece também no Excel".`,
              trace: trace({
                intent: 'complementar_chamado',
                understood: 'Quer saber como acrescentar informação a um chamado.',
                confidence: 0.85,
              }),
            },
          ],
        };
      }

      // 4) Quer abrir chamado (no modo básico, não abrimos por conversa)
      if (WANTS_NEW_TICKET.test(t)) {
        return {
          messages: [
            {
              text: 'No modo básico (sem IA) eu não abro chamados pela conversa, porque não consigo conferir todos os dados com segurança. Posso chamar um analista para registrar com você.',
              blocks: [{ type: 'quick_replies', options: ANALYST_OPTIONS }],
              trace: trace({
                intent: 'abrir_chamado',
                understood: 'Quer abrir um chamado.',
                confidence: 0.8,
                reasoning:
                  'Abertura exige classificar tipo, categoria e prioridade; sem IA, prefiro encaminhar a um analista.',
              }),
            },
          ],
        };
      }

      // 5) Mencionou um chamado específico
      const mention = TICKET_ID.exec(ctx.text);
      if (mention) {
        const id = `${mention[1]!.toUpperCase()}-${mention[2]}`;
        try {
          const ticket = await sd.getTicket(id);
          steps.push({ label: `consultou o ${id}` }, { label: 'calculou o prazo', detail: this.slaDetail(ticket) });
          return { messages: [this.ticketStatusMessage(ticket, trace)] };
        } catch (err) {
          if (err instanceof ServiceDeskError && err.kind === 'not_found') {
            steps.push({
              label: `procurou o ${id}`,
              detail: 'Não está entre os chamados deste funcionário.',
              status: 'error',
            });
            return {
              messages: [
                {
                  text: `Não encontrei o ${id} entre os seus chamados. Por privacidade, só consigo mostrar chamados abertos por você.`,
                  trace: trace({
                    intent: 'consultar_chamado',
                    understood: `Quer saber do ${id}.`,
                    confidence: 0.9,
                    reasoning: 'O service desk respondeu "não encontrado" para este funcionário.',
                  }),
                },
              ],
            };
          }
          throw err;
        }
      }

      // 6) Quer saber dos próprios chamados
      if (ASKS_STATUS.test(t) || /\bchamados?\b/.test(t)) {
        const tickets = await sd.listTickets({ status: 'open' });
        steps.push({ label: 'consultou seus chamados', detail: `${tickets.length} chamado(s) aberto(s).` });
        const understood = 'Quer saber a situação dos próprios chamados.';
        if (tickets.length === 0) {
          return {
            messages: [
              {
                text: 'Você não tem chamados abertos no momento. Quer me contar o que está acontecendo?',
                trace: trace({
                  intent: 'consultar_chamados',
                  understood,
                  confidence: 0.85,
                  reasoning: 'Lista de chamados abertos vazia.',
                }),
              },
            ],
          };
        }
        if (tickets.length === 1) {
          steps.push({ label: 'calculou o prazo', detail: this.slaDetail(tickets[0]!) });
          return { messages: [this.ticketStatusMessage(tickets[0]!, trace)] };
        }
        return {
          messages: [
            {
              text: `Você tem ${tickets.length} chamados abertos. Sobre qual deles quer saber?`,
              blocks: [{ type: 'ticket_list', tickets: tickets.map(toTicketSummary), selectable: true }],
              trace: trace({
                intent: 'consultar_chamados',
                understood,
                confidence: 0.85,
                reasoning: 'Mais de um chamado aberto: pedi para escolher em vez de adivinhar.',
              }),
            },
          ],
        };
      }

      // 7) Agradecimento / recusa
      if (THANKS.test(t) || DECLINE.test(t)) {
        return {
          messages: [
            {
              text: 'Combinado! Se precisar de mais alguma coisa de TI, é só escrever aqui.',
              trace: trace({
                intent: 'encerrar_assunto',
                understood: 'O assunto foi resolvido ou não precisa de mais nada.',
                confidence: 0.8,
              }),
            },
          ],
        };
      }

      // 8) Fora do escopo de TI
      if (OUT_OF_SCOPE.test(t)) {
        return {
          messages: [
            {
              text: 'Esse assunto não é de TI, então não consigo ajudar por aqui. Para RH, financeiro ou facilities, procure a central do colaborador no portal da Nexo.',
              trace: trace({
                intent: 'fora_do_escopo',
                understood: 'Assunto de RH, financeiro ou facilities.',
                confidence: 0.75,
                reasoning: 'Regra de escopo do Anexo A: apenas assuntos de TI.',
              }),
            },
          ],
        };
      }

      // 9) Central de ajuda
      const hits = await this.serviceDesk.searchArticles(ctx.text, 1);
      steps.push({
        label: 'buscou na central de ajuda',
        detail: hits[0]
          ? `Melhor resultado: "${hits[0].title}" (relevância ${hits[0].score})`
          : 'Nenhum artigo relevante.',
      });
      const best = hits[0];
      if (best) {
        return {
          messages: [
            {
              text: 'Encontrei isto na central de ajuda. Veja se resolve:',
              blocks: [
                { type: 'article', id: best.id, title: best.title, body: best.body },
                { type: 'quick_replies', options: [{ label: 'Resolveu, obrigado' }, ...ANALYST_OPTIONS] },
              ],
              trace: trace({
                intent: 'duvida',
                understood: 'Dúvida ou problema que pode ter resposta na central de ajuda.',
                confidence: best.score,
                reasoning: 'Sem IA, uso a busca por termos; a relevância é a sobreposição de termos.',
              }),
            },
          ],
        };
      }
      return {
        messages: [
          {
            text: 'Ainda não consigo entender esse pedido no modo básico (sem IA). Posso mostrar seus chamados ou chamar um analista.',
            blocks: [
              {
                type: 'quick_replies',
                options: [
                  { label: 'Ver meus chamados', value: 'Qual o status dos meus chamados?' },
                  ...ANALYST_OPTIONS,
                ],
              },
            ],
            trace: trace({
              intent: 'desconhecida',
              confidence: 0.2,
              reasoning: 'Nenhuma regra e nenhum artigo corresponderam à mensagem.',
            }),
          },
        ],
      };
    } catch (err) {
      const unavailable = err instanceof ServiceDeskError && err.kind === 'unavailable';
      steps.push({
        label: unavailable ? 'sistema de chamados fora do ar' : 'erro ao consultar o service desk',
        detail: err instanceof Error ? err.message : String(err),
        status: 'error',
      });
      return {
        messages: [
          {
            text: unavailable
              ? 'O sistema de chamados está fora do ar agora (já tentei algumas vezes). Tente de novo em instantes ou, se for urgente, fale com um analista.'
              : 'Não consegui concluir isso agora. Pode tentar de novo? Se preferir, chamo um analista.',
            blocks: [{ type: 'quick_replies', options: ANALYST_OPTIONS }],
            trace: trace({
              intent: 'erro',
              confidence: 0,
              reasoning: 'Falha ao falar com o service desk; nada foi alterado.',
            }),
          },
        ],
      };
    }
  }

  private slaDetail(t: TicketView): string {
    if (t.sla.paused) return `Prazo pausado (${TICKET_STATUS_LABELS[t.status].toLowerCase()}).`;
    return `${PRIORITY_LABELS[t.priority]}: ${t.sla.target}. ${t.sla.overdue ? 'Vencido.' : 'Dentro do prazo.'}`;
  }

  private ticketStatusMessage(
    ticket: TicketView,
    trace: (f: Omit<AgentTrace, 'engine' | 'steps' | 'durationMs'>) => AgentTrace,
  ) {
    const blocks: MessageBlock[] = [{ type: 'ticket_card', ticket: toTicketSummary(ticket) }];
    let text: string;
    if (ticket.sla.overdue) {
      text = `Está sem resposta do suporte além do prazo de ${ticket.sla.target} para prioridade ${PRIORITY_LABELS[ticket.priority].toLowerCase()}. Quer que eu chame um analista?`;
      blocks.push({
        type: 'quick_replies',
        options: [
          { label: 'Falar com um analista' },
          { label: 'Adicionar informação', value: `Como adiciono uma informação ao ${ticket.id}?` },
          { label: 'Não, obrigado' },
        ],
      });
    } else if (ticket.canReopen) {
      text =
        'Este chamado foi resolvido há menos de 7 dias. Se o problema voltou, ele pode ser reaberto por um analista.';
    } else {
      text = `Está ${TICKET_STATUS_LABELS[ticket.status].toLowerCase()} e dentro do prazo.`;
    }
    return {
      text,
      blocks,
      trace: trace({
        intent: 'consultar_chamado',
        understood: `Quer saber do ${ticket.id}.`,
        confidence: 0.9,
        reasoning: ticket.sla.overdue
          ? 'Chamado vencido: o Anexo A prevê oferecer transferência.'
          : 'Chamado dentro do prazo.',
      }),
    };
  }

  /** Último chamado mostrado ou citado na conversa, para dar contexto à transferência. */
  private async lastTicketInContext(
    ctx: AgentContext,
    sd: ReturnType<ServiceDeskAccess['forActor']>,
  ): Promise<TicketView | null> {
    for (let i = ctx.history.length - 1; i >= 0; i--) {
      const m = ctx.history[i]!;
      const card = m.blocks.find((b) => b.type === 'ticket_card');
      const id =
        card?.type === 'ticket_card' ? card.ticket.id : TICKET_ID.exec(m.text)?.[0]?.toUpperCase().replace(/\s/, '-');
      if (id) {
        try {
          return await sd.getTicket(id);
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  private summarize(ctx: AgentContext, ticket: TicketView | null): string {
    const recent = ctx.history
      .filter((m) => m.role === 'employee')
      .slice(-3)
      .map((m) => `"${m.text}"`)
      .join(' · ');
    const about = ticket
      ? `${ticket.id} (${ticket.title}), ${TICKET_STATUS_LABELS[ticket.status].toLowerCase()}, prioridade ${PRIORITY_LABELS[ticket.priority].toLowerCase()}${ticket.sla.overdue ? ', prazo vencido' : ''}. `
      : '';
    return `${ctx.user.name} pediu para falar com um analista. ${about}Últimas mensagens: ${recent}`;
  }
}
