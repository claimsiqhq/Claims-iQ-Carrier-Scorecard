import { useState, useEffect, useCallback } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocation } from "wouter"
import { NavArrowLeft, FloppyDisk, Plus, Trash, Sparks, WarningTriangle, Code, ListSelect } from "iconoir-react"

interface Question {
  id: string
  text: string
  weight: number
  weightIfNoDenial?: number
  section: string
  scorecard: "DA" | "FA"
  categoryKey: string
  categoryName: string
}

interface ScorecardCategory {
  id: string
  label: string
  max_score: number
}

interface Ruleset {
  version: string
  da_questions: Question[]
  fa_questions: Question[]
  scorecard_categories: ScorecardCategory[]
  system_prompt_override?: string
  carrier_scorecard_prompt_override?: string
}

interface CarrierData {
  carrierKey: string
  displayName: string
  logoUrl: string
  active: boolean
  ruleset: Ruleset
}

const EMPTY_RULESET: Ruleset = {
  version: "1.0",
  da_questions: [],
  fa_questions: [],
  scorecard_categories: [],
}

function generateKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

function stripTypeScriptSyntax(raw: string): string {
  let s = raw
  s = s.replace(/\/\*[\s\S]*?\*\//g, "")
  s = s.replace(/^\s*\/\/.*$/gm, "")
  s = s.replace(/,\s*\/\/.*$/gm, ",")
  s = s.replace(/\{\s*\/\/.*$/gm, "{")
  s = s.replace(/\[\s*\/\/.*$/gm, "[")
  s = s.replace(/^interface\s+\w+\s*\{[\s\S]*?\}\s*/gm, "")
  s = s.replace(/^type\s+\w+\s*=[\s\S]*?;\s*/gm, "")
  s = s.replace(/^export\s+default\s+/m, "")
  s = s.replace(/^export\s+(const|let|var)\s+\w+\s*[^=]*=\s*/m, "")
  s = s.replace(/^(const|let|var)\s+\w+\s*[^=]*=\s*/m, "")
  s = s.replace(/\bas\s+const\b/g, "")
  s = s.replace(/\bas\s+[A-Z]\w*(?:\[\])?\b/g, "")
  s = s.replace(/;\s*$/gm, "")
  s = s.trim()
  if (s.endsWith(";")) s = s.slice(0, -1).trim()
  return s
}

function parseRulesetFromCode(code: string): { ruleset: Ruleset; errors: string[] } {
  const errors: string[] = []
  let trimmed = code.trim()
  if (!trimmed) {
    return { ruleset: { ...EMPTY_RULESET }, errors: ["Input is empty"] }
  }

  let parsed: Record<string, unknown>

  try {
    parsed = JSON.parse(trimmed)
  } catch {
    const stripped = stripTypeScriptSyntax(trimmed)
    try {
      let jsonified = stripped
      jsonified = jsonified.replace(/`([^`]*)`/g, (_, content) => {
        return JSON.stringify(content)
      })
      jsonified = jsonified.replace(/:\s*'([^']*?)'/g, ': "$1"')
      jsonified = jsonified.replace(/,\s*([}\]])/g, "$1")
      jsonified = jsonified.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')

      parsed = JSON.parse(jsonified)
    } catch (e2) {
      return {
        ruleset: { ...EMPTY_RULESET },
        errors: [`Failed to parse input: ${e2 instanceof Error ? e2.message : "Invalid syntax"}. Ensure you are pasting valid JSON or a JavaScript/TypeScript object literal.`],
      }
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ruleset: { ...EMPTY_RULESET }, errors: ["Parsed value is not an object. Expected a ruleset object with da_questions, fa_questions, etc."] }
  }

  const ruleset: Ruleset = {
    version: typeof parsed.version === "string" ? parsed.version : "1.0",
    da_questions: [],
    fa_questions: [],
    scorecard_categories: [],
  }

  if (typeof parsed.system_prompt_override === "string" && parsed.system_prompt_override.trim()) {
    ruleset.system_prompt_override = parsed.system_prompt_override
  }
  if (typeof parsed.carrier_scorecard_prompt_override === "string" && parsed.carrier_scorecard_prompt_override.trim()) {
    ruleset.carrier_scorecard_prompt_override = parsed.carrier_scorecard_prompt_override
  }

  const validateQuestion = (q: Record<string, unknown>, idx: number, label: string): Question | null => {
    const missing: string[] = []
    if (typeof q.id !== "string" || !q.id.trim()) missing.push("id")
    if (typeof q.text !== "string" || !q.text.trim()) missing.push("text")
    if (typeof q.weight !== "number") missing.push("weight")
    if (typeof q.categoryKey !== "string" || !q.categoryKey.trim()) missing.push("categoryKey")

    if (missing.length > 0) {
      errors.push(`${label} question at index ${idx} is missing: ${missing.join(", ")}`)
      return null
    }

    return {
      id: q.id as string,
      text: q.text as string,
      weight: q.weight as number,
      weightIfNoDenial: typeof q.weightIfNoDenial === "number" ? q.weightIfNoDenial : undefined,
      section: typeof q.section === "string" ? q.section : label.toLowerCase(),
      scorecard: label as "DA" | "FA",
      categoryKey: q.categoryKey as string,
      categoryName: typeof q.categoryName === "string" ? q.categoryName : "",
    }
  }

  if (Array.isArray(parsed.da_questions)) {
    for (let i = 0; i < (parsed.da_questions as unknown[]).length; i++) {
      const q = (parsed.da_questions as Record<string, unknown>[])[i]
      if (typeof q !== "object" || q === null) {
        errors.push(`DA question at index ${i} is not an object`)
        continue
      }
      const validated = validateQuestion(q, i, "DA")
      if (validated) ruleset.da_questions.push(validated)
    }
  } else if (parsed.da_questions !== undefined) {
    errors.push("da_questions must be an array")
  }

  if (Array.isArray(parsed.fa_questions)) {
    for (let i = 0; i < (parsed.fa_questions as unknown[]).length; i++) {
      const q = (parsed.fa_questions as Record<string, unknown>[])[i]
      if (typeof q !== "object" || q === null) {
        errors.push(`FA question at index ${i} is not an object`)
        continue
      }
      const validated = validateQuestion(q, i, "FA")
      if (validated) ruleset.fa_questions.push(validated)
    }
  } else if (parsed.fa_questions !== undefined) {
    errors.push("fa_questions must be an array")
  }

  if (Array.isArray(parsed.scorecard_categories)) {
    for (let i = 0; i < (parsed.scorecard_categories as unknown[]).length; i++) {
      const c = (parsed.scorecard_categories as Record<string, unknown>[])[i]
      if (typeof c !== "object" || c === null) {
        errors.push(`Scorecard category at index ${i} is not an object`)
        continue
      }
      const cMissing: string[] = []
      if (typeof c.id !== "string" || !(c.id as string).trim()) cMissing.push("id")
      if (typeof c.label !== "string" || !(c.label as string).trim()) cMissing.push("label")
      if (typeof c.max_score !== "number") cMissing.push("max_score")
      if (cMissing.length > 0) {
        errors.push(`Scorecard category at index ${i} is missing: ${cMissing.join(", ")}`)
        continue
      }
      ruleset.scorecard_categories.push({
        id: c.id as string,
        label: c.label as string,
        max_score: c.max_score as number,
      })
    }
  } else if (parsed.scorecard_categories !== undefined) {
    errors.push("scorecard_categories must be an array")
  }

  return { ruleset, errors }
}

export default function CarrierEditorPage({ carrierKey }: { carrierKey: string }) {
  const isNew = carrierKey === "new"
  const [, setLocation] = useLocation()
  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const [data, setData] = useState<CarrierData>({
    carrierKey: "",
    displayName: "",
    logoUrl: "",
    active: true,
    ruleset: { ...EMPTY_RULESET },
  })
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    prompt: false,
    da: false,
    fa: false,
    categories: false,
  })
  const [editorMode, setEditorMode] = useState<"form" | "code">("form")
  const [codeContent, setCodeContent] = useState("")
  const [codeErrors, setCodeErrors] = useState<string[]>([])
  const [codeParsed, setCodeParsed] = useState(false)

  const fetchCarrier = useCallback(async () => {
    if (isNew) return
    setLoading(true)
    try {
      const res = await fetch(`${baseUrl}/carriers/${carrierKey}`, { credentials: "include" })
      if (!res.ok) throw new Error("Carrier not found")
      const row = await res.json()
      setData({
        carrierKey: row.carrierKey,
        displayName: row.displayName,
        logoUrl: row.logoUrl || "",
        active: row.active,
        ruleset: row.ruleset || { ...EMPTY_RULESET },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load carrier")
    } finally {
      setLoading(false)
    }
  }, [baseUrl, carrierKey, isNew])

  useEffect(() => {
    fetchCarrier()
  }, [fetchCarrier])

  const handleSave = async () => {
    if (!data.displayName.trim()) {
      setError("Display name is required")
      return
    }
    const key = isNew ? generateKey(data.displayName) : data.carrierKey
    if (!key) {
      setError("Could not generate a valid carrier key from the name")
      return
    }
    if (data.ruleset.da_questions.length === 0) {
      setError("At least one DA question is required")
      return
    }
    if (data.ruleset.fa_questions.length === 0) {
      setError("At least one FA question is required")
      return
    }
    if (data.ruleset.scorecard_categories.length === 0) {
      setError("At least one scorecard category is required")
      return
    }
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      if (isNew) {
        const checkRes = await fetch(`${baseUrl}/carriers/${key}`, { credentials: "include" })
        if (checkRes.ok) {
          setError(`A carrier with key "${key}" already exists. Choose a different name.`)
          setSaving(false)
          return
        }
      }
      const res = await fetch(`${baseUrl}/carriers/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          displayName: data.displayName.trim(),
          logoUrl: data.logoUrl || null,
          active: data.active,
          ruleset: data.ruleset,
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || "Failed to save")
      setSuccess("Carrier saved successfully")
      setDirty(false)
      setTimeout(() => setSuccess(null), 3000)
      if (isNew) {
        setLocation(`/carriers/${key}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save carrier")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`${baseUrl}/carriers/${data.carrierKey}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const result = await res.json()
        throw new Error(result.error || "Failed to delete carrier")
      }
      setLocation("/carriers")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete carrier")
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const updateRuleset = (fn: (r: Ruleset) => Ruleset) => {
    setData((prev) => ({ ...prev, ruleset: fn(prev.ruleset) }))
    setDirty(true)
  }

  const addQuestion = (scorecard: "DA" | "FA") => {
    const key = scorecard === "DA" ? "da_questions" : "fa_questions"
    const section = scorecard === "DA" ? "da" : "fa"
    updateRuleset((r) => ({
      ...r,
      [key]: [
        ...r[key],
        {
          id: `${section}_new_${Date.now()}`,
          text: "",
          weight: 5,
          section,
          scorecard,
          categoryKey: "",
          categoryName: "",
        },
      ],
    }))
  }

  const removeQuestion = (scorecard: "DA" | "FA", idx: number) => {
    const key = scorecard === "DA" ? "da_questions" : "fa_questions"
    updateRuleset((r) => ({ ...r, [key]: r[key].filter((_, i) => i !== idx) }))
  }

  const updateQuestion = (scorecard: "DA" | "FA", idx: number, field: keyof Question, value: string | number | undefined) => {
    const key = scorecard === "DA" ? "da_questions" : "fa_questions"
    updateRuleset((r) => ({
      ...r,
      [key]: r[key].map((q, i) => (i === idx ? { ...q, [field]: value } : q)),
    }))
  }

  const addCategory = () => {
    updateRuleset((r) => ({
      ...r,
      scorecard_categories: [
        ...r.scorecard_categories,
        { id: `cat_${Date.now()}`, label: "", max_score: 5 },
      ],
    }))
  }

  const removeCategory = (idx: number) => {
    updateRuleset((r) => ({
      ...r,
      scorecard_categories: r.scorecard_categories.filter((_, i) => i !== idx),
    }))
  }

  const updateCategory = (idx: number, field: keyof ScorecardCategory, value: string | number) => {
    updateRuleset((r) => ({
      ...r,
      scorecard_categories: r.scorecard_categories.map((c, i) =>
        i === idx ? { ...c, [field]: value } : c
      ),
    }))
  }

  const [codeContentDirty, setCodeContentDirty] = useState(false)

  const switchToCodeMode = () => {
    if (!codeContentDirty) {
      setCodeContent(JSON.stringify(data.ruleset, null, 2))
    }
    setCodeErrors([])
    setCodeParsed(false)
    setEditorMode("code")
  }

  const switchToFormMode = () => {
    setEditorMode("form")
  }

  const handleSyncFromForm = () => {
    setCodeContent(JSON.stringify(data.ruleset, null, 2))
    setCodeContentDirty(false)
    setCodeErrors([])
    setCodeParsed(false)
  }

  const handleParseAndApply = () => {
    setCodeErrors([])
    setCodeParsed(false)
    const { ruleset, errors } = parseRulesetFromCode(codeContent)

    const hasData = ruleset.da_questions.length > 0 || ruleset.fa_questions.length > 0 || ruleset.scorecard_categories.length > 0

    if (!hasData) {
      setCodeErrors(errors.length > 0 ? errors : ["No questions or categories were found in the parsed content."])
      return
    }

    if (errors.length > 0) {
      setCodeErrors([...errors, "Fix the issues above and try again, or the valid portions have been loaded (switch to Form to review)."])
    }

    setData((prev) => ({ ...prev, ruleset }))
    setDirty(true)
    setCodeParsed(true)
    setCodeContentDirty(false)
  }

  if (loading) {
    return (
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Loading...</h1>
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
          <button
            onClick={() => setLocation("/carriers")}
            className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
            style={{ color: BRAND.purpleSecondary }}
          >
            <NavArrowLeft width={20} height={20} />
          </button>
          <h1 className="text-base md:text-lg font-bold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            {isNew ? "New Carrier" : data.displayName}
          </h1>
          {!isNew && (
            <Badge
              className="shadow-none border-transparent text-[10px] px-1.5 py-0 hidden sm:inline-flex"
              style={{
                backgroundColor: data.active ? "#dcfce7" : "#fee2e2",
                color: data.active ? "#16a34a" : "#dc2626",
              }}
            >
              {data.active ? "Active" : "Inactive"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs md:text-sm"
              style={{ borderColor: "#fecaca", color: "#dc2626" }}
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash width={14} height={14} />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
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
        <div className="max-w-4xl mx-auto space-y-4">
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

          <CollapsibleSection title="Basic Info" expanded={expandedSections.basic} onToggle={() => toggleSection("basic")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: BRAND.purpleSecondary }}>Display Name</label>
                <input
                  className="w-full rounded-lg border p-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.offWhite }}
                  value={data.displayName}
                  onChange={(e) => { setData((d) => ({ ...d, displayName: e.target.value })); setDirty(true) }}
                  placeholder="e.g. Allstate"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: BRAND.purpleSecondary }}>Logo URL</label>
                <input
                  className="w-full rounded-lg border p-2.5 text-sm focus:outline-none focus:ring-2"
                  style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.offWhite }}
                  value={data.logoUrl}
                  onChange={(e) => { setData((d) => ({ ...d, logoUrl: e.target.value })); setDirty(true) }}
                  placeholder="https://..."
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <label className="text-xs font-medium" style={{ color: BRAND.purpleSecondary }}>Active</label>
                <button
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ backgroundColor: data.active ? BRAND.purple : BRAND.greyLavender }}
                  onClick={() => { setData((d) => ({ ...d, active: !d.active })); setDirty(true) }}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                    style={{ left: data.active ? 22 : 2 }}
                  />
                </button>
              </div>
              {!isNew && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium mb-1" style={{ color: BRAND.purpleSecondary }}>Carrier Key</label>
                  <input
                    className="w-full rounded-lg border p-2.5 text-sm cursor-not-allowed"
                    style={{ borderColor: BRAND.greyLavender, color: BRAND.purpleSecondary, backgroundColor: "#f5f3f7" }}
                    value={data.carrierKey}
                    readOnly
                  />
                </div>
              )}
            </div>
          </CollapsibleSection>

          <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  Ruleset Configuration
                </CardTitle>
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: BRAND.greyLavender }}>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: editorMode === "form" ? BRAND.purple : "transparent",
                      color: editorMode === "form" ? "#fff" : BRAND.purpleSecondary,
                    }}
                    onClick={switchToFormMode}
                  >
                    <ListSelect width={14} height={14} />
                    Form
                  </button>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: editorMode === "code" ? BRAND.purple : "transparent",
                      color: editorMode === "code" ? "#fff" : BRAND.purpleSecondary,
                      borderLeft: `1px solid ${BRAND.greyLavender}`,
                    }}
                    onClick={switchToCodeMode}
                  >
                    <Code width={14} height={14} />
                    Code
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {editorMode === "form" ? (
                <div className="text-xs mb-2 flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
                  <Sparks width={14} height={14} />
                  Use the form fields below to edit individual ruleset fields, or switch to Code mode to paste a complete ruleset.
                </div>
              ) : (
                <div className="text-xs mb-2 flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
                  <Code width={14} height={14} />
                  Paste a complete JSON ruleset or a TypeScript ruleset object. Click "Parse & Apply" to validate and load.
                </div>
              )}
            </CardContent>
          </Card>

          {editorMode === "code" ? (
            <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
              <CardContent className="pt-4">
                {codeErrors.length > 0 && (
                  <div className="mb-3 rounded-lg border p-3 space-y-1" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca" }}>
                    {codeErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "#dc2626" }}>
                        <WarningTriangle width={12} height={12} className="shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}
                {codeParsed && codeErrors.length === 0 && (
                  <div className="mb-3 flex items-center gap-2 p-3 rounded-lg border" style={{ backgroundColor: "#f0fdf4", borderColor: "#bbf7d0", color: "#16a34a" }}>
                    <Sparks width={14} height={14} />
                    <span className="text-xs">
                      Ruleset parsed successfully — {data.ruleset.da_questions.length} DA questions, {data.ruleset.fa_questions.length} FA questions, {data.ruleset.scorecard_categories.length} categories loaded. Switch to Form view to review, or save directly.
                    </span>
                  </div>
                )}
                {codeParsed && codeErrors.length > 0 && (
                  <div className="mb-3 flex items-center gap-2 p-3 rounded-lg border" style={{ backgroundColor: "#fffbeb", borderColor: "#fde68a", color: "#b45309" }}>
                    <WarningTriangle width={14} height={14} />
                    <span className="text-xs">
                      Partially parsed — {data.ruleset.da_questions.length} DA questions, {data.ruleset.fa_questions.length} FA questions, {data.ruleset.scorecard_categories.length} categories loaded with warnings above.
                    </span>
                  </div>
                )}
                <textarea
                  className="w-full rounded-lg border p-4 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2"
                  style={{
                    borderColor: BRAND.greyLavender,
                    fontFamily: FONTS.mono,
                    fontSize: "12px",
                    lineHeight: "1.6",
                    minHeight: "500px",
                    color: BRAND.deepPurple,
                    backgroundColor: BRAND.offWhite,
                    tabSize: 2,
                  }}
                  value={codeContent}
                  onChange={(e) => { setCodeContent(e.target.value); setCodeParsed(false); setCodeContentDirty(true) }}
                  placeholder={`Paste your ruleset JSON or TypeScript object here...\n\nExample:\n{\n  "version": "1.0",\n  "da_questions": [...],\n  "fa_questions": [...],\n  "scorecard_categories": [...],\n  "system_prompt_override": "...",\n  "carrier_scorecard_prompt_override": "..."\n}`}
                  spellCheck={false}
                />
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs text-white"
                    style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
                    onClick={handleParseAndApply}
                  >
                    <Sparks width={14} height={14} />
                    Parse & Apply
                  </Button>
                  {codeContentDirty && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.purpleSecondary }}
                      onClick={handleSyncFromForm}
                    >
                      Reset to Current Ruleset
                    </Button>
                  )}
                  <span className="text-[10px]" style={{ color: BRAND.purpleSecondary }}>
                    Accepts JSON or TypeScript objects (interface declarations, type annotations, export const, and "as const" are stripped automatically)
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <CollapsibleSection title="System Prompt Override" expanded={expandedSections.prompt} onToggle={() => toggleSection("prompt")} badge={data.ruleset.system_prompt_override ? "Custom" : "Default"}>
                <div className="mb-2 flex items-center gap-2 p-2 rounded-md" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                  <WarningTriangle width={14} height={14} style={{ color: BRAND.purple }} />
                  <span className="text-xs" style={{ color: BRAND.purple }}>
                    Leave empty to use the global system prompt. Only fill this in for carrier-specific overrides.
                  </span>
                </div>
                <textarea
                  className="w-full rounded-lg border p-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2"
                  style={{
                    borderColor: BRAND.greyLavender,
                    fontFamily: FONTS.mono,
                    fontSize: "13px",
                    minHeight: "200px",
                    color: BRAND.deepPurple,
                    backgroundColor: BRAND.offWhite,
                  }}
                  value={data.ruleset.system_prompt_override || ""}
                  onChange={(e) => updateRuleset((r) => ({ ...r, system_prompt_override: e.target.value || undefined }))}
                  placeholder="Leave empty to use global default..."
                />
                <div className="mt-3">
                  <label className="block text-xs font-medium mb-1" style={{ color: BRAND.purpleSecondary }}>Scorecard Prompt Override</label>
                  <textarea
                    className="w-full rounded-lg border p-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2"
                    style={{
                      borderColor: BRAND.greyLavender,
                      fontFamily: FONTS.mono,
                      fontSize: "13px",
                      minHeight: "120px",
                      color: BRAND.deepPurple,
                      backgroundColor: BRAND.offWhite,
                    }}
                    value={data.ruleset.carrier_scorecard_prompt_override || ""}
                    onChange={(e) => updateRuleset((r) => ({ ...r, carrier_scorecard_prompt_override: e.target.value || undefined }))}
                    placeholder="Leave empty to use default scorecard prompt..."
                  />
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                title="DA Questions"
                expanded={expandedSections.da}
                onToggle={() => toggleSection("da")}
                badge={`${data.ruleset.da_questions.length}`}
              >
                <QuestionsEditor
                  questions={data.ruleset.da_questions}
                  scorecard="DA"
                  onAdd={() => addQuestion("DA")}
                  onRemove={(idx) => removeQuestion("DA", idx)}
                  onUpdate={(idx, field, value) => updateQuestion("DA", idx, field, value)}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="FA Questions"
                expanded={expandedSections.fa}
                onToggle={() => toggleSection("fa")}
                badge={`${data.ruleset.fa_questions.length}`}
              >
                <QuestionsEditor
                  questions={data.ruleset.fa_questions}
                  scorecard="FA"
                  onAdd={() => addQuestion("FA")}
                  onRemove={(idx) => removeQuestion("FA", idx)}
                  onUpdate={(idx, field, value) => updateQuestion("FA", idx, field, value)}
                />
              </CollapsibleSection>

              <CollapsibleSection
                title="Scorecard Categories"
                expanded={expandedSections.categories}
                onToggle={() => toggleSection("categories")}
                badge={`${data.ruleset.scorecard_categories.length}`}
              >
                <CategoriesEditor
                  categories={data.ruleset.scorecard_categories}
                  onAdd={addCategory}
                  onRemove={removeCategory}
                  onUpdate={updateCategory}
                />
              </CollapsibleSection>
            </>
          )}

          <div className="h-8" />
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="bg-white rounded-xl shadow-xl p-6 mx-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              Delete Carrier
            </h3>
            <p className="text-sm mb-4" style={{ color: BRAND.purpleSecondary }}>
              Are you sure you want to delete <strong>{data.displayName}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                style={{ borderColor: BRAND.greyLavender }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-white"
                style={{ backgroundColor: "#dc2626" }}
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  badge,
  children,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  badge?: string
  children: React.ReactNode
}) {
  return (
    <Card className="shadow-sm" style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}>
      <CardHeader className="pb-0 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
            <span className="text-xs transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
            {title}
          </CardTitle>
          {badge && (
            <Badge className="shadow-none border-transparent text-[10px]" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
              {badge}
            </Badge>
          )}
        </div>
      </CardHeader>
      {expanded && <CardContent className="pt-4">{children}</CardContent>}
    </Card>
  )
}

function QuestionsEditor({
  questions,
  scorecard,
  onAdd,
  onRemove,
  onUpdate,
}: {
  questions: Question[]
  scorecard: "DA" | "FA"
  onAdd: () => void
  onRemove: (idx: number) => void
  onUpdate: (idx: number, field: keyof Question, value: string | number | undefined) => void
}) {
  return (
    <div className="space-y-3">
      {questions.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: BRAND.purpleSecondary }}>No {scorecard} questions configured.</p>
      )}
      {questions.map((q, idx) => (
        <div
          key={`${q.id}-${idx}`}
          className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.offWhite }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Question Text</label>
              <textarea
                className="w-full rounded border p-2 text-xs resize-y focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, minHeight: 50, backgroundColor: BRAND.white }}
                value={q.text}
                onChange={(e) => onUpdate(idx, "text", e.target.value)}
              />
            </div>
            <button
              className="p-1.5 rounded transition-colors hover:bg-red-50 shrink-0 mt-3"
              style={{ color: "#dc2626" }}
              onClick={() => onRemove(idx)}
              title="Remove question"
            >
              <Trash width={14} height={14} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>ID</label>
              <input
                className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono, backgroundColor: BRAND.white }}
                value={q.id}
                onChange={(e) => onUpdate(idx, "id", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Weight</label>
              <input
                type="number"
                className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
                value={q.weight}
                min={0}
                max={100}
                onChange={(e) => onUpdate(idx, "weight", parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Weight (No Denial)</label>
              <input
                type="number"
                className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
                value={q.weightIfNoDenial ?? ""}
                placeholder="—"
                min={0}
                max={100}
                onChange={(e) => {
                  const v = e.target.value
                  onUpdate(idx, "weightIfNoDenial", v === "" ? undefined : parseInt(v) || 0)
                }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Category Key</label>
              <input
                className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono, backgroundColor: BRAND.white }}
                value={q.categoryKey}
                onChange={(e) => onUpdate(idx, "categoryKey", e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Category Name</label>
            <input
              className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
              value={q.categoryName}
              onChange={(e) => onUpdate(idx, "categoryName", e.target.value)}
            />
          </div>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 text-xs"
        style={{ borderColor: BRAND.greyLavender, color: BRAND.purple, borderStyle: "dashed" }}
        onClick={onAdd}
      >
        <Plus width={14} height={14} />
        Add {scorecard} Question
      </Button>
    </div>
  )
}

function CategoriesEditor({
  categories,
  onAdd,
  onRemove,
  onUpdate,
}: {
  categories: ScorecardCategory[]
  onAdd: () => void
  onRemove: (idx: number) => void
  onUpdate: (idx: number, field: keyof ScorecardCategory, value: string | number) => void
}) {
  return (
    <div className="space-y-2">
      {categories.length === 0 && (
        <p className="text-xs text-center py-4" style={{ color: BRAND.purpleSecondary }}>No categories configured.</p>
      )}
      {categories.map((c, idx) => (
        <div
          key={`${c.id}-${idx}`}
          className="rounded-lg border p-3 flex items-center gap-3 flex-wrap"
          style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.offWhite }}
        >
          <div className="flex-1 min-w-[120px]">
            <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>ID</label>
            <input
              className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono, backgroundColor: BRAND.white }}
              value={c.id}
              onChange={(e) => onUpdate(idx, "id", e.target.value)}
            />
          </div>
          <div className="flex-[2] min-w-[160px]">
            <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Label</label>
            <input
              className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
              value={c.label}
              onChange={(e) => onUpdate(idx, "label", e.target.value)}
            />
          </div>
          <div className="w-20">
            <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Max Score</label>
            <input
              type="number"
              className="w-full rounded border p-1.5 text-xs focus:outline-none focus:ring-1"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
              value={c.max_score}
              min={1}
              onChange={(e) => onUpdate(idx, "max_score", parseInt(e.target.value) || 1)}
            />
          </div>
          <button
            className="p-1.5 rounded transition-colors hover:bg-red-50 self-end mb-0.5"
            style={{ color: "#dc2626" }}
            onClick={() => onRemove(idx)}
            title="Remove category"
          >
            <Trash width={14} height={14} />
          </button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1 text-xs"
        style={{ borderColor: BRAND.greyLavender, color: BRAND.purple, borderStyle: "dashed" }}
        onClick={onAdd}
      >
        <Plus width={14} height={14} />
        Add Category
      </Button>
    </div>
  )
}
