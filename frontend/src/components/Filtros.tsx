import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { siglaEmpresa } from './Viz'

export interface Filtros {
  empresaIds: string | undefined // csv de ids; undefined = todas ativas
  de: string | undefined
  ate: string | undefined
}

export function useFiltros(): Filtros & {
  params: URLSearchParams
  set: (k: string, v: string) => void
  setMany: (entradas: Record<string, string>) => void
} {
  const [params, setParams] = useSearchParams()
  const setMany = (entradas: Record<string, string>) => {
    const novo = new URLSearchParams(params)
    for (const [k, v] of Object.entries(entradas)) {
      if (v) novo.set(k, v)
      else novo.delete(k)
    }
    setParams(novo, { replace: true })
  }
  return {
    empresaIds: params.get('empresas') || undefined,
    de: params.get('de') || undefined,
    ate: params.get('ate') || undefined,
    params,
    set: (k, v) => setMany({ [k]: v }),
    setMany,
  }
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function FiltrosBar() {
  const { empresaIds, de, ate, set, setMany } = useFiltros()
  // No celular as datas ficam atras de um chip: quem usa preset nunca as ve.
  // Se ja ha data custom na URL, abrem expandidas (senao o filtro ficaria oculto).
  const [mostrarDatas, setMostrarDatas] = useState(Boolean(de || ate))
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const selecionadas = new Set((empresaIds || '').split(',').filter(Boolean).map(Number))

  function alternarEmpresa(id: number) {
    const novo = new Set(selecionadas)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    set('empresas', [...novo].join(','))
  }

  function periodo(deNovo: string, ateNovo: string) {
    setMany({ de: deNovo, ate: ateNovo })
  }

  const hoje = new Date()
  const presets = [
    { rotulo: `Ano ${hoje.getFullYear()}`, de: `${hoje.getFullYear()}-01-01`, ate: iso(hoje) },
    { rotulo: 'Últimos 90 dias', de: iso(new Date(hoje.getTime() - 90 * 864e5)), ate: iso(hoje) },
    { rotulo: '12 meses', de: iso(new Date(hoje.getTime() - 365 * 864e5)), ate: iso(hoje) },
    { rotulo: 'Tudo', de: '', ate: '' },
  ]

  return (
    <div
      className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-b pb-3.5"
      style={{ borderColor: 'var(--gridline)' }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="titulo-secao mr-1">Empresas</span>
        {(empresas || []).map((e) => {
          const ativa = selecionadas.size === 0 || selecionadas.has(e.id)
          return (
            <button
              key={e.id}
              onClick={() => alternarEmpresa(e.id)}
              className="rounded-full border px-3 py-1 text-xs font-semibold"
              style={{
                borderColor: ativa ? 'var(--accent)' : 'var(--baseline)',
                background: ativa ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                color: ativa ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              title={e.nome}
            >
              {siglaEmpresa(e.nome)}
            </button>
          )
        })}
        {empresas && empresas.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            nenhuma empresa conectada
          </span>
        )}
      </div>
      {/* no celular ocupa a linha inteira; as datas dividem a largura meio a meio */}
      <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
        <span className="titulo-secao mr-1">Período</span>
        {presets.map((p) => {
          const ativo = (de || '') === p.de && (ate || '') === p.ate
          return (
            <button
              key={p.rotulo}
              className="chip-preset"
              style={ativo ? { borderColor: 'var(--accent)', color: 'var(--text-primary)' } : undefined}
              onClick={() => periodo(p.de, p.ate)}
            >
              {p.rotulo}
            </button>
          )
        })}
        <button
          className="chip-preset sm:hidden"
          style={mostrarDatas || de || ate ? { borderColor: 'var(--accent)', color: 'var(--text-primary)' } : undefined}
          onClick={() => setMostrarDatas(!mostrarDatas)}
        >
          Datas…
        </button>
        {/* Datas com rótulo em cima: no iPhone um date vazio é uma caixa cega —
            sem o "de/até" escrito, ninguém sabe o que aquilo é. No celular as
            duas dividem a linha meio a meio; no desktop ficam compactas. */}
        <div className={`${mostrarDatas ? 'flex' : 'hidden'} w-full items-end gap-2 sm:flex sm:w-auto`}>
          <label className="campo-data min-w-0 flex-1 sm:flex-none">
            <span>de</span>
            <input
              type="date"
              className="input w-full sm:w-auto"
              aria-label="Data inicial do período"
              value={de || ''}
              onChange={(e) => set('de', e.target.value)}
            />
          </label>
          <label className="campo-data min-w-0 flex-1 sm:flex-none">
            <span>até</span>
            <input
              type="date"
              className="input w-full sm:w-auto"
              aria-label="Data final do período"
              value={ate || ''}
              onChange={(e) => set('ate', e.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
