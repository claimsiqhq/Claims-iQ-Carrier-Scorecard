import { useState, useEffect, useCallback } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Sparks, RefreshDouble, FloppyDisk, WarningTriangle } from "iconoir-react"

interface PromptData {
  system_prompt: string
  user_prompt_template: string
}

export default function SettingsPage() {
  const [prompts, setPrompts] = useState<PromptData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const fetchPrompts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${baseUrl}/settings/prompts`)
      if (!res.ok) throw new Error("Failed to load prompts")
      const data = await res.json()
      setPrompts(data)
      setDirty(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts])

  const handleSave = async () => {
    if (!prompts) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`${baseUrl}/settings/prompts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompts),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save")
      setSuccess("Prompts saved successfully")
      setDirty(false)
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`${baseUrl}/settings/prompts/reset`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to reset")
      setPrompts({
        system_prompt: data.system_prompt,
        user_prompt_template: data.user_prompt_template,
      })
      setDirty(false)
      setSuccess("Prompts reset to defaults")
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setResetting(false)
    }
  }

  const updateField = (field: keyof PromptData, value: string) => {
    setPrompts((prev) => prev ? { ...prev, [field]: value } : null)
    setDirty(true)
    setError(null)
    setSuccess(null)
  }

  if (loading) {
    return (
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Settings</h1>
        </header>
        <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: BRAND.offWhite }}>
          <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: BRAND.purple, borderTopColor: "transparent" }} />
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 md:h-16 flex items-center justify-between px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
        <div className="flex items-center gap-2 md:gap-3">
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Settings</h1>
          <Badge className="shadow-none border-transparent text-xs hidden sm:inline-flex" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
            AI Prompts
          </Badge>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 md:gap-2 text-xs md:text-sm"
            style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}
            onClick={handleReset}
            disabled={resetting || saving}
          >
            <RefreshDouble width={16} height={16} />
            <span className="hidden sm:inline">{resetting ? "Resetting..." : "Reset to Defaults"}</span>
            <span className="sm:hidden">{resetting ? "..." : "Reset"}</span>
          </Button>
          <Button
            size="sm"
            className="gap-1 md:gap-2 text-xs md:text-sm text-white"
            style={{ backgroundColor: dirty ? BRAND.purple : BRAND.purpleSecondary, fontFamily: FONTS.heading, fontWeight: 600 }}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            <FloppyDisk width={16} height={16} />
            <span className="hidden sm:inline">{saving ? "Saving..." : "Save Changes"}</span>
            <span className="sm:hidden">{saving ? "..." : "Save"}</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg border" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca", color: "#dc2626" }}>
              <WarningTriangle width={16} height={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 p-3 rounded-lg border" style={{ backgroundColor: "#f0fdf4", borderColor: "#bbf7d0", color: "#16a34a" }}>
              <Sparks width={16} height={16} />
              <span className="text-sm">{success}</span>
            </div>
          )}

          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  <Sparks width={18} height={18} style={{ color: BRAND.gold }} />
                  System Prompt
                </CardTitle>
                <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                  Sets the AI reviewer's persona and behavior
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <textarea
                className="w-full rounded-lg border p-4 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2"
                style={{
                  borderColor: BRAND.greyLavender,
                  fontFamily: FONTS.mono,
                  fontSize: "13px",
                  minHeight: "200px",
                  color: BRAND.deepPurple,
                  backgroundColor: BRAND.offWhite,
                }}
                value={prompts?.system_prompt ?? ""}
                onChange={(e) => updateField("system_prompt", e.target.value)}
              />
            </CardContent>
          </Card>

          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  <Sparks width={18} height={18} style={{ color: BRAND.gold }} />
                  User Prompt Template
                </CardTitle>
                <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                  Scoring rubric and output format
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                <WarningTriangle width={14} height={14} style={{ color: BRAND.purple }} />
                <span className="text-xs" style={{ color: BRAND.purple, fontFamily: FONTS.body }}>
                  Must contain <code className="px-1 py-0.5 rounded text-xs" style={{ backgroundColor: BRAND.white, fontFamily: FONTS.mono }}>{"{{REPORT}}"}</code> — this is replaced with the claim documents at runtime.
                </span>
              </div>
              <textarea
                className="w-full rounded-lg border p-4 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2"
                style={{
                  borderColor: BRAND.greyLavender,
                  fontFamily: FONTS.mono,
                  fontSize: "13px",
                  minHeight: "400px",
                  color: BRAND.deepPurple,
                  backgroundColor: BRAND.offWhite,
                }}
                value={prompts?.user_prompt_template ?? ""}
                onChange={(e) => updateField("user_prompt_template", e.target.value)}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
