import { cn } from "@/lib/utils";

type Props = {
  label?: string;
  progress?: number;
  /** `link` draws the whole rule in purple (the result of "How it is calculated"); `progress` implies it. */
  tone?: "ink" | "link";
  /** Vertical: ticks at the top and bottom, the label beside the rule, read bottom to top. */
  vertical?: boolean;
  className?: string;
  labelClassName?: string;
  /** On the drawn line only (the landing page draws it in with a transform). */
  lineClassName?: string;
};

/**
 * The dimension line (design-guidelines.md): a 2 px rule with 10 px end ticks and, optionally, a
 * measurement above it (beside it when vertical). Purple when it shows progress (`progress` 0…1 draws
 * that share in purple) or with `tone="link"`.
 */
export function DimensionRule({ label, progress, tone, vertical, className, labelClassName, lineClassName }: Props) {
  const share = progress === undefined ? 1 : Math.max(0, Math.min(1, progress));
  const color = progress === undefined && tone !== "link" ? "bg-foreground" : "bg-link";
  if (vertical)
    return (
      <div className={cn("flex h-full items-center gap-1.5", className)} aria-hidden={label === undefined ? true : undefined}>
        {label !== undefined && (
          <span className={cn("rotate-180 text-ui tabular-nums [writing-mode:vertical-rl]", labelClassName)}>{label}</span>
        )}
        <div className="relative h-full w-2.5">
          <span className={cn("absolute top-0 left-0 h-0.5 w-2.5", color)} />
          <span className={cn("absolute top-0 bottom-0 left-1 w-0.5", color, lineClassName)} />
          <span className={cn("absolute bottom-0 left-0 h-0.5 w-2.5", color)} />
        </div>
      </div>
    );
  return (
    <div className={cn("flex w-full flex-col gap-1", className)} aria-hidden={label === undefined ? true : undefined}>
      {label !== undefined && <span className={cn("self-center text-ui tabular-nums", labelClassName)}>{label}</span>}
      <div className="relative h-2.5">
        <span className={cn("absolute top-0 left-0 h-2.5 w-0.5", color)} />
        <span className="absolute top-1 right-0 left-0 h-0.5 bg-border" />
        <span
          className={cn("absolute top-1 left-0 h-0.5 transition-[width] duration-200", color, lineClassName)}
          style={{ width: `${share * 100}%` }}
        />
        <span className={cn("absolute top-0 right-0 h-2.5 w-0.5", share === 1 ? color : "bg-border")} />
      </div>
    </div>
  );
}
