import { create } from 'zustand'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning' | 'loading'
  message: string
  duration?: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
  updateToast: (id: string, updates: Partial<Toast>) => void
}

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    if (toast.duration !== 0) {
      const timer = setTimeout(() => {
        toastTimers.delete(id)
        set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
      }, toast.duration ?? 3000)
      toastTimers.set(id, timer)
    }
    return id
  },
  removeToast: (id) => {
    const timer = toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimers.delete(id)
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
  updateToast: (id, updates) =>
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...updates } : t))
    }))
}))