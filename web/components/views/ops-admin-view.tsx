"use client"

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  Building2,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge, Field, Metric, Panel, inputClass } from "@/components/views/shared"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8088"
const OPS_TOKEN_KEY = "jiaxiaoOpsToken"

type OpsSchool = {
  id: number
  name: string
  enabled: boolean
  createdAt: string
  classCount: number
  teacherCount: number
  firstAdmin: {
    id: number
    username: string
    name: string
    enabled: boolean
    createdAt: string
  } | null
}

type OpsCreateResult = {
  schoolId: number
  schoolName: string
  firstAdmin: {
    id: number
    username: string
    name: string
    initialPassword: string
  }
}

export function OpsAdminView() {
  const [token, setToken] = useState("")
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [schools, setSchools] = useState<OpsSchool[]>([])
  const [schoolName, setSchoolName] = useState("待完善学校 新空间")
  const [adminName, setAdminName] = useState("学校管理员")
  const [adminUsername, setAdminUsername] = useState("school_admin_new")
  const [initialPassword, setInitialPassword] = useState("Admin@2026")
  const [resetSchoolId, setResetSchoolId] = useState("")
  const [resetReason, setResetReason] = useState("学校管理员遗忘初始密码，校方授权重置。")
  const [newPassword, setNewPassword] = useState("Reset@2026")
  const [created, setCreated] = useState<OpsCreateResult | null>(null)
  const [reset, setReset] = useState<OpsCreateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    const saved = window.localStorage.getItem(OPS_TOKEN_KEY)
    if (!saved) {
      setCheckingSession(false)
      return
    }
    setToken(saved)
    void loadSchools(saved)
  }, [])

  const metrics = useMemo(() => {
    return {
      total: schools.length,
      admins: schools.filter((school) => school.firstAdmin).length,
      pendingPassword: created || reset ? 1 : 0,
      disabled: schools.filter((school) => !school.enabled).length,
    }
  }, [schools, created, reset])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError("")
    setMessage("正在登录运维后台。")
    try {
      const response = await fetch(`${API_BASE}/api/ops/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: account.trim(), password }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { token: string; user: { name: string } }
      window.localStorage.setItem(OPS_TOKEN_KEY, data.token)
      setToken(data.token)
      setPassword("")
      setMessage(`已登录：${data.user.name}`)
      await loadSchools(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : "运维登录失败")
      setMessage("")
    } finally {
      setLoading(false)
    }
  }

  async function loadSchools(nextToken = token) {
    if (!nextToken) {
      setCheckingSession(false)
      return
    }
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/ops/schools`, {
        headers: getOpsHeaders(nextToken),
      })
      if (!response.ok) {
        const apiError = await readApiError(response)
        if (response.status === 401 || response.status === 403) {
          clearSession()
          throw new Error("运维登录已过期，请重新登录。")
        }
        throw new Error(apiError)
      }
      const data = (await response.json()) as { schools: OpsSchool[] }
      setSchools(data.schools)
      setResetSchoolId((current) => current || (data.schools[0] ? String(data.schools[0].id) : ""))
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取学校空间失败")
    } finally {
      setLoading(false)
      setCheckingSession(false)
    }
  }

  function clearSession() {
    window.localStorage.removeItem(OPS_TOKEN_KEY)
    setToken("")
    setSchools([])
    setCreated(null)
    setReset(null)
    setResetSchoolId("")
  }

  function logout() {
    clearSession()
    setMessage("")
    setError("")
  }

  async function createSchool() {
    if (!token) {
      setError("请先登录运维后台。")
      return
    }
    setLoading(true)
    setError("")
    setCreated(null)
    try {
      const response = await fetch(`${API_BASE}/api/ops/schools`, {
        method: "POST",
        headers: getOpsHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          schoolName,
          adminName,
          adminUsername,
          initialPassword,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as OpsCreateResult
      setCreated(data)
      setMessage("学校空间已开通，初始密码只在本次响应中展示。")
      await loadSchools(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : "开通学校空间失败")
    } finally {
      setLoading(false)
    }
  }

  async function resetAdminPassword() {
    if (!token) {
      setError("请先登录运维后台。")
      return
    }
    if (!resetSchoolId) {
      setError("请选择学校空间。")
      return
    }
    setLoading(true)
    setError("")
    setReset(null)
    try {
      const response = await fetch(`${API_BASE}/api/ops/schools/${resetSchoolId}/reset-admin-password`, {
        method: "POST",
        headers: getOpsHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ reason: resetReason, newPassword }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as OpsCreateResult
      setReset(data)
      setMessage("已生成一次性新密码，旧密码不再展示。")
      await loadSchools(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置密码失败")
    } finally {
      setLoading(false)
    }
  }

  async function updateSchoolStatus(school: OpsSchool) {
    if (!token) {
      setError("请先登录运维后台。")
      return
    }
    const enabled = !school.enabled
    const actionText = enabled ? "恢复" : "停用"
    if (!enabled) {
      const confirmed = window.confirm(
        `确定停用 ${school.name}？停用后该校后台用户不可登录，历史归档不会删除。`,
      )
      if (!confirmed) return
    }
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/ops/schools/${school.id}/status`, {
        method: "PATCH",
        headers: getOpsHeaders(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          enabled,
          reason: `运维手动${actionText}学校空间：${school.name}`,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setMessage(`已${actionText}学校空间：${school.name}`)
      await loadSchools(token)
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionText}学校空间失败`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1180px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">运维管理后台</h2>
              <p className="text-xs text-muted-foreground">
                只负责学校空间占位和首个学校管理员账号，不维护学校业务资料
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {token && (
            <>
              <Button variant="outline" size="sm" onClick={() => void loadSchools()}>
                <RefreshCw className="size-3.5" />
                刷新
              </Button>
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="size-3.5" />
                退出
              </Button>
            </>
          )}
          <Badge tone={token ? "warning" : "stamp"}>{token ? "仅平台/运维可见" : "需登录访问"}</Badge>
        </div>
      </div>

      {checkingSession ? (
        <Panel title="检查登录状态" description="正在确认是否已登录运维后台">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在进入运维后台
          </div>
        </Panel>
      ) : !token ? (
        <form className="rounded-lg border border-border bg-card p-4 shadow-sm" onSubmit={login}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <Field label="运维账号" required>
              <input
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                className={inputClass}
                placeholder="platform_admin"
                autoComplete="username"
              />
            </Field>
            <Field label="运维密码" required>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputClass}
                placeholder="请输入运维密码"
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              登录运维
            </Button>
          </div>
          {(message || error) && (
            <div className={"mt-3 rounded-md border px-3 py-2 text-xs " + (error ? "border-stamp/20 bg-stamp-soft text-stamp" : "border-success/20 bg-success-soft text-success")}>
              {error || message}
            </div>
          )}
        </form>
      ) : (
        <>
          {(message || error) && (
            <div className={"rounded-md border px-3 py-2 text-xs " + (error ? "border-stamp/20 bg-stamp-soft text-stamp" : "border-success/20 bg-success-soft text-success")}>
              {error || message}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="学校空间" value={metrics.total} tone="muted" />
            <Metric label="已开通管理员" value={metrics.admins} tone="success" />
            <Metric label="待交付初始密码" value={metrics.pendingPassword} tone="warning" />
            <Metric label="停用空间" value={metrics.disabled} tone="stamp" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Panel
              title="开通首个学校管理员"
              description="创建最小学校空间，占位学校名称由学校管理员首次登录后自行完善"
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="学校占位名称" required hint="仅用于数据隔离，正式名称由学校管理员设置">
                  <input className={inputClass} value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
                </Field>
                <Field label="管理员姓名" required>
                  <input className={inputClass} value={adminName} onChange={(event) => setAdminName(event.target.value)} />
                </Field>
                <Field label="登录账号" required>
                  <input className={inputClass} value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} />
                </Field>
                <Field label="初始密码" required hint="只展示一次，服务端只保存 hash">
                  <input type="password" className={inputClass} value={initialPassword} onChange={(event) => setInitialPassword(event.target.value)} />
                </Field>
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-xs text-info">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  运维后台不设置学校联系人、年级班级、教师账号或通知内容；这些由学校管理员登录后维护。
                </span>
              </div>

              <div className="mt-4 flex justify-end">
                <Button size="sm" onClick={createSchool} disabled={loading}>
                  {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Building2 className="size-3.5" />}
                  开通学校空间
                </Button>
              </div>

              {created && (
                <OneTimePasswordCard
                  title={`已生成学校空间 SCH-${created.schoolId}`}
                  username={created.firstAdmin.username}
                  password={created.firstAdmin.initialPassword}
                />
              )}
            </Panel>

            <div className="space-y-4">
              <Panel title="账号重置" description="仅限授权排障场景">
                <Field label="学校空间" required>
                  <select className={inputClass} value={resetSchoolId} onChange={(event) => setResetSchoolId(event.target.value)}>
                    <option value="">请选择学校</option>
                    {schools.map((school) => (
                      <option key={school.id} value={school.id}>
                        SCH-{school.id} · {school.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="重置原因" required>
                  <textarea
                    className="mt-3 h-24 w-full resize-none rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-primary"
                    value={resetReason}
                    onChange={(event) => setResetReason(event.target.value)}
                  />
                </Field>
                <Field label="新密码" required hint="只展示一次，服务端只保存 hash">
                  <input type="password" className={inputClass} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </Field>
                <Button variant="outline" size="sm" className="mt-3 w-full" onClick={resetAdminPassword} disabled={loading}>
                  {loading ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                  生成一次性新密码
                </Button>
                {reset && (
                  <OneTimePasswordCard
                    title={`已重置 SCH-${reset.schoolId}`}
                    username={reset.firstAdmin.username}
                    password={reset.firstAdmin.initialPassword}
                  />
                )}
              </Panel>

              <Panel title="上线前检查" description="未完成项需在正式使用前处理">
                <ul className="space-y-2 text-sm">
                  {["HTTPS 域名", "文件下载权限", "每日备份", "恢复演练", "隐私告知版本"].map((item, index) => (
                    <li key={item} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <span className="text-foreground">{item}</span>
                      <Badge tone={index < 2 ? "success" : "warning"}>
                        {index < 2 ? "已配置" : "待确认"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </div>

          <Panel title="学校空间列表" description="展示学校空间、首个管理员和基础统计">
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted text-xs text-muted-foreground">
                  <tr>
                    <Th>空间</Th>
                    <Th>首个管理员</Th>
                    <Th>班级</Th>
                    <Th>教师</Th>
                    <Th>状态</Th>
                    <Th>操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {schools.length ? (
                    schools.map((school) => (
                      <tr key={school.id} className="border-t border-border">
                        <Td>
                          <div className="font-medium text-foreground">SCH-{school.id} · {school.name}</div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(school.createdAt)}</div>
                        </Td>
                        <Td>
                          {school.firstAdmin ? (
                            <>
                              <div className="font-medium text-foreground">{school.firstAdmin.name}</div>
                              <div className="font-mono text-xs text-muted-foreground">{school.firstAdmin.username}</div>
                            </>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td className="tabular-nums">{school.classCount}</Td>
                        <Td className="tabular-nums">{school.teacherCount}</Td>
                        <Td><Badge tone={school.enabled ? "success" : "stamp"}>{school.enabled ? "启用" : "停用"}</Badge></Td>
                        <Td>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void updateSchoolStatus(school)}
                            disabled={loading}
                          >
                            {school.enabled ? <Lock className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                            {school.enabled ? "停用" : "恢复"}
                          </Button>
                        </Td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <Td colSpan={6} className="text-center text-muted-foreground">暂无学校空间</Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="flex items-start gap-2 rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>运维后台不会展示旧密码、密钥、登录凭证或学生家长详情。</span>
          </div>
        </>
      )}
    </div>
  )
}

function getOpsHeaders(token: string, extra?: Record<string, string>) {
  return {
    ...(extra || {}),
    Authorization: `Bearer ${token}`,
  }
}

async function readApiError(response: Response) {
  try {
    const body = await response.json()
    return body.message || body.code || "请求失败"
  } catch {
    return "请求失败"
  }
}

function OneTimePasswordCard({
  title,
  username,
  password,
}: {
  title: string
  username: string
  password: string
}) {
  return (
    <div className="mt-4 rounded-md border border-success/20 bg-success-soft px-3 py-2 text-sm text-success">
      <CheckCircle2 className="mr-1 inline size-4" />
      {title}
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <span className="rounded border border-success/20 bg-card/70 px-2 py-1 text-foreground">账号：{username}</span>
        <span className="rounded border border-success/20 bg-card/70 px-2 py-1 font-mono text-foreground">一次性密码：{password}</span>
      </div>
    </div>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-3 py-2 text-left font-medium">{children}</th>
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children: ReactNode
  className?: string
  colSpan?: number
}) {
  return <td colSpan={colSpan} className={"px-3 py-2 align-top " + className}>{children}</td>
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
