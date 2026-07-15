import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { ICONES } from './components/Layout'
import Analises from './pages/Analises'
import Dashboard from './pages/Dashboard'
import Empresas from './pages/Empresas'
import ProjetoDetalhe from './pages/ProjetoDetalhe'
import Projetos from './pages/Projetos'
import Simulador from './pages/Simulador'
import Sincronizar from './pages/Sincronizar'

const LINKS = [
  { to: '/dashboard', label: 'Visão geral', icone: ICONES.visao },
  { to: '/projetos', label: 'Projetos', icone: ICONES.projetos, tambem: '/projeto' },
  { to: '/analises', label: 'Análises', icone: ICONES.analises },
  { to: '/simulador', label: 'Simulador', icone: ICONES.simulador },
  { to: '/sincronizar', label: 'Buscar dados', icone: ICONES.buscar },
  { to: '/empresas', label: 'Empresas', icone: ICONES.empresas },
]

export default function App() {
  const [usuario, setUsuario] = useState(() => localStorage.getItem('usuario') || '')
  useEffect(() => {
    localStorage.setItem('usuario', usuario)
  }, [usuario])

  // preserva os filtros (empresas/período) ao navegar pelo menu
  const [params] = useSearchParams()
  const filtros = new URLSearchParams()
  for (const chave of ['empresas', 'de', 'ate']) {
    const valor = params.get(chave)
    if (valor) filtros.set(chave, valor)
  }
  const sufixoFiltros = filtros.toString() ? `?${filtros.toString()}` : ''

  const marca = (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black text-white"
        style={{ background: 'linear-gradient(135deg, var(--serie-producao), var(--serie-resultado))' }}
        aria-hidden
      >
        F
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-extrabold tracking-tight">Fechamento</div>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          de projetos · Omie
        </div>
      </div>
    </div>
  )

  const itens = LINKS.map((l) => (
    <NavLink
      key={l.to}
      to={`${l.to}${sufixoFiltros}`}
      className={({ isActive }) =>
        `sidebar-item ${isActive || (l.tambem && location.pathname.startsWith(l.tambem)) ? 'sidebar-item-ativo' : ''}`
      }
    >
      {l.icone}
      <span>{l.label}</span>
    </NavLink>
  ))

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 px-4 py-5 md:flex"
        style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border-hairline)' }}
      >
        <div className="mb-5 px-1">{marca}</div>
        <nav className="grid gap-1">{itens}</nav>
        <div className="mt-auto grid gap-1.5 px-1">
          <label htmlFor="usuario" className="titulo-secao" title="Seu nome fica registrado quando você faz um ajuste manual">
            Quem está usando
          </label>
          <input
            id="usuario"
            className="input"
            placeholder="seu nome"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </div>
      </aside>

      {/* Barra superior (telas pequenas) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-3 overflow-x-auto px-4 py-2.5 md:hidden"
          style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-hairline)' }}
        >
          {marca}
          <nav className="flex gap-1">{itens}</nav>
        </header>

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 py-6 md:px-8">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projetos" element={<Projetos />} />
            <Route path="/projeto" element={<ProjetoDetalhe />} />
            <Route path="/analises" element={<Analises />} />
            <Route path="/simulador" element={<Simulador />} />
            <Route path="/sincronizar" element={<Sincronizar />} />
            <Route path="/empresas" element={<Empresas />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
