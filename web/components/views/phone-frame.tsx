import { Signal, Wifi, BatteryFull } from "lucide-react"
import type { ReactNode } from "react"

export function PhoneFrame({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="mx-auto w-[390px] shrink-0">
      <div className="overflow-hidden rounded-[2rem] border-[10px] border-foreground/90 bg-background shadow-xl">
        {/* status bar */}
        <div className="flex items-center justify-between bg-primary px-5 pb-1.5 pt-2 text-primary-foreground">
          <span className="text-xs font-medium tabular-nums">9:41</span>
          <div className="flex items-center gap-1">
            <Signal className="size-3.5" />
            <Wifi className="size-3.5" />
            <BatteryFull className="size-4" />
          </div>
        </div>
        {/* app top bar */}
        <div className="flex items-center justify-center border-b border-primary-foreground/20 bg-primary px-4 pb-3 text-primary-foreground">
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <div className="h-[760px] overflow-y-auto bg-background">{children}</div>
      </div>
    </div>
  )
}
