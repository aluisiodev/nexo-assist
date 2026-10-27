import { createTool } from '@mastra/core/tools';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  classifyPriority,
  computeDueAt,
  IMPACT_LABELS,
  isOpenStatus,
  PRIORITY_LABELS,
  SLA_POLICY,
  TICKET_STATUS_LABELS,
  type HandoffReason,
  type SupportGroup,
  type TicketView,
} from '@nexo/domain';
import { ServiceDeskError } from '@nexo/service-desk-client';
import { z } from 'zod';
import { formatDateTime, formatRelative } from '../../../lib/format';
import type { FinalAnswer, TurnState } from './turn';

/**
 * Ferramentas do Nexo Assist. Cada uma lê o turno atual do RequestContext: o id do
 * funcionário vem da sessão (nunca do modelo), e as regras do Anexo A (prioridade,
 * prazo, duplicidade, confirmação) são aplicadas aqui, em código.
 */

export const TURN_KEY = 'turn';

function turnOf(context: { requestContext?: { get: (key: never) => unknown } | undefined }): TurnState {
  const turn = context.requestContext?.get(TURN_KEY as never) as TurnState | undefined;
  if (!turn) throw new Error('Turno do agent ausente no RequestContext');
  return turn;
}

const DUPLICATE_SCORE = 0.6;
const tz = 'America/Sao_Paulo';
const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(d);
const day = (d: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz }).format(d);
const dueText = (due: Date, now: Date) =>
  day(due) === day(now) ? `até ${hhmm(due)}` : `até ${day(due)} às ${hhmm(due)}`;

/** Resumo compacto (menos tokens) de um chamado para o modelo. */
function summary(t: TicketView) {
  return {
    id: t.id,
    tipo: t.type,
    titulo: t.title,
    categoria: CATEGORY_LABELS[t.category],
    status: TICKET_STATUS_LABELS[t.status],
    prioridade: PRIORITY_LABELS[t.priority],
    aberto_em: formatDateTime(t.createdAt),
    ultima_atualizacao: formatRelative(t.updatedAt),
    prazo: t.sla.paused ? 'pausado' : t.sla.target,
    vencido: t.sla.overdue,
    pode_reabrir: t.canReopen,
  };
}

/** Falhas do service desk viram resultado de ferramenta (o modelo explica ao funcionário). */
function failure(turn: TurnState, label: string, err: unknown) {
  const unavailable = err instanceof ServiceDeskError && err.kind === 'unavailable';
  turn.step({ label, detail: err instanceof Error ? err.message : String(err), status: 'error' });
  return {
    erro: unavailable
      ? 'O sistema de chamados está fora do ar agora. Avise o funcionário e sugira tentar em instantes ou falar com um analista.'
      : err instanceof Error
        ? err.message
        : 'Falha ao consultar o service desk.',
  };
}

export const consultarChamados = createTool({
  id: 'consultar_chamados',
  description:
    'Lista os chamados do funcionário (por padrão, só os abertos), com status, prioridade e se o prazo venceu. Use antes de abrir chamado e quando ele perguntar por chamados sem dizer o número.',
  inputSchema: z.object({
    incluir_encerrados: z.boolean().default(false).describe('true para incluir resolvidos e fechados'),
  }),
  execute: async ({ incluir_encerrados }, context) => {
    const turn = turnOf(context);
    try {
      const tickets = await turn.sd.listTickets({ status: incluir_encerrados ? 'all' : 'open' });
      turn.remember(tickets);
      turn.step({ label: 'consultou seus chamados', detail: `${tickets.length} chamado(s) encontrado(s).` });
      return { chamados: tickets.map(summary) };
    } catch (err) {
      return failure(turn, 'não conseguiu consultar os chamados', err);
    }
  },
});

export const consultarChamado = createTool({
  id: 'consultar_chamado',
  description: 'Detalhes de um chamado do funcionário pelo número (ex.: INC-20311), com prazo e histórico recente.',
  inputSchema: z.object({ id: z.string().describe('Número do chamado, ex.: INC-20311 ou REQ-10442') }),
  execute: async ({ id }, context) => {
    const turn = turnOf(context);
    try {
      const ticket = await turn.sd.getTicket(id);
      turn.remember([ticket]);
      const events = await turn.sd.getTicketEvents(ticket.id).catch(() => []);
      turn.step({ label: `consultou o ${ticket.id}` });
      turn.step({
        label: 'calculou o prazo',
        detail: ticket.sla.paused
          ? 'Prazo pausado.'
          : `${PRIORITY_LABELS[ticket.priority]}: ${ticket.sla.target}. ${ticket.sla.overdue ? 'Vencido.' : 'Dentro do prazo.'}`,
      });
      return {
        chamado: {
          ...summary(ticket),
          descricao: ticket.description,
          grupo: ticket.assignedGroup,
          historico: events.slice(-3).map((e) => ({ quando: formatRelative(e.at), tipo: e.kind, texto: e.body })),
        },
      };
    } catch (err) {
      if (err instanceof ServiceDeskError && err.kind === 'not_found') {
        turn.step({
          label: `procurou o ${id}`,
          detail: 'Não está entre os chamados deste funcionário.',
          status: 'error',
        });
        return {
          erro: `O ${id} não está entre os chamados deste funcionário. Por privacidade, não comente se ele existe.`,
        };
      }
      return failure(turn, `não conseguiu consultar o ${id}`, err);
    }
  },
});

export const buscarCentralAjuda = createTool({
  id: 'buscar_central_ajuda',
  description:
    'Busca artigos na central de ajuda de TI. Use para dúvidas e antes de abrir chamado: se um artigo resolver, não abra chamado. Atenção às condições do artigo (ex.: vale só para Windows 10).',
  inputSchema: z.object({ consulta: z.string().min(2).describe('Palavras-chave do problema, ex.: "vpn erro 809"') }),
  execute: async ({ consulta }, context) => {
    const turn = turnOf(context);
    try {
      const hits = await turn.deps.serviceDesk.searchArticles(consulta, 3);
      for (const h of hits) turn.articles.set(h.id, h);
      turn.step({
        label: 'buscou na central de ajuda',
        detail: hits[0]
          ? `Melhor resultado: "${hits[0].title}" (relevância ${hits[0].score}).`
          : 'Nenhum artigo relevante.',
      });
      return { artigos: hits.map((h) => ({ id: h.id, titulo: h.title, texto: h.body, relevancia: h.score })) };
    } catch (err) {
      return failure(turn, 'não conseguiu buscar na central de ajuda', err);
    }
  },
});

export const prepararRascunhoChamado = createTool({
  id: 'preparar_rascunho_chamado',
  description:
    'Monta o RASCUNHO de um chamado novo para o funcionário conferir. Não cria o chamado: a criação só acontece quando ele confirma. A prioridade e o prazo são calculados pelo sistema a partir dos fatos informados. Só chame quando souber quem é afetado.',
  inputSchema: z.object({
    tipo: z
      .enum(['INC', 'REQ'])
      .describe('INC: algo parou ou não funciona. REQ: pedido de acesso, equipamento ou software.'),
    categoria: z
      .enum(CATEGORIES)
      .describe(`Uma de: ${CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(', ')}`),
    titulo: z.string().min(5).max(120).describe('Título curto e específico'),
    descricao: z
      .string()
      .min(10)
      .max(1500)
      .describe(
        'Descrição completa para o analista não precisar perguntar de novo: o que acontece, desde quando, o que já foi tentado, ambiente.',
      ),
    afetados: z.enum(['individual', 'equipe', 'empresa', 'desconhecido']).describe('Quem é afetado'),
    impede_trabalho: z.boolean().describe('Impede de trabalhar (true) ou só atrapalha (false)'),
    tem_alternativa: z.boolean().describe('Existe forma de contornar'),
    compromisso_hoje: z.boolean().describe('Há compromisso hoje que depende da solução'),
    e_outro_problema: z
      .boolean()
      .default(false)
      .describe('true só se o funcionário confirmou que NÃO é o mesmo problema de um chamado aberto parecido'),
  }),
  execute: async (input, context) => {
    const turn = turnOf(context);
    const now = turn.ctx.now;

    // Regra "sem duplicidade" (Anexo A), aplicada pelo código.
    if (!input.e_outro_problema) {
      try {
        const matches = await turn.sd.findSimilar({
          text: `${input.titulo} ${input.descricao}`,
          category: input.categoria,
        });
        const best = matches.find((m) => m.score >= DUPLICATE_SCORE);
        if (best) {
          turn.remember([best.ticket]);
          turn.step({
            label: 'encontrou um chamado parecido',
            detail: `${best.ticket.id} (semelhança ${best.score}).`,
          });
          return best.reason === 'open_duplicate'
            ? {
                ok: false,
                motivo: 'ja_existe_chamado_aberto',
                chamado: summary(best.ticket),
                orientacao:
                  'Não abra outro. Mostre o chamado existente e ofereça complementá-lo (preparar_atualizacao_chamado). Só abra novo se o funcionário disser que é outro problema.',
              }
            : {
                ok: false,
                motivo: 'resolvido_recentemente',
                chamado: summary(best.ticket),
                orientacao:
                  'Foi resolvido há até 7 dias: ofereça reabrir (preparar_atualizacao_chamado com acao "reabrir").',
              };
        }
      } catch (err) {
        return failure(turn, 'não conseguiu verificar duplicidade', err);
      }
    }

    const decision = classifyPriority({
      type: input.tipo,
      impact: input.afetados,
      blocksWork: input.impede_trabalho,
      hasWorkaround: input.tem_alternativa,
      sameDayCommitment: input.compromisso_hoje,
    });
    turn.step({
      label: 'classificou a prioridade',
      detail: `${PRIORITY_LABELS[decision.priority]}: ${decision.reason}`,
    });
    const due = computeDueAt(decision.priority, now);
    const target = SLA_POLICY[decision.priority].label;
    turn.step({ label: 'consultou o SLA', detail: `${target}: resposta ${dueText(due, now)}.` });

    const draft = await turn.deps.drafts.create(
      turn.ctx.conversation.id,
      turn.ctx.user.employeeId,
      {
        kind: 'create',
        data: {
          type: input.tipo,
          category: input.categoria,
          title: input.titulo,
          description: input.descricao,
          priority: decision.priority,
          priorityReason: decision.reason,
          impact: input.afetados,
          dueAt: due.toISOString(),
          slaTarget: target,
        },
      },
      now,
    );
    turn.draft = draft.view;
    turn.step({ label: 'montou o rascunho', detail: draft.view.id });
    return {
      ok: true,
      rascunho: draft.view.id,
      prioridade: PRIORITY_LABELS[decision.priority],
      motivo_prioridade: decision.reason,
      afetados: IMPACT_LABELS[input.afetados],
      resposta_do_suporte: `${dueText(due, now)} (${target})`,
      suposicoes: decision.assumptions,
      orientacao:
        'O rascunho aparece para o funcionário com os botões Confirmar, Editar e Cancelar. Explique a prioridade em uma frase e peça para conferir. Não diga que o chamado foi criado.',
    };
  },
});

export const prepararAtualizacaoChamado = createTool({
  id: 'preparar_atualizacao_chamado',
  description:
    'Monta o rascunho de uma atualização de chamado existente: complementar com nova informação (chamado aberto) ou reabrir (resolvido há até 7 dias). Só é gravado após a confirmação do funcionário.',
  inputSchema: z.object({
    id: z.string().describe('Número do chamado'),
    acao: z.enum(['complementar', 'reabrir']),
    texto: z.string().min(5).max(1500).describe('Informação nova ou motivo da reabertura, escrito para o analista'),
  }),
  execute: async ({ id, acao, texto }, context) => {
    const turn = turnOf(context);
    let ticket: TicketView;
    try {
      ticket = await turn.sd.getTicket(id);
      turn.remember([ticket]);
    } catch (err) {
      if (err instanceof ServiceDeskError && err.kind === 'not_found') {
        return { ok: false, erro: `O ${id} não está entre os chamados deste funcionário.` };
      }
      return failure(turn, `não conseguiu consultar o ${id}`, err);
    }
    if (acao === 'complementar' && !isOpenStatus(ticket.status)) {
      return {
        ok: false,
        erro: ticket.canReopen
          ? 'O chamado está resolvido. Ofereça reabrir.'
          : 'O chamado está encerrado há mais de 7 dias. Ofereça abrir um novo.',
      };
    }
    if (acao === 'reabrir' && !ticket.canReopen) {
      return {
        ok: false,
        erro: isOpenStatus(ticket.status)
          ? 'O chamado ainda está aberto. Ofereça complementar.'
          : 'Resolvido há mais de 7 dias: não pode ser reaberto. Ofereça abrir um novo.',
      };
    }
    const draft = await turn.deps.drafts.create(
      turn.ctx.conversation.id,
      turn.ctx.user.employeeId,
      {
        kind: acao === 'complementar' ? 'comment' : 'reopen',
        data: { ticketId: ticket.id, ticketTitle: ticket.title, text: texto },
      },
      turn.ctx.now,
    );
    turn.draft = draft.view;
    turn.step({
      label: acao === 'complementar' ? 'montou a atualização' : 'montou a reabertura',
      detail: `${draft.view.id} → ${ticket.id}`,
    });
    return {
      ok: true,
      rascunho: draft.view.id,
      orientacao:
        'O rascunho aparece com os botões Confirmar e Cancelar. Peça para o funcionário conferir. Não diga que já foi feito.',
    };
  },
});

const HANDOFF_REASONS: Record<string, HandoffReason> = {
  pedido_do_funcionario: 'employee_request',
  caso_critico: 'critical',
  chamado_vencido: 'overdue',
  sem_seguranca: 'low_confidence',
};

export const transferirParaAnalista = createTool({
  id: 'transferir_para_analista',
  description:
    'Transfere a conversa para um analista humano. Use quando: o funcionário pedir; o caso for crítico (algo parado para uma equipe ou a empresa); um chamado estiver com prazo vencido e ele quiser ajuda; ou você não tiver segurança sobre o que fazer. Depois disso você fica em pausa.',
  inputSchema: z.object({
    motivo: z.enum(['pedido_do_funcionario', 'caso_critico', 'chamado_vencido', 'sem_seguranca']),
    resumo: z
      .string()
      .min(20)
      .max(1500)
      .describe(
        'Resumo do caso para o analista: problema, o que já foi feito/consultado, chamado relacionado e o que o funcionário precisa.',
      ),
    chamado: z.string().optional().describe('Número do chamado relacionado, se houver'),
    confianca: z.number().min(0).max(1).optional(),
  }),
  execute: async ({ motivo, resumo, chamado, confianca }, context) => {
    const turn = turnOf(context);
    const reason = HANDOFF_REASONS[motivo] ?? 'employee_request';
    const group: SupportGroup = reason === 'critical' || reason === 'overdue' ? 'N2' : 'N1';
    let ticketId: string | undefined;
    if (chamado) {
      // Só leva o chamado se ele for mesmo deste funcionário.
      ticketId = await turn.sd
        .getTicket(chamado)
        .then((t) => t.id)
        .catch(() => undefined);
    }
    turn.handoff = {
      reason,
      group,
      summary: resumo,
      ...(confianca !== undefined ? { confidence: confianca } : {}),
      ...(ticketId ? { ticketId } : {}),
    };
    turn.step({ label: 'preparou o resumo para o analista', detail: `Suporte ${group}.` });
    return {
      ok: true,
      grupo: `Suporte ${group}`,
      orientacao:
        'Avise que encaminhou e que você fica em pausa até o analista assumir. Não prometa horário: o sistema informa.',
    };
  },
});

/** Campos da resposta final (também usados para ler a resposta quando o modelo a escreve como texto). */
export const ResponderInputSchema = z.object({
  mensagem: z.string().min(1).max(1200).describe('Texto para o funcionário, em português, curto e claro, sem markdown'),
  intencao: z
    .string()
    .describe(
      'Intenção identificada, em snake_case: ex. abrir_chamado, consultar_chamado, duvida, complementar_chamado, falar_com_analista, fora_do_escopo, saudacao',
    ),
  entendimento: z.string().describe('Em uma frase, o que você entendeu que o funcionário quer'),
  confianca: z.number().min(0).max(1).describe('Sua segurança na decisão, de 0 a 1'),
  motivo: z.string().describe('Por que escolheu esta ação, citando a regra do service desk quando houver'),
  mostrar_chamados: z
    .array(z.string())
    .max(5)
    .default([])
    .describe('Números de chamados consultados neste turno para mostrar como card (1) ou lista para escolher (vários)'),
  mostrar_artigo: z.string().optional().describe('Id do artigo da central de ajuda para mostrar, se for útil'),
  pergunta: z.string().optional().describe('Pergunta destacada, quando precisar de uma informação'),
  opcoes: z.array(z.string().max(60)).max(4).default([]).describe('Opções rápidas de resposta (até 4)'),
});

export function toFinalAnswer(input: z.output<typeof ResponderInputSchema>): FinalAnswer {
  return {
    message: input.mensagem,
    intent: input.intencao,
    understood: input.entendimento,
    confidence: input.confianca,
    reasoning: input.motivo,
    showTickets: input.mostrar_chamados,
    showArticle: input.mostrar_artigo,
    question: input.pergunta,
    options: input.opcoes,
  };
}

export const responder = createTool({
  id: 'responder',
  description:
    'Entrega a resposta final ao funcionário. Chame SEMPRE uma vez, por último, em todo turno. Os campos de decisão ficam visíveis em "por quê?".',
  inputSchema: ResponderInputSchema,
  execute: async (input, context) => {
    const turn = turnOf(context);
    turn.final = toFinalAnswer(input);
    return { ok: true };
  },
});

export const NEXO_TOOLS = {
  consultar_chamados: consultarChamados,
  consultar_chamado: consultarChamado,
  buscar_central_ajuda: buscarCentralAjuda,
  preparar_rascunho_chamado: prepararRascunhoChamado,
  preparar_atualizacao_chamado: prepararAtualizacaoChamado,
  transferir_para_analista: transferirParaAnalista,
  responder,
};
