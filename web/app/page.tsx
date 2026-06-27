"use client"

import { useEffect, useState } from "react"
import { ShieldCheck } from "lucide-react"
import { LoginView } from "@/components/views/login-view"
import { SchoolAdminView } from "@/components/views/school-admin-view"
import { TeacherView } from "@/components/views/teacher-view"
import { ParentLinkResolveView } from "@/components/views/parent-link-resolve-view"
import { ParentBindView } from "@/components/views/parent-bind-view"
import { ParentSignView } from "@/components/views/parent-sign-view"
import type { ParentLinkInfo } from "@/components/views/parent-flow"

type LoginRole = "school_admin" | "teacher"
type ParentStep = "resolve" | "bind" | "sign"

type StoredUser = {
  name: string
  role: LoginRole
}

export default function Page() {
  const [user, setUser] = useState<StoredUser | null>(null)
  const [parentStep, setParentStep] = useState<ParentStep>("resolve")
  const [parentToken, setParentToken] = useState("")
  const [parentLink, setParentLink] = useState<ParentLinkInfo | null>(null)
  const [isParentEntry, setIsParentEntry] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("t") || params.get("token")
    if (token) {
      setIsParentEntry(true)
      setParentToken(token)
      window.localStorage.setItem("jiaxiaoParentToken", token)
      return
    }

    try {
      const raw = window.localStorage.getItem("jiaxiaoUser")
      if (!raw) return
      const parsed = JSON.parse(raw) as StoredUser
      if (parsed.role === "school_admin" || parsed.role === "teacher") {
        setUser({ name: parsed.name, role: parsed.role })
      }
    } catch {
      window.localStorage.removeItem("jiaxiaoUser")
    }
  }, [])

  function handleLogin(role: LoginRole) {
    try {
      const raw = window.localStorage.getItem("jiaxiaoUser")
      const parsed = raw ? (JSON.parse(raw) as StoredUser) : null
      setUser({ name: parsed?.name || (role === "teacher" ? "班主任" : "学校管理员"), role })
    } catch {
      setUser({ name: role === "teacher" ? "班主任" : "学校管理员", role })
    }
  }

  function logout() {
    window.localStorage.removeItem("jiaxiaoToken")
    window.localStorage.removeItem("jiaxiaoUser")
    setUser(null)
  }

  function goParentBind(token: string, link: ParentLinkInfo) {
    setParentToken(token)
    setParentLink(link)
    setParentStep("bind")
  }

  function goParentSign(token: string, link: ParentLinkInfo) {
    setParentToken(token)
    setParentLink(link)
    setParentStep("sign")
  }

  if (isParentEntry) {
    return (
      <main className="min-h-screen bg-background">
        <PublicHeader />
        <div className="mx-auto max-w-md py-3">
          {parentStep === "resolve" && (
            <ParentLinkResolveView
              onGoBind={goParentBind}
              onGoSign={goParentSign}
            />
          )}
          {parentStep === "bind" && (
            <ParentBindView
              token={parentToken}
              link={parentLink}
              onGoSign={goParentSign}
            />
          )}
          {parentStep === "sign" && (
            <ParentSignView
              token={parentToken}
              link={parentLink}
              onGoBind={goParentBind}
            />
          )}
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-background">
        <LoginView onLogin={handleLogin} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-board">
      {user.role === "teacher" ? (
        <TeacherView accountName={user.name} onLogout={logout} />
      ) : (
        <SchoolAdminView accountName={user.name} onLogout={logout} />
      )}
    </main>
  )
}

function PublicHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-md items-center gap-2.5 px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">家校签收通</p>
          <p className="text-xs text-muted-foreground">通知签收</p>
        </div>
      </div>
    </header>
  )
}
