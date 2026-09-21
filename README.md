# Fechamento de Projetos — Integração Omie

Sistema web de custeio e fechamento por projeto. Conecta nas contas Omie das empresas do grupo (multiempresa), busca **Contas a Receber**, **Contas a Pagar**, **Projetos**, **Clientes**, **Vendedores**, **Pedidos de Compra** e **NF-e emitidas**, consolida tudo por número de projeto (ex.: `BR26_055`) e apura o resultado de cada um — sem ninguém digitar valor em planilha:

```
Receita − Produção − Frete − Comissão − Impostos − Outros = Resultado
Margem % = Resultado ÷ Receita
```

A integração é **100% leitura**: o app só usa métodos `Listar*` da Omie — nunca grava, altera ou cancela nada lá (há teste automatizado garantindo isso: `tests/test_somente_leitura.py`). A Omie continua sendo a fonte da verdade; o app é a lente que organiza.

---

## Mapa das telas

### 📊 Visão geral (Dashboard)
O pulso do período: **resultado consolidado** com margem e sparkline, conferência do período (quantos projetos têm os dois ok), KPIs de receita/custos/impostos com comparação contra o período anterior, **central de alertas** ("Precisa de atenção"), gráfico de **evolução mensal** interativo (zoom e arrastar), comparativo **ano contra ano** (cada mês contra o mesmo mês do ano anterior), composição "para onde foi cada real" e ranking de margem dos maiores projetos. No celular mostra só o essencial — herói, três números, alertas e o ano a ano.

### 📁 Projetos
A lista completa do fechamento: uma linha por projeto com receita, custos, impostos, resultado, margem (semáforo pela meta configurada) e o status da conferência (`1/2`, `2/2`). Busca por projeto/cliente, filtros por situação da conferência, **ok em massa** (marque vários e aprove de uma vez) e exportação em **PDF** (A4 paisagem com a marca), **Excel** (formatado pt-BR, aba Resumo) e **CSV** — os três levam quem conferiu e quando.

### 🔍 Detalhe do projeto
O cálculo aberto na mesa: cabeçalho com resultado/margem/selo de lucro ou prejuízo, a fórmula linha a linha, **tributação por perfil de operação** (venda padrão paga a tabela cheia; fins de exportação sem PIS/COFINS/ICMS — escolhida por projeto), **resultado projetado × realizado** (digite o que a proposta prometia; o app compara e avisa quando render menos) e as abas: Recebimentos, Pagamentos, Notas fiscais, **Ajustes** (mover/reclassificar/excluir lançamento, sempre com motivo e autor) e Comentários. É aqui que se dão os dois ok da dupla conferência.

### 📈 Análises (cinco abas)
- **Clientes ABC** — curva ABC por receita, com resultado, margem e projetos no prejuízo por cliente.
- **Vendedores** — ranking por receita vendida com o resultado atribuído.
- **Comissões** — títulos efetivamente **recebidos** no período por vendedor; o % de comissão é editável na própria tabela (clique no número) e o app calcula o valor a pagar.
- **Caixa** — a receber/a pagar em aberto e atrasado por projeto, mais o **fluxo de caixa por mês de vencimento**: barras de entrada e saída (parte translúcida = ainda em aberto) com saldo acumulado, inclusive meses futuros; filtrável por projeto.
- **Sem projeto** — o dinheiro que o fechamento NÃO enxerga: títulos e NF-e lançados na Omie sem projeto, com totais e a lista dos maiores. É o guardião da qualidade dos números.

### 🛒 Compras
Pedidos de compra da Omie: comprometido nos próximos 30 dias (saída que ainda não virou conta a pagar), vencido, crédito de impostos (ICMS+PIS+COFINS) e a lista por situação.

### 🧮 Simulador
Antes de fechar um pedido: dado o custo estimado e a margem desejada, qual o preço mínimo — usando o **imposto real de cada empresa** (a % efetiva observada no Presumido; a alíquota do cadastro no Simples) e por qual empresa vale mais a pena faturar.

### 💰 Precificação e Orçamentos (módulo comercial)
Calculadora de orçamento com produtos, acabamentos, tabelas de preço e alíquotas por local — o preço sai com o imposto certo sem digitar alíquota. Cada orçamento vira um registro **imutável** (snapshot congelado do cálculo), com numeração automática, PDF de proposta com a marca, status rascunho→enviado→aprovado, resumo de faturamento e exportação. Orçamento aprovado pode ser **vinculado ao projeto Omie** que nasceu dele — a tabela **Previsto × Realizado** compara a margem prometida com a margem que o fechamento apurou (desvio em verde/vermelho): é o comercial prestando contas ao financeiro.

### 🔄 Buscar dados
Sincronização com a Omie: escolha empresas e período e o app pagina tudo (100 registros/página, com throttle, retry/backoff e tratamento do bloqueio HTTP 425), sem duplicar nada — pode rodar quantas vezes quiser. Tabela de progresso por recurso com status ao vivo. Há também a **busca automática diária** (ligada em Preferências).

### 🏢 Empresas
O centro de administração:
- **Cadastro das empresas** com as chaves Omie (criptografadas em repouso; trocar a chave limpa automaticamente o cache da conta antiga) e a tributação de cada uma — regime, alíquota do Simples ou **tabela itemizada** do Presumido (PIS, COFINS, ICMS, CSLL, IRPJ…), fonte do imposto (nota fiscal ou alíquota) e **perfis de tributação por operação**.
- **Classificar custos** — cada categoria do Contas a Pagar vira Produção, Frete, Comissão, Imposto ou Outros (nomes de tributo já vêm sugeridos).
- **Equipe** — usuários, papéis e quem pode dar o 2º ok.
- **Preferências** — meta de margem (semáforo), busca automática diária, **relatório mensal por e-mail** (o fechamento do mês anterior em PDF, no dia escolhido) e **backup automático mensal**.
- **Backup do trabalho da equipe** — exporta/restaura em JSON tudo que uma sincronização não traz de volta: usuários, empresas, categorias classificadas, ajustes, aprovações, orçamentos, comentários. A restauração nunca sobrescreve trabalho humano — e sabe diferenciar classificação feita por gente de sugestão automática.

### ❓ Como usar + 💬 Suporte
Guia passo a passo para quem não conhece o sistema (imprimível) e **chat de suporte dentro do app**: o cliente escreve, quem atende recebe aviso por WhatsApp/e-mail, responde pelo próprio app — e o cliente recebe a resposta por e-mail, sem precisar ficar com o app aberto.

### 📱 No celular
O app é instalável como PWA (Android: "Instalar app"; iPhone: Compartilhar → Adicionar à Tela de Início) e as telas têm hierarquia própria em tela pequena — menos caixas, só o essencial, chat como folha de baixo.

---

## O que acontece sozinho (avisos e rotinas)

| Rotina | Quando | Por onde |
|---|---|---|
| Busca automática dos dados da Omie | todo dia, na hora configurada | — |
| **Sincronização que falha** avisa na hora (empresa, recurso, motivo) | sempre | WhatsApp + e-mail |
| Mensagem nova no suporte | sempre | WhatsApp + e-mail (para quem atende) |
| Resposta do suporte | sempre | e-mail (para o cliente) |
| **Relatório mensal** — fechamento do mês anterior em PDF | dia configurado | e-mail (lista de destinatários) |
| **Backup mensal** — JSON completo do trabalho da equipe | dia configurado | e-mail (somente para o suporte, por conter credenciais) |

Central de alertas no Dashboard: projetos no prejuízo, abaixo da meta de margem, **despesa sem nenhuma receita** (custo lançado num projeto que não faturou — receita por vir ou lançamento errado), rendendo menos que o projetado, e caixa atrasado.

---

## Papéis e segurança

- **Login obrigatório** (senha com scrypt, sessões revogáveis no banco, freio de força bruta). No primeiro acesso o app pede a criação da conta da administradora. Cada pessoa troca a própria senha clicando no próprio nome.
- Papéis: `admin` (tudo + usuários) · `financeiro` (opera custeio e precificação) · `comercial` (só precificação e orçamentos) · `leitura` (consulta e simulador; o servidor bloqueia qualquer escrita).
- **Dupla conferência**: projeto só fecha com dois ok de pessoas diferentes; o 2º é de quem for marcado como aprovador. Se um ajuste mudar o número depois do ok, o projeto exibe "mudou depois do ok" sem perder o histórico.
- Credenciais Omie criptografadas em repouso (Fernet); o frontend **nunca** fala com a Omie, só com o backend; chaves não aparecem em logs nem em respostas.
- Toda ação auditável (ajustes, classificações, ok, comentários, % de comissão) é assinada com a conta logada.

## Marca configurável

O logotipo, o título e os PDFs leem a marca de `MARCA_LINHA1`/`MARCA_LINHA2` no ambiente — o mesmo código serve outras empresas sem tocar em uma linha.

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2 · httpx · fpdf2 · openpyxl |
| Banco | PostgreSQL (produção) ou SQLite (padrão, zero configuração) |
| Frontend | React 18 · Vite · TypeScript · TanStack Query · Tailwind |
| Infra | Render (Blueprint `render.yaml`: API + site estático + Postgres) |

## Como rodar localmente

### 1. Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Linux/Mac: .venv/bin/pip
copy .env.example .env                           # ajuste se quiser Postgres
.venv\Scripts\python -m uvicorn app.main:app --port 8000 --reload
```

Sem configurar nada, usa **SQLite** em `backend/custeio.db` (tabelas criadas e reparadas automaticamente na subida — em produção também: não há passo manual de migração). API em `http://localhost:8000` (docs em `/docs`).

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173` (o Vite faz proxy de `/api` para a porta 8000).

### 3. Testes

```powershell
cd backend
.venv\Scripts\python -m pytest
```

Cobrem o cliente Omie (paginação, faultstring, retry/backoff, HTTP 425), o motor de fechamento (agrupamento, rateio, não-duplicação de tributos, margem, período), impostos por regime e por perfil, ajustes auditáveis, dupla conferência, backup/restauração, fluxo de caixa, comissões, lançamentos sem projeto, orçamentos comerciais e o bloqueio de escrita do papel leitura.

## Variáveis de ambiente

| Variável | O que é | Padrão |
|---|---|---|
| `DATABASE_URL` | conexão SQLAlchemy (`postgres://` é normalizado p/ `psycopg`) | SQLite local |
| `APP_ENCRYPTION_KEY` | chave que criptografa as credenciais Omie — **obrigatória em produção**; guarde uma cópia | gerada em `.secret_key` (dev) |
| `CORS_ORIGINS` | origens do frontend | `http://localhost:5173` |
| `MARCA_LINHA1` / `MARCA_LINHA2` | as duas linhas do logotipo (app + PDFs) | `GRUPO` / `JPDV` |
| `SUPORTE_EMAIL` | e-mail de quem atende o suporte (identifica a conta e recebe o backup) | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_DE` | envio de e-mail (avisos, relatório, backup) — Gmail com senha de app funciona | — |
| `CALLMEBOT_TELEFONE` / `CALLMEBOT_APIKEY` | aviso por WhatsApp (callmebot.com, gratuito) | — |
| `APP_URL` | URL pública do app (vira link nos avisos) | — |
| `OMIE_BASE_URL` / `OMIE_MIN_INTERVAL` | base e throttle da API Omie | oficial / `0.35s` |

Tudo que é de aviso é **opcional**: sem configurar, o app funciona normalmente — os avisos simplesmente não disparam.

## Deploy no Render

O repositório tem um **Blueprint** ([render.yaml](render.yaml)) que cria os 3 recursos de uma vez: API, site estático (com proxy `/api`) e Postgres.

1. **New + → Blueprint** no [dashboard do Render](https://dashboard.render.com) → conecte este repositório → Apply.
2. **Confira as URLs**: o domínio `.onrender.com` é global — se os nomes já estiverem em uso, o Render sufixará as URLs; ajuste então o `destination` do rewrite `/api/*` e o `CORS_ORIGINS` no `render.yaml`.
3. Cadastre as empresas com as credenciais Omie **pela tela** (ficam criptografadas no Postgres — nunca no repositório).

**Planos:** o único plano pago **necessário** é o do banco — `basic-256mb` (~US$ 6/mês) — porque o Postgres free **expira em 30 dias** e apaga os dados. O web service pode ficar no plano free: a consequência é só a hibernação após 15 min sem uso (o 1º acesso do dia leva ~1 min, e o app avisa o usuário na tela de login). Upgrade **opcional** de conforto: `starter` na API (~US$ 7/mês) elimina a hibernação — o app abre na hora, sempre. Os `plan:` se trocam no `render.yaml`, que é quem manda na infraestrutura.

## Limites da Omie respeitados

- Máx. **100 registros/página** — o cliente itera até `total_de_paginas`.
- ~240 req/min por método — throttle configurável (`OMIE_MIN_INTERVAL`).
- Erros de negócio (`faultstring`) não são retentados; instabilidade (5xx/timeout) tem backoff exponencial; **HTTP 425** (bloqueio de 30 min) falha com mensagem clara.
- "Não existem registros" é tratado como resultado vazio, não como erro.
- Impostos da NF-e: `ListarNF` (`produtos/nfconsultar`) com `cDetalhesPedido: "S"`; o app soma `vICMS + vST + vFCP + vFCPST + vIPI + vPIS + vCOFINS` das notas de saída não canceladas; o projeto vem de `pedido.nIdProjeto` ou `titulos[].nCodProjeto`.
