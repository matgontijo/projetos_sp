import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, baixarArquivo, type LinhaFechamento, type ResultadoLote } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import { BadgeMeta, BarraComposicao, ChipsEmpresas, LegendaSeries, Skeleton } from '../components/Viz'
import { fmtBRL, fmtPct } from '../lib/format'

type CampoOrdenavel = 'projeto' | 'receita' | 'producao' | 'frete' | 'comissao' | 'imposto' | 'outros' | 'resultado' | 'margem'

/** Filtros da dupla conferência — é por aqui que elas tocam a rotina de conferir. */
const FILTROS_CONFERENCIA = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'pendente', rotulo: 'Pendentes' },
  { id: 'conferido', rotulo: 'Falta o 2º ok' },
  { id: 'aprovado', rotulo: 'Conferidos' },
  { id: 'divergente', rotulo: 'Mudou depois do ok' },
] as const
type FiltroConferencia = (typeof FILTROS_CONFERENCIA)[number]['id']

/** Agrupa as recusas por motivo — 200 linhas iguais não ajudam ninguém. */
function agruparMotivos(recusados: { projeto: string; motivo: string }[]) {
  const mapa = new Map<string, string[]>()
  for (const r of recusados) {
    const lista = mapa.get(r.motivo) || []
    lista.push(r.projeto)
    mapa.set(r.motivo, lista)
  }
  return [...mapa.entries()].map(([motivo, projetos]) => ({ motivo, projetos }))
}

/** Célula de conferência: um controle só, que MOSTRA o estado e DÁ o próximo ok.
 *
 * Selo + botão separados inchavam a coluna e quebravam a altura da linha; aqui a
 * borda tracejada é o que diz "ainda falta ok, dá para clicar". */
function CelulaConferencia({
  p,
  ocupado,
  onOk,
  euNome,
}: {
  p: LinhaFechamento
  ocupado: boolean
  onOk: () => void
  euNome: string
}) {
  const conf = p.conferencia
  if (!conf) return null

  const cor = conf.divergente
    ? { fundo: 'color-mix(in srgb, var(--status-warning) 22%, transparent)', texto: 'var(--text-primary)' }
    : conf.status === 'aprovado'
      ? { fundo: 'color-mix(in srgb, var(--status-good) 15%, transparent)', texto: 'var(--status-good-text)' }
      : conf.status === 'conferido'
        ? { fundo: 'color-mix(in srgb, var(--status-warning) 18%, transparent)', texto: 'var(--text-primary)' }
        : { fundo: 'var(--surface-2)', texto: 'var(--text-muted)' }

  const marca = `${conf.divergente ? '⚠ ' : ''}${conf.oks}/2`
  // maior no celular: 21px de altura não é alvo de toque; no desktop volta ao compacto
  const base =
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-bold leading-tight md:px-2 md:py-0.5 md:text-xs'

  if (conf.status === 'aprovado') {
    return (
      <span
        className={base}
        style={{ background: cor.fundo, color: cor.texto }}
        title={`Conferido por ${conf.conferido_por} · aprovado por ${conf.aprovado_por}${conf.divergente ? '. Atenção: os números mudaram depois do ok.' : ''}`}
      >
        {marca}
      </span>
    )
  }

  return (
    <button
      className={`${base} transition hover:brightness-125 disabled:opacity-50`}
      disabled={ocupado}
      style={{
        background: cor.fundo,
        color: cor.texto,
        border: '1px dashed color-mix(in srgb, var(--text-muted) 45%, transparent)',
      }}
      title={
        conf.status === 'pendente'
          ? `Clique para dar o 1º ok (conferi) — assina como ${euNome}`
          : `Conferido por ${conf.conferido_por}. Clique para dar o 2º ok (aprovar).`
      }
      onClick={onOk}
    >
      {marca}
      <span aria-hidden style={{ opacity: 0.65 }}>+</span>
    </button>
  )
}

/** O projeto como cartão — a forma da lista no celular.
 *
 * Mostra só o que decide a conferência. O toque no cartão abre o detalhe; a
 * seleção e o ok ficam em alvos próprios, grandes o bastante para o dedo. */
function CartaoProjeto({
  p,
  selecionado,
  onSelecionar,
  onOk,
  ocupado,
  euNome,
  href,
}: {
  p: LinhaFechamento
  selecionado: boolean
  onSelecionar: (comShift: boolean) => void
  onOk: () => void
  ocupado: boolean
  euNome: string
  href: string
}) {
  const positivo = p.resultado >= 0
  return (
    <div
      className="min-w-0 rounded-xl p-3"
      style={{
        background: selecionado ? 'color-mix(in srgb, var(--accent) 10%, var(--surface-1))' : 'var(--surface-1)',
        border: '1px solid var(--border-hairline)',
      }}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-6 w-6 shrink-0"
          style={{ accentColor: 'var(--accent)' }}
          checked={selecionado}
          onClick={(e) => onSelecionar(e.shiftKey)}
          onChange={() => {}}
          aria-label={`Selecionar ${p.projeto}`}
        />
        <Link to={href} className="min-w-0 flex-1">
          <div className="truncate font-bold" style={{ color: 'var(--accent)' }} title={p.projeto}>
            {p.projeto}
          </div>
          <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
            {[p.cliente, p.empresas].filter(Boolean).join(' · ') || '—'}
          </div>
        </Link>
        <CelulaConferencia p={p} ocupado={ocupado} onOk={onOk} euNome={euNome} />
      </div>
      <Link to={href} className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="titulo-secao">Receita</div>
          <div className="text-sm font-semibold tabular-nums">{fmtBRL(p.receita)}</div>
        </div>
        <div className="text-right">
          <div className="titulo-secao">Resultado</div>
          <div
            className="text-base font-extrabold tabular-nums"
            style={{ color: positivo ? 'var(--status-good-text)' : 'var(--neg)' }}
          >
            {fmtBRL(p.resultado)}
          </div>
        </div>
        <div className="text-right">
          <div className="titulo-secao">Margem</div>
          <div className="text-sm font-bold tabular-nums">{fmtPct(p.margem)}</div>
        </div>
      </Link>
    </div>
  )
}

/** Botão de exportação que baixa via fetch: aguenta o servidor gratuito acordando
 * (~1 min) e mostra erro de verdade — o download nativo do navegador desistia. */
function BotaoExport({ rotulo, url, nome, primario = false }: { rotulo: string; url: string; nome: string; primario?: boolean }) {
  const [estado, setEstado] = useState<'pronto' | 'gerando' | 'erro'>('pronto')

  async function baixar() {
    setEstado('gerando')
    try {
      await baixarArquivo(url, nome)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  return (
    <button
      className={primario ? 'btn btn-primary' : 'btn btn-ghost'}
      disabled={estado === 'gerando'}
      onClick={baixar}
      title={estado === 'gerando' ? 'Gerando o relatório — no servidor gratuito pode levar até 1 minuto' : undefined}
      style={estado === 'erro' ? { color: 'var(--neg)', borderColor: 'var(--neg)' } : undefined}
    >
      {estado === 'gerando' ? 'Gerando…' : estado === 'erro' ? `${rotulo} — falhou, tentar de novo` : rotulo}
    </button>
  )
}

export default function Projetos() {
  const { empresaIds, de, ate, params, set } = useFiltros()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: api.lerConfig })
  const margemAlvo = (config?.margem_alvo ?? 20) / 100

  const navigate = useNavigate()
  const [busca, setBusca] = useState('')
  // o filtro de conferência mora na URL: o Dashboard linka direto para "pendentes"
  // e voltar do detalhe do projeto devolve a lista como estava
  const confDaUrl = params.get('conf') || 'todos'
  const filtroConf = (FILTROS_CONFERENCIA.some((f) => f.id === confDaUrl) ? confDaUrl : 'todos') as FiltroConferencia
  const setFiltroConf = (id: FiltroConferencia) => set('conf', id === 'todos' ? '' : id)
  const [ordem, setOrdem] = useState<{ campo: CampoOrdenavel; desc: boolean }>({ campo: 'receita', desc: true })

  // --- Conferência em massa ---
  const queryClient = useQueryClient()
  const { data: eu } = useQuery({ queryKey: ['eu'], queryFn: api.eu })
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [ultimoClique, setUltimoClique] = useState<number | null>(null)
  const [resultadoLote, setResultadoLote] = useState<ResultadoLote | null>(null)

  const darOks = useMutation({
    mutationFn: (nomes: string[]) => api.aprovarLote({ nomes, empresa_ids: empresaIds, de, ate }),
    onSuccess: (r) => {
      setResultadoLote(r)
      setSelecionados(new Set())
      queryClient.invalidateQueries({ queryKey: ['fechamento'] })
    },
  })

  function ordenarPor(campo: CampoOrdenavel) {
    setOrdem((o) => ({ campo, desc: o.campo === campo ? !o.desc : true }))
  }

  /** Clique marca um; shift+clique marca o intervalo desde o último — conferir
   *  centenas de projetos um clique por vez não é trabalho, é castigo. */
  function alternarSelecao(indice: number, comShift: boolean) {
    const nome = projetos[indice].projeto
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (comShift && ultimoClique !== null && ultimoClique < projetos.length) {
        const [inicio, fim] = ultimoClique < indice ? [ultimoClique, indice] : [indice, ultimoClique]
        const marcando = !novo.has(nome)
        for (let i = inicio; i <= fim; i++) {
          if (marcando) novo.add(projetos[i].projeto)
          else novo.delete(projetos[i].projeto)
        }
      } else if (novo.has(nome)) {
        novo.delete(nome)
      } else {
        novo.add(nome)
      }
      return novo
    })
    setUltimoClique(indice)
  }

  const todos = data?.projetos || []
  const porBusca = busca
    ? todos.filter((p) =>
        `${p.projeto} ${p.cliente} ${p.empresas}`.toLowerCase().includes(busca.toLowerCase()),
      )
    : todos
  const filtrados =
    filtroConf === 'todos'
      ? porBusca
      : porBusca.filter((p) =>
          filtroConf === 'divergente' ? p.conferencia?.divergente : p.conferencia?.status === filtroConf,
        )
  const projetos = [...filtrados].sort((a, b) => {
    const va = a[ordem.campo]
    const vb = b[ordem.campo]
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb)
    return ordem.desc ? -cmp : cmp
  })

  // a seleção só vale para o que está à vista: mudar o filtro não pode deixar
  // projetos escondidos entrando no lote sem a pessoa ver
  const selecaoVisivel = projetos.filter((p) => selecionados.has(p.projeto))
  const nomesSelecionados = selecaoVisivel.map((p) => p.projeto)
  const todosMarcados = projetos.length > 0 && selecaoVisivel.length === projetos.length
  const receberiam1o = selecaoVisivel.filter((p) => p.conferencia?.status === 'pendente').length
  const receberiam2o = selecaoVisivel.filter((p) => p.conferencia?.status === 'conferido').length
  const jaAprovados = selecaoVisivel.length - receberiam1o - receberiam2o

  function marcarTodos() {
    setSelecionados(todosMarcados ? new Set() : new Set(projetos.map((p) => p.projeto)))
  }

  const Th = ({ campo, children, numerica = true }: { campo: CampoOrdenavel; children: React.ReactNode; numerica?: boolean }) => (
    <th
      className={`ordenavel ${numerica ? 'num' : ''}`}
      onClick={() => ordenarPor(campo)}
      title="Clique para ordenar"
    >
      {children} {ordem.campo === campo ? (ordem.desc ? '▾' : '▴') : ''}
    </th>
  )

  const abrir = (p: LinhaFechamento) => navigate(`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`)

  return (
    <div>
      <PageHeader
        titulo="Projetos"
        subtitulo="Só projetos de venda (numeração BR) — clique na linha para abrir o detalhe"
        acoes={
          <>
            <BotaoExport rotulo="Exportar PDF" url={api.urlExportPdf(empresaIds, de, ate)} nome="fechamento.pdf" primario />
            <BotaoExport rotulo="CSV" url={api.urlExportCsv(empresaIds, de, ate)} nome="fechamento.csv" />
            <BotaoExport rotulo="Excel" url={api.urlExportXlsx(empresaIds, de, ate)} nome="fechamento.xlsx" />
          </>
        }
      />
      <FiltrosBar />
      {error && (
        <p className="mb-3 text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar o fechamento: {(error as Error).message}
        </p>
      )}
      {data && data.consolidado.qtd_projetos > 0 && (
        <div className="card mb-4 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <b className="text-sm">Conferência do período</b>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <b>{data.consolidado.qtd_aprovados}</b> de {data.consolidado.qtd_projetos} com os dois ok
              {data.consolidado.qtd_conferidos > 0 && ` · ${data.consolidado.qtd_conferidos} esperando o 2º`}
              {data.consolidado.qtd_divergentes > 0 && (
                <span style={{ color: 'var(--neg)' }}> · {data.consolidado.qtd_divergentes} mudaram depois do ok</span>
              )}
            </span>
            <div
              className="flex h-1.5 w-40 shrink-0 overflow-hidden rounded-full"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border-hairline)' }}
              title={`${data.consolidado.qtd_aprovados} conferidos e aprovados · ${data.consolidado.qtd_conferidos} com um ok · ${data.consolidado.qtd_pendentes} sem nenhum`}
            >
              <div
                style={{
                  width: `${(data.consolidado.qtd_aprovados / data.consolidado.qtd_projetos) * 100}%`,
                  background: 'var(--status-good)',
                }}
              />
              <div
                style={{
                  width: `${(data.consolidado.qtd_conferidos / data.consolidado.qtd_projetos) * 100}%`,
                  background: 'var(--status-warning)',
                }}
              />
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {Math.round((data.consolidado.qtd_aprovados / data.consolidado.qtd_projetos) * 100)}%
            </span>
            {data.consolidado.qtd_pendentes > 0 && (
              <button
                className="btn btn-ghost ml-auto px-3 py-1 text-xs"
                onClick={() => setFiltroConf('pendente')}
                title="Filtra a lista nos que ainda não têm nenhum ok"
              >
                Ver os {data.consolidado.qtd_pendentes} pendentes
              </button>
            )}
          </div>
        </div>
      )}

      {resultadoLote && (
        <div className="card mb-4 px-5 py-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <b className="text-sm" style={{ color: 'var(--status-good-text)' }}>
              ✓ {resultadoLote.aplicados.length} ok registrado{resultadoLote.aplicados.length === 1 ? '' : 's'}
              {resultadoLote.aplicados.length > 0 &&
                ` (${resultadoLote.aplicados.filter((a) => a.nivel === 1).length} conferência, ${resultadoLote.aplicados.filter((a) => a.nivel === 2).length} aprovação)`}
            </b>
            <button className="btn btn-ghost ml-auto px-3 py-1 text-xs" onClick={() => setResultadoLote(null)}>
              Fechar
            </button>
          </div>
          {resultadoLote.recusados.length > 0 && (
            <div className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <b>{resultadoLote.recusados.length} não deu para registrar:</b>
              <ul className="mt-1 space-y-0.5">
                {agruparMotivos(resultadoLote.recusados).map(({ motivo, projetos: nomes }) => (
                  <li key={motivo}>
                    <span style={{ color: 'var(--text-muted)' }}>{nomes.length}×</span> {motivo}
                    <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                      ({nomes.slice(0, 4).join(', ')}
                      {nomes.length > 4 ? `, +${nomes.length - 4}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {selecaoVisivel.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 md:bottom-6 md:w-auto">
          <div
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-2xl px-5 py-3 shadow-lg md:rounded-full"
            style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}
          >
            <b className="text-sm">{selecaoVisivel.length} selecionado{selecaoVisivel.length === 1 ? '' : 's'}</b>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {receberiam1o > 0 && `${receberiam1o} recebe o 1º ok`}
              {receberiam1o > 0 && receberiam2o > 0 && ' · '}
              {receberiam2o > 0 && `${receberiam2o} recebe o 2º ok`}
              {jaAprovados > 0 && `${receberiam1o || receberiam2o ? ' · ' : ''}${jaAprovados} já fechado${jaAprovados === 1 ? '' : 's'}`}
            </span>
            <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setSelecionados(new Set())}>
              Limpar
            </button>
            <button
              className="btn btn-primary text-xs"
              disabled={darOks.isPending || receberiam1o + receberiam2o === 0}
              title={
                receberiam1o + receberiam2o === 0
                  ? 'Os selecionados já têm os dois ok'
                  : `Assina o próximo ok de cada um como ${eu?.nome || 'você'}`
              }
              onClick={() => darOks.mutate(nomesSelecionados)}
            >
              {darOks.isPending ? 'Registrando…' : `Dar o ok em ${receberiam1o + receberiam2o}`}
            </button>
          </div>
          {darOks.error && (
            <p className="mt-2 text-center text-xs font-semibold" style={{ color: 'var(--status-critical)' }}>
              {(darOks.error as Error).message}
            </p>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div className="flex flex-wrap items-center gap-3">
            <input
              className="input w-64"
              placeholder="Buscar projeto ou cliente…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por conferência">
              {FILTROS_CONFERENCIA.map((op) => {
                const ativo = filtroConf === op.id
                return (
                  <button
                    key={op.id}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold"
                    onClick={() => setFiltroConf(op.id)}
                    style={{
                      background: ativo ? 'var(--accent)' : 'var(--surface-2)',
                      color: ativo ? 'var(--surface-1)' : 'var(--text-muted)',
                    }}
                  >
                    {op.rotulo}
                    {op.id === 'pendente' && (data?.consolidado.qtd_pendentes ?? 0) > 0
                      ? ` (${data!.consolidado.qtd_pendentes})`
                      : ''}
                  </button>
                )
              })}
            </div>
            {(busca || filtroConf !== 'todos') && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {projetos.length} de {todos.length}
              </span>
            )}
          </div>
          <div className="acoes">
            <LegendaSeries />
          </div>
        </div>
        {/* No celular a tabela de 15 colunas é inútil: vira uma lista de cartões
            com o que decide a conferência — projeto, quem é o cliente, resultado
            e o selo de ok. O resto abre no detalhe. */}
        {/* grid-cols-1 (= minmax(0,1fr)) e não só `grid`: a coluna `auto` do grid
            dimensiona pelo conteúdo, e um número de projeto longo estica o cartão
            para além da tela em vez de truncar. */}
        <div className="grid grid-cols-1 gap-2 px-3 pb-3 md:hidden">
          {isLoading && [1, 2, 3].map((i) => <Skeleton key={i} altura={92} />)}
          {!isLoading && !error && projetos.length === 0 && (
            <p className="px-2 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
              {filtroConf === 'todos'
                ? 'Nenhum projeto no período. Sincronize os dados em "Buscar dados".'
                : 'Nenhum projeto neste filtro de conferência.'}
            </p>
          )}
          {projetos.map((p, indice) => (
            <CartaoProjeto
              key={p.projeto}
              p={p}
              selecionado={selecionados.has(p.projeto)}
              onSelecionar={(comShift) => alternarSelecao(indice, comShift)}
              onOk={() => darOks.mutate([p.projeto])}
              ocupado={darOks.isPending}
              euNome={eu?.nome || 'você'}
              href={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`}
            />
          ))}
        </div>

        <div className="tabela-wrap hidden md:block">
        <table className="data tabela-fixa">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  className="align-middle"
                  style={{ accentColor: 'var(--accent)' }}
                  checked={todosMarcados}
                  onChange={marcarTodos}
                  aria-label="Selecionar todos os projetos da lista"
                  title={`Marcar os ${projetos.length} projetos desta lista (dica: shift+clique seleciona um intervalo)`}
                />
              </th>
              <Th campo="projeto" numerica={false}>Projeto</Th>
              <th title="Dupla conferência: 0/2 sem ok, 1/2 conferido, 2/2 conferido e aprovado">Conf.</th>
              <th>Empresas</th>
              <th>Cliente</th>
              <Th campo="receita">Receita</Th>
              <Th campo="producao">Produção</Th>
              <Th campo="frete">Frete</Th>
              <Th campo="imposto">Impostos</Th>
              <Th campo="comissao">Comissão</Th>
              <Th campo="outros">Outros</Th>
              <Th campo="resultado">Resultado</Th>
              <Th campo="margem">Margem</Th>
              <th style={{ minWidth: 140 }}>Composição</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [1, 2, 3, 4, 5, 6].map((i) => (
                <tr key={i}>
                  <td colSpan={15}>
                    <Skeleton altura={18} />
                  </td>
                </tr>
              ))}
            {!isLoading && !error && projetos.length === 0 && (
              <tr>
                <td colSpan={15} style={{ color: 'var(--text-muted)' }}>
                  {filtroConf === 'todos'
                    ? 'Nenhum projeto no período. Sincronize os dados na aba "Sincronizar".'
                    : 'Nenhum projeto neste filtro de conferência.'}
                </td>
              </tr>
            )}
            {projetos.map((p, indice) => (
              <tr
                key={p.projeto}
                className={`linha-clicavel${selecionados.has(p.projeto) ? ' linha-selecionada' : ''}`}
                onClick={() => abrir(p)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="align-middle"
                    style={{ accentColor: 'var(--accent)' }}
                    checked={selecionados.has(p.projeto)}
                    // onClick (e não onChange) porque só o evento de mouse traz shiftKey
                    onClick={(e) => alternarSelecao(indice, e.shiftKey)}
                    onChange={() => {}}
                    aria-label={`Selecionar ${p.projeto}`}
                  />
                </td>
                <td>
                  <Link
                    to={`/projeto?nome=${encodeURIComponent(p.projeto)}&${params.toString()}`}
                    className="projeto-nome font-semibold underline-offset-2 hover:underline"
                    style={{ color: 'var(--accent)' }}
                    title={p.projeto}
                  >
                    {p.projeto}
                  </Link>
                </td>
                <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                  <CelulaConferencia
                    p={p}
                    ocupado={darOks.isPending}
                    euNome={eu?.nome || 'você'}
                    onOk={() => darOks.mutate([p.projeto])}
                  />
                </td>
                <td>
                  <ChipsEmpresas empresas={p.empresas} />
                </td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  <span className="block max-w-36 truncate" title={p.cliente}>
                    {p.cliente || '—'}
                  </span>
                </td>
                <td className="num">{fmtBRL(p.receita)}</td>
                <td className="num">{fmtBRL(p.producao)}</td>
                <td className="num">{fmtBRL(p.frete)}</td>
                <td className="num">{fmtBRL(p.imposto)}</td>
                <td className="num">{fmtBRL(p.comissao)}</td>
                <td className="num">{fmtBRL(p.outros)}</td>
                <td className="num font-semibold" style={{ color: p.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                  {fmtBRL(p.resultado)}
                </td>
                <td className="num font-semibold">{fmtPct(p.margem)}</td>
                <td>
                  <BarraComposicao
                    compacta
                    receita={p.receita}
                    producao={p.producao}
                    frete={p.frete}
                    imposto={p.imposto}
                    comissao={p.comissao}
                    outros={p.outros}
                    resultado={p.resultado}
                  />
                </td>
                <td>
                  <BadgeMeta margem={p.margem} receita={p.receita} alvo={margemAlvo} />
                </td>
              </tr>
            ))}
          </tbody>
          {(() => {
            const linhas = projetos
            if (!linhas.length) return null
            const soma = (campo: 'receita' | 'producao' | 'frete' | 'comissao' | 'imposto' | 'outros' | 'resultado') =>
              linhas.reduce((s, p) => s + p[campo], 0)
            const receita = soma('receita')
            const resultado = soma('resultado')
            return (
              <tfoot>
                <tr style={{ fontWeight: 700, borderTop: '2px solid var(--baseline)' }}>
                  <td></td>
                  <td title="Soma das linhas exibidas">Total</td>
                  <td className="text-xs" style={{ color: 'var(--text-muted)' }} title="Projetos com os dois ok">
                    {linhas.filter((p) => p.conferencia?.status === 'aprovado').length}/{linhas.length}
                  </td>
                  <td colSpan={2} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {linhas.length} projetos
                  </td>
                  <td className="num">{fmtBRL(receita)}</td>
                  <td className="num">{fmtBRL(soma('producao'))}</td>
                  <td className="num">{fmtBRL(soma('frete'))}</td>
                  <td className="num">{fmtBRL(soma('imposto'))}</td>
                  <td className="num">{fmtBRL(soma('comissao'))}</td>
                  <td className="num">{fmtBRL(soma('outros'))}</td>
                  <td className="num" style={{ color: resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                    {fmtBRL(resultado)}
                  </td>
                  <td className="num">{fmtPct(receita > 0 ? resultado / receita : 0)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )
          })()}
        </table>
        </div>
      </div>
    </div>
  )
}
