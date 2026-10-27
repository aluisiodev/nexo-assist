import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from '@libsql/client';
import { createApp } from '../src/app';
import type { ChaosOptions } from '../src/context';
import { openDatabase } from '../src/db/client';
import { seed } from '../src/seed/seed';

export const API_KEY = 'test-api-key-0123456789';
/** Terça-feira, 27/10/2026, 10:00 em São Paulo. */
export const NOW = new Date('2026-10-27T10:00:00-03:00');

export const NO_CHAOS: ChaosOptions = { failureRate: 0, outageMs: 0, latencyMs: 0 };

export interface TestServer {
  readonly db: Client;
  readonly app: ReturnType<typeof createApp>;
  /** Faz uma requisição já com a chave de API e, se informado, o funcionário. */
  call(
    path: string,
    init?: { method?: string; actor?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<Response>;
}

export async function createTestServer(opts: { chaos?: ChaosOptions; now?: Date } = {}): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'nexo-sd-'));
  const db = await openDatabase(`file:${join(dir, 'test.db')}`);
  const now = opts.now ?? NOW;
  await seed(db, now);
  const app = createApp({ db, apiKey: API_KEY, chaos: opts.chaos ?? NO_CHAOS, clock: () => now });
  return {
    db,
    app,
    call(path, init = {}) {
      const headers: Record<string, string> = { 'x-api-key': API_KEY, ...init.headers };
      if (init.actor) headers['x-actor-id'] = init.actor;
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      return Promise.resolve(
        app.request(path, {
          method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
          headers,
          ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        }),
      );
    },
  };
}

export const ANA = 'emp-ana';
export const BRUNO = 'emp-bruno';
export const DIEGO = 'emp-diego';
export const RAFAEL = 'ana-rafael';

export const vpnTicket = {
  type: 'INC',
  category: 'rede_vpn',
  title: 'VPN não conecta no notebook — erro 809',
  description: 'Desde ontem o notebook (Windows 11) não conecta na VPN e mostra o erro 809.',
  priority: 'alta',
  priorityReason: 'Há um compromisso hoje que depende da solução.',
  impact: 'individual',
} as const;
