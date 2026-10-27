import type { Client } from '@libsql/client';
import { NEXO_CALENDAR, TicketSchema } from '@nexo/domain';
import { migrate } from '../db/client';
import { TABLES_DROP_ORDER } from '../db/schema';
import { createRepositories } from '../context';
import { ARTICLES, EMPLOYEES, SEQUENCES, TICKETS, type RelativeTime } from './data';

const DAY_MS = 86_400_000;

/** Converte "N dias atrás às HH:MM (São Paulo)" em ISO, a partir de `now`. */
export function resolveRelative(now: Date, rel: RelativeTime): string {
  const offsetMs = NEXO_CALENDAR.utcOffsetMinutes * 60_000;
  const local = new Date(now.getTime() + offsetMs - rel.daysAgo * DAY_MS);
  local.setUTCHours(rel.hour, rel.minute ?? 0, 0, 0);
  let utc = local.getTime() - offsetMs;
  // "Hoje às 9h" não pode ficar no futuro se o seed rodar às 8h: limita a agora.
  if (utc > now.getTime()) utc = now.getTime();
  return new Date(utc).toISOString();
}

/** Grava todos os dados de exemplo. Espera um banco vazio. */
export async function seed(db: Client, now: Date): Promise<void> {
  const repos = createRepositories(db);
  for (const e of EMPLOYEES) await repos.employees.insert(e);
  for (const a of ARTICLES) await repos.articles.insert(a);
  for (const s of TICKETS) {
    const ticket = TicketSchema.parse({
      ...s.ticket,
      createdAt: resolveRelative(now, s.createdAt),
      updatedAt: resolveRelative(now, s.events.at(-1)?.at ?? s.createdAt),
      slaReferenceAt: resolveRelative(now, s.slaReferenceAt),
      resolvedAt: s.resolvedAt ? resolveRelative(now, s.resolvedAt) : null,
    });
    await repos.tickets.insertWithId(
      ticket,
      s.events.map((e) => ({
        kind: e.kind,
        body: e.body,
        actor: { type: e.actorType, id: e.actorId },
        at: resolveRelative(now, e.at),
      })),
    );
  }
  for (const [name, value] of Object.entries(SEQUENCES)) await repos.tickets.setSequence(name, value);
}

/** Popula só se o banco ainda não tiver funcionários. Devolve true se populou. */
export async function seedIfEmpty(db: Client, now: Date): Promise<boolean> {
  const rs = await db.execute('SELECT COUNT(*) AS n FROM employees');
  const count = Number(rs.rows[0]?.['n'] ?? 0);
  if (count > 0) return false;
  await seed(db, now);
  return true;
}

/** Apaga tudo e recria do zero (npm run db:reset). */
export async function resetDatabase(db: Client, now: Date): Promise<void> {
  await db.executeMultiple(TABLES_DROP_ORDER.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
  await migrate(db);
  await seed(db, now);
}
