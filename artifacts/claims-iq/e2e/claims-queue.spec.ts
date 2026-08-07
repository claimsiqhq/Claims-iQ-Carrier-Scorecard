import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type Route } from "@playwright/test"

const authenticatedSession = {
  user: {
    id: "user-reviewer",
    email: "reviewer@example.com",
    firstName: "Riley",
    lastName: "Reviewer",
    profileImageUrl: null,
    role: "admin",
  },
  organization: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Complete iQ QA",
    role: "owner",
    permissions: [
      "claims:read",
      "claims:create",
      "claims:update",
      "claims:delete",
      "claims:assign",
      "audits:run",
      "findings:review",
      "jobs:read",
      "jobs:cancel",
      "jobs:retry",
      "views:manage",
      "settings:manage",
      "email:send",
    ],
  },
}

const claim = {
  id: "10000000-0000-4000-8000-000000000001",
  claimNumber: "CIQ-2026-001",
  insuredName: "Synthetic Test Record",
  carrier: "Andover",
  dateOfLoss: "2026-07-14",
  status: "analyzed",
  policyNumber: "TEST-POLICY",
  lossType: "Water",
  propertyAddress: "Synthetic address",
  adjuster: "QA Reviewer",
  totalClaimAmount: "12500.00",
  deductible: "1000.00",
  summary: "Synthetic browser-test record.",
  ownerUserId: "user-reviewer",
  assigneeUserId: "user-reviewer",
  systemStatus: "ready",
  aiStatus: "succeeded",
  humanReviewStatus: "pending",
  createdAt: "2026-08-01T12:00:00.000Z",
  overallScore: 82,
  riskLevel: "MEDIUM",
  approvalStatus: "REVIEW",
}

const audit = {
  id: "30000000-0000-4000-8000-000000000001",
  claimId: claim.id,
  overallScore: 82,
  daScore: 84,
  daPointsAwarded: 42,
  daPointsPossible: 50,
  faScore: 80,
  faPointsAwarded: 40,
  faPointsPossible: 50,
  technicalScore: 82,
  technicalMax: 100,
  presentationScore: 0,
  presentationMax: 0,
  totalMax: 100,
  riskLevel: "MEDIUM",
  approvalStatus: "REVIEW",
  readiness: "REVIEW",
  technicalRisk: "MEDIUM",
  failedCount: 1,
  partialCount: 0,
  passedCount: 1,
  actionRequiredCount: 1,
  executiveSummary: "Synthetic audit fixture for browser workflow verification.",
  daCategories: [],
  faCategories: [],
  rootIssueGroups: [],
  issues: [],
  validationChecks: [],
  findings: [
    {
      id: "50000000-0000-4000-8000-000000000001",
      auditId: "30000000-0000-4000-8000-000000000001",
      type: "question",
      severity: "high",
      title: "Estimate support missing",
      description: "The estimate requires supporting evidence.",
      answer: "FAIL",
      issue: "Support was not located.",
      impact: "Payment confidence is reduced.",
      fix: "Attach and verify estimate support.",
      evidence_locations: ["Page 1"],
      confidence: 86,
      disposition: "open",
      reviewNotes: null,
    },
  ],
}

const claimDetail = {
  claim,
  documents: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      claimId: claim.id,
      type: "pdf",
      fileUrl: "claim-package.pdf",
      extractedText: "=== Page 1 ===\nSynthetic estimate support text.",
      metadata: { fileName: "claim-package.pdf", pageCount: 1 },
      createdAt: "2026-08-01T12:00:00.000Z",
    },
  ],
  audit,
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

async function mockAuthenticatedApi(page: Page) {
  let reviewStatus = claim.humanReviewStatus
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    const currentClaim = { ...claim, humanReviewStatus: reviewStatus }
    if (url.pathname === "/api/auth/user") {
      await fulfillJson(route, authenticatedSession)
      return
    }
    if (url.pathname === "/api/dashboard") {
      await fulfillJson(route, {
        stats: {
          totalClaims: 1,
          analyzedCount: 1,
          processingCount: 0,
          pendingCount: 0,
          highRiskCount: 0,
          approvalReadyCount: 0,
          reviewRequiredCount: 1,
          averageScore: 82,
          backlogCount: 1,
          dollarsAtRisk: 12500,
          averageAgeDays: 6,
          completedLast7Days: 1,
          openFindingCount: 2,
        },
        riskDistribution: { HIGH: 0, MEDIUM: 1, LOW: 0 },
        approvalDistribution: { READY: 0, REVIEW: 1, NOT_READY: 0 },
        recentClaims: [currentClaim],
        recentActivity: [],
        topIssues: [],
      })
      return
    }
    if (url.pathname === "/api/claims/queue") {
      await fulfillJson(route, {
        items: [currentClaim],
        total: 1,
        page: 1,
        pageSize: 20,
        facets: { carriers: ["Andover"] },
      })
      return
    }
    if (url.pathname === "/api/claims/assignees") {
      await fulfillJson(route, {
        assignees: [{ userId: "user-reviewer", name: "Riley Reviewer", role: "reviewer" }],
      })
      return
    }
    if (url.pathname === "/api/saved-views") {
      await fulfillJson(route, { views: [] })
      return
    }
    if (url.pathname === "/api/carriers") {
      await fulfillJson(route, [{ key: "andover", displayName: "Andover", active: true }])
      return
    }
    if (url.pathname === `/api/claims/${claim.id}/activity`) {
      await fulfillJson(route, { activity: [] })
      return
    }
    if (url.pathname === `/api/claims/${claim.id}/review-status` && method === "PATCH") {
      const body = route.request().postDataJSON() as { status: string }
      reviewStatus = body.status
      await fulfillJson(route, { humanReviewStatus: reviewStatus })
      return
    }
    if (url.pathname === `/api/claims/${claim.id}/processing-status`) {
      await fulfillJson(route, {
        claimId: claim.id,
        status: "analyzed",
        systemStatus: "ready",
        aiStatus: "succeeded",
        job: {
          id: "job-browser-test",
          claimId: claim.id,
          status: "succeeded",
          stage: "completed",
        },
      })
      return
    }
    if (url.pathname === `/api/claims/${claim.id}/reprocess` && method === "POST") {
      await fulfillJson(route, {
        job: {
          id: "job-browser-test",
          claimId: claim.id,
          status: "queued",
          stage: "uploaded",
        },
        duplicate: false,
      }, 202)
      return
    }
    if (url.pathname === "/api/ingest" && method === "POST") {
      await fulfillJson(route, {
        claim: currentClaim,
        document: claimDetail.documents[0],
        job: {
          id: "job-browser-test",
          claimId: claim.id,
          status: "queued",
          stage: "uploaded",
        },
        duplicate: false,
      }, 202)
      return
    }
    if (url.pathname === `/api/claims/${claim.id}`) {
      await fulfillJson(route, {
        ...claimDetail,
        claim: currentClaim,
      })
      return
    }
    if (url.pathname === "/api/claims") {
      await fulfillJson(route, [currentClaim])
      return
    }
    await fulfillJson(route, { error: `Unhandled test endpoint: ${url.pathname}` }, 404)
  })
}

test("operational queue is responsive, keyboard reachable, and axe-clean", async ({
  page,
}, testInfo) => {
  await mockAuthenticatedApi(page)
  await page.goto("/claims")

  await expect(page.getByRole("heading", { name: "Claims", exact: true })).toBeVisible()
  await expect(page.getByText("CIQ-2026-001").filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText("Synthetic Test Record").filter({ visible: true }).first()).toBeVisible()

  await page.keyboard.press("Tab")
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName)
  expect(["A", "BUTTON", "INPUT", "SELECT"]).toContain(focusedTag)

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  )
  expect(hasHorizontalOverflow).toBe(false)

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || ""),
    ),
  ).toEqual([])

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.screenshot({
    path: testInfo.outputPath("claims-queue.png"),
    fullPage: true,
    animations: "disabled",
  })
})

test("batch intake reaches a recoverable ready state", async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto("/claims")

  await page.getByRole("button", { name: "New intake", exact: true }).last().click()
  await expect(page.getByRole("dialog")).toContainText("Add source packages to the ledger")
  await page.getByLabel("Choose claim PDF files").setInputFiles({
    name: "synthetic-claim.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 synthetic browser fixture"),
  })
  await page.getByRole("button", { name: "Start 1 intake" }).click()

  await expect(page.getByText("Ready for review")).toBeVisible()
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible()
})

test("reviewer can follow evidence, approve, and complete a rerun", async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto("/claims")
  await page.getByText("CIQ-2026-001").filter({ visible: true }).first().click()

  await expect(page.getByRole("heading", { name: "CIQ-2026-001" })).toBeVisible()
  await page.getByLabel("Human review status").selectOption("approved")
  await page.getByRole("button", { name: "Save status" }).click()
  await expect(page.getByText("Human: Approved")).toBeVisible()

  await page.getByRole("tab", { name: "Findings" }).click()
  await page.getByRole("button", { name: "View extracted source" }).click()
  await expect(page.getByRole("tab", { name: "Files" })).toHaveAttribute("data-state", "active")
  await expect(page.getByText("Synthetic estimate support text.").first()).toBeVisible()

  await page.getByRole("button", { name: "Reprocess" }).click()
  await page.getByLabel("Carrier profile").selectOption("Andover")
  await page.getByRole("button", { name: "Reprocess claim" }).click()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.getByText("AI: Succeeded")).toBeVisible()
})

test("expired-session sign-in remains accessible", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("complete-iq:session-expired", "true")
  })
  await page.route("**/api/auth/user", (route) =>
    fulfillJson(route, { error: "Authentication required" }, 401),
  )
  await page.goto("/")

  await expect(page.getByRole("heading", { name: "Return to the audit ledger" })).toBeVisible()
  await expect(page.getByRole("status")).toContainText("protected session expired")
  await expect(page.getByLabel("Work email")).toBeVisible()
  await expect(page.getByLabel("Password")).toBeVisible()

  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(
    accessibility.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact || ""),
    ),
  ).toEqual([])
})
