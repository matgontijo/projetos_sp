import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Alerta, type MesFechamento } from '../api/client'
import { FiltrosBar, useFiltros } from '../components/Filtros'
import { PageHeader } from '../components/Layout'
import {
  BarraComposicao,
  BarraValor,
  ComposicaoLinhas,
  Delta,
  GraficoMensal,
  RankingMargem,
  Skeleton,
  ValorContado,
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


/** O pulso do período dentro do cartão-herói: o resultado mês a mês numa linha
 * só, com o último mês marcado. Sem eixos — o gráfico grande fica logo abaixo. */
function Sparkline({ serie }: { serie: MesFechamento[] }) {
  const valores = serie.map((m) => m.resultado)
  const min = Math.min(...valores, 0)
  const max = Math.max(...valores, 1)
  const L = 100
  const A = 26
  const y = (v: number) => A - ((v - min) / (max - min || 1)) * (A - 3) - 1.5
  const x = (i: number) => (valores.length > 1 ? (i / (valores.length - 1)) * (L - 4) + 2 : L / 2)
  const pontos = valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const ultimo = valores[valores.length - 1]
  return (
    <svg
      className="mt-4 w-full"
      viewBox={`0 0 ${L} ${A}`}
      preserveAspectRatio="none"
      style={{ height: 34 }}
      role="img"
      aria-label="Resultado mês a mês no período"
    >
      {min < 0 && <line x1="0" x2={L} y1={y(0)} y2={y(0)} stroke="var(--gridline)" strokeWidth="0.4" />}
      <polyline
        points={pontos}
        fill="none"
        stroke="color-mix(in srgb, var(--text-primary) 55%, transparent)"
        strokeWidth="1.1"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x(valores.length - 1)} cy={y(ultimo)} r="1.6" fill={ultimo >= 0 ? 'var(--status-good)' : 'var(--neg)'} />
    </svg>
  )
}

/** Anel de progresso da conferência: quanto do período já tem os dois ok. */
function AnelProgresso({ fracao, rotulo }: { fracao: number; rotulo: string }) {
  const R = 30
  const C = 2 * Math.PI * R
  const cheio = Math.max(0, Math.min(fracao, 1)) * C
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`Conferência: ${rotulo} projetos com os dois ok`}>
      <circle cx="42" cy="42" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
      <circle
        cx="42"
        cy="42"
        r={R}
        fill="none"
        stroke={fracao >= 1 ? 'var(--status-good)' : 'color-mix(in srgb, var(--status-good) 80%, transparent)'}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${cheio} ${C - cheio}`}
        transform="rotate(-90 42 42)"
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
      />
      <text x="42" y="46" textAnchor="middle" style={{ font: '800 13px var(--font-display)', fill: 'var(--text-primary)' }}>
        {rotulo}
      </text>
    </svg>
  )
}

/** KPI agregado do bento: ícone na cor da série, valor, variação e participação. */
function CartaoKpi({
  titulo,
  valor,
  anterior,
  fracaoDaReceita,
  cor,
  icone,
  invertido = false,
}: {
  titulo: string
  valor: number
  anterior?: number
  fracaoDaReceita?: number
  cor: string
  icone: React.ReactNode
  invertido?: boolean
}) {
  return (
    <div className="card px-5 py-4 xl:col-span-4">
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
          style={{ background: `color-mix(in srgb, ${cor} 16%, transparent)`, color: cor }}
          aria-hidden
        >
          {icone}
        </span>
        <span className="titulo-secao">{titulo}</span>
        {fracaoDaReceita !== undefined && (
          <span className="ml-auto text-xs font-bold" style={{ color: 'var(--text-muted)' }} title="Participação sobre a receita">
            {fmtPct(fracaoDaReceita)} da receita
          </span>
        )}
      </div>
      <div className="kpi-valor mt-2 text-2xl">
        <ValorContado valor={valor} formato={fmtBRL} />
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        {anterior !== undefined && anterior > 0 && <Delta atual={valor} anterior={anterior} invertido={invertido} />}
      </div>
      {fracaoDaReceita !== undefined && <BarraValor valor={fracaoDaReceita} max={1} cor={`color-mix(in srgb, ${cor} 60%, transparent)`} />}
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
  const { empresaIds, de, ate, params, setMany } = useFiltros()
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
          {/* Bento: o resultado é o herói à esquerda (com o pulso do ano dentro);
              a conferência é um anel de progresso; os três agregados viram
              cartões com ícone. Tamanhos desiguais DE PROPÓSITO — hierarquia. */}
          <div className="grid gap-4 xl:grid-cols-12">
            <div className="card bento-hero xl:col-span-5">
              <div className="titulo-secao">Resultado do período</div>
              <div className="hero-valor mt-2" style={{ color: consolidado.resultado >= 0 ? 'var(--text-primary)' : 'var(--neg)' }}>
                <ValorContado valor={consolidado.resultado} formato={fmtBRL} />
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
              {serie && serie.length > 1 && <Sparkline serie={serie} />}
            </div>

            <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5 xl:col-span-7">
              <AnelProgresso
                fracao={consolidado.qtd_projetos ? consolidado.qtd_aprovados / consolidado.qtd_projetos : 0}
                rotulo={`${consolidado.qtd_aprovados}/${consolidado.qtd_projetos}`}
              />
              <div className="min-w-0 flex-1">
                <div className="titulo-secao">Conferência do período</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {consolidado.qtd_pendentes + consolidado.qtd_conferidos === 0
                    ? 'Todos os projetos têm os dois ok.'
                    : `${consolidado.qtd_pendentes + consolidado.qtd_conferidos} de ${consolidado.qtd_projetos} projetos ainda precisam de ok.`}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {(
                    [
                      ['pendente', consolidado.qtd_pendentes, 'sem nenhum ok', 'var(--text-muted)'],
                      ['conferido', consolidado.qtd_conferidos, 'falta o 2º ok', 'var(--status-warning)'],
                      ['aprovado', consolidado.qtd_aprovados, 'fechados', 'var(--status-good)'],
                      ['divergente', consolidado.qtd_divergentes, 'mudou depois do ok', 'var(--neg)'],
                    ] as const
                  )
                    .filter(([, v]) => v > 0)
                    .map(([id, valor, rotulo, cor]) => (
                      <Link
                        key={id}
                        to={`/projetos?${params.toString()}${params.toString() ? '&' : ''}conf=${id}`}
                        className="underline-offset-2 hover:underline"
                        title={`Ver os projetos: ${rotulo}`}
                      >
                        <b style={{ color: cor }}>{valor}</b>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
                      </Link>
                    ))}
                </div>
              </div>
            </div>

            <CartaoKpi
              titulo="Receita"
              valor={consolidado.receita}
              anterior={consolidadoAnterior?.receita}
              cor="var(--serie-producao)"
              icone={
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l6-6 4 4 8-8" />
                  <path d="M21 12V7h-5" />
                </svg>
              }
            />
            <CartaoKpi
              titulo="Custos"
              valor={consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros}
              anterior={
                consolidadoAnterior
                  ? consolidadoAnterior.producao + consolidadoAnterior.frete + consolidadoAnterior.comissao + consolidadoAnterior.outros
                  : undefined
              }
              fracaoDaReceita={(consolidado.producao + consolidado.frete + consolidado.comissao + consolidado.outros) / (consolidado.receita || 1)}
              cor="var(--serie-outros)"
              invertido
              icone={
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
                  <path d="M9 8h6M9 12h6" />
                </svg>
              }
            />
            <CartaoKpi
              titulo="Impostos"
              valor={consolidado.imposto}
              anterior={consolidadoAnterior?.imposto}
              fracaoDaReceita={consolidado.imposto / (consolidado.receita || 1)}
              cor="var(--serie-imposto)"
              invertido
              icone={
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="3" width="16" height="18" rx="2" />
                  <path d="M8 7h8M8 11h8M8 15h4" />
                </svg>
              }
            />
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
                <GraficoMensal serie={serie} aoFiltrarPeriodo={(novoDe, novoAte) => setMany({ de: novoDe, ate: novoAte })} />
              </div>
            </div>
          )}

          <ComparativoAnual empresaIds={empresaIds} />

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

/** Ano a ano: "estamos melhores que ano passado?" — mês contra o MESMO mês.
    Período fixo (ano passado + este ano), independente do filtro de datas:
    comparar ano exige as duas pontas inteiras. Respeita o filtro de empresas. */
function ComparativoAnual({ empresaIds }: { empresaIds?: string }) {
  const anoAtual = new Date().getFullYear()
  const de = `${anoAtual - 1}-01-01`
  const ate = new Date().toISOString().slice(0, 10)
  const { data: serie } = useQuery({
    queryKey: ['fechamento-mensal', empresaIds, de, ate],
    queryFn: () => api.fechamentoMensal(empresaIds, de, ate),
  })
  if (!serie) return null

  const porAnoMes = new Map(serie.map((m) => [m.mes, m]))
  const mesLimite = new Date().getMonth() + 1 // só até o mês corrente, nos dois anos
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const linhas = Array.from({ length: mesLimite }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    const passado = porAnoMes.get(`${anoAtual - 1}-${m}`)
    const atual = porAnoMes.get(`${anoAtual}-${m}`)
    return {
      mes: nomes[i],
      passado: passado?.receita ?? 0,
      atual: atual?.receita ?? 0,
      resPassado: passado?.resultado ?? 0,
      resAtual: atual?.resultado ?? 0,
    }
  })
  if (!linhas.some((l) => l.passado > 0 || l.atual > 0)) return null

  const totPassado = linhas.reduce((s, l) => s + l.passado, 0)
  const totAtual = linhas.reduce((s, l) => s + l.atual, 0)
  const totResPassado = linhas.reduce((s, l) => s + l.resPassado, 0)
  const totResAtual = linhas.reduce((s, l) => s + l.resAtual, 0)
  const varReceita = totPassado > 0 ? (totAtual - totPassado) / totPassado : null
  const max = Math.max(...linhas.flatMap((l) => [l.passado, l.atual]), 1)

  return (
    <div className="card mt-4">
      <div className="card-head">
        <div>
          <div className="titulo">
            {anoAtual} contra {anoAtual - 1}
          </div>
          <div className="sub">
            Receita de cada mês contra o MESMO mês do ano passado (até {nomes[mesLimite - 1]}).
          </div>
        </div>
        {varReceita !== null && (
          <span
            className="rounded-full px-2.5 py-1 text-xs font-black"
            style={{
              background:
                varReceita >= 0
                  ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
                  : 'color-mix(in srgb, var(--status-critical) 15%, transparent)',
              color: varReceita >= 0 ? 'var(--status-good-text)' : 'var(--neg)',
            }}
            title={`Receita acumulada: ${fmtBRL(totAtual)} em ${anoAtual} × ${fmtBRL(totPassado)} em ${anoAtual - 1}`}
          >
            {varReceita >= 0 ? '+' : ''}
            {(varReceita * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% em receita
          </span>
        )}
      </div>
      <div className="card-corpo">
        <div className="overflow-x-auto pb-1">
          <div className="flex items-end gap-3" style={{ minWidth: linhas.length * 52 }}>
            {linhas.map((l) => (
              <div key={l.mes} className="flex w-12 shrink-0 flex-col items-center gap-1">
                <div className="flex h-28 items-end gap-1">
                  <div
                    className="w-4 rounded-t"
                    style={{ height: Math.max((l.passado / max) * 112, l.passado > 0 ? 3 : 0), background: 'var(--baseline)' }}
                    title={`${l.mes}/${anoAtual - 1}: ${fmtBRL(l.passado)} (resultado ${fmtBRL(l.resPassado)})`}
                  />
                  <div
                    className="anima-cresce-y w-4 rounded-t"
                    style={{ height: Math.max((l.atual / max) * 112, l.atual > 0 ? 3 : 0), background: 'var(--accent)' }}
                    title={`${l.mes}/${anoAtual}: ${fmtBRL(l.atual)} (resultado ${fmtBRL(l.resAtual)})`}
                  />
                </div>
                <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{l.mes}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--baseline)' }} /> {anoAtual - 1}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--accent)' }} /> {anoAtual}
          </span>
          <span>
            Resultado acumulado: {fmtBRL(totResAtual)} × {fmtBRL(totResPassado)} no ano passado
          </span>
        </div>
      </div>
    </div>
  )
}
