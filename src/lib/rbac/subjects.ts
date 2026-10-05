export const SUBJECTS = [
  "billing",
  "members",
  "stakeholder",
  "roles",
  "audits",
  "documents",
  "company",
  "developer",
  "bank-accounts",
  "securities",
  "cap-table-settings",
  "updates",
  "data-rooms",
  "templates",
] as const;
export type TSubjects = (typeof SUBJECTS)[number];
