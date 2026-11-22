import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:not-disabled:translate-y-px disabled:cursor-not-allowed disabled:border-dashed disabled:border-input disabled:bg-transparent disabled:font-medium disabled:text-muted-foreground aria-pressed:border-link aria-pressed:bg-selection aria-pressed:font-semibold aria-pressed:text-link aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // P55: the primary is the next step, one per screen, in the brand purple. Secondary has a
        // 3:1 control border (--input); quiet ("ghost") is for toolbars and menus. Disabled is a
        // dashed outline in muted text at every level; a toggle that is on (aria-pressed) is selected,
        // never primary.
        default: "bg-action font-semibold text-action-foreground hover:bg-action-hover",
        outline:
          "border-input hover:border-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-hover aria-expanded:bg-hover aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
        // A red fill with its foreground (4.9:1 light, 5.6:1 dark), darker or lighter on hover; the
        // shared full-strength focus ring (TF-162).
        destructive:
          "bg-destructive font-semibold text-destructive-foreground hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_12%)]",
        link: "text-link underline-offset-4 hover:underline disabled:border-transparent",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 text-ui has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-6 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-8 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
