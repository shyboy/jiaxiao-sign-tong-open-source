// 家校签收通 —— 本地演示数据（全部为假数据，无真实后端）

export const SCHOOL = {
  name: "实验小学",
  term: "2026 春季学期",
}

// —— 学校设置 ——

export const SCHOOL_PROFILE = {
  name: "实验小学",
  shortName: "实验小学",
  stage: "小学（六年制）",
  region: "示范市 · 城关区",
  sealText: "实验小学", // 公章/落款名称
  principal: "周校长",
  contact: "0571-8888 0000",
  termName: "2026 春季学期",
  defaultDeadlineHour: "18:00",
  domain: "sign.example.edu.cn",
}

export type OrgGrade = {
  id: string
  grade: string
  classCount: number
  studentCount: number
  classes: string[]
}

export const ORG_GRADES: OrgGrade[] = [
  { id: "g6", grade: "六年级", classCount: 4, studentCount: 168, classes: ["六（1）班", "六（2）班", "六（3）班", "六（4）班"] },
  { id: "g5", grade: "五年级", classCount: 4, studentCount: 170, classes: ["五（1）班", "五（2）班", "五（3）班", "五（4）班"] },
  { id: "g4", grade: "四年级", classCount: 4, studentCount: 165, classes: ["四（1）班", "四（2）班", "四（3）班", "四（4）班"] },
  { id: "g3", grade: "三年级", classCount: 4, studentCount: 160, classes: ["三（1）班", "三（2）班", "三（3）班", "三（4）班"] },
]

export type TeacherAccountStatus = "active" | "disabled" | "invited"

export type TeacherAccount = {
  id: string
  name: string
  account: string
  role: "school_admin" | "homeroom"
  scope: string
  phone: string
  status: TeacherAccountStatus
  lastLogin: string
}

export const TEACHER_ACCOUNTS: TeacherAccount[] = [
  { id: "u1", name: "张老师", account: "zhang_jw", role: "school_admin", scope: "全校", phone: "138****0001", status: "active", lastLogin: "2026-06-01 11:18" },
  { id: "u2", name: "王老师", account: "wang_501", role: "homeroom", scope: "五（1）班", phone: "139****0102", status: "active", lastLogin: "2026-06-01 10:22" },
  { id: "u3", name: "李老师", account: "li_502", role: "homeroom", scope: "五（2）班", phone: "137****0203", status: "active", lastLogin: "2026-06-01 09:50" },
  { id: "u4", name: "赵老师", account: "zhao_401", role: "homeroom", scope: "四（1）班", phone: "136****0304", status: "disabled", lastLogin: "2026-05-20 16:30" },
  { id: "u5", name: "陈老师", account: "chen_402", role: "homeroom", scope: "四（2）班", phone: "135****0405", status: "invited", lastLogin: "—" },
]

export const SCHOOL_METRICS = {
  due: 86, // 应签
  signed: 72, // 已签
  unbound: 8, // 未绑定
  abnormal: 3, // 异常
  rate: 83.7, // 签收率 %
}

export type ForwardStatus = "forwarded" | "pending"

export type ClassProgress = {
  id: string
  grade: string
  className: string
  teacher: string
  due: number
  signed: number
  unbound: number
  waiting: number
  abnormal: number
  rate: number
  forward: ForwardStatus
}

export const CLASS_PROGRESS: ClassProgress[] = [
  { id: "c1", grade: "五年级", className: "五（1）班", teacher: "王老师", due: 45, signed: 41, unbound: 2, waiting: 1, abnormal: 1, rate: 91.1, forward: "forwarded" },
  { id: "c2", grade: "五年级", className: "五（2）班", teacher: "李老师", due: 41, signed: 31, unbound: 6, waiting: 2, abnormal: 2, rate: 75.6, forward: "forwarded" },
  { id: "c3", grade: "四年级", className: "四（1）班", teacher: "赵老师", due: 43, signed: 38, unbound: 3, waiting: 2, abnormal: 0, rate: 88.4, forward: "forwarded" },
  { id: "c4", grade: "四年级", className: "四（2）班", teacher: "陈老师", due: 40, signed: 26, unbound: 9, waiting: 4, abnormal: 1, rate: 65.0, forward: "pending" },
]

export type NoticeStatus = "published" | "draft" | "closed"

export type Notice = {
  id: string
  title: string
  status: NoticeStatus
  deadline: string
  classes: string
  version: string
  publishedAt: string
}

export const NOTICES: Notice[] = [
  { id: "n1", title: "2026 春季安全承诺书", status: "published", deadline: "2026-06-10 18:00", classes: "全校 24 个班", version: "v1", publishedAt: "2026-06-01 09:30" },
  { id: "n2", title: "防溺水安全告知书", status: "published", deadline: "2026-05-20 18:00", classes: "全校 24 个班", version: "v2", publishedAt: "2026-05-08 10:12" },
  { id: "n3", title: "春季研学活动告知书", status: "draft", deadline: "—", classes: "五年级", version: "v1", publishedAt: "—" },
  { id: "n4", title: "校服征订确认书", status: "closed", deadline: "2026-03-15 18:00", classes: "全校 24 个班", version: "v1", publishedAt: "2026-03-01 08:40" },
]

export type ExportStatus = "running" | "success" | "failed"

export type ExportTask = {
  id: string
  type: string
  scope: string
  status: ExportStatus
  createdAt: string
  size: string
}

export const EXPORT_TASKS: ExportTask[] = [
  { id: "e1", type: "Excel 明细", scope: "安全承诺书 · 全校", status: "success", createdAt: "2026-06-01 11:05", size: "240 KB" },
  { id: "e2", type: "班级 PDF zip", scope: "安全承诺书 · 五（1）班", status: "running", createdAt: "2026-06-01 11:18", size: "—" },
  { id: "e3", type: "单份 PDF", scope: "张子涵 · 五（1）班", status: "success", createdAt: "2026-06-01 10:46", size: "86 KB" },
  { id: "e4", type: "班级 PDF zip", scope: "安全承诺书 · 四（2）班", status: "failed", createdAt: "2026-06-01 10:32", size: "—" },
]

export type AuditLog = {
  id: string
  time: string
  actor: string
  action: string
  detail: string
  type: "publish" | "export" | "abnormal" | "login" | "other"
}

export const AUDIT_LOGS: AuditLog[] = [
  { id: "a1", time: "2026-06-01 11:18", actor: "张老师（教务处）", action: "导出", detail: "发起班级 PDF zip：五（1）班", type: "export" },
  { id: "a2", time: "2026-06-01 11:02", actor: "王老师", action: "异常处理", detail: "确认有效：刘小雨 重复签收", type: "abnormal" },
  { id: "a3", time: "2026-06-01 09:30", actor: "张老师（教务处）", action: "发布通知", detail: "发布《2026 春季安全承诺书》v1 至全校", type: "publish" },
  { id: "a4", time: "2026-06-01 08:51", actor: "school_admin_demo", action: "登录", detail: "管理员登录（IP 10.20.1.6）", type: "login" },
  { id: "a5", time: "2026-05-31 16:20", actor: "李老师", action: "异常处理", detail: "驳回：陈思远 绑定信息不一致", type: "abnormal" },
]

// —— 班主任端 ——

export const TEACHER_CLASS = {
  school: "实验小学",
  className: "五（1）班",
  teacher: "王老师",
  studentCount: 45,
}

// 班主任收到的（来自学校发布的）多个通知，每个通知独立维护链接/转发/进度/异常/导出
export type TeacherNotice = {
  id: string
  title: string
  version: string
  deadline: string
  status: "ongoing" | "closed"
  forward: ForwardStatus
  forwardedAt: string
  link: {
    token: string
    url: string
    status: "active" | "revoked" | "expired"
    createdAt: string
  }
  groupMessage: string
  metrics: { due: number; signed: number; waiting: number; unbound: number; abnormal: number }
}

export const TEACHER_NOTICES: TeacherNotice[] = [
  {
    id: "tn1",
    title: "2026 春季安全承诺书",
    version: "v1",
    deadline: "2026-06-10 18:00",
    status: "ongoing",
    forward: "forwarded",
    forwardedAt: "2026-06-01 09:38",
    link: { token: "sign_5g1_8aF3kQ", url: "https://sign.example.edu.cn/s/8aF3kQ", status: "active", createdAt: "2026-06-01 09:35" },
    groupMessage: `【实验小学 · 五（1）班】各位家长好：\n现需完成《2026 春季安全承诺书》线上签收，请于 6月10日 18:00 前完成。\n请点击链接完成绑定并手写签收（每位孩子至少一位监护人完成）：\nhttps://sign.example.edu.cn/s/8aF3kQ\n如已签收请忽略。感谢配合！——王老师`,
    metrics: { due: 45, signed: 41, waiting: 2, unbound: 2, abnormal: 1 },
  },
  {
    id: "tn2",
    title: "防溺水安全告知书",
    version: "v2",
    deadline: "2026-05-20 18:00",
    status: "ongoing",
    forward: "pending",
    forwardedAt: "—",
    link: { token: "sign_5g1_2pL9xT", url: "https://sign.example.edu.cn/s/2pL9xT", status: "active", createdAt: "2026-05-08 10:20" },
    groupMessage: `【实验小学 · 五（1）班】各位家长好：\n现需完成《防溺水安全告知书》线上签收，请于 5月20日 18:00 前完成。\n请点击链接完成绑定并手写签收：\nhttps://sign.example.edu.cn/s/2pL9xT\n感谢配合！——王老师`,
    metrics: { due: 45, signed: 19, waiting: 8, unbound: 18, abnormal: 0 },
  },
  {
    id: "tn3",
    title: "春季研学活动告知书",
    version: "v1",
    deadline: "2026-06-18 18:00",
    status: "ongoing",
    forward: "pending",
    forwardedAt: "—",
    link: { token: "sign_5g1_7yH4mD", url: "https://sign.example.edu.cn/s/7yH4mD", status: "active", createdAt: "2026-06-03 08:50" },
    groupMessage: `【实验小学 · 五（1）班】各位家长好：\n现需完成《春季研学活动告知书》线上签收，请于 6月18日 18:00 前完成。\n请点击链接完成绑定并手写签收：\nhttps://sign.example.edu.cn/s/7yH4mD\n感谢配合！——王老师`,
    metrics: { due: 45, signed: 0, waiting: 0, unbound: 45, abnormal: 0 },
  },
]

export const IMPORT_PREVIEW = {
  added: 3,
  updated: 2,
  duplicated: 1,
  countMismatch: true,
}

export const SIGN_LINK = {
  token: "sign_5g1_8aF3kQ",
  url: "https://sign.example.edu.cn/s/8aF3kQ",
  status: "active" as "active" | "revoked" | "expired",
  createdAt: "2026-06-01 09:35",
}

export const GROUP_MESSAGE = `【实验小学 · 五（1）班】各位家长好：
现需完成《2026 春季安全承诺书》线上签收，请于 6月10日 18:00 前完成。
请点击链接完成绑定并手写签收（每位孩子至少一位监护人完成）：
https://sign.example.edu.cn/s/8aF3kQ
如已签收请忽略。感谢配合！——王老师`

export type SignStatus = "signed" | "waiting" | "unbound"

export type StudentRow = {
  id: string
  name: string
  seat: number
  bind: "bound" | "unbound"
  sign: SignStatus
  reminders: number
  lastReminder: string
}

export const STUDENT_ROWS: StudentRow[] = [
  { id: "s1", name: "张子涵", seat: 1, bind: "bound", sign: "signed", reminders: 0, lastReminder: "—" },
  { id: "s2", name: "王梓萱", seat: 2, bind: "bound", sign: "waiting", reminders: 2, lastReminder: "2026-06-01 10:20" },
  { id: "s3", name: "刘思源", seat: 5, bind: "unbound", sign: "unbound", reminders: 1, lastReminder: "2026-05-31 19:02" },
  { id: "s4", name: "陈奕辰", seat: 8, bind: "bound", sign: "waiting", reminders: 1, lastReminder: "2026-06-01 09:40" },
  { id: "s5", name: "赵语桐", seat: 12, bind: "unbound", sign: "unbound", reminders: 0, lastReminder: "—" },
  { id: "s6", name: "孙浩然", seat: 15, bind: "bound", sign: "signed", reminders: 0, lastReminder: "—" },
]

export type AbnormalType = "bind" | "sign"

export type AbnormalRow = {
  id: string
  student: string
  seat: string
  kind: string
  category: AbnormalType
  detail: string
  found: string
}

export const ABNORMAL_ROWS: AbnormalRow[] = [
  { id: "x1", student: "刘小雨", seat: "18", kind: "重复签收", category: "sign", detail: "同一监护人 5 分钟内提交两次签收", found: "2026-06-01 11:12" },
  { id: "x2", student: "陈思远", seat: "27", kind: "绑定信息不一致", category: "bind", detail: "提交序号 27，名单中为陈思远（25）", found: "2026-06-01 10:48" },
  { id: "x3", student: "（无匹配）", seat: "99", kind: "姓名/序号不存在", category: "bind", detail: "提交序号 99，本班名单无此序号", found: "2026-06-01 10:05" },
  { id: "x4", student: "周子轩", seat: "31", kind: "疑似代签", category: "sign", detail: "签名与历史记录差异较大", found: "2026-05-31 21:15" },
]

export const TEACHER_TODOS = [
  { id: "t1", label: "复制并转发通知文案到家长群", done: true },
  { id: "t2", label: "提醒 6 名未签家长", done: false },
  { id: "t3", label: "处理 4 条异常记录", done: false },
]

// —— 家长端 ——

export const PARENT_NOTICE = {
  school: "实验小学",
  className: "五（1）班",
  title: "2026 春季安全承诺书",
  version: "v1",
  deadline: "2026-06-10 18:00",
  body: [
    "一、合理安排作息，保证充足睡眠，不长时间使用电子产品。",
    "二、注意交通安全，自觉遵守交通规则，不乘坐无牌无证车辆。",
    "三、严防溺水，做到“六不”：不私自下水游泳，不擅自结伴游泳。",
    "四、注意用电、用火、饮食安全，不玩火，不接触危险物品。",
    "五、外出告知家长去向，遵守法律法规，文明上网，远离不良信息。",
    "本人已认真阅读并同意以上内容，承诺履行监护职责，确保孩子度过一个安全、健康的学期。",
  ],
}

// 同一学生可有多个监护人签收记录（统计不重复计数）
export const EVIDENCE_RECORDS = [
  { id: "r1", parent: "李女士", relation: "母亲", time: "2026-06-01 10:12", recordNo: "QSJ-20260601-000128", ua: "iPhone · Safari · 微信内置浏览器", ip: "117.136.xx.xx" },
  { id: "r2", parent: "李先生", relation: "父亲", time: "2026-06-02 08:41", recordNo: "QSJ-20260602-000312", ua: "Android · Chrome · 微信内置浏览器", ip: "223.104.xx.xx" },
]
