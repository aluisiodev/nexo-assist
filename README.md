# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat; o agent consulta os chamados dele, busca na central de ajuda, abre ou atualiza chamados e chama um analista quando precisa.

> **Status:** em construção.
>
> - ✅ Serviço de chamados simulado, regras do service desk e cliente com retry
> - ✅ App web: login, chat do funcionário, estados da conversa, transferência
> - ✅ Agent com IA (Mastra + Gemini, com Groq como plano B e modo básico sem IA como reserva final)
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
| `npm test` | Todos os testes (Vitest), sem rede e sem chave de IA |
| `npm run agent:models` | Lista os modelos que as suas chaves do `.env` conseguem usar |
| `npm run agent:smoke` | Conversa com o Gemini e o Groq de verdade (usa as chaves do `.env`) e mostra as decisões |
| `npm run typecheck` | Checagem de tipos estrita em todos os pacotes |
| `npm run format` | Formata o código (Prettier) |
| `npm run db:reset` | Recria o banco do service desk com os dados de exemplo |

## Arquitetura

```
apps/
  web/                  Next.js: login, chat do funcionário, (console do analista), rotas /api.
    src/server/         Tudo que roda só no servidor:
      conversations/      estado e mensagens das conversas (banco do app)
      agent/              quem responde: agent Mastra (llm/), plano B e modo básico (regras)
      drafts/             rascunhos de chamado aguardando confirmação
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

### Como o agent decide o que fazer

O agent é um `Agent` do **Mastra** com 7 ferramentas. O modelo escolhe quais usar; as ferramentas aplicam as regras do Anexo A em código:

| Ferramenta | O que faz | Regra aplicada no código |
|---|---|---|
| `consultar_chamados` / `consultar_chamado` | Chamados do funcionário, com prazo | Privacidade: o id vem da sessão; chamado alheio = "não encontrado" |
| `buscar_central_ajuda` | Artigos relevantes | — |
| `preparar_rascunho_chamado` | Monta o **rascunho** de um chamado novo | Prioridade e prazo calculados pelo código a partir de fatos (impacto, impede o trabalho, alternativa, compromisso hoje); **recusa duplicado** de chamado aberto e sugere reabrir resolvido ≤ 7 dias |
| `preparar_atualizacao_chamado` | Rascunho para complementar ou reabrir | Só complementa aberto; só reabre resolvido há até 7 dias |
| `transferir_para_analista` | Transfere com resumo do caso | Grupo N2 para crítico/vencido, N1 para o resto |
| `responder` | Resposta final + registro da decisão | Cards montados só com dados que as ferramentas devolveram |

Fluxo de uma mensagem:

```
mensagem ─▶ atalhos sem IA? ──sim──▶ regras (pedido de analista, "sim, pode abrir", seleção de chamado)
                 │não
                 ▼
         Gemini ──falhou──▶ Groq ──falhou──▶ modo básico (regras)
                 │
                 ▼
   ferramentas (regras do Anexo A) ─▶ responder ─▶ regras pós-resposta ─▶ chat
```

**O agent nunca cria nem altera um chamado.** Ele só monta rascunhos; quem grava no service desk é o código, quando o funcionário clica em **Confirmar** (ou responde "sim, pode abrir"), usando o número do rascunho como chave de idempotência: clique duplo ou retry após queda nunca duplica.

Regras aplicadas depois da resposta, mesmo que o modelo esqueça:

- chamado mostrado com **prazo vencido** → oferece "Falar com um analista";
- **confiança abaixo de 35%** sem outra ação → transfere para um analista (motivo "agent sem segurança");
- chamado **crítico** confirmado → transfere direto para o N2.

### Plano B e modo básico

`LLM_PROVIDER` e `LLM_FALLBACK_PROVIDER` no `.env` definem a ordem (padrão: Gemini → Groq). Se um provedor falha (cota, fora do ar, chave inválida, tempo esgotado), o próximo assume e a troca aparece no "por quê?". Sem nenhuma chave, ou com os dois fora do ar, responde o **modo básico**: regras que consultam chamados, mostram prazos, buscam na central de ajuda, complementam chamados e transferem para um analista. Ele não abre chamados (sem IA, não dá para classificar com segurança).

### Escolha do modelo

- **Gemini Flash-Lite (Google) como principal:** plano gratuito, bom em chamada de ferramentas e rápido. Para um desafio, não há motivo para um plano pago.
- **Groq (`openai/gpt-oss-120b`) como reserva:** também gratuito, muito rápido e de outro fornecedor, então uma queda ou cota esgotada no Google não derruba o atendimento.
- Os dois são trocáveis no `.env` sem mexer no código.

### Custo por conversa

- **Atalhos sem IA** para o que é inequívoco: pedir analista, confirmar/cancelar rascunho, escolher um chamado da lista e complementar no formato "INC-123: texto".
- **Contexto curto:** instruções enxutas (as regras estão no código), as últimas 14 mensagens e respostas de ferramentas compactas.
- **Limites:** até 8 passos por resposta, temperatura baixa, teto de tokens e tempo máximo por resposta.
- **Tokens registrados** em cada resposta (visíveis no registro), para acompanhar o custo.

### Limites de uso

Para uma versão publicada não esgotar a cota gratuita de IA (e nem a paciência de ninguém), há dois limites, ambos no `.env` (0 desliga):

- **`CHAT_RATE_LIMIT_PER_MINUTE` (padrão 10):** mensagens por minuto por funcionário. Uso normal nunca chega nele; quem passa vê "Aguarde N segundos" (HTTP 429 com `Retry-After`).
- **`AI_DAILY_CALL_LIMIT` (padrão 300):** respostas com IA por dia no app todo, contadas no banco (sobrevivem a reinícios; o dia vira no fuso de São Paulo). Quando acaba, **o chat não bloqueia**: passa para o modo básico e o "por quê?" mostra que a cota foi atingida. Atalhos por regras não gastam cota.

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
| Limites de uso | Janela por minuto, cota diária com virada de dia e reinício, troca para o modo básico |
| Modo básico | Respostas contra o service desk real (sem rede), inclusive com o sistema fora do ar |
| Agent com IA | Modelo **simulado** com roteiro (Mastra, ferramentas e service desk reais): fluxo da Tela 2, duplicidade, privacidade, baixa confiança, caso crítico, confirmação por texto, Gemini → Groq → modo básico |
| IA real | `npm run agent:smoke`: cenários do PRD contra o Gemini e o Groq, com as decisões impressas |
| Interface | Navegação real no navegador (login, consulta, "por quê?", transferência, celular) durante o desenvolvimento |

## Trade-offs (até aqui)

- **Polling em vez de WebSocket/SSE** para mensagens do analista: a cada 3 s com analista na conversa e 15 s no resto. É simples, funciona em qualquer hospedagem e basta para o volume do desafio.
- **Feriados não entram no cálculo de horas úteis.** Seria uma tabela de feriados no calendário.
- **Busca por sobreposição de termos**, não embeddings. Para 9 artigos resolve, é instantânea e não custa nada.
- **Senha não é verificada** (pedido do desafio). O login confere só se o e-mail existe no diretório.
- **Histórico no nosso banco, não na memória do Mastra.** Uma única fonte de verdade para o chat, o console e o agent, com controle do que vai para o modelo.
- **Streaming das ações, não do texto.** As ações do agent aparecem em tempo real enquanto ele trabalha; o texto final chega inteiro, porque vem da ferramenta `responder` (que também carrega a decisão). Isso evita um passo extra de IA só para registrar a decisão.
- **Limite por minuto em memória.** Basta para um processo; com várias instâncias, iria para o Redis. A cota diária já fica no banco.
- **Similaridade por termos para duplicidade.** Paráfrases muito diferentes podem escapar; o agent também consulta os chamados abertos antes de abrir.

## Uso de IA

Desenvolvido com apoio de IA (Claude). Decisões de arquitetura e regras foram revisadas e cobertas por testes.
