// Shared by the server sweep and the admin screen (which tells the admin when
// an unpaired relation disappears), so it must stay free of server imports.
export const UNPAIRED_RETENTION_DAYS = 45;

export const UNPAIRED_RETENTION_MS =
  UNPAIRED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
