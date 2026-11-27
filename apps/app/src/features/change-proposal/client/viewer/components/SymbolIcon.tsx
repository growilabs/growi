import type { JSX } from 'react';

type SymbolIconProps = {
  readonly name: string;
  readonly className?: string;
};

// Decorative only: the ligature text must stay out of accessible names, so the
// meaning always comes from a word placed next to the icon.
export const SymbolIcon = ({
  name,
  className = '',
}: SymbolIconProps): JSX.Element => (
  <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
    {name}
  </span>
);
