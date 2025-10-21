// biome-ignore lint/style/noRestrictedImports: This is the axios wrapper utility
import axios from 'axios';
import { formatISO } from 'date-fns';
import qs from 'qs';

// biome-ignore lint/style/noRestrictedImports: Re-exporting axios types
export * from 'axios';

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

// Determine the base array of transformers
let baseTransformers = axios.defaults.transformResponse;

if (baseTransformers == null) {
  baseTransformers = [];
} else if (!Array.isArray(baseTransformers)) {
  // If it's a single transformer function, wrap it in an array
  baseTransformers = [baseTransformers];
}

const customAxios = axios.create({
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
  },

  transformResponse: baseTransformers.concat((data) => {
    return convertStringsToDates(data);
  }),
});

// serialize Date config: https://github.com/axios/axios/issues/1548#issuecomment-548306666
customAxios.interceptors.request.use((config) => {
  config.paramsSerializer = (params) =>
    qs.stringify(params, {
      serializeDate: (date: Date) => {
        return formatISO(date, { representation: 'complete' });
      },
    });
  return config;
});

export default customAxios;
