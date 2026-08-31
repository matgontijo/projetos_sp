# Instalando o sistema para um novo cliente

O app foi desenhado para servir mais de uma empresa com o MESMO código: a marca,
as empresas Omie e todas as preferências são configuração, não código. Este é o
roteiro completo para colocar uma nova instalação no ar — sem tocar em uma linha.

## O que você precisa antes de começar

- Uma conta no [Render](https://render.com) **do cliente** (ou sua, se você operar por ele)
- As chaves de API da Omie de cada empresa (app_key + app_secret, geradas no painel Omie)
- 30 minutos

## Passo a passo

### 1. Suba o código

Faça um fork (ou um novo repositório) a partir deste. Cada cliente com seu
repositório mantém deploys independentes — um push seu não derruba o outro.

### 2. Crie a infraestrutura com um clique

No Render: **New + → Blueprint** → aponte para o repositório. O `render.yaml`
cria os três recursos: banco Postgres, API e site.

> **Atenção aos nomes**: o domínio `.onrender.com` é global. Se `custeio-api`
> já estiver em uso, o Render sufixará a URL (ex.: `custeio-api-zfd7`). Nesse
> caso ajuste no `render.yaml` o `destination` do rewrite e o `CORS_ORIGINS`
> para as URLs reais — sem isso o login não funciona. Para um novo cliente,
> prefira já renomear os serviços no yaml (ex.: `acme-api`, `acme-app`).

### 3. Configure o ambiente (`sua-api` → Environment)

| Variável | Para quê | Exemplo |
|---|---|---|
| `APP_ENCRYPTION_KEY` | criptografa as credenciais Omie — **guarde uma cópia**; perder = recadastrar chaves | (gerada pelo Render, ou a sua) |
| `MARCA_LINHA1` | linha de cima do logotipo | `GRUPO` |
| `MARCA_LINHA2` | linha de baixo do logotipo (a marca em si) | `ACME` |
| `CORS_ORIGINS` | URL do site | `https://acme-app.onrender.com` |
| `APP_URL` | link nos avisos e relatórios | idem |
| `SUPORTE_EMAIL` | e-mail de quem atende o suporte | `voce@empresa.com` |
| `SMTP_HOST/PORT/USER/PASS` | envio de e-mail (avisos + relatório mensal) | Gmail: `smtp.gmail.com` + senha de app |
| `CALLMEBOT_TELEFONE/APIKEY` | aviso de suporte por WhatsApp (opcional) | ver callmebot.com |

A marca alimenta o app inteiro: tela de login, menu, título da aba e os PDFs
(fechamento e propostas comerciais) — tudo de uma vez.

### 4. Planos (o free NÃO serve para produção)

- **Postgres `basic-256mb`** (~US$ 6/mês) — o free **apaga tudo em 30 dias**
- **API `starter`** (~US$ 7/mês) — o free hiberna após 15 min e o primeiro
  acesso do dia leva ~1 minuto (o app avisa o usuário, mas pago é melhor)

No `render.yaml`, troque os `plan: free` — o Blueprint sincroniza a partir do
arquivo, então mudar só no dashboard volta atrás no próximo push.

### 5. Primeiro acesso

1. Abra o site → a tela de setup cria a conta da administradora
2. **Empresas** → cadastre cada empresa com as chaves da Omie e a tributação
   (Simples/Presumido, alíquotas itemizadas)
3. **Buscar dados** → traz projetos, notas e títulos da Omie
4. **Empresas → Preferências** → ligue a busca automática diária e, se quiser,
   o relatório mensal por e-mail

### 6. Rotina de segurança

- **Backup**: Empresas → "Backup do trabalho da equipe" → Baixar. O JSON guarda
  o que a Omie não devolve: usuários, categorias classificadas, ajustes,
  aprovações, orçamentos. Guarde fora do servidor, em dia fixo do mês.
- **Domínio próprio** (opcional): Settings → Custom Domain no serviço do site;
  um CNAME no DNS do cliente e `sistema.cliente.com.br` está no ar (ajuste
  `CORS_ORIGINS` e `APP_URL` depois).

## Modelo de negócio sugerido

Uma instalação por cliente = repositório + Render + banco isolados. Nada de um
cliente enxergar o outro, e cada um paga a própria infraestrutura (~US$ 13/mês).
