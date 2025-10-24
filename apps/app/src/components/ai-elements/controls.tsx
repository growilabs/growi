'use client';

import type { ComponentProps } from 'react';

import { Controls as ControlsPrimitive } from '@xyflow/react';

import { cn } from '~/lib/utils';

export type ControlsProps = ComponentProps<typeof ControlsPrimitive>;

export const Controls = ({ className, ...props }: ControlsProps) => (
  <ControlsPrimitive
    className={cn(
      'tw:gap-px tw:overflow-hidden tw:rounded-md tw:border tw:bg-card tw:p-1 tw:shadow-none!',
      'tw:[&>button]:rounded-md tw:[&>button]:border-none! tw:[&>button]:bg-transparent! tw:[&>button]:hover:bg-secondary!',
      className,
    )}
    {...props}
  />
);
