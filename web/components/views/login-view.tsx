"use client"

import { useState, type FormEvent } from "react"
import { ShieldCheck, User, Lock, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { inputClass } from "@/components/views/shared"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8088"

type LoginRole = "school_admin" | "teacher"

type LoginResponse = {
  token: string
  user: {
    id: number
    username: string
    role: LoginRole
    name: string
    classroomId: number | null
    mustResetPassword: boolean
    school: { id: number; name: string } | null
    classroom: {
      id: number
      grade: string
      name: string
      label: string
      capacity: number
      studentCount: number
    } | null
  }
}

async function readApiError(response: Response) {
  try {
    const body = await response.json()
    return body.message || body.code || "登录失败"
  } catch {
    return "登录失败"
  }
}

export function LoginView({
  onLogin,
  showDemoAccounts = false,
}: {
  onLogin?: (role: LoginRole) => void
  showDemoAccounts?: boolean
}) {
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("首次登录使用学校下发的初始密码，不强制修改初始密码。")
  const [error, setError] = useState("")

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!account.trim() || !password) {
      setError("请输入账号和密码。")
      return
    }
    setLoading(true)
    setError("")
    setMessage("正在检查账号密码。")
    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: account.trim(), password }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as LoginResponse
      window.localStorage.setItem("jiaxiaoToken", data.token)
      window.localStorage.setItem("jiaxiaoUser", JSON.stringify(data.user))
      setMessage(`登录成功：${data.user.name}`)
      onLogin?.(data.user.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败")
      setMessage("请检查账号密码后重试。")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[640px] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" />
          </div>
          <h1 className="text-xl font-bold text-foreground">家校签收通</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            家校通知签收与归档管理平台
          </p>
        </div>

        <form className="rounded-lg border border-border bg-card p-6 shadow-sm" onSubmit={handleLogin}>
          <p className="mb-4 text-sm font-medium text-foreground">
            学校管理员 / 班主任登录
          </p>

          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                账号
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="请输入账号"
                  autoComplete="username"
                  className={inputClass + " pl-9"}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                密码
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  className={inputClass + " pl-9"}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-xs text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{message}</span>
          </div>

          {error && (
            <p className="mt-3 rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-xs text-stamp">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-4 w-full" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>

        {showDemoAccounts && (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-card/60 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              测试账号获取方式
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              请先进入运维后台开通学校管理员账号；班主任账号由学校管理员在“组织教师”中创建。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
