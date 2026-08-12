import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

/** Paleta de comandos (Ctrl+K): o caminho mais curto até qualquer coisa.
 *
 * Com centenas de projetos, "achar o BR25_600" é o gesto mais repetido do app.
 * Aqui ele vira: Ctrl+K, "600", Enter. Busca projetos (número e cliente) e as
 * telas do menu; guarda os últimos acessos para o dia a dia de conferência.
 */

export interface TelaDaPaleta {
  to: string
  label: string
  secao: string
  icone: React.ReactNode
}

interface Recente {
  tipo: 'projeto' | 'tela'
  chave: string // rota da tela ou nome do projeto
  rotulo: string
  detalhe: string
}

type Item =
  | { tipo: 'tela'; tela: TelaDaPaleta }
  | { tipo: 'projeto'; nome: string; cliente: string; empresas: string }
  | { tipo: 'recente'; recente: Recente }

const CHAVE_RECENTES = 'paleta_recentes_v1'

function lerRecentes(): Recente[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]')
    return Array.isArray(bruto) ? bruto.slice(0, 6) : []
  } catch {
    return []
  }
}

function guardarRecente(novo: Recente): void {
  const lista = [novo, ...lerRecentes().filter((r) => !(r.tipo === novo.tipo && r.chave === novo.chave))]
  localStorage.setItem(CHAVE_RECENTES, JSON.stringify(lista.slice(0, 6)))
}

/** Busca sem acento e sem caixa — "exportacao" acha "Exportação". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function alvoEditavel(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export default function Paleta({ telas, buscaProjetos }: { telas: TelaDaPaleta[]; buscaProjetos: boolean }) {
  const [aberta, setAberta] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [indice, setIndice] = useState(0)
  const entradaRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // preserva os filtros globais (empresas/período) ao navegar, como o menu faz
  const sufixoFiltros = useMemo(() => {
    const f = new URLSearchParams()
    for (const chave of ['empresas', 'de', 'ate']) {
      const valor = params.get(chave)
      if (valor) f.set(chave, valor)
    }
    return f.toString()
  }, [params])

  // atalhos globais: Ctrl/Cmd+K em qualquer lugar; "/" fora de campos de texto
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAberta((a) => !a)
      } else if (e.key === '/' && !aberta && !alvoEditavel(e)) {
        e.preventDefault()
        setAberta(true)
      } else if (e.key === 'Escape' && aberta) {
        setAberta(false)
      }
    }
    const aoAbrirPorBotao = () => setAberta(true)
    window.addEventListener('keydown', aoTeclar)
    window.addEventListener('abrir-paleta', aoAbrirPorBotao)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('abrir-paleta', aoAbrirPorBotao)
    }
  }, [aberta])

  useEffect(() => {
    if (aberta) {
      setConsulta('')
      setIndice(0)
      // setTimeout, não requestAnimationFrame: rAF não dispara em aba/painel que
      // não está compositando (aba em segundo plano) e o foco nunca chegaria
      setTimeout(() => entradaRef.current?.focus(), 0)
    }
  }, [aberta])

  // a mesma query key das páginas: se o Dashboard já carregou, aqui é instantâneo
  const empresaIds = params.get('empresas') || undefined
  const de = params.get('de') || undefined
  const ate = params.get('ate') || undefined
  const { data } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
    enabled: aberta && buscaProjetos,
    staleTime: 60_000,
  })

  const itens = useMemo<{ grupo: string; itens: Item[] }[]>(() => {
    const q = norm(consulta.trim())
    if (!q) {
      const recentes = lerRecentes()
      const grupos: { grupo: string; itens: Item[] }[] = []
      if (recentes.length) grupos.push({ grupo: 'Recentes', itens: recentes.map((r) => ({ tipo: 'recente', recente: r })) })
      grupos.push({ grupo: 'Telas', itens: telas.map((t) => ({ tipo: 'tela', tela: t })) })
      return grupos
    }

    const telasAchadas: Item[] = telas
      .filter((t) => norm(t.label).includes(q) || norm(t.secao).includes(q))
      .map((t) => ({ tipo: 'tela', tela: t }))

    const projetosAchados: Item[] = (data?.projetos || [])
      .map((p) => {
        const pontos = norm(p.projeto).startsWith(q)
          ? 0
          : norm(p.projeto).includes(q)
            ? 1
            : norm(p.cliente || '').includes(q)
              ? 2
              : -1
        return { p, pontos }
      })
      .filter((x) => x.pontos >= 0)
      .sort((a, b) => a.pontos - b.pontos || b.p.receita - a.p.receita)
      .slice(0, 8)
      .map(({ p }) => ({ tipo: 'projeto', nome: p.projeto, cliente: p.cliente || '', empresas: p.empresas }))

    const grupos: { grupo: string; itens: Item[] }[] = []
    if (projetosAchados.length) grupos.push({ grupo: 'Projetos', itens: projetosAchados })
    if (telasAchadas.length) grupos.push({ grupo: 'Telas', itens: telasAchadas })
    return grupos
  }, [consulta, data, telas])

  const planos = useMemo(() => itens.flatMap((g) => g.itens), [itens])

  useEffect(() => setIndice(0), [consulta])

  const abrir = useCallback(
    (item: Item) => {
      setAberta(false)
      const sufixo = sufixoFiltros ? `&${sufixoFiltros}` : ''
      if (item.tipo === 'tela') {
        guardarRecente({ tipo: 'tela', chave: item.tela.to, rotulo: item.tela.label, detalhe: item.tela.secao })
        navigate(`${item.tela.to}${sufixoFiltros ? `?${sufixoFiltros}` : ''}`)
      } else if (item.tipo === 'projeto') {
        guardarRecente({ tipo: 'projeto', chave: item.nome, rotulo: item.nome, detalhe: item.cliente })
        navigate(`/projeto?nome=${encodeURIComponent(item.nome)}${sufixo}`)
      } else if (item.recente.tipo === 'tela') {
        navigate(`${item.recente.chave}${sufixoFiltros ? `?${sufixoFiltros}` : ''}`)
      } else {
        navigate(`/projeto?nome=${encodeURIComponent(item.recente.chave)}${sufixo}`)
      }
    },
    [navigate, sufixoFiltros],
  )

  const aoTeclarNaEntrada = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndice((i) => (i + 1) % Math.max(planos.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice((i) => (i - 1 + Math.max(planos.length, 1)) % Math.max(planos.length, 1))
    } else if (e.key === 'Enter' && planos[indice]) {
      abrir(planos[indice])
    }
  }

  // o item ativo acompanha a rolagem da lista
  useEffect(() => {
    listaRef.current?.querySelector('[data-ativa="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [indice, itens])

  if (!aberta) return null

  let posicao = -1
  return (
    <div className="paleta-fundo" onClick={() => setAberta(false)} role="presentation">
      <div className="paleta" role="dialog" aria-modal="true" aria-label="Busca rápida" onClick={(e) => e.stopPropagation()}>
        <div className="paleta-topo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            ref={entradaRef}
            className="paleta-entrada"
            placeholder={buscaProjetos ? 'Buscar projeto, cliente ou tela…' : 'Ir para a tela…'}
            aria-label="Buscar projeto, cliente ou tela"
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            onKeyDown={aoTeclarNaEntrada}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="paleta-lista" ref={listaRef} role="listbox" aria-label="Resultados">
          {planos.length === 0 && (
            <p className="px-4 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
              Nada encontrado para “{consulta}”.
              {buscaProjetos && !data && ' (carregando os projetos…)'}
            </p>
          )}
          {itens.map((grupo) => (
            <div key={grupo.grupo}>
              <div className="paleta-grupo">{grupo.grupo}</div>
              {grupo.itens.map((item) => {
                posicao += 1
                const aqui = posicao
                const ativa = aqui === indice
                const chave =
                  item.tipo === 'tela' ? item.tela.to : item.tipo === 'projeto' ? item.nome : `${item.recente.tipo}:${item.recente.chave}`
                return (
                  <button
                    key={chave}
                    className="paleta-item"
                    data-ativa={ativa}
                    role="option"
                    aria-selected={ativa}
                    onMouseEnter={() => setIndice(aqui)}
                    onClick={() => abrir(item)}
                  >
                    {item.tipo === 'tela' ? (
                      <>
                        <span className="paleta-icone">{item.tela.icone}</span>
                        <span className="min-w-0 flex-1 truncate text-left">{item.tela.label}</span>
                        <span className="paleta-detalhe">{item.tela.secao}</span>
                      </>
                    ) : item.tipo === 'projeto' ? (
                      <>
                        <span className="paleta-selo">BR</span>
                        <span className="min-w-0 flex-1 truncate text-left font-semibold">{item.nome}</span>
                        <span className="paleta-detalhe">{item.cliente || item.empresas}</span>
                      </>
                    ) : (
                      <>
                        <span className="paleta-icone" aria-hidden>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 7v5l3 2" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">{item.recente.rotulo}</span>
                        <span className="paleta-detalhe">{item.recente.detalhe}</span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="paleta-rodape">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Ctrl</kbd> <kbd>K</kbd> abrir/fechar</span>
        </div>
      </div>
    </div>
  )
}
