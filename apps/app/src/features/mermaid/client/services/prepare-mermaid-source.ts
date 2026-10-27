import { JSON_SCHEMA, load } from 'js-yaml';

const darkThemeDirective = '%%{init: {"theme": "dark"}}%%\n';
// Match Mermaid's frontmatter boundaries without rewriting the original source.
const frontmatterPattern =
  /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

export const prepareMermaidSource = (
  source: string,
  isDarkMode: boolean,
): string => {
  if (!isDarkMode) return source;

  const frontmatter = source.match(frontmatterPattern);
  if (frontmatter == null) {
    // Leave an unterminated header to Mermaid's normal error handling.
    if (/^[^\S\n\r]*---(?:\s*[\n\r]|$)/.test(source)) return source;
    return darkThemeDirective + source;
  }

  const [, indent, body] = frontmatter;
  const yaml = body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
  try {
    const metadata: unknown = load(yaml, { schema: JSON_SCHEMA });
    const config =
      metadata != null && typeof metadata === 'object' && 'config' in metadata
        ? metadata.config
        : undefined;
    if (
      config != null &&
      typeof config === 'object' &&
      Object.hasOwn(config, 'theme')
    ) {
      return source;
    }
  } catch {
    return source;
  }

  const end = frontmatter[0].length;
  return source.slice(0, end) + darkThemeDirective + source.slice(end);
};
