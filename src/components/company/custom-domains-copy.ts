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

type Row = {
  hostname: string;
  kind: "PLATFORM" | "CUSTOM";
  status: "PENDING" | "ACTIVE" | "ALIAS";
  isPrimary: boolean;
  aliasExpiresAt: Date | null;
};

// Mirrors the server's `promotable`: a live custom row, or the platform row
// that is current (not an expiring alias left by a rename).
export const canMakePrimary = (r: Row) =>
  !r.isPrimary &&
  r.status !== "PENDING" &&
  (r.kind === "CUSTOM" || r.status === "ACTIVE" || r.aliasExpiresAt === null);

export const makePrimaryDialogCopy = (target: string, current?: string) =>
  `${current ?? "Your current address"} will redirect to ${target}.`;

export const removeDialogCopy = (r: Row, platformHost?: string) =>
  r.status === "PENDING"
    ? "Discard this setup. Nothing changes for visitors."
    : r.isPrimary
      ? `${r.hostname} will stop working and ${
          platformHost ?? "your platform address"
        } becomes your address.`
      : `${r.hostname} will stop working.`;

export const verifiedCopy = (host: string, platformHost?: string) =>
  `${host} is verified and is now your address.${
    platformHost ? ` ${platformHost} redirects to it.` : ""
  }`;

export const aRecordNote = (ips: string[]) =>
  ips.length
    ? `Or, for a bare domain, add an A record to ${ips.join(", ")} instead.`
    : "Using a bare domain? Ask support for the server IP and add an A record instead.";
