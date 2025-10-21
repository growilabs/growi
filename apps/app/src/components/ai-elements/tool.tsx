"use client";

import { Badge } from "~/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { CodeBlock } from "./code-block";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("tw:not-prose tw:mb-4 tw:w-full tw:rounded-md tw:border", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  const labels = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "output-available": "Completed",
    "output-error": "Error",
  } as const;

  const icons = {
    "input-streaming": <CircleIcon className="tw:size-4" />,
    "input-available": <ClockIcon className="tw:size-4 tw:animate-pulse" />,
    "output-available": <CheckCircleIcon className="tw:size-4 tw:text-green-600" />,
    "output-error": <XCircleIcon className="tw:size-4 tw:text-red-600" />,
  } as const;

  return (
    <Badge className="tw:gap-1.5 tw:rounded-full tw:text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "tw:flex tw:w-full tw:items-center tw:justify-between tw:gap-4 tw:p-3",
      className
    )}
    {...props}
  >
    <div className="tw:flex tw:items-center tw:gap-2">
      <WrenchIcon className="tw:size-4 tw:text-muted-foreground" />
      <span className="tw:font-medium tw:text-sm">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="tw:size-4 tw:text-muted-foreground tw:transition-transform tw:group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-top-2 tw:data-[state=open]:slide-in-from-top-2 tw:text-popover-foreground tw:outline-none tw:data-[state=closed]:animate-out tw:data-[state=open]:animate-in",
      className
    )}
    {...props}
  />
);

export type ToolInputProps = ComponentProps<"div"> & {
  input: ToolUIPart["input"];
};

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => (
  <div className={cn("tw:space-y-2 tw:overflow-hidden tw:p-4", className)} {...props}>
    <h4 className="tw:font-medium tw:text-muted-foreground tw:text-xs tw:uppercase tw:tracking-wide">
      Parameters
    </h4>
    <div className="tw:rounded-md tw:bg-muted/50">
      <CodeBlock code={JSON.stringify(input, null, 2)} language="json" />
    </div>
  </div>
);

export type ToolOutputProps = ComponentProps<"div"> & {
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
};

export const ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}: ToolOutputProps) => {
  if (!(output || errorText)) {
    return null;
  }

  let Output = <div>{output as ReactNode}</div>;

  if (typeof output === "object" && !isValidElement(output)) {
    Output = (
      <CodeBlock code={JSON.stringify(output, null, 2)} language="json" />
    );
  } else if (typeof output === "string") {
    Output = <CodeBlock code={output} language="json" />;
  }

  return (
    <div className={cn("tw:space-y-2 tw:p-4", className)} {...props}>
      <h4 className="tw:font-medium tw:text-muted-foreground tw:text-xs tw:uppercase tw:tracking-wide">
        {errorText ? "Error" : "Result"}
      </h4>
      <div
        className={cn(
          "tw:overflow-x-auto tw:rounded-md tw:text-xs tw:[&_table]:w-full",
          errorText
            ? "tw:bg-destructive/10 tw:text-destructive"
            : "tw:bg-muted/50 tw:text-foreground"
        )}
      >
        {errorText && <div>{errorText}</div>}
        {Output}
      </div>
    </div>
  );
};
