"use client"

import { CheckCircle2, ShieldCheck } from "lucide-react"
import { EVIDENCE_RECORDS, STUDENT_ROWS } from "@/lib/demo-data"

function SignatureMark({ name }: { name: string }) {
  return (
    <span
      className="font-serif text-lg italic text-foreground"
      style={{ fontFamily: "'Noto Serif SC', 'KaiTi', 'STKaiti', serif" }}
    >
      {name}
    </span>
  )
}

export function PdfEvidenceView() {
  const signed = STUDENT_ROWS.filter((s) => s.sign === "signed").slice(0, 9)

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 self-stretch rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">归档凭证预览 · 单份 PDF</h3>
          <p className="text-xs text-muted-foreground">
            每位学生生成一页 A4 凭证，包含通知正文、签收信息与手写签名，可批量打包为班级 ZIP。
          </p>
        </div>
        <span className="rounded-md bg-success-soft px-2.5 py-1 text-xs font-medium text-success">
          已锁定 · 不可篡改
        </span>
      </div>

      {/* A4 sheet */}
      <div
        className="w-full max-w-[640px] bg-card px-10 py-9 shadow-sm ring-1 ring-border"
        style={{ aspectRatio: "210 / 297" }}
      >
        <div className="flex items-start justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">实验小学 · 家校通知签收凭证</p>
              <p className="text-[11px] text-muted-foreground">
                凭证编号：QST-20260601-501-0012
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            <p>生成时间</p>
            <p className="font-mono">2026-06-10 18:30</p>
          </div>
        </div>

        <h2 className="mt-6 text-center text-lg font-bold text-foreground">
          2026 春季安全承诺书
        </h2>
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          通知范围：全校 · 截止时间：2026-06-10 18:00
        </p>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 rounded-md bg-muted/50 px-4 py-3 text-xs">
          <Field label="学生姓名" value="张子涵" />
          <Field label="班级" value="五（1）班" />
          <Field label="班内序号" value="1 号" />
          <Field label="有效签收" value={`${EVIDENCE_RECORDS.length} 位监护人`} />
          <Field label="最早签收" value={EVIDENCE_RECORDS[0].time} />
          <Field label="签收方式" value="手写签名确认" />
        </div>

        <div className="mt-5 text-xs leading-6 text-foreground">
          <p className="font-medium">承诺内容（节选）：</p>
          <p className="mt-1 text-muted-foreground">
            本人已认真阅读《2026 春季安全承诺书》全部内容，承诺履行监护职责，做好防溺水、交通安全、消防用电、外出报备等各项安全监管，确保孩子度过一个安全、健康的学期。
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3">
          {EVIDENCE_RECORDS.map((record) => (
            <div
              key={record.id}
              className="grid grid-cols-[1fr_150px] gap-3 rounded-md border border-border bg-background p-3"
            >
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p className="text-xs font-medium text-foreground">
                  {record.parent}（{record.relation}）手写签收
                </p>
                <p>签收时间：{record.time}</p>
                <p>记录编号：{record.recordNo}</p>
                <p>IP / 设备：{record.ip} · {record.ua}</p>
              </div>
              <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
                <SignatureMark name={record.parent} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-end justify-end">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="flex h-22 w-22 rotate-[-12deg] flex-col items-center justify-center rounded-full border-2 border-stamp p-2 text-center text-stamp">
              <span className="text-[10px] font-bold leading-tight">实验小学</span>
              <span className="text-[9px] leading-tight">签收专用章</span>
              <span className="mt-0.5 font-mono text-[8px]">2026.06.01</span>
            </div>
          </div>
        </div>

        <div className="mt-auto" />
        <div className="mt-6 flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-success" />
            核对码 8F2A-19C7-DD03 · 本凭证由家校签收通生成
          </span>
          <span>第 1 / 1 页</span>
        </div>
      </div>

      {/* batch list */}
      <div className="w-full rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">班级 ZIP 打包清单（节选）</h3>
          <p className="text-xs text-muted-foreground">
            每班一份 ZIP，文件名规则：序号_姓名_签收凭证.pdf
          </p>
        </div>
        <ul className="divide-y divide-border">
          {signed.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between px-4 py-2.5 text-xs"
            >
              <span className="font-mono text-muted-foreground">
                {String(s.seat).padStart(2, "0")}_{s.name}_签收凭证.pdf
              </span>
              <span className="flex items-center gap-1 text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已生成
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}：</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}
