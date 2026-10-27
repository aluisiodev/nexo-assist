import { describe, expect, it } from 'vitest';
import { canReopen, computeDueAt, computeSla } from '../src';

const sp = (isoLocal: string): Date => new Date(`${isoLocal}-03:00`);

describe('computeDueAt', () => {
  it('crítica usa tempo corrido (plantão 24h)', () => {
    expect(computeDueAt('critica', sp('2026-10-31T23:00:00'))).toEqual(sp('2026-11-01T00:00:00'));
  });

  it('alta: 4 horas úteis (exemplo do protótipo: 09:43 → 13:43)', () => {
    expect(computeDueAt('alta', sp('2026-10-27T09:43:00'))).toEqual(sp('2026-10-27T13:43:00'));
  });

  it('baixa: 5 dias úteis', () => {
    expect(computeDueAt('baixa', sp('2026-10-27T10:00:00'))).toEqual(sp('2026-11-03T10:00:00'));
  });
});

describe('computeSla', () => {
  const base = { priority: 'media' as const, slaReferenceAt: sp('2026-10-16T14:20:00').toISOString() };

  it('marca como vencido quando passa do prazo (INC-20311 do protótipo)', () => {
    const sla = computeSla({ ...base, status: 'aguardando_analista' }, sp('2026-10-27T10:00:00'));
    expect(sla.overdue).toBe(true);
    expect(sla.target).toBe('3 dias úteis');
    expect(sla.dueAt).toBe(sp('2026-10-21T14:20:00').toISOString());
  });

  it('não vence antes do prazo', () => {
    const sla = computeSla({ ...base, status: 'em_andamento' }, sp('2026-10-20T10:00:00'));
    expect(sla.overdue).toBe(false);
  });

  it('pausa quando o chamado aguarda o funcionário ou está resolvido', () => {
    for (const status of ['aguardando_usuario', 'resolvido', 'fechado'] as const) {
      const sla = computeSla({ ...base, status }, sp('2026-10-27T10:00:00'));
      expect(sla).toMatchObject({ paused: true, overdue: false, dueAt: null });
    }
  });
});

describe('canReopen', () => {
  const now = sp('2026-10-27T10:00:00');
  it('permite até 7 dias após a resolução', () => {
    expect(canReopen({ status: 'resolvido', resolvedAt: sp('2026-10-23T10:00:00').toISOString() }, now)).toBe(true);
    expect(canReopen({ status: 'resolvido', resolvedAt: sp('2026-10-20T10:00:00').toISOString() }, now)).toBe(true);
  });

  it('nega depois de 7 dias ou se não estiver resolvido', () => {
    expect(canReopen({ status: 'resolvido', resolvedAt: sp('2026-10-20T09:59:00').toISOString() }, now)).toBe(false);
    expect(canReopen({ status: 'fechado', resolvedAt: sp('2026-10-26T10:00:00').toISOString() }, now)).toBe(false);
    expect(canReopen({ status: 'resolvido', resolvedAt: null }, now)).toBe(false);
  });
});
