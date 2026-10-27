# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat; o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados e chama um analista quando precisa.

> **Status:** em construção.
>
> - ✅ Serviço de chamados simulado, regras do service desk e cliente com retry
> - ✅ App web: login, chat do funcionário, estados da conversa, transferência, modo básico (sem IA)
> - ⏳ Agent com IA (Mastra + Gemini, com Groq como plano B)
> - ⏳ Console do analista (Telas 4 e 5)

## Como rodar

Pré-requisito: **Node.js 20.12+** (recomendado 22, ver `.nvmrc`).

```bash
npm install
cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env
npm run dev                   # sobe o service desk (porta 4010) e o app (porta 3000)
```

Abra http://localhost:3000 e entre com um e-mail dos dados de exemplo e **qualquer senha**:

| Quem | E-mail | O que testar |
|---|---|---|
| Ana Souza (funcionária) | ana.souza@nexo.com.br | "Qual o status do meu chamado?" → INC-20311 vencido → "Falar com um analista" |
| Diego Ramos (funcionário) | diego.ramos@nexo.com.br | Chamado aguardando resposta dele (prazo pausado) |
| Rafael Lima (analista N2) | rafael.lima@nexo.com.br | Console do analista (em construção) |

Os bancos SQLite são criados na primeira execução e **sobrevivem a reinícios**.

| Comando | O que faz |
|---|---|
| `npm run dev` | Service desk + app em modo desenvolvimento |
| `npm run build` e `npm start` | Build de produção do app e execução dos dois serviços |
| `npm test` | Todos os testes (Vitest) |
| `npm run typecheck` | Checagem de tipos estrita em todos os pacotes |
| `npm run format` | Formata o código (Prettier) |
| `npm run db:reset` | Recria o banco do service desk com os dados de exemplo |

## Arquitetura

```
apps/
  web/                  Next.js: login, chat do funcionário, (console do analista), rotas /api.
    src/server/         Tudo que roda só no servidor:
      conversations/      estado e mensagens das conversas (banco do app)
      agent/              quem responde: modo básico hoje, agent com IA na próxima etapa
      auth/               sessões
packages/
  domain/               Regras puras e testadas: prazos em horas úteis, prioridade,
                        duplicidade, reabertura e a máquina de estados da conversa.
  service-desk-client/  Cliente HTTP tipado: timeout, retry com backoff, idempotência.
services/
  service-desk/         "Sistema legado" simulado (Hono + SQLite), separado do agent.
```

```
Navegador ──▶ apps/web (Next.js) ──▶ ConversationService ──▶ AgentResponder ──▶ cliente ──▶ service desk
                    │                        │                (IA ou modo básico)
                    └── banco do app ◀───────┘ (sessões, conversas, mensagens)
```

Princípio: **o LLM entende a conversa; o código decide as regras.** Prazo, prioridade, privacidade, duplicidade e estados da conversa são código determinístico e testado. Isso deixa as decisões explicáveis, consistentes e baratas.

### Estados da conversa

```
agent ──transferir──▶ aguardando atendente ──assumir──▶ com analista
  ▲                         │                              │
  └──────── devolver ───────┴────────── devolver ──────────┘
qualquer estado aberto ──encerrar──▶ encerrada
```

- Enquanto a conversa está **aguardando** ou **com um analista**, o agent não responde. As mensagens do funcionário ficam registradas para o atendimento.
- Só o analista que assumiu pode responder, devolver ou encerrar. Dois analistas não assumem a mesma conversa: as mudanças de estado usam **controle de concorrência otimista** (`version`).
- **Limite de 30 mensagens** do funcionário por sessão. "Nova conversa" encerra a atual e começa outra.
- Ao voltar outro dia, o funcionário continua a conversa que estava aberta.

### Quem responde: agent com IA, plano B e modo básico

O chat fala com uma interface (`AgentResponder`), não com um modelo específico. A ordem planejada é:

1. **Gemini** (Google, plano gratuito), o provedor principal;
2. **Groq** (plano gratuito), se o principal falhar ou estourar a cota;
3. **Modo básico** (regras, sem IA), se nenhum provedor estiver disponível.

O modo básico já funciona: consulta e mostra chamados com o prazo calculado, busca na central de ajuda, complementa chamados ("INC-20311: nova informação"), redireciona assuntos fora de TI e transfere para um analista com resumo do caso. Ele **não abre chamados** por conversa: sem IA, não dá para classificar com segurança, então encaminha a um analista.

Se quem responde falhar, o chat não quebra: o funcionário recebe uma resposta honesta com a opção de falar com um analista.

### Visibilidade das decisões

Toda resposta do agent guarda um registro (`trace`): o que entendeu, a intenção, as ações executadas (com detalhes), o grau de segurança, o motivo e quem respondeu. No chat, as ações aparecem acima da resposta ("consultou seus chamados · calculou o prazo") e o link **"por quê?"** abre o registro completo. Falhas e tentativas extras do sistema legado também aparecem ali.

### Serviço de chamados (`services/service-desk`)

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

## Decisões

- **Privacidade no servidor, não no prompt.** O id do funcionário vem da sessão, nunca do LLM. O service desk responde `404` (e não `403`) para chamado de outra pessoa, para não revelar que o número existe.
- **Sessões no banco.** O cookie é `httpOnly` e `SameSite=Lax`, e o banco guarda só o hash do token. Sem "manter conectado", a sessão termina ao fechar o navegador (e expira em 12 h). Rotas que mudam estado também conferem a origem da requisição (proteção contra CSRF).
- **Legado instável de propósito.** Quedas simuladas de alguns segundos (`CHAOS_*` no `.env`). O cliente repete com backoff e usa `Idempotency-Key` nas escritas, então uma criação repetida depois de uma queda não duplica o chamado.
- **Prazos em horas úteis** (seg–sex, 8h–18h, UTC-3); "crítica" corre 24 h por causa do plantão. O prazo recomeça a cada atualização do suporte e pausa quando o chamado aguarda o funcionário.
- **Dois bancos SQLite (libSQL)**, um por serviço, como seria com um sistema legado de verdade. Nada para instalar; para produção, o mesmo cliente fala com Turso/libSQL remoto.
- **Fail fast de configuração.** Variáveis são validadas com zod na inicialização; em produção, o app se recusa a rodar com a chave de desenvolvimento.

## Qualidade

| O quê | Como |
|---|---|
| Regras do Anexo A | Testes unitários com relógio fixo (`packages/domain/test`) |
| Service desk | Testes da API real com banco temporário: privacidade, duplicidade, idempotência, reabertura, quedas |
| Conversas | Estados, limite de mensagens, transferência, concorrência entre analistas (`apps/web/test`) |
| Modo básico | Respostas contra o service desk real (sem rede), inclusive com o sistema fora do ar |
| Interface | Navegação real no navegador (login, consulta, "por quê?", transferência, celular) durante o desenvolvimento |

## Trade-offs (até aqui)

- **Polling em vez de WebSocket/SSE** para mensagens do analista: a cada 3 s com analista na conversa e 15 s no resto. É simples, funciona em qualquer hospedagem e basta para o volume do desafio.
- **Feriados não entram no cálculo de horas úteis.** Seria uma tabela de feriados no calendário.
- **Busca por sobreposição de termos**, não embeddings. Para 9 artigos resolve, é instantânea e não custa nada.
- **Senha não é verificada** (pedido do desafio). O login confere só se o e-mail existe no diretório.

## Uso de IA

Desenvolvido com apoio de IA (Claude). Decisões de arquitetura e regras foram revisadas e cobertas por testes.
