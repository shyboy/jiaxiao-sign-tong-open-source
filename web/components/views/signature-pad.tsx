"use client"

import { useRef, useState, useEffect } from "react"
import { Eraser } from "lucide-react"
import { cn } from "@/lib/utils"

export function SignaturePad({
  onChange,
  className,
  height = 140,
}: {
  onChange?: (hasInk: boolean, signatureData?: string | null) => void
  className?: string
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.lineWidth = 2.4
    ctx.strokeStyle = "#1f2937"
  }, [])

  function pos(e: React.PointerEvent) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent) {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current!.getContext("2d")!
    const p = pos(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    const p = pos(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    if (!hasInk) {
      setHasInk(true)
      onChange?.(true, canvas.toDataURL("image/png"))
    } else {
      onChange?.(true, canvas.toDataURL("image/png"))
    }
  }

  function end() {
    drawing.current = false
  }

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
    onChange?.(false, null)
  }

  return (
    <div className={cn("relative", className)}>
      <canvas
        ref={canvasRef}
        style={{ height }}
        className="w-full touch-none rounded-md border border-dashed border-input bg-[repeating-linear-gradient(0deg,transparent,transparent_27px,oklch(0.92_0.01_160)_28px)]"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      {!hasInk && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground/70">
          请在此处手写签名
        </span>
      )}
      <button
        type="button"
        onClick={clear}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Eraser className="size-3" />
        清空
      </button>
    </div>
  )
}
