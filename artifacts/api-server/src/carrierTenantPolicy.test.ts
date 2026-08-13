import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCarrierEntitiesForOrganization,
  CarrierEntitySelectionError,
  ForeignCarrierMismatchError,
  profileBelongsToOrganization,
  resolveDetectedCarrierEntity,
  selectRequestedCarrierEntity,
  type TenantCarrierEntity,
} from "./services/carrierRulesetService";

const allstateOrganizationId = "10000000-0000-4000-8000-000000000001";
const andoverOrganizationId = "10000000-0000-4000-8000-000000000002";

function entity(
  id: string,
  organizationId: string,
  entityKey: string,
  displayName: string,
  isPrimary = false,
): TenantCarrierEntity {
  return {
    id,
    organizationId,
    entityKey,
    displayName,
    legalName: displayName,
    isPrimary,
    active: true,
  };
}

const allstate = entity(
  "20000000-0000-4000-8000-000000000001",
  allstateOrganizationId,
  "allstate",
  "Allstate",
  true,
);
const andoverEntities = [
  entity(
    "20000000-0000-4000-8000-000000000002",
    andoverOrganizationId,
    "andover",
    "Andover",
    true,
  ),
  entity(
    "20000000-0000-4000-8000-000000000003",
    andoverOrganizationId,
    "bay-state-insurance-company",
    "Bay State Insurance Company",
  ),
  entity(
    "20000000-0000-4000-8000-000000000004",
    andoverOrganizationId,
    "cambridge-mutual",
    "Cambridge Mutual",
  ),
  entity(
    "20000000-0000-4000-8000-000000000005",
    andoverOrganizationId,
    "merrimack-mutual",
    "Merrimack Mutual",
  ),
];

test("tenant carrier profile and entity rows remain organization isolated", () => {
  assert.equal(
    profileBelongsToOrganization(allstateOrganizationId, {
      organizationId: allstateOrganizationId,
    }),
    true,
  );
  assert.equal(
    profileBelongsToOrganization(allstateOrganizationId, {
      organizationId: andoverOrganizationId,
    }),
    false,
  );
  assert.deepEqual(
    activeCarrierEntitiesForOrganization(allstateOrganizationId, [
      allstate,
      ...andoverEntities,
    ]).map(({ id }) => id),
    [allstate.id],
  );
});

test("a foreign carrier entity ID is rejected without fallback", () => {
  assert.throws(
    () =>
      selectRequestedCarrierEntity(
        allstateOrganizationId,
        [allstate, ...andoverEntities],
        andoverEntities[0]!.id,
      ),
    (error: unknown) =>
      error instanceof CarrierEntitySelectionError &&
      error.code === "foreign_carrier_entity",
  );
});

test("Allstate processing cannot route a detected Andover claim", () => {
  assert.throws(
    () =>
      resolveDetectedCarrierEntity({
        organizationId: allstateOrganizationId,
        entities: [allstate],
        detectedCarrier: "The Andover Companies",
        requestedCarrierEntityId: allstate.id,
      }),
    (error: unknown) =>
      error instanceof ForeignCarrierMismatchError &&
      error.code === "foreign_carrier_mismatch",
  );
});

test("Andover and its configured subsidiaries map only within Andover", () => {
  const labels = [
    ["Andover", "andover"],
    ["Bay State Insurance Company", "bay-state-insurance-company"],
    ["Cambridge Mutual", "cambridge-mutual"],
    ["Merrimack Mutual", "merrimack-mutual"],
  ] as const;

  for (const [label, entityKey] of labels) {
    const selected = andoverEntities.find(
      (candidate) => candidate.entityKey === entityKey,
    )!;
    const resolved = resolveDetectedCarrierEntity({
      organizationId: andoverOrganizationId,
      entities: [allstate, ...andoverEntities],
      detectedCarrier: label,
      requestedCarrierEntityId: selected.id,
    });
    assert.equal(resolved.entityKey, entityKey);
    assert.equal(resolved.organizationId, andoverOrganizationId);
  }
});

test("omitted entity id on a multi-entity tenant selects the primary", () => {
  const selected = selectRequestedCarrierEntity(
    andoverOrganizationId,
    andoverEntities,
  );
  assert.equal(selected.entityKey, "andover");
  assert.equal(selected.isPrimary, true);
});

test("Andover PDF rematch switches the primary entity to Cambridge Mutual", () => {
  const resolved = resolveDetectedCarrierEntity({
    organizationId: andoverOrganizationId,
    entities: andoverEntities,
    detectedCarrier: "Cambridge Mutual",
  });
  assert.equal(resolved.entityKey, "cambridge-mutual");
  assert.equal(resolved.organizationId, andoverOrganizationId);
});
