import { expect, test } from '@playwright/test';
import { ANA, freshChat, login, send } from './helpers';

test.describe('chat do funcionário (Telas 2 e 3, modo básico)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ANA);
    await freshChat(page);
  });

  test('consulta os chamados, mostra o vencido e o registro da decisão ("por quê?")', async ({ page }) => {
    await send(page, 'Qual o status dos meus chamados?');

    const list = page.getByRole('list', { name: 'Seus chamados' });
    await expect(list).toBeVisible();
    await expect(list.getByText('INC-20311')).toBeVisible();
    await expect(list.getByText('Prazo vencido')).toBeVisible();

    await page.getByRole('button', { name: 'por quê?' }).last().click();
    await expect(page.getByText('Respondido por')).toBeVisible();
    await expect(page.getByText('regras do service desk (sem IA)').last()).toBeVisible();
    await expect(page.getByText('consultou seus chamados').last()).toBeVisible();
  });

  test('escolher um chamado da lista mostra o card com prazo', async ({ page }) => {
    await send(page, 'Qual o status dos meus chamados?');
    await page
      .getByRole('list', { name: 'Seus chamados' })
      .getByText('Notebook lento após atualização do Windows')
      .click();
    const card = page.getByRole('article', { name: 'Chamado INC-20311' });
    await expect(card).toBeVisible();
    await expect(card.getByText('prazo vencido')).toBeVisible();
  });

  test('privacidade: chamado de outra pessoa aparece como "não encontrado"', async ({ page }) => {
    // INC-20330 existe, mas é do Bruno: a Ana recebe a mesma resposta de um número inexistente.
    await send(page, 'Qual o status do INC-20330?');
    await expect(page.getByText('Não encontrei o INC-20330 entre os seus chamados')).toBeVisible();
  });

  test('a conversa sobrevive a recarregar a página', async ({ page }) => {
    await send(page, 'Qual o horário do service desk?');
    await expect(page.getByText('De segunda a sexta, das 8h às 18h').last()).toBeVisible();
    await page.reload();
    await expect(page.getByText('Qual o horário do service desk?')).toBeVisible();
    await expect(page.getByText(/1\/30 mensagens com o assistente/)).toBeVisible();
  });

  test('celular: sem rolagem horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await send(page, 'Qual o status dos meus chamados?');
    await expect(page.getByRole('list', { name: 'Seus chamados' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
