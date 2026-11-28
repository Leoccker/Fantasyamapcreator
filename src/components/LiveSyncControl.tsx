// Discreet TopBar indicator and popover for the MCP Live-Preview connection.
import { useEffect, useState } from 'react'
import type { LiveSyncController } from './useLiveSync'

export interface LiveSyncControlProps {
  live: LiveSyncController
  onPushCurrent(): void
}

export function LiveSyncControl({ live, onPushCurrent }: LiveSyncControlProps) {
  const [urlDraft, setUrlDraft] = useState(live.url)
  const [tokenDraft, setTokenDraft] = useState(live.token)

  useEffect(() => {
    setUrlDraft(live.url)
    setTokenDraft(live.token)
  }, [live.url, live.token])

  const isActive = live.state !== 'disconnected'
  const dotClass =
    live.state === 'connected'
      ? live.paused
        ? 'live-dot paused'
        : 'live-dot connected'
      : live.state === 'connecting'
        ? 'live-dot paused'
        : live.state === 'error'
          ? 'live-dot error'
          : 'live-dot'

  const label =
    live.state === 'connected'
      ? live.paused
        ? live.pendingCount > 0
          ? `MCP (pausado · ${live.pendingCount})`
          : 'MCP (pausado)'
        : 'Conectado ao MCP'
      : live.state === 'connecting'
        ? 'MCP (conectando…)'
        : live.state === 'error'
          ? 'MCP (reconectando)'
          : 'MCP'

  return (
    <div className="live-control">
      {live.state === 'connected' && (
        <button
          type="button"
          className="live-quick-pause"
          onClick={live.togglePause}
          title={live.paused ? 'Retomar sincronização com o MCP' : 'Pausar sincronização para editar com calma'}
        >
          {live.paused ? (live.pendingCount > 0 ? `Retomar (${live.pendingCount})` : 'Retomar') : 'Pausar'}
        </button>
      )}
      <details className="pop">
        <summary className="live-summary" aria-label="Sincronização ao vivo com MCP" title="Live-Preview com servidor MCP">
          <span className={dotClass} aria-hidden="true" />
          <span>{label}</span>
        </summary>
        <div className="pop-body live-pop">
          <p className="hint">
            Sincroniza edições em tempo real entre a IA (MCP) e este editor. Peça à IA para executar{' '}
            <code>live_preview</code> ou inicie o MCP com <code>MAP_MCP_LIVE_PORT=4175</code>.
          </p>

          {live.error && (
            <p className="hint error" role="alert">
              {live.error}
            </p>
          )}

          {live.conflict && (
            <div className="live-conflict" role="alert">
              <p className="hint error">{live.conflict}</p>
              <button type="button" onClick={live.clearConflict}>
                Entendi
              </button>
            </div>
          )}

          <label>
            URL do servidor MCP
            <input
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              placeholder="http://127.0.0.1:4175"
              disabled={isActive}
            />
          </label>
          <label>
            Token de sessão
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="Cole o token exibido pelo MCP"
              disabled={isActive}
            />
          </label>

          <label className="check">
            <input type="checkbox" checked={live.autoFollow} onChange={(e) => live.setAutoFollow(e.target.checked)} />
            Centralizar câmera nas edições da IA
          </label>

          <div className="row">
            {!isActive ? (
              <button type="button" onClick={() => live.connect(urlDraft, tokenDraft)}>
                Conectar
              </button>
            ) : (
              <>
                <button type="button" onClick={live.togglePause}>
                  {live.paused ? 'Retomar' : 'Pausar'}
                </button>
                <button type="button" onClick={onPushCurrent} disabled={live.state !== 'connected' || live.paused}>
                  Enviar mapa ao MCP
                </button>
                <button type="button" onClick={live.disconnect}>
                  Desconectar
                </button>
              </>
            )}
          </div>
        </div>
      </details>
    </div>
  )
}
