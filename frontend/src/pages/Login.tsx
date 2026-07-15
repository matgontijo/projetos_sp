import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type UsuarioLogado } from '../api/client'

export default function Login({ aoEntrar }: { aoEntrar: (token: string, usuario: UsuarioLogado) => void }) {
  const { data: setupInfo } = useQuery({ queryKey: ['precisa-setup'], queryFn: api.precisaSetup })
  const primeiroAcesso = setupInfo?.precisa_setup === true

  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const resposta = primeiroAcesso
        ? await api.setup({ nome: nome.trim(), email: email.trim(), senha })
        : await api.login(email.trim(), senha)
      aoEntrar(resposta.token, resposta.usuario)
    } catch (ex) {
      setErro((ex as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4" style={{ background: 'var(--page)' }}>
      <div className="card w-full max-w-sm px-7 py-8">
        <div className="mb-6 flex items-center gap-3">
          <span
            className="grid h-11 w-11 place-items-center rounded-xl text-lg font-black text-white"
            style={{ background: 'linear-gradient(135deg, var(--serie-producao), var(--serie-resultado))' }}
            aria-hidden
          >
            F
          </span>
          <div className="leading-tight">
            <div className="text-lg font-extrabold tracking-tight">Fechamento de projetos</div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
              JPDV + Cherry House · Omie
            </div>
          </div>
        </div>

        {primeiroAcesso && (
          <p className="help mb-4">
            <b>Primeiro acesso:</b> crie a conta da administradora. Depois, ela cadastra o resto da equipe em
            Empresas → Equipe.
          </p>
        )}

        <form onSubmit={entrar} className="grid gap-3">
          {primeiroAcesso && (
            <label className="text-sm">
              Seu nome
              <input className="input mt-1 w-full" value={nome} onChange={(e) => setNome(e.target.value)} required />
            </label>
          )}
          <label className="text-sm">
            E-mail
            <input
              type="email"
              className="input mt-1 w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="text-sm">
            Senha {primeiroAcesso && <span style={{ color: 'var(--text-muted)' }}>(mínimo 8 caracteres)</span>}
            <input
              type="password"
              className="input mt-1 w-full"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete={primeiroAcesso ? 'new-password' : 'current-password'}
              minLength={primeiroAcesso ? 8 : undefined}
              required
            />
          </label>
          {erro && (
            <p className="text-sm" style={{ color: 'var(--neg)' }}>
              {erro}
            </p>
          )}
          <button className="btn btn-primary mt-1 w-full" disabled={enviando}>
            {enviando ? 'Entrando…' : primeiroAcesso ? 'Criar conta e entrar' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
