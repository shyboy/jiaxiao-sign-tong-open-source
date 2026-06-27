"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  BarChart3,
  Users,
  Megaphone,
  Download,
  ShieldAlert,
  Search,
  FileSpreadsheet,
  FileText,
  FileArchive,
  RotateCw,
  CalendarClock,
  Settings,
  Building2,
  Network,
  UserPlus,
  Plus,
  KeyRound,
  Ban,
  Send,
  Trash2,
  ShieldCheck,
  Upload,
  Users2,
  GraduationCap,
  Paperclip,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConsoleLayout, type NavItem } from "@/components/views/console-layout"
import { Badge, Panel, Metric, Field, inputClass, Modal } from "@/components/views/shared"
import {
  type AuditLog,
  type Notice,
  type NoticeStatus,
  type TeacherAccountStatus,
} from "@/lib/demo-data"

const NAV: NavItem[] = [
  { key: "progress", label: "班级进度", icon: BarChart3 },
  { key: "notices", label: "通知发布", icon: Megaphone },
  { key: "settings", label: "学校设置", icon: Settings },
  { key: "teachers", label: "组织教师", icon: Users },
  { key: "export", label: "导出归档", icon: Download },
  { key: "audit", label: "审计安全", icon: ShieldAlert },
]

const SECTION_TITLE: Record<string, string> = {
  progress: "班级签收进度",
  notices: "通知发布",
  settings: "学校设置",
  teachers: "组织与教师",
  export: "导出归档",
  audit: "审计安全",
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8088"
const CUSTOM_NOTICE_TYPE_VALUE = "__custom"
const NOTICE_TYPE_OPTIONS = ["安全承诺书", "家长告知书", "活动回执", "资料确认", "防溺水告知", "其他"]
const PLACEHOLDER_TEXT = "—"

type NoticeContentSource = "TEXT" | "PDF"

type NoticeAttachment = {
  id: number
  fileName: string
  fileSize: number
  mimeType?: string
  sha256?: string
  createdAt?: string
  downloadUrl?: string | null
}

type CreateNoticeInput = {
  title: string
  body: string
  dueAt: string
  scopeClassIds: number[]
  publish: boolean
  noticeType: string
  contentSource: NoticeContentSource
  attachmentId?: number | null
}

type AdminSchoolSettings = {
  school: { id: number; name: string; enabled: boolean; createdAt: string; termName?: string } | null
  grades?: AdminGradeRow[]
  classes: AdminClassRow[]
  users: AdminUserRow[]
}

type AdminGradeRow = {
  id: number
  name: string
  entryYear: string
  createdAt: string
}

type AdminClassRow = {
  id: number
  grade: string
  name: string
  capacity: number
  createdAt: string
  teacher: { id: number; name: string; username: string } | null
}

type CreateGradeInput = {
  name: string
  entryYear: string
  initialClassCount?: number
  classCapacity?: number
}

type CreateClassInput = {
  grade: string
  name: string
  capacity: number
}

type UpdateClassInput = CreateClassInput & {
  id: number
}

type AdminUserRow = {
  id: number
  username: string
  role: "school_admin" | "teacher"
  name: string
  classroomId: number | null
  enabled: boolean
  createdAt: string
}

type BackendNoticeRow = {
  id: number
  title: string
  body: string
  notice_type?: string | null
  content_source?: NoticeContentSource | null
  attachment?: NoticeAttachment | null
  status: "DRAFT" | "PUBLISHED"
  version: number
  due_at: string
  published_at: string | null
}

type NoticeDisplay = Notice & {
  numericId?: number
  body?: string
  noticeType?: string
  contentSource?: NoticeContentSource
  attachment?: NoticeAttachment | null
}

type AdminExportTaskType = "excel" | "student_pdf" | "class_zip"

type AdminExportTaskRow = {
  id: string
  type: AdminExportTaskType
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
  createdAt?: string
  filePath?: string | null
}

type AdminProgressItem = {
  studentId: number
  studentNo: string
  studentName: string
  taskId: number | null
  signed: boolean
  signStatus?: string
  bindingStatus?: string
}

type SchoolOverviewProgressRow = {
  noticeId: number
  noticeTitle: string
  classId: number
  className: string
  classGrade?: string
  classShortName?: string
  expected: number
  teacherId?: number | null
  teacherName?: string | null
  teacherUsername?: string | null
  signed: number
  unbound: number
  exception: number
  overdue: number
  dueAt: string
  forwardStatus: "PENDING" | "FORWARDED"
  forwardedAt: string | null
}

type ExportPreset = { noticeId?: string; classroomId?: string } | null

type GradeDisplayRow = {
  id: string
  numericId: number | null
  grade: string
  entryYear: string
  classCount: number
  studentCount: number
  classes: string[]
}

type CsvTemplate = {
  fileName: string
  columns: string[]
}

type SchoolImportKind = "grades" | "classes" | "accounts"

type SchoolImportPreviewRow = {
  rowNumber?: number
  action: "ADD" | "UPDATE" | "SKIP"
  displayName: string
  detail: string
  [key: string]: unknown
}

type SchoolImportPreview = {
  kind: SchoolImportKind
  result: { add: number; update: number; skip: number }
  warnings: Array<{ rowNumber?: number; reason: string }>
  errors: Array<{ rowNumber?: number; reason: string }>
  canSubmit: boolean
  rows: SchoolImportPreviewRow[]
  source?: { sourceType: string; fileName: string; rowCount: number }
}

type SchoolImportCommitResult = {
  preview: SchoolImportPreview
  createdAccounts?: Array<{ username: string; name: string; initialPassword: string }>
}

function getAdminAuthHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra)
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem("jiaxiaoToken")
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }
  if (!headers.has("Authorization") && process.env.NODE_ENV !== "production") {
    headers.set("x-demo-user", "school_admin")
  }
  return headers
}

async function readApiError(response: Response) {
  const statusText = response.status ? `HTTP ${response.status}` : "请求失败"
  try {
    const text = await response.text()
    if (!text) return statusText
    try {
      const body = JSON.parse(text)
      return body.message || body.code || statusText
    } catch {
      if (response.status === 404 && /Cannot\s+(GET|POST|PATCH|DELETE)/i.test(text)) {
        return "后端接口未加载，请重启后端服务后重试。"
      }
      const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
      return plain ? `${statusText}：${plain.slice(0, 120)}` : statusText
    }
  } catch {
    return statusText
  }
}

function formatDateTime(value: string | null | undefined) {
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

function formatFileSize(value: number | null | undefined) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function mapBackendNotice(row: BackendNoticeRow): NoticeDisplay {
  const isClosed = row.status === "PUBLISHED" && new Date(row.due_at).getTime() < Date.now()
  return {
    id: `notice-${row.id}`,
    numericId: row.id,
    title: row.title,
    body: row.body,
    noticeType: row.notice_type || "安全承诺书",
    contentSource: row.content_source === "PDF" ? "PDF" : "TEXT",
    attachment: row.attachment || null,
    status: row.status === "DRAFT" ? "draft" : isClosed ? "closed" : "published",
    deadline: formatDateTime(row.due_at),
    classes: "本校已选班级",
    version: `v${row.version}`,
    publishedAt: row.published_at ? formatDateTime(row.published_at) : "—",
  }
}

function exportTypeLabel(type: AdminExportTaskType) {
  if (type === "excel") return "Excel 明细"
  if (type === "student_pdf") return "单份 PDF"
  return "班级 PDF zip"
}

function compactClassLabel(value: string) {
  const match = value.match(/^(.+)\((.+)\)$/)
  return match ? `${match[1]}${match[2]}` : value
}

function escapeCsvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function downloadBlob(blob: Blob, fileName: string) {
  if (typeof window === "undefined") return
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.setAttribute("download", fileName)
  link.style.display = "none"
  document.body.appendChild(link)
  link.click()
  window.setTimeout(() => {
    link.remove()
    window.URL.revokeObjectURL(url)
  }, 1000)
}

function downloadCsvTemplate(template: CsvTemplate) {
  if (typeof window === "undefined") return
  const rows = [template.columns]
  const csv = "\ufeff" + rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  downloadBlob(blob, template.fileName)
}

function toDatetimeLocal(value: string | null | undefined) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ""
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function SchoolAdminView({
  accountName,
  onLogout,
}: {
  accountName?: string
  onLogout?: () => void
}) {
  const [active, setActive] = useState("progress")
  const [schoolName, setSchoolName] = useState(PLACEHOLDER_TEXT)
  const [schoolTerm, setSchoolTerm] = useState(PLACEHOLDER_TEXT)
  const [exportPreset, setExportPreset] = useState<ExportPreset>(null)

  function goExport(noticeId?: number | string, classroomId?: number | string) {
    setExportPreset({
      noticeId: noticeId ? String(noticeId) : undefined,
      classroomId: classroomId ? String(classroomId) : undefined,
    })
    setActive("export")
  }

  useEffect(() => {
    async function loadSchoolName() {
      try {
        const response = await fetch(`${API_BASE}/api/school-admin/settings`, {
          headers: getAdminAuthHeaders(),
        })
        if (!response.ok) {
          setSchoolName(PLACEHOLDER_TEXT)
          return
        }
        const data = (await response.json()) as AdminSchoolSettings
        setSchoolName(data.school?.name || PLACEHOLDER_TEXT)
        setSchoolTerm(PLACEHOLDER_TEXT)
      } catch {
        setSchoolName(PLACEHOLDER_TEXT)
        setSchoolTerm(PLACEHOLDER_TEXT)
      }
    }
    void loadSchoolName()
  }, [])

  return (
    <ConsoleLayout
      roleLabel="学校管理员端"
      accountName={accountName || "学校管理员"}
      onLogout={onLogout}
      nav={NAV}
      active={active}
      onNavChange={setActive}
      schoolLine={
        <div className="flex items-center gap-2">
          <span className="font-semibold">{schoolName}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{schoolTerm}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">{SECTION_TITLE[active]}</span>
        </div>
      }
    >
      {active === "progress" && <ProgressSection onExport={goExport} />}
      {active === "notices" && <NoticesSection onExport={goExport} />}
      {active === "settings" && <SettingsSection onSchoolNameChange={setSchoolName} />}
    {active === "export" && <ExportSection preset={exportPreset} />}
    {active === "audit" && <AuditSection />}
    {active === "teachers" && <TeachersSection />}
    </ConsoleLayout>
  )
}

function ProgressSection({ onExport }: { onExport: (noticeId?: number | string, classroomId?: number | string) => void }) {
  const [rows, setRows] = useState<SchoolOverviewProgressRow[]>([])
  const [selected, setSelected] = useState<NoticeDisplay | null>(null)
  const [message, setMessage] = useState("正在加载班级进度。")
  const [query, setQuery] = useState("")
  const [onlyBeforeDue, setOnlyBeforeDue] = useState(false)

  async function loadOverview() {
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/overview`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { progress: SchoolOverviewProgressRow[] }
      const nextRows = data.progress || []
      setRows(nextRows)
      setMessage(nextRows.length ? "班级进度已更新。" : "还没有班级进度。请先发布通知，并确认班级里已有学生。")
    } catch (err) {
      setRows([])
      setMessage(err instanceof Error ? err.message : "暂时无法加载班级进度，请稍后重试。")
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  if (selected) {
    return <NoticeDetailSection notice={selected} onBack={() => setSelected(null)} onNoticeChange={setSelected} onExport={onExport} />
  }

  const baseDisplayRows = rows.map((row) => ({
    id: `${row.noticeId}-${row.classId}`,
    noticeId: row.noticeId,
    noticeTitle: row.noticeTitle,
    classId: row.classId,
    grade: row.classGrade
      ? row.classGrade
      : compactClassLabel(row.className).replace(/（.*$/, ""),
    className: row.classShortName || row.className || compactClassLabel(row.className),
    teacher: row.teacherName || PLACEHOLDER_TEXT,
    due: row.expected,
    signed: row.signed,
    unbound: row.unbound,
    waiting: Math.max(0, row.expected - row.signed - row.unbound),
    abnormal: row.exception,
    rate: row.expected ? Math.round((row.signed / row.expected) * 1000) / 10 : 0,
    forward: row.forwardStatus === "FORWARDED" ? "forwarded" : "pending",
    dueAt: row.dueAt,
  }))
  const normalizedQuery = query.trim().toLowerCase()
  const displayRows = baseDisplayRows.filter((row) => {
    const matchQuery = !normalizedQuery || [row.noticeTitle, row.grade, row.className, row.teacher]
      .some((value) => String(value || "").toLowerCase().includes(normalizedQuery))
    if (!matchQuery) return false
    if (!onlyBeforeDue || !row.dueAt) return true
    const dueTime = new Date(row.dueAt).getTime()
    return !Number.isFinite(dueTime) || dueTime >= Date.now()
  })
  const progressTotals = displayRows.reduce(
    (total, row) => ({
      due: total.due + row.due,
      signed: total.signed + row.signed,
      unbound: total.unbound + row.unbound,
      waiting: total.waiting + row.waiting,
      abnormal: total.abnormal + row.abnormal,
    }),
    { due: 0, signed: 0, unbound: 0, waiting: 0, abnormal: 0 },
  )
  const progressRate = progressTotals.due ? Math.round((progressTotals.signed / progressTotals.due) * 1000) / 10 : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Metric label="应签" value={progressTotals.due} tone="muted" />
        <Metric label="已签" value={progressTotals.signed} tone="success" />
        <Metric label="未绑定" value={progressTotals.unbound} tone="info" />
        <Metric label="异常" value={progressTotals.abnormal} tone="stamp" />
        <Metric label="签收率" value={progressRate} suffix="%" tone="primary" />
      </div>
      <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">{message}</div>

      <Panel
        title="各班签收进度"
        description="按通知查看各班签收情况"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索班级 / 班主任"
                className="h-8 w-48 rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <Button
              variant={onlyBeforeDue ? "secondary" : "outline"}
              size="sm"
              onClick={() => setOnlyBeforeDue((value) => !value)}
            >
              <CalendarClock className="size-3.5" />
              截止前
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>通知</Th>
                <Th>年级</Th>
                <Th>班级</Th>
                <Th>班主任</Th>
                <Th className="text-right">应签</Th>
                <Th className="text-right">已签</Th>
                <Th className="text-right">未绑定</Th>
                <Th className="text-right">待签</Th>
                <Th className="text-right">异常</Th>
                <Th>签收率</Th>
                <Th>转发状态</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length ? displayRows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <Td className="max-w-48 truncate text-muted-foreground">{c.noticeTitle}</Td>
                  <Td className="text-muted-foreground">{c.grade}</Td>
                  <Td className="font-medium text-foreground">{c.className}</Td>
                  <Td className="text-muted-foreground">{c.teacher}</Td>
                  <Td className="text-right tabular-nums">{c.due}</Td>
                  <Td className="text-right font-medium tabular-nums text-success">
                    {c.signed}
                  </Td>
                  <Td className="text-right tabular-nums text-info">
                    {c.unbound}
                  </Td>
                  <Td className="text-right tabular-nums">{c.waiting}</Td>
                  <Td className="text-right tabular-nums">
                    {c.abnormal > 0 ? (
                      <span className="text-stamp">{c.abnormal}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </Td>
                  <Td>
                    <RateBar value={c.rate} />
                  </Td>
                  <Td>
                    {c.forward === "forwarded" ? (
                      <Badge tone="success">已转发</Badge>
                    ) : (
                      <Badge tone="warning">未转发</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        c.noticeId
                          ? setSelected({
                              id: `notice-${c.noticeId}`,
                              numericId: c.noticeId,
                              title: c.noticeTitle,
                              status: "published",
                              deadline: formatDateTime(c.dueAt),
                              classes: c.className,
                              version: "v1",
                              publishedAt: "—",
                            })
                          : undefined
                      }
                    >
                      查看
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => onExport(c.noticeId, c.classId)}>
                      导出
                    </Button>
                  </Td>
                </tr>
              )) : (
                <tr>
                  <Td colSpan={12} className="py-8 text-center text-muted-foreground">
                    暂无班级进度。请先在通知发布中创建并发布通知，或为班级导入学生后再查看。
                  </Td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="bg-muted/40 text-sm font-medium">
                <Td className="text-muted-foreground" colSpan={4}>
                  合计
                </Td>
                <Td className="text-right tabular-nums">{progressTotals.due}</Td>
                <Td className="text-right tabular-nums text-success">{progressTotals.signed}</Td>
                <Td className="text-right tabular-nums text-info">{progressTotals.unbound}</Td>
                <Td className="text-right tabular-nums">{progressTotals.waiting}</Td>
                <Td className="text-right tabular-nums text-stamp">{progressTotals.abnormal}</Td>
                <Td colSpan={3} className="text-muted-foreground">
                  全校签收率 {progressRate}%
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function NoticesSection({ onExport }: { onExport: (noticeId?: number | string, classroomId?: number | string) => void }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<NoticeDisplay | null>(null)
  const [notices, setNotices] = useState<NoticeDisplay[]>([])
  const [classOptions, setClassOptions] = useState<Array<{ id: number; label: string }>>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("正在加载通知列表。")
  const [error, setError] = useState("")
  const statusMap: Record<NoticeStatus, { tone: "success" | "muted" | "warning"; label: string }> = {
    published: { tone: "success", label: "已发布" },
    draft: { tone: "warning", label: "草稿" },
    closed: { tone: "muted", label: "已截止" },
  }

  async function loadNoticeData() {
    setLoading(true)
    setError("")
    try {
      const [noticeResponse, settingsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/teacher/notices`, { headers: getAdminAuthHeaders() }),
        fetch(`${API_BASE}/api/school-admin/settings`, { headers: getAdminAuthHeaders() }),
      ])
      if (!noticeResponse.ok) throw new Error(await readApiError(noticeResponse))
      if (!settingsResponse.ok) throw new Error(await readApiError(settingsResponse))
      const noticeData = (await noticeResponse.json()) as { notices: BackendNoticeRow[] }
      const settingsData = (await settingsResponse.json()) as AdminSchoolSettings
      setNotices((noticeData.notices || []).map(mapBackendNotice))
      setClassOptions(settingsData.classes.map((item) => ({ id: item.id, label: `${item.grade}${item.name}` })))
      setMessage("通知列表已更新。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "通知数据加载失败")
      setNotices([])
      setClassOptions([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadNoticeData()
  }, [])

  async function createNotice(input: CreateNoticeInput) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/teacher/notices`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          noticeType: input.noticeType,
          contentSource: input.contentSource,
          attachmentId: input.attachmentId || null,
          dueAt: input.dueAt,
          scopeClassIds: input.scopeClassIds,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { noticeId: number }
      if (input.publish) {
        const publishResponse = await fetch(`${API_BASE}/api/teacher/notices/${data.noticeId}/publish`, {
          method: "POST",
          headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({}),
        })
        if (!publishResponse.ok) throw new Error(await readApiError(publishResponse))
      }
      await loadNoticeData()
      setMessage(input.publish ? "通知已发布并生成签收任务。" : "通知草稿已保存。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "通知保存失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function publishNotice(noticeId: number) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/teacher/notices/${noticeId}/publish`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({}),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadNoticeData()
      setMessage("通知已发布并生成签收任务。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "通知发布失败")
    } finally {
      setLoading(false)
    }
  }

  if (selected) {
    return (
      <NoticeDetailSection
        notice={selected}
        onBack={() => setSelected(null)}
        onNoticeChange={(nextNotice) => {
          setSelected(nextNotice)
          setNotices((current) => current.map((item) => (item.id === nextNotice.id ? nextNotice : item)))
        }}
        onExport={onExport}
      />
    )
  }

  return (
    <div className="space-y-4">
      <CreateNoticeModal
        open={createOpen}
        classOptions={classOptions}
        loading={loading}
        onCreate={createNotice}
        onClose={() => setCreateOpen(false)}
      />
      <div className="flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        <span>{loading ? "正在同步通知数据。" : error || message}</span>
      </div>
      <Panel
        title="通知列表"
        description="学校统一创建并发布到班级"
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Megaphone className="size-3.5" />新建通知</Button>}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>通知标题</Th>
                <Th>类型/来源</Th>
                <Th>状态</Th>
                <Th>截止时间</Th>
                <Th>覆盖班级</Th>
                <Th>版本号</Th>
                <Th>发布时间</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="font-medium text-foreground">{n.title}</Td>
                  <Td>
                    <div className="text-foreground">{n.noticeType || "安全承诺书"}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{n.contentSource === "PDF" ? "PDF 附件" : "文字正文"}</div>
                  </Td>
                  <Td>
                    <Badge tone={statusMap[n.status].tone}>
                      {statusMap[n.status].label}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground tabular-nums">{n.deadline}</Td>
                  <Td className="text-muted-foreground">{n.classes}</Td>
                  <Td>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {n.version}
                    </span>
                  </Td>
                  <Td className="text-muted-foreground tabular-nums">{n.publishedAt}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="xs" onClick={() => setSelected(n)}>查看</Button>
                    {n.status === "published" ? (
                      <Button variant="ghost" size="xs" disabled title="新版本接口未接入">
                        新版本
                      </Button>
                    ) : n.status === "draft" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={loading || !n.numericId}
                        onClick={() => n.numericId && void publishNotice(n.numericId)}
                      >
                        发布
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function NoticeDetailSection({
  notice,
  onBack,
  onNoticeChange,
  onExport,
}: {
  notice: NoticeDisplay
  onBack: () => void
  onNoticeChange: (notice: NoticeDisplay) => void
  onExport: (noticeId?: number | string, classroomId?: number | string) => void
}) {
  const [rows, setRows] = useState<SchoolOverviewProgressRow[]>([])
  const [message, setMessage] = useState("正在加载班级签收情况。")
  const [dueOpen, setDueOpen] = useState(false)
  const [dueInput, setDueInput] = useState(toDatetimeLocal(notice.deadline))
  const [pendingOpen, setPendingOpen] = useState(false)
  const [pendingTitle, setPendingTitle] = useState("")
  const [pendingRows, setPendingRows] = useState<AdminProgressItem[]>([])
  const [loading, setLoading] = useState(false)

  async function loadDetailRows() {
    if (!notice.numericId) return
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/overview`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { progress: SchoolOverviewProgressRow[] }
      const nextRows = (data.progress || []).filter((row) => row.noticeId === notice.numericId)
      setRows(nextRows)
      setMessage("班级签收情况已更新。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "暂时无法加载班级签收情况，请稍后重试。")
    }
  }

  useEffect(() => {
    setDueInput(toDatetimeLocal(notice.deadline))
    void loadDetailRows()
  }, [notice.numericId, notice.deadline])

  async function saveDueAt() {
    if (!notice.numericId || !dueInput) return
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/teacher/notices/${notice.numericId}/due-at`, {
        method: "PATCH",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dueAt: new Date(dueInput).toISOString() }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { dueAt: string }
      const nextNotice = { ...notice, deadline: formatDateTime(data.dueAt) }
      onNoticeChange(nextNotice)
      setDueOpen(false)
      setMessage("截止时间已更新。")
      await loadDetailRows()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "截止时间修改失败")
    } finally {
      setLoading(false)
    }
  }

  async function showPendingStudents(row: { classId?: number; className: string }) {
    if (!notice.numericId || !row.classId) return
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/teacher/class/${row.classId}/progress?noticeId=${notice.numericId}`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { items: AdminProgressItem[] }
      setPendingRows((data.items || []).filter((item) => !item.signed))
      setPendingTitle(`${row.className} · 未签学生`)
      setPendingOpen(true)
      setMessage("已读取未签学生。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "未签学生加载失败")
    } finally {
      setLoading(false)
    }
  }

  const detailRows = rows.length
    ? rows.map((row, index) => ({
        id: `${row.noticeId}-${row.classId}`,
        classId: row.classId,
        className: row.classShortName || compactClassLabel(row.className),
        teacher: row.teacherName || PLACEHOLDER_TEXT,
        link: `/s/${row.noticeId}-${row.classId}-${index + 1}kQ`,
        forward: row.forwardStatus === "FORWARDED" ? "forwarded" : "pending",
        due: row.expected,
        signed: row.signed,
        abnormal: row.exception,
      }))
    : []
  const totalDue = detailRows.reduce((sum, row) => sum + row.due, 0)
  const totalSigned = detailRows.reduce((sum, row) => sum + row.signed, 0)
  const totalAbnormal = detailRows.reduce((sum, row) => sum + row.abnormal, 0)

  return (
    <div className="space-y-4">
      <Modal
        open={dueOpen}
        onClose={() => setDueOpen(false)}
        title="修改截止时间"
        description="只调整截止时间，通知内容不变"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDueOpen(false)}>取消</Button>
            <Button size="sm" disabled={loading} onClick={() => void saveDueAt()}>保存截止时间</Button>
          </>
        }
      >
        <Field label="新截止时间" required>
          <input className={inputClass} type="datetime-local" value={dueInput} onChange={(event) => setDueInput(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        title={pendingTitle || "未签学生"}
        description="这些学生尚未签收，便于后续提醒"
        footer={<Button size="sm" onClick={() => setPendingOpen(false)}>关闭</Button>}
      >
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>序号</Th>
                <Th>学生</Th>
                <Th>绑定状态</Th>
                <Th>签收状态</Th>
              </tr>
            </thead>
            <tbody>
              {pendingRows.length ? (
                pendingRows.map((item) => (
                  <tr key={item.studentId} className="border-b border-border last:border-0">
                    <Td className="tabular-nums text-muted-foreground">{item.studentNo}</Td>
                    <Td className="font-medium text-foreground">{item.studentName}</Td>
                    <Td className="text-muted-foreground">{item.bindingStatus || "—"}</Td>
                    <Td className="text-muted-foreground">{item.signStatus || "PENDING"}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={4} className="py-8 text-center text-muted-foreground">暂无未签学生</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button variant="outline" size="sm" onClick={onBack}>
            返回通知列表
          </Button>
          <h2 className="mt-3 text-base font-semibold text-foreground">{notice.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {notice.noticeType || "安全承诺书"} · {notice.version} · 发布时间 {notice.publishedAt} · 截止 {notice.deadline}
          </p>
        </div>
        <Badge tone="success">已发布</Badge>
      </div>
      <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">{message}</div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Metric label="覆盖班级" value={detailRows.length} tone="muted" />
        <Metric label="应签学生" value={totalDue} tone="muted" />
        <Metric label="已签学生" value={totalSigned} tone="success" />
        <Metric label="异常" value={totalAbnormal} tone="stamp" />
      </div>

      <Panel
        title={notice.contentSource === "PDF" ? "签收说明与附件" : "通知内容"}
        description="发布后的通知内容保持不变；如需调整正文，请新建通知"
        actions={
          <Button variant="outline" size="sm" disabled={!notice.numericId || loading} onClick={() => setDueOpen(true)}>
            修改截止时间
          </Button>
        }
      >
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed text-foreground">
          {notice.body ||
            "一、合理安排作息，保证充足睡眠。二、注意交通安全，自觉遵守交通规则。三、严防溺水，做到“六不”。四、注意用电、用火、饮食安全。本人已认真阅读并同意以上内容，承诺履行监护职责。"}
        </div>
        {notice.contentSource === "PDF" && notice.attachment && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm">
            <Paperclip className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="font-medium text-foreground">{notice.attachment.fileName}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {formatFileSize(notice.attachment.fileSize)}
                {notice.attachment.sha256 ? ` · SHA-256 ${notice.attachment.sha256.slice(0, 12)}...` : ""}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="班级转发和签收"
        description="每个班级都有自己的签收链接，请把对应链接发到本班家长群"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>班级</Th>
                <Th>班主任</Th>
                <Th>链接摘要</Th>
                <Th>转发状态</Th>
                <Th className="text-right">应签</Th>
                <Th className="text-right">已签</Th>
                <Th className="text-right">异常</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="font-medium text-foreground">{c.className}</Td>
                  <Td className="text-muted-foreground">{c.teacher}</Td>
                  <Td>
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {c.link}
                    </span>
                  </Td>
                  <Td>
                    {c.forward === "forwarded" ? (
                      <Badge tone="success">已转发</Badge>
                    ) : (
                      <Badge tone="warning">未转发</Badge>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{c.due}</Td>
                  <Td className="text-right tabular-nums text-success">{c.signed}</Td>
                  <Td className="text-right tabular-nums text-stamp">{c.abnormal}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="xs" disabled={!notice.numericId || !c.classId || loading} onClick={() => void showPendingStudents(c)}>未签</Button>
                    <Button variant="ghost" size="xs" disabled={!notice.numericId || !c.classId} onClick={() => onExport(notice.numericId, c.classId)}>导出</Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function CreateNoticeModal({
  open,
  classOptions,
  loading,
  onCreate,
  onClose,
}: {
  open: boolean
  classOptions: { id: number; label: string }[]
  loading: boolean
  onCreate: (input: CreateNoticeInput) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState("2026 春季安全承诺书")
  const [noticeType, setNoticeType] = useState("安全承诺书")
  const [customNoticeType, setCustomNoticeType] = useState("")
  const [contentSource, setContentSource] = useState<NoticeContentSource>("TEXT")
  const [attachment, setAttachment] = useState<NoticeAttachment | null>(null)
  const [uploading, setUploading] = useState(false)
  const [localError, setLocalError] = useState("")
  const [dueAt, setDueAt] = useState("2026-06-10T18:00")
  const [body, setBody] = useState(
    "一、合理安排作息，保证充足睡眠。\n二、注意交通安全，自觉遵守交通规则。\n三、严防溺水，做到「六不」。\n四、注意用电、用火、饮食安全。\n五、外出告知家长去向，文明上网。",
  )
  const [scopeClassIds, setScopeClassIds] = useState<number[]>([])
  const pdfInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setScopeClassIds(classOptions.map((item) => item.id))
      setLocalError("")
    }
  }, [open, classOptions])

  async function uploadPdf(file: File) {
    setLocalError("")
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setLocalError("请上传 PDF 文件。")
      return
    }
    setUploading(true)
    try {
      const response = await fetch(`${API_BASE}/api/teacher/notice-attachments/pdf?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/pdf" }),
        body: await file.arrayBuffer(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { attachment: NoticeAttachment }
      setAttachment(data.attachment)
    } catch (err) {
      setAttachment(null)
      setLocalError(err instanceof Error ? err.message : "PDF 上传失败")
    } finally {
      setUploading(false)
    }
  }

  function submit(publish: boolean) {
    const selectedType = noticeType === CUSTOM_NOTICE_TYPE_VALUE ? customNoticeType.trim() : noticeType
    const dueDate = new Date(dueAt)
    setLocalError("")
    if (!selectedType) {
      setLocalError("请填写通知类型。")
      return
    }
    if (!title.trim() || !body.trim() || !scopeClassIds.length || Number.isNaN(dueDate.getTime())) {
      setLocalError("请完整填写标题、正文或说明、截止时间和发布范围。")
      return
    }
    if (contentSource === "PDF" && !attachment) {
      setLocalError("请先上传 PDF 文件。")
      return
    }
    void onCreate({
      title,
      body,
      dueAt: dueDate.toISOString(),
      scopeClassIds,
      publish,
      noticeType: selectedType,
      contentSource,
      attachmentId: contentSource === "PDF" ? attachment?.id : null,
    }).then(onClose).catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="新建通知"
      description="学校统一创建通知；发布后班主任可转发给家长"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button variant="outline" size="sm" disabled={loading || uploading} onClick={() => submit(false)}>存为草稿</Button>
          <Button size="sm" disabled={loading || uploading} onClick={() => submit(true)}>
            <Megaphone className="size-3.5" />
            发布通知
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="通知标题" required>
          <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="如：2026 春季安全承诺书" />
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="通知类型" hint="所有通知仍要求家长手写签名">
            <select className={inputClass} value={noticeType} onChange={(event) => setNoticeType(event.target.value)}>
              {NOTICE_TYPE_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
              <option value={CUSTOM_NOTICE_TYPE_VALUE}>自定义</option>
            </select>
            {noticeType === CUSTOM_NOTICE_TYPE_VALUE && (
              <input
                className={`${inputClass} mt-2`}
                value={customNoticeType}
                onChange={(event) => setCustomNoticeType(event.target.value)}
                placeholder="如：校外实践安全确认"
              />
            )}
          </Field>
          <Field label="截止时间" required hint="家长需在此时间前完成签收">
            <input className={inputClass} type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
          </Field>
        </div>

        <Field label="发布范围" required>
          <div className="rounded-md border border-input bg-background p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={scopeClassIds.length === classOptions.length && classOptions.length > 0}
                className="size-4 accent-[var(--primary)]"
                onChange={(event) => setScopeClassIds(event.target.checked ? classOptions.map((item) => item.id) : [])}
              />
              全校（{classOptions.length || 0} 个班）
            </label>
            <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
              {classOptions.map((item) => (
                <label key={item.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={scopeClassIds.includes(item.id)}
                    className="size-3.5 accent-[var(--primary)]"
                    onChange={(event) =>
                      setScopeClassIds((current) =>
                        event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        </Field>

        <Field label="正文来源" required hint="可直接粘贴正文，也可上传 PDF 原件">
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: "TEXT" as const, label: "粘贴文字" },
              { key: "PDF" as const, label: "上传 PDF" },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={
                  "rounded-md border px-3 py-2 text-sm font-medium transition " +
                  (contentSource === item.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground")
                }
                onClick={() => setContentSource(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Field>

        {contentSource === "PDF" && (
          <div>
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) void uploadPdf(file)
              }}
            />
            <button
              type="button"
              className="flex w-full items-center justify-center rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary/5"
              onClick={() => pdfInputRef.current?.click()}
              disabled={uploading}
            >
              <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                <span className="flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Upload className="size-5" />
                </span>
                <span className="font-medium text-foreground">{uploading ? "正在上传 PDF..." : attachment ? attachment.fileName : "点击选择 PDF 文件"}</span>
                <span>{attachment ? `${formatFileSize(attachment.fileSize)} · 已上传` : "家长端将通过签收链接查看附件"}</span>
              </span>
            </button>
          </div>
        )}

        <Field
          label={contentSource === "PDF" ? "签收说明" : "通知正文"}
          required
          hint={contentSource === "PDF" ? "说明附件用途和签收要求；发布后如需调整，可新建通知" : "支持分条列出；发布后如需调整，可新建通知"}
        >
          <textarea
            className="h-36 w-full resize-none rounded-md border border-input bg-background p-3 text-sm leading-relaxed text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={contentSource === "PDF" ? "请阅读 PDF 附件，确认知悉并完成手写签名签收。" : undefined}
          />
        </Field>

        <label className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
          <input type="checkbox" checked readOnly className="size-4 accent-[var(--primary)]" />
          要求家长手写签名签收
          <span className="text-xs text-muted-foreground">（当前 MVP 固定启用）</span>
        </label>
        {localError && (
          <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">
            {localError}
          </div>
        )}
      </div>
    </Modal>
  )
}

function ExportSection({ preset }: { preset?: ExportPreset }) {
  const [notices, setNotices] = useState<NoticeDisplay[]>([])
  const [classes, setClasses] = useState<Array<{ id: number; label: string }>>([])
  const [progressItems, setProgressItems] = useState<AdminProgressItem[]>([])
  const [noticeId, setNoticeId] = useState("")
  const [classroomId, setClassroomId] = useState("")
  const [studentTaskId, setStudentTaskId] = useState("")
  const [tasks, setTasks] = useState<AdminExportTaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("请选择要导出的通知和班级。")

  async function loadExportOptions() {
    setLoading(true)
    try {
      const [noticeResponse, settingsResponse] = await Promise.all([
        fetch(`${API_BASE}/api/teacher/notices`, { headers: getAdminAuthHeaders() }),
        fetch(`${API_BASE}/api/school-admin/settings`, { headers: getAdminAuthHeaders() }),
      ])
      if (!noticeResponse.ok) throw new Error(await readApiError(noticeResponse))
      if (!settingsResponse.ok) throw new Error(await readApiError(settingsResponse))
      const noticeData = (await noticeResponse.json()) as { notices: BackendNoticeRow[] }
      const settingsData = (await settingsResponse.json()) as AdminSchoolSettings
      const nextNotices = (noticeData.notices || []).map(mapBackendNotice)
      const nextClasses = settingsData.classes.map((item) => ({ id: item.id, label: `${item.grade}${item.name}` }))
      setNotices(nextNotices)
      setClasses(nextClasses)
      setNoticeId((current) => current || String(nextNotices.find((item) => item.status !== "draft")?.numericId || nextNotices[0]?.numericId || ""))
      setClassroomId((current) => current || String(nextClasses[0]?.id || ""))
      setMessage("导出范围已更新。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出范围加载失败")
    } finally {
      setLoading(false)
    }
  }

  async function loadSignedStudents(nextNoticeId = noticeId, nextClassroomId = classroomId) {
    if (!nextNoticeId || !nextClassroomId) return
    try {
      const response = await fetch(`${API_BASE}/api/teacher/class/${nextClassroomId}/progress?noticeId=${nextNoticeId}`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { items: AdminProgressItem[] }
      const signed = (data.items || []).filter((item) => item.signed && item.taskId)
      setProgressItems(signed)
      setStudentTaskId((current) => current || (signed[0]?.taskId ? String(signed[0].taskId) : ""))
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "已签学生加载失败")
    }
  }

  useEffect(() => {
    void loadExportOptions()
  }, [])

  useEffect(() => {
    if (preset?.noticeId) setNoticeId(preset.noticeId)
    if (preset?.classroomId) setClassroomId(preset.classroomId)
  }, [preset?.noticeId, preset?.classroomId])

  useEffect(() => {
    setStudentTaskId("")
    void loadSignedStudents(noticeId, classroomId)
  }, [noticeId, classroomId])

  async function createTask(type: AdminExportTaskType) {
    if (!noticeId || !classroomId) {
      setMessage("请先选择通知和班级。")
      return
    }
    if (type === "student_pdf" && !studentTaskId) {
      setMessage("请先选择已签学生。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/export/tasks`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          type,
          noticeId: Number(noticeId),
          classroomId: Number(classroomId),
          taskId: type === "student_pdf" ? Number(studentTaskId) : undefined,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { taskId: string; status: AdminExportTaskRow["status"]; filePath?: string | null }
      setTasks((current) => [
        {
          id: data.taskId,
          type,
          status: data.status,
          filePath: data.filePath,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, 8))
      setMessage(`${exportTypeLabel(type)}导出任务已创建。`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出任务创建失败")
    } finally {
      setLoading(false)
    }
  }

  async function refreshTask(taskId: string) {
    const response = await fetch(`${API_BASE}/api/export/tasks/${taskId}`, {
      headers: getAdminAuthHeaders(),
    })
    if (!response.ok) throw new Error(await readApiError(response))
    const row = (await response.json()) as {
      id: string
      type: AdminExportTaskType
      status: AdminExportTaskRow["status"]
      file_path?: string | null
      created_at?: string
    }
    const next = { id: row.id, type: row.type, status: row.status, filePath: row.file_path, createdAt: row.created_at }
    setTasks((current) => current.map((item) => (item.id === next.id ? next : item)))
    return next
  }

  async function downloadTask(task: AdminExportTaskRow) {
    setLoading(true)
    try {
      const latest = task.status === "SUCCEEDED" ? task : await refreshTask(task.id)
      if (latest.status !== "SUCCEEDED") {
        setMessage("任务尚未成功，暂不能下载。")
        return
      }
      const response = await fetch(`${API_BASE}/api/export/tasks/${latest.id}/download`, {
        headers: getAdminAuthHeaders(),
        cache: "no-store",
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const blob = await response.blob()
      const fallbackExt = latest.type === "excel" ? "xls" : latest.type === "student_pdf" ? "pdf" : "zip"
      const fileName = response.headers.get("x-export-filename") || `${latest.id}.${fallbackExt}`
      downloadBlob(blob, fileName)
      setMessage("文件已下载。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "导出文件下载失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="选择导出内容" description="选择通知、班级和学生后生成文件">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="通知" required>
            <select className={inputClass} value={noticeId} onChange={(event) => setNoticeId(event.target.value)}>
              {notices.map((notice) => (
                <option key={notice.id} value={notice.numericId}>{notice.title}</option>
              ))}
            </select>
          </Field>
          <Field label="班级" required>
            <select className={inputClass} value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="已签学生">
            <select className={inputClass} value={studentTaskId} onChange={(event) => setStudentTaskId(event.target.value)}>
              {progressItems.length ? (
                progressItems.map((item) => (
                  <option key={item.taskId || item.studentId} value={item.taskId || ""}>
                    {item.studentNo} · {item.studentName}
                  </option>
                ))
              ) : (
                <option value="">暂无可导出 PDF 的已签学生</option>
              )}
            </select>
          </Field>
        </div>
        <p className="mt-3 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">{message}</p>
      </Panel>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ExportCard
          icon={FileSpreadsheet}
          title="Excel 明细"
          desc="导出全校或指定班级的签收明细表"
          disabled={loading || !noticeId || !classroomId}
          onCreate={() => void createTask("excel")}
        />
        <ExportCard
          icon={FileText}
          title="单份 PDF"
          desc="按学生生成带签名的签收证据 PDF"
          disabled={loading || !studentTaskId}
          onCreate={() => void createTask("student_pdf")}
        />
        <ExportCard
          icon={FileArchive}
          title="班级 PDF zip"
          desc="按班级批量打包所有学生 PDF"
          disabled={loading || !noticeId || !classroomId}
          onCreate={() => void createTask("class_zip")}
        />
      </div>

      <Panel
        title="导出任务"
        description="文件生成完成后可下载"
        actions={
          <Button variant="outline" size="sm" disabled={loading || !tasks.length} onClick={() => void Promise.all(tasks.map((task) => refreshTask(task.id))).catch((err) => setMessage(err instanceof Error ? err.message : "刷新失败"))}>
            <RotateCw className="size-3.5" />
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>类型</Th>
                <Th>范围</Th>
                <Th>状态</Th>
                <Th>创建时间</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {tasks.length ? (
                tasks.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <Td className="font-medium text-foreground">{exportTypeLabel(t.type)}</Td>
                    <Td className="font-mono text-xs text-muted-foreground">{t.id}</Td>
                    <Td>
                      <Badge tone={t.status === "SUCCEEDED" ? "success" : t.status === "FAILED" ? "stamp" : "info"}>
                        {t.status}
                      </Badge>
                    </Td>
                    <Td className="text-muted-foreground tabular-nums">{t.createdAt ? formatDateTime(t.createdAt) : "—"}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="xs" disabled={loading} onClick={() => void refreshTask(t.id).catch((err) => setMessage(err instanceof Error ? err.message : "刷新失败"))}>
                        <RotateCw className="size-3" />
                        刷新
                      </Button>
                      <Button variant="ghost" size="xs" disabled={loading || t.status !== "SUCCEEDED"} onClick={() => void downloadTask(t)}>
                        <Download className="size-3" />
                        下载
                      </Button>
                      {t.status === "FAILED" && (
                        <Button variant="ghost" size="xs" disabled={loading} onClick={() => void createTask(t.type)}>
                          <RotateCw className="size-3" />
                          重试
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                    暂无导出任务
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function ExportCard({
  icon: Icon,
  title,
  desc,
  disabled,
  onCreate,
}: {
  icon: typeof FileText
  title: string
  desc: string
  disabled?: boolean
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
        <Button variant="outline" size="xs" className="mt-2" disabled={disabled} onClick={onCreate}>
          发起导出
        </Button>
      </div>
    </div>
  )
}

function AuditSection() {
  const typeUi: Record<AuditLog["type"], { tone: "info" | "success" | "stamp" | "muted"; label: string }> = {
    publish: { tone: "success", label: "发布" },
    export: { tone: "info", label: "导出" },
    abnormal: { tone: "stamp", label: "异常" },
    login: { tone: "muted", label: "登录" },
    other: { tone: "muted", label: "操作" },
  }
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [message, setMessage] = useState("正在加载审计日志。")

  function auditType(action: string): AuditLog["type"] {
    if (action.includes("export")) return "export"
    if (action.includes("anomaly") || action.includes("exception")) return "abnormal"
    if (action.includes("login")) return "login"
    if (action.includes("notice") || action.includes("publish")) return "publish"
    return "other"
  }

  useEffect(() => {
    async function loadAuditLogs() {
      try {
        const response = await fetch(`${API_BASE}/api/school-admin/audit-logs`, {
          headers: getAdminAuthHeaders(),
        })
        if (!response.ok) throw new Error(await readApiError(response))
        const data = (await response.json()) as {
          logs: Array<{ id: number; time: string; actor: string; action: string; target: string; detail: string }>
        }
        const nextLogs = (data.logs || []).map((item) => ({
          id: String(item.id),
          time: formatDateTime(item.time),
          actor: item.actor || "系统",
          action: item.action,
          detail: [item.action, item.target, item.detail].filter(Boolean).join(" · "),
          type: auditType(item.action),
        }))
        setLogs(nextLogs.length ? nextLogs : [])
        setMessage(nextLogs.length ? "审计日志已更新。" : "暂无审计日志。")
      } catch (err) {
        setLogs([])
        setMessage(err instanceof Error ? `审计日志读取失败：${err.message}` : "暂时无法读取后端日志。")
      }
    }
    void loadAuditLogs()
  }, [])

  return (
    <Panel
      title="审计日志"
      description="记录发布、导出、异常处理与登录行为，方便事后核对"
      actions={<Button variant="outline" size="sm" disabled title="日志导出功能后置">导出日志</Button>}
      bodyClassName="p-0"
    >
      <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">{message}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <Th>时间</Th>
              <Th>操作人</Th>
              <Th>类型</Th>
              <Th>内容</Th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <Td className="text-muted-foreground tabular-nums">{l.time}</Td>
                <Td className="text-foreground">{l.actor}</Td>
                <Td>
                  <Badge tone={typeUi[l.type].tone}>{typeUi[l.type].label}</Badge>
                </Td>
                <Td className="text-muted-foreground">{l.detail}</Td>
              </tr>
            ))}
            {!logs.length ? (
              <tr>
                <Td colSpan={4} className="py-8 text-center text-muted-foreground">
                  暂无审计日志
                </Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function SettingsSection({ onSchoolNameChange }: { onSchoolNameChange: (name: string) => void }) {
  const roleUi: Record<string, { tone: "primary" | "muted"; label: string }> = {
    school_admin: { tone: "primary", label: "学校管理员" },
    teacher: { tone: "muted", label: "班主任" },
    homeroom: { tone: "muted", label: "班主任" },
  }
  const acctStatusUi: Record<
    TeacherAccountStatus,
    { tone: "success" | "muted" | "warning"; label: string }
  > = {
    active: { tone: "success", label: "已启用" },
    disabled: { tone: "muted", label: "已停用" },
    invited: { tone: "warning", label: "待激活" },
  }
  const [settings, setSettings] = useState<AdminSchoolSettings | null>(null)
  const [schoolName, setSchoolName] = useState(PLACEHOLDER_TEXT)
  const [schoolTerm, setSchoolTerm] = useState(PLACEHOLDER_TEXT)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("正在加载学校信息。")
  const [error, setError] = useState("")
  const [gradeOpen, setGradeOpen] = useState(false)
  const [classOpen, setClassOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [resetPasswordTarget, setResetPasswordTarget] = useState<{ id: number; name: string; username: string; invited: boolean } | null>(null)
  const [deleteGradeTarget, setDeleteGradeTarget] = useState<{ id: number; name: string; classCount: number } | null>(null)
  const [editingGrade, setEditingGrade] = useState<{ id: number; name: string; entryYear: string } | null>(null)
  const [classInitialGrade, setClassInitialGrade] = useState("")

  async function loadSettings() {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/settings`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as AdminSchoolSettings
      const nextSchoolName = data.school?.name || PLACEHOLDER_TEXT
      const nextSchoolTerm = data.school?.termName || PLACEHOLDER_TEXT
      setSettings(data)
      setSchoolName(nextSchoolName)
      setSchoolTerm(nextSchoolTerm)
      onSchoolNameChange(nextSchoolName)
      setMessage("学校信息已更新。")
    } catch (err) {
      setSettings(null)
      setSchoolName(PLACEHOLDER_TEXT)
      setSchoolTerm(PLACEHOLDER_TEXT)
      setError(err instanceof Error ? err.message : "学校设置加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  async function saveSchoolProfile() {
    if (!schoolName.trim()) {
      setError("学校名称不能为空。")
      return
    }
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/school`, {
        method: "PATCH",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ schoolName: schoolName.trim() }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage("学校名称已保存。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "学校名称保存失败")
    } finally {
      setLoading(false)
    }
  }

  async function createGrade(input: CreateGradeInput) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/grades`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      const classCount = input.initialClassCount || 0
      setMessage(classCount ? `年级已创建：${input.name}，同步创建 ${classCount} 个班级。` : `年级已创建：${input.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "年级创建失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function updateGrade(input: { id: number; name: string; entryYear: string }) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/grades/${input.id}`, {
        method: "PATCH",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: input.name, entryYear: input.entryYear }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage(`年级已保存：${input.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "年级保存失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function deleteGrade(input: { id: number; name: string }) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/grades/${input.id}`, {
        method: "DELETE",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ confirm: true }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage(`年级已删除：${input.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "年级删除失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function createClass(input: CreateClassInput) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/classes`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage(`班级已创建：${input.grade}${input.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "班级创建失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function updateClass(input: UpdateClassInput) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/classes/${input.id}`, {
        method: "PATCH",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ grade: input.grade, name: input.name, capacity: input.capacity }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage(`班级已保存：${input.grade}${input.name}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "班级保存失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function createAccount(input: { username: string; name: string; role: "school_admin" | "teacher"; classroomId: number | null }) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/users`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as AdminUserRow & { initialPassword: string }
      await loadSettings()
      setMessage(`账号已创建：${data.username}，初始密码 ${data.initialPassword}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "账号创建失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword(userId: number, newPassword?: string) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(newPassword ? { newPassword } : {}),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as { username: string; initialPassword: string }
      await loadSettings()
      setMessage(`已重置 ${data.username} 的密码：${data.initialPassword}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "密码重置失败")
      throw err
    } finally {
      setLoading(false)
    }
  }

  async function toggleUserStatus(userId: number, enabled: boolean) {
    setLoading(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/users/${userId}/status`, {
        method: "PATCH",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      await loadSettings()
      setMessage(enabled ? "账号已启用。" : "账号已停用。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "账号状态更新失败")
    } finally {
      setLoading(false)
    }
  }

  async function handleImportCompleted(kind: SchoolImportKind, result: SchoolImportCommitResult) {
    await loadSettings()
    const label: Record<SchoolImportKind, string> = {
      grades: "年级",
      classes: "班级",
      accounts: "教师账号",
    }
    const summary = result.preview.result
    const accountPasswords = result.createdAccounts?.length
      ? ` 新账号初始密码：${result.createdAccounts.map((item) => `${item.username} / ${item.initialPassword}`).join("；")}`
      : ""
    setMessage(`${label[kind]}导入完成：新增 ${summary.add} 条，更新 ${summary.update} 条，跳过 ${summary.skip} 条。${accountPasswords}`)
  }

  const classNameById = new Map((settings?.classes || []).map((item) => [item.id, `${item.grade}${item.name}`]))
  const gradeRows: GradeDisplayRow[] = settings
    ? Array.from(new Set([...(settings.grades || []).map((item) => item.name), ...settings.classes.map((item) => item.grade)])).map((grade) => {
        const source = settings.grades?.find((item) => item.name === grade)
        const classesInGrade = settings.classes.filter((item) => item.grade === grade)
        return {
          id: String(source?.id || grade),
          numericId: source?.id || null,
          grade,
          entryYear: source?.entryYear || "",
          classCount: classesInGrade.length,
          studentCount: classesInGrade.reduce((sum, item) => sum + (item.capacity || 0), 0),
          classes: classesInGrade.map((item) => item.name),
        }
      })
    : []
  const accountRows: Array<{
    id: string
    numericId: number | null
    name: string
    account: string
    role: string
    scope: string
    phone: string
    status: TeacherAccountStatus
    lastLogin: string
    enabled: boolean
  }> = settings
    ? settings.users.map((user) => ({
        id: String(user.id),
        numericId: user.id,
        name: user.name,
        account: user.username,
        role: user.role,
        scope: user.role === "school_admin" ? "全校" : classNameById.get(user.classroomId || 0) || "未分配",
        phone: "—",
        status: user.enabled ? "active" : "disabled",
        lastLogin: "—",
        enabled: user.enabled,
      }))
    : []
  const totalClasses = gradeRows.reduce((s, g) => s + g.classCount, 0)
  const classOptions = settings
    ? settings.classes.map((item) => ({ id: item.id, label: `${item.grade}${item.name}` }))
    : []
  const editingGradeClasses = editingGrade
    ? (settings?.classes || []).filter((item) => item.grade === editingGrade.name)
    : []

  return (
    <div className="space-y-4">
      <AddGradeModal
        open={gradeOpen}
        loading={loading}
        editingGrade={editingGrade}
        classes={editingGradeClasses}
        gradeRows={gradeRows}
        onCreate={createGrade}
        onUpdate={updateGrade}
        onCreateClass={createClass}
        onUpdateClass={updateClass}
        onImported={(result) => handleImportCompleted("grades", result)}
        onClose={() => {
          setGradeOpen(false)
          setEditingGrade(null)
        }}
      />
      <AddClassModal
        open={classOpen}
        gradeRows={gradeRows}
        initialGrade={classInitialGrade}
        loading={loading}
        onCreate={createClass}
        onImported={(result) => handleImportCompleted("classes", result)}
        onClose={() => {
          setClassOpen(false)
          setClassInitialGrade("")
        }}
      />
      <AddAccountModal
        open={accountOpen}
        classOptions={classOptions}
        loading={loading}
        onCreate={createAccount}
        onImported={(result) => handleImportCompleted("accounts", result)}
        onClose={() => setAccountOpen(false)}
      />
      <ResetPasswordModal
        target={resetPasswordTarget}
        loading={loading}
        onReset={resetPassword}
        onClose={() => setResetPasswordTarget(null)}
      />
      <DeleteGradeModal
        target={deleteGradeTarget}
        loading={loading}
        onDelete={deleteGrade}
        onClose={() => setDeleteGradeTarget(null)}
      />

      <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
        {loading ? "正在更新数据。" : error || message}
      </div>

      {/* 1. 学校基本信息 */}
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Building2 className="size-4 text-primary" />
            学校基本信息
          </span>
        }
        description="学校名称会显示在通知和家长签收页面中"
        actions={<Button size="sm" disabled={loading} onClick={saveSchoolProfile}>保存修改</Button>}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="学校名称" required>
            <input className={inputClass} value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
          </Field>
          <Field label="当前学期" required>
            <input className={inputClass} value={schoolTerm} disabled />
          </Field>
        </div>
      </Panel>

      {/* 2. 组织架构（年级/班级） */}
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Network className="size-4 text-primary" />
            年级和班级
          </span>
        }
        description={`已建 ${gradeRows.length} 个年级、${totalClasses} 个班级`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingGrade(null)
                setGradeOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              新增年级
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setClassInitialGrade("")
                setClassOpen(true)
              }}
            >
              <Plus className="size-3.5" />
              新增班级
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>年级</Th>
                <Th className="text-right">班级数</Th>
                <Th className="text-right">预计人数</Th>
                <Th>班级列表</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {gradeRows.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="font-medium text-foreground">{g.grade}</Td>
                  <Td className="text-right tabular-nums">{g.classCount}</Td>
                  <Td className="text-right tabular-nums text-muted-foreground">{g.studentCount}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {g.classes.map((c) => (
                        <Badge key={c} tone="muted">{c}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!g.numericId}
                      onClick={() => {
                        if (!g.numericId) return
                        setEditingGrade({ id: g.numericId, name: g.grade, entryYear: g.entryYear })
                        setGradeOpen(true)
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setClassInitialGrade(g.grade)
                        setClassOpen(true)
                      }}
                    >
                      添加班级
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!g.numericId || loading}
                      onClick={() => {
                        if (!g.numericId) return
                        setDeleteGradeTarget({ id: g.numericId, name: g.grade, classCount: g.classCount })
                      }}
                    >
                      <Trash2 className="size-3" />
                      删除
                    </Button>
                  </Td>
                </tr>
              ))}
              {!gradeRows.length ? (
                <tr>
                  <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                    暂无年级。请先新增年级，再新增班级。
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 3. 教师账号管理 */}
      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <UserPlus className="size-4 text-primary" />
            教师账号管理
          </span>
        }
        description="创建教师账号、分配负责班级、停用账号或重置密码"
        actions={
          <Button size="sm" onClick={() => setAccountOpen(true)}>
            <UserPlus className="size-3.5" />
            新增账号
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>姓名</Th>
                <Th>登录账号</Th>
                <Th>角色</Th>
                <Th>负责范围</Th>
                <Th>手机号</Th>
                <Th>状态</Th>
                <Th>最近登录</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="font-medium text-foreground">{u.name}</Td>
                  <Td className="font-mono text-xs text-muted-foreground">{u.account}</Td>
                  <Td>
                    <Badge tone={roleUi[u.role].tone}>
                      {u.role === "school_admin" ? (
                        <ShieldCheck className="size-3" />
                      ) : null}
                      {roleUi[u.role].label}
                    </Badge>
                  </Td>
                  <Td className="text-muted-foreground">{u.scope}</Td>
                  <Td className="tabular-nums text-muted-foreground">{u.phone}</Td>
                  <Td>
                    <Badge tone={acctStatusUi[u.status].tone}>
                      {acctStatusUi[u.status].label}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums text-muted-foreground">{u.lastLogin}</Td>
                  <Td className="text-right">
                    {u.status === "invited" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={!u.numericId || loading}
                        onClick={() => u.numericId && setResetPasswordTarget({ id: u.numericId, name: u.name, username: u.account, invited: true })}
                      >
                        <Send className="size-3" />
                        重发邀请
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={!u.numericId || loading}
                        onClick={() => u.numericId && setResetPasswordTarget({ id: u.numericId, name: u.name, username: u.account, invited: false })}
                      >
                        <KeyRound className="size-3" />
                        重置密码
                      </Button>
                    )}
                    <Button variant="ghost" size="xs" disabled={!u.numericId || loading} onClick={() => u.numericId && void toggleUserStatus(u.numericId, !u.enabled)}>
                      <Ban className="size-3" />
                      {u.status === "disabled" ? "启用" : "停用"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function ResetPasswordModal({
  target,
  loading,
  onReset,
  onClose,
}: {
  target: { id: number; name: string; username: string; invited: boolean } | null
  loading: boolean
  onReset: (userId: number, newPassword?: string) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<"random" | "custom">("random")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!target) return
    setMode("random")
    setPassword("")
    setError("")
  }, [target])

  function submit() {
    if (!target) return
    const nextPassword = password.trim()
    if (mode === "custom" && nextPassword.length < 8) {
      setError("自定义密码至少 8 位。")
      return
    }
    setError("")
    void onReset(target.id, mode === "custom" ? nextPassword : undefined)
      .then(onClose)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "密码重置失败")
      })
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={<span className="flex items-center gap-1.5"><KeyRound className="size-4 text-primary" />{target?.invited ? "重发邀请" : "重置密码"}</span>}
      description={target ? `${target.name} / ${target.username}` : ""}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={loading} onClick={submit}>
            {target?.invited ? "确认重发" : "确认重置"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => {
              setMode("random")
              setError("")
            }}
            className={
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium " +
              (mode === "random" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
            }
          >
            随机生成
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium " +
              (mode === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
            }
          >
            自定义密码
          </button>
        </div>
        {mode === "custom" ? (
          <Field label="新密码" required hint="8 到 128 位，保存后只在顶部提示中展示一次">
            <input
              className={inputClass}
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入新密码"
            />
          </Field>
        ) : (
          <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
            系统将生成一个新密码，保存后只展示一次。
          </div>
        )}
        {error ? (
          <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">{error}</div>
        ) : null}
      </div>
    </Modal>
  )
}

function DeleteGradeModal({
  target,
  loading,
  onDelete,
  onClose,
}: {
  target: { id: number; name: string; classCount: number } | null
  loading: boolean
  onDelete: (input: { id: number; name: string }) => Promise<void>
  onClose: () => void
}) {
  const [error, setError] = useState("")

  useEffect(() => {
    if (!target) return
    setError("")
  }, [target])

  function submit() {
    if (!target) return
    setError("")
    void onDelete({ id: target.id, name: target.name })
      .then(onClose)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "年级删除失败")
      })
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={<span className="flex items-center gap-1.5"><Trash2 className="size-4 text-stamp" />删除年级</span>}
      description={target ? target.name : ""}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button variant="destructive" size="sm" disabled={loading} onClick={submit}>
            确认删除
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">
          {target?.classCount
            ? `将删除该年级及其下 ${target.classCount} 个班级，相关学生、签收任务、链接、异常记录和导出任务会一并清理。`
            : "将删除该空年级。"}
        </div>
        <p className="text-sm text-muted-foreground">删除后不可在页面中恢复，请确认该年级不再使用。</p>
        {error ? (
          <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">{error}</div>
        ) : null}
      </div>
    </Modal>
  )
}

function ModalTabs({
  mode,
  setMode,
  manualLabel,
  importLabel,
}: {
  mode: "manual" | "import"
  setMode: (m: "manual" | "import") => void
  manualLabel: string
  importLabel: string
}) {
  return (
    <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
      <button
        onClick={() => setMode("manual")}
        className={
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium " +
          (mode === "manual" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
        }
      >
        <Plus className="size-3.5" />
        {manualLabel}
      </button>
      <button
        onClick={() => setMode("import")}
        className={
          "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm font-medium " +
          (mode === "import" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")
        }
      >
        <Upload className="size-3.5" />
        {importLabel}
      </button>
    </div>
  )
}

function ImportDropzone({
  hint,
  templateCols,
  template,
  kind,
  disabled,
  onImported,
}: {
  hint: string
  templateCols: string
  template: CsvTemplate
  kind: SchoolImportKind
  disabled?: boolean
  onImported: (result: SchoolImportCommitResult) => Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<SchoolImportPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("请先选择文件进行预检。")
  const [error, setError] = useState("")

  async function previewFile(file: File) {
    setLoading(true)
    setError("")
    setMessage("正在预检文件。")
    setSelectedFile(file)
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/import/${kind}/file-preview?fileName=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: getAdminAuthHeaders({
          "Content-Type": file.type || "application/octet-stream",
        }),
        body: await file.arrayBuffer(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as SchoolImportPreview
      setPreview(data)
      setMessage(data.canSubmit ? "预检通过，可以确认导入。" : "预检未通过，请处理后重新上传。")
    } catch (err) {
      setPreview(null)
      setError(err instanceof Error ? err.message : "文件预检失败")
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function commitImport() {
    if (!preview?.canSubmit) return
    setLoading(true)
    setError("")
    setMessage("正在导入。")
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/import/${kind}/commit`, {
        method: "POST",
        headers: getAdminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          rows: preview.rows,
          source: preview.source || { sourceType: "FILE", fileName: selectedFile?.name || "" },
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as SchoolImportCommitResult
      setMessage("导入完成。")
      await onImported(data)
      setPreview(null)
      setSelectedFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认导入失败")
    } finally {
      setLoading(false)
    }
  }

  const busy = disabled || loading
  const actionLabel: Record<SchoolImportPreviewRow["action"], string> = {
    ADD: "新增",
    UPDATE: "更新",
    SKIP: "跳过",
  }
  const actionTone: Record<SchoolImportPreviewRow["action"], "success" | "info" | "muted"> = {
    ADD: "success",
    UPDATE: "info",
    SKIP: "muted",
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span>模板列：{templateCols}</span>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => downloadCsvTemplate(template)}>
          <Download className="size-3" />
          下载模板
        </Button>
      </div>
      <label
        className={
          "relative flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-muted/30 px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/30 " +
          (busy ? "pointer-events-none opacity-50" : "")
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.txt"
          className="absolute inset-0 cursor-pointer opacity-0"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void previewFile(file)
          }}
        />
        <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-accent text-primary">
          <Upload className="size-5" />
        </div>
        <p className="text-sm font-medium text-foreground">上传 CSV 文件</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        <span className="relative mt-3 inline-flex h-7 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-all">
          选择文件
        </span>
        {selectedFile ? (
          <p className="mt-2 text-xs text-muted-foreground">当前文件：{selectedFile.name}</p>
        ) : null}
      </label>

      <div
        className={
          "rounded-md border px-3 py-2 text-sm " +
          (error ? "border-stamp/20 bg-stamp-soft text-stamp" : "border-info/20 bg-info-soft text-info")
        }
      >
        {error || message}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="新增" value={preview?.result.add ?? "—"} tone="success" />
        <Metric label="更新" value={preview?.result.update ?? "—"} tone="info" />
        <Metric label="跳过" value={preview?.result.skip ?? "—"} tone="muted" />
        <Metric label="错误" value={preview?.errors.length ?? "—"} tone={preview?.errors.length ? "stamp" : "muted"} />
      </div>

      {preview?.errors.length ? (
        <div className="rounded-md border border-stamp/30 bg-stamp-soft px-3 py-2 text-xs text-stamp">
          {preview.errors.map((item, index) => (
            <p key={`${item.reason}-${index}`}>{item.rowNumber ? `第 ${item.rowNumber} 行：` : ""}{item.reason}</p>
          ))}
        </div>
      ) : null}

      {preview?.warnings.length ? (
        <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-[oklch(0.45_0.1_70)]">
          {preview.warnings.map((item, index) => (
            <p key={`${item.reason}-${index}`}>{item.rowNumber ? `第 ${item.rowNumber} 行：` : ""}{item.reason}</p>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <Th>行号</Th>
              <Th>名称</Th>
              <Th>结果</Th>
              <Th>说明</Th>
            </tr>
          </thead>
          <tbody>
            {preview?.rows.length ? (
              preview.rows.map((row, index) => (
                <tr key={`${row.rowNumber || index}-${row.displayName}`} className="border-b border-border last:border-0">
                  <Td className="tabular-nums text-muted-foreground">{row.rowNumber || index + 2}</Td>
                  <Td className="font-medium text-foreground">{row.displayName}</Td>
                  <Td><Badge tone={actionTone[row.action]}>{actionLabel[row.action]}</Badge></Td>
                  <Td className="text-muted-foreground">{row.detail}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={4} className="py-8 text-center text-muted-foreground">暂无预检结果</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setPreview(null)
            setSelectedFile(null)
            setError("")
            setMessage("已清空本次预检。")
          }}
        >
          清空
        </Button>
        <Button size="sm" disabled={busy || !preview?.canSubmit} onClick={() => void commitImport()}>
          确认导入
        </Button>
      </div>
    </div>
  )
}

function AddGradeModal({
  open,
  loading,
  editingGrade,
  classes,
  gradeRows,
  onCreate,
  onUpdate,
  onCreateClass,
  onUpdateClass,
  onImported,
  onClose,
}: {
  open: boolean
  loading: boolean
  editingGrade?: { id: number; name: string; entryYear: string } | null
  classes: AdminClassRow[]
  gradeRows: { id: string; grade: string }[]
  onCreate: (input: CreateGradeInput) => Promise<void>
  onUpdate: (input: { id: number; name: string; entryYear: string }) => Promise<void>
  onCreateClass: (input: CreateClassInput) => Promise<void>
  onUpdateClass: (input: UpdateClassInput) => Promise<void>
  onImported: (result: SchoolImportCommitResult) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [name, setName] = useState("")
  const [entryYear, setEntryYear] = useState("")
  const [initialClassCount, setInitialClassCount] = useState("0")
  const [classCapacity, setClassCapacity] = useState("45")
  const [formError, setFormError] = useState("")
  const isEditing = !!editingGrade

  useEffect(() => {
    if (!open) return
    setMode("manual")
    setName(editingGrade?.name || "")
    setEntryYear(editingGrade?.entryYear || "")
    setInitialClassCount("0")
    setClassCapacity("45")
    setFormError("")
  }, [editingGrade, open])

  function submitManual() {
    const normalizedName = name.trim()
    const count = Number(initialClassCount || 0)
    const capacity = Number(classCapacity || 0)
    if (!normalizedName) {
      setFormError("年级名称不能为空。")
      return
    }
    if (!isEditing && (!Number.isFinite(count) || count < 0 || count > 50)) {
      setFormError("初始班级数请填写 0 到 50。")
      return
    }
    if (!isEditing && (!Number.isFinite(capacity) || capacity < 0)) {
      setFormError("默认预计人数不能小于 0。")
      return
    }
    setFormError("")
    const action = editingGrade
      ? onUpdate({ id: editingGrade.id, name: normalizedName, entryYear: entryYear.trim() })
      : onCreate({
          name: normalizedName,
          entryYear: entryYear.trim(),
          initialClassCount: Math.floor(count),
          classCapacity: Math.floor(capacity),
        })
    void action.then(onClose).catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={isEditing ? "lg" : "md"}
      title={<span className="flex items-center gap-1.5"><GraduationCap className="size-4 text-primary" />{isEditing ? "编辑年级" : "新增年级"}</span>}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{mode === "import" ? "关闭" : "取消"}</Button>
          {mode === "manual" ? (
            <Button size="sm" disabled={loading} onClick={submitManual}>{isEditing ? "保存修改" : "确认新增"}</Button>
          ) : null}
        </>
      }
    >
      {isEditing ? null : <ModalTabs mode={mode} setMode={setMode} manualLabel="手动新增" importLabel="批量导入" />}
      {mode === "manual" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="年级名称" required>
              <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="如：六年级" />
            </Field>
            <Field label="入学年份">
              <input className={inputClass} value={entryYear} onChange={(event) => setEntryYear(event.target.value)} placeholder="如：2020" />
            </Field>
            {!isEditing ? (
              <>
                <Field label="初始班级数" hint="保存年级时自动创建（1）班、（2）班等">
                  <input className={inputClass} type="number" min={0} max={50} value={initialClassCount} onChange={(event) => setInitialClassCount(event.target.value)} />
                </Field>
                <Field label="默认预计人数" hint="用于这些初始班级，可后续单独调整">
                  <input className={inputClass} type="number" min={0} value={classCapacity} onChange={(event) => setClassCapacity(event.target.value)} />
                </Field>
              </>
            ) : null}
          </div>
          {formError ? (
            <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">{formError}</div>
          ) : null}
          {isEditing && editingGrade ? (
            <GradeClassEditor
              gradeName={editingGrade.name}
              classes={classes}
              gradeRows={gradeRows}
              loading={loading}
              onCreateClass={onCreateClass}
              onUpdateClass={onUpdateClass}
            />
          ) : null}
        </div>
      ) : (
        <ImportDropzone
          hint="一次性导入多个年级，支持 .csv"
          templateCols="年级名称、入学年份"
          kind="grades"
          disabled={loading}
          onImported={onImported}
          template={{
            fileName: "年级导入模板.csv",
            columns: ["年级名称", "入学年份"],
          }}
        />
      )}
    </Modal>
  )
}

function GradeClassEditor({
  gradeName,
  classes,
  gradeRows,
  loading,
  onCreateClass,
  onUpdateClass,
}: {
  gradeName: string
  classes: AdminClassRow[]
  gradeRows: { id: string; grade: string }[]
  loading: boolean
  onCreateClass: (input: CreateClassInput) => Promise<void>
  onUpdateClass: (input: UpdateClassInput) => Promise<void>
}) {
  const [drafts, setDrafts] = useState<Record<number, { grade: string; name: string; capacity: string }>>({})
  const [newClassName, setNewClassName] = useState("")
  const [newCapacity, setNewCapacity] = useState("45")
  const [error, setError] = useState("")

  useEffect(() => {
    const next: Record<number, { grade: string; name: string; capacity: string }> = {}
    classes.forEach((item) => {
      next[item.id] = { grade: item.grade, name: item.name, capacity: String(item.capacity || 0) }
    })
    setDrafts(next)
    setNewClassName("")
    setNewCapacity("45")
    setError("")
  }, [classes, gradeName])

  function parseCapacity(value: string) {
    const capacity = Number(value || 0)
    return Number.isFinite(capacity) && capacity >= 0 ? Math.floor(capacity) : null
  }

  function saveClass(row: AdminClassRow) {
    const draft = drafts[row.id] || { grade: row.grade, name: row.name, capacity: String(row.capacity || 0) }
    const nextGrade = draft.grade.trim()
    const nextName = draft.name.trim()
    const capacity = parseCapacity(draft.capacity)
    if (!nextGrade) {
      setError("所属年级不能为空。")
      return
    }
    if (!nextName) {
      setError("班级名称不能为空。")
      return
    }
    if (capacity === null) {
      setError("预计人数不能小于 0。")
      return
    }
    setError("")
    void onUpdateClass({ id: row.id, grade: nextGrade, name: nextName, capacity }).catch(() => {})
  }

  function addClass() {
    const nextName = newClassName.trim()
    const capacity = parseCapacity(newCapacity)
    if (!nextName) {
      setError("请填写要新增的班级名称。")
      return
    }
    if (capacity === null) {
      setError("预计人数不能小于 0。")
      return
    }
    setError("")
    void onCreateClass({ grade: gradeName, name: nextName, capacity })
      .then(() => {
        setNewClassName("")
        setNewCapacity("45")
      })
      .catch(() => {})
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-3 py-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">班级调整</p>
          <p className="mt-0.5 text-xs text-muted-foreground">修改班级名称或预计人数后，点击对应行保存。</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(8rem,1fr)_7rem_auto]">
          <input
            className={inputClass}
            value={newClassName}
            onChange={(event) => setNewClassName(event.target.value)}
            placeholder="如：（3）班"
            aria-label="新增班级名称"
          />
          <input
            className={inputClass}
            type="number"
            min={0}
            value={newCapacity}
            onChange={(event) => setNewCapacity(event.target.value)}
            placeholder="预计人数"
            aria-label="新增班级预计人数"
          />
          <Button size="sm" disabled={loading} onClick={addClass}>
            <Plus className="size-3.5" />
            新增班级
          </Button>
        </div>
      </div>
      {error ? (
        <div className="border-b border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">{error}</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
              <Th>所属年级</Th>
              <Th>班级名称</Th>
              <Th className="text-right">预计人数</Th>
              <Th>班主任</Th>
              <Th className="text-right">操作</Th>
            </tr>
          </thead>
          <tbody>
            {classes.length ? (
              classes.map((row) => {
                const draft = drafts[row.id] || { grade: row.grade, name: row.name, capacity: String(row.capacity || 0) }
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <Td>
                      <select
                        className={`${inputClass} min-w-32`}
                        value={draft.grade}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, grade: event.target.value } }))}
                        aria-label={`${row.name}所属年级`}
                      >
                        {gradeRows.map((grade) => (
                          <option key={grade.id} value={grade.grade}>{grade.grade}</option>
                        ))}
                      </select>
                    </Td>
                    <Td>
                      <input
                        className={`${inputClass} min-w-32`}
                        value={draft.name}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, name: event.target.value } }))}
                        aria-label={`${row.name}名称`}
                      />
                    </Td>
                    <Td className="text-right">
                      <input
                        className={`${inputClass} min-w-24 text-right tabular-nums`}
                        type="number"
                        min={0}
                        value={draft.capacity}
                        onChange={(event) => setDrafts((current) => ({ ...current, [row.id]: { ...draft, capacity: event.target.value } }))}
                        aria-label={`${row.name}预计人数`}
                      />
                    </Td>
                    <Td className="text-muted-foreground">{row.teacher?.name || "未分配"}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="xs" disabled={loading} onClick={() => saveClass(row)}>
                        保存班级
                      </Button>
                    </Td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <Td colSpan={5} className="py-6 text-center text-muted-foreground">
                  这个年级还没有班级，可以在上方直接新增。
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AddClassModal({
  open,
  gradeRows,
  initialGrade,
  loading,
  onCreate,
  onImported,
  onClose,
}: {
  open: boolean
  gradeRows: { id: string; grade: string }[]
  initialGrade?: string
  loading: boolean
  onCreate: (input: CreateClassInput) => Promise<void>
  onImported: (result: SchoolImportCommitResult) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [grade, setGrade] = useState("")
  const [className, setClassName] = useState("")
  const [capacity, setCapacity] = useState("45")
  const [formError, setFormError] = useState("")

  useEffect(() => {
    if (!open) return
    setMode("manual")
    setGrade(initialGrade || "")
    setClassName("")
    setCapacity("45")
    setFormError("")
  }, [initialGrade, open])

  function submitManual() {
    const nextGrade = grade.trim()
    const nextName = className.trim()
    const nextCapacity = Number(capacity || 0)
    if (!nextGrade) {
      setFormError("请先选择所属年级。")
      return
    }
    if (!nextName) {
      setFormError("班级名称不能为空。")
      return
    }
    if (!Number.isFinite(nextCapacity) || nextCapacity < 0) {
      setFormError("预计人数不能小于 0。")
      return
    }
    setFormError("")
    void onCreate({ grade: nextGrade, name: nextName, capacity: Math.floor(nextCapacity) }).then(onClose).catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-1.5"><Users2 className="size-4 text-primary" />新增班级</span>}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{mode === "import" ? "关闭" : "取消"}</Button>
          {mode === "manual" ? (
            <Button size="sm" disabled={loading || !gradeRows.length} onClick={submitManual}>确认新增</Button>
          ) : null}
        </>
      }
    >
      <ModalTabs mode={mode} setMode={setMode} manualLabel="手动新增" importLabel="批量导入" />
      {mode === "manual" ? (
        <div className="space-y-4">
          {!gradeRows.length ? (
            <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-[oklch(0.45_0.1_70)]">
              请先新增年级，再为年级添加班级。
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="所属年级" required>
              <select className={inputClass} value={grade} disabled={!gradeRows.length} onChange={(event) => setGrade(event.target.value)}>
                <option value="" disabled>请选择年级</option>
                {gradeRows.map((g) => (
                  <option key={g.id} value={g.grade}>{g.grade}</option>
                ))}
              </select>
            </Field>
            <Field label="班级名称" required>
              <input className={inputClass} value={className} onChange={(event) => setClassName(event.target.value)} placeholder="如：（5）班" />
            </Field>
            <Field label="班主任" hint="可绑定已有教师账号或稍后分配">
              <select className={inputClass} defaultValue="" disabled>
                <option value="">暂不分配</option>
              </select>
            </Field>
            <Field label="预计人数">
              <input className={inputClass} type="number" min={0} value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="如：45" />
            </Field>
          </div>
          {formError ? (
            <div className="rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-sm text-stamp">{formError}</div>
          ) : null}
        </div>
      ) : (
        <ImportDropzone
          hint="一次性导入多个班级并自动归入对应年级，支持 .csv"
          templateCols="年级名称、班级名称、预计人数"
          kind="classes"
          disabled={loading}
          onImported={onImported}
          template={{
            fileName: "班级导入模板.csv",
            columns: ["年级名称", "班级名称", "预计人数"],
          }}
        />
      )}
    </Modal>
  )
}

function AddAccountModal({
  open,
  classOptions,
  loading,
  onCreate,
  onImported,
  onClose,
}: {
  open: boolean
  classOptions: { id: number; label: string }[]
  loading: boolean
  onCreate: (input: { username: string; name: string; role: "school_admin" | "teacher"; classroomId: number | null }) => Promise<void>
  onImported: (result: SchoolImportCommitResult) => Promise<void>
  onClose: () => void
}) {
  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [role, setRole] = useState<"school_admin" | "teacher">("teacher")
  const [classroomId, setClassroomId] = useState("")

  function submitManual() {
    void onCreate({
      username,
      name,
      role,
      classroomId: role === "teacher" ? Number(classroomId || 0) || null : null,
    }).then(onClose).catch(() => {})
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-1.5"><UserPlus className="size-4 text-primary" />新增教师账号</span>}
      description="手动新增生成初始密码；批量导入可逐行填写初始密码，由学校通过老师群或指定工作群告知"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{mode === "import" ? "关闭" : "取消"}</Button>
          {mode === "manual" ? (
            <Button size="sm" disabled={loading} onClick={submitManual}>
              <Send className="size-3.5" />
              创建账号
            </Button>
          ) : null}
        </>
      }
    >
      <ModalTabs mode={mode} setMode={setMode} manualLabel="手动新增" importLabel="批量导入" />
      {mode === "manual" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="教师姓名" required>
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="如：王老师" />
          </Field>
          <Field label="登录账号" required hint="用于登录，建议工号或拼音">
            <input className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="如：wang_503" />
          </Field>
          <Field label="手机号" hint="选填，仅作为学校内部联系信息">
            <input className={inputClass} placeholder="如：139 0000 0000" />
          </Field>
          <Field label="角色" required>
            <select className={inputClass} value={role} onChange={(event) => setRole(event.target.value as "school_admin" | "teacher")}>
              <option value="teacher">班主任（仅本班数据）</option>
              <option value="school_admin">学校管理员（全校数据）</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="负责班级" hint="班主任只能查看自己负责的班级">
              <select
                className={inputClass}
                value={classroomId}
                disabled={role === "school_admin"}
                onChange={(event) => setClassroomId(event.target.value)}
              >
                <option value="" disabled>请选择班级</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ) : (
        <ImportDropzone
          hint="一次性创建多个教师账号，初始密码可逐行填写；为空时系统生成，支持 .csv"
          templateCols="姓名、登录账号、手机号、角色、负责班级、初始密码"
          kind="accounts"
          disabled={loading}
          onImported={onImported}
          template={{
            fileName: "教师账号导入模板.csv",
            columns: ["姓名", "登录账号", "手机号", "角色", "负责班级", "初始密码"],
          }}
        />
      )}
    </Modal>
  )
}

function TeachersSection() {
  const [settings, setSettings] = useState<AdminSchoolSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("正在加载组织与教师信息。")

  async function loadOrganization() {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/school-admin/settings`, {
        headers: getAdminAuthHeaders(),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as AdminSchoolSettings
      setSettings(data)
      setMessage("组织与教师信息已更新。")
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "组织与教师信息加载失败")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOrganization()
  }, [])

  const classRows = settings?.classes || []
  const teacherUsers = (settings?.users || []).filter((user) => user.role === "teacher")
  const gradeCount = settings
    ? new Set([...(settings.grades || []).map((item) => item.name), ...classRows.map((item) => item.grade)]).size
    : 0
  const unassignedClasses = classRows.filter((item) => !item.teacher).length
  const classNameById = new Map(classRows.map((item) => [item.id, `${item.grade}${item.name}`]))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="年级" value={gradeCount} tone="muted" />
        <Metric label="班级" value={classRows.length} tone="primary" />
        <Metric label="班主任账号" value={teacherUsers.length} tone="info" />
        <Metric label="待分配班级" value={unassignedClasses} tone={unassignedClasses ? "warning" : "success"} />
      </div>
      <div className="rounded-md border border-info/20 bg-info-soft px-3 py-2 text-sm text-info">
        {loading ? "正在加载组织与教师信息。" : message}
      </div>
      <Panel
        title="班级与班主任"
        description="本校班级和班主任分配情况"
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadOrganization()}>
            <RotateCw className="size-3.5" />
            刷新
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>年级</Th>
                <Th>班级</Th>
                <Th>班主任</Th>
                <Th>负责范围</Th>
                <Th className="text-right">预计人数</Th>
              </tr>
            </thead>
            <tbody>
              {classRows.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="text-muted-foreground">{c.grade}</Td>
                  <Td className="font-medium text-foreground">{c.name}</Td>
                  <Td className="text-foreground">{c.teacher?.name || "未分配"}</Td>
                  <Td>
                    <Badge tone={c.teacher ? "muted" : "warning"}>{c.teacher ? "仅本班" : "待分配"}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">{c.capacity}</Td>
                </tr>
              ))}
              {!classRows.length ? (
                <tr>
                  <Td colSpan={5} className="py-8 text-center text-muted-foreground">
                    暂无班级。请先到学校设置中新建年级和班级。
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="班主任账号"
        description="本校班主任账号和负责班级"
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <Th>姓名</Th>
                <Th>登录账号</Th>
                <Th>负责班级</Th>
                <Th>状态</Th>
              </tr>
            </thead>
            <tbody>
              {teacherUsers.map((user) => (
                <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <Td className="font-medium text-foreground">{user.name}</Td>
                  <Td className="font-mono text-xs text-muted-foreground">{user.username}</Td>
                  <Td className="text-muted-foreground">{classNameById.get(user.classroomId || 0) || "未分配"}</Td>
                  <Td>
                    <Badge tone={user.enabled ? "success" : "muted"}>{user.enabled ? "已启用" : "已停用"}</Badge>
                  </Td>
                </tr>
              ))}
              {!teacherUsers.length ? (
                <tr>
                  <Td colSpan={4} className="py-8 text-center text-muted-foreground">
                    暂无班主任账号。请先到学校设置中新增账号。
                  </Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function RateBar({ value }: { value: number }) {
  const tone =
    value >= 90 ? "bg-success" : value >= 75 ? "bg-primary" : "bg-warning"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={tone + " h-full rounded-full"} style={{ width: value + "%" }} />
      </div>
      <span className="tabular-nums text-xs text-muted-foreground">{value}%</span>
    </div>
  )
}

function Th({
  children,
  className = "",
}: {
  children?: ReactNode
  className?: string
}) {
  return <th className={"px-3 py-2 font-medium " + className}>{children}</th>
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: ReactNode
  className?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan} className={"px-3 py-2.5 " + className}>
      {children}
    </td>
  )
}
