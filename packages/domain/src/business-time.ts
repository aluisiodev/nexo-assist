/**
 * Aritmética de horário comercial.
 *
 * O horário do service desk é de segunda a sexta, das 8h às 18h (artigo "Horário do
 * service desk"). O Brasil não tem horário de verão desde 2019, então um deslocamento
 * fixo de UTC-3 é suficiente e evita depender de base de fusos em runtime.
 * Feriados não são considerados (ver README, trade-offs).
 */

export interface BusinessCalendar {
  /** Deslocamento do fuso local em relação ao UTC, em minutos (São Paulo: -180). */
  readonly utcOffsetMinutes: number;
  /** Hora local de início do expediente (inclusiva). */
  readonly startHour: number;
  /** Hora local de fim do expediente (exclusiva). */
  readonly endHour: number;
  /** Dias úteis, 0 = domingo … 6 = sábado. */
  readonly workdays: readonly number[];
}

export const NEXO_CALENDAR: BusinessCalendar = {
  utcOffsetMinutes: -180,
  startHour: 8,
  endHour: 18,
  workdays: [1, 2, 3, 4, 5],
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Minutos úteis em um dia de expediente. */
export function businessMinutesPerDay(cal: BusinessCalendar = NEXO_CALENDAR): number {
  return (cal.endHour - cal.startHour) * 60;
}

// Trabalhamos num "relógio local" representado em ms, lido com getters UTC.
const toLocalMs = (d: Date, cal: BusinessCalendar): number => d.getTime() + cal.utcOffsetMinutes * MINUTE_MS;
const fromLocalMs = (ms: number, cal: BusinessCalendar): Date => new Date(ms - cal.utcOffsetMinutes * MINUTE_MS);
const startOfDay = (localMs: number): number => Math.floor(localMs / DAY_MS) * DAY_MS;
const isWorkday = (localMs: number, cal: BusinessCalendar): boolean =>
  cal.workdays.includes(new Date(localMs).getUTCDay());
const openAt = (dayMs: number, cal: BusinessCalendar): number => dayMs + cal.startHour * 60 * MINUTE_MS;
const closeAt = (dayMs: number, cal: BusinessCalendar): number => dayMs + cal.endHour * 60 * MINUTE_MS;

/** Avança até o próximo instante dentro do expediente (ou mantém, se já estiver dentro). */
function nextBusinessInstant(localMs: number, cal: BusinessCalendar): number {
  let cursor = localMs;
  for (let guard = 0; guard < 14; guard++) {
    const day = startOfDay(cursor);
    if (isWorkday(cursor, cal)) {
      if (cursor < openAt(day, cal)) return openAt(day, cal);
      if (cursor < closeAt(day, cal)) return cursor;
    }
    cursor = day + DAY_MS;
  }
  throw new Error('Calendário sem dias úteis configurados');
}

/** Soma minutos úteis a uma data. Se começar fora do expediente, conta a partir da próxima abertura. */
export function addBusinessMinutes(from: Date, minutes: number, cal: BusinessCalendar = NEXO_CALENDAR): Date {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new RangeError(`minutos inválidos: ${minutes}`);
  }
  let cursor = nextBusinessInstant(toLocalMs(from, cal), cal);
  let remaining = minutes * MINUTE_MS;
  for (;;) {
    const available = closeAt(startOfDay(cursor), cal) - cursor;
    if (remaining <= available) return fromLocalMs(cursor + remaining, cal);
    remaining -= available;
    cursor = nextBusinessInstant(closeAt(startOfDay(cursor), cal), cal);
  }
}

/** Minutos úteis decorridos entre duas datas (0 se `to` não for depois de `from`). */
export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar = NEXO_CALENDAR): number {
  const a = toLocalMs(from, cal);
  const b = toLocalMs(to, cal);
  if (b <= a) return 0;
  let total = 0;
  for (let day = startOfDay(a); day <= b; day += DAY_MS) {
    if (!isWorkday(day, cal)) continue;
    const overlap = Math.min(closeAt(day, cal), b) - Math.max(openAt(day, cal), a);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / MINUTE_MS);
}

/** Está dentro do expediente neste instante? */
export function isWithinBusinessHours(at: Date, cal: BusinessCalendar = NEXO_CALENDAR): boolean {
  const local = toLocalMs(at, cal);
  return nextBusinessInstant(local, cal) === local;
}
