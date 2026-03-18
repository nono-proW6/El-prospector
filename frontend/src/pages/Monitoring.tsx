import { useEffect, useState } from 'react'
import { Activity, RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock, Zap } from 'lucide-react'

const ENRICH_URL = import.meta.env.VITE_ENRICHMENT_URL || 'http://localhost:3456'

type Status = {
  status: string
  pending: number
  today: { done: number; failed: number; skipped: number }
  total_done: number
  config: { paused: boolean; daily_target: number }
  claude: string
  claude_last_check: string | null
} | null

export default function Monitoring() {
  const [status, setStatus] = useState<Status>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  async function fetchStatus() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${ENRICH_URL}/status`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setStatus(data)
      setLastCheck(new Date())
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] Status OK — ${data.today.done} done, ${data.today.failed} failed, ${data.pending} pending`, ...prev].slice(0, 50))
    } catch (err: any) {
      setError(err.message)
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ERREUR: ${err.message}`, ...prev].slice(0, 50))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const connected = status?.status === 'ok'
  const todayTotal = status ? status.today.done + status.today.failed + status.today.skipped : 0

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-purple-400" />
          <h2 className="text-xl font-bold">Monitoring</h2>
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {/* Connection status */}
      <div className={`flex items-center gap-3 p-4 rounded-lg border ${
        error ? 'border-red-500/30 bg-red-500/10' : connected ? 'border-green-500/30 bg-green-500/10' : 'border-[var(--border)] bg-[var(--surface)]'
      }`}>
        {error ? (
          <>
            <XCircle size={20} className="text-red-400" />
            <div>
              <div className="font-medium text-red-400">Serveur VPS deconnecte</div>
              <div className="text-xs text-[var(--text-muted)]">{error}</div>
            </div>
          </>
        ) : connected ? (
          <>
            <CheckCircle size={20} className="text-green-400" />
            <div>
              <div className="font-medium text-green-400">Serveur VPS connecte</div>
              <div className="text-xs text-[var(--text-muted)]">
                {ENRICH_URL} — Claude Code SDK actif
                {lastCheck && ` — derniere verif ${lastCheck.toLocaleTimeString()}`}
              </div>
            </div>
          </>
        ) : (
          <>
            <Clock size={20} className="text-[var(--text-muted)]" />
            <div className="text-[var(--text-muted)]">Chargement...</div>
          </>
        )}
      </div>

      {/* Claude status */}
      {status && (
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${
          status.claude === 'ok' ? 'border-green-500/30 bg-green-500/10'
          : status.claude === 'unknown' ? 'border-yellow-500/30 bg-yellow-500/10'
          : 'border-red-500/30 bg-red-500/10'
        }`}>
          {status.claude === 'ok' ? (
            <>
              <CheckCircle size={20} className="text-green-400" />
              <div>
                <div className="font-medium text-green-400">Claude Code SDK connecte</div>
                <div className="text-xs text-[var(--text-muted)]">Dernier test: {status.claude_last_check || 'jamais'} (1x/jour)</div>
              </div>
            </>
          ) : status.claude === 'unknown' ? (
            <>
              <Clock size={20} className="text-yellow-400" />
              <div>
                <div className="font-medium text-yellow-400">Claude Code SDK pas encore teste</div>
                <div className="text-xs text-[var(--text-muted)]">Le test se lance au premier appel /status de la journee</div>
              </div>
            </>
          ) : (
            <>
              <XCircle size={20} className="text-red-400" />
              <div>
                <div className="font-medium text-red-400">Claude Code SDK erreur</div>
                <div className="text-xs text-[var(--text-muted)]">{status.claude}</div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Stats cards */}
      {status && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-2xl font-bold text-sky-400">{status.pending}</div>
            <div className="text-xs text-[var(--text-muted)]">En attente</div>
          </div>
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-2xl font-bold text-green-400">{status.today.done}</div>
            <div className="text-xs text-[var(--text-muted)]">Enrichies aujourd'hui</div>
          </div>
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-2xl font-bold text-red-400">{status.today.failed}</div>
            <div className="text-xs text-[var(--text-muted)]">Echouees aujourd'hui</div>
          </div>
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
            <div className="text-2xl font-bold">{status.total_done}</div>
            <div className="text-xs text-[var(--text-muted)]">Total enrichies</div>
          </div>
        </div>
      )}

      {/* Config */}
      {status && (
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="text-sm font-medium mb-3">Configuration cron</div>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-muted)]">Statut:</span>
              {status.config.paused ? (
                <span className="flex items-center gap-1 text-yellow-400"><AlertTriangle size={13} /> En pause</span>
              ) : (
                <span className="flex items-center gap-1 text-green-400"><Zap size={13} /> Actif</span>
              )}
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Target/jour:</span>{' '}
              <span className="font-medium">{status.config.daily_target}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Progres:</span>{' '}
              <span className="font-medium">{todayTotal}/{status.config.daily_target}</span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Cron:</span>{' '}
              <span className="font-medium">toutes les 30 min (9h-23h)</span>
            </div>
          </div>
        </div>
      )}

      {/* Progress bar */}
      {status && status.config.daily_target > 0 && (
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="flex justify-between text-xs text-[var(--text-muted)] mb-2">
            <span>Progres quotidien</span>
            <span>{todayTotal}/{status.config.daily_target} ({Math.round(todayTotal / status.config.daily_target * 100)}%)</span>
          </div>
          <div className="w-full h-2 bg-[var(--bg)] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{
              width: `${Math.min(100, todayTotal / status.config.daily_target * 100)}%`,
              background: todayTotal >= status.config.daily_target ? '#22c55e' : '#3b82f6',
            }} />
          </div>
        </div>
      )}

      {/* Live logs */}
      <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-4">
        <div className="text-sm font-medium mb-3">Logs (auto-refresh 30s)</div>
        <div className="font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="text-[var(--text-muted)]">En attente...</div>
          ) : logs.map((log, i) => (
            <div key={i} className={`${log.includes('ERREUR') ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
              {log}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
