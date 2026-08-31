import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type MensagemSuporte } from '../api/client'

/** Chat de suporte dentro do app.
 *
 * Para quem usa: um balão no canto — escreveu, o desenvolvedor recebe o aviso
 * no WhatsApp/e-mail e a resposta aparece aqui mesmo, com contador de não lida.
 * Para a conta de suporte (SUPORTE_EMAIL), o mesmo botão vira caixa de entrada:
 * lista as conversas e responde qualquer uma sem sair do app. */
export default function SuporteChat() {
  const [aberto, setAberto] = useState(false)
  // null = minha conversa (cliente); número = conversa aberta pela conta de suporte
  const [conversa, setConversa] = useState<number | null>(null)
  const [texto, setTexto] = useState('')
  const fimRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const { data: resumo } = useQuery({
    queryKey: ['suporte-resumo'],
    queryFn: api.suporteResumo,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const souSuporte = resumo?.sou_suporte ?? false

  const { data: conversas } = useQuery({
    queryKey: ['suporte-conversas'],
    queryFn: api.suporteConversas,
    enabled: aberto && souSuporte,
    refetchInterval: aberto ? 20_000 : false,
  })

  const vendoThread = aberto && (!souSuporte || conversa !== null)
  const { data: thread } = useQuery({
    queryKey: ['suporte-mensagens', souSuporte ? conversa : 'minha'],
    queryFn: () => api.suporteMensagens(souSuporte && conversa !== null ? conversa : undefined),
    enabled: vendoThread,
    refetchInterval: vendoThread ? 15_000 : false,
  })

  const enviar = useMutation({
    mutationFn: (t: string) => api.suporteEnviar(t, souSuporte && conversa !== null ? conversa : undefined),
    onSuccess: () => {
      setTexto('')
      queryClient.invalidateQueries({ queryKey: ['suporte-mensagens'] })
      queryClient.invalidateQueries({ queryKey: ['suporte-conversas'] })
      queryClient.invalidateQueries({ queryKey: ['suporte-resumo'] })
    },
  })

  useEffect(() => {
    const abrir = () => setAberto((a) => !a)
    window.addEventListener('abrir-suporte', abrir)
    return () => window.removeEventListener('abrir-suporte', abrir)
  }, [])

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  // acompanhar a última mensagem (setTimeout: rAF não corre em aba oculta)
  useEffect(() => {
    if (vendoThread) setTimeout(() => fimRef.current?.scrollIntoView({ block: 'end' }), 60)
  }, [thread?.mensagens.length, vendoThread])

  // abrir a conversa zera as não lidas dela — atualiza o contador do botão
  useEffect(() => {
    if (vendoThread && thread) queryClient.invalidateQueries({ queryKey: ['suporte-resumo'] })
  }, [vendoThread, thread, queryClient])

  const naoLidas = resumo?.nao_lidas ?? 0

  const mandar = () => {
    const t = texto.trim()
    if (t && !enviar.isPending) enviar.mutate(t)
  }

  return (
    <div>
      <button
        className="chat-gatilho grid"
        aria-label={naoLidas ? `Suporte — ${naoLidas} mensagens não lidas` : 'Falar com o suporte'}
        title="Falar com o suporte"
        onClick={() => setAberto(!aberto)}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.8 8.8 0 0 1-3.2-.6L3 21l1.9-5.6a8 8 0 0 1-.9-3.9A8.4 8.4 0 0 1 12.5 3.2 8.4 8.4 0 0 1 21 11.5z" />
        </svg>
        {naoLidas > 0 && <span className="sino-contador">{naoLidas > 9 ? '9+' : naoLidas}</span>}
      </button>

      {aberto && (
        <div className="chat-painel" role="dialog" aria-label="Suporte">
          <div className="sino-cabecalho">
            {souSuporte && conversa !== null ? (
              <span className="flex min-w-0 items-center gap-2">
                <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setConversa(null)} aria-label="Voltar para a lista de conversas">
                  ←
                </button>
                <b className="truncate">{thread?.usuario.nome || '…'}</b>
              </span>
            ) : (
              <b>{souSuporte ? 'Conversas de suporte' : 'Suporte'}</b>
            )}
            <button className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }} onClick={() => setAberto(false)}>
              Fechar
            </button>
          </div>

          {/* caixa de entrada (só a conta de suporte vê) */}
          {souSuporte && conversa === null && (
            <div className="sino-lista">
              {(conversas || []).length === 0 && (
                <p className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nenhuma conversa ainda.
                </p>
              )}
              {(conversas || []).map((c) => (
                <button key={c.usuario_id} className="sino-item" data-lida={c.nao_lidas === 0} onClick={() => setConversa(c.usuario_id)}>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${c.nao_lidas ? 'font-bold' : ''}`}>{c.nome}</span>
                    <span className="block truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {c.ultima}
                    </span>
                  </span>
                  {c.nao_lidas > 0 && <span className="sino-contador static">{c.nao_lidas}</span>}
                </button>
              ))}
            </div>
          )}

          {/* a conversa em si */}
          {vendoThread && (
            <>
              <div className="chat-msgs">
                {(thread?.mensagens || []).length === 0 && (
                  <p className="px-2 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    {souSuporte
                      ? 'Sem mensagens nesta conversa.'
                      : 'Conte o que aconteceu — respondo por aqui e você recebe o aviso no sininho.'}
                  </p>
                )}
                {(thread?.mensagens || []).map((m: MensagemSuporte) => {
                  const minha = souSuporte ? m.autor === 'suporte' : m.autor === 'cliente'
                  return (
                    <div key={m.id} className="chat-bolha" data-minha={minha}>
                      {m.texto}
                      <span className="chat-hora">
                        {new Date(m.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )
                })}
                <div ref={fimRef} />
              </div>
              <div className="chat-composer">
                <textarea
                  className="input min-h-10 flex-1 resize-none"
                  rows={1}
                  placeholder="Escreva sua mensagem…"
                  aria-label="Mensagem para o suporte"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      mandar()
                    }
                  }}
                />
                <button className="btn btn-primary" disabled={!texto.trim() || enviar.isPending} onClick={mandar} aria-label="Enviar mensagem">
                  {enviar.isPending ? '…' : 'Enviar'}
                </button>
              </div>
              {enviar.error && (
                <p className="px-4 pb-2 text-xs font-semibold" style={{ color: 'var(--status-critical)' }}>
                  {(enviar.error as Error).message}
                </p>
              )}
              {!souSuporte && (
                <p className="px-4 pb-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Pode fechar o app — quando o suporte responder, o aviso chega no seu e-mail.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
