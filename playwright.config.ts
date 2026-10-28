import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Testes de ponta a ponta no navegador (Playwright): sobem o service desk e o app de
 * produção em portas próprias, com bancos temporários, sem instabilidade simulada e
 * sem IA (modo básico). Assim rodam iguais em qualquer máquina, sem chave e sem custo;
 * as decisões da IA são cobertas pelos testes do agent e pelos evals.
 *
 *   npx playwright install chromium   (uma vez)
 *   npm run test:e2e
 */

const SD_PORT = 4110;
const WEB_PORT = 3100;
const dataDir = fileURLToPath(new URL('./e2e/.data', import.meta.url));

// Só o processo principal limpa os bancos (os workers também carregam este arquivo).
if (!process.env.TEST_WORKER_INDEX) rmSync(dataDir, { recursive: true, force: true });

const env = {
  SERVICE_DESK_PORT: String(SD_PORT),
  SERVICE_DESK_API_KEY: 'e2e-service-desk-key-0123456789',
  // Caminhos relativos à pasta de cada serviço (funciona igual no Windows).
  SERVICE_DESK_DATABASE_URL: 'file:../../e2e/.data/service-desk.db',
  APP_DATABASE_URL: 'file:../../e2e/.data/app.db',
  SERVICE_DESK_URL: `http://localhost:${SD_PORT}`,
  CHAOS_FAILURE_RATE: '0',
  CHAOS_LATENCY_MS: '0',
  LLM_PROVIDER: 'none',
  LLM_FALLBACK_PROVIDER: 'none',
  CHAT_RATE_LIMIT_PER_MINUTE: '0',
  AI_DAILY_CALL_LIMIT: '0',
  PORT: String(WEB_PORT),
};

export default defineConfig({
  testDir: './e2e',
  // Os testes compartilham os mesmos bancos (como usuários reais): um de cada vez.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  outputDir: 'e2e/.results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'npm run start -w @nexo/service-desk',
      url: `http://localhost:${SD_PORT}/health`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Build de produção, como numa publicação de verdade.
      command: 'npm run build -w @nexo/web && npm run start -w @nexo/web',
      url: `http://localhost:${WEB_PORT}/login`,
      env,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
