'use client';

import type * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { cn } from '~/utils/shadcn-ui';

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: ignore
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:group/input-group tw:border-input tw:dark:bg-input/30 tw:relative tw:flex tw:w-full tw:items-center tw:rounded-md tw:border tw:shadow-xs tw:transition-[color,box-shadow] tw:outline-none',
        'tw:h-9 tw:min-w-0 tw:has-[>textarea]:h-auto',

        // Variants based on alignment.
        'tw:has-[>[data-align=inline-start]]:[&>input]:pl-2',
        'tw:has-[>[data-align=inline-end]]:[&>input]:pr-2',
        'tw:has-[>[data-align=block-start]]:h-auto tw:has-[>[data-align=block-start]]:flex-col tw:has-[>[data-align=block-start]]:[&>input]:pb-3',
        'tw:has-[>[data-align=block-end]]:h-auto tw:has-[>[data-align=block-end]]:flex-col tw:has-[>[data-align=block-end]]:[&>input]:pt-3',

        // Focus state.
        // eslint-disable-next-line max-len
        'tw:has-[[data-slot=input-group-control]:focus-visible]:border-ring tw:has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 tw:has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]',

        // Error state.
        // eslint-disable-next-line max-len
        'tw:has-[[data-slot][aria-invalid=true]]:ring-destructive/20 tw:has-[[data-slot][aria-invalid=true]]:border-destructive tw:dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40',

        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  // eslint-disable-next-line max-len
  'tw:text-muted-foreground tw:flex tw:h-auto tw:cursor-text tw:items-center tw:justify-center tw:gap-2 tw:py-1.5 tw:text-sm tw:font-medium tw:select-none tw:[&>svg:not([class*=size-])]:size-4 tw:[&>kbd]:rounded-[calc(var(--radius)-5px)] tw:group-data-[disabled=true]/input-group:opacity-50',
  {
    variants: {
      align: {
        'inline-start':
          'tw:order-first tw:pl-3 tw:has-[>button]:ml-[-0.45rem] tw:has-[>kbd]:ml-[-0.35rem]',
        'inline-end':
          'tw:order-last tw:pr-3 tw:has-[>button]:mr-[-0.45rem] tw:has-[>kbd]:mr-[-0.35rem]',
        'block-start':
          'tw:order-first tw:w-full tw:justify-start tw:px-3 tw:pt-3 tw:[.border-b]:pb-3 tw:group-has-[>input]/input-group:pt-2.5',
        'block-end':
          'tw:order-last tw:w-full tw:justify-start tw:px-3 tw:pb-3 tw:[.border-t]:pt-3 tw:group-has-[>input]/input-group:pb-2.5',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: ignore
    // biome-ignore lint/a11y/useSemanticElements: ignore
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) {
          return;
        }
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva(
  'tw:text-sm tw:shadow-none tw:flex tw:gap-2 tw:items-center',
  {
    variants: {
      size: {
        xs: 'tw:h-6 tw:gap-1 tw:px-2 tw:rounded-[calc(var(--radius)-5px)] tw:[&>svg:not([class*=size-])]:size-3.5 tw:has-[>svg]:px-2',
        sm: 'tw:h-8 tw:px-2.5 tw:gap-1.5 tw:rounded-md tw:has-[>svg]:px-2.5',
        'icon-xs':
          'tw:size-6 tw:rounded-[calc(var(--radius)-5px)] tw:p-0 tw:has-[>svg]:p-0',
        'icon-sm': 'tw:size-8 tw:p-0 tw:has-[>svg]:p-0',
      },
    },
    defaultVariants: {
      size: 'xs',
    },
  },
);

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'tw:text-muted-foreground tw:flex tw:items-center tw:gap-2 tw:text-sm tw:[&_svg]:pointer-events-none tw:[&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'tw:flex-1 tw:rounded-none tw:border-0 tw:bg-transparent tw:shadow-none tw:focus-visible:ring-0 tw:dark:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'tw:flex-1 tw:resize-none tw:rounded-none tw:border-0 tw:bg-transparent tw:py-3 tw:shadow-none tw:focus-visible:ring-0 tw:dark:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
