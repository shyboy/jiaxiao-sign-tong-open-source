import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { X } from "lucide-react"

type Tone = "primary" | "info" | "warning" | "stamp" | "success" | "muted"

const toneMap: Record<Tone, string> = {
  primary: "bg-accent text-accent-foreground border-primary/20",
  info: "bg-info-soft text-info border-info/20",
  warning: "bg-warning-soft text-[oklch(0.45_0.1_70)] border-warning/30",
  stamp: "bg-stamp-soft text-stamp border-stamp/20",
  success: "bg-success-soft text-success border-success/20",
  muted: "bg-muted text-muted-foreground border-border",
}

export function Badge({
  tone = "muted",
  children,
  className,
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
        toneMap[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Dot({ tone = "muted" }: { tone?: Tone }) {
  const dot: Record<Tone, string> = {
    primary: "bg-primary",
    info: "bg-info",
    warning: "bg-warning",
    stamp: "bg-stamp",
    success: "bg-success",
    muted: "bg-muted-foreground/50",
  }
  return <span className={cn("inline-block size-1.5 rounded-full", dot[tone])} />
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card shadow-sm",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            )}
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

export function Metric({
  label,
  value,
  tone = "muted",
  suffix,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  suffix?: ReactNode
}) {
  const valueColor: Record<Tone, string> = {
    primary: "text-primary",
    info: "text-info",
    warning: "text-[oklch(0.5_0.12_70)]",
    stamp: "text-stamp",
    success: "text-success",
    muted: "text-foreground",
  }
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Dot tone={tone} />
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", valueColor[tone])}>
        {value}
        {suffix && (
          <span className="ml-0.5 text-sm font-medium">{suffix}</span>
        )}
      </div>
    </div>
  )
}

export function Field({
  label,
  required,
  children,
  hint,
  error,
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
  error?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-stamp">*</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-stamp">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  )
}

export const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/20"

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  size = "md",
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  size?: "md" | "lg"
}) {
  if (!open) return null
  const width = size === "lg" ? "max-w-3xl" : "max-w-xl"
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/40 p-4 backdrop-blur-sm">
      <div
        className={cn(
          "my-8 w-full overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
          width,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: ReactNode; badge?: number }[]
  active: string
  onChange: (key: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === t.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.badge ? (
            <span
              className={cn(
                "inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4",
                active === t.key
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-stamp text-stamp-foreground",
              )}
            >
              {t.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}
