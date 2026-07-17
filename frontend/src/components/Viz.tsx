import { useState, type ReactNode } from 'react'
import type { Consolidado, MesFechamento } from '../api/client'
import { fmtBRL, fmtBRLCurto, fmtPct } from '../lib/format'

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function Skeleton({ altura = 20, largura = '100%' }: { altura?: number; largura?: number | string }) {
  return <div className="skeleton" style={{ height: altura, width: largura }} />
}

/** Variação vs o período anterior — só aparece quando tem algo a dizer. */
export function Delta({ atual, anterior, invertido = false }: { atual: number; anterior: number; invertido?: boolean }) {
  // sem base de comparação (período anterior vazio) ou variação nula: silêncio
  if (!anterior || anterior <= 0) return null
  const variacao = (atual - anterior) / anterior
  if (!isFinite(variacao) || Math.abs(variacao) < 0.0005) return null
  const bom = invertido ? variacao < 0 : variacao > 0
  return (
    <span
      className="font-semibold"
      style={{ color: bom ? 'var(--status-good-text)' : 'var(--neg)' }}
      title={`Período anterior: ${fmtBRL(anterior)}`}
    >
      {variacao > 0 ? '↑' : '↓'} {fmtPct(Math.abs(variacao))} vs anterior
    </span>
  )
}

/** Evolução mensal: barras de receita + LINHA de resultado, tooltip vivo e escala. */
export function GraficoMensal({ serie }: { serie: MesFechamento[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (!serie.length) return null
  const maxPos = Math.max(...serie.map((m) => Math.max(m.receita, m.resultado, 0)), 1)
  const maxNeg = Math.max(...serie.map((m) => Math.max(0, -m.resultado)), 0)
  const ALTURA = 210
  const areaPos = maxNeg > 0 ? ALTURA * (maxPos / (maxPos + maxNeg)) : ALTURA
  const areaNeg = ALTURA - areaPos
  const n = serie.length
  // com muitos meses os rótulos colidem: mostra no máximo ~16, sempre incluindo o mais recente
  const denso = n > 28
  const passoRotulo = Math.max(1, Math.ceil(n / 16))
  const mostraRotulo = (i: number) => (n - 1 - i) % passoRotulo === 0

  const rotulo = (mes: string) => {
    const [ano, m] = mes.split('-')
    return `${MES_CURTO[Number(m) - 1]}/${ano.slice(2)}`
  }
  // y em pixels da linha de resultado (positivo acima do zero, negativo abaixo)
  const yResultado = (v: number) =>
    v >= 0 ? areaPos * (1 - v / maxPos) : areaPos + (maxNeg > 0 ? (-v / maxNeg) * areaNeg : 0)
  const xCentro = (i: number) => ((i + 0.5) / n) * 100

  const m = hover !== null ? serie[hover] : null

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {/* escala de referência */}
      {[1, 0.5].map((fracao) => (
        <div
          key={fracao}
          className="pointer-events-none absolute left-0 right-0 flex items-end justify-end"
          style={{ top: areaPos * (1 - fracao), borderTop: '1px dashed var(--gridline)', zIndex: 0 }}
        >
          <span className="pr-1 text-[10px] leading-none" style={{ color: 'var(--text-muted)', transform: 'translateY(-3px)' }}>
            {fmtBRLCurto(maxPos * fracao)}
          </span>
        </div>
      ))}

      <div className="relative" style={{ height: ALTURA }}>
        {/* wash da coluna sob o mouse */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 rounded-lg"
            style={{ left: `${(hover / n) * 100}%`, width: `${100 / n}%`, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
          />
        )}

        {/* barras de receita (menos espaço entre elas quando há muitos meses) */}
        <div className="absolute inset-0 flex items-end" style={{ gap: denso ? 1 : 4 }}>
          {serie.map((mes, i) => (
            <div key={mes.mes} className="flex h-full flex-1 items-end justify-center" style={{ height: areaPos }}>
              <div
                className="rounded-t-[3px] transition-all"
                style={{
                  width: denso ? '76%' : '58%',
                  height: Math.max((mes.receita / maxPos) * areaPos, mes.receita > 0 ? 2 : 0),
                  background: `linear-gradient(180deg, var(--serie-producao), color-mix(in srgb, var(--serie-producao) 55%, var(--surface-1)))`,
                  opacity: hover === null || hover === i ? 1 : 0.45,
                }}
              />
            </div>
          ))}
        </div>

        {/* linha do zero (quando há meses negativos) */}
        {areaNeg > 0 && (
          <div className="pointer-events-none absolute left-0 right-0" style={{ top: areaPos, borderTop: '1px solid var(--baseline)' }} />
        )}

        {/* linha de resultado */}
        <svg
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{ height: ALTURA, width: '100%' }}
          viewBox={`0 0 100 ${ALTURA}`}
          preserveAspectRatio="none"
        >
          <polyline
            points={serie.map((mes, i) => `${xCentro(i)},${yResultado(mes.resultado)}`).join(' ')}
            fill="none"
            stroke="var(--serie-resultado)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* pontos da linha (HTML p/ não distorcer): vermelho = mês negativo.
            Quando denso, só desenha o ponto nos meses de prejuízo e no mês sob o mouse
            — a linha já mostra a tendência; pontos demais viram ruído. */}
        {serie.map((mes, i) => {
          const negativo = mes.resultado < 0
          if (denso && !negativo && hover !== i) return null
          const raio = hover === i ? 5 : denso ? 3 : 4
          return (
            <div
              key={mes.mes}
              className="pointer-events-none absolute rounded-full transition-transform"
              style={{
                left: `calc(${xCentro(i)}% - ${raio}px)`,
                top: yResultado(mes.resultado) - raio,
                width: raio * 2,
                height: raio * 2,
                background: negativo ? 'var(--neg)' : 'var(--serie-resultado)',
                border: '2px solid var(--surface-1)',
              }}
            />
          )
        })}

        {/* zonas de hover por mês */}
        <div className="absolute inset-0 flex">
          {serie.map((mes, i) => (
            <div key={mes.mes} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
          ))}
        </div>

        {/* tooltip */}
        {m && hover !== null && (
          <div
            className="card pointer-events-none absolute z-10 px-3.5 py-2.5 text-xs"
            style={{
              left: `clamp(0%, calc(${xCentro(hover)}% - 90px), calc(100% - 185px))`,
              top: Math.max(yResultado(Math.max(m.resultado, 0)) - 120, 0),
              width: 185,
            }}
          >
            <div className="mb-1 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {rotulo(m.mes)}
            </div>
            {(
              [
                ['Receita', fmtBRL(m.receita), 'var(--serie-producao)'],
                ['Custos', fmtBRL(m.custos), 'var(--text-secondary)'],
                ['Impostos', fmtBRL(m.imposto), 'var(--serie-imposto)'],
                ['Resultado', fmtBRL(m.resultado), m.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)'],
              ] as const
            ).map(([r, v, cor]) => (
              <div key={r} className="flex justify-between gap-3">
                <span style={{ color: 'var(--text-muted)' }}>{r}</span>
                <b className="num" style={{ color: cor }}>{v}</b>
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-3 border-t pt-1" style={{ borderColor: 'var(--gridline)' }}>
              <span style={{ color: 'var(--text-muted)' }}>Margem</span>
              <b style={{ color: m.resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
                {m.receita > 0 ? fmtPct(m.resultado / m.receita) : '—'}
              </b>
            </div>
          </div>
        )}
      </div>

      <div className="mt-1 flex border-t pt-1" style={{ borderColor: 'var(--baseline)', gap: denso ? 1 : 4 }}>
        {serie.map((mes, i) => (
          <div
            key={mes.mes}
            className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-center text-[10px] font-semibold"
            style={{ color: hover === i ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            {/* rótulo afinado; NÃO força o do mês sob o mouse (colidiria com o vizinho —
                o cabeçalho do tooltip já mostra o mês) */}
            {mostraRotulo(i) ? rotulo(mes.mes) : ' '}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--serie-producao)' }} /> Receita (barras)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: 'var(--serie-resultado)' }} /> Resultado (linha
          — ponto vermelho = mês no prejuízo)
        </span>
      </div>
    </div>
  )
}

/** Para onde foi cada real: linha por grupo com barra proporcional, valor e % da receita. */
export function ComposicaoLinhas({ consolidado }: { consolidado: Consolidado }) {
  const receita = consolidado.receita || 1
  const linhas = [
    { rotulo: 'Produção', valor: consolidado.producao, cor: 'var(--serie-producao)' },
    { rotulo: 'Frete', valor: consolidado.frete, cor: 'var(--serie-frete)' },
    { rotulo: 'Impostos', valor: consolidado.imposto, cor: 'var(--serie-imposto)' },
    { rotulo: 'Comissão', valor: consolidado.comissao, cor: 'var(--serie-comissao)' },
    { rotulo: 'Outros', valor: consolidado.outros, cor: 'var(--serie-outros)' },
  ].filter((l) => l.valor > 0)
  const resultado = consolidado.resultado

  return (
    <div className="mt-3 grid gap-1.5">
      {linhas.map((l) => (
        <div key={l.rotulo} className="grid items-center gap-2" style={{ gridTemplateColumns: '84px 1fr 110px 52px' }}>
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: l.cor }} />
            {l.rotulo}
          </span>
          <div className="h-2 rounded-full" style={{ background: 'var(--surface-2)' }}>
            <div className="h-2 rounded-full" style={{ width: `${Math.min((l.valor / receita) * 100, 100)}%`, background: l.cor }} />
          </div>
          <span className="num text-xs font-bold">{fmtBRL(l.valor)}</span>
          <span className="num text-xs" style={{ color: 'var(--text-muted)' }}>{fmtPct(l.valor / receita)}</span>
        </div>
      ))}
      <div
        className="mt-1 grid items-center gap-2 border-t pt-2"
        style={{ gridTemplateColumns: '84px 1fr 110px 52px', borderColor: 'var(--gridline)' }}
      >
        <span className="text-xs font-extrabold">= Resultado</span>
        <div className="h-2 rounded-full" style={{ background: 'var(--surface-2)' }}>
          <div
            className="h-2 rounded-full"
            style={{
              width: `${Math.min((Math.abs(resultado) / receita) * 100, 100)}%`,
              background: resultado >= 0 ? 'var(--serie-resultado)' : 'var(--neg)',
            }}
          />
        </div>
        <span className="num text-xs font-extrabold" style={{ color: resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
          {fmtBRL(resultado)}
        </span>
        <span className="num text-xs font-bold" style={{ color: resultado >= 0 ? 'var(--status-good-text)' : 'var(--neg)' }}>
          {fmtPct(resultado / receita)}
        </span>
      </div>
    </div>
  )
}

// Ordem fixa e validada p/ daltonismo nos dois temas (comissão = magenta, após impostos)
export const SERIES = [
  { key: 'producao', label: 'Produção', cor: 'var(--serie-producao)' },
  { key: 'frete', label: 'Frete', cor: 'var(--serie-frete)' },
  { key: 'imposto', label: 'Impostos', cor: 'var(--serie-imposto)' },
  { key: 'comissao', label: 'Comissão', cor: 'var(--serie-comissao)' },
  { key: 'outros', label: 'Outros', cor: 'var(--serie-outros)' },
  { key: 'resultado', label: 'Resultado', cor: 'var(--serie-resultado)' },
] as const

export function KPICard({
  titulo,
  valor,
  sub,
  tom,
  dica,
  hero = false,
}: {
  titulo: string
  valor: string
  sub?: ReactNode
  tom?: 'pos' | 'neg'
  dica?: string
  hero?: boolean
}) {
  const acento = tom === 'neg' ? 'var(--neg)' : tom === 'pos' ? 'var(--status-good)' : 'var(--accent)'
  return (
    <div
      className={`card kpi px-4 py-3.5 ${hero ? 'kpi-hero' : ''}`}
      title={dica}
      style={hero ? ({ '--kpi-acento': acento } as React.CSSProperties) : undefined}
    >
      <div className="titulo-secao whitespace-nowrap">{titulo}</div>
      <div
        className="kpi-valor mt-1.5"
        style={{ color: tom === 'neg' ? 'var(--neg)' : tom === 'pos' ? 'var(--status-good-text)' : 'var(--text-primary)' }}
      >
        {valor}
      </div>
      {sub && (
        <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

/** Barra de composição da receita: produção/frete/impostos/outros + resultado (2px de gap entre segmentos). */
export function BarraComposicao({
  receita,
  producao,
  frete,
  imposto,
  comissao = 0,
  outros,
  resultado,
  compacta = false,
}: {
  receita: number
  producao: number
  frete: number
  imposto: number
  comissao?: number
  outros: number
  resultado: number
  compacta?: boolean
}) {
  if (receita <= 0) {
    return (
      <div
        className="w-full rounded"
        style={{ height: compacta ? 10 : 16, background: 'var(--gridline)' }}
        title="Sem receita no período"
      />
    )
  }
  const partes = [
    { label: 'Produção', valor: producao, cor: 'var(--serie-producao)' },
    { label: 'Frete', valor: frete, cor: 'var(--serie-frete)' },
    { label: 'Impostos', valor: imposto, cor: 'var(--serie-imposto)' },
    { label: 'Comissão', valor: comissao, cor: 'var(--serie-comissao)' },
    { label: 'Outros', valor: outros, cor: 'var(--serie-outros)' },
    { label: 'Resultado', valor: Math.max(resultado, 0), cor: 'var(--serie-resultado)' },
  ].filter((p) => p.valor > 0)
  const total = partes.reduce((s, p) => s + p.valor, 0)

  return (
    <div
      className="flex w-full overflow-hidden rounded"
      style={{ height: compacta ? 10 : 16, gap: 2, background: 'transparent' }}
      role="img"
      aria-label={partes.map((p) => `${p.label} ${fmtBRL(p.valor)}`).join(', ')}
    >
      {partes.map((p) => (
        <div
          key={p.label}
          style={{ width: `${(p.valor / total) * 100}%`, background: p.cor, borderRadius: 2, minWidth: 2 }}
          title={`${p.label}: ${fmtBRL(p.valor)} (${fmtPct(p.valor / receita)} da receita)`}
        />
      ))}
    </div>
  )
}

export function LegendaSeries({ incluirResultado = true }: { incluirResultado?: boolean }) {
  const itens = incluirResultado ? SERIES : SERIES.filter((s) => s.key !== 'resultado')
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
      {itens.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />
          {s.label}
        </span>
      ))}
    </div>
  )
}

/** Ranking de margem: barras horizontais divergentes (azul positivo, vermelho negativo) em HTML puro. */
export function RankingMargem({
  itens,
  aoClicar,
  alvo,
}: {
  itens: { chave: string; rotulo: string; margem: number; detalhe: string; receitaCurta?: string }[]
  aoClicar?: (chave: string) => void
  alvo?: number // meta de margem (fração) — vira linha tracejada e semáforo
}) {
  const maxAbs = Math.max(...itens.map((i) => Math.abs(i.margem)), alvo ?? 0, 0.0001)
  const posicaoAlvo = alvo !== undefined ? 50 + (alvo / maxAbs) * 50 : null

  const corDe = (margem: number) => {
    if (margem < 0) return 'var(--status-critical)'
    if (alvo !== undefined) return margem >= alvo ? 'var(--status-good)' : 'var(--status-warning)'
    return 'var(--pos)'
  }

  return (
    <div className="grid gap-1.5" role="list">
      {itens.map((i) => {
        const positivo = i.margem >= 0
        const largura = (Math.abs(i.margem) / maxAbs) * 100
        return (
          <div
            key={i.chave}
            className="flex items-center gap-2 rounded px-1 transition-colors"
            role="listitem"
            title={i.detalhe}
            style={aoClicar ? { cursor: 'pointer' } : undefined}
            onClick={aoClicar ? () => aoClicar(i.chave) : undefined}
            onMouseEnter={(e) => aoClicar && (e.currentTarget.style.background = 'color-mix(in srgb, var(--gridline) 50%, transparent)')}
            onMouseLeave={(e) => aoClicar && (e.currentTarget.style.background = 'transparent')}
          >
            <span className="w-32 shrink-0 truncate text-right text-xs" style={{ color: 'var(--text-secondary)' }}>
              {i.rotulo}
            </span>
            <div className="relative h-4 flex-1">
              <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--baseline)' }} />
              {posicaoAlvo !== null && posicaoAlvo <= 100 && (
                <div
                  className="absolute inset-y-0 w-0"
                  style={{ left: `${posicaoAlvo}%`, borderLeft: '1.5px dashed var(--text-muted)' }}
                  title={`Meta: ${fmtPct(alvo!)}`}
                />
              )}
              <div
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  background: corDe(i.margem),
                  left: positivo ? '50%' : `${50 - largura / 2}%`,
                  width: `${largura / 2}%`,
                  minWidth: 2,
                }}
              />
            </div>
            <span className="w-14 shrink-0 text-xs font-bold num" style={{ color: positivo ? 'var(--text-primary)' : 'var(--neg)' }}>
              {fmtPct(i.margem)}
            </span>
            {i.receitaCurta && (
              <span className="w-16 shrink-0 text-right text-[11px] num" style={{ color: 'var(--text-muted)' }}>
                {i.receitaCurta}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Nome curto da empresa: 1ª palavra (ou duas, se a 1ª for muito curta). */
export function siglaEmpresa(nome: string): string {
  const palavras = nome.trim().split(/\s+/)
  if (!palavras[0]) return nome
  return palavras[0].length >= 4 ? palavras[0] : palavras.slice(0, 2).join(' ')
}

/** Chips compactos para a lista "Empresa A, Empresa B" (tooltip com o nome completo). */
export function ChipsEmpresas({ empresas }: { empresas: string }) {
  const nomes = empresas.split(',').map((n) => n.trim()).filter(Boolean)
  return (
    <span className="inline-flex flex-wrap gap-1" title={empresas}>
      {nomes.map((nome) => (
        <span
          key={nome}
          className="rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap"
          style={{
            background: 'color-mix(in srgb, var(--serie-producao) 10%, transparent)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--gridline)',
          }}
        >
          {siglaEmpresa(nome)}
        </span>
      ))}
    </span>
  )
}

/** Semáforo de margem: verde = na meta, amarelo = lucro abaixo da meta, vermelho = prejuízo. */
export function BadgeMeta({ margem, receita, alvo }: { margem: number; receita: number; alvo: number }) {
  if (receita <= 0) {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }} title="Projeto ainda sem faturamento no período">
        Sem receita
      </span>
    )
  }
  const estado = margem < 0 ? 'prejuizo' : margem >= alvo ? 'meta' : 'abaixo'
  const cores = {
    meta: { bg: 'color-mix(in srgb, var(--status-good) 15%, transparent)', cor: 'var(--status-good-text)', rotulo: '● Na meta' },
    abaixo: { bg: 'color-mix(in srgb, var(--status-warning) 18%, transparent)', cor: 'var(--text-primary)', rotulo: '● Abaixo da meta' },
    prejuizo: { bg: 'color-mix(in srgb, var(--status-critical) 15%, transparent)', cor: 'var(--neg)', rotulo: '● Prejuízo' },
  }[estado]
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: cores.bg, color: cores.cor }}
      title={`Meta: ${(alvo * 100).toFixed(0)}% de margem (ajuste em Empresas → Preferências)`}
    >
      {cores.rotulo}
    </span>
  )
}

export function BadgeLucro({ resultado }: { resultado: number }) {
  const lucro = resultado >= 0
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        background: lucro
          ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
          : 'color-mix(in srgb, var(--status-critical) 15%, transparent)',
        color: lucro ? 'var(--status-good-text)' : 'var(--neg)',
      }}
    >
      {lucro ? '▲ Lucro' : '▼ Prejuízo'}
    </span>
  )
}
