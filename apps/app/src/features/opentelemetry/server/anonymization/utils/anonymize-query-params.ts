import { diag } from '@opentelemetry/api';

const logger = diag.createComponentLogger({
  namespace: 'growi:anonymization:anonymize-query-params',
});

/**
 * Try to parse JSON array, return null if invalid
 */
function tryParseJsonArray(value: string): unknown[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Anonymize specific query parameters in HTTP target URL
 * @param target - The HTTP target URL with query parameters
 * @param paramNames - Array of parameter names to anonymize
 * @returns Anonymized HTTP target URL
 */
export function anonymizeQueryParams(
  target: string,
  paramNames: string[],
): string {
  try {
    const url = new URL(target, 'http://localhost');
    const searchParams = new URLSearchParams(url.search);
    let hasChange = false;

    for (const paramName of paramNames) {
      // Handle regular parameter (including JSON arrays)
      if (searchParams.has(paramName)) {
        const value = searchParams.get(paramName);
        // Anonymize parameter even if it's empty (null check only)
        if (value !== null) {
          let replacement = '[ANONYMIZED]';
          if (value.startsWith('[') && value.endsWith(']')) {
            const jsonArray = tryParseJsonArray(value);
            if (jsonArray && jsonArray.length > 0) {
              replacement = '["[ANONYMIZED]"]';
            }
          }
          searchParams.set(paramName, replacement);
          hasChange = true;
        }
      }

      // Handle array-style parameters (paramName[])
      const arrayParam = `${paramName}[]`;
      if (searchParams.has(arrayParam)) {
        searchParams.delete(arrayParam);
        searchParams.set(arrayParam, '[ANONYMIZED]');
        hasChange = true;
      }
    }

    return hasChange
      ? `${url.pathname}?${searchParams.toString()}${url.hash}`
      : target;
  } catch (error) {
    logger.warn(
      `Failed to anonymize query parameters [${paramNames.join(', ')}]: ${error}`,
    );
    return target;
  }
}
