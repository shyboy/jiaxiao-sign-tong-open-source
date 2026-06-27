"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ShieldCheck, LogOut } from "lucide-react"
import { cn } from "@/lib/utils"

export type NavItem = {
  key: string
  label: string
  icon: LucideIcon
  badge?: number
}

export function ConsoleLayout({
  roleLabel,
  accountName,
  onLogout,
  schoolLine,
  contextRight,
  nav,
  active,
  onNavChange,
  children,
}: {
  roleLabel: string
  accountName?: string
  onLogout?: () => void
  schoolLine: ReactNode
  contextRight?: ReactNode
  nav: NavItem[]
  active: string
  onNavChange: (key: string) => void
  children: ReactNode
}) {
  const showAccount = Boolean(accountName || onLogout)
  const accountInitial = (accountName || roleLabel || "账").trim().slice(0, 1)

  return (
    <div className="min-h-screen overflow-hidden bg-board">
      <div className="flex min-h-screen flex-col md:flex-row">
        {/* sidebar */}
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-sidebar md:w-56 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-foreground">家校签收通</p>
              <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
            </div>
            {onLogout && (
              <button
                type="button"
                aria-label="退出登录"
                title="退出登录"
                onClick={onLogout}
                className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
          <nav className="flex gap-1 overflow-x-auto p-2 md:block md:flex-1 md:space-y-0.5">
            {nav.map((item) => {
              const Icon = item.icon
              const isActive = active === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => onNavChange(item.key)}
                  className={cn(
                    "flex min-w-fit items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors md:w-full",
                    isActive
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-full bg-stamp/10 px-1.5 text-xs font-medium text-stamp">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </nav>
          {showAccount && (
            <div className="hidden border-t border-border p-3 md:block">
              <div className="flex items-center gap-2 rounded-md px-2 py-2 text-sm">
                <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                  {accountInitial}
                </div>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate font-medium text-foreground">{accountName || "当前账号"}</p>
                  <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
                </div>
                {onLogout && (
                  <button
                    type="button"
                    aria-label="退出登录"
                    title="退出登录"
                    onClick={onLogout}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="size-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3 md:px-5">
            <div className="min-w-0 text-sm text-foreground">{schoolLine}</div>
            {contextRight && (
              <div className="flex shrink-0 items-center gap-2">{contextRight}</div>
            )}
          </header>
          <div className="flex-1 overflow-y-auto p-4 md:p-5">{children}</div>
        </div>
      </div>
    </div>
  )
}
