import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A screen's loading state (screens.md: skeletons, not spinners; TF-017): a few grey lines. */
export function LoadingLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy="true" data-testid="loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
