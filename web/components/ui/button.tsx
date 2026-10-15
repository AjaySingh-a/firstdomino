// shadcn/ui Button, restyled for the journal palette.
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[4px] text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-ink text-ivory hover:bg-ink-2",
        outline: "border border-ink text-ink hover:bg-paper",
        ghost: "text-ink-2 hover:bg-paper hover:text-ink",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-[13px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
