export const JOB_TYPES = {
  email: [
    "auth-verify",
    "share-update",
    "share-data-room",
    "password-reset",
    "member-invite",
    "esign-confirmation",
    "esign-notification",
    "view-alert",
    "view-digest",
  ],
  esign: ["generate-pdf", "complete-pdf"],
  maintenance: ["purge-view-events"],
} as const;
