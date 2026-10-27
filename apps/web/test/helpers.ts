import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, openDatabase, seed } from '@nexo/service-desk';
import { createServiceDeskClient } from '@nexo/service-desk-client';
import type { ServiceDeskAccess } from '@/server/agent/types';
import type { SessionUser } from '@/server/auth/sessions';
import { ConversationRepository } from '@/server/conversations/repository';
import { openAppDatabase } from '@/server/db/open';

export const NOW = new Date('2026-10-27T10:00:00-03:00');
const API_KEY = 'test-api-key-0123456789';

export const ANA: SessionUser = {
  employeeId: 'emp-ana',
  name: 'Ana Souza',
  email: 'ana.souza@nexo.com.br',
  department: 'Financeiro',
  role: 'employee',
  supportGroup: null,
};
export const RAFAEL: SessionUser = {
  employeeId: 'ana-rafael',
  name: 'Rafael Lima',
  email: 'rafael.lima@nexo.com.br',
  department: 'TI · Service desk',
  role: 'analyst',
  supportGroup: 'N2',
};
export const JULIANA: SessionUser = { ...RAFAEL, employeeId: 'ana-juliana', name: 'Juliana Costa', supportGroup: 'N1' };

const tempUrl = (name: string) => `file:${join(mkdtempSync(join(tmpdir(), 'nexo-web-')), name)}`;

/** Banco do app vazio, num arquivo temporário. */
export async function createConversationRepo(): Promise<ConversationRepository> {
  return new ConversationRepository(await openAppDatabase(tempUrl('app.db')));
}

/** Service desk real (em memória do processo, sem rede) com os dados de exemplo. */
export async function createServiceDesk(opts: { down?: boolean } = {}) {
  const db = await openDatabase(tempUrl('sd.db'));
  await seed(db, NOW);
  const app = createApp({
    db,
    apiKey: API_KEY,
    clock: () => NOW,
    chaos: opts.down
      ? { failureRate: 1, outageMs: 60_000, latencyMs: 0 }
      : { failureRate: 0, outageMs: 0, latencyMs: 0 },
  });
  const options = {
    baseUrl: 'http://sd.test',
    apiKey: API_KEY,
    fetch: ((input, init) => Promise.resolve(app.request(String(input), init))) as typeof fetch,
    sleep: async () => {},
  };
  const client = createServiceDeskClient(options);
  const access: ServiceDeskAccess = {
    forActor: (id, o) =>
      createServiceDeskClient({ ...options, ...(o?.onRetry ? { onRetry: o.onRetry } : {}) }).forActor(id, {
        viaAgent: true,
      }),
    searchArticles: (q, limit) => client.searchArticles(q, limit),
  };
  return { app, client, access };
}
