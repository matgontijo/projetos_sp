import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type UsuarioLogado } from '../api/client'
import { Marca } from '../components/Layout'

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
      const mensagem = (ex as Error).message
      setErro(
        mensagem.includes('Not Found') || mensagem.includes('404')
          ? 'O servidor está terminando de atualizar — aguarde um minuto e tente de novo.'
          : mensagem,
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--page)' }}>
      {/* Painel de marca — o mesmo verde-cofre da sidebar */}
      <div
        className="relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 lg:flex"
        style={{ background: 'var(--nav-bg)' }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(560px 420px at 20% -10%, rgba(47, 189, 136, 0.22), transparent 70%)' }}
        />
        <Marca />
        <div className="relative">
          <h1 className="anima-sobe max-w-md text-4xl font-extrabold leading-tight" style={{ color: 'var(--nav-text)' }}>
            Cada projeto fechado, cada real explicado.
          </h1>
          <p
            className="anima-sobe mt-4 max-w-sm text-sm leading-relaxed"
            style={{ color: 'var(--nav-muted)', animationDelay: '0.12s' }}
          >
            Receita, custos, impostos e margem por projeto — direto da Omie, com as duas empresas consolidadas.
          </p>
        </div>
        <div className="relative flex items-end gap-1.5" aria-hidden>
          {[34, 52, 40, 66, 48, 80, 58, 92, 70, 108].map((h, i) => (
            <span
              key={i}
              className="anima-barra w-6 rounded-t-md"
              style={{
                height: h,
                background: `rgba(47, 189, 136, ${0.14 + i * 0.05})`,
                animationDelay: `${0.25 + i * 0.06}s`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Formulário */}
      <div className="grid flex-1 place-items-center px-4 py-10">
        <div className="anima-sobe w-full max-w-sm" style={{ animationDelay: '0.08s' }}>
          <div className="mb-6 lg:hidden">
            <div className="inline-block rounded-2xl p-3" style={{ background: 'var(--nav-bg)' }}>
              <Marca />
            </div>
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight">{primeiroAcesso ? 'Bem-vinda!' : 'Entrar'}</h2>
          <p className="help mb-6 mt-1">
            {primeiroAcesso ? 'Vamos criar a primeira conta do app.' : 'Use o e-mail e a senha cadastrados pela administradora.'}
          </p>

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
    </div>
  )
}
