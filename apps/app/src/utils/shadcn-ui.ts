import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Configure tailwind-merge to understand the "tw:" prefix used by Tailwind v4 prefix(tw).
// tailwind-merge appends ':' (MODIFIER_SEPARATOR) automatically, so pass 'tw' without colon.
// Without this, tw:rounded-full and tw:rounded-md are not recognised as conflicting
// and both classes remain in the output (last CSS declaration wins = rounded-md wins).
const twMerge = extendTailwindMerge({ prefix: 'tw' });

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
