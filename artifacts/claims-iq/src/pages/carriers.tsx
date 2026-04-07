import { useState, useEffect, useCallback } from "react"
import { BRAND, FONTS } from "@/lib/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useLocation } from "wouter"
import { Plus, Trash, EditPencil, WarningTriangle } from "iconoir-react"

interface CarrierRow {
  id: string
  carrierKey: string
  displayName: string
  logoUrl: string | null
  active: boolean
  ruleset: any
  createdAt: string
  updatedAt: string
}

export default function CarriersPage() {
  const [carriers, setCarriers] = useState<CarrierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [, setLocation] = useLocation()

  const baseUrl = import.meta.env.VITE_API_URL || "/api"

  const fetchCarriers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${baseUrl}/carriers/all`, { credentials: "include" })
      if (!res.ok) throw new Error("Failed to load carriers")
      const data = await res.json()
      setCarriers(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [baseUrl])

  useEffect(() => {
    fetchCarriers()
  }, [fetchCarriers])

  const handleDelete = async (key: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`${baseUrl}/carriers/${key}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to delete carrier")
      }
      setDeleteConfirm(null)
      fetchCarriers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const getQuestionCount = (ruleset: any, type: "da" | "fa") => {
    const key = type === "da" ? "da_questions" : "fa_questions"
    return Array.isArray(ruleset?.[key]) ? ruleset[key].length : 0
  }

  const getCategoryCount = (ruleset: any) => {
    return Array.isArray(ruleset?.scorecard_categories) ? ruleset.scorecard_categories.length : 0
  }

  if (loading) {
    return (
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 md:h-16 flex items-center px-4 md:px-6 shrink-0" style={{ backgroundColor: BRAND.white, borderBottom: `1px solid ${BRAND.greyLavender}` }}>
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carriers</h1>
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
          <h1 className="text-base md:text-lg font-bold" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>Carriers</h1>
          <Badge className="shadow-none border-transparent text-xs hidden sm:inline-flex" style={{ backgroundColor: BRAND.lightPurpleGrey, color: BRAND.purple }}>
            {carriers.length} total
          </Badge>
        </div>
        <Button
          size="sm"
          className="gap-1 md:gap-2 text-xs md:text-sm text-white"
          style={{ backgroundColor: BRAND.purple, fontFamily: FONTS.heading, fontWeight: 600 }}
          onClick={() => setLocation("/carriers/new")}
        >
          <Plus width={16} height={16} />
          <span className="hidden sm:inline">Add Carrier</span>
          <span className="sm:hidden">Add</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6" style={{ backgroundColor: BRAND.offWhite }}>
        <div className="max-w-4xl mx-auto space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg border" style={{ backgroundColor: "#fef2f2", borderColor: "#fecaca", color: "#dc2626" }}>
              <WarningTriangle width={16} height={16} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {carriers.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: BRAND.purpleSecondary }}>No carriers configured yet.</p>
              <Button
                size="sm"
                className="mt-4 gap-2 text-white"
                style={{ backgroundColor: BRAND.purple }}
                onClick={() => setLocation("/carriers/new")}
              >
                <Plus width={16} height={16} />
                Add Your First Carrier
              </Button>
            </div>
          )}

          {carriers.map((carrier) => (
            <Card
              key={carrier.carrierKey}
              className="shadow-sm transition-colors hover:shadow-md cursor-pointer"
              style={{ borderColor: BRAND.greyLavender, backgroundColor: BRAND.white }}
              onClick={() => setLocation(`/carriers/${carrier.carrierKey}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {carrier.logoUrl ? (
                      <img src={carrier.logoUrl} alt="" className="w-8 h-8 rounded object-contain shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ backgroundColor: BRAND.purple }}>
                        {carrier.displayName[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
                          {carrier.displayName}
                        </span>
                        <Badge
                          className="shadow-none border-transparent text-[10px] px-1.5 py-0"
                          style={{
                            backgroundColor: carrier.active ? "#dcfce7" : "#fee2e2",
                            color: carrier.active ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {carrier.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                          {getQuestionCount(carrier.ruleset, "da")} DA qs
                        </span>
                        <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                          {getQuestionCount(carrier.ruleset, "fa")} FA qs
                        </span>
                        <span className="text-xs" style={{ color: BRAND.purpleSecondary }}>
                          {getCategoryCount(carrier.ruleset)} categories
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      className="p-2 rounded-lg transition-colors hover:bg-black/5"
                      style={{ color: BRAND.purpleSecondary }}
                      onClick={(e) => { e.stopPropagation(); setLocation(`/carriers/${carrier.carrierKey}`) }}
                      title="Edit"
                    >
                      <EditPencil width={16} height={16} />
                    </button>
                    <button
                      className="p-2 rounded-lg transition-colors hover:bg-red-50"
                      style={{ color: "#dc2626" }}
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(carrier.carrierKey) }}
                      title="Delete"
                    >
                      <Trash width={16} height={16} />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setDeleteConfirm(null)}>
          <div
            className="bg-white rounded-xl shadow-xl p-6 mx-4 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: BRAND.deepPurple, fontFamily: FONTS.heading }}>
              Delete Carrier
            </h3>
            <p className="text-sm mb-4" style={{ color: BRAND.purpleSecondary }}>
              Are you sure you want to delete <strong>{carriers.find(c => c.carrierKey === deleteConfirm)?.displayName}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
                style={{ borderColor: BRAND.greyLavender }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-white"
                style={{ backgroundColor: "#dc2626" }}
                onClick={() => handleDelete(deleteConfirm)}
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
