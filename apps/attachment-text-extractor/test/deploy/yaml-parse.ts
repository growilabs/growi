import { parseAllDocuments } from 'yaml';

// Reads a deployment YAML file (the compose entry) into plain values with the
// `yaml` package, failing on any syntax error.

export type YamlValue =
  | null
  | boolean
  | number
  | string
  | YamlValue[]
  | { [key: string]: YamlValue };

const toYamlValue = (value: unknown): YamlValue => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(toYamlValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toYamlValue(item)]),
    );
  }
  throw new Error(`unexpected YAML value: ${String(value)}`);
};

// The single document in the text (throws on a syntax error, no document, or
// several documents). `merge: true` accepts compose-style `<<: *anchor`.
export const parseYaml = (text: string): YamlValue => {
  const parsed = parseAllDocuments(text, { merge: true });
  const documents = Array.isArray(parsed) ? parsed : [parsed];
  for (const document of documents) {
    if (document.errors.length > 0) throw document.errors[0];
  }
  const values = documents
    .map((document) => toYamlValue(document.toJS()))
    .filter((value) => value !== null);
  if (values.length !== 1) {
    throw new Error(
      `expected exactly one YAML document, found ${values.length}`,
    );
  }
  return values[0];
};
