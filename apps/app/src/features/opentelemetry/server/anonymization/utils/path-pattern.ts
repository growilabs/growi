const ANONYMIZED = '[ANONYMIZED]';

// A single trailing slash is tolerated because Express (non-strict routing)
// serves the same route with it, so it must be anonymized the same way.
const splitSegments = (path: string): string[] | null => {
  if (!path.startsWith('/')) {
    return null;
  }
  const body = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return body.split('/').slice(1);
};

type Matched = {
  readonly segments: readonly string[];
  readonly names: readonly (string | null)[];
};

const matchSegments = (pattern: string, path: string): Matched | null => {
  const patternSegments = pattern.split('/').slice(1);
  const segments = splitSegments(path);
  if (segments == null || segments.length !== patternSegments.length) {
    return null;
  }

  const names: (string | null)[] = [];
  for (let i = 0; i < patternSegments.length; i++) {
    const p = patternSegments[i];
    if (p.startsWith(':')) {
      if (segments[i] === '') {
        return null;
      }
      names.push(p.slice(1));
    } else if (p === segments[i]) {
      names.push(null);
    } else {
      return null;
    }
  }
  return { segments, names };
};

/**
 * Match a `/`-separated route pattern (`:name` matches exactly one non-empty segment)
 * @returns The raw value of each `:name` segment, or null if the path does not match
 */
export const matchPathPattern = (
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | null => {
  const matched = matchSegments(pattern, path);
  if (matched == null) {
    return null;
  }
  const params: Record<string, string> = {};
  matched.names.forEach((name, i) => {
    if (name != null) {
      params[name] = matched.segments[i];
    }
  });
  return params;
};

/**
 * Replace the segments of `path` bound to the given `:name`s with [ANONYMIZED]
 * @returns The path unchanged if it does not match the pattern
 */
export const redactPathParams = (
  pattern: string,
  path: string,
  params: readonly string[],
): string => {
  const matched = matchSegments(pattern, path);
  if (matched == null) {
    return path;
  }
  const redacted = matched.segments.map((segment, i) => {
    const name = matched.names[i];
    return name != null && params.includes(name) ? ANONYMIZED : segment;
  });
  const trailing = path.length > 1 && path.endsWith('/') ? '/' : '';
  return `/${redacted.join('/')}${trailing}`;
};
