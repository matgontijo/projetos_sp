# Fechamento de Projetos — Integração Omie

Aplicativo web de custeio: conecta nas contas Omie das suas empresas (multiempresa), busca **Contas a Receber**, **Contas a Pagar**, **Projetos**, **Clientes** e **NF-e emitidas**, agrupa tudo por número de projeto (ex.: `BR26_055`) e apura o resultado de cada um:

```
Receita − Produção − Frete − Impostos (− Outros) = Resultado
Margem % = Resultado ÷ Receita
```

- **Mesmo projeto em várias empresas**: se o projeto é faturado por mais de um CNPJ (ex.: uma empresa no Lucro Presumido e outra no Simples), o app **consolida pela numeração do projeto** — uma linha só, somando as duas empresas, com o imposto certo de cada lado (NF-e no Presumido, alíquota efetiva no Simples). O filtro de empresa mostra a parcela de cada uma.
- **Impostos automáticos**: lidos dos tributos destacados nas NF-e (ICMS, ICMS-ST, FCP, IPI, PIS, COFINS — e IBS/CBS quando a Omie passar a retorná-los). Ninguém digita alíquota.
- **Simples Nacional**: por empresa, dá para ligar o modo Simples (alíquota efetiva derivada do RBT12, por competência). Desligado por padrão.
- **Tributos em Contas a Pagar** (gerados pela Omie): classificados como grupo "Imposto" — aparecem no detalhe mas **não somam no custo**, para não duplicar com a NF-e.
- **Ajustes manuais auditáveis**: reclassificar um custo, corrigir um imposto, mover ou excluir um lançamento — sempre registrando quem, quando e por quê. O cache nunca é alterado.
- **Exportação** do fechamento em CSV e Excel (pt-BR).

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Python 3.11+ · FastAPI · SQLAlchemy 2 · Alembic · httpx |
| Banco | PostgreSQL (produção) ou SQLite (padrão, zero configuração) |
| Frontend | React 18 · Vite · TypeScript · TanStack Query · Recharts · Tailwind |
| Segurança | Credenciais Omie criptografadas em repouso (Fernet); chaves só no servidor |

O frontend **nunca** fala com a Omie — só com o backend. `app_key`/`app_secret` não aparecem em logs nem em respostas da API.

## Onde obter app_key / app_secret

1. Acesse o **Portal do Desenvolvedor da Omie**: <https://developer.omie.com.br/>
2. Entre com a conta da empresa (cada CNPJ/conta Omie tem o seu par de chaves).
3. Em **Minhas Aplicações / Chaves de Acesso**, gere ou copie o `app_key` e o `app_secret`.
4. Cadastre esses valores na tela **Empresas** do app (botão "Testar conexão" valida na hora).

## Como rodar

### 1. Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt   # Linux/Mac: .venv/bin/pip
copy .env.example .env                           # ajuste se quiser Postgres
.venv\Scripts\python -m uvicorn app.main:app --port 8000 --reload
```

Sem configurar nada, usa **SQLite** em `backend/custeio.db` (as tabelas são criadas na primeira subida). API em `http://localhost:8000` (docs interativas em `/docs`).

### 2. Frontend

```powershell
cd frontend
npm install
npm run dev
```

Abra `http://localhost:5173` (o Vite faz proxy de `/api` para o backend na porta 8000).

### 3. PostgreSQL (opcional, recomendado em produção)

```powershell
docker compose up -d db
```

E no `backend/.env`:

```
DATABASE_URL=postgresql+psycopg://custeio:custeio@localhost:5432/custeio
```

Migrações (alternativa ao create-all automático): `.venv\Scripts\python -m alembic upgrade head`.

## Variáveis de ambiente (`backend/.env.example`)

| Variável | O que é | Padrão |
|---|---|---|
| `DATABASE_URL` | conexão SQLAlchemy | SQLite local |
| `APP_ENCRYPTION_KEY` | chave Fernet p/ criptografar credenciais (obrigatória em produção — gere com `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) | gerada em `.secret_key` (dev) |
| `CORS_ORIGINS` | origens do frontend | `http://localhost:5173` |
| `OMIE_BASE_URL` | base da API Omie | `https://app.omie.com.br/api/v1` |
| `OMIE_MIN_INTERVAL` | intervalo mínimo entre chamadas (s) | `0.35` |

## Fluxo de uso

1. **Empresas** → cadastre cada CNPJ com suas chaves → "Testar conexão".
2. **Sincronizar** → escolha empresas + período de emissão → o app pagina TODAS as páginas da Omie (100 registros/página, com throttle, retry/backoff e tratamento do bloqueio HTTP 425) e grava no cache.
3. **Empresas → Mapear categorias** → diga qual categoria do Contas a Pagar é Produção, Frete, Imposto ou Outros (categorias com nome de tributo já vêm pré-sugeridas como Imposto).
4. **Dashboard / Projetos** → KPIs, composição da receita, ranking de margem e a lista completa; clique num projeto para ver o cálculo aberto, títulos e NF-e.
5. **Exportar** CSV/Excel na tela Projetos.

### Como a NF-e vira imposto do projeto

A consulta `ListarNF` (endpoint `produtos/nfconsultar`) traz os totais `ICMSTot` de cada nota e o vínculo com o projeto via `pedido.nIdProjeto` (ou, se ausente, `titulos[].nCodProjeto`). O app soma `vICMS + vST + vFCP + vFCPST + vIPI + vPIS + vCOFINS` das notas de saída não canceladas do projeto.

## Testes

```powershell
cd backend
.venv\Scripts\python -m pytest
```

Cobrem: cliente Omie (paginação completa, faultstring, retry/backoff, HTTP 425), agrupamento por projeto, grupos de custo com rateio, não-duplicação de tributos, margem, filtro de período, ajustes auditáveis e alíquota efetiva do Simples (28 testes).

## Deploy no Render (recomendado)

O repositório já tem um **Blueprint** ([render.yaml](render.yaml)) que cria os 3 recursos de uma vez: API Python, site estático do frontend (com proxy de `/api`) e Postgres.

1. Suba o projeto para um repositório no **GitHub** (ou GitLab):
   ```powershell
   git remote add origin https://github.com/SEU_USUARIO/projeto-custo.git
   git push -u origin main
   ```
2. No [dashboard do Render](https://dashboard.render.com): **New + → Blueprint** → conecte o repositório → **Apply**. O Render lê o `render.yaml` e cria `custeio-db`, `custeio-api` e `custeio-app` (o `APP_ENCRYPTION_KEY` é gerado automaticamente; o app deriva a chave de criptografia dele).
3. Ao terminar, abra `https://custeio-app.onrender.com`. **Se o Render tiver renomeado os serviços** (nome já em uso, ele adiciona um sufixo), ajuste em `custeio-app → Redirects/Rewrites` o destino do rewrite `/api/*` para a URL real da API, e em `custeio-api → Environment` o `CORS_ORIGINS` para a URL real do frontend.
4. Cadastre as empresas com as credenciais Omie **pela tela** (elas ficam criptografadas no Postgres — nunca no repositório).

**Custos/limitações (planos free):** o Postgres free **expira em 30 dias** (os dados são apagados!) e o web service free hiberna após 15 min sem uso (a 1ª requisição demora ~1 min e sincronizações longas podem ser interrompidas). Para uso real: `basic-256mb` no banco (~US$ 6/mês) e `starter` na API (~US$ 7/mês) — basta trocar os `plan:` no `render.yaml` e reaplicar, ou mudar no dashboard.

### Outras opções de deploy

- **Backend**: qualquer host Python. Rode `uvicorn app.main:app --host 0.0.0.0 --port 8000` atrás de um proxy HTTPS, com `DATABASE_URL`, `APP_ENCRYPTION_KEY` e `CORS_ORIGINS` definidos. URLs `postgres://` são normalizadas automaticamente para o driver `psycopg`.
- **Frontend**: `npm run build` e sirva `frontend/dist` (Netlify, Vercel, nginx) com rewrite de `/api` para o backend.
- **Banco**: `docker-compose.yml` como base ou Postgres gerenciado. Faça backup — os ajustes manuais e o mapeamento de categorias vivem nele.

## Limites da Omie respeitados

- Máx. **100 registros/página** — o cliente itera até `total_de_paginas`.
- ~240 req/min por método — throttle configurável (`OMIE_MIN_INTERVAL`).
- Erros de negócio (`faultstring`) não são retentados; instabilidade (5xx/timeout) tem backoff exponencial; **HTTP 425** (bloqueio de 30 min) falha com mensagem clara.
- "Não existem registros" é tratado como resultado vazio, não como erro.
