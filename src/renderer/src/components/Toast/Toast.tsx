import { CheckCircle, XCircle, Info, AlertTriangle, Loader2, X } from 'lucide-react'
import { useToastStore } from '../../stores/toastStore'

const iconMap = {
  success: <CheckCircle size={16} style={{ color: 'var(--accent-green)' }} />,
  error: <XCircle size={16} style={{ color: 'var(--accent-red)' }} />,
  info: <Info size={16} style={{ color: 'var(--accent-blue)' }} />,
  warning: <AlertTriangle size={16} style={{ color: 'var(--accent-yellow)' }} />,
  loading: <Loader2 size={16} style={{ color: 'var(--accent-blue)', animation: 'spin 1s linear infinite' }} />
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const removeToast = useToastStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none'
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 14px',
            background: 'var(--bg-mantle)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            fontSize: '13px',
            color: 'var(--fg-text)',
            pointerEvents: 'auto',
            animation: 'toastSlideIn 0.25s ease',
            maxWidth: '380px'
          }}
        >
          {iconMap[toast.type]}
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.type !== 'loading' && (
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                padding: '2px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                display: 'flex',
                color: 'var(--fg-overlay0)'
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}