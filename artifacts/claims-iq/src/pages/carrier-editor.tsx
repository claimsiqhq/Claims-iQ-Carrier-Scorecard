import { useState, useEffect, useCallback } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useLocation } from "wouter"
import { NavArrowLeft, FloppyDisk, Plus, Trash, Sparks, WarningTriangle, Code, ListSelect, Settings } from "iconoir-react"

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

  const daWeightSum = data.ruleset.da_questions.reduce((s, q) => s + q.weight, 0)
  const faWeightSum = data.ruleset.fa_questions.reduce((s, q) => s + q.weight, 0)

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
      <header
        className="shrink-0 px-4 md:px-6 py-3"
        style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button
              onClick={() => setLocation("/carriers")}
              className="p-1.5 rounded-lg transition-colors hover:bg-black/5 shrink-0"
              style={{ color: BRAND.purpleSecondary }}
            >
              <NavArrowLeft width={20} height={20} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base md:text-lg font-bold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  {isNew ? "New Carrier" : data.displayName}
                </h1>
                {!isNew && (
                  <Badge
                    className="shadow-none border-transparent text-[10px] px-1.5 py-0 shrink-0"
                    style={{
                      backgroundColor: data.active ? "#dcfce7" : "#fee2e2",
                      color: data.active ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {data.active ? "Active" : "Inactive"}
                  </Badge>
                )}
              </div>
              {!isNew && (
                <span className="text-[11px] block mt-0.5" style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}>
                  {data.carrierKey} &middot; v{data.ruleset.version}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isNew && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 text-xs"
                style={{ borderColor: "#fecaca", color: "#dc2626" }}
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash width={14} height={14} />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            )}
            <Button
              size="sm"
              className="gap-1.5 text-xs text-white"
              style={{
                backgroundColor: dirty ? BRAND.purple : BRAND.purpleSecondary,
                fontFamily: FONTS.heading,
                fontWeight: 600,
              }}
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              <FloppyDisk width={15} height={15} />
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#F7F5FA" }}>
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>
              <WarningTriangle width={15} height={15} className="shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a" }}>
              <Sparks width={15} height={15} className="shrink-0" />
              {success}
            </div>
          )}

          <section className="rounded-xl overflow-hidden" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}` }}>
            <SectionHeader
              title="Basic Info"
              icon={<Settings width={15} height={15} />}
              expanded={expandedSections.basic}
              onToggle={() => toggleSection("basic")}
            />
            {expandedSections.basic && (
              <div className="px-5 pb-5 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Display Name">
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}
                      value={data.displayName}
                      onChange={(e) => { setData((d) => ({ ...d, displayName: e.target.value })); setDirty(true) }}
                      placeholder="e.g. Allstate"
                    />
                  </FormField>
                  <FormField label="Logo URL">
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow"
                      style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple }}
                      value={data.logoUrl}
                      onChange={(e) => { setData((d) => ({ ...d, logoUrl: e.target.value })); setDirty(true) }}
                      placeholder="https://..."
                    />
                  </FormField>
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <label className="text-xs font-medium" style={{ color: BRAND.purpleSecondary }}>Active</label>
                  <button
                    className="relative w-10 h-[22px] rounded-full transition-colors"
                    style={{ backgroundColor: data.active ? BRAND.purple : BRAND.greyLavender }}
                    onClick={() => { setData((d) => ({ ...d, active: !d.active })); setDirty(true) }}
                  >
                    <div
                      className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform"
                      style={{ left: data.active ? 22 : 3 }}
                    />
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-xl overflow-hidden" style={{ backgroundColor: BRAND.white, border: `1px solid ${BRAND.greyLavender}` }}>
            <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: `1px solid ${BRAND.greyLavender}` }}>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
                  <Code width={14} height={14} style={{ color: BRAND.purple }} />
                </div>
                <span className="text-sm font-semibold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                  Ruleset
                </span>
                <Badge className="shadow-none border-transparent text-[10px]" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
                  v{data.ruleset.version}
                </Badge>
              </div>
              <div className="flex items-center rounded-lg p-0.5" style={{ backgroundColor: BRAND.offWhite }}>
                <button
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: editorMode === "form" ? BRAND.white : "transparent",
                    color: editorMode === "form" ? BRAND.deepPurple : BRAND.purpleSecondary,
                    boxShadow: editorMode === "form" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  }}
                  onClick={switchToFormMode}
                >
                  <ListSelect width={12} height={12} />
                  Form
                </button>
                <button
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                  style={{
                    backgroundColor: editorMode === "code" ? BRAND.white : "transparent",
                    color: editorMode === "code" ? BRAND.deepPurple : BRAND.purpleSecondary,
                    boxShadow: editorMode === "code" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  }}
                  onClick={switchToCodeMode}
                >
                  <Code width={12} height={12} />
                  Code
                </button>
              </div>
            </div>

            {editorMode === "code" ? (
              <div className="p-5">
                {codeErrors.length > 0 && (
                  <div className="mb-4 rounded-lg border p-3 space-y-1" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca" }}>
                    {codeErrors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs" style={{ color: "#dc2626" }}>
                        <WarningTriangle width={12} height={12} className="shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}
                {codeParsed && codeErrors.length === 0 && (
                  <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs" style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a" }}>
                    <Sparks width={14} height={14} />
                    Parsed {data.ruleset.da_questions.length} DA + {data.ruleset.fa_questions.length} FA questions, {data.ruleset.scorecard_categories.length} categories.
                  </div>
                )}
                {codeParsed && codeErrors.length > 0 && (
                  <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs" style={{ backgroundColor: "#fffbeb", border: "1px solid #fde68a", color: "#b45309" }}>
                    <WarningTriangle width={14} height={14} />
                    Partial: {data.ruleset.da_questions.length} DA + {data.ruleset.fa_questions.length} FA questions, {data.ruleset.scorecard_categories.length} categories with warnings.
                  </div>
                )}
                <textarea
                  className="w-full rounded-lg border p-4 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow"
                  style={{
                    borderColor: BRAND.greyLavender,
                    fontFamily: FONTS.mono,
                    fontSize: "12px",
                    lineHeight: "1.6",
                    minHeight: "420px",
                    color: BRAND.deepPurple,
                    backgroundColor: "#FAFAFE",
                    tabSize: 2,
                  }}
                  value={codeContent}
                  onChange={(e) => { setCodeContent(e.target.value); setCodeParsed(false); setCodeContentDirty(true) }}
                  placeholder={`Paste your ruleset JSON or TypeScript object here...\n\nExample:\n{\n  "version": "1.0",\n  "da_questions": [...],\n  "fa_questions": [...],\n  "scorecard_categories": [...]\n}`}
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
                      Reset
                    </Button>
                  )}
                  <span className="text-[10px] ml-1" style={{ color: BRAND.purpleSecondary }}>
                    Accepts JSON or TypeScript objects
                  </span>
                </div>
              </div>
            ) : (
              <div>
                <InnerSection
                  title="System Prompt"
                  badge={data.ruleset.system_prompt_override ? "Custom" : "Default"}
                  badgeColor={data.ruleset.system_prompt_override ? BRAND.purple : BRAND.purpleSecondary}
                  expanded={expandedSections.prompt}
                  onToggle={() => toggleSection("prompt")}
                  borderTop={false}
                >
                  <FormField label="System Prompt Override" hint="Leave empty to use the global default prompt.">
                    <textarea
                      className="w-full rounded-lg border px-3 py-2.5 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow"
                      style={{
                        borderColor: BRAND.greyLavender,
                        fontFamily: FONTS.mono,
                        minHeight: "160px",
                        color: BRAND.deepPurple,
                      }}
                      value={data.ruleset.system_prompt_override || ""}
                      onChange={(e) => updateRuleset((r) => ({ ...r, system_prompt_override: e.target.value || undefined }))}
                      placeholder="Leave empty to use global default..."
                    />
                  </FormField>
                  <div className="mt-3">
                    <FormField label="Scorecard Prompt Override" hint="Leave empty to use the default scorecard prompt.">
                      <textarea
                        className="w-full rounded-lg border px-3 py-2.5 text-xs leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 transition-shadow"
                        style={{
                          borderColor: BRAND.greyLavender,
                          fontFamily: FONTS.mono,
                          minHeight: "100px",
                          color: BRAND.deepPurple,
                        }}
                        value={data.ruleset.carrier_scorecard_prompt_override || ""}
                        onChange={(e) => updateRuleset((r) => ({ ...r, carrier_scorecard_prompt_override: e.target.value || undefined }))}
                        placeholder="Leave empty to use default scorecard prompt..."
                      />
                    </FormField>
                  </div>
                </InnerSection>

                <InnerSection
                  title="DA Questions"
                  badge={`${data.ruleset.da_questions.length}`}
                  stat={`${daWeightSum} pts`}
                  expanded={expandedSections.da}
                  onToggle={() => toggleSection("da")}
                >
                  <QuestionsEditor
                    questions={data.ruleset.da_questions}
                    scorecard="DA"
                    onAdd={() => addQuestion("DA")}
                    onRemove={(idx) => removeQuestion("DA", idx)}
                    onUpdate={(idx, field, value) => updateQuestion("DA", idx, field, value)}
                  />
                </InnerSection>

                <InnerSection
                  title="FA Questions"
                  badge={`${data.ruleset.fa_questions.length}`}
                  stat={`${faWeightSum} pts`}
                  expanded={expandedSections.fa}
                  onToggle={() => toggleSection("fa")}
                >
                  <QuestionsEditor
                    questions={data.ruleset.fa_questions}
                    scorecard="FA"
                    onAdd={() => addQuestion("FA")}
                    onRemove={(idx) => removeQuestion("FA", idx)}
                    onUpdate={(idx, field, value) => updateQuestion("FA", idx, field, value)}
                  />
                </InnerSection>

                <InnerSection
                  title="Scorecard Categories"
                  badge={`${data.ruleset.scorecard_categories.length}`}
                  expanded={expandedSections.categories}
                  onToggle={() => toggleSection("categories")}
                >
                  <CategoriesEditor
                    categories={data.ruleset.scorecard_categories}
                    onAdd={addCategory}
                    onRemove={removeCategory}
                    onUpdate={updateCategory}
                  />
                </InnerSection>
              </div>
            )}
          </section>

          <div className="h-4" />
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="bg-white rounded-xl shadow-2xl p-6 mx-4 max-w-sm w-full"
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

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: BRAND.deepPurple }}>
        {label}
      </label>
      {hint && (
        <p className="text-[11px] mb-1.5" style={{ color: BRAND.purpleSecondary }}>{hint}</p>
      )}
      {children}
    </div>
  )
}

function SectionHeader({
  title,
  icon,
  expanded,
  onToggle,
}: {
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: expanded ? `1px solid ${BRAND.greyLavender}` : "none" }}
      onClick={onToggle}
    >
      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: BRAND.lightPurpleGrey }}>
        <span style={{ color: BRAND.purple }}>{icon}</span>
      </div>
      <span className="text-sm font-semibold flex-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
        {title}
      </span>
      <svg
        width="16" height="16" viewBox="0 0 16 16" fill="none"
        className="transition-transform shrink-0"
        style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)", color: BRAND.purpleSecondary }}
      >
        <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function InnerSection({
  title,
  badge,
  badgeColor,
  stat,
  expanded,
  onToggle,
  borderTop = true,
  children,
}: {
  title: string
  badge?: string
  badgeColor?: string
  stat?: string
  expanded: boolean
  onToggle: () => void
  borderTop?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ borderTop: borderTop ? `1px solid ${BRAND.greyLavender}` : "none" }}>
      <button
        className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.02]"
        onClick={onToggle}
      >
        <svg
          width="14" height="14" viewBox="0 0 16 16" fill="none"
          className="transition-transform shrink-0"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", color: BRAND.purpleSecondary }}
        >
          <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[13px] font-semibold flex-1" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
          {title}
        </span>
        {stat && (
          <span className="text-[11px] font-medium" style={{ color: BRAND.purpleSecondary }}>
            {stat}
          </span>
        )}
        {badge && (
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: BRAND.lightPurpleGrey, color: badgeColor || BRAND.purple }}
          >
            {badge}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-5 pb-5 pt-1">{children}</div>
      )}
    </div>
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
    <div className="space-y-2.5">
      {questions.length === 0 && (
        <p className="text-xs text-center py-6" style={{ color: BRAND.purpleSecondary }}>No {scorecard} questions configured.</p>
      )}
      {questions.map((q, idx) => (
        <div
          key={`${q.id}-${idx}`}
          className="rounded-lg border p-3 space-y-2.5 transition-colors"
          style={{ borderColor: BRAND.greyLavender, backgroundColor: "#FAFAFE" }}
        >
          <div className="flex items-start gap-2">
            <span className="text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
              {idx + 1}
            </span>
            <div className="flex-1 min-w-0">
              <textarea
                className="w-full rounded border px-2.5 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, minHeight: 44, backgroundColor: BRAND.white }}
                value={q.text}
                onChange={(e) => onUpdate(idx, "text", e.target.value)}
                placeholder="Question text..."
              />
            </div>
            <button
              className="p-1 rounded transition-colors hover:bg-red-50 shrink-0"
              style={{ color: "#dc2626" }}
              onClick={() => onRemove(idx)}
              title="Remove question"
            >
              <Trash width={13} height={13} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pl-7">
            <div className="sm:col-span-2">
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>ID</label>
              <input
                className="w-full rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono, backgroundColor: BRAND.white }}
                value={q.id}
                onChange={(e) => onUpdate(idx, "id", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Weight</label>
              <input
                type="number"
                className="w-full rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
                value={q.weight}
                min={0}
                max={100}
                onChange={(e) => onUpdate(idx, "weight", parseInt(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>No-Denial</label>
              <input
                type="number"
                className="w-full rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
                value={q.weightIfNoDenial ?? ""}
                placeholder="--"
                min={0}
                max={100}
                onChange={(e) => {
                  const v = e.target.value
                  onUpdate(idx, "weightIfNoDenial", v === "" ? undefined : parseInt(v) || 0)
                }}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Category</label>
              <input
                className="w-full rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, fontFamily: FONTS.mono, backgroundColor: BRAND.white }}
                value={q.categoryKey}
                onChange={(e) => onUpdate(idx, "categoryKey", e.target.value)}
              />
            </div>
          </div>
          <div className="pl-7">
            <label className="block text-[10px] font-medium mb-0.5" style={{ color: BRAND.purpleSecondary }}>Category Name</label>
            <input
              className="w-full rounded border px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-purple-300"
              style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
              value={q.categoryName}
              onChange={(e) => onUpdate(idx, "categoryName", e.target.value)}
            />
          </div>
        </div>
      ))}

      <button
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed text-xs font-medium transition-colors hover:bg-purple-50"
        style={{ borderColor: BRAND.greyLavender, color: BRAND.purple }}
        onClick={onAdd}
      >
        <Plus width={14} height={14} />
        Add {scorecard} Question
      </button>
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
        <p className="text-xs text-center py-6" style={{ color: BRAND.purpleSecondary }}>No categories configured.</p>
      )}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: BRAND.greyLavender }}>
        {categories.map((c, idx) => (
          <div
            key={`${c.id}-${idx}`}
            className="flex items-center gap-3 px-3 py-2.5"
            style={{
              backgroundColor: idx % 2 === 0 ? "#FAFAFE" : BRAND.white,
              borderTop: idx > 0 ? `1px solid ${BRAND.greyLavender}` : "none",
            }}
          >
            <div className="flex-1 min-w-0">
              <input
                className="w-full bg-transparent text-xs font-medium focus:outline-none"
                style={{ color: BRAND.deepPurple }}
                value={c.label}
                onChange={(e) => onUpdate(idx, "label", e.target.value)}
                placeholder="Category label..."
              />
              <input
                className="w-full bg-transparent text-[10px] mt-0.5 focus:outline-none"
                style={{ color: BRAND.purpleSecondary, fontFamily: FONTS.mono }}
                value={c.id}
                onChange={(e) => onUpdate(idx, "id", e.target.value)}
                placeholder="category_key"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                className="w-14 rounded border px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-purple-300"
                style={{ borderColor: BRAND.greyLavender, color: BRAND.deepPurple, backgroundColor: BRAND.white }}
                value={c.max_score}
                min={1}
                onChange={(e) => onUpdate(idx, "max_score", parseInt(e.target.value) || 1)}
              />
              <span className="text-[10px]" style={{ color: BRAND.purpleSecondary }}>pts</span>
              <button
                className="p-1 rounded transition-colors hover:bg-red-50 ml-1"
                style={{ color: "#dc2626" }}
                onClick={() => onRemove(idx)}
                title="Remove category"
              >
                <Trash width={13} height={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border-2 border-dashed text-xs font-medium transition-colors hover:bg-purple-50"
        style={{ borderColor: BRAND.greyLavender, color: BRAND.purple }}
        onClick={onAdd}
      >
        <Plus width={14} height={14} />
        Add Category
      </button>
    </div>
  )
}
