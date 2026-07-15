import type { ReactNode } from 'react'
import type { MesFechamento } from '../api/client'
import { fmtBRL, fmtPct } from '../lib/format'

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function Skeleton({ altura = 20, largura = '100%' }: { altura?: number; largura?: number | string }) {
  return <div className="skeleton" style={{ height: altura, width: largura }} />
}

/** Variação percentual vs o período anterior, com seta e cor. */
export function Delta({ atual, anterior, invertido = false }: { atual: number; anterior: number; invertido?: boolean }) {
  if (!anterior) return null
  const variacao = (atual - anterior) / Math.abs(anterior)
  if (!isFinite(variacao)) return null
  const positivo = invertido ? variacao < 0 : variacao > 0
  return (
    <span
      className="font-semibold"
      style={{ color: positivo ? 'var(--status-good-text)' : 'var(--neg)' }}
      title={`Período anterior: ${fmtBRL(anterior)}`}
    >
      {variacao >= 0 ? '↑' : '↓'} {fmtPct(Math.abs(variacao))} vs anterior
    </span>
  )
}

/** Evolução mensal: barras de receita e resultado lado a lado, com linha de zero. */
export function GraficoMensal({ serie }: { serie: MesFechamento[] }) {
  if (!serie.length) return null
  const maxPos = Math.max(...serie.map((m) => Math.max(m.receita, m.resultado, 0)), 1)
  const maxNeg = Math.max(...serie.map((m) => Math.max(0, -m.resultado)), 0)
  const ALTURA = 150
  const areaPos = maxNeg > 0 ? ALTURA * (maxPos / (maxPos + maxNeg)) : ALTURA
  const areaNeg = ALTURA - areaPos

  const rotulo = (mes: string) => {
    const [ano, m] = mes.split('-')
    return `${MES_CURTO[Number(m) - 1]}/${ano.slice(2)}`
  }

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: ALTURA + 4 }}>
        {serie.map((m) => {
          const hReceita = (m.receita / maxPos) * areaPos
          const hResultado = (Math.abs(m.resultado) / (m.resultado >= 0 ? maxPos : maxNeg || 1)) * (m.resultado >= 0 ? areaPos : areaNeg)
          return (
            <div
              key={m.mes}
              className="group flex flex-1 flex-col items-center"
              title={`${rotulo(m.mes)} — receita ${fmtBRL(m.receita)} · custos ${fmtBRL(m.custos)} · impostos ${fmtBRL(m.imposto)} · resultado ${fmtBRL(m.resultado)}`}
            >
              <div className="relative flex w-full items-end justify-center gap-0.5" style={{ height: areaPos }}>
                <div
                  className="w-2/5 rounded-t-sm transition-opacity group-hover:opacity-80"
                  style={{ height: Math.max(hReceita, m.receita > 0 ? 2 : 0), background: 'var(--serie-producao)' }}
                />
                <div
                  className="w-2/5 rounded-t-sm transition-opacity group-hover:opacity-80"
                  style={{
                    height: m.resultado >= 0 ? Math.max(hResultado, m.resultado > 0 ? 2 : 0) : 0,
                    background: 'var(--status-good)',
                  }}
                />
              </div>
              {areaNeg > 0 && (
                <div
                  className="flex w-full items-start justify-center gap-0.5"
                  style={{ height: areaNeg, borderTop: '1px solid var(--baseline)' }}
                >
                  <div className="w-2/5" />
                  <div
                    className="w-2/5 rounded-b-sm transition-opacity group-hover:opacity-80"
                    style={{ height: m.resultado < 0 ? Math.max(hResultado, 2) : 0, background: 'var(--neg)' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1 border-t pt-1" style={{ borderColor: 'var(--baseline)' }}>
        {serie.map((m) => (
          <div key={m.mes} className="flex-1 text-center text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {rotulo(m.mes)}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--serie-producao)' }} /> Receita
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--status-good)' }} /> Resultado
          (vermelho quando negativo)
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
}: {
  titulo: string
  valor: string
  sub?: ReactNode
  tom?: 'pos' | 'neg'
  dica?: string
}) {
  return (
    <div className="card px-4 py-3.5" title={dica}>
      <div className="titulo-secao whitespace-nowrap">{titulo}</div>
      <div
        className="mt-1.5 leading-none font-extrabold tracking-tight whitespace-nowrap"
        style={{
          // nunca quebra linha: encolhe conforme a largura disponível
          fontSize: 'clamp(13px, 1.55vw, 24px)',
          fontVariantNumeric: 'tabular-nums',
          color: tom === 'neg' ? 'var(--neg)' : tom === 'pos' ? 'var(--status-good-text)' : 'var(--text-primary)',
        }}
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
}: {
  itens: { chave: string; rotulo: string; margem: number; detalhe: string }[]
  aoClicar?: (chave: string) => void
}) {
  const maxAbs = Math.max(...itens.map((i) => Math.abs(i.margem)), 0.0001)
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
            <span
              className="w-36 shrink-0 truncate text-right text-xs"
              style={{ color: 'var(--text-secondary)' }}
            >
              {i.rotulo}
            </span>
            <div className="relative h-4 flex-1">
              {/* linha de base no zero (centro) */}
              <div
                className="absolute inset-y-0 left-1/2 w-px"
                style={{ background: 'var(--baseline)' }}
              />
              <div
                className="absolute inset-y-0.5 rounded-sm"
                style={{
                  background: positivo ? 'var(--pos)' : 'var(--neg)',
                  left: positivo ? '50%' : `${50 - largura / 2}%`,
                  width: `${largura / 2}%`,
                  minWidth: 2,
                }}
              />
            </div>
            <span
              className="w-14 shrink-0 text-xs font-semibold num"
              style={{ color: positivo ? 'var(--text-primary)' : 'var(--neg)' }}
            >
              {fmtPct(i.margem)}
            </span>
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
