import type * as React from 'react';

import { cn } from '~/utils/shadcn-ui';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:file:text-foreground tw:placeholder:text-muted-foreground tw:selection:bg-primary tw:selection:text-primary-foreground tw:dark:bg-input/30 tw:border-input tw:h-9 tw:w-full tw:min-w-0 tw:rounded-md tw:border tw:bg-transparent tw:px-3 tw:py-1 tw:text-base tw:shadow-xs tw:transition-[color,box-shadow] tw:outline-none tw:file:inline-flex tw:file:h-7 tw:file:border-0 tw:file:bg-transparent tw:file:text-sm tw:file:font-medium tw:disabled:pointer-events-none tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:md:text-sm',
        'tw:focus-visible:border-ring tw:focus-visible:ring-ring/50 tw:focus-visible:ring-[3px]',
        'tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
