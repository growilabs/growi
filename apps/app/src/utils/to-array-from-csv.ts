// converts csv item to array
export const toArrayFromCsv = (text: string): string[] => {
  if (text == null) {
    return [];
  }

  const array = text
    .split(',')
    .map((el) => el.trim())
    .filter((el) => el !== '');

  return array;
};
