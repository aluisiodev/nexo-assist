import { describe, expect, it } from 'vitest';
import { LlmResponder } from '@/server/agent/llm/llm-responder';
import { CASES } from '../evals/cases';
import { runCase, summarize } from '../evals/harness';
import { scriptedModel, type ScriptStep } from './scripted-model';

/**
 * Os evals rodam de verdade contra o Gemini e o Groq (`npm run evals`). Aqui garantimos,
 * com um modelo roteirizado, que os critérios aprovam o comportamento certo e pegam o
 * errado: um eval que nunca falha não mede nada.
 */

const byId = (id: string) => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`caso ${id} não existe`);
  return c;
};

const answer = (over: Record<string, unknown> = {}) => ({
  name: 'responder',
  args: { mensagem: 'ok', intencao: 'duvida', entendimento: 'teste', confianca: 0.9, motivo: 'teste', ...over },
});

const vpnDraft = {
  name: 'preparar_rascunho_chamado',
  args: {
    tipo: 'INC',
    categoria: 'rede_vpn',
    titulo: 'VPN não conecta no Windows 11 — erro 809',
    descricao: 'Desde ontem a VPN não conecta no notebook com Windows 11 (erro 809). Reunião com cliente às 14h.',
    afetados: 'individual',
    impede_trabalho: true,
    tem_alternativa: false,
    compromisso_hoje: true,
  },
};

const scripted = (script: ScriptStep[]) => {
  const { model } = scriptedModel(script);
  return (deps: ConstructorParameters<typeof LlmResponder>[0]['deps']) =>
    new LlmResponder({ name: 'IA roteirizada', model, deps });
};

describe('evals: os critérios distinguem o certo do errado', () => {
  it('VPN no Windows 11: central de ajuda → pergunta → rascunho alta = nota máxima', async () => {
    const result = await runCase(
      scripted([
        {
          tools: [
            { name: 'consultar_chamados', args: {} },
            { name: 'buscar_central_ajuda', args: { consulta: 'vpn erro 809' } },
          ],
        },
        { tools: [answer({ intencao: 'abrir_chamado', pergunta: 'Quem está sendo afetado?' })] },
        { tools: [vpnDraft] },
        { tools: [answer({ intencao: 'abrir_chamado', mensagem: 'Confira o rascunho.' })] },
      ]),
      byId('vpn-windows-11'),
    );
    expect(result.failed).toEqual([]);
    expect(result.observation.tools).toEqual([
      'consultar_chamados',
      'buscar_central_ajuda',
      'responder',
      'preparar_rascunho_chamado',
      'responder',
    ]);
    expect(result.observation.ticketsCreated).toEqual([]);
  });

  it('pular a central de ajuda e abrir direto é reprovado', async () => {
    const result = await runCase(
      scripted([
        { tools: [vpnDraft] },
        { tools: [answer({ intencao: 'abrir_chamado' })] },
        { tools: [answer({ intencao: 'abrir_chamado' })] },
      ]),
      byId('vpn-windows-11'),
    );
    expect(result.failed).toEqual(
      expect.arrayContaining(['buscar_central_ajuda antes de preparar_rascunho_chamado', 'chamou consultar_chamados']),
    );
  });

  it('fora do escopo: indicar o RH passa; tentar abrir chamado reprova', async () => {
    const good = await runCase(
      scripted([
        {
          tools: [
            answer({
              intencao: 'fora_do_escopo',
              mensagem: 'Vale-refeição é com o RH: veja no portal do colaborador.',
            }),
          ],
        },
      ]),
      byId('fora-do-escopo'),
    );
    expect(good.failed).toEqual([]);

    const bad = await runCase(
      scripted([{ tools: [answer({ intencao: 'abrir_chamado', mensagem: 'Vou verificar para você.' })] }]),
      byId('fora-do-escopo'),
    );
    expect(bad.failed).toEqual(
      expect.arrayContaining(['intenção fora_do_escopo ou fora_de_escopo', 'indicou o canal certo (RH / portal)']),
    );
  });

  it('erro do provedor conta como falha e entra no resumo', async () => {
    const result = await runCase(scripted([{ error: new Error('fora do ar') }]), byId('kb-horario'));
    expect(result.failed).toContain('respondeu com a IA, sem erro');
    const summary = summarize([result]);
    expect(summary).toMatchObject({ cases: 1, perfectCases: 0, errors: 1 });
    // Sem decisão, nenhum critério passa (nem "não abriu chamado").
    expect(summary.score).toBe(0);
  });

  it('todos os casos têm id único, regra e ao menos 3 critérios', () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) {
      expect(c.rule.length).toBeGreaterThan(5);
      expect(c.checks.length).toBeGreaterThanOrEqual(3);
    }
  });
});
