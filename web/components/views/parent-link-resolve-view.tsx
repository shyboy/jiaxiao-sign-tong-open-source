"use client"

import { useEffect, useState, type FormEvent } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Link2,
  Link2Off,
  Loader2,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { inputClass } from "@/components/views/shared"
import { PARENT_NOTICE } from "@/lib/demo-data"
import {
  API_BASE,
  fetchParentSignStatus,
  loadParentBinding,
  loadParentToken,
  readApiError,
  saveParentToken,
  type ParentLinkInfo,
} from "@/components/views/parent-flow"

type ResolveState = "checking" | "bound" | "unbound" | "expired" | "revoked" | "mismatch" | "limited"

export function ParentLinkResolveView({
  onGoBind,
  onGoSign,
}: {
  onGoBind?: (token: string, link: ParentLinkInfo) => void
  onGoSign?: (token: string, link: ParentLinkInfo) => void
}) {
  const [token, setToken] = useState("")
  const [link, setLink] = useState<ParentLinkInfo | null>(null)
  const [state, setState] = useState<ResolveState>("mismatch")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("请打开班主任转发的签收链接。")

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initial = params.get("t") || params.get("token") || loadParentToken()
    if (!initial) return
    setToken(initial)
    void resolveToken(initial)
  }, [])

  async function resolveToken(nextToken = token) {
    const trimmed = nextToken.trim()
    if (!trimmed) {
      setLink(null)
      setState("mismatch")
      setMessage("请粘贴或打开班主任转发的签收链接。")
      return
    }
    setLoading(true)
    setState("checking")
    setMessage("正在检查签收链接。")
    try {
      const response = await fetch(`${API_BASE}/api/public/link/${encodeURIComponent(trimmed)}`)
      if (!response.ok) {
        const error = await readApiError(response)
        setLink(null)
        if (response.status === 410 && error.includes("撤销")) setState("revoked")
        else if (response.status === 410 && error.includes("过期")) setState("expired")
        else if (response.status === 429) setState("limited")
        else setState("mismatch")
        setMessage(error)
        return
      }
      const data = (await response.json()) as ParentLinkInfo
      saveParentToken(trimmed)
      setToken(trimmed)
      setLink(data)
      const binding = loadParentBinding(trimmed, data.noticeId)
      if (data.purpose === "SIGN" && binding) {
        try {
          const signStatus = await fetchParentSignStatus(trimmed, binding)
          if (signStatus.status === "SIGNED" || signStatus.status === "SKIPPED") {
            setState("bound")
            setMessage("该通知已完成签收，正在打开签收凭证。")
            onGoSign?.(trimmed, data)
            return
          }
        } catch {
          // 状态查询失败时仍保留原签收入口，签收页会再次校验。
        }
      }
      setState(data.purpose === "SIGN" && binding ? "bound" : "unbound")
      setMessage(data.purpose === "SIGN" ? "签收链接有效。" : "班级绑定链接有效。")
    } catch (err) {
      setLink(null)
      setState("mismatch")
      setMessage(err instanceof Error ? err.message : "链接检查失败")
    } finally {
      setLoading(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void resolveToken()
  }

  const title = link?.noticeTitle || PARENT_NOTICE.title
  const version = link?.noticeVersion ? `v${link.noticeVersion}` : PARENT_NOTICE.version
  const dueAt = link?.dueAt ? formatDateTime(link.dueAt) : PARENT_NOTICE.deadline

  return (
    <div className="px-4 py-4">
      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5 text-primary" />
          通知班级签收链接
        </div>
        <h2 className="mt-1.5 text-base font-semibold text-foreground">检查签收链接</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          每个班级都有自己的签收链接。检查通过后即可绑定学生或完成签收。
        </p>
      </div>

      <form onSubmit={submit} className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-2">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">签收链接</label>
        <div className="flex gap-2">
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="粘贴班主任转发的链接"
            className={inputClass + " min-w-0 flex-1 font-mono text-xs"}
          />
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
            检查
          </Button>
        </div>
      </form>

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">链接信息</p>
        <Meta k="学校" v={link?.schoolName || PARENT_NOTICE.school} />
        <Meta k="班级" v={link?.className || PARENT_NOTICE.className} />
        <Meta k="通知" v={title} />
        <Meta k="版本" v={version} />
        <Meta k="截止" v={dueAt} />
        <Meta k="链接" v={token ? "已检查" : "待输入"} />
      </div>

      <StatusCard state={state} message={message} purpose={link?.purpose} />

      <div className="mt-4">
        {state === "checking" ? (
          <Button size="lg" className="w-full" disabled>
            <Loader2 className="size-4 animate-spin" />
            检查中
          </Button>
        ) : state === "bound" && link ? (
          <Button size="lg" className="w-full" onClick={() => onGoSign?.(token, link)}>
            <UserCheck className="size-4" />
            进入通知签收
          </Button>
        ) : state === "unbound" && link ? (
          <Button size="lg" className="w-full" onClick={() => onGoBind?.(token, link)}>
            <UserPlus className="size-4" />
            先绑定再签收
          </Button>
        ) : (
          <Button variant="outline" size="lg" className="w-full" disabled>
            链接不可继续提交
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-xs text-info">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>链接只允许访问当前通知与班级，不展示全班名单，不暴露后台数据。</span>
      </div>
    </div>
  )
}

function StatusCard({
  state,
  message,
  purpose,
}: {
  state: ResolveState
  message: string
  purpose?: "SIGN" | "BINDING"
}) {
  if (state === "bound") {
    return (
      <div className="mt-3 rounded-md border border-success/20 bg-success-soft p-3 text-success">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <CheckCircle2 className="size-4" />
          已识别有效监护人绑定
        </p>
        <p className="mt-1 text-xs">{message}</p>
      </div>
    )
  }
  if (state === "unbound") {
    return (
      <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-3 text-[oklch(0.45_0.1_70)]">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="size-4" />
          {purpose === "BINDING" ? "班级绑定链接有效" : "尚未识别本机绑定"}
        </p>
        <p className="mt-1 text-xs">{message}</p>
      </div>
    )
  }
  if (state === "checking") {
    return (
      <div className="mt-3 rounded-md border border-info/20 bg-info-soft p-3 text-info">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" />
          正在检查签收链接
        </p>
        <p className="mt-1 text-xs">检查完成后会进入绑定或签收。</p>
      </div>
    )
  }
  const text = {
    expired: "链接已过期，请联系班主任获取最新通知链接。",
    revoked: "链接已撤销，旧链接不能继续绑定或签收。",
    mismatch: message,
    limited: "请求过于频繁，请稍后再试。",
  }[state]
  return (
    <div className="mt-3 rounded-md border border-stamp/20 bg-stamp-soft p-3 text-stamp">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        {state === "revoked" ? <Link2Off className="size-4" /> : <AlertTriangle className="size-4" />}
        链接不可用
      </p>
      <p className="mt-1 text-xs">{text}</p>
    </div>
  )
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={(mono ? "font-mono text-[11px] " : "") + "min-w-0 text-right text-foreground"}>
        {v}
      </span>
    </div>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
