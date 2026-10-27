import type { Impact, Priority, TicketType } from './types';

/**
 * Classificação de prioridade (Anexo A): combina impacto (quantas pessoas) e urgência
 * (compromisso em risco). É determinística de propósito: o LLM extrai os fatos da
 * conversa, e esta função decide. Assim a regra é testável, barata e explicável.
 */
export interface PriorityFacts {
  readonly type: TicketType;
  readonly impact: Impact;
  /** Algo parou / impede de trabalhar (vs. apenas atrapalha). */
  readonly blocksWork: boolean;
  /** Existe alternativa de contorno. */
  readonly hasWorkaround: boolean;
  /** Há um compromisso no mesmo dia que depende da solução. */
  readonly sameDayCommitment: boolean;
}

export type PriorityRuleId =
  | 'critica_parado_coletivo'
  | 'alta_impede_trabalho'
  | 'alta_compromisso_hoje'
  | 'media_atrapalha'
  | 'baixa_pedido_sem_urgencia';

export interface PriorityDecision {
  readonly priority: Priority;
  readonly rule: PriorityRuleId;
  /** Frase curta, em português, mostrada ao funcionário e ao analista. */
  readonly reason: string;
  /** Suposições feitas por falta de informação (o agent deve confirmar). */
  readonly assumptions: readonly string[];
}

export function classifyPriority(facts: PriorityFacts): PriorityDecision {
  const assumptions: string[] = [];
  if (facts.impact === 'desconhecido') {
    assumptions.push('Impacto não informado: considerei que afeta só você.');
  }
  const collective = facts.impact === 'equipe' || facts.impact === 'empresa';

  if (collective && facts.blocksWork && !facts.hasWorkaround) {
    const who = facts.impact === 'empresa' ? 'a empresa' : 'uma equipe';
    return {
      priority: 'critica',
      rule: 'critica_parado_coletivo',
      reason: `Está parado para ${who}, sem alternativa.`,
      assumptions,
    };
  }
  if (facts.sameDayCommitment) {
    return {
      priority: 'alta',
      rule: 'alta_compromisso_hoje',
      reason: 'Há um compromisso hoje que depende da solução.',
      assumptions,
    };
  }
  if (facts.blocksWork && !facts.hasWorkaround) {
    return {
      priority: 'alta',
      rule: 'alta_impede_trabalho',
      reason: collective
        ? 'Impede o trabalho de mais de uma pessoa.'
        : 'Impede você de trabalhar e não há alternativa.',
      assumptions,
    };
  }
  if (facts.type === 'REQ' && !facts.blocksWork) {
    return {
      priority: 'baixa',
      rule: 'baixa_pedido_sem_urgencia',
      reason: 'Pedido sem urgência.',
      assumptions,
    };
  }
  return {
    priority: 'media',
    rule: 'media_atrapalha',
    reason: facts.hasWorkaround ? 'Atrapalha, mas há alternativa.' : 'Atrapalha o trabalho, sem parar tudo.',
    assumptions,
  };
}
