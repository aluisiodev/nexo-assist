import { createServiceDeskClient, ServiceDeskError, type RetryInfo } from '@nexo/service-desk-client';
import { describe, expect, it } from 'vitest';
import { ANA, API_KEY, BRUNO, createTestServer, vpnTicket } from './helpers';

/** Cliente real falando com a app real, sem rede: fetch → app.request. */
async function setup(chaos?: Parameters<typeof createTestServer>[0]) {
  const s = await createTestServer(chaos);
  const retries: RetryInfo[] = [];
  const client = createServiceDeskClient({
    baseUrl: 'http://service-desk.test',
    apiKey: API_KEY,
    fetch: (input, init) => Promise.resolve(s.app.request(String(input), init)),
    sleep: async () => {},
    onRetry: (info) => retries.push(info),
  });
  return { s, client, retries };
}

describe('cliente tipado + serviço', () => {
  it('consulta chamados e artigos com tipos validados', async () => {
    const { client } = await setup();
    const ana = client.forActor(ANA, { viaAgent: true });
    const tickets = await ana.listTickets();
    expect(tickets.map((t) => t.id)).toContain('INC-20311');
    expect(tickets.find((t) => t.id === 'INC-20311')?.sla.overdue).toBe(true);
    expect((await client.searchArticles('vpn erro 809'))[0]?.id).toBe('kb-vpn-809');
    expect(await client.findEmployeeByEmail('ana.souza@nexo.com.br')).toMatchObject({ id: ANA });
    expect(await client.findEmployeeByEmail('ninguem@nexo.com.br')).toBeNull();
  });

  it('erros de negócio viram ServiceDeskError com código estável', async () => {
    const { client } = await setup();
    const err = await client.forActor(ANA).getTicket('INC-20330').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceDeskError);
    expect(err).toMatchObject({ kind: 'not_found', status: 404 });

    const reopen = await client.forActor(ANA).reopenTicket('INC-19877', { reason: 'de novo' }, 'k-1').catch((e: unknown) => e);
    expect(reopen).toMatchObject({ kind: 'conflict', code: 'reopen_window_expired' });
  });

  it('atravessa uma queda do legado com retry e cria o chamado uma vez só', async () => {
    let now = 0;
    // 1ª chamada derruba o serviço por 1s; o "sleep" do cliente avança o relógio.
    const randoms = [0.01];
    const s = await createTestServer({
      chaos: { failureRate: 0.5, outageMs: 1000, latencyMs: 0, now: () => now, random: () => randoms.shift() ?? 0.99 },
    });
    const retries: RetryInfo[] = [];
    const client = createServiceDeskClient({
      baseUrl: 'http://service-desk.test',
      apiKey: API_KEY,
      fetch: (input, init) => Promise.resolve(s.app.request(String(input), init)),
      sleep: async (ms) => {
        now += ms;
      },
      onRetry: (info) => retries.push(info),
    });

    const ticket = await client.forActor(ANA, { viaAgent: true }).createTicket(vpnTicket, 'draft-D-381');
    expect(ticket.id).toBe('INC-20517');
    expect(retries.length).toBeGreaterThanOrEqual(1);
    expect(retries[0]).toMatchObject({ reason: 'HTTP 503', method: 'POST' });

    const again = await client.forActor(ANA).createTicket(vpnTicket, 'draft-D-381');
    expect(again.id).toBe('INC-20517');
  });

  it('desiste depois do limite e informa que está indisponível', async () => {
    const { client, retries } = await setup({ chaos: { failureRate: 1, outageMs: 60_000, latencyMs: 0 } });
    const err = await client.forActor(BRUNO).listTickets().catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'unavailable', status: 503 });
    expect(retries).toHaveLength(3);
  });
});
