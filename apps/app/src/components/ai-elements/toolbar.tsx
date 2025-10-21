import type { ComponentProps } from 'react';

import { NodeToolbar, Position } from '@xyflow/react';

import { cn } from '~/lib/utils';

type ToolbarProps = ComponentProps<typeof NodeToolbar>;

export const Toolbar = ({ className, ...props }: ToolbarProps) => (
  <NodeToolbar
    className={cn(
      'tw:flex tw:items-center tw:gap-1 tw:rounded-sm tw:border tw:bg-background tw:p-1.5',
      className,
    )}
    position={Position.Bottom}
    {...props}
  />
);
