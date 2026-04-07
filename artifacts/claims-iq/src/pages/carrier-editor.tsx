import { useState, useEffect, useCallback } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocation } from "wouter"
import { NavArrowLeft, FloppyDisk, Plus, Trash, Sparks, WarningTriangle } from "iconoir-react"

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
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    basic: true,
    prompt: false,
    da: false,
    fa: false,
    categories: false,
  })

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
    } catch (err: any) {
      setError(err.message)
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
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
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
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
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

  const updateQuestion = (scorecard: "DA" | "FA", idx: number, field: keyof Question, value: any) => {
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

  const updateCategory = (idx: number, field: keyof ScorecardCategory, value: any) => {
    updateRuleset((r) => ({
      ...r,
      scorecard_categories: r.scorecard_categories.map((c, i) =>
        i === idx ? { ...c, [field]: value } : c
      ),
    }))
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

          <div className="h-8" />
        </div>
      </div>
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
  onUpdate: (idx: number, field: keyof Question, value: any) => void
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
  onUpdate: (idx: number, field: keyof ScorecardCategory, value: any) => void
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
