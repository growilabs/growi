---
name: tailwind-to-bootstrap
description: Tailwind CSS (tw: prefix) to Bootstrap 5 class conversion reference. Use when converting shadcn/ui components or tw:-prefixed styles to Bootstrap.
---

# Tailwind to Bootstrap Conversion Guide

GROWI uses Bootstrap 5.3.8 as the primary CSS framework. Tailwind CSS v4 is partially integrated in `apps/app` only, with a `tw:` prefix (`@import "tailwindcss" prefix(tw)`) to avoid conflicts. 12 shadcn/ui components exist at `apps/app/src/components/ui/`. This skill provides mapping and guidance for converting `tw:`-prefixed classes to Bootstrap equivalents.

## Quick Reference — Class Mapping Tables

### Layout & Display

| Tailwind | Bootstrap | Notes |
|----------|-----------|-------|
| `tw:flex` | `d-flex` | |
| `tw:inline-flex` | `d-inline-flex` | |
| `tw:grid` | `d-grid` | |
| `tw:block` | `d-block` | |
| `tw:inline-block` | `d-inline-block` | |
| `tw:inline` | `d-inline` | |
| `tw:hidden` | `d-none` | |
| `tw:flex-col` | `flex-column` | |
| `tw:flex-col-reverse` | `flex-column-reverse` | |
| `tw:flex-row` | `flex-row` | |
| `tw:flex-wrap` | `flex-wrap` | |
| `tw:flex-nowrap` | `flex-nowrap` | |
| `tw:items-center` | `align-items-center` | |
| `tw:items-start` | `align-items-start` | |
| `tw:items-end` | `align-items-end` | |
| `tw:items-stretch` | `align-items-stretch` | |
| `tw:justify-center` | `justify-content-center` | |
| `tw:justify-between` | `justify-content-between` | |
| `tw:justify-end` | `justify-content-end` | |
| `tw:justify-start` | `justify-content-start` | |
| `tw:self-center` | `align-self-center` | |
| `tw:self-start` | `align-self-start` | |
| `tw:self-end` | `align-self-end` | |
| `tw:shrink-0` | `flex-shrink-0` | |
| `tw:grow` | `flex-grow-1` | |
| `tw:relative` | `position-relative` | |
| `tw:absolute` | `position-absolute` | |
| `tw:fixed` | `position-fixed` | |
| `tw:sticky` | `position-sticky` | |
| `tw:inset-0` | `top-0 start-0 bottom-0 end-0` | Combine 4 classes |
| `tw:top-0` | `top-0` | |
| `tw:bottom-0` | `bottom-0` | |
| `tw:start-0` / `tw:left-0` | `start-0` | |
| `tw:end-0` / `tw:right-0` | `end-0` | |
| `tw:overflow-hidden` | `overflow-hidden` | |
| `tw:overflow-auto` | `overflow-auto` | |
| `tw:overflow-y-auto` | `overflow-y-auto` | Custom CSS: `overflow-y: auto` |
| `tw:overflow-x-hidden` | — | Custom CSS: `overflow-x: hidden` |
| `tw:z-50` | `z-3` | Bootstrap z-index scale differs; use custom CSS for exact values |

### Spacing

> **Scale difference**: Tailwind uses 4px increments (1=4px, 2=8px, 3=12px, 4=16px, 6=24px). Bootstrap uses a 6-level scale (1=0.25rem, 2=0.5rem, 3=1rem, 4=1.5rem, 5=3rem). Approximate mapping below.

| Tailwind | Bootstrap | Approx px |
|----------|-----------|-----------|
| `tw:p-0` / `tw:m-0` | `p-0` / `m-0` | 0 |
| `tw:p-1` / `tw:m-1` | `p-1` / `m-1` | TW:4px, BS:4px |
| `tw:p-2` / `tw:m-2` | `p-2` / `m-2` | TW:8px, BS:8px |
| `tw:p-3` / `tw:m-3` | `p-2` / `m-2` | TW:12px ≈ BS:8px |
| `tw:p-4` / `tw:m-4` | `p-3` / `m-3` | TW:16px, BS:16px |
| `tw:p-6` / `tw:m-6` | `p-4` / `m-4` | TW:24px, BS:24px |
| `tw:p-8` | `p-4` | TW:32px ≈ BS:24px |
| `tw:px-*` | `px-*` | Horizontal padding |
| `tw:py-*` | `py-*` | Vertical padding |
| `tw:pt-*` | `pt-*` | Padding-top |
| `tw:pb-*` | `pb-*` | Padding-bottom |
| `tw:ps-*` / `tw:pl-*` | `ps-*` | Padding-start |
| `tw:pe-*` / `tw:pr-*` | `pe-*` | Padding-end |
| `tw:mx-auto` | `mx-auto` | |
| `tw:ms-auto` / `tw:ml-auto` | `ms-auto` | |
| `tw:me-auto` / `tw:mr-auto` | `me-auto` | |
| `tw:gap-1` | `gap-1` | |
| `tw:gap-2` | `gap-2` | |
| `tw:gap-3` | `gap-2` | TW:12px ≈ BS:8px |
| `tw:gap-4` | `gap-3` | TW:16px, BS:16px |
| `tw:-mx-1` | — | Custom CSS: `margin-inline: -0.25rem` |

### Typography

| Tailwind | Bootstrap | Notes |
|----------|-----------|-------|
| `tw:text-xs` | `small` or custom | TW:12px; BS `small` is 87.5% of parent |
| `tw:text-sm` | `small` or `fs-6` | TW:14px |
| `tw:text-base` | — | TW:16px; BS default body size |
| `tw:text-lg` | `fs-5` | TW:18px |
| `tw:text-xl` | `fs-4` | TW:20px |
| `tw:font-medium` | `fw-medium` | 500 weight |
| `tw:font-semibold` | `fw-semibold` | 600 weight |
| `tw:font-bold` | `fw-bold` | 700 weight |
| `tw:font-normal` | `fw-normal` | 400 weight |
| `tw:text-center` | `text-center` | |
| `tw:text-start` / `tw:text-left` | `text-start` | |
| `tw:text-end` / `tw:text-right` | `text-end` | |
| `tw:underline` | `text-decoration-underline` | |
| `tw:no-underline` | `text-decoration-none` | |
| `tw:whitespace-nowrap` | `text-nowrap` | |
| `tw:truncate` | `text-truncate` | |
| `tw:leading-none` | `lh-1` | |
| `tw:select-none` | `user-select-none` | |
| `tw:line-clamp-1` | — | Custom CSS: `-webkit-line-clamp: 1` |
| `tw:tracking-widest` | — | Custom CSS: `letter-spacing: 0.1em` |

### Sizing

| Tailwind | Bootstrap | Notes |
|----------|-----------|-------|
| `tw:w-full` | `w-100` | |
| `tw:w-auto` | `w-auto` | |
| `tw:w-50` | `w-50` | Only 25, 50, 75, 100 available |
| `tw:h-full` | `h-100` | |
| `tw:h-auto` | `h-auto` | |
| `tw:h-screen` | `vh-100` | |
| `tw:min-w-0` | — | Custom CSS: `min-width: 0` |
| `tw:max-w-*` | — | Custom CSS: `max-width: {value}` |
| `tw:size-4` | — | Custom CSS: `width: 1rem; height: 1rem` |
| `tw:size-8` | — | Custom CSS: `width: 2rem; height: 2rem` |
| `tw:size-9` | — | Custom CSS: `width: 2.25rem; height: 2.25rem` |
| `tw:aspect-square` | `ratio ratio-1x1` | Bootstrap uses wrapper pattern |

> Bootstrap has limited sizing utilities (25/50/75/100/auto). For precise sizes (e.g., `tw:h-9`, `tw:size-4`), use custom CSS or inline styles.

### Colors & Backgrounds

> **Color semantics differ**: shadcn/ui `--primary` is dark gray (neutral), Bootstrap `--bs-primary` is blue. Map by visual intent, not by name.

| Tailwind | Bootstrap | Notes |
|----------|-----------|-------|
| `tw:bg-primary` | `bg-dark` or custom | shadcn primary = dark gray |
| `tw:bg-secondary` | `bg-light` | shadcn secondary = light gray |
| `tw:bg-destructive` | `bg-danger` | |
| `tw:bg-background` | `bg-body` | |
| `tw:bg-muted` | `bg-light` | |
| `tw:bg-accent` | `bg-light` | |
| `tw:bg-popover` | `bg-body` | |
| `tw:bg-card` | `bg-body` | |
| `tw:text-foreground` | `text-body` | |
| `tw:text-primary` | `text-dark` or custom | |
| `tw:text-primary-foreground` | `text-white` or custom | |
| `tw:text-muted-foreground` | `text-muted` | |
| `tw:text-destructive` | `text-danger` | |
| `tw:text-white` | `text-white` | |
| `tw:bg-primary/90` | — | Opacity variants: custom CSS `opacity` or `rgba()` |
| `tw:bg-black/50` | — | Custom CSS: `background: rgba(0,0,0,0.5)` |

### Borders & Radius

| Tailwind | Bootstrap | Notes |
|----------|-----------|-------|
| `tw:border` | `border` | |
| `tw:border-0` | `border-0` | |
| `tw:border-t` | `border-top` | |
| `tw:border-b` | `border-bottom` | |
| `tw:border-input` | `border` | Uses BS default border color |
| `tw:border-border` | `border` | |
| `tw:border-destructive` | `border-danger` | |
| `tw:rounded` | `rounded` | |
| `tw:rounded-md` | `rounded` | TW:6px ≈ BS:0.375rem |
| `tw:rounded-lg` | `rounded-3` | TW:8px ≈ BS:0.5rem |
| `tw:rounded-sm` | `rounded-1` | TW:4px ≈ BS:0.25rem |
| `tw:rounded-full` | `rounded-circle` | |
| `tw:rounded-none` | `rounded-0` | |
| `tw:shadow-xs` | `shadow-sm` | |
| `tw:shadow-sm` | `shadow-sm` | |
| `tw:shadow-md` | `shadow` | |
| `tw:shadow-lg` | `shadow-lg` | |

### Responsive Breakpoints

| Tailwind | Bootstrap | Pattern |
|----------|-----------|---------|
| `tw:sm:*` | `*-sm-*` or `*-sm` | TW: prefix before class; BS: infix in class |
| `tw:md:*` | `*-md-*` or `*-md` | |
| `tw:lg:*` | `*-lg-*` or `*-lg` | |
| `tw:xl:*` | `*-xl-*` or `*-xl` | |

**Example**:
- `tw:sm:flex` → `d-sm-flex`
- `tw:md:hidden` → `d-md-none`
- `tw:lg:text-start` → `text-lg-start`

## Unmappable Patterns

### Patterns Without Bootstrap Equivalent

These Tailwind patterns have no Bootstrap class equivalent and require custom CSS:

| Pattern | Examples | Alternative |
|---------|----------|-------------|
| Ring utilities | `tw:ring-*`, `tw:ring-ring/50` | `box-shadow: 0 0 0 3px var(--ring-color)` |
| Focus-visible ring | `tw:focus-visible:ring-[3px]` | Custom CSS `:focus-visible { box-shadow: ... }` |
| `:has()` selectors | `tw:has-[>svg]`, `tw:group-has-*` | Custom CSS `:has()` or JS-based class toggle |
| `data-[state=*]` | `tw:data-[state=open]:*` | Custom CSS: `[data-state="open"] { ... }` |
| Arbitrary values | `tw:[calc(...)]` | Inline `style` or custom CSS |
| Named groups | `tw:group/input-group` | Custom CSS with nested selectors |
| SVG child selectors | `tw:[&_svg]:size-4` | Custom CSS: `.component svg { width: 1rem }` |
| Opacity modifiers | `tw:bg-primary/90` | Custom CSS with `rgba()` or `opacity` |
| Arbitrary properties | `tw:[--custom-var:value]` | Inline `style` attribute |

### CSS Variable Migration (shadcn/ui → Bootstrap)

| shadcn/ui Variable | Bootstrap Variable | Notes |
|--------------------|--------------------|-------|
| `--primary` | `--bs-dark-rgb` | shadcn = dark gray; map by visual intent |
| `--primary-foreground` | `--bs-white-rgb` | |
| `--secondary` | `--bs-light-rgb` | |
| `--destructive` | `--bs-danger-rgb` | Close match |
| `--background` | `--bs-body-bg` | |
| `--foreground` | `--bs-body-color` | |
| `--muted` | `--bs-secondary-bg` | |
| `--muted-foreground` | `--bs-secondary-color` | |
| `--border` | `--bs-border-color` | |
| `--input` | `--bs-border-color` | |
| `--ring` | — | No BS equivalent; use custom CSS variable |
| `--accent` | `--bs-tertiary-bg` | |
| `--popover` | `--bs-body-bg` | |
| `--card` | `--bs-body-bg` | |

### Animation Alternatives

| shadcn/ui (tw-animate-css) | Bootstrap/CSS Alternative |
|----------------------------|--------------------------|
| `tw:animate-in` / `tw:animate-out` | CSS `@keyframes` + `animation` |
| `tw:fade-in-0` / `tw:fade-out-0` | Bootstrap `.fade` + `.show` |
| `tw:zoom-in-95` / `tw:zoom-out-95` | `@keyframes zoomIn { from { transform: scale(0.95); opacity: 0 } }` |
| `tw:slide-in-from-top-2` | `@keyframes slideIn { from { transform: translateY(-0.5rem) } }` |
| `tw:slide-in-from-bottom-2` | `@keyframes slideIn { from { transform: translateY(0.5rem) } }` |
| `tw:duration-200` | `transition-duration: 200ms` or `animation-duration: 200ms` |
| `tw:transition-all` | Custom CSS: `transition: all 150ms ease` |
| `tw:transition-opacity` | Custom CSS: `transition: opacity 150ms ease` |

## shadcn/ui Component Conversion

### Conversion Strategy Overview

| Component | Bootstrap Equivalent | Keep Radix UI? | Complexity |
|-----------|---------------------|----------------|------------|
| button | `.btn` + variant classes | No (native BS) | Low |
| input | `.form-control` | No | Low |
| textarea | `.form-control` | No | Low |
| avatar | Custom CSS | N/A | Low |
| collapsible | `.collapse` | Yes (animation) | Medium |
| hover-card | BS Popover API | Optional | Medium |
| input-group | `.input-group` | No | Medium |
| dialog | `.modal` | Yes (portal) | Medium |
| tooltip | BS Tooltip JS | Optional | Medium |
| dropdown-menu | `.dropdown-menu` | Yes (state) | High |
| select | `.form-select` | Yes (a11y) | High |
| command | Custom implementation | Yes (keyboard) | High |

### CVA → Bootstrap Variant Conversion

```typescript
// BEFORE: CVA with Tailwind
import { cva } from 'class-variance-authority';
const buttonVariants = cva(
  'tw:inline-flex tw:items-center tw:justify-center tw:rounded-md tw:text-sm tw:font-medium',
  {
    variants: {
      variant: {
        default: 'tw:bg-primary tw:text-primary-foreground tw:hover:bg-primary/90',
        destructive: 'tw:bg-destructive tw:text-white tw:hover:bg-destructive/90',
        outline: 'tw:border tw:bg-background tw:hover:bg-accent',
        secondary: 'tw:bg-secondary tw:text-secondary-foreground',
        ghost: 'tw:hover:bg-accent tw:hover:text-accent-foreground',
        link: 'tw:text-primary tw:underline-offset-4 tw:hover:underline',
      },
    },
  },
);

// AFTER: Bootstrap class mapping (CVA removed)
import clsx from 'clsx';
const VARIANT_CLASSES = {
  default: 'btn btn-dark',
  destructive: 'btn btn-danger',
  outline: 'btn btn-outline-secondary',
  secondary: 'btn btn-light',
  ghost: 'btn btn-link text-decoration-none',
  link: 'btn btn-link',
} as const;

const SIZE_CLASSES = {
  default: '',
  sm: 'btn-sm',
  lg: 'btn-lg',
  icon: 'btn-icon',  // custom CSS for square icon button
} as const;

function Button({ variant = 'default', size = 'default', className, ...props }) {
  return <button className={clsx(VARIANT_CLASSES[variant], SIZE_CLASSES[size], className)} {...props} />;
}
```

### cn() Utility Replacement

```typescript
// BEFORE: cn() with tailwind-merge
import { cn } from '~/utils/shadcn-ui';
<div className={cn('tw:flex tw:gap-2', isActive && 'tw:bg-accent', className)} />

// AFTER: clsx only (tailwind-merge not needed for Bootstrap)
import clsx from 'clsx';
<div className={clsx('d-flex gap-2', isActive && 'bg-light', className)} />
```

### Radix UI + Bootstrap Approach

Radix UI primitives are headless (no styles). When converting:

1. **Keep Radix UI imports** — they provide accessibility, focus management, and keyboard navigation
2. **Replace only `className` values** — swap `tw:` classes with Bootstrap classes
3. **Handle `data-[state=*]` styles** — add custom CSS for Radix state attributes:

```css
/* Custom CSS for Radix states (add to component SCSS) */
[data-state="open"] > .collapsible-content { display: block; }
[data-state="closed"] > .collapsible-content { display: none; }
[data-state="checked"] { /* ... */ }
```

4. **Remove `tw-animate-css` animations** — replace with Bootstrap transitions or custom `@keyframes`

### Dark Mode Migration

- **shadcn/ui**: Uses `.dark` class on root element → `&:is(.dark *)` variant
- **Bootstrap 5.3**: Uses `data-bs-theme="dark"` attribute

```css
/* BEFORE: shadcn/ui dark mode */
.dark { --primary: oklch(0.922 0 0); }

/* AFTER: Bootstrap dark mode */
[data-bs-theme="dark"] { --bs-body-bg: #212529; --bs-body-color: #dee2e6; }
```

If GROWI needs both systems during migration, sync via CSS aliases:
```css
[data-bs-theme="dark"] {
  --primary: var(--bs-dark);
  --destructive: var(--bs-danger);
}
```

## Conversion Workflow

### Step-by-Step Procedure

1. **Identify** — Find `tw:` classes in the target file
2. **Map** — Look up each class in the mapping tables above
3. **Check unmappable** — For classes without Bootstrap equivalent, write custom CSS
4. **Replace** — Swap `tw:` classes with Bootstrap classes in JSX
5. **Remove cn()/CVA** — Replace `cn()` with `clsx`, remove CVA if all variants converted
6. **Verify** — Run `turbo run lint --filter @growi/app` and `turbo run build --filter @growi/app`

### Finding tw: Classes

```bash
# All tw: usage in a specific file
grep "tw:" apps/app/src/components/ui/button.tsx

# All files using tw: classes
grep -r "tw:" apps/app/src/ --include="*.tsx" --include="*.ts" -l

# Files importing cn() utility
grep -r "from '~/utils/shadcn-ui'" apps/app/src/ -l

# Files importing shadcn/ui components
grep -r "from '~/components/ui/" apps/app/src/ --include="*.tsx" -l
```

### cn() Removal Steps

1. Replace `import { cn } from '~/utils/shadcn-ui'` with `import clsx from 'clsx'`
2. Replace `cn(...)` calls with `clsx(...)`
3. After all files migrated, delete `apps/app/src/utils/shadcn-ui.ts`

### Dependency Cleanup (After Full Migration)

```bash
# 1. Remove Tailwind packages
pnpm remove tailwindcss @tailwindcss/postcss tailwind-merge tw-animate-css --filter @growi/app

# 2. Remove CVA (if all components converted)
pnpm remove class-variance-authority --filter @growi/app

# 3. Delete config files
#    - apps/app/postcss.config.js
#    - apps/app/src/styles/tailwind.css
#    - apps/app/components.json

# 4. Delete utility
#    - apps/app/src/utils/shadcn-ui.ts

# 5. Remove tailwind.css import from apps/app/src/pages/_app.page.tsx
```

### Conversion Order for Dependent Components

Convert in dependency order (leaf-first):

```
1. Utility:    cn() → clsx replacement
2. Leaf:       input, textarea, avatar (no internal deps)
3. Mid-level:  button, collapsible, hover-card
4. Composite:  dialog, dropdown-menu, select, tooltip
5. Complex:    command, input-group
6. Consumers:  Feature components that import from ~/components/ui/
7. Cleanup:    Remove packages, configs, and tailwind.css import
```
