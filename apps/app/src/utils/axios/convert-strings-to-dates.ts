const isoDateRegex =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

export type DateConvertible =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | DateConvertible[]
  | { [key: string]: DateConvertible };

/**
 * Converts string to dates recursively.
 *
 * @param data - Data to be transformed to Date if applicable.
 * @param seen - Set containing data that has been through the function before.
 * @returns - Data containing transformed Dates.
 */
function convertStringsToDatesRecursive(
  data: DateConvertible,
  seen: Set<unknown>,
): DateConvertible {
  if (typeof data !== 'object' || data === null) {
    if (typeof data === 'string' && isoDateRegex.test(data)) {
      return new Date(data);
    }
    return data;
  }

  // Check for circular reference
  if (seen.has(data)) {
    return data;
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => convertStringsToDatesRecursive(item, seen));
  }

  const newData: Record<string, DateConvertible> = {};

  for (const key of Object.keys(data as object)) {
    const value = (data as Record<string, DateConvertible>)[key];

    if (typeof value === 'string' && isoDateRegex.test(value)) {
      newData[key] = new Date(value);
    } else if (typeof value === 'object' && value !== null) {
      newData[key] = convertStringsToDatesRecursive(value, seen);
    } else {
      newData[key] = value;
    }
  }

  return newData;
}

// Function overloads for better type inference
export function convertStringsToDates(data: string): string | Date;
export function convertStringsToDates<T extends DateConvertible>(
  data: T,
): DateConvertible;
export function convertStringsToDates<T extends DateConvertible[]>(
  data: T,
): DateConvertible[];
export function convertStringsToDates<
  T extends Record<string, DateConvertible>,
>(data: T): Record<string, DateConvertible>;
export function convertStringsToDates(data: DateConvertible): DateConvertible {
  return convertStringsToDatesRecursive(data, new Set());
}
