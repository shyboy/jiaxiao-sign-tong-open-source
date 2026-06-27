"use client"

import { useEffect, useState } from "react"
import {
  School,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, inputClass } from "@/components/views/shared"
import { SignaturePad } from "@/components/views/signature-pad"
import { PARENT_NOTICE } from "@/lib/demo-data"
import {
  API_BASE,
  loadParentToken,
  readApiError,
  saveParentBinding,
  saveParentToken,
  type ParentBindingInfo,
  type ParentLinkInfo,
} from "@/components/views/parent-flow"

type Result = "none" | "success" | "review" | "duplicate"

type BindResponse = {
  status: "VALID" | "PENDING_REVIEW"
  reason: string
  detail?: string
  bindingId: number | null
  bindingAnomalyId?: number
  next?: "SIGN" | "BINDING_DONE"
  noticeId?: number | null
  student?: {
    studentId: number
    studentName: string
    studentNo: string
  }
}

export function ParentBindView({
  token,
  link,
  onGoSign,
}: {
  token?: string
  link?: ParentLinkInfo | null
  onGoSign?: (token: string, link: ParentLinkInfo) => void
}) {
  const [currentToken, setCurrentToken] = useState(token || "")
  const [currentLink, setCurrentLink] = useState<ParentLinkInfo | null>(link || null)
  const [name, setName] = useState("")
  const [parent, setParent] = useState("")
  const [relation, setRelation] = useState("")
  const [phone, setPhone] = useState("")
  const [agree, setAgree] = useState(false)
  const [hasSign, setHasSign] = useState(false)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<Result>("none")
  const [resultMessage, setResultMessage] = useState("")
  const [resultBinding, setResultBinding] = useState<ParentBindingInfo | null>(null)
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

  const errName = submitted && !name.trim()
  const errParent = submitted && !parent.trim()
  const errRelation = submitted && !relation
  const errPhone = submitted && !phone.trim()
  const errSign = submitted && !hasSign
  const errAgree = submitted && !agree

  async function submit() {
    setSubmitted(true)
    setError("")
    if (!name.trim() || !parent.trim() || !relation || !phone.trim() || !hasSign || !agree) return
    if (!currentToken) {
      setError("请先打开班主任转发的签收链接。")
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/public/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: currentToken,
          studentName: name.trim(),
          guardianName: parent.trim(),
          relation,
          phone: phone.trim(),
          signatureData,
          privacyAgreed: agree,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const data = (await response.json()) as BindResponse
      setResultMessage(data.detail || data.reason)
      if (data.status === "VALID" && data.bindingId) {
        const binding = {
          token: currentToken,
          bindingId: data.bindingId,
          noticeId: currentLink?.noticeId ?? data.noticeId ?? null,
          classroomId: currentLink?.classroomId || 0,
          studentName: data.student?.studentName || name.trim(),
          studentNo: data.student?.studentNo || "",
          guardianName: parent.trim(),
          relation,
          phone: phone.trim(),
          status: data.status,
        }
        saveParentBinding(binding)
        setResultBinding(binding)
        setResult("success")
      } else if ((data.reason || "").includes("重复")) {
        setResult("duplicate")
      } else {
        setResult("review")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交绑定失败")
    } finally {
      setLoading(false)
    }
  }

  if (result !== "none") {
    return (
      <BindResult
        result={result}
        message={resultMessage}
        binding={resultBinding}
        className={currentLink?.className || PARENT_NOTICE.className}
        onBack={() => setResult("none")}
        onGoSign={currentLink && resultBinding ? () => onGoSign?.(currentToken, currentLink) : undefined}
      />
    )
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-2 rounded-md border border-border bg-accent px-3 py-2.5">
        <School className="size-4 text-primary" />
        <span className="text-sm font-medium text-accent-foreground">
          {currentLink?.schoolName || PARENT_NOTICE.school} · {currentLink?.className || PARENT_NOTICE.className}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" />
          班级不可修改
        </span>
      </div>

      <h2 className="mb-1 mt-4 text-base font-semibold text-foreground">家长身份绑定</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        绑定后即可接收班级通知并完成签收，无需注册账号。
      </p>

      <div className="space-y-3.5">
        <p className="text-xs font-medium text-muted-foreground">学生信息</p>
        <Field label="学生姓名" required error={errName ? "请填写学生姓名" : undefined}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入学生姓名" className={inputClass} />
        </Field>

        <p className="pt-1 text-xs font-medium text-muted-foreground">监护人信息</p>
        <Field label="家长姓名" required error={errParent ? "请填写家长姓名" : undefined}>
          <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="请输入家长姓名" className={inputClass} />
        </Field>
        <Field label="与学生关系" required error={errRelation ? "请选择关系" : undefined}>
          <select value={relation} onChange={(e) => setRelation(e.target.value)} className={inputClass}>
            <option value="">请选择</option>
            <option>父亲</option>
            <option>母亲</option>
            <option>祖父母</option>
            <option>外祖父母</option>
            <option>其他监护人</option>
          </select>
        </Field>
        <Field label="手机号" required error={errPhone ? "请填写家长手机号" : undefined} hint="仅用于必要联系，不做验证码登录">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="请输入家长手机号" inputMode="tel" className={inputClass} />
        </Field>
      </div>

      <div className="mt-4 rounded-md border border-info/20 bg-info-soft p-3">
        <div className="flex items-center gap-1.5 text-sm font-medium text-info">
          <ShieldCheck className="size-4" />
          隐私告知
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-info/90">
          信息仅用于学校通知签收、签收统计与归档。<br />
          不收集身份证号、人脸、家庭住址与精确定位信息。
        </p>
        <label className="mt-2.5 flex items-start gap-2 text-xs text-foreground">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            我已阅读并同意上述隐私告知。
            {errAgree && <span className="ml-1 text-stamp">请先勾选同意</span>}
          </span>
        </label>
      </div>

      <div className="mt-4">
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

      <Button size="lg" className="mt-4 w-full" onClick={submit} disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        提交绑定
      </Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        一名学生可由多位监护人分别绑定
      </p>
    </div>
  )
}

function BindResult({
  result,
  message,
  binding,
  className,
  onBack,
  onGoSign,
}: {
  result: Result
  message: string
  binding: ParentBindingInfo | null
  className: string
  onBack: () => void
  onGoSign?: () => void
}) {
  const map = {
    success: {
      icon: CheckCircle2,
      color: "text-success",
      bg: "bg-success-soft",
      title: "绑定成功",
      desc: message || "您已成功绑定学生身份，可前往签收通知。",
    },
    review: {
      icon: Clock,
      color: "text-warning",
      bg: "bg-warning-soft",
      title: "待班主任审核",
      desc: message || "绑定信息与名单存在差异，已提交班主任审核。",
    },
    duplicate: {
      icon: AlertTriangle,
      color: "text-stamp",
      bg: "bg-stamp-soft",
      title: "疑似重复绑定",
      desc: message || "该学生已有监护人绑定，已进入待审核。",
    },
    none: {
      icon: CheckCircle2,
      color: "text-success",
      bg: "bg-success-soft",
      title: "",
      desc: "",
    },
  }[result]
  const Icon = map.icon
  return (
    <div className="flex min-h-[640px] flex-col items-center px-5 py-10 text-center">
      <div className={"mb-4 flex size-16 items-center justify-center rounded-full " + map.bg}>
        <Icon className={"size-8 " + map.color} />
      </div>
      <h2 className="text-lg font-semibold text-foreground">{map.title}</h2>
      <p className="mt-1.5 max-w-[280px] text-sm text-muted-foreground">{map.desc}</p>

      <div className="mt-5 w-full rounded-md border border-border bg-card p-3 text-left text-sm">
        <Row k="学生" v={binding ? binding.studentName : "待审核"} />
        <Row k="班级" v={className} />
        <Row k="监护人" v={binding ? `${binding.guardianName}（${binding.relation}）` : "待审核"} />
        <Row k="绑定编号" v={binding ? `BD-${binding.bindingId}` : "—"} mono />
      </div>

      {result === "success" && onGoSign && (
        <Button size="lg" className="mt-5 w-full" onClick={onGoSign}>前往签收通知</Button>
      )}
      <Button variant="outline" size="sm" className="mt-2 w-full" onClick={onBack}>
        返回绑定页
      </Button>
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={"text-foreground " + (mono ? "font-mono text-xs" : "")}>{v}</span>
    </div>
  )
}
