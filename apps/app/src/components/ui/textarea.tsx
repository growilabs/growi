import type * as React from 'react';

import { cn } from '~/utils/shadcn-ui';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // eslint-disable-next-line max-len
        'tw:border-input tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-ring/50 tw:aria-invalid:ring-destructive/20 tw:dark:aria-invalid:ring-destructive/40 tw:aria-invalid:border-destructive tw:dark:bg-input/30 tw:flex tw:field-sizing-content tw:min-h-16 tw:w-full tw:rounded-md tw:border tw:bg-transparent tw:px-3 tw:py-2 tw:text-base tw:shadow-xs tw:transition-[color,box-shadow] tw:outline-none tw:focus-visible:ring-[3px] tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
