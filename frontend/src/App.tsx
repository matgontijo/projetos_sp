import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import {
  api,
  guardarSessao,
  limparSessao,
  tokenAtual,
  usuarioLogado,
  type UsuarioLogado,
} from './api/client'
import { ICONES, Marca, useMarca } from './components/Layout'
import Paleta, { type TelaDaPaleta } from './components/Paleta'
import Sino from './components/Sino'
import SuporteChat from './components/SuporteChat'
import Ajuda from './pages/Ajuda'
import Analises from './pages/Analises'
import CadastroPrecificacao from './pages/CadastroPrecificacao'
import Compras from './pages/Compras'
import Dashboard from './pages/Dashboard'
import Empresas from './pages/Empresas'
import Login from './pages/Login'
import OrcamentosVenda from './pages/OrcamentosVenda'
import Precificacao from './pages/Precificacao'
import ProjetoDetalhe from './pages/ProjetoDetalhe'
import Projetos from './pages/Projetos'
import Simulador from './pages/Simulador'
import Sincronizar from './pages/Sincronizar'

/* ---------- tema claro/escuro/sistema ---------- */

type Tema = 'claro' | 'sistema' | 'escuro'

function aplicarTema(tema: Tema) {
  const raiz = document.documentElement
  if (tema === 'claro') raiz.dataset.theme = 'light'
  else if (tema === 'escuro') raiz.dataset.theme = 'dark'
  else delete raiz.dataset.theme
}

function useTema() {
  const [tema, setTema] = useState<Tema>(() => {
    const salvo = localStorage.getItem('tema')
    return salvo === 'claro' || salvo === 'escuro' ? salvo : 'sistema'
  })
  useEffect(() => {
    aplicarTema(tema)
    localStorage.setItem('tema', tema)
  }, [tema])
  return { tema, setTema }
}

function SeletorTema({ tema, setTema }: { tema: Tema; setTema: (t: Tema) => void }) {
  const opcoes: { valor: Tema; rotulo: string; icone: React.ReactNode }[] = [
    {
      valor: 'claro',
      rotulo: 'Tema claro',
      icone: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5 5l1.6 1.6M17.4 17.4 19 19M19 5l-1.6 1.6M6.6 17.4 5 19" />
        </svg>
      ),
    },
    {
      valor: 'sistema',
      rotulo: 'Seguir o sistema',
      icone: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
          <path d="M9 20.5h6M12 17v3.5" />
        </svg>
      ),
    },
    {
      valor: 'escuro',
      rotulo: 'Tema escuro',
      icone: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
        </svg>
      ),
    },
  ]
  return (
    <div className="segmento" role="group" aria-label="Tema do aplicativo">
      {opcoes.map((o) => (
        <button key={o.valor} aria-pressed={tema === o.valor} aria-label={o.rotulo} title={o.rotulo} onClick={() => setTema(o.valor)}>
          {o.icone}
        </button>
      ))}
    </div>
  )
}

/* ---------- menu agrupado por área ---------- */

interface ItemMenu {
  to: string
  label: string
  icone: React.ReactNode
  tambem?: string
  papeis?: string[] // além dos papéis da seção
}

interface SecaoMenu {
  titulo: string
  papeis: string[]
  itens: ItemMenu[]
}

const SECOES: SecaoMenu[] = [
  {
    titulo: 'Fechamento',
    papeis: ['admin', 'financeiro', 'leitura'],
    itens: [
      { to: '/dashboard', label: 'Visão geral', icone: ICONES.visao },
      { to: '/projetos', label: 'Projetos', icone: ICONES.projetos, tambem: '/projeto' },
      { to: '/analises', label: 'Análises', icone: ICONES.analises },
      { to: '/compras', label: 'Compras', icone: ICONES.compras },
      { to: '/simulador', label: 'Simulador', icone: ICONES.simulador },
    ],
  },
  {
    titulo: 'Comercial',
    papeis: ['admin', 'financeiro', 'comercial'],
    itens: [
      { to: '/precificacao', label: 'Precificação', icone: ICONES.precificacao },
      { to: '/orcamentos-venda', label: 'Orçamentos', icone: ICONES.orcamentos },
      { to: '/cadastros-precificacao', label: 'Cadastros', icone: ICONES.cadastros, papeis: ['admin', 'financeiro'] },
    ],
  },
  {
    titulo: 'Sistema',
    papeis: ['admin', 'financeiro', 'leitura'],
    itens: [
      { to: '/sincronizar', label: 'Buscar dados', icone: ICONES.buscar },
      { to: '/empresas', label: 'Empresas', icone: ICONES.empresas },
    ],
  },
  // o guia é para todo mundo, inclusive quem só usa a precificação
  {
    titulo: 'Ajuda',
    papeis: ['admin', 'financeiro', 'leitura', 'comercial'],
    itens: [{ to: '/ajuda', label: 'Como usar', icone: ICONES.ajuda }],
  },
]

function secoesDoPapel(papel: string): SecaoMenu[] {
  return SECOES.map((s) => ({
    ...s,
    itens: s.itens.filter((i) => !i.papeis || i.papeis.includes(papel)),
  })).filter((s) => s.papeis.includes(papel) && s.itens.length > 0)
}

/** Título da aba do navegador acompanha a tela — 5 abas abertas deixam de ser
 *  5 abas idênticas escritas "Grupo JPDV". */
function TituloDaAba() {
  const location = useLocation()
  const [params] = useSearchParams()
  const marca = useMarca()
  useEffect(() => {
    let tela = SECOES.flatMap((s) => s.itens).find((i) => i.to === location.pathname)?.label
    if (location.pathname.startsWith('/projeto') && params.get('nome')) tela = params.get('nome')!
    document.title = tela ? `${tela} · ${marca.nome}` : `${marca.nome} — Fechamento de Projetos`
  }, [location.pathname, params, marca.nome])
  return null
}

const TECLA_PALETA = /mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

/** O menu REAGE aos dados: quantos projetos ainda esperam ok, ao lado de "Projetos".
 *  Mesma query key das páginas — quando o Dashboard já carregou, custa zero. */
function ContadorPendentes() {
  const [params] = useSearchParams()
  const empresaIds = params.get('empresas') || undefined
  const de = params.get('de') || undefined
  const ate = params.get('ate') || undefined
  const { data } = useQuery({
    queryKey: ['fechamento', empresaIds, de, ate],
    queryFn: () => api.fechamento(empresaIds, de, ate),
    staleTime: 60_000,
  })
  const pendentes = (data?.consolidado.qtd_pendentes ?? 0) + (data?.consolidado.qtd_conferidos ?? 0)
  if (!pendentes) return null
  return (
    <span className="sidebar-contador" title={`${pendentes} projeto(s) esperando ok da conferência`}>
      {pendentes > 99 ? '99+' : pendentes}
    </span>
  )
}

const PAPEL_LABEL: Record<string, string> = {
  admin: 'Administradora',
  financeiro: 'Financeiro',
  leitura: 'Leitura',
  comercial: 'Comercial',
}

export default function App() {
  const queryClient = useQueryClient()
  const [usuario, setUsuario] = useState<UsuarioLogado | null>(() => (tokenAtual() ? usuarioLogado() : null))
  const [menuAberto, setMenuAberto] = useState(false)
  // trilho de icones: preferencia da pessoa, lembrada entre sessoes
  const [navColapsada, setNavColapsada] = useState(() => localStorage.getItem('nav_colapsada') === '1')
  const [trocandoSenha, setTrocandoSenha] = useState(false)
  useEffect(() => {
    localStorage.setItem('nav_colapsada', navColapsada ? '1' : '0')
  }, [navColapsada])
  const { tema, setTema } = useTema()

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

  const ehComercial = usuario.papel === 'comercial'
  const inicio = ehComercial ? '/precificacao' : '/dashboard'

  const telasDaPaleta: TelaDaPaleta[] = secoesDoPapel(usuario.papel).flatMap((s) =>
    s.itens.map((i) => ({ to: i.to, label: i.label, secao: s.titulo, icone: i.icone })),
  )
  const abrirPaleta = () => window.dispatchEvent(new CustomEvent('abrir-paleta'))

  const navegacao = secoesDoPapel(usuario.papel).map((secao) => (
    <div key={secao.titulo}>
      <div className="nav-secao">{secao.titulo}</div>
      <div className="grid gap-0.5">
        {secao.itens.map((l) => (
          <NavLink
            key={l.to}
            to={`${l.to}${sufixoFiltros}`}
            title={l.label}
            className={({ isActive }) =>
              `sidebar-item ${isActive || (l.tambem && location.pathname.startsWith(l.tambem)) ? 'sidebar-item-ativo' : ''}`
            }
          >
            {l.icone}
            <span className="nav-rotulo">{l.label}</span>
            {l.to === '/projetos' && usuario.papel !== 'comercial' && <ContadorPendentes />}
          </NavLink>
        ))}
      </div>
    </div>
  ))

  const caixaUsuario = (
    <div className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2" style={{ background: 'var(--nav-surface)' }}>
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black"
        style={{ background: 'color-mix(in srgb, var(--nav-accent) 22%, transparent)', color: 'var(--nav-accent)' }}
        aria-hidden
      >
        {usuario.nome.trim().charAt(0).toUpperCase()}
      </span>
      <button
        className="min-w-0 flex-1 cursor-pointer text-left leading-tight"
        onClick={() => setTrocandoSenha(true)}
        title="Trocar a minha senha"
      >
        <div className="truncate text-sm font-bold" style={{ color: 'var(--nav-text)' }}>
          {usuario.nome}
        </div>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--nav-muted)' }}>
          {PAPEL_LABEL[usuario.papel] || usuario.papel} · trocar senha
        </div>
      </button>
      <button
        className="rounded-full px-2 py-1 text-xs font-bold"
        style={{ color: 'var(--nav-muted)', border: '1px solid var(--nav-hairline)' }}
        onClick={sair}
        title="Encerrar a sessão"
      >
        Sair
      </button>
    </div>
  )

  const conteudoSidebar = (colapsada: boolean) => (
    <>
      <div className={`mb-5 flex items-start px-1 ${colapsada ? 'justify-center' : 'justify-between'}`}>
        {!colapsada && <Marca />}
        <button
          className="nav-recolher"
          onClick={() => setNavColapsada(!navColapsada)}
          aria-label={colapsada ? 'Expandir o menu' : 'Recolher o menu para ícones'}
          title={colapsada ? 'Expandir o menu' : 'Recolher o menu'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            {colapsada ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
          </svg>
        </button>
      </div>
      <button
        className="paleta-gatilho mb-4"
        onClick={abrirPaleta}
        title="Busca rápida (Ctrl+K ou /)"
        aria-label="Busca rápida"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        {!colapsada && <span className="flex-1 text-left">Buscar…</span>}
        {!colapsada && <kbd>{TECLA_PALETA}</kbd>}
      </button>
      <nav className="min-h-0 flex-1 overflow-y-auto">{navegacao}</nav>
      <div className="mt-4 grid gap-2.5">
        {!colapsada && <SeletorTema tema={tema} setTema={setTema} />}
        {!colapsada && caixaUsuario}
        {colapsada && (
          <button
            className="mx-auto grid h-9 w-9 place-items-center rounded-full text-xs font-black"
            style={{ background: 'color-mix(in srgb, var(--nav-accent) 22%, transparent)', color: 'var(--nav-accent)' }}
            title={`${usuario.nome} — clique para expandir o menu`}
            aria-label="Expandir o menu para ver a conta"
            onClick={() => setNavColapsada(false)}
          >
            {usuario.nome.trim().charAt(0).toUpperCase()}
          </button>
        )}
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen">
      <TituloDaAba />
      <Paleta telas={telasDaPaleta} buscaProjetos={!ehComercial} />
      {!ehComercial && <Sino />}
      <SuporteChat />
      {trocandoSenha && <ModalTrocarSenha aoFechar={() => setTrocandoSenha(false)} />}
      {/* Sidebar (desktop) — escura nos dois temas */}
      <aside
        className={`nav-lateral sticky top-0 hidden h-screen shrink-0 flex-col py-5 md:flex ${navColapsada ? 'nav-colapsada px-2' : 'px-4'}`}
        style={{ background: 'var(--nav-bg)', borderRight: '1px solid var(--nav-hairline)' }}
      >
        {conteudoSidebar(navColapsada)}
      </aside>

      {/* Barra superior + gaveta (telas pequenas) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-2.5 md:hidden"
          style={{ background: 'var(--nav-bg)', borderBottom: '1px solid var(--nav-hairline)' }}
        >
          <Marca />
          <span className="flex items-center gap-2">
          <button
            className="rounded-full p-2"
            style={{ color: 'var(--nav-text)', border: '1px solid var(--nav-hairline)' }}
            aria-label="Falar com o suporte"
            onClick={() => window.dispatchEvent(new CustomEvent('abrir-suporte'))}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.2-.6L3 21l1.9-5.6a8 8 0 0 1-.9-3.9A8.4 8.4 0 0 1 12.5 3.2 8.4 8.4 0 0 1 21 11.5z" />
            </svg>
          </button>
          {!ehComercial && (
            <button
              className="rounded-full p-2"
              style={{ color: 'var(--nav-text)', border: '1px solid var(--nav-hairline)' }}
              aria-label="Notificações"
              onClick={() => window.dispatchEvent(new CustomEvent('abrir-sino'))}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </button>
          )}
          <button
            className="rounded-full p-2"
            style={{ color: 'var(--nav-text)', border: '1px solid var(--nav-hairline)' }}
            aria-label="Busca rápida"
            onClick={abrirPaleta}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
          </button>
          <button
            className="rounded-full p-2"
            style={{ color: 'var(--nav-text)', border: '1px solid var(--nav-hairline)' }}
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuAberto(!menuAberto)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              {menuAberto ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          </span>
        </header>

        {menuAberto && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMenuAberto(false)}>
            <div className="absolute inset-0" style={{ background: 'color-mix(in srgb, black 55%, transparent)' }} />
            <div
              className="absolute inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto px-4 py-5"
              style={{ background: 'var(--nav-bg)', borderLeft: '1px solid var(--nav-hairline)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 px-1">
                <Marca />
              </div>
              <nav className="min-h-0 flex-1" onClick={() => setMenuAberto(false)}>
                {navegacao}
              </nav>
              <div className="mt-4 grid gap-2.5 pt-4">
                <SeletorTema tema={tema} setTema={setTema} />
                {caixaUsuario}
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-5 md:px-8 md:py-6">
          <Routes>
            <Route path="/" element={<Navigate to={inicio} replace />} />
            {/* guia de uso: liberado para qualquer papel */}
            <Route path="/ajuda" element={<Ajuda />} />
            {/* custeio: invisível para o comercial (o servidor também bloqueia com 403) */}
            {!ehComercial && (
              <>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/projetos" element={<Projetos />} />
                <Route path="/projeto" element={<ProjetoDetalhe />} />
                <Route path="/analises" element={<Analises />} />
                <Route path="/compras" element={<Compras />} />
                <Route path="/simulador" element={<Simulador />} />
                <Route path="/sincronizar" element={<Sincronizar />} />
                <Route path="/empresas" element={<Empresas />} />
              </>
            )}
            {/* precificação: comercial, financeiro e admin (leitura não) */}
            {usuario.papel !== 'leitura' && (
              <>
                <Route path="/precificacao" element={<Precificacao />} />
                <Route path="/orcamentos-venda" element={<OrcamentosVenda />} />
              </>
            )}
            {(usuario.papel === 'admin' || usuario.papel === 'financeiro') && (
              <Route path="/cadastros-precificacao" element={<CadastroPrecificacao />} />
            )}
            <Route path="*" element={<Navigate to={inicio} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

/** Trocar a própria senha — senha conhecida não precisa virar chamado de suporte. */
function ModalTrocarSenha({ aoFechar }: { aoFechar: () => void }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [feito, setFeito] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (nova !== confirma) {
      setErro('A confirmação não bate com a senha nova')
      return
    }
    setSalvando(true)
    try {
      await api.trocarSenha(atual, nova)
      setFeito(true)
      setTimeout(aoFechar, 1600)
    } catch (ex) {
      setErro((ex as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: 'color-mix(in srgb, black 45%, transparent)' }}
      onClick={aoFechar}
    >
      <div className="card w-full max-w-sm px-6 py-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold">Trocar a minha senha</h2>
        {feito ? (
          <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--status-good-text)' }}>
            Senha trocada — use a nova no próximo acesso.
          </p>
        ) : (
          <form onSubmit={salvar} className="mt-3 grid gap-3">
            <label className="text-sm">
              Senha atual
              <input type="password" className="input mt-1 w-full" value={atual} onChange={(e) => setAtual(e.target.value)} autoComplete="current-password" required />
            </label>
            <label className="text-sm">
              Senha nova <span style={{ color: 'var(--text-muted)' }}>(mínimo 8 caracteres)</span>
              <input type="password" className="input mt-1 w-full" value={nova} onChange={(e) => setNova(e.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            <label className="text-sm">
              Repita a senha nova
              <input type="password" className="input mt-1 w-full" value={confirma} onChange={(e) => setConfirma(e.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            {erro && (
              <p className="text-sm" style={{ color: 'var(--neg)' }}>{erro}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={aoFechar}>Cancelar</button>
              <button className="btn btn-primary" disabled={salvando}>{salvando ? 'Salvando…' : 'Trocar senha'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
