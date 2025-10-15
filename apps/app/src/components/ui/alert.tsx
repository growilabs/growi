import * as React from 'react';

import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '~/lib/utils';

const alertVariants = cva(
  'tw:relative tw:w-full tw:rounded-lg tw:border tw:px-4 tw:py-3 tw:text-sm tw:grid tw:has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] tw:grid-cols-[0_1fr] tw:has-[>svg]:gap-x-3 tw:gap-y-0.5 tw:items-start tw:[&>svg]:size-4 tw:[&>svg]:translate-y-0.5 tw:[&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'tw:bg-card tw:text-card-foreground',
        destructive:
          'tw:text-destructive tw:bg-card tw:[&>svg]:text-current tw:*:data-[slot=alert-description]:text-destructive/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'tw:col-start-2 tw:line-clamp-1 tw:min-h-4 tw:font-medium tw:tracking-tight',
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'tw:text-muted-foreground tw:col-start-2 tw:grid tw:justify-items-start tw:gap-1 tw:text-sm tw:[&_p]:leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
