'use client';

import type { ComponentProps } from 'react';

import { Button } from '~/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui/tooltip';
import { cn } from '~/utils/shadcn-ui';

export type ActionsProps = ComponentProps<'div'>;

export const Actions = ({
  className,
  children,
  ...props
}: ActionsProps): JSX.Element => (
  <div className={cn('tw:flex tw:items-center tw:gap-1', className)} {...props}>
    {children}
  </div>
);

export type ActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const Action = ({
  tooltip,
  children,
  label,
  className,
  variant = 'ghost',
  size = 'sm',
  ...props
}: ActionProps): JSX.Element => {
  const button = (
    <Button
      className={cn(
        'tw:relative tw:size-9 tw:p-1.5 tw:text-muted-foreground tw:hover:text-foreground',
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
      <span className="tw:sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};
