import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle, Warning, X, XCircle } from "@phosphor-icons/react"
import { useAppStore } from "../state/store"
import { useReducedMotion } from "./ui"

const TONE_CONFIG = {
  success: { icon: CheckCircle, className: "bg-success-muted border-success text-success" },
  danger: { icon: XCircle, className: "bg-destructive-muted border-destructive text-destructive" },
  warn: { icon: Warning, className: "bg-warning-muted border-warning text-warning" },
} as const

export default function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  const reduced = useReducedMotion()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => {
          const cfg = TONE_CONFIG[toast.tone]
          const Icon = cfg.icon
          return (
            <motion.div
              key={toast.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={`flex w-[320px] items-start gap-2.5 rounded-lg border px-4 py-3 shadow-lg ${cfg.className}`}
            >
              <Icon size={16} weight="fill" className="mt-px shrink-0" />
              <span className="min-w-0 flex-1 break-words text-[13px] font-medium">
                {toast.message}
              </span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-[4px] p-0.5 opacity-60 transition hover:opacity-100"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
