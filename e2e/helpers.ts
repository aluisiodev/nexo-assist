import { expect, type Browser, type Page } from '@playwright/test';

export const ANA = 'ana.souza@nexo.com.br';
export const DIEGO = 'diego.ramos@nexo.com.br';
export const RAFAEL = 'rafael.lima@nexo.com.br'; // analista N2
export const JULIANA = 'juliana.costa@nexo.com.br'; // analista N1

/** Entra com o e-mail (o desafio pede que a senha não seja verificada). */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail corporativo').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('qualquer-senha');
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Uma pessoa = um navegador separado (cookies próprios). */
export async function personFor(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return page;
}

/** Começa uma conversa limpa para o funcionário (encerra a anterior, se houver). */
export async function freshChat(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/atendimento$/);
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Como posso ajudar?' })).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Mensagem').fill(text);
  await page.getByRole('button', { name: 'Enviar' }).click();
}
