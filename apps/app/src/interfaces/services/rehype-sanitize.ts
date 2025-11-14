import type { defaultSchema } from 'hast-util-sanitize';

type Attributes = typeof defaultSchema.attributes;

export const RehypeSanitizeType = {
  RECOMMENDED: 'Recommended',
  CUSTOM: 'Custom',
} as const;

export type RehypeSanitizeType =
  (typeof RehypeSanitizeType)[keyof typeof RehypeSanitizeType];

export type RehypeSanitizeConfiguration = {
  isEnabledXssPrevention: boolean;
  sanitizeType: RehypeSanitizeType;
  customTagWhitelist?: Array<string> | null;
  customAttrWhitelist?: Attributes | null;
};
