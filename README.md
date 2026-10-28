# Nexo Assist

Agent de atendimento do service desk de TI da Nexo. O funcionário descreve o problema num chat; o agent consulta os chamados dele, busca na central de ajuda, prepara chamados para ele confirmar e chama um analista quando precisa. O analista acompanha tudo num console, com o motivo de cada decisão do agent.

- ✅ Serviço de chamados simulado ("sistema legado" instável de propósito), regras do Anexo A e cliente com retry
- ✅ Chat do funcionário (Telas 2 e 3): rascunho com confirmação, transferência, "por quê?" em cada resposta
- ✅ Agent com IA (Mastra + Gemini), com Groq como plano B e modo básico sem IA como reserva final
- ✅ Console do analista (Telas 4 e 5): fila com filtros, conversa com as decisões do agent, assumir, responder, devolver e encerrar
- ✅ Qualidade: 144 testes (Vitest), evals das decisões do agent contra a IA real e testes de ponta a ponta no navegador (Playwright)

## Como rodar

Pré-requisito: **Node.js 20.12+** (recomendado 22, ver `.nvmrc`).

```bash
npm install
cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env
npm run dev                   # sobe o service desk (porta 4010) e o app (porta 3000)
```

Abra http://localhost:3000 e entre com um e-mail dos dados de exemplo e **qualquer senha** (o desafio pede que a senha não seja verificada):

| Quem | E-mail | O que testar |
|---|---|---|
| Ana Souza (funcionária) | ana.souza@nexo.com.br | "Qual o status do meu chamado?" → INC-20311 vencido → "Falar com um analista" |
| Diego Ramos (funcionário) | diego.ramos@nexo.com.br | Chamado aguardando resposta dele (prazo pausado) |
| Rafael Lima (analista N2) | rafael.lima@nexo.com.br | Console: casos críticos e vencidos chegam no N2 |
| Juliana Costa (analista N1) | juliana.costa@nexo.com.br | Console: pedidos de analista e "agent sem segurança" chegam no N1 |

Sem chave de IA o app funciona no **modo básico** (regras, sem IA). Com uma chave gratuita do Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`) e/ou do Groq (`GROQ_API_KEY`) no `.env`, o agent com IA assume. Os bancos SQLite são criados na primeira execução e **sobrevivem a reinícios**.



### Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Service desk + app em modo desenvolvimento |
| `npm run build` e `npm start` | Build de produção do app e execução dos dois serviços |
| `npm test` | Testes unitários e de integração (Vitest), sem rede e sem chave de IA |
| `npm run test:e2e` | Testes de ponta a ponta no navegador (Playwright). Na primeira vez: `npx playwright install chromium` |
| `npm run evals` | Evals das decisões do agent contra o Gemini e o Groq de verdade (usa as chaves do `.env`) e dá uma nota |
| `npm run agent:smoke` | Conversa com o Gemini e o Groq de verdade e mostra cada decisão (inspeção manual) |
| `npm run agent:models` | Lista os modelos que as suas chaves do `.env` conseguem usar |
| `npm run typecheck` | Checagem de tipos estrita em todos os pacotes |
| `npm run format` | Formata o código (Prettier) |
| `npm run db:reset` | Recria o banco do service desk com os dados de exemplo |

## Arquitetura

```
apps/
  web/                  Next.js: login, chat do funcionário, console do analista, rotas /api.
    src/server/         Tudo que roda só no servidor:
      conversations/      estado e mensagens das conversas (banco do app)
      console/            fila e ações do analista
      agent/              quem responde: agent Mastra (llm/), plano B e modo básico (regras)
      drafts/             rascunhos de chamado aguardando confirmação
      auth/ · limits/     sessões · limites de uso
    evals/              casos com resultado esperado para as decisões do agent
packages/
  domain/               Regras puras e testadas: prazos em horas úteis, prioridade,
                        duplicidade, reabertura e a máquina de estados da conversa.
  service-desk-client/  Cliente HTTP tipado: timeout, retry com backoff, idempotência.
services/
  service-desk/         "Sistema legado" simulado (Hono + SQLite), separado do agent.
e2e/                    Testes no navegador (Playwright).
```

```
Navegador ──▶ apps/web (Next.js) ──▶ ConversationService ──▶ AgentResponder ──▶ cliente ──▶ service desk
  (chat e console)         │                │                (IA ou modo básico)
                           │                └── ConsoleService (fila, assumir, responder…)
                           └── banco do app (sessões, conversas, mensagens, rascunhos)
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
- Só o analista que assumiu pode responder, devolver ou encerrar. Dois analistas não assumem a mesma conversa: as mudanças de estado usam **controle de concorrência otimista** (`version`), e o segundo recebe "Outro analista já assumiu esta conversa".
- **Limite de 30 mensagens com o assistente** por sessão (as que gastam IA). Mensagens para o analista não contam: com a equipe, o contador fica pausado na tela ("12/30 com o assistente · pausado enquanto um analista atende") e volta a contar se a conversa voltar ao assistente. Ninguém precisa recomeçar a conversa no meio de um atendimento. Ao chegar a 30, o chat avisa; a mensagem seguinte vai para um analista (motivo "limite de mensagens da sessão"), sem travar. "Nova conversa" zera o contador.
- Ao voltar outro dia, o funcionário continua a conversa que estava aberta. Se o analista encerrar com o chat aberto, o funcionário vê o aviso e o botão para começar outra.

## Como o agent decide o que fazer

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

### Visibilidade das decisões

Toda resposta do agent guarda um registro (`trace`): o que entendeu, a intenção, as ações executadas (com detalhes), as **ferramentas chamadas, na ordem**, o grau de segurança, o motivo, quem respondeu, o tempo e os tokens. No chat, as ações aparecem acima da resposta e o link **"por quê?"** abre o registro completo. No console, o botão **Decisões** abre o registro de todas as respostas da conversa de uma vez. Falhas, trocas de provedor e tentativas extras do sistema legado também aparecem ali.

### Plano B e modo básico

`LLM_PROVIDER` e `LLM_FALLBACK_PROVIDER` no `.env` definem a ordem (padrão: Gemini → Groq). Se um provedor falha (cota, fora do ar, chave inválida, tempo esgotado, resposta malformada), o próximo assume e a troca aparece no "por quê?". Sem nenhuma chave, ou com os dois fora do ar, responde o **modo básico**: regras que consultam chamados, mostram prazos, buscam na central de ajuda, complementam chamados e transferem para um analista. Ele não abre chamados (sem IA, não dá para classificar com segurança).

O failover só vale se a falha for detectada. Por isso, **uma resposta sem decisão registrada nunca chega ao funcionário**: se o modelo escreve texto em vez de chamar `responder` e não dá para ler a decisão nesse texto, o turno é descartado (inclusive o rascunho que ele tenha montado). Erro de formato (essa resposta sem decisão, ou uma chamada a uma ferramenta que não existe, que o Groq recusa com 400) ganha **uma nova tentativa no mesmo provedor**, porque costuma ser sorteio; se repetir, o próximo da cadeia responde. Cota, queda e tempo esgotado vão direto para o próximo. Alguns modelos (o gpt-oss no Groq, por exemplo) às vezes escrevem a decisão como JSON ou como "chave: valor" no texto; o código lê os dois formatos e valida com o mesmo schema da ferramenta.

### Escolha do modelo

- **Gemini Flash-Lite (Google) como principal:** as IAs do Google se integram bem com outros serviços e têm plano gratuito; para um desafio, não há motivo para um plano pago. Também é bom em chamada de ferramentas e rápido (1 a 4 s por resposta nos testes).
- **Groq (`openai/gpt-oss-120b`) como reserva:** também gratuito, muito rápido e de outro fornecedor, então uma queda ou cota esgotada no Google não derruba o atendimento. Nos testes ele foi menos confiável na chamada de ferramentas; é um plano B de melhor esforço, protegido pela validação descrita acima.
- Os dois são trocáveis no `.env` sem mexer no código (`npm run agent:models` mostra o que a sua chave enxerga).

### Custo por conversa

- **Atalhos sem IA** para o que é inequívoco: pedir analista, confirmar/cancelar rascunho, escolher um chamado da lista e complementar no formato "INC-123: texto".
- **Contexto curto:** instruções enxutas (as regras estão no código), as últimas 14 mensagens e respostas de ferramentas compactas.
- **Limites:** até 8 passos por resposta, temperatura baixa, teto de tokens e tempo máximo por resposta.
- **Tokens registrados** em cada resposta (no "por quê?" e nos evals), para acompanhar o custo.

### Limites de uso

Para uma versão publicada não esgotar a cota gratuita de IA, há dois limites, ambos no `.env` (0 desliga):

- **`CHAT_RATE_LIMIT_PER_MINUTE` (padrão 10):** mensagens por minuto por funcionário **para o assistente**. Funciona como um balde de fichas: cabem 10 seguidas e uma ficha volta a cada 6 s, então quem passa espera no máximo alguns segundos ("Aguarde 6 segundos", HTTP 429 com `Retry-After`), não um minuto. Na conversa com analista (ou aguardando um), que não gasta IA, **não há limite por minuto**: o funcionário escreve no ritmo dele.
- **`AI_DAILY_CALL_LIMIT` (padrão 300):** respostas com IA por dia no app todo, contadas no banco (sobrevivem a reinícios; o dia vira no fuso de São Paulo). Quando acaba, **o chat não bloqueia**: passa para o modo básico e o "por quê?" mostra que a cota foi atingida. Atalhos por regras não gastam cota.

## Console do analista (Telas 4 e 5)

- **Fila** com os filtros **Todas**, **Para você** (aguardando o grupo do analista, N1 ou N2), **Com o agent** e **Minhas**. Cada conversa mostra o status ("Transferida", "Agent pediu ajuda · confiança 41%", "Com você", "Resolvida pelo agent"…), o resumo do agent e o prazo para responder (1 h no crítico, 2 h úteis no resto), que fica vermelho quando atrasa. Críticos vêm primeiro, depois o prazo mais curto.
- **Conversa** completa, com o **resumo da transferência** fixo no topo (motivo, grupo, confiança, chamado relacionado) e cada resposta do agent com o seu registro de decisão. Os cards de rascunho aparecem como o funcionário vê, sem os botões dele.
- **Ações:** **Assumir** (o agent pausa e o funcionário é avisado), **responder**, **Devolver ao agent** e **Encerrar**. Só quem assumiu responde; para os outros analistas, a conversa aparece como "Com Rafael Lima", sem ações.
- **Painel lateral** com o funcionário e os chamados dele no service desk (abertos primeiro, com prazo), destacando o chamado da transferência.
- **Atualização automática:** a fila a cada 5 s, a conversa aberta a cada 3 s e os chamados a cada 30 s. O título da aba mostra quantas conversas esperam o grupo do analista.
- Funciona no celular: fila e conversa em telas separadas, painel de chamados por cima.

## Serviço de chamados (`services/service-desk`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/tickets?status=open\|closed\|all` | Chamados do funcionário, com prazo calculado (o analista pode filtrar por `requesterId`) |
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

- **Privacidade no servidor, não no prompt.** O id do funcionário vem da sessão, nunca do LLM. O service desk responde `404` (e não `403`) para chamado de outra pessoa, para não revelar que o número existe. As rotas do console exigem o perfil de analista.
- **Sessões no banco.** O cookie é `httpOnly` e `SameSite=Lax`, e o banco guarda só o hash do token. Sem "manter conectado", a sessão termina ao fechar o navegador (e expira em 12 h). Rotas que mudam estado também conferem a origem da requisição (proteção contra CSRF).
- **Legado instável de propósito.** Quedas simuladas de alguns segundos (`CHAOS_*` no `.env`). O cliente repete com backoff e usa `Idempotency-Key` nas escritas, então uma criação repetida depois de uma queda não duplica o chamado.
- **Prazos em horas úteis** (seg–sex, 8h–18h, UTC-3); "crítica" corre 24 h por causa do plantão. O prazo recomeça a cada atualização do suporte e pausa quando o chamado aguarda o funcionário.
- **Dois bancos SQLite (libSQL)**, um por serviço, como seria com um sistema legado de verdade. SQLite é um banco embutido: o banco é um arquivo, aberto pela própria aplicação, sem servidor para instalar. Cada serviço cria o arquivo e as tabelas ao subir (`CREATE TABLE IF NOT EXISTS`, idempotente) e o service desk insere os dados de exemplo se estiver vazio. Em produção, o mesmo cliente fala com um libSQL remoto (Turso), só trocando a URL.
- **Fail fast de configuração.** Variáveis são validadas com zod na inicialização; em produção, o app se recusa a rodar com a chave de desenvolvimento.

## Qualidade

### Como garanti a qualidade das decisões do agent

Em três camadas, da mais barata para a mais cara:

1. **Regras em código, testadas.** O que pode ser calculado não depende do modelo: prioridade, prazo, duplicidade, reabertura, privacidade, confirmação e transferência obrigatória. Se o modelo errar, a regra corrige ou recusa.
2. **Testes do agent com um modelo roteirizado** (`apps/web/test/agent.test.ts`). O Mastra, as ferramentas e o service desk são os reais; só o "cérebro" é simulado. Cobrem o que o código faz com cada decisão possível do modelo, inclusive as ruins: resposta sem decisão, JSON no texto, erro do provedor no meio do turno.
3. **Evals contra a IA real** (`npm run evals`). Dez conversas com resultado esperado, tiradas do PRD e do Anexo A. Exemplos: "VPN no Windows 11" tem que passar pela central de ajuda antes do rascunho e gerar rascunho de prioridade alta, nunca um chamado direto; "notebook lento" tem que encontrar o INC-20311 e não tentar abrir outro; "vale-refeição" tem que dar fora de escopo e indicar o RH; o INC-20330 (de outro funcionário) não pode aparecer. Os critérios olham o comportamento (ferramentas chamadas, rascunho, transferência, cards), não o texto, que muda a cada execução. O script dá uma nota por provedor, mostra o que falhou e quanto custou (tempo e tokens), e grava o detalhe em `apps/web/evals/results/`. Quando o provedor recusa por limite por minuto (no plano gratuito do Gemini, 15 requisições), o caso espera a janela e é repetido, porque isso não é erro do agent. Um teste garante que os critérios aprovam o comportamento certo e reprovam o errado.

### Resultado dos evals (28/10/2026)

| Provedor | Nota | Casos perfeitos | Tempo e tokens por resposta | O que falhou |
|---|---|---|---|---|
| Gemini (`gemini-flash-lite-latest`), principal | **44/44 (100%)** | 10/10 | 3,0 s · 6,2 mil tokens | — |
| Groq (`openai/gpt-oss-120b`), plano B | 30/44 (68%) | 7/10 | 26 s · 5,2 mil tokens | 2 casos com chamada de ferramenta malformada mesmo após a nova tentativa e 1 tempo esgotado. Nos 7 em que respondeu, decidiu certo. |
| Groq (`qwen/qwen3.8-27b`), testado como alternativa | 14/44 (32%) | 3/10 | 18 s · 3,4 mil tokens | 8 respostas com erro. Pior que o gpt-oss: mantive o gpt-oss como plano B. |

Na primeira rodada o Gemini fez 91%: os evals mostraram que ele não consultava os chamados ao receber um problema (deixava passar o INC-20311 aberto). Uma linha nas instruções corrigiu, e a rodada seguinte confirmou. É para isso que os evals existem. No app, quando o Groq falha, o modo básico responde; ele é um plano B de melhor esforço.

### Testes

| O quê | Como |
|---|---|
| Regras do Anexo A | Testes unitários com relógio fixo (`packages/domain/test`) |
| Service desk | Testes da API real com banco temporário: privacidade, duplicidade, idempotência, reabertura, quedas |
| Conversas e console | Estados, limite de mensagens, transferência, assumir/responder/devolver/encerrar, concorrência entre analistas, fila (rótulos, filtros, ordem) |
| Limites de uso | Janela por minuto, cota diária com virada de dia e reinício, troca para o modo básico |
| Modo básico | Respostas contra o service desk real (sem rede), inclusive com o sistema fora do ar |
| Agent com IA | Modelo **simulado** com roteiro: fluxo da Tela 2, duplicidade, privacidade, baixa confiança, caso crítico, confirmação por texto, Gemini → Groq → modo básico, resposta sem decisão descartada |
| Evals | `npm run evals`: 10 casos com nota, contra o Gemini e o Groq |
| Navegador | `npm run test:e2e` (Playwright, build de produção): login e perfis, chat, "por quê?", privacidade, recarregar sem perder a conversa, transferência com duas pessoas ao mesmo tempo (funcionária e analista), dois analistas disputando a conversa, conversa com analista sem limite por minuto e com o contador pausado, celular sem rolagem horizontal |

Os testes de ponta a ponta rodam sem IA (modo básico), em portas próprias (3100 e 4110) e com bancos temporários, para darem o mesmo resultado em qualquer máquina. As decisões da IA ficam com os testes do agent e os evals.

## Trade-offs

- **Polling em vez de WebSocket/SSE.** O chat busca novidades a cada 3 s com analista na conversa e a cada 8 s com o agent; o console, a cada 3 a 5 s. É simples, funciona em qualquer hospedagem (inclusive serverless) e basta para o volume do desafio.
- **Streaming das ações, não do texto.** As ações do agent aparecem em tempo real; o texto final chega inteiro, porque vem da ferramenta `responder`, que também carrega a decisão. Isso evita um passo extra de IA só para registrar a decisão.
- **Descartar a resposta sem decisão** deixa o plano B mais conservador: às vezes o Groq tinha uma resposta razoável em texto livre e o funcionário recebe o modo básico. Preferi previsibilidade e o "por quê?" sempre preenchido.
- **Histórico no nosso banco, não na memória do Mastra.** Uma única fonte de verdade para o chat, o console e o agent, com controle do que vai para o modelo.
- **Busca e duplicidade por sobreposição de termos**, não embeddings. Para 9 artigos resolve, é instantânea e não custa nada; paráfrases muito diferentes podem escapar (o agent também consulta os chamados abertos antes de abrir).
- **Feriados não entram no cálculo de horas úteis.** Seria uma tabela de feriados no calendário.
- **Senha não é verificada** (pedido do desafio). O login confere só se o e-mail existe no diretório.
- **Limite por minuto em memória.** Basta para um processo; com várias instâncias, iria para o Redis. A cota diária já fica no banco.
- **Console sem atribuição automática.** O analista escolhe na fila; não há distribuição por carga nem fila por habilidade.
- **Evals com critérios de comportamento, não de texto.** Não medem tom nem clareza da mensagem; isso exigiria avaliação humana ou um LLM avaliador.

## O que faria com mais tempo

- **Eventos em tempo real** (SSE ou WebSocket, com Redis pub/sub para várias instâncias) no lugar do polling, e notificação no navegador quando chega uma transferência.
- **Evals no CI** com um orçamento de tokens, rodando a cada mudança de prompt ou de modelo, com histórico das notas e um LLM avaliador para o tom das respostas. Também casos gerados a partir de conversas reais anonimizadas.
- **Busca semântica** na central de ajuda e na detecção de duplicidade (embeddings no próprio libSQL, que tem busca vetorial).
- **Métricas do atendimento:** taxa de resolução pelo agent, tempo até um analista assumir, transferências por motivo, custo por conversa e satisfação ao encerrar.
- **Ações do analista no chamado** direto do console (mudar status, transferir de grupo, comentar), com o histórico de eventos do chamado no painel.
- **Atribuição automática** por grupo e carga, e alerta quando o prazo da transferência estiver para vencer.
- **Autenticação real** (SSO da empresa) e trilha de auditoria de quem viu cada conversa.
- **Tabela de feriados** no cálculo de prazo e **Redis** para o limite por minuto com várias instâncias.
- **Migrações versionadas** do banco. Hoje o esquema é criado ao subir (`CREATE TABLE IF NOT EXISTS`), o que basta enquanto as tabelas não mudam; para alterar uma tabela já existente (uma coluna nova), entraria uma tabela de versão do esquema e scripts numerados (ou uma ferramenta como Drizzle Kit).
- **Acessibilidade revisada** com leitor de tela em todo o fluxo e testes automáticos de contraste (axe) nos testes de ponta a ponta.

## Publicar

Os dois serviços rodam num único processo de deploy (`npm start` sobe o app na porta `PORT` da plataforma e o service desk em `localhost:4010`). Os bancos precisam persistir, então há dois caminhos:

**Gratuito: Render + Turso.** O plano gratuito do Render não tem disco persistente, mas o app fala libSQL, então os bancos podem ficar no Turso (plano gratuito, sem cartão). O `render.yaml` na raiz já descreve o serviço.

1. No Turso, crie dois bancos (por exemplo `nexo-app` e `nexo-service-desk`) e gere um token para cada um.
2. No Render, **New → Blueprint** apontando para o repositório. Preencha `APP_DATABASE_URL` / `APP_DATABASE_AUTH_TOKEN`, `SERVICE_DESK_DATABASE_URL` / `SERVICE_DESK_DATABASE_AUTH_TOKEN` (URLs `libsql://….turso.io`) e as chaves de IA. A `SERVICE_DESK_API_KEY` é gerada pelo Render.
3. O serviço gratuito dorme após 15 minutos sem acesso e leva cerca de 1 minuto para acordar no primeiro acesso.

**Com disco (Railway ou Fly.io).** Mantém o SQLite em arquivo: monte um volume e aponte `APP_DATABASE_URL=file:/data/app.db` e `SERVICE_DESK_DATABASE_URL=file:/data/service-desk.db` para ele. Não há plano gratuito permanente (o Railway dá um crédito de teste).

Em qualquer caso: defina uma `SERVICE_DESK_API_KEY` própria (o app se recusa a rodar em produção com a de desenvolvimento), mantenha os limites de uso ligados e coloque as chaves de IA só nas variáveis da plataforma.

## Uso de IA

Desenvolvido com apoio de IA (Claude). Decisões de arquitetura e regras foram revisadas e cobertas por testes.
