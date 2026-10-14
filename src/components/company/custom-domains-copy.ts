export const txtRecord = (hostname: string, token: string) => ({
  name: `_dealroom-challenge.${hostname}`,
  value: token,
});

export const cnameRecord = (hostname: string, target: string) => ({
  name: hostname,
  value: target,
});

export const domainStatusLabel = (row: {
  status: "PENDING" | "ACTIVE" | "ALIAS";
  isPrimary: boolean;
}): "Primary" | "Redirects to primary" | "Pending verification" =>
  row.status === "PENDING"
    ? "Pending verification"
    : row.isPrimary
      ? "Primary"
      : "Redirects to primary";
