import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions";
import { VIEWER_PRESET, presetToPermissions } from "./presets";
import { SUBJECTS } from "./subjects";

describe("Viewer preset", () => {
  it("grants read and nothing else", () => {
    for (const actions of Object.values(VIEWER_PRESET))
      expect(actions).toEqual(["read"]);
  });

  it("covers exactly the document-facing subjects", () => {
    expect(Object.keys(VIEWER_PRESET).sort()).toEqual([
      "audits",
      "data-rooms",
      "documents",
      "templates",
      "updates",
    ]);
  });

  it("never touches money, people, roles or settings", () => {
    for (const s of [
      "securities",
      "stakeholder",
      "members",
      "roles",
      "billing",
      "company",
      "developer",
      "bank-accounts",
      "cap-table-settings",
    ])
      expect(Object.keys(VIEWER_PRESET)).not.toContain(s);
  });

  it("only names subjects that exist", () => {
    for (const s of Object.keys(VIEWER_PRESET))
      expect(SUBJECTS as readonly string[]).toContain(s);
  });

  it("expands to every subject with every action explicit", () => {
    const p = presetToPermissions(VIEWER_PRESET, ACTIONS);
    expect(Object.keys(p).sort()).toEqual([...SUBJECTS].sort());
    expect(p.audits).toMatchObject({
      read: true,
      update: false,
      create: false,
    });
    expect(p.securities?.read).toBe(false);
  });
});
