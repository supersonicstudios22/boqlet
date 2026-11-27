# Design system

**The look is decided in `design-guidelines.md` (P43)**: palette, tokens, typefaces, shapes,
motion. That file wins wherever the two differ. This file keeps the principles and the
component list.

A work tool for professionals who read numbers all day. Very clean, no visual noise, modern,
easy to use, keyboard friendly (P23). Built with **shadcn/ui** components (preset `b38miVKzY`:
Tailwind CSS + Base UI primitives, copied into the repo and restyled through tokens), set in a
monospace face, with a display face for the expressive moments (design-guidelines.md). The proof of concept's "ruled sheet" look (a printed BoQ; the PoC is the git tag `poc-final`) is the visual reference for the sheet.

## Principles

1. **Numbers first.** Tabular figures (`font-variant-numeric: tabular-nums`), right-aligned
   quantities, units in their own column, never truncated numbers.
2. **Status is always explicit.** Source (measured / derived / manual / flagged / overridden),
   version status (working, saved, confirmed), job state and module statuses each have one badge style used everywhere.
   Colour never carries meaning alone (icon + text).
3. **Density with breathing room.** Compact rows in data tables (32 px), comfortable forms.
   A density toggle in the sheet (compact / comfortable).
4. **Plain language.** The PoC Library's sentences ("Walls are measured by area, openings over
   0.5 m² deducted") are the tone everywhere. No jargon without a tooltip linking to the glossary.
5. **Nothing hidden.** Flagged and unclassified lines are visible by default (BR-03). Filters
   show what they hide.
6. **No visual noise.** Hairline borders instead of boxes and shadows; shadows only on
   popovers and dialogs. Colour is rare and means something (the status and accent rules in
   design-guidelines.md). No decorative icons, illustrations or gradients; an icon appears only where
   it carries meaning, always with text or a tooltip. Generous whitespace around the work
   area, density inside tables.
7. **Monospace everywhere, tuned for reading.** Numbers align without effort and the UI reads
   like a precise instrument. Long texts (item texts, explanations, help) are capped at about
   72 characters per line, with 1.6 line height, so monospace prose stays readable.

## Tokens

All tokens (colour for light and dark, data colours, type scale, radius 2 px, spacing 4 px grid,
density, motion) are defined in `design-guidelines.md`. Components read them through CSS
variables; no colour, size or font is hard-coded in a component.

## Components

Built in `apps/app/src/components`. There is no Storybook or component gallery: a component is
documented by its doc comment and seen in the screens that use it.

What exists today (checked against the code in review B-17, UX-047); "not built" means no shared
component: a screen that needs one uses a native element or its own markup.

**shadcn/ui primitives** (`components/ui`, restyled to the tokens above): built: Alert dialog, Badge,
Button, Dialog, Dropdown menu, Input, Label, Separator, Skeleton, Toasts (Sonner), Table. Selects are
native (`components/native-select.tsx`; the unused shadcn Select was removed). Not built: Combobox /
Command, Sheet, Popover, Tabs (each screen has its URL-bound tab bar), Tooltip, Breadcrumb, Progress,
Checkbox, Radio group, Switch (native inputs), Resizable panels.

**Product components.** Built: App shell (top bar with org switcher, notifications bell, theme switch
and user menu; left nav; project sub-nav), Data table (the BoQ sheet: virtualised, sticky header,
grouping rows with subtotals, column chooser, keyboard navigation), Line detail panel (not resizable),
Status badges (source, version, BoQ, job), Dialog / Confirm (`components/confirm-dialog.tsx`), Limit
dialog, Error and not-found views, Notification bell and list, Presence avatars, Term picker (names,
questions), Code picker (classifications), File drop (code-list import, the sheet), Selector fields of
scope rules and the Library, Readable formula display, Diff cells (before → after, Δ, Δ%, change
report), Inline edit with edit marker and restore (F06 §6), "How it is calculated" step list (F06 §5),
Shared filter (sheet + 3D, F07 §9), the setup wizard's step frame (F16), Session takeover screen
(F01 §10). Not built: Progress with job stages, a shared Empty state, Form fields for decimal money,
date-time with timezone and a light markdown editor, Keyboard shortcut hints, Breadcrumbs, a resizable
detail panel, Comparison cell (rate, amount, flags; pricing module, not built).

## Accessibility

WCAG 2.2 AA (nfr.md). Every interactive element is reachable by keyboard. Focus is visible.
Data tables use grid semantics with arrow-key navigation. Dialogs trap focus. Badges include
text. The viewer has a non-3D alternative list.
