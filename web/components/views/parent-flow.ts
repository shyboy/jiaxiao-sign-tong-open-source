export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8088"

export const PARENT_TOKEN_KEY = "jiaxiaoParentToken"
export const PARENT_BINDING_KEY = "jiaxiaoParentBinding"

export type ParentLinkInfo = {
  purpose: "SIGN" | "BINDING"
  schoolId: number
  schoolName?: string
  classroomId: number
  noticeId: number | null
  className: string
  noticeTitle: string | null
  noticeType?: string | null
  noticeBody?: string | null
  contentSource?: "TEXT" | "PDF" | null
  attachment?: {
    id: number
    fileName: string
    fileSize: number
    mimeType?: string
    sha256?: string
    createdAt?: string
    downloadUrl?: string | null
  } | null
  noticeVersion?: number | string | null
  dueAt: string | null
}

export type ParentBindingInfo = {
  token: string
  bindingId: number
  noticeId: number | null
  classroomId: number
  studentName: string
  studentNo: string
  guardianName: string
  relation: string
  phone?: string
  status: string
}

export type ParentSignStatus = {
  status: "SIGNED" | "SKIPPED" | "UNSIGNED" | "NEED_BIND"
  reason?: string
  recordNo?: string
  signedAt?: string
  taskId?: number
  isOverdue?: boolean
  firstSignOfStudent?: boolean
  signatureData?: string | null
}

export async function readApiError(response: Response) {
  try {
    const body = await response.json()
    return body.message || body.reason || body.code || "请求失败"
  } catch {
    return "请求失败"
  }
}

export function loadParentToken() {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(PARENT_TOKEN_KEY) || ""
}

export function saveParentToken(token: string) {
  if (typeof window === "undefined") return
  if (token) window.localStorage.setItem(PARENT_TOKEN_KEY, token)
}

export function loadParentBinding(token?: string, noticeId?: number | null) {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(PARENT_BINDING_KEY)
  if (!raw) return null
  try {
    const binding = JSON.parse(raw) as ParentBindingInfo
    if (token && binding.token !== token) return null
    if (noticeId !== undefined && binding.noticeId !== noticeId) return null
    return binding
  } catch {
    return null
  }
}

export function saveParentBinding(binding: ParentBindingInfo) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(PARENT_BINDING_KEY, JSON.stringify(binding))
}

export async function fetchParentSignStatus(token: string, binding: ParentBindingInfo) {
  const response = await fetch(`${API_BASE}/api/public/sign-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      studentName: binding.studentName,
      guardianName: binding.guardianName,
      relation: binding.relation,
      bindingId: binding.bindingId,
    }),
  })
  if (!response.ok) throw new Error(await readApiError(response))
  return (await response.json()) as ParentSignStatus
}
