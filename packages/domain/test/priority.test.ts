import { describe, expect, it } from 'vitest';
import { classifyPriority, type PriorityFacts } from '../src';

const facts = (over: Partial<PriorityFacts>): PriorityFacts => ({
  type: 'INC',
  impact: 'individual',
  blocksWork: false,
  hasWorkaround: false,
  sameDayCommitment: false,
  ...over,
});

describe('classifyPriority (Anexo A)', () => {
  it('crítica: parado para uma equipe ou para a empresa', () => {
    expect(classifyPriority(facts({ impact: 'equipe', blocksWork: true })).priority).toBe('critica');
    expect(classifyPriority(facts({ impact: 'empresa', blocksWork: true })).priority).toBe('critica');
  });

  it('alta: impede uma pessoa de trabalhar', () => {
    const d = classifyPriority(facts({ blocksWork: true }));
    expect(d).toMatchObject({ priority: 'alta', rule: 'alta_impede_trabalho' });
  });

  it('alta: compromisso no mesmo dia (caso da VPN antes da reunião das 14h)', () => {
    const d = classifyPriority(facts({ sameDayCommitment: true }));
    expect(d).toMatchObject({ priority: 'alta', rule: 'alta_compromisso_hoje' });
    expect(d.reason).toMatch(/compromisso hoje/);
  });

  it('média: atrapalha, mas há alternativa', () => {
    expect(classifyPriority(facts({ blocksWork: true, hasWorkaround: true })).priority).toBe('media');
    expect(classifyPriority(facts({ impact: 'equipe', hasWorkaround: true })).priority).toBe('media');
  });

  it('baixa: pedido sem urgência', () => {
    expect(classifyPriority(facts({ type: 'REQ' })).priority).toBe('baixa');
  });

  it('requisição urgente sobe de prioridade', () => {
    expect(classifyPriority(facts({ type: 'REQ', sameDayCommitment: true })).priority).toBe('alta');
  });

  it('registra a suposição quando o impacto é desconhecido', () => {
    const d = classifyPriority(facts({ impact: 'desconhecido' }));
    expect(d.assumptions).toHaveLength(1);
  });
});
