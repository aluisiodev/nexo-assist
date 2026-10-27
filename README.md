# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat; o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados e chama um analista quando precisa.

> **Status:** em construção. Etapa atual: **serviços** (regras do service desk, serviço de chamados simulado e cliente). Próximas: agent (Mastra), chat do funcionário e console do analista.

## Como rodar

Pré-requisito: **Node.js 20.12+** (recomendado 22, ver `.nvmrc`).

```bash
npm install
cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env
npm run dev:service-desk      # sobe o serviço de chamados em http://localhost:4010
```

Na primeira execução o banco SQLite é criado em `services/service-desk/data/` com os dados de exemplo. Os dados **sobrevivem a reinícios**.

| Comando | O que faz |
|---|---|
| `npm test` | Roda todos os testes (Vitest) |
| `npm run typecheck` | Checagem de tipos estrita em todos os pacotes |
| `npm run db:reset` | Apaga e recria o banco com os dados de exemplo |

## Arquitetura

```
packages/
  domain/               Regras do Anexo A, puras e testadas: tipos, prazos em horas úteis,
                        prioridade, duplicidade, reabertura. Sem LLM, sem banco.
  service-desk-client/  Cliente HTTP tipado: timeout, retry com backoff, idempotência,
                        validação de contrato. É o único caminho do agent até os chamados.
services/
  service-desk/         "Sistema legado" simulado (Hono + SQLite/libSQL), separado do agent.
                        Chamados, central de ajuda e diretório de funcionários.
```

A separação segue um princípio: **o LLM entende a conversa, o código decide as regras.** O agent extrai fatos ("só eu", "tenho reunião às 14h") e chama ferramentas; prazo, prioridade, privacidade e duplicidade são calculados por código determinístico e testado. Isso deixa as decisões explicáveis, baratas (menos tokens) e consistentes.

### Serviço de chamados (`services/service-desk`)

Organizado em camadas: **rotas** (HTTP e validação) → **casos de uso** (regras) → **repositórios** (SQL).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/tickets?status=open\|closed\|all` | Chamados do funcionário, com prazo calculado |
| GET | `/tickets/similar?text=&category=` | Candidatos a duplicado (abertos) e a reabertura (resolvidos ≤ 7 dias) |
| GET | `/tickets/:id` · `/tickets/:id/events` | Detalhe e histórico |
| POST | `/tickets` | Abre chamado (recusa duplicado quase idêntico com `409 possible_duplicate`) |
| POST | `/tickets/:id/comments` | Complementa um chamado aberto |
| POST | `/tickets/:id/reopen` | Reabre (só até 7 dias após a resolução) |
| POST | `/tickets/:id/transfer` | Encaminha para N1/N2 com resumo do caso |
| POST | `/tickets/:id/status` | Muda status (só analista) |
| GET | `/kb/search?q=` · `/kb/articles/:id` | Central de ajuda |
| GET | `/employees/lookup?email=` · `/employees/:id` | Login e perfil |

Cabeçalhos: `x-api-key` (chave do serviço), `x-actor-id` (funcionário da sessão), `x-actor-via: agent` (ação feita pelo Nexo Assist em nome dele) e `Idempotency-Key` (em POSTs).

**Decisões:**

- **Privacidade no serviço, não no prompt.** Funcionário só enxerga os próprios chamados; o id vem da sessão, nunca do LLM. Chamado de outra pessoa responde `404` (não `403`), para não revelar que o número existe.
- **Legado instável de propósito.** Um middleware simula quedas de alguns segundos (`CHAOS_*` no `.env`). A falha acontece antes da escrita, então nunca deixa dado pela metade.
- **Retry seguro com idempotência.** O cliente repete GETs e POSTs que tenham `Idempotency-Key`. O serviço guarda a resposta por chave e funcionário, então repetir a criação após uma queda devolve o mesmo chamado em vez de duplicar.
- **Prazos em horas úteis** (seg–sex, 8h–18h, UTC-3), com "crítica" em tempo corrido por causa do plantão 24h. O prazo recomeça a cada atualização do suporte e pausa quando o chamado aguarda o funcionário.
- **SQLite (libSQL)**: um arquivo, nada para instalar, persiste entre reinícios. Para produção, o mesmo cliente fala com Turso/libSQL remoto.

### Dados de exemplo

| Funcionário | E-mail | Situação |
|---|---|---|
| Ana Souza | ana.souza@nexo.com.br | INC-20311 **vencido**, INC-20298 em andamento, REQ-10442 aprovado, INC-20150 resolvido há 4 dias (**reabrível**), dois antigos |
| Bruno Tavares | bruno.tavares@nexo.com.br | INC-20330: VPN erro 809 (testa que a Ana não vê o chamado dele) |
| Carla Mendes | carla.mendes@nexo.com.br | REQ-10460: acesso ao SAP para hoje |
| Diego Ramos | diego.ramos@nexo.com.br | INC-20325 aguardando resposta dele (prazo pausado) |
| Elisa Prado | elisa.prado@nexo.com.br | INC-20301 resolvido |
| Rafael Lima (N2) · Juliana Costa (N1) | rafael.lima@ · juliana.costa@nexo.com.br | Analistas |

Central de ajuda: 9 artigos (VPN erro 809, horário, senha da rede, senha do SAP, e-mail no celular, acesso a pastas, notebook lento, instalar programas, Wi-Fi).

## Trade-offs (até aqui)

- **Feriados não entram no cálculo de horas úteis.** Seria uma tabela de feriados no calendário; fica para depois.
- **Busca por sobreposição de termos**, não embeddings. Para 9 artigos e poucos chamados por pessoa, resolve, é instantânea e não custa nada. O agent ainda confirma com o funcionário antes de atualizar um chamado.
- **Fila do analista não está no serviço de chamados.** O estado da conversa (com o agent, aguardando atendente, com analista) pertence ao app do chat, não ao legado.

## Uso de IA

Desenvolvido com apoio de IA (Claude). Decisões de arquitetura e regras foram revisadas e cobertas por testes.
