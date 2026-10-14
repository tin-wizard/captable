export const txtRecord = (hostname: string, token: string) => ({
  name: `_dealroom-challenge.${hostname}`,
  value: token,
});

export const cnameRecord = (hostname: string, target: string) => ({
  name: hostname,
  value: target,
});

// Dates may arrive as strings from the API, so every helper re-wraps them.
const toDate = (d: Date | string) => new Date(d);

export const domainStatusLabel = (
  row: {
    status: "PENDING" | "ACTIVE" | "ALIAS";
    isPrimary: boolean;
    aliasExpiresAt?: Date | string | null;
  },
  formatDate: (d: Date) => string = (d) => d.toLocaleDateString(),
): string =>
  row.status === "PENDING"
    ? "Pending verification"
    : row.isPrimary
      ? "Primary"
      : row.status === "ALIAS" && row.aliasExpiresAt
        ? `Redirects until ${formatDate(toDate(row.aliasExpiresAt))}`
        : "Redirects to primary";

type Row = {
  hostname: string;
  kind: "PLATFORM" | "CUSTOM";
  status: "PENDING" | "ACTIVE" | "ALIAS";
  isPrimary: boolean;
  aliasExpiresAt: Date | string | null;
};

// The company's current platform address: ACTIVE, or the permanent alias kept
// while a custom domain is primary. Never an expiring alias left by a rename.
const isCurrentPlatform = (r: Row) =>
  r.kind === "PLATFORM" &&
  (r.status === "ACTIVE" ||
    (r.status === "ALIAS" && r.aliasExpiresAt === null));

export const currentPlatformRow = <R extends Row>(rows: R[]) =>
  rows.find(isCurrentPlatform);

// Mirrors the server's `promotable`: a live custom row (an alias only until it
// expires), or the current platform row.
export const canMakePrimary = (r: Row, now: Date = new Date()) =>
  !r.isPrimary &&
  r.status !== "PENDING" &&
  (r.kind === "CUSTOM"
    ? r.aliasExpiresAt === null || toDate(r.aliasExpiresAt) > now
    : isCurrentPlatform(r));

// A verified custom domain that is not primary yet (verify never promotes).
export const finishSetupHint = (r: Row) =>
  r.kind === "CUSTOM" &&
  r.status === "ALIAS" &&
  !r.isPrimary &&
  r.aliasExpiresAt === null
    ? `Open ${r.hostname} to finish setup, then make it primary`
    : null;

// expiresInDays: set when the target is the platform address, so the current
// (custom) primary becomes an expiring alias.
export const makePrimaryDialogCopy = ({
  target,
  current,
  expiresInDays,
}: {
  target: string;
  current?: string;
  expiresInDays?: number;
}) =>
  expiresInDays
    ? `${
        current ?? "Your current address"
      } will redirect for ${expiresInDays} days, then stop working.`
    : `${current ?? "Your current address"} will redirect to ${target}.`;

export const removeDialogCopy = (r: Row, platformHost?: string) =>
  r.status === "PENDING"
    ? "Discard this setup. Nothing changes for visitors."
    : r.isPrimary
      ? `${r.hostname} will stop working and ${
          platformHost ?? "your platform address"
        } becomes your address.`
      : `${r.hostname} will stop working.`;

export const verifiedCopy = (host: string) =>
  `${host} is verified. Open https://${host} once to finish setup, then choose Make primary.`;

export const aRecordNote = (ips: string[]) =>
  ips.length
    ? `Or, for a bare domain, add an A record to ${ips.join(", ")} instead.`
    : "Using a bare domain? Ask support for the server IP and add an A record instead.";
