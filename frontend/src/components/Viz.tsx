import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Consolidado, MesFechamento } from '../api/client'
import { fmtBRL, fmtBRLCurto, fmtPct } from '../lib/format'

/** Número que CONTA até o valor (750ms, easing suave). Anima na 1ª carga e a cada
    mudança de filtro; com "reduzir movimento" ativo, mostra direto o valor final. */
export function ValorContado({
  valor,
  formato,
  className,
  style,
}: {
  valor: number
  formato: (v: number) => string
  className?: string
  style?: React.CSSProperties
}) {
  const [mostrado, setMostrado] = useState(0)
  const anterior = useRef(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      anterior.current = valor
      setMostrado(valor)
      return
    }
    const de = anterior.current
    anterior.current = valor
    const inicio = performance.now()
    const duracao = 750
    let raf = 0
    const passo = (t: number) => {
      const p = Math.min((t - inicio) / duracao, 1)
      const suave = 1 - Math.pow(1 - p, 3)
      setMostrado(de + (valor - de) * suave)
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [valor])
  return (
    <span className={className} style={style}>
      {formato(mostrado)}
    </span>
  )
}

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

/** Evolução mensal INTERATIVA: arraste p/ selecionar um período (amplia), role p/
    zoom no cursor, arraste ampliado p/ deslizar, duplo clique restaura — e dá para
    aplicar o recorte visível ao filtro da página inteira. */
export function GraficoMensal({
  serie,
  aoFiltrarPeriodo,
}: {
  serie: MesFechamento[]
  aoFiltrarPeriodo?: (de: string, ate: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [janela, setJanela] = useState<[number, number] | null>(null)
  const [selecao, setSelecao] = useState<[number, number] | null>(null) // frações 0–1 do brush
  const [arrastando, setArrastando] = useState(false)
  const areaRef = useRef<HTMLDivElement>(null)
  const gesto = useRef<{ tipo: 'brush' | 'pan'; x0: number; moveu: boolean; janela0: [number, number] } | null>(null)

  const total = serie.length
  const [i0, i1] = janela ?? [0, Math.max(total - 1, 0)]
  const visivel = serie.slice(i0, i1 + 1)
  const n = visivel.length

  // limites da janela p/ os handlers (recalculados a cada render)
  const fracaoDe = (clientX: number) => {
    const r = areaRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    return Math.min(Math.max((clientX - r.left) / r.width, 0), 1)
  }

  const aplicarZoom = (foco: number, fator: number) => {
    const span = i1 - i0 + 1
    const novoSpan = Math.min(Math.max(Math.round(span * fator), 3), total)
    if (novoSpan >= total) {
      setJanela(null)
      return
    }
    const centro = i0 + foco * span
    const novoI0 = Math.min(Math.max(Math.round(centro - foco * novoSpan), 0), total - novoSpan)
    setJanela([novoI0, novoI0 + novoSpan - 1])
  }

  // roda do mouse = zoom no cursor (listener manual: React registra wheel como passivo)
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    const aoRolar = (e: WheelEvent) => {
      e.preventDefault()
      aplicarZoom(fracaoDe(e.clientX), e.deltaY > 0 ? 1.3 : 0.75)
    }
    el.addEventListener('wheel', aoRolar, { passive: false })
    return () => el.removeEventListener('wheel', aoRolar)
  })

  // hover pela POSIÇÃO do ponteiro (não por mouseenter): é o que faz o toque
  // mostrar os valores da coluna — dedo não dispara mouseenter direito
  const hoverDe = (clientX: number) => setHover(Math.min(Math.floor(fracaoDe(clientX) * n), n - 1))

  const aoPressionar = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    ;(e.target as HTMLElement).closest('[data-area-grafico]')?.setPointerCapture?.(e.pointerId)
    gesto.current = { tipo: janela ? 'pan' : 'brush', x0: e.clientX, moveu: false, janela0: [i0, i1] }
    setArrastando(true)
    hoverDe(e.clientX)
  }

  const aoMover = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') hoverDe(e.clientX)
    const g = gesto.current
    if (!g) return
    if (Math.abs(e.clientX - g.x0) > 4) g.moveu = true
    if (!g.moveu) return
    if (g.tipo === 'brush') {
      setSelecao([fracaoDe(g.x0), fracaoDe(e.clientX)])
    } else {
      const r = areaRef.current?.getBoundingClientRect()
      if (!r || r.width === 0) return
      const span = g.janela0[1] - g.janela0[0] + 1
      const deltaMeses = Math.round(((g.x0 - e.clientX) / r.width) * span)
      const novoI0 = Math.min(Math.max(g.janela0[0] + deltaMeses, 0), total - span)
      setJanela([novoI0, novoI0 + span - 1])
    }
  }

  const aoSoltar = () => {
    const g = gesto.current
    gesto.current = null
    setArrastando(false)
    if (g?.tipo === 'brush' && g.moveu && selecao) {
      const [fa, fb] = [Math.min(selecao[0], selecao[1]), Math.max(selecao[0], selecao[1])]
      const a = i0 + Math.floor(fa * n)
      const b = i0 + Math.min(Math.ceil(fb * n) - 1, n - 1)
      if (b - a >= 1) setJanela([Math.max(a, 0), Math.min(b, total - 1)])
    }
    setSelecao(null)
  }

  if (!total) return null

  const maxPos = Math.max(...visivel.map((m) => Math.max(m.receita, m.resultado, 0)), 1)
  const maxNeg = Math.max(...visivel.map((m) => Math.max(0, -m.resultado)), 0)
  const ALTURA = 210
  const areaPos = maxNeg > 0 ? ALTURA * (maxPos / (maxPos + maxNeg)) : ALTURA
  const areaNeg = ALTURA - areaPos
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
  const yReceita = (v: number) => areaPos * (1 - Math.max(v, 0) / maxPos)
  const xCentro = (i: number) => ((i + 0.5) / n) * 100

  const m = hover !== null ? visivel[hover] : null

  const ultimoDia = (mes: string) => {
    const [a, mm] = mes.split('-').map(Number)
    return `${mes}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}`
  }

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {/* barra de controles do zoom */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {janela
            ? `${rotulo(visivel[0].mes)} – ${rotulo(visivel[n - 1].mes)} · ${n} meses (arraste para deslizar)`
            : 'Arraste para ampliar um período · role o mouse para zoom'}
        </span>
        <span className="flex items-center gap-1.5">
          <button className="chip-preset px-2.5" title="Menos zoom" aria-label="Menos zoom" onClick={() => aplicarZoom(0.5, 1.6)}>
            −
          </button>
          <button className="chip-preset px-2.5" title="Mais zoom" aria-label="Mais zoom" onClick={() => aplicarZoom(0.5, 0.6)}>
            +
          </button>
          {janela && (
            <>
              <button className="chip-preset" onClick={() => setJanela(null)}>
                Tudo
              </button>
              {aoFiltrarPeriodo && (
                <button
                  className="chip-preset"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  title="Aplica estes meses como filtro de período da página inteira"
                  onClick={() => aoFiltrarPeriodo(`${visivel[0].mes}-01`, ultimoDia(visivel[n - 1].mes))}
                >
                  Usar como filtro
                </button>
              )}
            </>
          )}
        </span>
      </div>
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

      <div
        ref={areaRef}
        data-area-grafico
        className="relative select-none"
        style={{ height: ALTURA, cursor: arrastando ? (janela ? 'grabbing' : 'crosshair') : janela ? 'grab' : 'crosshair', touchAction: 'pan-y' }}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
        onDoubleClick={() => setJanela(null)}
      >
        {/* wash da coluna sob o mouse */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute inset-y-0 rounded-lg"
            style={{ left: `${(hover / n) * 100}%`, width: `${100 / n}%`, background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
          />
        )}
        {/* crosshair: o fio vertical marca exatamente o mês em leitura */}
        {hover !== null && (
          <div
            data-crosshair
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: `${xCentro(hover)}%`,
              width: 1,
              background: 'color-mix(in srgb, var(--text-muted) 55%, transparent)',
            }}
          />
        )}

        {/* seleção do arrasto (brush) */}
        {selecao && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 rounded-md"
            style={{
              left: `${Math.min(selecao[0], selecao[1]) * 100}%`,
              width: `${Math.abs(selecao[1] - selecao[0]) * 100}%`,
              background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
            }}
          />
        )}

        {/* área de receita (azul-marinho): se desenha da esquerda p/ direita */}
        <svg
          className="anima-desenho pointer-events-none absolute inset-x-0 top-0"
          style={{ height: ALTURA, width: '100%' }}
          viewBox={`0 0 100 ${ALTURA}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="grad-receita" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--serie-producao)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--serie-producao)" stopOpacity="0.03" />
            </linearGradient>
          </defs>
          <polygon
            points={`${visivel.map((mes, i) => `${xCentro(i)},${yReceita(mes.receita)}`).join(' ')} ${xCentro(n - 1)},${areaPos} ${xCentro(0)},${areaPos}`}
            fill="url(#grad-receita)"
          />
          <polyline
            points={visivel.map((mes, i) => `${xCentro(i)},${yReceita(mes.receita)}`).join(' ')}
            fill="none"
            stroke="var(--serie-producao)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* ponto da receita no mês sob o mouse */}
        {hover !== null && (
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              left: `calc(${xCentro(hover)}% - 4px)`,
              top: yReceita(visivel[hover].receita) - 4,
              width: 8,
              height: 8,
              background: 'var(--serie-producao)',
              border: '2px solid var(--surface-1)',
            }}
          />
        )}

        {/* linha do zero (quando há meses negativos) */}
        {areaNeg > 0 && (
          <div className="pointer-events-none absolute left-0 right-0" style={{ top: areaPos, borderTop: '1px solid var(--baseline)' }} />
        )}

        {/* linha de resultado: se desenha da esquerda p/ direita, com área e brilho */}
        <svg
          className="anima-desenho pointer-events-none absolute inset-x-0 top-0"
          style={{ height: ALTURA, width: '100%' }}
          viewBox={`0 0 100 ${ALTURA}`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="grad-resultado" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--serie-resultado)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--serie-resultado)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon
            points={`${visivel.map((mes, i) => `${xCentro(i)},${yResultado(mes.resultado)}`).join(' ')} ${xCentro(n - 1)},${areaPos} ${xCentro(0)},${areaPos}`}
            fill="url(#grad-resultado)"
          />
          <polyline
            points={visivel.map((mes, i) => `${xCentro(i)},${yResultado(mes.resultado)}`).join(' ')}
            fill="none"
            stroke="var(--serie-resultado)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ filter: 'drop-shadow(0 1px 5px color-mix(in srgb, var(--serie-resultado) 60%, transparent))' }}
          />
        </svg>
        {/* pontos da linha (HTML p/ não distorcer): vermelho = mês negativo.
            Quando denso, só desenha o ponto nos meses de prejuízo e no mês sob o mouse
            — a linha já mostra a tendência; pontos demais viram ruído. */}
        {visivel.map((mes, i) => {
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
          {visivel.map((mes, i) => (
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
        {visivel.map((mes, i) => (
          <div
            key={mes.mes}
            className="flex-1 whitespace-nowrap text-center text-[10px] font-semibold"
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
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--serie-producao)' }} /> Receita (área)
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
            <div
              className="anima-largura h-2 rounded-full"
              style={{ width: `${Math.min((l.valor / receita) * 100, 100)}%`, background: l.cor }}
            />
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
  numero,
  formato,
  sub,
  tom,
  dica,
  hero = false,
}: {
  titulo: string
  valor: string
  numero?: number // com `formato`, o valor CONTA até o número (anima)
  formato?: (v: number) => string
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
        {numero !== undefined && formato ? <ValorContado valor={numero} formato={formato} /> : valor}
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
      {partes.map((p, i) => (
        <div
          key={p.label}
          className="anima-largura"
          style={{
            width: `${(p.valor / total) * 100}%`,
            background: p.cor,
            borderRadius: 2,
            minWidth: 2,
            animationDelay: `${i * 0.06}s`,
          }}
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
      {itens.map((i, idx) => {
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
                className="anima-largura absolute inset-y-0.5 rounded-sm"
                style={{
                  background: corDe(i.margem),
                  left: positivo ? '50%' : `${50 - largura / 2}%`,
                  width: `${largura / 2}%`,
                  minWidth: 2,
                  transformOrigin: positivo ? 'left' : 'right',
                  animationDelay: `${Math.min(idx * 0.035, 0.5)}s`,
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
    <span className="inline-flex gap-1 whitespace-nowrap" title={empresas}>
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
