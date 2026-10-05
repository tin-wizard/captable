import { describe, expect, test } from "vitest";
import { RBAC, type addPolicyOption, hasPermission } from ".";
import { ADMIN_PERMISSION, DEFAULT_PERMISSION } from "./constants";
import type { TPermission } from "./schema";

describe("evaluating a query", () => {
  const testCases: {
    name: string;
    policies: addPolicyOption;
    permissions: TPermission[];
    valid: boolean;
  }[] = [
    {
      name: "role check - pass",
      valid: true,
      permissions: [{ subject: "billing", actions: ["read"] }],
      policies: { billing: { allow: ["read"] } },
    },
    {
      name: "role check - fail",
      valid: false,
      permissions: [{ subject: "billing", actions: ["read"] }],
      policies: { billing: { allow: ["update"] } },
    },
    {
      name: "check deny",
      valid: false,
      permissions: [{ subject: "billing", actions: ["read", "update"] }],
      policies: { billing: { allow: ["read"], deny: ["update"] } },
    },
    {
      name: "multiple permissions - pass",
      valid: true,
      permissions: [
        { subject: "billing", actions: ["read", "update", "delete"] },
        { subject: "roles", actions: ["read", "update"] },
      ],
      policies: {
        billing: { allow: ["read", "update"] },
        roles: { allow: ["read"] },
      },
    },
    {
      name: "multiple permissions - fail",
      valid: false,
      permissions: [
        { subject: "billing", actions: ["read", "update", "delete"] },
        { subject: "roles", actions: ["read", "update"] },
      ],
      policies: {
        billing: { allow: ["read", "update"] },
        roles: { allow: ["delete"] },
      },
    },
    {
      name: "role check wild card - pass",
      valid: true,
      permissions: [{ subject: "billing", actions: ["*"] }],
      policies: { billing: { allow: ["read"] } },
    },
    {
      name: "should pass on empty policies",
      valid: true,
      permissions: [{ subject: "billing", actions: ["*"] }],
      policies: {},
    },
  ];

  for (const tc of testCases) {
    test(tc.name, () => {
      const res = new RBAC().addPolicies(tc.policies).enforce(tc.permissions);
      expect(res.err).toBeUndefined();
      expect(res.val?.valid).toBe(tc.valid);
    });
  }
});

// used by the document preview page and common.getContacts
describe("hasPermission", () => {
  test("ADMIN holds everything, no role holds nothing", () => {
    expect(hasPermission(ADMIN_PERMISSION, "documents", "read")).toBe(true);
    expect(hasPermission(DEFAULT_PERMISSION, "documents", "read")).toBe(false);
    expect(hasPermission([], "documents", "read")).toBe(false);
  });

  test("a custom role holds exactly its grants", () => {
    const perms: TPermission[] = [
      { subject: "documents", actions: ["read"] },
      { subject: "members", actions: ["update"] },
    ];
    expect(hasPermission(perms, "documents", "read")).toBe(true);
    expect(hasPermission(perms, "members", "read")).toBe(false);
    expect(hasPermission(perms, "stakeholder", "read")).toBe(false);
  });
});
