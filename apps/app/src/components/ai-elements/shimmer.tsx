'use client';

import type React from 'react';
import { type ElementType, type JSX, memo } from 'react';

import { cn } from '~/utils/shadcn-ui';

export type TextShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
};

const ShimmerComponent = ({
  children,
  // <span> default: this component is rendered inside a Radix
  // CollapsibleTrigger (a <button>), where a block-level <p> is invalid HTML.
  as: Component = 'span',
  className,
}: TextShimmerProps): JSX.Element => {
  return (
    <Component
      className={cn(
        'tw:inline-block tw:animate-pulse tw:text-muted-foreground',
        className,
      )}
    >
      {children}
    </Component>
  );
};

export const Shimmer: React.NamedExoticComponent<TextShimmerProps> =
  memo(ShimmerComponent);
