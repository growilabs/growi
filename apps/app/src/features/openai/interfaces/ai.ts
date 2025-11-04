export const OpenaiServiceType = {
  OPENAI: 'openai',
  AZURE_OPENAI: 'azure-openai',
} as const;
export type OpenaiServiceType =
  (typeof OpenaiServiceType)[keyof typeof OpenaiServiceType];
export const OpenaiServiceTypes = Object.values(OpenaiServiceType);
