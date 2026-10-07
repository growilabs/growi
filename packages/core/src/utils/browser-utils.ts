export const isClient = (): boolean => {
  return (
    typeof window !== 'undefined' ||
    (typeof navigator !== 'undefined' && navigator.webdriver)
  );
};

export const isServer = (): boolean => {
  return !isClient();
};
