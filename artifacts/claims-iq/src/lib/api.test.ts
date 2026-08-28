import { afterEach, describe, expect, it, vi } from "vitest"
import { api, apiRequest } from "@/lib/api"

describe("frontend API contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("never sends an organization override header", async () => {
    window.localStorage.setItem("complete-iq:selected-organization", "org-untrusted")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await apiRequest("/test", {
      headers: { "X-Organization-Id": "org-explicit-override" },
    })

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(request.headers).has("X-Organization-Id")).toBe(false)
  })

  it("uploads only the selected carrier entity ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        job: { id: "job-1", status: "queued", stage: "uploaded" },
      }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await api.ingest(
      new File(["%PDF-1.7"], "claim.pdf", { type: "application/pdf" }),
      "10000000-0000-4000-8000-000000000001",
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    const body = request.body as FormData
    expect(body.get("carrierEntityId")).toBe("10000000-0000-4000-8000-000000000001")
    expect(body.has("carrier")).toBe(false)
    expect(body.has("carrierKey")).toBe(false)
  })

  it("reprocesses with only the selected carrier entity ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        job: { id: "job-1", status: "queued", stage: "uploaded" },
      }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await api.reprocessClaim(
      "claim-1",
      "10000000-0000-4000-8000-000000000001",
    )

    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      carrierEntityId: "10000000-0000-4000-8000-000000000001",
    })
  })

  it("routes completed audit PDF downloads to the binary endpoint", () => {
    expect(api.reportUrl("claim-1")).toMatch(
      /\/claims\/claim-1\/download\.pdf$/,
    )
  })
})
