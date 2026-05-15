// https://regex101.com/?regex=%5E%40%28%5C*%5C.%29%3F%5Ba-zA-Z0-9%5D%28%5Ba-zA-Z0-9-%5D*%5Ba-zA-Z0-9%5D%29%3F%28%5C.%5Ba-zA-Z0-9%5D%28%5Ba-zA-Z0-9-%5D*%5Ba-zA-Z0-9%5D%29%3F%29%2B%24&testString=%40example..com%0A%40example.com%0A%40example%0A%40+example.com%0A%40growi.org%0A%40a.b.c%0A%40sub.example.co.jp%0A%40my-company.example.com%0Aexample.com%0A%40%40example.com%0A%40*.com%0A%40%0A%40.example.com%0A%40-bad.com%0A%40bad-.com%0A&flags=gm&flavor=pcre2&delimiter=%2F
const DOMAIN_ENTRY_PATTERN =
  /^@(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
// Domain part uses the same label rules as DOMAIN_ENTRY_PATTERN (no leading/trailing hyphens, no consecutive dots)
// https://regex101.com/?regex=%5E%5B%5E%5Cs%40%5D%2B%40%5Ba-zA-Z0-9%5D%28%5Ba-zA-Z0-9-%5D*%5Ba-zA-Z0-9%5D%29%3F%28%5C.%5Ba-zA-Z0-9%5D%28%5Ba-zA-Z0-9-%5D*%5Ba-zA-Z0-9%5D%29%3F%29%2B%24&testString=use%40example%0Auser%40-bad.com%0Auser%40exampl.com%0Auser%40my-%0Acompaby.example.com%0Auserexample.com%0Aa%40b.cd%0Auser%40%40example.com%0Auser+%40%40example.com%0A&flags=gm&flavor=pcre2&delimiter=%2F
const EMAIL_PATTERN =
  /^[^\s@]+@[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

export const isValidWhitelistEntry = (entry: string): boolean => {
  if (entry.startsWith('@')) {
    return DOMAIN_ENTRY_PATTERN.test(entry);
  }
  return EMAIL_PATTERN.test(entry);
};

export const isEmailMatchedByEntry = (
  email: string,
  entry: string,
): boolean => {
  const normalizedEmail = email.toLowerCase();
  const normalizedEntry = entry.toLowerCase();

  if (normalizedEntry.startsWith('@*.')) {
    // Wildcard subdomain match: @*.example.com matches sub.example.com but not example.com itself
    const baseDomain = normalizedEntry.slice(3);
    const emailDomain = normalizedEmail.split('@').pop() ?? '';
    return emailDomain.endsWith(`.${baseDomain}`);
  }

  if (normalizedEntry.startsWith('@')) {
    // Strict domain match: @example.com only matches exactly example.com
    const entryDomain = normalizedEntry.slice(1);
    const emailDomain = normalizedEmail.split('@').pop() ?? '';
    return emailDomain === entryDomain;
  }

  return normalizedEmail === normalizedEntry;
};
