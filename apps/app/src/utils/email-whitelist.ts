const DOMAIN_ENTRY_PATTERN =
  /^@[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (normalizedEntry.startsWith('@')) {
    const entryDomain = normalizedEntry.slice(1);
    const emailDomain = normalizedEmail.split('@').pop() ?? '';
    // Allow exact domain match and subdomain match (e.g. sub.example.com matches @example.com)
    return (
      emailDomain === entryDomain || emailDomain.endsWith(`.${entryDomain}`)
    );
  }
  return normalizedEmail === normalizedEntry;
};
