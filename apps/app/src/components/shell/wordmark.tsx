import { APP_NAME } from "@/config";
import { cn } from "@/lib/utils";
import { LOGO_B, LOGO_LET, LOGO_O, LOGO_Q, LOGO_VIEW_BOX } from "./logo";

/**
 * The wordmark: the owner's logo (docs/brand/boqlet.svg), sized by the font size like text
 * (`text-display-sm` and so on); "boq" in `--brand`, "let" in the text colour (design-guidelines.md "Brand").
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={LOGO_VIEW_BOX}
      role="img"
      aria-label={APP_NAME}
      className={cn("inline-block h-[0.94em] w-auto shrink-0 text-[22px]", className)}
    >
      <g fill="var(--brand)">
        <path d={LOGO_B} />
        <path d={LOGO_O} />
        <path d={LOGO_Q} />
      </g>
      <g fill="currentColor">
        {LOGO_LET.map((d) => <path key={d} d={d} />)}
      </g>
    </svg>
  );
}
