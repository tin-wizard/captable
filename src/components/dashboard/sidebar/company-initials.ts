// Up to two initials from the first two words: "Lock'd Technologies Ltd" -> "LT".
export const companyInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => (Array.from(w)[0] ?? "").toUpperCase())
    .join("") || "?";
