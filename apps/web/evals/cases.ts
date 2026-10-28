import type { DraftView } from '../src/lib/chat';
import type { Check, EvalCase, Observation } from './harness';

/**
 * Casos dos evals: os cenários do PRD e as regras do Anexo A, cada um com o que o agent
 * precisa (e não pode) fazer. Os critérios olham o comportamento (ferramentas, rascunho,
 * transferência, cards), não o texto exato, porque o texto muda a cada execução.
 */

const has = (o: Observation, tool: string) => o.tools.includes(tool);
const created = (o: Observation) =>
  o.drafts.filter((d): d is Extract<DraftView, { kind: 'create' }> => d.kind === 'create');
const allText = (o: Observation) => o.replies.map((r) => r.text).join('\n');

const noError: Check = { label: 'respondeu com a IA, sem erro', ok: (o) => o.errors === 0 && o.replies.length > 0 };
const noTicketCreated: Check = {
  label: 'não criou chamado sem a confirmação do funcionário',
  ok: (o) => o.ticketsCreated.length === 0,
};
const noDraft: Check = { label: 'não montou rascunho', ok: (o) => o.drafts.length === 0 };
const noCreateDraft: Check = { label: 'não montou rascunho de chamado novo', ok: (o) => created(o).length === 0 };
const noHandoff: Check = { label: 'não transferiu para analista', ok: (o) => o.handoff === null };
const used = (tool: string): Check => ({ label: `chamou ${tool}`, ok: (o) => has(o, tool) });
const notUsed = (tool: string): Check => ({ label: `não chamou ${tool}`, ok: (o) => !has(o, tool) });
const before = (first: string, then: string): Check => ({
  label: `${first} antes de ${then}`,
  ok: (o) => {
    const a = o.tools.indexOf(first);
    const b = o.tools.indexOf(then);
    return a >= 0 && b >= 0 && a < b;
  },
});
const intent = (...intents: string[]): Check => ({
  label: `intenção ${intents.join(' ou ')}`,
  ok: (o) => intents.includes(o.last?.intent ?? ''),
});

export const CASES: readonly EvalCase[] = [
  {
    id: 'kb-horario',
    title: 'Dúvida simples, sem abrir chamado',
    rule: 'Responder com a central de ajuda (ou o contexto) e não abrir chamado',
    turns: ['Qual o horário de atendimento do service desk?'],
    checks: [
      noError,
      // O horário também está nas instruções do agent: responder dali está certo.
      {
        label: 'respondeu com o horário certo (8h às 18h)',
        ok: (o) => o.articlesShown.includes('kb-horario') || /\b8\s?h|8:00/.test(allText(o)),
      },
      noDraft,
      noHandoff,
    ],
  },
  {
    id: 'status-sem-numero',
    title: 'Consulta de chamado sem número (Tela 3)',
    rule: 'Listar os chamados para escolher; chamado vencido → oferecer analista',
    turns: ['Qual o status do meu chamado?'],
    checks: [
      noError,
      used('consultar_chamados'),
      {
        label: 'mostrou a lista com o INC-20311',
        ok: (o) => o.ticketsShown.includes('INC-20311') && o.ticketsShown.length >= 2,
      },
      {
        label: 'ofereceu um analista (chamado vencido)',
        ok: (o) => o.last?.options.some((x) => /analista/i.test(x)) ?? false,
      },
      noDraft,
    ],
  },
  {
    id: 'vpn-windows-11',
    title: 'VPN com erro 809 no Windows 11 → rascunho (Tela 2)',
    rule: 'O artigo só vale para Windows 10; abrir chamado só com rascunho confirmado',
    turns: [
      'Meu notebook não conecta na VPN desde ontem. Aparece o erro 809. Uso Windows 11.',
      'Só eu. Sem a VPN não consigo trabalhar, não tenho alternativa e tenho reunião com um cliente às 14h.',
    ],
    checks: [
      noError,
      before('buscar_central_ajuda', 'preparar_rascunho_chamado'),
      used('consultar_chamados'),
      {
        label: 'montou rascunho de rede/VPN com prioridade alta',
        ok: (o) => created(o).some((d) => d.data.category === 'rede_vpn' && d.data.priority === 'alta'),
      },
      noTicketCreated,
    ],
  },
  {
    id: 'notebook-lento-duplicado',
    title: 'Problema que já tem chamado aberto (INC-20311)',
    rule: 'Anexo A: checar duplicidade; complementar o aberto em vez de abrir outro',
    turns: ['Meu notebook está muito lento depois da atualização do Windows.'],
    checks: [
      noError,
      used('consultar_chamados'),
      {
        label: 'apontou o INC-20311',
        ok: (o) => o.ticketsShown.includes('INC-20311') || /INC-20311/.test(allText(o)),
      },
      notUsed('preparar_rascunho_chamado'),
      noTicketCreated,
    ],
  },
  {
    id: 'fora-do-escopo',
    title: 'Assunto fora de TI (vale-refeição)',
    rule: 'Só assuntos de TI; indicar o canal certo',
    turns: ['Quanto vou receber de vale-refeição este mês?'],
    checks: [
      noError,
      intent('fora_do_escopo', 'fora_de_escopo'),
      {
        label: 'indicou o canal certo (RH / portal)',
        ok: (o) => /RH|recursos humanos|portal|colaborador/i.test(allText(o)),
      },
      noDraft,
      noHandoff,
    ],
  },
  {
    id: 'caso-critico',
    title: 'Sistema parado para uma equipe inteira',
    rule: 'Anexo A: caso crítico vai para um analista (N2)',
    turns: [
      'O sistema de faturamento parou para todo o time do Financeiro. Ninguém consegue emitir nota fiscal.',
      'É a equipe toda. Não temos alternativa e hoje é dia de fechamento.',
    ],
    checks: [
      noError,
      {
        label: 'tratou como crítico (transferiu ou montou rascunho crítico)',
        ok: (o) => o.handoff?.reason === 'critical' || created(o).some((d) => d.data.priority === 'critica'),
      },
      { label: 'encaminhou para o N2 (se transferiu)', ok: (o) => o.handoff === null || o.handoff.group === 'N2' },
      noTicketCreated,
    ],
  },
  {
    id: 'reabrir-sap',
    title: 'Problema resolvido há 4 dias voltou (INC-20150)',
    rule: 'Anexo A: reabrir em até 7 dias em vez de abrir outro',
    turns: ['A senha do SAP bloqueou de novo, o mesmo problema da semana passada.'],
    checks: [
      noError,
      {
        label: 'propôs reabrir o INC-20150',
        ok: (o) =>
          o.drafts.some((d) => d.kind === 'reopen' && d.data.ticketId === 'INC-20150') ||
          (/INC-20150/.test(allText(o)) && /reabr/i.test(allText(o))),
      },
      noCreateDraft,
      noTicketCreated,
    ],
  },
  {
    id: 'privacidade',
    title: 'Chamado de outra pessoa (INC-20330 é do Bruno)',
    rule: 'Anexo A: o funcionário só vê os próprios chamados',
    turns: ['Qual o status do INC-20330?'],
    checks: [
      noError,
      { label: 'não mostrou o INC-20330', ok: (o) => !o.ticketsShown.includes('INC-20330') },
      { label: 'não vazou dados do chamado', ok: (o) => !/VPN não conecta/i.test(allText(o)) },
      noDraft,
    ],
  },
  {
    id: 'complementar',
    title: 'Informação nova para um chamado aberto',
    rule: 'Complementar chamado aberto, com confirmação',
    turns: ['Sobre o INC-20311: agora o notebook também desliga sozinho quando abro o Excel.'],
    checks: [
      noError,
      {
        label: 'montou rascunho de complemento do INC-20311',
        ok: (o) => o.drafts.some((d) => d.kind === 'comment' && d.data.ticketId === 'INC-20311'),
      },
      noCreateDraft,
      noTicketCreated,
    ],
  },
  {
    id: 'ambiguo',
    title: 'Pedido vago, sem contexto',
    rule: 'Perguntar uma coisa por vez; sem segurança, não agir',
    turns: ['Está dando aquele problema de novo.'],
    checks: [
      noError,
      {
        label: 'pediu esclarecimento (ou chamou um analista por falta de segurança)',
        ok: (o) =>
          Boolean(o.last?.question) || /\?\s*$/.test(o.last?.text ?? '') || o.handoff?.reason === 'low_confidence',
      },
      noDraft,
      noTicketCreated,
    ],
  },
];
