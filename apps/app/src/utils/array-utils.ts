// converts non-array item to array

export const toArrayIfNot = <T = unknown>(item?: T | T[]): T[] => {
  if (item == null) {
    return [];
  }

  if (Array.isArray(item)) {
    return item;
  }

  return [item];
};
