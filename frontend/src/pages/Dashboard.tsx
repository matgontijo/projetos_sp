import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Alerta } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import {
  BarraComposicao,
  ComposicaoLinhas,
  Delta,
  GraficoMensal,
  RankingMargem,
  Skeleton,
} from '../components/Viz'
import { fmtBRL, fmtBRLCurto, fmtPct } from '../lib/format'

/** Central de alertas: uma linha de resumo; a lista completa só abre se pedirem. */
function PainelAtencao({ alertas, params }: { alertas: Alerta[]; params: string }) {
  const [expandido, setExpandido] = useState(false)
  const criticos = alertas.filter((a) => a.gravidade === 'critica').length
  const atencao = alertas.length - criticos
  const resumo = [
    criticos > 0 && `${criticos} crítico${criticos > 1 ? 's' : ''}`,
    atencao > 0 && `${atencao} de atenção`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="card mt-4 px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
          style={{ background: 'color-mix(in srgb, var(--neg) 12%, transparent)', color: 'var(--neg)' }}
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3 2.5 20h19z" />
            <path d="M12 9.5v5M12 17.6v.01" />
          </svg>
        </span>
        <b className="text-sm">Precisa de atenção</b>
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {resumo}
        </span>
        <button className="btn btn-ghost ml-auto px-3.5 py-1 text-xs" onClick={() => setExpandido(!expandido)}>
          {expandido ? 'Esconder' : `Ver a lista (${alertas.length})`}
        </button>
      </div>
      {expandido && (
        <div className="mt-3">
          {alertas.map((a, i) => (
            <div key={i} className="alerta-linha">
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  className="h-2 w-2 shrink-0 self-center rounded-full"
                  style={{ background: a.gravidade === 'critica' ? 'var(--neg)' : 'var(--status-warning)' }}
                  title={a.gravidade === 'critica' ? 'Crítico' : 'Atenção'}
                />
                {a.projeto ? (
                  <Link
                    to={`/projeto?nome=${encodeURIComponent(a.projeto)}&${params}`}
                    className="truncate font-bold underline-offset-2 hover:underline"
                  >
                    {a.titulo}
                  </Link>
                ) : (
                  <b className="truncate">{a.titulo}</b>
                )}
              </span>
              <span className="hidden truncate text-xs sm:block" style={{ color: 'var(--text-muted)', maxWidth: '55%' }}>
                {a.detalhe}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Período imediatamente anterior, com a mesma duração do filtro atual. */
function periodoAnterior(de?: string, ate?: string): { de: string; ate: string } | null {
  if (!de || !ate) return null
  const inicio = new Date(de)
  const fim = new Date(ate)
  const dias = Math.round((fim.getTime() - inicio.getTime()) / 864e5) + 1
  const anteriorFim = new Date(inicio.getTime() - 864e5)
  const anteriorInicio = new Date(anteriorFim.getTime() - (dias - 1) * 864e5)
  return { de: anteriorInicio.toISOString().slice(0, 10), ate: anteriorFim.toISOString().slice(0, 10) }
}

export default function Dashboard() {
  const { empresaIds, de, ate, params } = useFiltros()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
  })
  const { data: serie } = useQuery({
    queryKey: ['fechamento-mensal', empresaIds, de, ate],
    queryFn: () => api.fechamentoMensal(empresaIds, de, ate),
  })
  const { data: alertas } = useQuery({
    queryKey: ['alertas', empresaIds, de, ate],
    queryFn: () => api.alertas(empresaIds, de, ate),
  })
  const { data: config } = useQuery({ queryKey: ['config'], queryFn: api.lerConfig })
  const margemAlvo = (config?.margem_alvo ?? 20) / 100
  const anterior = periodoAnterior(de, ate)
  const { data: dataAnterior } = useQuery({
    queryKey: ['fechamento', empresaIds, anterior?.de, anterior?.ate],
    queryFn: () => api.fechamento(empresaIds, anterior!.de, anterior!.ate),
    enabled: !!anterior,
  })

  const consolidado = data?.consolidado
  const consolidadoAnterior = dataAnterior?.consolidado
  // margem dos 15 MAIORES projetos por receita — ranking por margem pura deixaria
  // projetos minúsculos (ex.: R$ 1.620 sem custo = 100%) na frente dos relevantes
  const ranking = [...(data?.projetos || [])]
    .filter((p) => p.receita > 0)
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 15)
    .sort((a, b) => b.margem - a.margem)
    .map((p) => ({
      chave: p.projeto,
      rotulo: p.projeto,
      margem: p.margem,
      receitaCurta: fmtBRLCurto(p.receita),
      detalhe: `${p.projeto} — receita ${fmtBRL(p.receita)}, resultado ${fmtBRL(p.resultado)}, margem ${fmtPct(p.margem)}`,
    }))

  return (
    <div>
      <PageHeader
        titulo="Visão geral"
        subtitulo="Só projetos de venda (numeração BR), com as duas empresas somadas por número de projeto"
      />
      <FiltrosBar />
      {isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card px-4 py-3">
              <Skeleton altura={12} largura={90} />
              <div className="mt-2">
                <Skeleton altura={26} largura={130} />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="text-sm" style={{ color: 'var(--neg)' }}>
          Erro ao carregar: {(error as Error).message}
        </p>
      )}
      {consolidado && consolidado.qtd_projetos === 0 && (
        <div className="card px-6 py-6">
          <h2 className="mb-2 text-base font-bold">Comece por aqui</h2>
          <ol className="grid gap-2 text-sm md:grid-cols-3" style={{ color: 'var(--text-secondary)' }}>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>1. Conectar as empresas</b>
              <p className="help mt-1">
                Em <Link to="/empresas" className="underline">Empresas</Link>, cole as chaves da Omie de cada CNPJ e
                teste a conexão.
              </p>
            </li>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>2. Buscar os dados</b>
              <p className="help mt-1">
                Em <Link to="/sincronizar" className="underline">Buscar dados</Link>, escolha o período — o app puxa
                notas, contas a receber e a pagar.
              </p>
            </li>
            <li className="rounded-lg border p-3" style={{ borderColor: 'var(--gridline)' }}>
              <b>3. Classificar os custos</b>
              <p className="help mt-1">
                Em <Link to="/empresas" className="underline">Empresas → Classificar custos</Link>, diga o que é
                produção, frete ou imposto. Pronto: o fechamento sai sozinho.
              </p>
            </li>
          </ol>
        </div>
      )}
      {consolidado && consolidado.qtd_projetos > 0 && (
        <>
          <div className="card hero-metricas overflow-hidden">
            <div className="hero-protagonista">
              <div className="titulo-secao">Resultado do período</div>
              <div className="hero-valor mt-2" style={{ color: consolidado.resultado >= 0 ? 'var(--text-primary)' : 'var(--neg)' }}>
                {fmtBRL(consolidado.resultado)}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm">
                <span
                  className="pill"
                  style={
                    {
                      '--pill':
                        consolidado.margem_media < 0
                          ? 'var(--neg)'
                          : consolidado.margem_media >= margemAlvo
                            ? 'var(--status-good)'
                            : 'var(--status-warning)',
                    } as React.CSSProperties
                  }
                  title={`Meta de margem: ${fmtPct(margemAlvo)}`}
                >
                  margem {fmtPct(consolidado.margem_media)}
                </span>
                {consolidadoAnterior && <Delta atual={consolidado.resultado} anterior={consolidadoAnterior.resultado} />}
                <span style={{ color: 'var(--text-muted)' }}>{consolidado.qtd_projetos} projetos de venda</span>
              </div>
            </div>
            <div className="hero-sub">
              <div className="titulo-secao">Receita</div>
              <div className="valor mt-2">{fmtBRL(consolidado.receita)}</div>
              <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {consolidadoAnterior && <Delta atual={consolidado.receita} anterior={consolidadoAnterior.receita} />}
              </div>
            </div>
            <div className="hero-sub" title="Produção + frete + comissão + outros custos (impostos ficam ao lado)">
              <div className="titulo-secao">Custos</div>
              <div className="valor mt-2">
                {fmtBRL(consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros)}
              </div>
              <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {consolidadoAnterior && (
                  <Delta
                    atual={consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros}
                    anterior={
                      consolidadoAnterior.producao +
                      consolidadoAnterior.frete +
                      consolidadoAnterior.comissao +
                      consolidadoAnterior.outros
                    }
                    invertido
                  />
                )}
              </div>
            </div>
            <div className="hero-sub">
              <div className="titulo-secao">Impostos</div>
              <div className="valor mt-2">{fmtBRL(consolidado.imposto)}</div>
              <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                {consolidadoAnterior && <Delta atual={consolidado.imposto} anterior={consolidadoAnterior.imposto} invertido />}
              </div>
            </div>
          </div>

          {alertas && alertas.length > 0 && <PainelAtencao alertas={alertas} params={params.toString()} />}

          {serie && serie.length > 1 && (
            <div className="card mt-4">
              <div className="card-head">
                <div>
                  <div className="titulo">Evolução mensal</div>
                  <div className="sub">Receita e resultado dos projetos, mês a mês. Passe o mouse para ver os valores.</div>
                </div>
              </div>
              <div className="card-corpo">
                <GraficoMensal serie={serie} />
              </div>
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="titulo">Para onde foi cada real</div>
                  <div className="sub">Quanto da receita cada grupo consumiu — e o que sobrou.</div>
                </div>
              </div>
              <div className="card-corpo">
              <BarraComposicao
                receita={consolidado.receita}
                producao={consolidado.producao}
                frete={consolidado.frete}
                imposto={consolidado.imposto}
                comissao={consolidado.comissao}
                outros={consolidado.outros}
                resultado={consolidado.resultado}
              />
              <ComposicaoLinhas consolidado={consolidado} />
              {consolidado.cp_impostos > 0 && (
                <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  Tributos pagos via contas a pagar ({fmtBRL(consolidado.cp_impostos)}) aparecem no detalhe e não somam
                  no custo.
                </p>
              )}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="titulo">Margem dos 15 maiores projetos</div>
                  <div className="sub">
                    Verde = na meta de {fmtPct(margemAlvo)} (linha tracejada) · amarelo = abaixo · vermelho = prejuízo.
                    Clique para abrir o projeto.
                  </div>
                </div>
              </div>
              <div className="card-corpo">
                {ranking.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Nenhum projeto com receita no período.
                  </p>
                ) : (
                  <RankingMargem
                    itens={ranking}
                    alvo={margemAlvo}
                    aoClicar={(nome) => navigate(`/projeto?nome=${encodeURIComponent(nome)}&${params.toString()}`)}
                  />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
