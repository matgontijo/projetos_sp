import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'

export interface Filtros {
  empresaIds: string | undefined // csv de ids; undefined = todas ativas
  de: string | undefined
  ate: string | undefined
}

export function useFiltros(): Filtros & { params: URLSearchParams; set: (k: string, v: string) => void } {
  const [params, setParams] = useSearchParams()
  return {
    empresaIds: params.get('empresas') || undefined,
    de: params.get('de') || undefined,
    ate: params.get('ate') || undefined,
    params,
    set: (k, v) => {
      const novo = new URLSearchParams(params)
      if (v) novo.set(k, v)
      else novo.delete(k)
      setParams(novo, { replace: true })
    },
  }
}

export function FiltrosBar() {
  const { empresaIds, de, ate, set } = useFiltros()
  const { data: empresas } = useQuery({ queryKey: ['empresas'], queryFn: api.listarEmpresas })
  const selecionadas = new Set((empresaIds || '').split(',').filter(Boolean).map(Number))

  function alternarEmpresa(id: number) {
    const novo = new Set(selecionadas)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    set('empresas', [...novo].join(','))
  }

  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        Filtros
      </span>
      <div className="flex flex-wrap gap-1.5">
        {(empresas || []).map((e) => {
          const ativa = selecionadas.size === 0 || selecionadas.has(e.id)
          return (
            <button
              key={e.id}
              onClick={() => alternarEmpresa(e.id)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                borderColor: ativa ? 'var(--serie-producao)' : 'var(--baseline)',
                background: ativa ? 'color-mix(in srgb, var(--serie-producao) 12%, transparent)' : 'transparent',
                color: ativa ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
              title={selecionadas.size === 0 ? 'Todas as empresas (clique para filtrar)' : undefined}
            >
              {e.nome}
            </button>
          )
        })}
        {empresas && empresas.length === 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            nenhuma empresa cadastrada
          </span>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2 text-sm">
        <label style={{ color: 'var(--text-muted)' }}>De</label>
        <input type="date" className="input" value={de || ''} onChange={(e) => set('de', e.target.value)} />
        <label style={{ color: 'var(--text-muted)' }}>Até</label>
        <input type="date" className="input" value={ate || ''} onChange={(e) => set('ate', e.target.value)} />
      </div>
    </div>
  )
}
