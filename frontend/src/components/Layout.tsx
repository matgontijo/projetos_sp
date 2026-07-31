import type { ReactNode } from 'react'

/** Marca do app: monograma serifado dourado sobre azul-marinho (banco privado). */
export function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
        style={{
          background: 'linear-gradient(150deg, #1f4e79, #0d1728 80%)',
          border: '1px solid rgba(212, 167, 44, 0.55)',
          boxShadow: '0 6px 16px -8px rgba(13, 23, 40, 0.9)',
        }}
        aria-hidden
      >
        <span
          className="text-[19px] font-black leading-none"
          style={{ fontFamily: 'var(--font-display)', color: '#d4a72c', transform: 'translateY(-1px)' }}
        >
          F
        </span>
      </span>
      <div className="leading-tight">
        <div className="text-[15px] font-extrabold tracking-tight" style={{ color: 'var(--nav-text)', fontFamily: 'var(--font-display)' }}>
          Fechamento
        </div>
        <div className="text-[11px] font-semibold" style={{ color: 'var(--nav-muted)' }}>
          de projetos · Omie
        </div>
      </div>
    </div>
  )
}

/** Cabeçalho padrão de página: título grande, subtítulo e ações à direita. */
export function PageHeader({
  titulo,
  subtitulo,
  acoes,
}: {
  titulo: string
  subtitulo?: string
  acoes?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight">{titulo}</h1>
        {subtitulo && (
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            {subtitulo}
          </p>
        )}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  )
}

export const ICONES = {
  visao: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  projetos: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  buscar: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  analises: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  simulador: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
      <path d="M8.5 7h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </svg>
  ),
  empresas: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <path d="M14 9h4a2 2 0 0 1 2 2v10" />
      <path d="M2 21h20" />
      <path d="M8 7h2M8 11h2M8 15h2" />
    </svg>
  ),
  compras: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l2.4 11.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" />
      <circle cx="10" cy="20" r="1.3" />
      <circle cx="17.5" cy="20" r="1.3" />
    </svg>
  ),
  precificacao: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  ),
  orcamentos: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  ),
  ajuda: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.3a2.9 2.9 0 0 1 5.6.9c0 1.9-2.8 2.4-2.8 4" />
      <path d="M12 17.2v.01" />
    </svg>
  ),
  cadastros: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="1.6" fill="currentColor" />
      <circle cx="15" cy="12" r="1.6" fill="currentColor" />
      <circle cx="7" cy="18" r="1.6" fill="currentColor" />
    </svg>
  ),
}
