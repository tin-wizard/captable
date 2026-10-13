import type { TActions } from "./actions";
import { SUBJECTS, type TSubjects } from "./subjects";

// One-click role starting points offered in the "Create a role" dialog. Only
// read access is granted: no holdings (securities), no stakeholders, no members,
// roles, billing or company settings.
export const VIEWER_PRESET: Partial<Record<TSubjects, TActions[]>> = {
  audits: ["read"],
  "data-rooms": ["read"],
  documents: ["read"],
  templates: ["read"],
  updates: ["read"],
};

// Expands a preset to the full subject x action map the role form edits.
export function presetToPermissions(
  preset: Partial<Record<TSubjects, TActions[]>>,
  actions: readonly TActions[],
): Record<string, Partial<Record<TActions, boolean>>> {
  const out: Record<string, Partial<Record<TActions, boolean>>> = {};
  for (const subject of SUBJECTS) {
    const granted = preset[subject] ?? [];
    out[subject] = Object.fromEntries(
      actions.map((a) => [a, granted.includes(a)]),
    ) as Partial<Record<TActions, boolean>>;
  }
  return out;
}
