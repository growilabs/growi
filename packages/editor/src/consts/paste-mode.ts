export const PasteMode = {
  both: 'both',
  text: 'text',
  file: 'file',
} as const;

export const DEFAULT_PASTE_MODE = PasteMode.both;
export const AllPasteMode = Object.values(PasteMode);
export type PasteMode = (typeof PasteMode)[keyof typeof PasteMode];
