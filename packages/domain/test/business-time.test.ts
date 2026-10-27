import { describe, expect, it } from 'vitest';
import { addBusinessMinutes, businessMinutesBetween, isWithinBusinessHours } from '../src';

/** Cria uma data a partir do horário de São Paulo (UTC-3). */
const sp = (isoLocal: string): Date => new Date(`${isoLocal}-03:00`);

// 27/10/2026 é uma terça-feira.
describe('addBusinessMinutes', () => {
  it('soma dentro do mesmo dia', () => {
    expect(addBusinessMinutes(sp('2026-10-27T09:43:00'), 240)).toEqual(sp('2026-10-27T13:43:00'));
  });

  it('continua no próximo dia útil quando passa das 18h', () => {
    expect(addBusinessMinutes(sp('2026-10-27T16:00:00'), 240)).toEqual(sp('2026-10-28T10:00:00'));
  });

  it('pula o fim de semana', () => {
    expect(addBusinessMinutes(sp('2026-10-30T16:00:00'), 240)).toEqual(sp('2026-11-02T10:00:00'));
  });

  it('começa a contar na abertura quando a origem está fora do expediente', () => {
    expect(addBusinessMinutes(sp('2026-10-27T06:00:00'), 30)).toEqual(sp('2026-10-27T08:30:00'));
    expect(addBusinessMinutes(sp('2026-10-31T10:00:00'), 60)).toEqual(sp('2026-11-02T09:00:00'));
    expect(addBusinessMinutes(sp('2026-10-27T19:00:00'), 60)).toEqual(sp('2026-10-28T09:00:00'));
  });

  it('3 dias úteis equivalem a 30 horas de expediente', () => {
    expect(addBusinessMinutes(sp('2026-10-27T14:20:00'), 3 * 600)).toEqual(sp('2026-10-30T14:20:00'));
  });

  it('rejeita minutos negativos', () => {
    expect(() => addBusinessMinutes(sp('2026-10-27T10:00:00'), -1)).toThrow(RangeError);
  });
});

describe('businessMinutesBetween', () => {
  it('conta só o expediente', () => {
    expect(businessMinutesBetween(sp('2026-10-30T17:00:00'), sp('2026-11-02T09:00:00'))).toBe(120);
  });

  it('é zero quando o fim vem antes do início', () => {
    expect(businessMinutesBetween(sp('2026-10-28T10:00:00'), sp('2026-10-27T10:00:00'))).toBe(0);
  });
});

describe('isWithinBusinessHours', () => {
  it('reconhece expediente, noite e fim de semana', () => {
    expect(isWithinBusinessHours(sp('2026-10-27T10:00:00'))).toBe(true);
    expect(isWithinBusinessHours(sp('2026-10-27T18:00:00'))).toBe(false);
    expect(isWithinBusinessHours(sp('2026-10-31T10:00:00'))).toBe(false);
  });
});
