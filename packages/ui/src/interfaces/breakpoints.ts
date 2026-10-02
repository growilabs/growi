export const Breakpoint = {
  XS: 'xs',
  SM: 'sm',
  MD: 'md',
  LG: 'lg',
  XL: 'xl',
  XXL: 'xxl',
} as const;
export type Breakpoint = (typeof Breakpoint)[keyof typeof Breakpoint];
