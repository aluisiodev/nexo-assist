import { expect, test, type Page } from '@playwright/test';
import { ANA, DIEGO, freshChat, JULIANA, login, personFor, RAFAEL, send } from './helpers';

/**
 * O fluxo completo da transferência, com duas pessoas ao mesmo tempo (dois navegadores):
 * a funcionária pede um analista, a analista assume pelo console, responde, devolve ao
 * agent e encerra. As duas telas se atualizam sozinhas (polling).
 */
test('transferência: funcionária pede analista; analista assume, responde, devolve e encerra', async ({ browser }) => {
  const ana = await personFor(browser, ANA);
  await freshChat(ana);
  await send(ana, 'Quero falar com um analista');
  await expect(ana.getByText(/Transferida para Suporte N1/)).toBeVisible();
  await expect(ana.getByText(/Aguardando um analista/)).toBeVisible();

  // Juliana (N1) vê a conversa em "Para você".
  const juliana = await personFor(browser, JULIANA);
  await expect(juliana).toHaveURL(/\/console$/);
  await filter(juliana, 'Para você').click();
  const row = conversationRow(juliana, 'Ana Souza');
  await expect(row).toBeVisible();
  await expect(row.getByText('Transferida', { exact: true })).toBeVisible();
  await row.click();

  // Tela 5: resumo da transferência, histórico com o "por quê?" e o painel de chamados.
  await expect(juliana.getByRole('article', { name: 'Resumo da transferência' })).toBeVisible();
  await expect(juliana.getByText('Funcionário pediu um analista')).toBeVisible();
  await expect(juliana.getByText('Quero falar com um analista').first()).toBeVisible();
  const panel = juliana.getByRole('complementary', { name: 'Funcionário e chamados' });
  await expect(panel.getByText('INC-20311')).toBeVisible();

  // Enquanto aguarda, a funcionária continua escrevendo e a analista vê.
  await send(ana, 'Estou com pressa, por favor');
  await expect(juliana.getByText('Estou com pressa, por favor')).toBeVisible();

  // Com a equipe, o contador do assistente fica pausado (a conversa com analista não tem limite).
  await expect(ana.getByText(/pausado enquanto um analista atende/)).toBeVisible();

  // Assumir: o agent pausa e os dois lados veem o aviso.
  await juliana.getByRole('button', { name: 'Assumir' }).click();
  await expect(juliana.getByText(/Juliana Costa assumiu · agent pausado/)).toBeVisible();
  await expect(ana.getByText(/Juliana Costa está atendendo você/)).toBeVisible();

  // Outro analista não consegue assumir nem responder.
  const rafael = await personFor(browser, RAFAEL);
  await conversationRow(rafael, 'Ana Souza').click();
  await expect(rafael.getByText('Com Juliana Costa').first()).toBeVisible();
  await expect(rafael.getByRole('button', { name: 'Assumir' })).toHaveCount(0);
  await expect(rafael.getByText('Juliana Costa está atendendo esta conversa.')).toBeVisible();

  // Responder: chega no chat da funcionária.
  await juliana.getByLabel('Resposta para Ana Souza').fill('Oi, Ana! Vou olhar o seu notebook agora.');
  await juliana.getByRole('button', { name: 'Enviar' }).click();
  await expect(ana.getByText('Oi, Ana! Vou olhar o seu notebook agora.')).toBeVisible();

  // Devolver ao agent: o assistente volta a responder.
  await juliana.getByRole('button', { name: 'Devolver ao agent' }).click();
  await expect(ana.getByText(/devolveu a conversa ao Nexo Assist/)).toBeVisible();
  await expect(ana.getByText(/Assistente (online|em modo básico)/)).toBeVisible();
  await send(ana, 'Qual o horário do service desk?');
  await expect(ana.getByText('De segunda a sexta, das 8h às 18h').last()).toBeVisible();

  // Encerrar pelo console.
  await juliana.getByRole('button', { name: 'Encerrar' }).click();
  await expect(juliana.getByText('Encerrada por Juliana Costa').first()).toBeVisible();
  await expect(ana.getByText(/Atendimento encerrado por Juliana Costa/)).toBeVisible();
  await expect(ana.getByLabel('Mensagem')).toBeDisabled();
});

test('chamado vencido vai para o N2 com o motivo e o chamado relacionado', async ({ browser }) => {
  // Pedido de analista logo depois de ver o chamado vencido → N2, motivo "chamado vencido".
  const ana = await personFor(browser, ANA);
  await freshChat(ana);
  await send(ana, 'Qual o status do INC-20311?');
  await expect(ana.getByRole('article', { name: 'Chamado INC-20311' })).toBeVisible();
  await send(ana, 'Quero falar com um analista');
  await expect(ana.getByText(/Transferida para Suporte N2/)).toBeVisible();

  const rafael = await personFor(browser, RAFAEL);
  await filter(rafael, 'Para você').click();
  const row = conversationRow(rafael, 'Ana Souza');
  await expect(row.getByText('Transferida · chamado vencido')).toBeVisible();
  await row.click();
  await expect(rafael.getByText('Chamado com prazo vencido')).toBeVisible();
  await expect(rafael.getByText('Relacionado à transferência')).toBeVisible();
  await rafael.getByRole('button', { name: 'Encerrar' }).click();
  await expect(rafael.getByText('Encerrada por Rafael Lima').first()).toBeVisible();
});

test('com analista não há limite por minuto nem contador correndo', async ({ browser }) => {
  // O app destes testes usa o limite de 10 mensagens por minuto com o assistente.
  const diego = await personFor(browser, DIEGO);
  await freshChat(diego);
  await send(diego, 'Quero falar com um analista');
  await expect(diego.getByText(/Transferida para Suporte/)).toBeVisible();
  for (let i = 1; i <= 12; i++) await sendAndWait(diego, `detalhe número ${i}`);
  await expect(diego.getByText(/Aguarde/)).toHaveCount(0);
  await expect(diego.getByText(/1\/30 com o assistente · pausado enquanto um analista atende/)).toBeVisible();
});

test('console no celular: fila → conversa → voltar', async ({ browser }) => {
  const ana = await personFor(browser, ANA);
  await freshChat(ana);
  await send(ana, 'Qual o horário do service desk?');

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const juliana = await context.newPage();
  await login(juliana, JULIANA);
  await filter(juliana, 'Com o agent').click();
  await conversationRow(juliana, 'Ana Souza').click();
  await expect(juliana.getByRole('button', { name: 'Voltar para a fila' })).toBeVisible();
  const overflow = await juliana.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await juliana.getByRole('button', { name: 'Voltar para a fila' }).click();
  await expect(juliana.getByRole('heading', { name: 'Fila de atendimento' })).toBeVisible();
});

const conversationRow = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Conversas' }).getByRole('button').filter({ hasText: name }).first();

const filter = (page: Page, label: string) =>
  page.getByRole('group', { name: 'Filtros' }).getByRole('button', { name: new RegExp(`^${label}`) });

/** Envia e espera a mensagem aparecer (o campo só libera depois do envio). */
async function sendAndWait(page: Page, text: string) {
  await send(page, text);
  await expect(page.getByText(text, { exact: true })).toBeVisible();
}
