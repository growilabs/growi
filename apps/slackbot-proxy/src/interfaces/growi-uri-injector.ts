export type GrowiUriWithOriginalData = {
  growiUri: string;
  originalData: string;
};

export type TypedBlock = {
  type: string;
};

/**
 * Type guard for GrowiUriWithOriginalData
 * @param data
 * @returns
 */
export const isGrowiUriWithOriginalData = (
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  data: any,
): data is GrowiUriWithOriginalData => {
  return data.growiUri != null && data.originalData != null;
};

export interface GrowiUriInjector<ISDATA, IDATA, ESDATA, EDATA> {
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  shouldHandleToInject(data: ISDATA & any): data is IDATA;
  inject(data: IDATA, growiUri: string): void;

  // biome-ignore lint/suspicious/noExplicitAny: ignore
  shouldHandleToExtract(data: ESDATA & any): data is EDATA;
  extract(data: EDATA): GrowiUriWithOriginalData;
}
