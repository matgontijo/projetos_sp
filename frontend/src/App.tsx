import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Empresas from './pages/Empresas'
import ProjetoDetalhe from './pages/ProjetoDetalhe'
import Projetos from './pages/Projetos'
import Sincronizar from './pages/Sincronizar'

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projetos', label: 'Projetos' },
  { to: '/sincronizar', label: 'Sincronizar' },
  { to: '/empresas', label: 'Empresas' },
]

export default function App() {
  const [usuario, setUsuario] = useState(() => localStorage.getItem('usuario') || '')
  useEffect(() => {
    localStorage.setItem('usuario', usuario)
  }, [usuario])

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-10 flex items-center gap-6 px-6 py-3"
        style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-hairline)' }}
      >
        <h1 className="text-base font-bold whitespace-nowrap">Fechamento de Projetos</h1>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
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
          <label htmlFor="usuario">Usuário:</label>
          <input
            id="usuario"
            className="input w-40"
            placeholder="seu nome (auditoria)"
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
