const isPrimitiveComparison = (value1: unknown, value2: unknown): boolean => {
  return (
    value1 === null ||
    value2 === null ||
    typeof value1 !== 'object' ||
    typeof value2 !== 'object'
  );
};

export const isDeepEquals = <T extends object>(
  obj1: T,
  obj2: T,
  visited = new WeakMap(),
): boolean => {
  // If references are identical, return true
  if (obj1 === obj2) {
    return true;
  }

  // Use simple comparison for null or primitive values
  if (isPrimitiveComparison(obj1, obj2)) {
    return obj1 === obj2;
  }

  // Check for circular references
  if (visited.has(obj1)) {
    return visited.get(obj1) === obj2;
  }
  visited.set(obj1, obj2);

  // Compare number of properties
  const typedKeys1 = Object.keys(obj1) as (keyof typeof obj1)[];
  const typedKeys2 = Object.keys(obj2) as (keyof typeof obj2)[];

  if (typedKeys1.length !== typedKeys2.length) {
    return false;
  }

  // Compare all properties
  return typedKeys1.every((key) => {
    const val1 = obj1[key];
    const val2 = obj2[key];

    // Handle arrays comparison
    if (Array.isArray(val1) && Array.isArray(val2)) {
      if (val1.length !== val2.length) {
        return false;
      }

      return val1.every((item, i) => {
        if (!isPrimitiveComparison(item, val2[i])) {
          return isDeepEquals(item, val2[i], visited);
        }
        return item === val2[i];
      });
    }

    // Recursively compare objects
    if (!isPrimitiveComparison(val1, val2)) {
      return isDeepEquals(val1 as object, val2 as object, visited);
    }

    // Compare primitive values
    return val1 === val2;
  });
};
