import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import {
  api,
  guardarSessao,
  limparSessao,
  tokenAtual,
  usuarioLogado,
  type UsuarioLogado,
} from './api/client'
import { ICONES } from './components/Layout'
import Analises from './pages/Analises'
import Dashboard from './pages/Dashboard'
import Empresas from './pages/Empresas'
import Login from './pages/Login'
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

const PAPEL_LABEL: Record<string, string> = { admin: 'Administradora', financeiro: 'Financeiro', leitura: 'Leitura' }

export default function App() {
  const queryClient = useQueryClient()
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(() => (tokenAtual() ? usuarioLogado() : null))

  useEffect(() => {
    const aoExpirar = () => setUsuario(null)
    window.addEventListener('sessao-expirada', aoExpirar)
    return () => window.removeEventListener('sessao-expirada', aoExpirar)
  }, [])

  // preserva os filtros (empresas/período) ao navegar pelo menu
  const [params] = useSearchParams()
  const filtros = new URLSearchParams()
  for (const chave of ['empresas', 'de', 'ate']) {
    const valor = params.get(chave)
    if (valor) filtros.set(chave, valor)
  }
  const sufixoFiltros = filtros.toString() ? `?${filtros.toString()}` : ''

  if (!usuario) {
    return (
      <Login
        aoEntrar={(token, u) => {
          guardarSessao(token, u)
          queryClient.clear()
          setUsuario(u)
        }}
      />
    )
  }

  async function sair() {
    try {
      await api.logout()
    } catch {
      /* sessão já pode ter expirado */
    }
    limparSessao()
    queryClient.clear()
    setUsuario(null)
  }

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

  const caixaUsuario = (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2" style={{ background: 'var(--surface-2)' }}>
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black"
        style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
        aria-hidden
      >
        {usuario.nome.trim().charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-bold" title={usuario.email}>
          {usuario.nome}
        </div>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          {PAPEL_LABEL[usuario.papel] || usuario.papel}
        </div>
      </div>
      <button className="btn btn-ghost px-2 py-1 text-xs" onClick={sair} title="Encerrar a sessão">
        Sair
      </button>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* Sidebar (desktop) */}
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 px-4 py-5 md:flex"
        style={{ background: 'var(--surface-1)', borderRight: '1px solid var(--border-hairline)' }}
      >
        <div className="mb-5 px-1">{marca}</div>
        <nav className="grid gap-1">{itens}</nav>
        <div className="mt-auto">{caixaUsuario}</div>
      </aside>

      {/* Barra superior (telas pequenas) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-3 overflow-x-auto px-4 py-2.5 md:hidden"
          style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border-hairline)' }}
        >
          {marca}
          <nav className="flex gap-1">{itens}</nav>
          <button className="btn btn-ghost ml-auto text-xs" onClick={sair}>
            Sair
          </button>
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
