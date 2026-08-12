import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Notificacao } from '../api/client'

/** Sino de notificações: o app conta o que precisa de atenção, em vez de a
 * pessoa caçar. Os itens são os alertas do fechamento (prejuízo, margem abaixo
 * da meta, custo estourado, conferência pendente); o "lido" é por pessoa —
 * marcar aqui não silencia o resto da equipe.
 *
 * No desktop é o botão flutuante no canto; no celular ele vive na barra do
 * topo (o App dispara o evento 'abrir-sino'). */
export default function Sino() {
  const [aberto, setAberto] = useState(false)
  const painelRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const empresaIds = params.get('empresas') || undefined
  const de = params.get('de') || undefined
  const ate = params.get('ate') || undefined

  const { data } = useQuery({
    queryKey: ['notificacoes', empresaIds, de, ate],
    queryFn: () => api.notificacoes(empresaIds, de, ate),
    refetchInterval: 90_000, // o suficiente para "chegar sozinho" sem martelar o servidor
    staleTime: 30_000,
  })

  const marcar = useMutation({
    mutationFn: (chaves: string[]) => api.marcarNotificacoesLidas(chaves),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notificacoes'] }),
  })

  useEffect(() => {
    const abrir = () => setAberto((a) => !a)
    window.addEventListener('abrir-sino', abrir)
    return () => window.removeEventListener('abrir-sino', abrir)
  }, [])

  // Esc fecha; clique fora também
  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    const aoClicar = (e: MouseEvent) => {
      if (painelRef.current && !painelRef.current.contains(e.target as Node)) setAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    window.addEventListener('mousedown', aoClicar)
    return () => {
      window.removeEventListener('keydown', aoTeclar)
      window.removeEventListener('mousedown', aoClicar)
    }
  }, [aberto])

  const naoLidas = data?.nao_lidas ?? 0

  const abrirItem = (n: Notificacao) => {
    setAberto(false)
    if (!n.lida) marcar.mutate([n.chave])
    const filtros = new URLSearchParams()
    for (const chave of ['empresas', 'de', 'ate']) {
      const valor = params.get(chave)
      if (valor) filtros.set(chave, valor)
    }
    const sufixo = filtros.toString()
    if (n.rota) {
      navigate(`${n.rota}${sufixo ? `${n.rota.includes('?') ? '&' : '?'}${sufixo}` : ''}`)
    } else if (n.projeto) {
      navigate(`/projeto?nome=${encodeURIComponent(n.projeto)}${sufixo ? `&${sufixo}` : ''}`)
    }
  }

  return (
    <div ref={painelRef}>
      {/* gatilho flutuante — só no desktop; no celular o sino fica na barra do topo */}
      <button
        className="sino-gatilho hidden md:grid"
        aria-label={naoLidas ? `Notificações — ${naoLidas} não lidas` : 'Notificações'}
        title="Notificações"
        onClick={() => setAberto(!aberto)}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {naoLidas > 0 && <span className="sino-contador">{naoLidas > 9 ? '9+' : naoLidas}</span>}
      </button>

      {aberto && (
        <div className="sino-painel" role="dialog" aria-label="Notificações">
          <div className="sino-cabecalho">
            <b>Notificações</b>
            {naoLidas > 0 && data && (
              <button
                className="text-xs font-semibold underline-offset-2 hover:underline"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => marcar.mutate(data.itens.map((i) => i.chave))}
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="sino-lista">
            {(data?.itens || []).length === 0 && (
              <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Tudo em dia — nada precisa de atenção no período. ✓
              </p>
            )}
            {(data?.itens || []).map((n) => (
              <button key={n.chave} className="sino-item" data-lida={n.lida} onClick={() => abrirItem(n)}>
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: n.gravidade === 'critica' ? 'var(--neg)' : 'var(--status-warning)' }}
                  title={n.gravidade === 'critica' ? 'Crítico' : 'Atenção'}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${n.lida ? '' : 'font-bold'}`}>{n.titulo}</span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {n.detalhe}
                  </span>
                </span>
                {!n.lida && <span className="sino-ponto" aria-label="não lida" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
