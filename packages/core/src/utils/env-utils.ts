/**
 * convert to boolean
 *
 */
export function toBoolean(value: string): boolean {
  return /^(true|1)$/i.test(value);
}
