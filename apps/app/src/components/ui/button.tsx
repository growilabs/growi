import type * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '~/utils/shadcn-ui';

const buttonVariants = cva(
  // eslint-disable-next-line max-len
  'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:whitespace-nowrap tw:rounded-md tw:text-sm tw:font-medium tw:transition-all tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:[&_svg]:pointer-events-none tw:[&_svg:not([class*=size-])]:size-4 tw:shrink-0 tw:[&_svg]:shrink-0 tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-ring/50 tw:focus-visible:ring-[3px] tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default:
          'tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90',
        destructive:
          // eslint-disable-next-line max-len
          'tw:bg-destructive tw:text-white tw:hover:bg-destructive/90 tw:focus-visible:ring-destructive/20 tw:dark:focus-visible:ring-destructive/40 tw:dark:bg-destructive/60',
        outline:
          // eslint-disable-next-line max-len
          'tw:border tw:bg-background tw:shadow-xs tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:bg-input/30 tw:dark:border-input tw:dark:hover:bg-input/50',
        secondary:
          'tw:bg-secondary tw:text-secondary-foreground tw:hover:bg-secondary/80',
        ghost:
          'tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:hover:bg-accent/50',
        link: 'tw:text-primary tw:underline-offset-4 tw:hover:underline',
      },
      size: {
        default: 'tw:h-9 tw:px-4 tw:py-2 tw:has-[>svg]:px-3',
        sm: 'tw:h-8 tw:rounded-md tw:gap-1.5 tw:px-3 tw:has-[>svg]:px-2.5',
        lg: 'tw:h-10 tw:rounded-md tw:px-6 tw:has-[>svg]:px-4',
        icon: 'tw:size-9',
        'icon-sm': 'tw:size-8',
        'icon-lg': 'tw:size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
