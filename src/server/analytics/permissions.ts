type Perm = { subject: string; actions: string[] };

// true when the role grants read (or everything) on a subject
export const canRead = (perms: Perm[], subject: string) =>
  perms.some(
    (p) =>
      p.subject === subject &&
      (p.actions.includes("read") || p.actions.includes("*")),
  );
