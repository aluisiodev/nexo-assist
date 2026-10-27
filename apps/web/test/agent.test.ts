import { describe, expect, it } from 'vitest';
import type { ChatMessage, MessageBlock } from '@/lib/chat';
import { BasicResponder } from '@/server/agent/basic-responder';
import { FallbackResponder } from '@/server/agent/fallback-responder';
import { LlmResponder } from '@/server/agent/llm/llm-responder';
import { RoutedResponder } from '@/server/agent/routed-responder';
import type { AgentResponder } from '@/server/agent/types';
import { ConversationService, type SendEvent } from '@/server/conversations/service';
import { ANA, createConversationRepo, createServiceDesk, draftsFor, NOW } from './helpers';
import { scriptedModel, type ScriptStep } from './scripted-model';

/**
 * Testes do agent com IA usando um modelo simulado (roteiro de chamadas de ferramenta).
 * O Mastra, as ferramentas, as regras e o service desk são os reais; só o "cérebro" é
 * roteirizado. Assim testamos o que é responsabilidade do código: o que acontece com
 * cada decisão do modelo.
 */

const answer = (over: Record<string, unknown> = {}) => ({
  name: 'responder',
  args: { mensagem: 'ok', intencao: 'teste', entendimento: 'teste', confianca: 0.9, motivo: 'teste', ...over },
});

async function setup(scripts: { primary: ScriptStep[]; backup?: ScriptStep[] }) {
  const repo = await createConversationRepo();
  const sd = await createServiceDesk();
  const drafts = draftsFor(repo);
  const deps = { serviceDesk: sd.access, drafts };
  const primary = scriptedModel(scripts.primary);
  const backup = scriptedModel(scripts.backup ?? []);
  const basic = new BasicResponder(sd.access);
  const chain: AgentResponder[] = [new LlmResponder({ name: 'IA principal', model: primary.model, deps })];
  if (scripts.backup) chain.push(new LlmResponder({ name: 'IA reserva', model: backup.model, deps }));
  chain.push(basic);
  const responder = new RoutedResponder(basic, new FallbackResponder(chain, () => {}));
  const service = new ConversationService({
    repo,
    responder,
    serviceDesk: sd.access,
    drafts,
    clock: () => NOW,
    log: () => {},
  });
  return { service, sd, primary, backup, repo };
}

const agentReply = (messages: ChatMessage[]) => messages.filter((m) => m.role === 'agent').at(-1)!;
const block = <T extends MessageBlock['type']>(m: ChatMessage, type: T) =>
  m.blocks.find((b): b is Extract<MessageBlock, { type: T }> => b.type === type);
const labels = (m: ChatMessage) => m.trace?.steps.map((s) => s.label) ?? [];

describe('agent com IA (Tela 2: abertura de chamado)', () => {
  it('consulta, pergunta quem é afetado, monta o rascunho com prioridade do código e só cria após confirmar', async () => {
    const { service, sd } = await setup({
      primary: [
        {
          tools: [
            { name: 'consultar_chamados', args: {} },
            { name: 'buscar_central_ajuda', args: { consulta: 'vpn erro 809' } },
          ],
        },
        {
          tools: [
            answer({
              mensagem:
                'Não há chamado sobre VPN, e o artigo do erro 809 vale só para Windows 10. Vou abrir um chamado.',
              intencao: 'abrir_chamado',
              pergunta: 'Quem está sendo afetado?',
              opcoes: ['Só eu', 'Minha equipe', 'Toda a empresa', 'Não sei'],
            }),
          ],
        },
        {
          tools: [
            {
              name: 'preparar_rascunho_chamado',
              args: {
                tipo: 'INC',
                categoria: 'rede_vpn',
                titulo: 'VPN não conecta no notebook — erro 809',
                descricao:
                  'Desde ontem o notebook (Windows 11) não conecta na VPN e mostra o erro 809. Precisa para reunião às 14h.',
                afetados: 'individual',
                impede_trabalho: true,
                tem_alternativa: false,
                compromisso_hoje: true,
              },
            },
          ],
        },
        { tools: [answer({ mensagem: 'Coloquei prioridade alta por causa da reunião. Confira antes de eu criar:' })] },
      ],
    });

    // 1º turno
    const events: SendEvent[] = [];
    const first = await service.sendEmployeeMessage(
      ANA,
      'Meu notebook não conecta na VPN desde ontem. Erro 809.',
      (e) => events.push(e),
    );
    const r1 = agentReply(first.messages);
    expect(labels(r1)).toEqual(['consultou seus chamados', 'buscou na central de ajuda']);
    expect(block(r1, 'quick_replies')).toMatchObject({ question: 'Quem está sendo afetado?' });
    expect(r1.trace).toMatchObject({ engine: 'IA principal', intent: 'abrir_chamado', confidence: 0.9 });
    // Tempo real: a mensagem gravada e cada ação chegam antes do fim.
    expect(events.map((e) => e.type)).toEqual(['message', 'step', 'step']);

    // 2º turno
    const second = await service.sendEmployeeMessage(ANA, 'Só eu. Tenho reunião com cliente às 14h.');
    const r2 = agentReply(second.messages);
    expect(labels(r2)).toEqual(['classificou a prioridade', 'consultou o SLA', 'montou o rascunho']);
    const draft = block(r2, 'ticket_draft')!.draft;
    expect(draft).toMatchObject({ id: 'D-381', kind: 'create', status: 'pending' });
    if (draft.kind !== 'create') throw new Error('esperado rascunho de criação');
    expect(draft.data).toMatchObject({ priority: 'alta', dueAt: new Date('2026-10-27T14:00:00-03:00').toISOString() });

    // Nada foi criado no service desk ainda.
    expect((await sd.client.forActor('emp-ana').listTickets()).map((t) => t.id)).not.toContain('INC-20517');

    // Confirmar: o código cria, com o número do rascunho como chave de idempotência.
    const confirmed = await service.confirmDraft(ANA, 'D-381');
    const card = confirmed.messages.find((m) => block(m, 'ticket_draft'));
    expect(block(card!, 'ticket_draft')!.draft).toMatchObject({ status: 'confirmed', ticketId: 'INC-20517' });
    expect(agentReply(confirmed.messages).text).toMatch(/abri o INC-20517 com prioridade alta/);
    expect((await sd.client.forActor('emp-ana').getTicket('INC-20517')).source).toBe('agent');

    await expect(service.confirmDraft(ANA, 'D-381')).rejects.toMatchObject({ code: 'draft_not_pending' });
  });

  it('confirma por texto ("sim, pode abrir") sem chamar a IA', async () => {
    const { service, primary } = await setup({
      primary: [
        {
          tools: [
            {
              name: 'preparar_rascunho_chamado',
              args: {
                tipo: 'REQ',
                categoria: 'software',
                titulo: 'Instalar Power BI Desktop',
                descricao: 'Preciso do Power BI Desktop para os relatórios do fechamento.',
                afetados: 'individual',
                impede_trabalho: false,
                tem_alternativa: true,
                compromisso_hoje: false,
              },
            },
          ],
        },
        { tools: [answer()] },
      ],
    });
    await service.sendEmployeeMessage(ANA, 'Preciso do Power BI instalado');
    const before = primary.prompts.length;
    const { messages } = await service.sendEmployeeMessage(ANA, 'Sim, pode abrir');
    expect(primary.prompts.length).toBe(before);
    expect(agentReply(messages).text).toMatch(/abri o REQ-10461 com prioridade baixa/);
  });

  it('caso crítico: depois de confirmar, transfere direto para o N2', async () => {
    const { service } = await setup({
      primary: [
        {
          tools: [
            {
              name: 'preparar_rascunho_chamado',
              args: {
                tipo: 'INC',
                categoria: 'email',
                titulo: 'E-mail fora do ar para o Financeiro',
                descricao: 'Ninguém do Financeiro consegue enviar ou receber e-mails desde as 9h.',
                afetados: 'equipe',
                impede_trabalho: true,
                tem_alternativa: false,
                compromisso_hoje: false,
              },
            },
          ],
        },
        { tools: [answer()] },
      ],
    });
    await service.sendEmployeeMessage(ANA, 'O e-mail parou para todo o Financeiro');
    const { conversation, messages } = await service.confirmDraft(ANA, 'D-381');
    expect(conversation.status).toBe('waiting_analyst');
    expect(messages.at(-1)?.text).toMatch(/Transferida para Suporte N2/);
  });
});

describe('regras aplicadas pelo código', () => {
  it('sem duplicidade: a ferramenta recusa o rascunho e o card do chamado vencido ganha a oferta de analista', async () => {
    const { service } = await setup({
      primary: [
        {
          tools: [
            {
              name: 'preparar_rascunho_chamado',
              args: {
                tipo: 'INC',
                categoria: 'hardware',
                titulo: 'Notebook lento após atualização do Windows',
                descricao: 'Lentidão geral no notebook desde a atualização do Windows.',
                afetados: 'individual',
                impede_trabalho: false,
                tem_alternativa: true,
                compromisso_hoje: false,
              },
            },
          ],
        },
        { tools: [answer({ mensagem: 'Você já tem um chamado sobre isso.', mostrar_chamados: ['INC-20311'] })] },
      ],
    });
    const { messages } = await service.sendEmployeeMessage(ANA, 'Meu notebook continua lento');
    const reply = agentReply(messages);
    expect(block(reply, 'ticket_draft')).toBeUndefined();
    expect(block(reply, 'ticket_card')!.ticket).toMatchObject({ id: 'INC-20311', overdue: true });
    expect(block(reply, 'quick_replies')!.options.map((o) => o.label)).toContain('Falar com um analista');
    expect(labels(reply)).toEqual(['encontrou um chamado parecido', 'ofereceu um analista']);
  });

  it('privacidade: o modelo não consegue mostrar o chamado de outra pessoa', async () => {
    const { service } = await setup({
      primary: [
        { tools: [{ name: 'consultar_chamado', args: { id: 'INC-20330' } }] },
        { tools: [answer({ mostrar_chamados: ['INC-20330'] })] },
      ],
    });
    const { messages } = await service.sendEmployeeMessage(ANA, 'Qual o status do INC-20330?');
    const reply = agentReply(messages);
    expect(reply.blocks).toEqual([]);
    expect(reply.trace?.steps[0]).toMatchObject({ label: 'procurou o INC-20330', status: 'error' });
  });

  it('sem segurança: transfere para um analista com o motivo registrado', async () => {
    const { service } = await setup({
      primary: [
        { tools: [answer({ mensagem: 'Não entendi bem.', confianca: 0.2, entendimento: 'Algo sobre o ponto' })] },
      ],
    });
    const { conversation, messages } = await service.sendEmployeeMessage(ANA, 'o negócio do sistema travou o lance');
    expect(conversation.status).toBe('waiting_analyst');
    expect(agentReply(messages).text).toMatch(/chamei um analista/);
    const stored = await service.getOrStart(ANA);
    expect(stored).toMatchObject({ handoffReason: 'low_confidence', handoffConfidence: 0.2 });
  });

  it('pedido explícito de analista vai pelas regras, sem gastar IA', async () => {
    const { service, primary } = await setup({ primary: [] });
    const { conversation } = await service.sendEmployeeMessage(ANA, 'Quero falar com um analista');
    expect(conversation.status).toBe('waiting_analyst');
    expect(primary.prompts).toHaveLength(0);
  });
});

describe('plano B', () => {
  it('se a IA principal falha, a reserva responde e a troca fica registrada', async () => {
    const { service } = await setup({
      primary: [{ error: new Error('limite de uso') }],
      backup: [{ tools: [answer({ mensagem: 'Respondido pela reserva.' })] }],
    });
    const { messages } = await service.sendEmployeeMessage(ANA, 'Como configuro o e-mail no celular?');
    const reply = agentReply(messages);
    expect(reply.text).toBe('Respondido pela reserva.');
    expect(reply.trace?.engine).toBe('IA reserva');
    expect(reply.trace?.steps[0]).toMatchObject({
      label: 'IA principal indisponível, usei IA reserva',
      status: 'error',
    });
  });

  it('se as duas IAs falham, o modo básico responde', async () => {
    const { service } = await setup({
      primary: [{ error: new Error('fora do ar') }],
      backup: [{ error: new Error('fora do ar') }],
    });
    const { messages } = await service.sendEmployeeMessage(ANA, 'Qual o horário do service desk?');
    const reply = agentReply(messages);
    expect(reply.trace?.engine).toBe('regras do service desk (sem IA)');
    expect(block(reply, 'article')).toMatchObject({ id: 'kb-horario' });
    expect(labels(reply).slice(0, 2)).toEqual([
      'IA principal indisponível, usei IA reserva',
      'IA reserva indisponível, usei regras do service desk (sem IA)',
    ]);
  });

  it('se o modelo responde em texto livre (sem a ferramenta responder), a resposta é aproveitada', async () => {
    const { service } = await setup({ primary: [{ text: 'Olá! Como posso ajudar?' }] });
    const { messages } = await service.sendEmployeeMessage(ANA, 'oi');
    expect(agentReply(messages).text).toBe('Olá! Como posso ajudar?');
  });
});
