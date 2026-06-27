"use client"

import { useEffect, useRef, useState } from "react"
import {
  ListTodo,
  Upload,
  Link2,
  Send,
  ClipboardCheck,
  AlertTriangle,
  Download,
  Copy,
  Check,
  RefreshCw,
  Ban,
  FileSpreadsheet,
  FileText,
  FileArchive,
  Bell,
  CheckCircle2,
  CircleDashed,
  UserX,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConsoleLayout, type NavItem } from "@/components/views/console-layout"
import { Badge, Panel, Metric, Tabs, Modal } from "@/components/views/shared"
import { PARENT_TOKEN_KEY } from "@/components/views/parent-flow"
import {
  STUDENT_ROWS,
  ABNORMAL_ROWS,
  type SignStatus,
  type TeacherNotice,
} from "@/lib/demo-data"
import { ChevronRight, ArrowLeft, Clock } from "lucide-react"

const NAV_ITEMS: NavItem[] = [
  { key: "todo", label: "今日待办", icon: ListTodo },
  { key: "notices", label: "通知工作台", icon: Bell },
  { key: "import", label: "学生导入", icon: Upload },
]

const SECTION_TITLE: Record<string, string> = {
  todo: "今日待办",
  notices: "通知工作台",
  import: "学生导入",
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8088"

type ImportAction = "ADD" | "UPDATE" | "SKIP" | "CONFLICT"

type ImportPreviewRow = {
  studentId?: number
  studentName: string
  studentNo: string
  action: ImportAction
}

type ImportNotice = {
  reason: string
  row?: unknown
  studentNo?: string
  studentName?: string
  oldName?: string
}

type ImportPreviewResponse = {
  classId: number
  result: { add: number; update: number; skip: number; conflict: number }
  warnings: ImportNotice[]
  errors: ImportNotice[]
  canSubmit: boolean
  rows: ImportPreviewRow[]
  source?: { sourceType?: string; fileName?: string; rowCount?: number }
}

type ImportHistoryRow = {
  id: number
  sourceType: string
  fileName: string
  rowCount: number
  result: { add: number; update: number; skip: number; conflict: number }
  errors: number
  warnings: number
  status: "SUCCEEDED" | "FAILED"
  actor: { name: string; username: string } | null
  createdAt: string
}

type NoticeDelivery = {
  noticeId: number
  classroomId: number
  tokenStatus: "ACTIVE" | "REVOKED" | "EXPIRED" | "NONE"
  tokenCreatedAt: string | null
  tokenExpiresAt: string | null
  tokenRevokedAt: string | null
  forwardStatus: "PENDING" | "FORWARDED"
  forwardedAt: string | null
  reminderCount: number
  remindedAt: string | null
}

type BackendNotice = {
  id: number
  title: string
  body: string
  status: "DRAFT" | "PUBLISHED"
  version: number
  due_at: string
  published_at: string | null
  delivery: NoticeDelivery | null
}

type BackendProgressItem = {
  studentId: number
  studentNo: string
  studentName: string
  bindingStatus: "BOUND" | "UNBOUND" | "PENDING" | "HAS_EXCEPTION"
  signStatus: "SIGNED" | "PENDING" | "NO_BINDING" | "OVERDUE_PENDING" | "PARTIAL" | "EXCEPTION"
  signExceptionCount: number
  signCount: number
  taskId: number | null
  signed: boolean
  overdue: boolean
  reminderCount: number
  lastReminderAt: string | null
}

type BackendExceptionItem = {
  id: number
  source: "binding" | "binding_anomaly" | "sign"
  bindingId?: number
  bindingAnomalyId?: number
  anomalyId?: number
  type: "绑定" | "签收"
  studentName: string
  studentNo: string
  parentName?: string
  parentRelation?: string
  reason: string
  detail?: string
  status: string
  createdAt: string
  updatedAt: string
}

type TeacherStudentDetail = {
  student: { id: number; studentName: string; studentNo: string; createdAt: string }
  task: { id: number; status: string; signedAt: string | null; createdAt: string } | null
  bindings: Array<{
    id: number
    guardianName: string
    relation: string
    phone: string
    status: string
    createdAt: string
    updatedAt: string
  }>
  signRecords: Array<{
    id: number
    recordNo: string
    signedAt: string
    isLate: boolean
    ipAddress: string
    userAgent: string
    guardianName: string
    relation: string
  }>
  anomalies: Array<{
    id: number
    type: string
    status: string
    reason: string
    detail: string
    createdAt: string
    updatedAt: string
  }>
}

type ExportTaskType = "excel" | "student_pdf" | "class_zip"

type ExportTaskRow = {
  id: string
  type: ExportTaskType
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
  filePath?: string | null
  error?: string | null
  createdAt?: string
  finishedAt?: string | null
}

type AppTeacherNotice = TeacherNotice & {
  numericId?: number
  classroomId?: number
  delivery?: NoticeDelivery | null
  isLive?: boolean
}

type TeacherClassContext = {
  id: number
  grade: string
  name: string
  label: string
  capacity: number
  studentCount: number
}

type TeacherContext = {
  school: { id: number; name: string } | null
  classroom: TeacherClassContext | null
  teacher: { id?: number; username?: string; name: string }
}

type StoredTeacherUser = {
  id?: number
  username?: string
  role?: "school_admin" | "teacher"
  name?: string
  classroomId?: number | null
  school?: TeacherContext["school"]
  classroom?: TeacherClassContext | null
}

type TeacherContextResponse = {
  user: StoredTeacherUser
}

type TeacherTodo = {
  id: string
  label: string
}

const EMPTY_TEACHER_CONTEXT: TeacherContext = {
  school: null,
  classroom: null,
  teacher: { name: "班主任" },
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`
}

function contextFromUser(user: StoredTeacherUser | null | undefined): TeacherContext {
  if (!user) return EMPTY_TEACHER_CONTEXT
  return {
    school: user.school || null,
    classroom: user.classroom || null,
    teacher: {
      id: user.id,
      username: user.username,
      name: user.name || "班主任",
    },
  }
}

function getStoredTeacherContext() {
  if (typeof window === "undefined") return EMPTY_TEACHER_CONTEXT
  try {
    const raw = window.localStorage.getItem("jiaxiaoUser")
    if (!raw) return EMPTY_TEACHER_CONTEXT
    return contextFromUser(JSON.parse(raw) as StoredTeacherUser)
  } catch {
    return EMPTY_TEACHER_CONTEXT
  }
}

function getAuthHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra)
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("jiaxiaoToken")
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }
  if (!headers.has("Authorization")) {
    headers.set("x-demo-user", "teacher")
  }
  return headers
}

async function readApiError(response: Response) {
  try {
    const body = await response.json()
    return body.message || body.code || "请求失败"
  } catch {
    return "请求失败"
  }
}

function publicLink(pathOrUrl: string) {
  if (!pathOrUrl) return ""
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${API_BASE}${pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl}`
}

function metricsFromProgress(items: BackendProgressItem[]) {
  const due = items.length
  const signed = items.filter((item) => item.signed).length
  const unbound = items.filter((item) => item.bindingStatus === "UNBOUND").length
  const abnormal = items.filter(
    (item) => item.bindingStatus === "HAS_EXCEPTION" || item.signStatus === "EXCEPTION" || item.signExceptionCount > 0,
  ).length
  return {
    due,
    signed,
    waiting: Math.max(0, due - signed - unbound),
    unbound,
    abnormal,
  }
}

function isCopyableSignLink(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith("/") || trimmed.includes("?t=") || trimmed.includes("?token=") || /^https?:\/\//.test(trimmed)
}

function signLinkForGroupMessage(signLink: string) {
  return isCopyableSignLink(signLink)
    ? signLink.trim()
    : "请先在“签收链接管理”生成本班签收链接后，再复制发送本文案。"
}

function buildTeacherGroupMessage({
  schoolName,
  classLabel,
  teacherName,
  title,
  deadline,
  signLink,
}: {
  schoolName: string
  classLabel: string
  teacherName: string
  title: string
  deadline: string
  signLink: string
}) {
  return `【${schoolName} · ${classLabel}】各位家长好：
现需完成《${title}》线上签收，请于 ${deadline} 前完成。
本班签收链接：
${signLinkForGroupMessage(signLink)}
请使用手机浏览器打开链接。
请家长本人完成绑定并手写签收，不要让学生代签。如已签收请忽略。感谢配合！——${teacherName}`
}

function withSignLinkInGroupMessage(message: string, signLink: string) {
  const marker = "本班签收链接："
  const linkLine = signLinkForGroupMessage(signLink)
  if (message.includes(marker)) {
    return message.replace(/本班签收链接：\n[^\n]*/, () => `${marker}\n${linkLine}`)
  }
  return `${message}\n\n${marker}\n${linkLine}`
}

function mapBackendNotice(
  notice: BackendNotice,
  classId: number,
  context: TeacherContext,
  progressItems: BackendProgressItem[] = [],
): AppTeacherNotice {
  const delivery = notice.delivery
  const tokenStatus = delivery?.tokenStatus || "NONE"
  const metrics = progressItems.length ? metricsFromProgress(progressItems) : { due: 0, signed: 0, waiting: 0, unbound: 0, abnormal: 0 }
  const rawLink =
    tokenStatus === "ACTIVE"
      ? "已生成，重新生成后可复制新链接"
      : tokenStatus === "REVOKED"
      ? "链接已撤销"
      : "尚未生成签收链接"
  const deadline = formatDateTime(notice.due_at)
  return {
    id: `notice-${notice.id}`,
    numericId: notice.id,
    classroomId: classId,
    isLive: true,
    title: notice.title,
    version: `v${notice.version}`,
    deadline,
    status: new Date(notice.due_at).getTime() < Date.now() ? "closed" : "ongoing",
    forward: delivery?.forwardStatus === "FORWARDED" ? "forwarded" : "pending",
    forwardedAt: delivery?.forwardedAt ? formatDateTime(delivery.forwardedAt) : "—",
    link: {
      token: tokenStatus,
      url: rawLink,
      status: tokenStatus === "REVOKED" ? "revoked" : tokenStatus === "EXPIRED" ? "expired" : "active",
      createdAt: delivery?.tokenCreatedAt ? formatDateTime(delivery.tokenCreatedAt) : "—",
    },
    groupMessage: buildTeacherGroupMessage({
      schoolName: context.school?.name || "学校",
      classLabel: context.classroom?.label || "本班",
      teacherName: context.teacher.name,
      title: notice.title,
      deadline,
      signLink: rawLink,
    }),
    metrics,
    delivery,
  }
}

function buildTeacherTodos(notices: AppTeacherNotice[]): TeacherTodo[] {
  return notices.flatMap((notice) => {
    const unfinished = Math.max(0, notice.metrics.due - notice.metrics.signed)
    const items: TeacherTodo[] = []
    if (notice.forward === "pending") {
      items.push({ id: `${notice.id}-forward`, label: `转发《${notice.title}》到家长群` })
    }
    if (unfinished > 0) {
      items.push({ id: `${notice.id}-unfinished`, label: `跟进《${notice.title}》${unfinished} 名未完成学生` })
    }
    if (notice.metrics.abnormal > 0) {
      items.push({ id: `${notice.id}-abnormal`, label: `处理《${notice.title}》${notice.metrics.abnormal} 条异常记录` })
    }
    return items
  })
}

function aggregateNoticeMetrics(notices: AppTeacherNotice[]) {
  return notices.reduce(
    (sum, notice) => ({
      due: sum.due + notice.metrics.due,
      signed: sum.signed + notice.metrics.signed,
      waiting: sum.waiting + notice.metrics.waiting,
      unbound: sum.unbound + notice.metrics.unbound,
      abnormal: sum.abnormal + notice.metrics.abnormal,
    }),
    { due: 0, signed: 0, waiting: 0, unbound: 0, abnormal: 0 },
  )
}

export function TeacherView({
  accountName,
  onLogout,
}: {
  accountName?: string
  onLogout?: () => void
}) {
  const [active, setActive] = useState("notices")
  const [context, setContext] = useState<TeacherContext>(() => getStoredTeacherContext())
  const [notices, setNotices] = useState<AppTeacherNotice[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("正在加载本班通知。")
  const classId = context.classroom?.id || 0
  const todos = buildTeacherTodos(notices)
  const metrics = aggregateNoticeMetrics(notices)
  const nav = NAV_ITEMS.map((item) => {
    if (item.key === "todo") return { ...item, badge: todos.length || undefined }
    if (item.key === "notices") return { ...item, badge: notices.filter((notice) => notice.forward === "pending").length || undefined }
    return item
  })

  async function loadTeacherContext() {
    try {
      const response = await fetch(apiUrl("/api/teacher/context"), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as TeacherContextResponse
      const next = contextFromUser(data.user)
      setContext(next)
      if (typeof window !== "undefined") {
        window.localStorage.setItem("jiaxiaoUser", JSON.stringify(data.user))
      }
      return next
    } catch {
      return context
    }
  }

  async function loadNotices(nextContext = context) {
    const nextClassId = nextContext.classroom?.id || 0
    if (!nextClassId) {
      setNotices([])
      setMessage("当前班主任账号尚未分配班级，请联系学校管理员。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl("/api/teacher/notices"), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { notices: BackendNotice[] }
      const published = (data.notices || []).filter((notice) => notice.status === "PUBLISHED")
      const mapped = await Promise.all(
        published.map(async (notice) => {
          try {
            const progress = await fetch(apiUrl(`/api/teacher/class/${nextClassId}/progress?noticeId=${notice.id}`), {
              headers: getAuthHeaders(),
            })
            if (!progress.ok) return mapBackendNotice(notice, nextClassId, nextContext)
            const body = (await progress.json()) as { items: BackendProgressItem[]; delivery: NoticeDelivery | null }
            return mapBackendNotice({ ...notice, delivery: body.delivery || notice.delivery }, nextClassId, nextContext, body.items || [])
          } catch {
            return mapBackendNotice(notice, nextClassId, nextContext)
          }
        }),
      )
      setNotices(mapped)
      setMessage(mapped.length ? "本班通知已更新。" : "本班暂无已发布通知。")
    } catch (err) {
      setNotices([])
      setMessage(err instanceof Error ? `暂时无法加载通知：${err.message}` : "暂时无法加载通知，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  async function refreshDashboard() {
    const nextContext = await loadTeacherContext()
    await loadNotices(nextContext)
  }

  useEffect(() => {
    void refreshDashboard()
  }, [])

  function updateNotice(nextNotice: AppTeacherNotice) {
    setNotices((items) => items.map((item) => (item.id === nextNotice.id ? nextNotice : item)))
  }

  return (
    <ConsoleLayout
      roleLabel="班主任端"
      accountName={accountName || context.teacher.name}
      onLogout={onLogout}
      nav={nav}
      active={active}
      onNavChange={setActive}
      schoolLine={
        <div className="flex items-center gap-2">
          <span className="font-semibold">{context.school?.name || "正在加载学校"}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-semibold text-primary">{context.classroom?.label || "未分配班级"}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">班主任 {context.teacher.name}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{SECTION_TITLE[active]}</span>
        </div>
      }
      contextRight={
        <Badge tone="info">仅可见本班 {context.classroom?.studentCount ?? 0} 人</Badge>
      }
    >
      {active === "todo" && <TodoSection todos={todos} metrics={metrics} loading={loading} message={message} onGo={setActive} />}
      {active === "notices" && (
        <NoticeWorkbench
          classId={classId}
          classLabel={context.classroom?.label || "本班"}
          notices={notices}
          loading={loading}
          message={message}
          onRefresh={() => void refreshDashboard()}
          onNoticeChange={updateNotice}
        />
      )}
      {active === "import" && <ImportSection classId={classId} />}
    </ConsoleLayout>
  )
}

function NoticeWorkbench({
  classId,
  classLabel,
  notices,
  loading,
  message,
  onRefresh,
  onNoticeChange,
}: {
  classId: number
  classLabel: string
  notices: AppTeacherNotice[]
  loading: boolean
  message: string
  onRefresh: () => void
  onNoticeChange: (notice: AppTeacherNotice) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = notices.find((n) => n.id === selectedId)

  useEffect(() => {
    setSelectedId((current) => (current && notices.some((notice) => notice.id === current) ? current : null))
  }, [notices])

  if (selected) {
    return (
      <NoticeDetail
        notice={selected}
        classId={selected.classroomId || classId}
        classLabel={classLabel}
        onBack={() => setSelectedId(null)}
        onNoticeChange={onNoticeChange}
      />
    )
  }
  return <NoticeList notices={notices} loading={loading} message={message} onOpen={setSelectedId} onRefresh={onRefresh} />
}

function NoticeList({
  notices,
  loading,
  message,
  onOpen,
  onRefresh,
}: {
  notices: AppTeacherNotice[]
  loading: boolean
  message: string
  onOpen: (id: string) => void
  onRefresh: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
        <span className="flex min-w-0 items-start gap-2">
          <Bell className="mt-0.5 size-4 shrink-0" />
          <span>
            学校已发布 {notices.length} 个通知到本班。请逐个完成「转发 → 跟进签收 → 处理异常 → 导出」，每个通知独立维护链接与进度。
          </span>
        </span>
        <Button variant="outline" size="xs" disabled={loading} onClick={onRefresh}>
          <RefreshCw className="size-3" />
          刷新
        </Button>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
        <CircleDashed className="mt-0.5 size-3.5 shrink-0" />
        <span>
          {message}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {notices.length ? notices.map((n) => {
          const m = n.metrics
          const rate = m.due ? Math.round((m.signed / m.due) * 100) : 0
          return (
            <button
              key={n.id}
              onClick={() => onOpen(n.id)}
              className="group flex flex-col rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{n.title}</h3>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {n.version}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />
                    截止 {n.deadline}
                  </p>
                </div>
                {n.forward === "forwarded" ? (
                  <Badge tone="success">已转发</Badge>
                ) : (
                  <Badge tone="warning">待转发</Badge>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={"h-full rounded-full " + (rate >= 90 ? "bg-success" : rate >= 60 ? "bg-primary" : "bg-warning")}
                    style={{ width: rate + "%" }}
                  />
                </div>
                <span className="text-xs font-medium tabular-nums text-foreground">{rate}%</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>已签 <b className="text-success">{m.signed}</b>/{m.due}</span>
                <span>待签 <b className="text-[oklch(0.5_0.12_70)]">{m.waiting}</b></span>
                <span>未绑定 <b className="text-info">{m.unbound}</b></span>
                <span>异常 <b className="text-stamp">{m.abnormal}</b></span>
                <span className="ml-auto flex items-center gap-0.5 font-medium text-primary group-hover:underline">
                  进入处理 <ChevronRight className="size-3.5" />
                </span>
              </div>
            </button>
          )
        }) : (
          <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground lg:col-span-2">
            暂无本班已发布通知
          </div>
        )}
      </div>
    </div>
  )
}

const DETAIL_TABS = [
  { key: "link", label: "链接管理", icon: Link2 },
  { key: "forward", label: "通知转发", icon: Send },
  { key: "progress", label: "签收进度", icon: ClipboardCheck },
  { key: "abnormal", label: "异常处理", icon: AlertTriangle },
  { key: "export", label: "本班导出", icon: Download },
]

function NoticeDetail({
  notice,
  classId,
  classLabel,
  onBack,
  onNoticeChange,
}: {
  notice: AppTeacherNotice
  classId: number
  classLabel: string
  onBack: () => void
  onNoticeChange: (notice: AppTeacherNotice) => void
}) {
  const [tab, setTab] = useState("forward")
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            返回通知列表
          </Button>
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              {notice.title}
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{notice.version}</span>
            </h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3" />
              截止 {notice.deadline}
            </p>
          </div>
        </div>
        {notice.forward === "forwarded" ? (
          <Badge tone="success">已转发 · {notice.forwardedAt}</Badge>
        ) : (
          <Badge tone="warning">尚未转发</Badge>
        )}
      </div>

      <Tabs
        tabs={DETAIL_TABS.map((t) => ({
          key: t.key,
          label: (
            <span className="flex items-center gap-1.5">
              <t.icon className="size-3.5" />
              {t.label}
            </span>
          ),
          badge: t.key === "abnormal" && notice.metrics.abnormal > 0 ? notice.metrics.abnormal : undefined,
        }))}
        active={tab}
        onChange={setTab}
      />

      {tab === "link" && <LinkSection notice={notice} classId={classId} onNoticeChange={onNoticeChange} />}
      {tab === "forward" && <ForwardSection notice={notice} classId={classId} onNoticeChange={onNoticeChange} />}
      {tab === "progress" && <ProgressSection notice={notice} classId={classId} onNoticeChange={onNoticeChange} />}
      {tab === "abnormal" && <AbnormalSection classId={classId} />}
      {tab === "export" && <ExportSection notice={notice} classId={classId} classLabel={classLabel} />}
    </div>
  )
}

function TeacherMetrics({
  metrics,
}: {
  metrics: { due: number; signed: number; waiting: number; unbound: number; abnormal: number }
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <Metric label="应签" value={metrics.due} tone="muted" />
      <Metric label="已签" value={metrics.signed} tone="success" />
      <Metric label="待签" value={metrics.waiting} tone="warning" />
      <Metric label="未绑定" value={metrics.unbound} tone="info" />
      <Metric label="异常" value={metrics.abnormal} tone="stamp" />
    </div>
  )
}

function TodoSection({
  todos,
  metrics,
  loading,
  message,
  onGo,
}: {
  todos: TeacherTodo[]
  metrics: { due: number; signed: number; waiting: number; unbound: number; abnormal: number }
  loading: boolean
  message: string
  onGo: (k: string) => void
}) {
  return (
    <div className="space-y-4">
      <TeacherMetrics metrics={metrics} />
      <Panel title="今日待办" description="待转发、未完成签收和异常处理">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <CircleDashed className="mt-0.5 size-3.5 shrink-0" />
          <span>{loading ? "正在根据本班通知状态生成待办。" : message}</span>
        </div>
        {todos.length ? (
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5"
              >
                <CircleDashed className="size-5 shrink-0 text-warning" />
                <span className="flex-1 text-sm text-foreground">{todo.label}</span>
                <Button size="xs" onClick={() => onGo("notices")}>
                  去处理
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            暂无待处理事项
          </div>
        )}
      </Panel>
    </div>
  )
}

function ImportSection({ classId }: { classId: number }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [histories, setHistories] = useState<ImportHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [message, setMessage] = useState("正在加载学生名单。")
  const [error, setError] = useState("")

  async function loadHistory(nextClassId = classId) {
    if (!nextClassId) {
      setHistories([])
      setMessage("当前班主任账号尚未分配班级，暂不能导入学生名单。")
      return
    }
    setHistoryLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/classes/${nextClassId}/import-history?limit=5`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { histories: ImportHistoryRow[] }
      setHistories(data.histories || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入历史加载失败")
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    setPreview(null)
    setSelectedFile(null)
    setError("")
    void loadHistory(classId)
  }, [classId])

  async function downloadTemplate() {
    if (!classId) {
      setError("当前班主任账号尚未分配班级，暂不能下载模板。")
      return
    }
    setLoading(true)
    setError("")
    try {
      const response = await fetch(apiUrl(`/api/teacher/classes/${classId}/import-template`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `student-template-class-${classId}.xls`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage("模板已下载。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "模板下载失败")
    } finally {
      setLoading(false)
    }
  }

  async function previewFile(file: File) {
    if (!classId) {
      setError("当前班主任账号尚未分配班级，暂不能预检学生名单。")
      return
    }
    setLoading(true)
    setError("")
    setMessage("正在预检学生名单。")
    setSelectedFile(file)
    try {
      const response = await fetch(
        apiUrl(`/api/teacher/classes/${classId}/import-file-preview?fileName=${encodeURIComponent(file.name)}`),
        {
          method: "POST",
          headers: getAuthHeaders({
            "Content-Type": file.type || "application/octet-stream",
          }),
          body: await file.arrayBuffer(),
        },
      )
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as ImportPreviewResponse
      setPreview(data)
      setMessage(data.canSubmit ? "预检通过，可以确认导入。" : "预检未通过，请处理错误后重新上传。")
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : "文件预检失败")
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function commitImport() {
    if (!preview || !preview.canSubmit) return
    if (!classId) {
      setError("当前班主任账号尚未分配班级，暂不能提交导入。")
      return
    }
    setLoading(true)
    setError("")
    setMessage("正在写入学生名单。")
    try {
      const response = await fetch(apiUrl(`/api/teacher/classes/${classId}/import-commit`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          rows: preview.rows,
          source: {
            sourceType: preview.source?.sourceType || "FILE",
            fileName: preview.source?.fileName || selectedFile?.name || "",
          },
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { preview: ImportPreviewResponse }
      setPreview(data.preview)
      setMessage("导入提交成功，历史记录已更新。")
      await loadHistory(classId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认导入失败")
    } finally {
      setLoading(false)
    }
  }

  const statusTone = preview ? (preview.canSubmit ? "success" : "stamp") : "info"
  const statusLabel = preview ? (preview.canSubmit ? "可提交" : "需处理") : "待预检"

  return (
    <div className="space-y-4">
      <Panel
        title="学生名单导入"
        description="模板仅包含两列：学生姓名、班内序号（不收集其它隐私信息）"
        actions={
          <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={loading || !classId}>
            <Download className="size-3.5" />
            下载模板
          </Button>
        }
      >
        <label
          className={
            "relative flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/30 " +
            (loading || !classId ? "pointer-events-none opacity-50" : "")
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.txt"
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={loading || !classId}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void previewFile(file)
            }}
          />
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-accent text-primary">
            <Upload className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">上传学生名单 Excel</p>
          <p className="mt-1 text-xs text-muted-foreground">
            支持 .xlsx / .xls / .csv，仅识别「学生姓名」「班内序号」两列
          </p>
          <span className="relative mt-3 inline-flex h-7 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-all">
            选择文件
          </span>
          {selectedFile && (
            <p className="mt-2 text-xs text-muted-foreground">
              当前文件：{selectedFile.name}
            </p>
          )}
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="新增" value={preview?.result.add ?? "—"} tone="success" />
          <Metric label="更新" value={preview?.result.update ?? "—"} tone="info" />
          <Metric label="跳过" value={preview?.result.skip ?? "—"} tone="muted" />
          <div className="flex flex-col justify-center rounded-md border border-border bg-card px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge tone={statusTone}>{statusLabel}</Badge>
              <span>错误 {preview?.errors.length ?? 0}</span>
            </div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {preview?.warnings.length ?? 0}
              <span className="ml-0.5 text-sm font-medium text-muted-foreground">条警告</span>
            </div>
          </div>
        </div>

        {(message || error) && (
          <div
            className={
              "mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm " +
              (error
                ? "border-stamp/20 bg-stamp-soft text-stamp"
                : "border-info/20 bg-info-soft text-info")
            }
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error || message}</span>
          </div>
        )}

        {preview?.warnings.length ? (
          <div className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-[oklch(0.45_0.1_70)]">
            {preview.warnings.map((item, index) => (
              <p key={`${item.reason}-${index}`}>{item.reason}{item.studentNo ? `：${item.studentNo}` : ""}</p>
            ))}
          </div>
        ) : null}

        {preview?.errors.length ? (
          <div className="mt-3 rounded-md border border-stamp/30 bg-stamp-soft px-3 py-2 text-xs text-stamp">
            {preview.errors.map((item, index) => (
              <p key={`${item.reason}-${index}`}>{item.reason}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">序号</th>
                <th className="px-3 py-2 font-medium">学生姓名</th>
                <th className="px-3 py-2 font-medium">预检结果</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {preview?.rows.length ? (
                preview.rows.map((row, index) => (
                  <PreviewRow key={`${row.studentNo}-${index}`} index={index + 1} row={row} />
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    暂无预检结果
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              setPreview(null)
              setSelectedFile(null)
              setError("")
              setMessage("已清空本次预检。")
            }}
          >
            取消
          </Button>
          <Button size="sm" disabled={loading || !classId || !preview?.canSubmit} onClick={commitImport}>
            确认导入
          </Button>
        </div>
      </Panel>

      <Panel
        title="最近导入历史"
        description="显示本班最近 5 次导入提交"
        actions={
          <Button variant="outline" size="sm" disabled={historyLoading || !classId} onClick={() => void loadHistory()}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">来源</th>
                <th className="px-3 py-2 font-medium">文件</th>
                <th className="px-3 py-2 text-right font-medium">行数</th>
                <th className="px-3 py-2 font-medium">结果</th>
                <th className="px-3 py-2 font-medium">操作人</th>
              </tr>
            </thead>
            <tbody>
              {histories.length ? (
                histories.map((item) => (
                  <tr key={item.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{formatDateTime(item.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={item.sourceType === "FILE" ? "info" : "muted"}>{sourceLabel(item.sourceType)}</Badge>
                    </td>
                    <td className="max-w-52 truncate px-3 py-2.5 text-foreground">{item.fileName || "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{item.rowCount}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      新增 {item.result.add} · 更新 {item.result.update} · 跳过 {item.result.skip}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{item.actor?.name || item.actor?.username || "—"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    暂无导入历史
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function PreviewRow({
  index,
  row,
}: {
  index: number
  row: ImportPreviewRow
}) {
  const action = importActionUi(row.action)
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 tabular-nums text-muted-foreground">{index}</td>
      <td className="px-3 py-2 font-medium text-foreground">
        {row.studentName}
        <span className="ml-2 text-xs font-normal tabular-nums text-muted-foreground">#{row.studentNo}</span>
      </td>
      <td className="px-3 py-2">
        <Badge tone={action.tone}>{action.label}</Badge>
      </td>
      <td className="px-3 py-2 text-muted-foreground">{action.note}</td>
    </tr>
  )
}

function importActionUi(action: ImportAction): { tone: "success" | "info" | "warning" | "stamp" | "muted"; label: string; note: string } {
  const map = {
    ADD: { tone: "success", label: "新增", note: "本班暂无该序号学生" },
    UPDATE: { tone: "info", label: "更新", note: "按班内序号更新姓名" },
    SKIP: { tone: "muted", label: "跳过", note: "与本班已有记录一致" },
    CONFLICT: { tone: "stamp", label: "差异", note: "已有有效绑定，不能直接覆盖" },
  } satisfies Record<ImportAction, { tone: "success" | "info" | "warning" | "stamp" | "muted"; label: string; note: string }>
  return map[action]
}

function sourceLabel(sourceType: string) {
  if (sourceType === "FILE") return "文件"
  if (sourceType === "PASTE") return "粘贴"
  if (sourceType === "API") return "同步导入"
  return "未知"
}

function exportTypeLabel(type: ExportTaskType) {
  if (type === "excel") return "Excel 明细"
  if (type === "student_pdf") return "单份 PDF"
  return "班级 PDF zip"
}

function formatDateTime(value: string) {
  if (!value) return "—"
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

function noticeWithDelivery(notice: AppTeacherNotice, delivery: NoticeDelivery, patch?: Partial<AppTeacherNotice>): AppTeacherNotice {
  return {
    ...notice,
    ...patch,
    delivery,
    forward: delivery.forwardStatus === "FORWARDED" ? "forwarded" : notice.forward,
    forwardedAt: delivery.forwardedAt ? formatDateTime(delivery.forwardedAt) : notice.forwardedAt,
  }
}

function LinkSection({
  notice,
  classId,
  onNoticeChange,
}: {
  notice: AppTeacherNotice
  classId: number
  onNoticeChange: (notice: AppTeacherNotice) => void
}) {
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(notice.isLive ? "正在加载签收链接。" : "当前为演示链接。")
  const linkTone = notice.link.status === "revoked" ? "stamp" : notice.link.status === "expired" ? "warning" : "success"
  const linkLabel = notice.link.status === "revoked" ? "已撤销" : notice.link.status === "expired" ? "已过期" : "有效"

  async function regenerateLink() {
    if (!notice.numericId) {
      setMessage("请先刷新通知列表，再重新生成签收链接。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/notices/${notice.numericId}/sign-link`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ classroomId: classId }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { url: string; token: string; delivery: NoticeDelivery }
      window.localStorage.setItem(PARENT_TOKEN_KEY, data.token)
      const nextUrl = publicLink(data.url)
      const next = noticeWithDelivery(notice, data.delivery, {
        link: {
          token: data.token,
          url: nextUrl,
          status: "active",
          createdAt: data.delivery.tokenCreatedAt ? formatDateTime(data.delivery.tokenCreatedAt) : "刚刚",
        },
        groupMessage: withSignLinkInGroupMessage(notice.groupMessage, nextUrl),
      })
      onNoticeChange(next)
      setMessage("新链接已生成，完整链接只在本次生成后展示。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "重新生成失败")
    } finally {
      setLoading(false)
    }
  }

  async function revokeLink() {
    if (!notice.numericId) {
      setMessage("请先刷新通知列表，再撤销签收链接。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/notices/${notice.numericId}/sign-link/revoke`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ classroomId: classId, reason: "teacher_ui_revoke" }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { delivery: NoticeDelivery }
      onNoticeChange(
        noticeWithDelivery(notice, data.delivery, {
          link: {
            ...notice.link,
            status: "revoked",
            url: "链接已撤销，重新生成后可复制新链接",
          },
        }),
      )
      setMessage("旧链接已撤销。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "撤销失败")
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    if (notice.link.url) {
      try {
        await navigator.clipboard?.writeText(notice.link.url)
      } catch {
        // 浏览器可能拒绝剪贴板权限，仍保留 UI 反馈。
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-4">
      <Panel
        title="通知签收链接"
        description={`家长凭此链接进入《${notice.title}》绑定与签收流程，无需注册账号`}
      >
        <div className="flex items-center gap-2">
          <Badge tone={linkTone}>{linkLabel}</Badge>
          <span className="text-xs text-muted-foreground">创建时间 {notice.link.createdAt}</span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 truncate rounded-md border border-input bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
            {notice.link.url}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !notice.link.url || notice.link.status !== "active"}
            onClick={() => void copyLink()}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            {copied ? "已复制" : "复制链接"}
          </Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void regenerateLink()}>
            <RefreshCw className="size-3.5" />
            重新生成
          </Button>
          <Button variant="destructive" size="sm" disabled={loading || notice.link.status === "revoked"} onClick={() => void revokeLink()}>
            <Ban className="size-3.5" />
            撤销
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          <StateChip tone="success" title="active 有效" desc="家长可正常绑定与签收" />
          <StateChip tone="warning" title="expired 过期" desc="超过有效期，提示重新获取本通知链接" />
          <StateChip tone="stamp" title="revoked 已撤销" desc="班主任手动撤销，旧链接立即失效" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          每个班级都有自己的签收链接；同班多名班主任共用本班链接。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      </Panel>
    </div>
  )
}

function StateChip({
  tone,
  title,
  desc,
}: {
  tone: "success" | "warning" | "stamp"
  title: string
  desc: string
}) {
  const ring = {
    success: "border-success/30 bg-success-soft",
    warning: "border-warning/30 bg-warning-soft",
    stamp: "border-stamp/30 bg-stamp-soft",
  }[tone]
  return (
    <div className={"rounded-md border px-3 py-2 " + ring}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
    </div>
  )
}

function ForwardSection({
  notice,
  classId,
  onNoticeChange,
}: {
  notice: AppTeacherNotice
  classId: number
  onNoticeChange: (notice: AppTeacherNotice) => void
}) {
  const [copied, setCopied] = useState(false)
  const [forwarded, setForwarded] = useState(notice.forward === "forwarded")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(notice.isLive ? "正在加载转发状态。" : "当前为演示转发状态。")
  const copyDisabled = notice.isLive && (notice.link.status !== "active" || !isCopyableSignLink(notice.link.url))

  async function copyMessage() {
    if (copyDisabled) {
      setMessage("请先在链接管理中生成签收链接，再复制群文案。")
      return
    }
    try {
      await navigator.clipboard?.writeText(notice.groupMessage)
    } catch {
      // 剪贴板权限不可用时，仍允许老师手动复制文本框内容。
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  async function markForwarded() {
    if (!notice.numericId) {
      setForwarded(true)
      setMessage("已在页面内标记转发。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/notices/${notice.numericId}/forward`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ classroomId: classId, remark: "teacher_ui_forward" }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { delivery: NoticeDelivery }
      setForwarded(true)
      onNoticeChange(
        noticeWithDelivery(notice, data.delivery, {
          forward: "forwarded",
          forwardedAt: data.delivery.forwardedAt ? formatDateTime(data.delivery.forwardedAt) : "刚刚",
        }),
      )
      setMessage("已写入转发状态。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "标记转发失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="通知转发"
        description={`复制《${notice.title}》群文案，粘贴发送到班级家长群`}
      >
        <textarea
          readOnly
          value={notice.groupMessage}
          className="h-40 w-full resize-none rounded-md border border-input bg-muted/30 p-3 text-sm leading-relaxed text-foreground outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            disabled={loading || copyDisabled}
            onClick={() => void copyMessage()}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "已复制文案" : "复制群文案"}
          </Button>
          <Button
            variant={forwarded ? "secondary" : "outline"}
            disabled={loading}
            onClick={() => void markForwarded()}
          >
            <Check className="size-4" />
            {forwarded ? "已标记转发" : "标记已转发"}
          </Button>
          {forwarded ? (
            <Badge tone="success">
              转发状态：已转发{notice.forwardedAt !== "—" ? " · " + notice.forwardedAt : ""}
            </Badge>
          ) : (
            <Badge tone="warning">转发状态：未转发</Badge>
          )}
          {copyDisabled ? <Badge tone="warning">请先生成签收链接</Badge> : null}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          提示：班主任仅能转发学校发布的通知，无法修改正文内容；生成签收链接后，群文案会自动带上本班链接。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      </Panel>
    </div>
  )
}

function ProgressSection({
  notice,
  classId,
  onNoticeChange,
}: {
  notice: AppTeacherNotice
  classId: number
  onNoticeChange: (notice: AppTeacherNotice) => void
}) {
  const [items, setItems] = useState<BackendProgressItem[] | null>(null)
  const [onlyPending, setOnlyPending] = useState(false)
  const [loading, setLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<TeacherStudentDetail | null>(null)
  const [message, setMessage] = useState(notice.isLive ? "正在加载签收进度。" : "当前展示演示进度。")
  const signUi: Record<SignStatus, { tone: "success" | "warning" | "info"; label: string; icon: typeof CheckCircle2 }> = {
    signed: { tone: "success", label: "已签", icon: CheckCircle2 },
    waiting: { tone: "warning", label: "待签", icon: CircleDashed },
    unbound: { tone: "info", label: "未绑定", icon: UserX },
  }
  const liveMetrics = items ? metricsFromProgress(items) : notice.metrics
  const liveRows = items
    ? items.filter((item) => (onlyPending ? !item.signed : true))
    : null
  const staticRows = STUDENT_ROWS.filter((item) => (onlyPending ? item.sign !== "signed" : true))

  async function loadProgress() {
    if (!notice.numericId) return
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/progress?noticeId=${notice.numericId}`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { items: BackendProgressItem[]; delivery: NoticeDelivery | null }
      const nextItems = data.items || []
      setItems(nextItems)
      onNoticeChange(
        noticeWithDelivery(
          {
            ...notice,
            metrics: metricsFromProgress(nextItems),
          },
          data.delivery || notice.delivery || {
            noticeId: notice.numericId,
            classroomId: classId,
            tokenStatus: "NONE",
            tokenCreatedAt: null,
            tokenExpiresAt: null,
            tokenRevokedAt: null,
            forwardStatus: notice.forward === "forwarded" ? "FORWARDED" : "PENDING",
            forwardedAt: null,
            reminderCount: 0,
            remindedAt: null,
          },
        ),
      )
      setMessage("签收进度已更新。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "进度刷新失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProgress()
  }, [notice.numericId, classId])

  async function remind(studentIds: number[]) {
    if (!notice.numericId) {
      setMessage("当前演示进度不能记录提醒。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/reminders`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          noticeId: notice.numericId,
          studentIds,
          remark: studentIds.length ? "teacher_ui_student_reminder" : "teacher_ui_class_reminder",
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadProgress()
      setMessage(studentIds.length ? "已记录学生提醒。" : "已记录全班未签提醒。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "提醒记录失败")
    } finally {
      setLoading(false)
    }
  }

  async function openStudentDetail(studentId: number) {
    if (!notice.numericId) return
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/students/${studentId}/detail?noticeId=${notice.numericId}`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as TeacherStudentDetail
      setDetail(data)
      setDetailOpen(true)
      setMessage("已读取学生签收详情。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "学生详情加载失败")
    } finally {
      setLoading(false)
    }
  }

  function openStaticDetail(row: (typeof STUDENT_ROWS)[number]) {
    setDetail({
      student: {
        id: Number(row.seat),
        studentName: row.name,
        studentNo: String(row.seat),
        createdAt: "",
      },
      task: {
        id: Number(row.seat),
        status: row.sign === "signed" ? "SIGNED" : "PENDING",
        signedAt: row.sign === "signed" ? "2026-06-01 10:12" : null,
        createdAt: "",
      },
      bindings:
        row.bind === "bound"
          ? [{ id: Number(row.seat), guardianName: "家长", relation: "监护人", phone: "", status: "VALID", createdAt: "", updatedAt: "" }]
          : [],
      signRecords:
        row.sign === "signed"
          ? [{
              id: Number(row.seat),
              recordNo: `DEMO-${row.seat}`,
              signedAt: "2026-06-01 10:12",
              isLate: false,
              ipAddress: "已隐藏",
              userAgent: "已隐藏",
              guardianName: "家长",
              relation: "监护人",
            }]
          : [],
      anomalies: [],
    })
    setDetailOpen(true)
  }

  return (
    <div className="space-y-4">
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail ? `${detail.student.studentName} · 签收详情` : "签收详情"}
        description="查看当前通知下的绑定、签收记录和相关问题"
        size="lg"
        footer={<Button size="sm" onClick={() => setDetailOpen(false)}>关闭</Button>}
      >
        {detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="班内序号" value={detail.student.studentNo} tone="muted" />
              <Metric label="任务状态" value={detail.task?.status || "未生成"} tone={detail.task?.status === "SIGNED" ? "success" : "warning"} />
              <Metric label="绑定数" value={detail.bindings.length} tone="info" />
              <Metric label="签收记录" value={detail.signRecords.length} tone="success" />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">监护人绑定</div>
                <div className="divide-y divide-border">
                  {detail.bindings.length ? (
                    detail.bindings.map((item) => (
                      <div key={item.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">{item.guardianName} · {item.relation}</span>
                          <Badge tone={item.status === "VALID" ? "success" : item.status === "PENDING_REVIEW" ? "warning" : "muted"}>{item.status}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">更新时间：{item.updatedAt ? formatDateTime(item.updatedAt) : "—"}</p>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无有效绑定</div>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border">
                <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">签收记录</div>
                <div className="divide-y divide-border">
                  {detail.signRecords.length ? (
                    detail.signRecords.map((item) => (
                      <div key={item.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{item.recordNo}</span>
                          <Badge tone={item.isLate ? "warning" : "success"}>{item.isLate ? "逾期签收" : "正常签收"}</Badge>
                        </div>
                        <p className="mt-1 font-medium text-foreground">{item.guardianName} · {item.relation}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(item.signedAt)} · {item.ipAddress || "无 IP"}</p>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无签收记录</div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border">
              <div className="border-b border-border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">异常记录</div>
              <div className="divide-y divide-border">
                {detail.anomalies.length ? (
                  detail.anomalies.map((item) => (
                    <div key={`${item.type}-${item.id}`} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{item.type} · {item.reason}</span>
                        <Badge tone={item.status === "PENDING" ? "warning" : "muted"}>{item.status}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.detail || "无补充说明"}</p>
                    </div>
                  ))
                ) : (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无异常记录</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">正在加载详情</div>
        )}
      </Modal>
      <TeacherMetrics metrics={liveMetrics} />
      <Panel
        title="签收名单"
        description={`《${notice.title}》按学生统计：任一有效监护人签收即记为已签`}
        actions={
          <>
            <Button variant={onlyPending ? "secondary" : "outline"} size="sm" onClick={() => setOnlyPending((v) => !v)}>
              仅看未签
            </Button>
            <Button
              size="sm"
              disabled={loading}
              onClick={() => void remind(items ? items.filter((item) => !item.signed).map((item) => item.studentId) : [])}
            >
              <Bell className="size-3.5" />
              一键提醒未签
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{message}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">学生姓名</th>
                <th className="px-3 py-2 font-medium">班内序号</th>
                <th className="px-3 py-2 font-medium">绑定状态</th>
                <th className="px-3 py-2 font-medium">签收状态</th>
                <th className="px-3 py-2 text-right font-medium">提醒次数</th>
                <th className="px-3 py-2 font-medium">最后提醒时间</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {liveRows
                ? liveRows.map((s) => {
                    const ui = liveSignUi(s)
                    const Icon = ui.icon
                    return (
                      <tr key={s.studentId} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium text-foreground">{s.studentName}</td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{s.studentNo}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone={bindingTone(s.bindingStatus)}>{bindingLabel(s.bindingStatus)}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={ui.tone}>
                            <Icon className="size-3" />
                            {ui.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {s.reminderCount}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{s.lastReminderAt ? formatDateTime(s.lastReminderAt) : "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          {!s.signed && (
                            <Button variant="ghost" size="xs" disabled={loading} onClick={() => void remind([s.studentId])}>
                              <Bell className="size-3" />
                              提醒
                            </Button>
                          )}
                          <Button variant="ghost" size="xs" disabled={loading} onClick={() => void openStudentDetail(s.studentId)}>详情</Button>
                        </td>
                      </tr>
                    )
                  })
                : staticRows.map((s) => {
                    const ui = signUi[s.sign]
                    const Icon = ui.icon
                    return (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium text-foreground">{s.name}</td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{s.seat}</td>
                        <td className="px-3 py-2.5">
                          {s.bind === "bound" ? (
                            <Badge tone="success">已绑定</Badge>
                          ) : (
                            <Badge tone="info">未绑定</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={ui.tone}>
                            <Icon className="size-3" />
                            {ui.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {s.reminders}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{s.lastReminder}</td>
                        <td className="px-3 py-2.5 text-right">
                          {s.sign !== "signed" && (
                            <Button variant="ghost" size="xs" disabled={loading} onClick={() => void remind([])}>
                              <Bell className="size-3" />
                              提醒
                            </Button>
                          )}
                          <Button variant="ghost" size="xs" onClick={() => openStaticDetail(s)}>详情</Button>
                        </td>
                      </tr>
                    )
                  })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function bindingTone(status: BackendProgressItem["bindingStatus"]): "success" | "info" | "warning" | "stamp" {
  if (status === "BOUND") return "success"
  if (status === "PENDING") return "warning"
  if (status === "HAS_EXCEPTION") return "stamp"
  return "info"
}

function bindingLabel(status: BackendProgressItem["bindingStatus"]) {
  if (status === "BOUND") return "已绑定"
  if (status === "PENDING") return "待审核"
  if (status === "HAS_EXCEPTION") return "有异常"
  return "未绑定"
}

function liveSignUi(item: BackendProgressItem): { tone: "success" | "warning" | "info" | "stamp"; label: string; icon: typeof CheckCircle2 } {
  if (item.signStatus === "SIGNED") return { tone: "success", label: "已签", icon: CheckCircle2 }
  if (item.signStatus === "NO_BINDING") return { tone: "info", label: "未绑定", icon: UserX }
  if (item.signStatus === "OVERDUE_PENDING") return { tone: "warning", label: "逾期待签", icon: CircleDashed }
  if (item.signStatus === "EXCEPTION") return { tone: "stamp", label: "异常", icon: AlertTriangle }
  if (item.signStatus === "PARTIAL") return { tone: "warning", label: "部分签收", icon: CircleDashed }
  return { tone: "warning", label: "待签", icon: CircleDashed }
}

function AbnormalSection({ classId }: { classId: number }) {
  const [items, setItems] = useState<BackendExceptionItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("正在加载待处理异常。")

  async function loadExceptions() {
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/exceptions`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { items: BackendExceptionItem[] }
      setItems(data.items || [])
      setMessage(data.items?.length ? "待处理异常已更新。" : "本班暂无待处理异常。")
    } catch (err) {
      setMessage(err instanceof Error ? `暂时无法加载异常列表：${err.message}` : "暂时无法加载异常列表，请稍后重试。")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadExceptions()
  }, [classId])

  async function resolveException(item: BackendExceptionItem, action: "approve" | "reject") {
    setLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/exceptions/resolve`), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type: item.source,
          bindingId: item.bindingId,
          bindingAnomalyId: item.bindingAnomalyId,
          anomalyId: item.anomalyId,
          action,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      setItems((current) => (current || []).filter((row) => !(row.source === item.source && row.id === item.id)))
      setMessage(action === "approve" ? "已确认有效。" : "已驳回。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "异常处理失败")
    } finally {
      setLoading(false)
    }
  }

  const liveRows = items || null
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          这里集中处理家长绑定和签收中需要老师确认的问题。
        </span>
      </div>
      <Panel
        title="异常处理"
        description="确认有效 / 驳回 / 标记异常并备注"
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadExceptions()}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{message}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">学生</th>
                <th className="px-3 py-2 font-medium">序号</th>
                <th className="px-3 py-2 font-medium">异常类型</th>
                <th className="px-3 py-2 font-medium">分类</th>
                <th className="px-3 py-2 font-medium">说明</th>
                <th className="px-3 py-2 font-medium">发现时间</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {liveRows
                ? liveRows.length
                  ? liveRows.map((x) => (
                      <tr key={`${x.source}-${x.id}`} className="border-b border-border last:border-0 hover:bg-muted/30 align-top">
                        <td className="px-3 py-2.5 font-medium text-foreground">{x.studentName || "（无匹配）"}</td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{x.studentNo}</td>
                        <td className="px-3 py-2.5">
                          <Badge tone="stamp">{x.reason}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={x.source === "sign" ? "warning" : "info"}>
                            {x.source === "sign" ? "签收异常" : "绑定异常"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {x.detail || [x.parentName, x.parentRelation].filter(Boolean).join(" / ") || "—"}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{formatDateTime(x.updatedAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex gap-1">
                              <Button variant="ghost" size="xs" disabled={loading} onClick={() => void resolveException(x, "approve")}>
                                <Check className="size-3 text-success" />
                                确认有效
                              </Button>
                              <Button variant="ghost" size="xs" disabled={loading} onClick={() => void resolveException(x, "reject")}>
                                <Ban className="size-3 text-stamp" />
                                驳回
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  : (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">
                          暂无待处理异常
                        </td>
                      </tr>
                    )
                : ABNORMAL_ROWS.map((x) => (
                    <tr key={x.id} className="border-b border-border last:border-0 hover:bg-muted/30 align-top">
                      <td className="px-3 py-2.5 font-medium text-foreground">{x.student}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{x.seat}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone="stamp">{x.kind}</Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={x.category === "bind" ? "info" : "warning"}>
                          {x.category === "bind" ? "绑定异常" : "签收异常"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{x.detail}</td>
                      <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{x.found}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="xs" disabled title="演示数据不能处理异常">
                              <Check className="size-3 text-success" />
                              确认有效
                            </Button>
                            <Button variant="ghost" size="xs" disabled title="演示数据不能处理异常">
                              <Ban className="size-3 text-stamp" />
                              驳回
                            </Button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function ExportSection({ notice, classId, classLabel }: { notice: AppTeacherNotice; classId: number; classLabel: string }) {
  const [signedItems, setSignedItems] = useState<BackendProgressItem[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [tasks, setTasks] = useState<ExportTaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(notice.isLive ? "请选择要导出的文件。" : "当前为演示导出入口。")

  async function loadSignedItems() {
    if (!notice.numericId) return
    try {
      const response = await fetch(apiUrl(`/api/teacher/class/${classId}/progress?noticeId=${notice.numericId}`), {
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { items: BackendProgressItem[] }
      const signed = (data.items || []).filter((item) => item.signed && item.taskId)
      setSignedItems(signed)
      setSelectedTaskId((current) => current || (signed[0]?.taskId ? String(signed[0].taskId) : ""))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "已签学生列表加载失败")
    }
  }

  useEffect(() => {
    void loadSignedItems()
  }, [notice.numericId, classId])

  async function refreshTask(taskId: string) {
    const response = await fetch(apiUrl(`/api/export/tasks/${taskId}`), {
      headers: getAuthHeaders(),
    })
    if (!response.ok) throw new Error(await readApiError(response))
    const row = (await response.json()) as {
      id: string
      type: ExportTaskType
      status: ExportTaskRow["status"]
      file_path?: string | null
      error?: string | null
      created_at?: string
      finished_at?: string | null
    }
    const next: ExportTaskRow = {
      id: row.id,
      type: row.type,
      status: row.status,
      filePath: row.file_path,
      error: row.error,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    }
    setTasks((current) => current.map((item) => (item.id === next.id ? next : item)))
    return next
  }

  async function createTask(type: ExportTaskType) {
    if (!notice.numericId) {
      setMessage("请先刷新通知列表，再创建导出任务。")
      return
    }
    if (type === "student_pdf" && !selectedTaskId) {
      setMessage("请先选择一名已签学生。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(apiUrl("/api/export/tasks"), {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type,
          noticeId: notice.numericId,
          classroomId: classId,
          taskId: type === "student_pdf" ? Number(selectedTaskId) : undefined,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { taskId: string; status: ExportTaskRow["status"]; filePath?: string | null }
      const next: ExportTaskRow = {
        id: data.taskId,
        type,
        status: data.status,
        filePath: data.filePath,
        createdAt: new Date().toISOString(),
      }
      setTasks((current) => [next, ...current.filter((item) => item.id !== next.id)].slice(0, 6))
      setMessage(`${exportTypeLabel(type)}导出任务已创建。`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出任务创建失败")
    } finally {
      setLoading(false)
    }
  }

  async function downloadTask(task: ExportTaskRow) {
    setLoading(true)
    try {
      const latest = task.status === "SUCCEEDED" ? task : await refreshTask(task.id)
      if (latest.status !== "SUCCEEDED") {
        setMessage("任务尚未成功，暂不能下载。")
        return
      }
      const response = await fetch(apiUrl(`/api/export/tasks/${latest.id}/download`), {
        headers: getAuthHeaders(),
        cache: "no-store",
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") || ""
      const match = disposition.match(/filename="?([^"]+)"?/i)
      const fallbackExt = latest.type === "excel" ? "xls" : latest.type === "student_pdf" ? "pdf" : "zip"
      const fileName = response.headers.get("x-export-filename") || match?.[1] || `${latest.id}.${fallbackExt}`
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage("文件已下载。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出文件下载失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
        <Download className="mt-0.5 size-4 shrink-0" />
        <span>当前导出范围：《{notice.title}》· {classLabel}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <TeacherExportCard
          icon={FileSpreadsheet}
          title="本班 Excel 明细"
          desc="导出本通知签收明细表"
          disabled={loading}
          onCreate={() => void createTask("excel")}
        />
        <TeacherExportCard
          icon={FileText}
          title="单份 PDF"
          desc="选择已签学生生成带签名 PDF"
          disabled={loading || !selectedTaskId}
          onCreate={() => void createTask("student_pdf")}
        >
          <select
            value={selectedTaskId}
            onChange={(event) => setSelectedTaskId(event.target.value)}
            className="mt-2 h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-primary"
          >
            {signedItems.length ? (
              signedItems.map((item) => (
                <option key={item.taskId || item.studentId} value={item.taskId || ""}>
                  {item.studentNo} · {item.studentName}
                </option>
              ))
            ) : (
              <option value="">暂无已签学生</option>
            )}
          </select>
        </TeacherExportCard>
        <TeacherExportCard
          icon={FileArchive}
          title="本班 PDF zip"
          desc="打包本班全部已签学生 PDF"
          disabled={loading}
          onCreate={() => void createTask("class_zip")}
        />
      </div>
      <Panel
        title="导出任务"
        description="文件生成完成后可下载"
        actions={
          <Button variant="outline" size="sm" disabled={loading || !tasks.length} onClick={() => void Promise.all(tasks.map((task) => refreshTask(task.id))).catch((err) => setMessage(err instanceof Error ? err.message : "刷新失败"))}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{message}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">任务</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">创建时间</th>
                <th className="px-3 py-2 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length ? (
                tasks.map((task) => (
                  <tr key={task.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="max-w-48 truncate px-3 py-2.5 font-mono text-xs text-muted-foreground">{task.id}</td>
                    <td className="px-3 py-2.5 text-foreground">{exportTypeLabel(task.type)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={task.status === "SUCCEEDED" ? "success" : task.status === "FAILED" ? "stamp" : "warning"}>
                        {task.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{task.createdAt ? formatDateTime(task.createdAt) : "—"}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="ghost" size="xs" disabled={loading} onClick={() => void refreshTask(task.id).catch((err) => setMessage(err instanceof Error ? err.message : "刷新失败"))}>
                        <RefreshCw className="size-3" />
                        刷新
                      </Button>
                      <Button variant="ghost" size="xs" disabled={loading || task.status !== "SUCCEEDED"} onClick={() => void downloadTask(task)}>
                        <Download className="size-3" />
                        下载
                      </Button>
                      {task.status === "FAILED" && (
                        <Button variant="ghost" size="xs" disabled={loading} onClick={() => void createTask(task.type)}>
                          <RefreshCw className="size-3" />
                          重试
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    暂无导出任务
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function TeacherExportCard({
  icon: Icon,
  title,
  desc,
  disabled,
  children,
  onCreate,
}: {
  icon: typeof FileText
  title: string
  desc: string
  disabled?: boolean
  children?: React.ReactNode
  onCreate: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex size-9 items-center justify-center rounded-md bg-accent text-primary">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        {children}
        <Button variant="outline" size="xs" className="mt-2" disabled={disabled} onClick={onCreate}>
          发起导出
        </Button>
      </div>
    </div>
  )
}
