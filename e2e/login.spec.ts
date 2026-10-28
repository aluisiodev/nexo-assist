import { expect, test } from '@playwright/test';
import { ANA, login, RAFAEL } from './helpers';

test.describe('login (Tela 1)', () => {
  test('funcionário entra no atendimento e analista no console', async ({ page }) => {
    await login(page, ANA);
    await expect(page).toHaveURL(/\/atendimento$/);
    await expect(page.getByText('Ana Souza').first()).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).last().click();
    await expect(page).toHaveURL(/\/login$/);

    await login(page, RAFAEL);
    await expect(page).toHaveURL(/\/console$/);
    await expect(page.getByRole('heading', { name: 'Fila de atendimento' })).toBeVisible();
  });

  test('e-mail fora do diretório mostra erro e não entra', async ({ page }) => {
    await login(page, 'ninguem@nexo.com.br');
    await expect(page.getByText('Não encontramos esse e-mail corporativo')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('funcionário não acessa o console', async ({ page }) => {
    await login(page, ANA);
    await expect(page).toHaveURL(/\/atendimento$/);
    await page.goto('/console');
    await expect(page).toHaveURL(/\/atendimento$/);
    const api = await page.request.get('/api/console/queue');
    expect(api.status()).toBe(403);
  });
});
