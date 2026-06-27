"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  ShieldCheck,
  Link2Off,
  UserX,
  RotateCcw,
  Loader2,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/views/signature-pad"
import { PARENT_NOTICE } from "@/lib/demo-data"
import {
  API_BASE,
  fetchParentSignStatus,
  loadParentBinding,
  loadParentToken,
  readApiError,
  saveParentToken,
  type ParentBindingInfo,
  type ParentLinkInfo,
} from "@/components/views/parent-flow"

type SignResponse = {
  status: "SIGNED" | "SKIPPED" | "NEED_BIND"
  code?: string
  reason?: string
  recordNo?: string
  taskId?: number
  isOverdue?: boolean
  firstSignOfStudent?: boolean
  signedAt?: string
  signatureData?: string | null
}

export function ParentSignView({
  token,
  link,
  onGoBind,
  onViewEvidence,
}: {
  token?: string
  link?: ParentLinkInfo | null
  onGoBind?: (token: string, link: ParentLinkInfo) => void
  onViewEvidence?: () => void
}) {
  const [currentToken, setCurrentToken] = useState(token || "")
  const [currentLink, setCurrentLink] = useState<ParentLinkInfo | null>(link || null)
  const [binding, setBinding] = useState<ParentBindingInfo | null>(null)
  const [readConfirm, setReadConfirm] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [hasSign, setHasSign] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [receipt, setReceipt] = useState<SignResponse | null>(null)
  const [receiptAt, setReceiptAt] = useState("")
  const [showEvidence, setShowEvidence] = useState(false)
  const [checkingReceipt, setCheckingReceipt] = useState(false)
  const [phoneRequiredMessage, setPhoneRequiredMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const nextToken = token || loadParentToken()
    if (nextToken) {
      setCurrentToken(nextToken)
      saveParentToken(nextToken)
    }
    if (link) setCurrentLink(link)
  }, [token, link])

  useEffect(() => {
    if (!currentToken || currentLink) return
    let ignore = false
    async function loadLink() {
      try {
        const response = await fetch(`${API_BASE}/api/public/link/${encodeURIComponent(currentToken)}`)
        if (!response.ok) return
        const data = (await response.json()) as ParentLinkInfo
        if (!ignore) setCurrentLink(data)
      } catch {
        // 提交时会给出明确错误。
      }
    }
    void loadLink()
    return () => {
      ignore = true
    }
  }, [currentToken, currentLink])

  useEffect(() => {
    setBinding(loadParentBinding(currentToken, currentLink?.noticeId))
  }, [currentToken, currentLink?.noticeId])

  useEffect(() => {
    if (!currentToken || !currentLink || currentLink.purpose !== "SIGN" || !binding || receipt) return
    let ignore = false
    async function loadExistingReceipt() {
      setCheckingReceipt(true)
      try {
        const data = await fetchParentSignStatus(currentToken, binding)
        if (ignore) return
        if (data.status === "NEED_BIND" && (data.reason || "").includes("手机号")) {
          setPhoneRequiredMessage(data.reason || "请先补充家长手机号。")
          return
        }
        if (data.status === "SIGNED" || data.status === "SKIPPED") {
          setPhoneRequiredMessage("")
          setReceiptAt(data.signedAt || new Date().toISOString())
          setSignatureData(data.signatureData || null)
          setShowEvidence(true)
          setReceipt({
            status: data.status === "SKIPPED" ? "SKIPPED" : "SIGNED",
            reason: data.reason,
            recordNo: data.recordNo,
            taskId: data.taskId,
            isOverdue: data.isOverdue,
            firstSignOfStudent: data.firstSignOfStudent,
            signedAt: data.signedAt,
            signatureData: data.signatureData,
          })
        }
      } catch {
        // 保留签收表单，提交时会再次给出明确错误。
      } finally {
        if (!ignore) setCheckingReceipt(false)
      }
    }
    void loadExistingReceipt()
    return () => {
      ignore = true
    }
  }, [currentToken, currentLink, binding, receipt])

  const bodyLines = useMemo(() => {
    const lines = (currentLink?.noticeBody || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length) return lines
    return currentLink?.contentSource === "PDF" ? ["请查看 PDF 附件，确认知悉并完成手写签名签收。"] : PARENT_NOTICE.body
  }, [currentLink?.contentSource, currentLink?.noticeBody])

  const errRead = submitted && !readConfirm
  const errPrivacy = submitted && !privacy
  const errSign = submitted && !hasSign

  async function submit() {
    setSubmitted(true)
    setError("")
    if (!readConfirm || !privacy || !hasSign) return
    if (!currentToken || !currentLink) {
      setError("请先打开有效的签收链接。")
      return
    }
    if (!binding) {
      setError("未找到有效绑定，请先完成家长绑定。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/public/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: currentToken,
          studentName: binding.studentName,
          guardianName: binding.guardianName,
          relation: binding.relation,
          bindingId: binding.bindingId,
          signatureData,
          readAgreed: readConfirm,
          privacyAgreed: privacy,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as SignResponse
      if (data.status === "NEED_BIND") {
        if ((data.reason || "").includes("手机号")) {
          setPhoneRequiredMessage(data.reason || "请先补充家长手机号。")
          return
        }
        setError(data.reason || "未找到有效绑定，请先绑定。")
        return
      }
      setPhoneRequiredMessage("")
      if (data.signatureData) setSignatureData(data.signatureData)
      setReceiptAt(data.signedAt || new Date().toISOString())
      setShowEvidence(data.status === "SKIPPED")
      setReceipt(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交签收失败")
    } finally {
      setLoading(false)
    }
  }

  if (receipt) {
    if (showEvidence) {
      return (
        <SignEvidence
          receipt={receipt}
          link={currentLink}
          binding={binding}
          signatureData={signatureData}
          signedAt={receiptAt}
          onBack={() => setShowEvidence(false)}
          onSwitchGuardian={currentLink ? () => onGoBind?.(currentToken, currentLink) : undefined}
        />
      )
    }
    return (
      <SignReceipt
        receipt={receipt}
        link={currentLink}
        binding={binding}
        signedAt={receiptAt}
        onViewEvidence={onViewEvidence || (() => setShowEvidence(true))}
      />
    )
  }

  if (checkingReceipt && !receipt) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center px-5 py-10 text-center">
        <Loader2 className="size-7 animate-spin text-primary" />
        <h2 className="mt-4 text-base font-semibold text-foreground">正在核对签收记录</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">如果您已签收，将直接打开签收凭证。</p>
      </div>
    )
  }

  if (binding && phoneRequiredMessage && currentLink) {
    return (
      <div className="px-4 py-4">
        <div className="rounded-md border border-warning/30 bg-warning-soft p-3 text-[oklch(0.45_0.1_70)]">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="size-4" />
            需要补充手机号
          </div>
          <p className="mt-1.5 text-xs leading-relaxed">
            {phoneRequiredMessage}手机号仅用于学校必要联系，不做验证码登录。
          </p>
        </div>
        <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
          <IdRow k="学生" v={binding.studentName} />
          <IdRow k="家长" v={`${binding.guardianName}（${binding.relation}）`} />
        </div>
        <Button size="lg" className="mt-4 w-full" onClick={() => onGoBind?.(currentToken, currentLink)}>
          补充手机号后签收
        </Button>
      </div>
    )
  }

  const title = currentLink?.noticeTitle || PARENT_NOTICE.title
  const version = currentLink?.noticeVersion ? `v${currentLink.noticeVersion}` : PARENT_NOTICE.version
  const dueAt = currentLink?.dueAt ? formatDateTime(currentLink.dueAt) : PARENT_NOTICE.deadline
  const isPdfNotice = currentLink?.contentSource === "PDF"
  const attachment = currentLink?.attachment || null
  const attachmentUrl = attachment?.downloadUrl
    ? /^https?:\/\//i.test(attachment.downloadUrl)
      ? attachment.downloadUrl
      : `${API_BASE}${attachment.downloadUrl}`
    : ""

  return (
    <div className="px-4 py-4">
      <div className="rounded-md border border-border bg-card p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileText className="size-3.5 text-primary" />
          {currentLink?.schoolName || PARENT_NOTICE.school} · {currentLink?.className || PARENT_NOTICE.className}
        </div>
        <h2 className="mt-1.5 text-base font-semibold text-foreground">{title}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{version}</span>
          {currentLink?.noticeType && <span>{currentLink.noticeType}</span>}
          <span className="text-stamp">截止 {dueAt}</span>
          {currentLink?.purpose === "SIGN" && (
            <span className="inline-flex items-center gap-1 text-success">
              <Clock className="size-3" />链接有效
            </span>
          )}
        </div>
      </div>

      <details className="mt-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium text-[oklch(0.45_0.1_70)]">
          可能遇到的提示（点击展开）
        </summary>
        <ul className="mt-2 space-y-1.5 text-muted-foreground">
          <li className="flex gap-1.5"><UserX className="mt-0.5 size-3.5 shrink-0 text-info" />未绑定：请先完成家长绑定再签收</li>
          <li className="flex gap-1.5"><Link2Off className="mt-0.5 size-3.5 shrink-0 text-stamp" />链接失效：请向班主任索取最新链接</li>
          <li className="flex gap-1.5"><RotateCcw className="mt-0.5 size-3.5 shrink-0 text-warning" />重复签收：该学生已签收，不重复计数</li>
          <li className="flex gap-1.5"><Clock className="mt-0.5 size-3.5 shrink-0 text-stamp" />逾期补签：超过截止时间，提交将标记为逾期</li>
        </ul>
      </details>

      <div className="mt-3 rounded-md border border-border bg-card p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{isPdfNotice ? "签收说明" : "通知正文"}</p>
        <ol className="space-y-2 text-sm leading-relaxed text-foreground">
          {bodyLines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>

      {isPdfNotice && attachment && (
        <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
          <p className="mb-2 text-xs font-medium text-muted-foreground">PDF 附件</p>
          <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{attachment.fileName}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{formatFileSize(attachment.fileSize)}</div>
            </div>
            {attachmentUrl && (
              <a
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/30 px-2 py-1 text-xs font-medium text-primary"
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">签收身份</p>
        {binding ? (
          <>
            <IdRow k="学生姓名" v={binding.studentName} />
            <IdRow k="监护人" v={binding.guardianName} />
            <IdRow k="与学生关系" v={binding.relation} />
          </>
        ) : (
          <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-[oklch(0.45_0.1_70)]">
            当前浏览器没有该链接的有效绑定记录。
            {currentLink && (
              <Button variant="outline" size="xs" className="mt-2 w-full" onClick={() => onGoBind?.(currentToken, currentLink)}>
                先去绑定
              </Button>
            )}
          </div>
        )}
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" checked={readConfirm} onChange={(e) => setReadConfirm(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span>
          {isPdfNotice ? "我已认真阅读并确认以上通知内容和 PDF 附件。" : "我已认真阅读并确认以上承诺书内容。"}
          {errRead && <span className="ml-1 text-xs text-stamp">请先确认</span>}
        </span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="size-3.5 text-info" />
          我同意签收信息用于学校归档。
          {errPrivacy && <span className="ml-1 text-xs text-stamp">请先同意</span>}
        </span>
      </label>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            手写签名 <span className="text-stamp">*</span>
          </span>
          {errSign && <span className="text-xs text-stamp">请手写签名</span>}
        </div>
        <SignaturePad
          onChange={(hasInk, data) => {
            setHasSign(hasInk)
            setSignatureData(data || null)
          }}
        />
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-stamp/20 bg-stamp-soft px-3 py-2 text-xs text-stamp">
          {error}
        </div>
      )}

      <Button size="lg" className="mt-4 w-full" onClick={submit} disabled={loading || !binding}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        提交签收
      </Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        提交后将生成签收回执与证据记录
      </p>
    </div>
  )
}

function SignReceipt({
  receipt,
  link,
  binding,
  signedAt,
  onViewEvidence,
}: {
  receipt: SignResponse
  link: ParentLinkInfo | null
  binding: ParentBindingInfo | null
  signedAt: string
  onViewEvidence?: () => void
}) {
  const duplicate = receipt.status === "SKIPPED"
  return (
    <div className="flex min-h-[640px] flex-col items-center px-5 py-10 text-center">
      <div className={"mb-4 flex size-16 items-center justify-center rounded-full " + (duplicate ? "bg-warning-soft" : "bg-success-soft")}>
        {duplicate ? <RotateCcw className="size-8 text-warning" /> : <CheckCircle2 className="size-8 text-success" />}
      </div>
      <h2 className="text-lg font-semibold text-foreground">{duplicate ? "重复签收已记录" : "签收已记录"}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {duplicate ? receipt.reason || "本次重复提交已进入异常处理，不重复计数。" : "感谢您的配合，本次签收已成功保存。"}
      </p>

      <div className="mt-5 w-full rounded-md border border-border bg-card p-3 text-left text-sm">
        <IdRow k="通知" v={link?.noticeTitle || PARENT_NOTICE.title} />
        <IdRow k="学生" v={binding ? binding.studentName : "—"} />
        <IdRow k="监护人" v={binding ? `${binding.guardianName}（${binding.relation}）` : "—"} />
        <IdRow k="记录号" v={displayRecordNo(receipt)} mono />
        <IdRow k="提交时间" v={formatDateTime(signedAt)} />
        <div className="flex items-center justify-between py-1.5">
          <span className="text-muted-foreground">是否逾期</span>
          <span className={"inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium " + (receipt.isOverdue ? "border-warning/30 bg-warning-soft text-[oklch(0.45_0.1_70)]" : "border-success/20 bg-success-soft text-success")}>
            <CheckCircle2 className="size-3" />{receipt.isOverdue ? "逾期补签" : "按时签收"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex w-full items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-left text-xs text-info">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>如同一学生有其他监护人需补签，可再次打开链接签收，不会重复计入签收人数。</span>
      </div>

      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onViewEvidence}>
        查看签收凭证
      </Button>
    </div>
  )
}

function SignEvidence({
  receipt,
  link,
  binding,
  signatureData,
  signedAt,
  onBack,
  onSwitchGuardian,
}: {
  receipt: SignResponse
  link: ParentLinkInfo | null
  binding: ParentBindingInfo | null
  signatureData: string | null
  signedAt: string
  onBack: () => void
  onSwitchGuardian?: () => void
}) {
  const isPdfNotice = link?.contentSource === "PDF"
  const attachment = link?.attachment || null
  const duplicate = receipt.status === "SKIPPED"
  const recordNo = displayRecordNo(receipt)
  const statusText = duplicate ? "重复提交已记录" : receipt.isOverdue ? "逾期补签已保存" : "签收已完成"

  return (
    <div className="px-4 py-4">
      <div className="rounded-md border border-success/20 bg-success-soft p-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-success">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-success">签收凭证</p>
            <h2 className="mt-1 text-base font-semibold text-foreground">{duplicate ? "您已提交过本次签收" : "您已完成本次通知签收"}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              请核对下面信息。后续如需确认，可把记录号提供给班主任。
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="text-xs font-medium text-muted-foreground">记录号</p>
        <p className="mt-1 break-all font-mono text-lg font-semibold text-foreground">{recordNo}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(signedAt)} · {statusText}
        </p>
      </div>

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">您签收的通知</p>
        <IdRow k="通知名称" v={link?.noticeTitle || PARENT_NOTICE.title} />
        <IdRow k="学校班级" v={`${link?.schoolName || PARENT_NOTICE.school} · ${link?.className || PARENT_NOTICE.className}`} />
        <IdRow k="截止时间" v={link?.dueAt ? formatDateTime(link.dueAt) : PARENT_NOTICE.deadline} />
        <IdRow k="通知形式" v={isPdfNotice ? "PDF 附件通知" : "文字通知"} />
        {isPdfNotice && attachment && <IdRow k="附件文件" v={attachment.fileName} />}
      </div>

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">签收人</p>
        <IdRow k="学生" v={binding ? binding.studentName : "—"} />
        <IdRow k="家长" v={binding ? `${binding.guardianName}（${binding.relation}）` : "—"} />
        <IdRow k="提交时间" v={formatDateTime(signedAt)} />
        <IdRow k="签收状态" v={statusText} />
      </div>

      <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
        <p className="mb-2 text-xs font-medium text-muted-foreground">手写签名预览</p>
        <div className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
          {signatureData ? (
            <img src={signatureData} alt="家长手写签名" className="max-h-24 max-w-full object-contain" />
          ) : (
            <span className="text-sm text-muted-foreground">签名图片暂时无法显示，请联系班主任核对</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-md border border-info/20 bg-info-soft px-3 py-2 text-xs text-info">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        <span>学校只会将签收记录用于通知确认、统计和必要核对。本页不会展示其他学生或家长信息。</span>
      </div>

      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onBack}>
        返回签收结果
      </Button>
      {onSwitchGuardian && (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={onSwitchGuardian}>
          不是这位家长？重新绑定签收
        </Button>
      )}
    </div>
  )
}

function displayRecordNo(receipt: SignResponse) {
  return receipt.recordNo || "请联系班主任核对"
}

function IdRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="shrink-0 text-muted-foreground">{k}</span>
      <span className={"min-w-0 break-words text-right text-foreground " + (mono ? "font-mono text-xs" : "")}>{v}</span>
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

function formatFileSize(value: number | null | undefined) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
