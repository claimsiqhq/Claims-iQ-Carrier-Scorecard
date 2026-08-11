import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type Route } from "@playwright/test"

const authenticatedSession = {
  user: {
    id: "user-reviewer",
    email: "reviewer@example.com",
    firstName: "Riley",
    lastName: "Reviewer",
    profileImageUrl: null,
    role: "reviewer",
    platformRole: "none",
  },
  organization: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Complete iQ QA",
    role: "owner",
    accessMode: "membership",
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

const carrierEntityId = "40000000-0000-4000-8000-000000000001"

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
  let claimArchived = false
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
          totalClaims: claimArchived ? 0 : 1,
          analyzedCount: claimArchived ? 0 : 1,
          processingCount: 0,
          pendingCount: 0,
          highRiskCount: 0,
          approvalReadyCount: 0,
          reviewRequiredCount: claimArchived ? 0 : 1,
          averageScore: 82,
          backlogCount: claimArchived ? 0 : 1,
          dollarsAtRisk: claimArchived ? 0 : 12500,
          averageAgeDays: 6,
          completedLast7Days: 1,
          openFindingCount: 2,
        },
        riskDistribution: { HIGH: 0, MEDIUM: 1, LOW: 0 },
        approvalDistribution: { READY: 0, REVIEW: 1, NOT_READY: 0 },
        recentClaims: claimArchived ? [] : [currentClaim],
        recentActivity: [],
        topIssues: [],
      })
      return
    }
    if (url.pathname === "/api/claims/queue") {
      await fulfillJson(route, {
        items: claimArchived ? [] : [currentClaim],
        total: claimArchived ? 0 : 1,
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
      await fulfillJson(route, [{
        id: carrierEntityId,
        key: "andover",
        entityKey: "andover",
        carrierKey: "andover",
        displayName: "Andover",
        organizationId: authenticatedSession.organization.id,
        legalName: "The Andover Companies",
        isPrimary: true,
        active: true,
        logoUrl: null,
      }])
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
    if (url.pathname === "/api/claims/archive" && method === "POST") {
      const body = route.request().postDataJSON() as { claimIds: string[] }
      claimArchived = body.claimIds.includes(claim.id)
      await fulfillJson(route, {
        success: true,
        message: `${body.claimIds.length} claim deleted from active work`,
        archivedCount: body.claimIds.length,
        alreadyArchivedCount: 0,
        claimIds: body.claimIds,
      })
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
      await fulfillJson(route, claimArchived ? [] : [currentClaim])
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
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

  await page
    .getByRole("button", {
      name: "Tenant menu. Current tenant: Complete iQ QA",
    })
    .click()
  await expect(page.getByRole("menuitem", { name: "Complete iQ QA, current tenant" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /switch to/i })).toHaveCount(0)
  await page.keyboard.press("Escape")
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true")
  await expect(page.getByText("Platform administration", { exact: true })).toHaveCount(0)

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

test("tenant users cannot enumerate platform carrier rulesets", async ({ page }) => {
  let platformCarrierRequests = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/platform/carriers")) {
      platformCarrierRequests += 1
    }
  })
  await mockAuthenticatedApi(page)
  await page.goto("/platform/carriers")

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText("Priority review queue")).toBeVisible()
  expect(platformCarrierRequests).toBe(0)
})

test("admin can delete selected claims from the operational queue", async ({ page }) => {
  const archiveRequests: Array<{ claimIds: string[] }> = []
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/claims/archive"
      && request.method() === "POST"
    ) {
      archiveRequests.push(request.postDataJSON() as { claimIds: string[] })
    }
  })
  await mockAuthenticatedApi(page)
  await page.goto("/claims")

  await page
    .getByLabel(`Select claim ${claim.claimNumber}`)
    .filter({ visible: true })
    .first()
    .click()
  await page.getByRole("button", { name: "Delete selected" }).click()

  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText(`Delete ${claim.claimNumber}?`)
  await expect(dialog).toContainText("retains the source record and immutable audit provenance")
  await dialog.getByRole("button", { name: "Delete claim", exact: true }).click()

  await expect(page.getByText("No active claims in the queue")).toBeVisible()
  expect(archiveRequests).toEqual([{ claimIds: [claim.id] }])
})

test("admin can delete an individual claim from the dashboard", async ({ page }) => {
  await mockAuthenticatedApi(page)
  await page.goto("/")

  await page
    .getByRole("button", { name: /^Delete claim/ })
    .filter({ visible: true })
    .first()
    .click()

  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText(`Delete ${claim.claimNumber}?`)
  await dialog.getByRole("button", { name: "Delete claim", exact: true }).click()

  await expect(page.getByText("No claims in the ledger")).toBeVisible()
})

test("batch intake reaches a recoverable ready state", async ({ page }) => {
  const ingestBodies: string[] = []
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/ingest"
      && request.method() === "POST"
    ) {
      ingestBodies.push(request.postData() || "")
    }
  })
  await mockAuthenticatedApi(page)
  await page.goto("/claims?upload=1")

  await expect(page.getByRole("dialog")).toContainText("Add source packages to the ledger")
  await page.getByLabel("Choose claim PDF files").setInputFiles({
    name: "synthetic-claim.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 synthetic browser fixture"),
  })
  await page.getByRole("button", { name: "Start 1 intake" }).click()

  await expect(page.getByText("Ready for review")).toBeVisible()
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible()
  expect(ingestBodies).toHaveLength(1)
  expect(ingestBodies[0]).toContain('name="carrierEntityId"')
  expect(ingestBodies[0]).toContain(carrierEntityId)
  expect(ingestBodies[0]).not.toContain('name="carrier"')
  expect(ingestBodies[0]).not.toContain('name="carrierKey"')
})

test("reviewer can follow evidence, approve, and complete a rerun", async ({ page }) => {
  const reprocessBodies: Array<Record<string, unknown>> = []
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === `/api/claims/${claim.id}/reprocess`
      && request.method() === "POST"
    ) {
      reprocessBodies.push(request.postDataJSON() as Record<string, unknown>)
    }
  })
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
  await expect(page.getByLabel("Carrier entity")).toHaveValue(carrierEntityId)
  await expect(page.getByLabel("Carrier entity")).toBeDisabled()
  await page.getByRole("button", { name: "Reprocess claim" }).click()
  await expect(page.getByRole("dialog")).not.toBeVisible()
  await expect(page.getByText("AI: Succeeded")).toBeVisible()
  expect(reprocessBodies).toEqual([{ carrierEntityId }])
})

test("platform access requires a reason and clears tenant-scoped state", async ({ page }) => {
  const accessRequests: Array<{ organizationId: string; reason: string }> = []
  let accessActive = false
  const platformUser = {
    id: "user-platform-admin",
    email: "platform-admin@example.com",
    firstName: "Pat",
    lastName: "Platform",
    profileImageUrl: null,
    role: "reviewer",
    platformRole: "admin",
  }
  const leasedOrganization = {
    id: "org-andover",
    name: "Andover Companies",
    role: "platform_admin",
    permissions: ["claims:read", "claims:create"],
    accessMode: "platform_lease",
    accessExpiresAt: "2026-08-11T01:00:00.000Z",
  }

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "complete-iq:intake-recovery:v2:stale-user:stale-tenant",
      JSON.stringify([{ claimId: "stale-claim" }]),
    )
    window.localStorage.setItem("complete-iq:selected-organization", "stale-tenant")
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === "/api/auth/user") {
      await fulfillJson(route, {
        user: platformUser,
        organization: accessActive ? leasedOrganization : null,
      })
      return
    }
    if (url.pathname === "/api/platform/tenants") {
      await fulfillJson(route, [
        { id: "org-andover", name: "Andover Companies", slug: "andover" },
        { id: "org-allstate", name: "Allstate", slug: "allstate" },
      ])
      return
    }
    if (url.pathname === "/api/platform/tenant-access" && method === "POST") {
      accessRequests.push(route.request().postDataJSON() as {
        organizationId: string
        reason: string
      })
      accessActive = true
      await fulfillJson(route, { user: platformUser, organization: leasedOrganization })
      return
    }
    if (url.pathname === "/api/platform/tenant-access" && method === "DELETE") {
      accessActive = false
      await fulfillJson(route, { user: platformUser, organization: null })
      return
    }
    if (url.pathname === "/api/dashboard") {
      await fulfillJson(route, {
        stats: {
          totalClaims: 0,
          analyzedCount: 0,
          pendingCount: 0,
          avgScore: null,
          backlogCount: 0,
          dollarsAtRisk: "0",
          averageAgeDays: 0,
          completedLast7Days: 0,
          openFindingCount: 0,
        },
        riskDistribution: {},
        approvalDistribution: {},
        carriers: [],
        findingSeverity: {},
        recentClaims: [],
        recentActivity: [],
      })
      return
    }
    await fulfillJson(route, { error: `Unhandled test endpoint: ${url.pathname}` }, 404)
  })

  await page.goto("/claims?carrier=Andover")
  await expect(page.getByRole("heading", { name: "Choose a tenant from the header" })).toBeVisible()
  await expect(page).toHaveURL(/\/tenant-access$/)

  await page.getByRole("button", { name: "Tenant menu. Select a tenant" }).click()
  await page.getByRole("menuitem", { name: "Open Andover Companies" }).click()
  const startAccess = page.getByRole("button", { name: "Open Andover Companies" })
  await expect(startAccess).toBeDisabled()
  await page.getByLabel("Reason for access").fill("Investigate support case CIQ-1842")
  await startAccess.click()

  await expect(
    page.getByText("Viewing Andover Companies as platform administrator"),
  ).toBeVisible()
  await expect(page.getByText(/Temporary access expires/)).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
  expect(accessRequests).toEqual([
    {
      organizationId: "org-andover",
      reason: "Investigate support case CIQ-1842",
    },
  ])
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("complete-iq:intake-recovery"),
      ),
    ),
  ).toEqual([])
  expect(await page.evaluate(() =>
    window.localStorage.getItem("complete-iq:selected-organization"),
  )).toBeNull()

  await page.evaluate(() => {
    window.localStorage.setItem(
      "complete-iq:intake-recovery:v2:user-platform-admin:org-andover",
      JSON.stringify([{ claimId: "active-claim" }]),
    )
  })
  await page.getByRole("button", { name: "Exit tenant" }).click()

  await expect(page.getByRole("heading", { name: "Choose a tenant from the header" })).toBeVisible()
  await expect(page).toHaveURL(/\/tenant-access$/)
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("complete-iq:intake-recovery"),
      ),
    ),
  ).toEqual([])
})

test("platform cache and recovery state stay isolated across tenant A to B", async ({
  page,
}) => {
  const platformUser = {
    id: "user-platform-admin",
    email: "platform-admin@example.com",
    firstName: "Pat",
    lastName: "Platform",
    profileImageUrl: null,
    role: "reviewer",
    platformRole: "admin",
  }
  const tenantA = {
    id: "org-tenant-a",
    name: "Tenant A Insurance",
    slug: "tenant-a",
    entity: {
      id: "41000000-0000-4000-8000-000000000001",
      key: "tenant-a-primary",
      entityKey: "tenant-a-primary",
      carrierKey: "tenant-a",
      displayName: "Tenant A Primary Entity",
      organizationId: "org-tenant-a",
      legalName: "Tenant A Insurance",
      isPrimary: true,
      active: true,
      logoUrl: null,
    },
    claim: {
      ...claim,
      id: "11000000-0000-4000-8000-000000000001",
      claimNumber: "TENANT-A-CLAIM",
      insuredName: "Tenant A Confidential Insured",
      carrier: "Tenant A Primary Entity",
    },
  }
  const tenantB = {
    id: "org-tenant-b",
    name: "Tenant B Insurance",
    slug: "tenant-b",
    entity: {
      id: "42000000-0000-4000-8000-000000000002",
      key: "tenant-b-primary",
      entityKey: "tenant-b-primary",
      carrierKey: "tenant-b",
      displayName: "Tenant B Primary Entity",
      organizationId: "org-tenant-b",
      legalName: "Tenant B Insurance",
      isPrimary: true,
      active: true,
      logoUrl: null,
    },
    claim: {
      ...claim,
      id: "12000000-0000-4000-8000-000000000002",
      claimNumber: "TENANT-B-CLAIM",
      insuredName: "Tenant B Confidential Insured",
      carrier: "Tenant B Primary Entity",
    },
  }
  const tenants = [tenantA, tenantB]
  let activeTenantId: string | null = null
  const accessRequests: Array<{ organizationId: string; reason: string }> = []
  const tenantDataRequests: Array<{
    path: string
    tenantId: string | null
    organizationHeader: string | undefined
  }> = []

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "complete-iq:intake-recovery:v2:user-platform-admin:org-tenant-a",
      JSON.stringify([{ claimId: "stale-tenant-a-claim" }]),
    )
    window.localStorage.setItem("unrelated-browser-preference", "preserve-me")
  })
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const method = route.request().method()
    if (url.pathname === "/api/auth/user") {
      const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId)
      await fulfillJson(route, {
        user: platformUser,
        organization: activeTenant
          ? {
              id: activeTenant.id,
              name: activeTenant.name,
              role: "platform_admin",
              permissions: ["claims:read", "claims:create"],
              accessMode: "platform_lease",
              accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
            }
          : null,
      })
      return
    }
    if (url.pathname === "/api/platform/tenants") {
      await fulfillJson(
        route,
        tenants.map(({ id, name, slug }) => ({ id, name, slug })),
      )
      return
    }
    if (url.pathname === "/api/platform/tenant-access" && method === "POST") {
      const body = route.request().postDataJSON() as {
        organizationId: string
        reason: string
      }
      accessRequests.push(body)
      activeTenantId = body.organizationId
      const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId)!
      await fulfillJson(route, {
        user: platformUser,
        organization: {
          id: activeTenant.id,
          name: activeTenant.name,
          role: "platform_admin",
          permissions: ["claims:read", "claims:create"],
          accessMode: "platform_lease",
          accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      })
      return
    }
    if (url.pathname === "/api/platform/tenant-access" && method === "DELETE") {
      activeTenantId = null
      await fulfillJson(route, { user: platformUser, organization: null })
      return
    }

    const tenantDataPaths = new Set([
      "/api/dashboard",
      "/api/claims/queue",
      "/api/claims/assignees",
      "/api/saved-views",
      "/api/carriers",
    ])
    if (tenantDataPaths.has(url.pathname)) {
      tenantDataRequests.push({
        path: url.pathname,
        tenantId: activeTenantId,
        organizationHeader: route.request().headers()["x-organization-id"],
      })
      const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId)
      if (!activeTenant) {
        await fulfillJson(route, { error: "Tenant lease required" }, 403)
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
            openFindingCount: 1,
          },
          riskDistribution: { HIGH: 0, MEDIUM: 1, LOW: 0 },
          approvalDistribution: { READY: 0, REVIEW: 1, NOT_READY: 0 },
          recentClaims: [activeTenant.claim],
          recentActivity: [],
          topIssues: [],
        })
        return
      }
      if (url.pathname === "/api/claims/queue") {
        await fulfillJson(route, {
          items: [activeTenant.claim],
          total: 1,
          page: 1,
          pageSize: 20,
          facets: { carriers: [activeTenant.entity.displayName] },
        })
        return
      }
      if (url.pathname === "/api/claims/assignees") {
        await fulfillJson(route, {
          assignees: [{
            userId: platformUser.id,
            name: "Pat Platform",
            role: "platform_admin",
          }],
        })
        return
      }
      if (url.pathname === "/api/saved-views") {
        await fulfillJson(route, { views: [] })
        return
      }
      await fulfillJson(route, [activeTenant.entity])
      return
    }
    await fulfillJson(route, { error: `Unhandled test endpoint: ${url.pathname}` }, 404)
  })

  await page.goto("/tenant-access")
  await page.getByRole("button", { name: "Tenant menu. Select a tenant" }).click()
  await page.getByRole("menuitem", { name: "Open Tenant A Insurance" }).click()
  const startTenantA = page.getByRole("button", { name: "Open Tenant A Insurance" })
  await page.getByLabel("Reason for access").fill("   ")
  await expect(startTenantA).toBeDisabled()
  await page.getByLabel("Reason for access").fill("Investigate Tenant A case")
  await startTenantA.click()

  await expect(
    page.getByText("Viewing Tenant A Insurance as platform administrator"),
  ).toBeVisible()
  await expect(page.getByText(/Temporary access expires/)).toBeVisible()
  await page
    .getByRole("link", { name: "Claims", exact: true })
    .filter({ visible: true })
    .first()
    .click()
  await expect(page.getByText("TENANT-A-CLAIM").filter({ visible: true }).first()).toBeVisible()
  await page
    .locator(".ciq-context-band")
    .getByRole("button", { name: "New intake" })
    .click()
  await expect(page.getByLabel("Carrier entity")).toHaveValue(tenantA.entity.id)
  await expect(
    page.getByRole("option", { name: tenantA.entity.displayName }),
  ).toHaveCount(1)
  await page.keyboard.press("Escape")

  await page.evaluate(() => {
    window.localStorage.setItem(
      "complete-iq:intake-recovery:v2:user-platform-admin:org-tenant-a",
      JSON.stringify([{ claimId: "tenant-a-recovery" }]),
    )
  })
  const tenantBRequestStart = tenantDataRequests.length
  await page
    .getByRole("button", {
      name: "Tenant menu. Current tenant: Tenant A Insurance",
    })
    .click()
  await page.getByRole("menuitem", { name: "Switch to Tenant B Insurance" }).click()
  const startTenantB = page.getByRole("button", { name: "Switch to Tenant B Insurance" })
  await expect(startTenantB).toBeDisabled()
  await page.getByLabel("Reason for access").fill("Investigate Tenant B case")
  await startTenantB.click()

  await expect(
    page.getByText("Viewing Tenant B Insurance as platform administrator"),
  ).toBeVisible()
  await expect(page.getByText(/Temporary access expires/)).toBeVisible()
  await page
    .getByRole("link", { name: "Claims", exact: true })
    .filter({ visible: true })
    .first()
    .click()
  await expect(page.getByText("TENANT-B-CLAIM").filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText("TENANT-A-CLAIM")).toHaveCount(0)
  await expect(page.getByText("Tenant A Confidential Insured")).toHaveCount(0)

  await page
    .locator(".ciq-context-band")
    .getByRole("button", { name: "New intake" })
    .click()
  await expect(page.getByLabel("Carrier entity")).toHaveValue(tenantB.entity.id)
  await expect(
    page.getByRole("option", { name: tenantB.entity.displayName }),
  ).toHaveCount(1)
  await expect(
    page.getByRole("option", { name: tenantA.entity.displayName }),
  ).toHaveCount(0)

  const tenantBRequests = tenantDataRequests.slice(tenantBRequestStart)
  expect(tenantBRequests.some(({ path }) => path === "/api/claims/queue")).toBe(true)
  expect(tenantBRequests.some(({ path }) => path === "/api/carriers")).toBe(true)
  expect(
    tenantBRequests.every(
      ({ tenantId, organizationHeader }) =>
        tenantId === tenantB.id && organizationHeader === undefined,
    ),
  ).toBe(true)
  expect(accessRequests).toEqual([
    {
      organizationId: tenantA.id,
      reason: "Investigate Tenant A case",
    },
    {
      organizationId: tenantB.id,
      reason: "Investigate Tenant B case",
    },
  ])
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) =>
        key.startsWith("complete-iq:intake-recovery"),
      ),
    ),
  ).toEqual([])
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("unrelated-browser-preference"),
    ),
  ).toBe("preserve-me")
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
