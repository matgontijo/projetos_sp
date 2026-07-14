import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Empresas from './pages/Empresas'
import ProjetoDetalhe from './pages/ProjetoDetalhe'
import Projetos from './pages/Projetos'
import Sincronizar from './pages/Sincronizar'

const LINKS = [
  { to: '/dashboard', label: 'Visão geral' },
  { to: '/projetos', label: 'Projetos' },
  { to: '/sincronizar', label: 'Buscar dados' },
  { to: '/empresas', label: 'Empresas' },
]

export default function App() {
  const [usuario, setUsuario] = useState(() => localStorage.getItem('usuario') || '')
  useEffect(() => {
    localStorage.setItem('usuario', usuario)
  }, [usuario])

  // preserva os filtros (empresas/período) ao navegar pelo menu superior
  const [params] = useSearchParams()
  const filtros = new URLSearchParams()
  for (const chave of ['empresas', 'de', 'ate']) {
    const valor = params.get(chave)
    if (valor) filtros.set(chave, valor)
  }
  const sufixoFiltros = filtros.toString() ? `?${filtros.toString()}` : ''

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 flex items-center gap-6 px-6 py-3"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-hairline)' }}
      >
        <div className="flex items-center gap-2.5 whitespace-nowrap">
          <span
            className="grid h-8 w-8 place-items-center rounded-lg text-sm font-black text-white"
            style={{ background: 'linear-gradient(135deg, var(--serie-producao), var(--serie-resultado))' }}
            aria-hidden
          >
            F
          </span>
          <div className="leading-tight">
            <div className="text-sm font-bold">Fechamento de Projetos</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              JPDV + Cherry House · Omie
            </div>
          </div>
        </div>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={`${l.to}${sufixoFiltros}`}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={({ isActive }) => ({
                background: isActive ? 'var(--serie-producao)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-secondary)',
              })}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <label htmlFor="usuario" title="Seu nome fica registrado quando você faz um ajuste manual">
            Quem está usando:
          </label>
          <input
            id="usuario"
            className="input w-40"
            placeholder="seu nome"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projetos" element={<Projetos />} />
          <Route path="/projeto" element={<ProjetoDetalhe />} />
          <Route path="/sincronizar" element={<Sincronizar />} />
          <Route path="/empresas" element={<Empresas />} />
        </Routes>
      </main>
    </div>
  )
}
