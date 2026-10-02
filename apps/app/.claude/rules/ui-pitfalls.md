# UI Pitfalls

## useId() must not be passed to reactstrap `target` prop

React's `useId()` generates IDs containing colons (`:r0:`, `:r1:`, `:r2:`). These are valid HTML `id` attributes but **invalid CSS selectors**.

reactstrap's `findDOMElements()` resolves string targets via `document.querySelectorAll(target)`, which throws `DOMException: is not a valid selector` when the string contains colons.

```tsx
// ❌ WRONG: useId() output passed as string target
const popoverTargetId = useId();
<button id={popoverTargetId}>...</button>
<Popover target={popoverTargetId} />  // → DOMException at componentDidMount

// ✅ CORRECT: use ref — reactstrap resolves refs via .current, bypassing querySelectorAll
const popoverTargetRef = useRef<HTMLButtonElement>(null);
<button ref={popoverTargetRef}>...</button>
<Popover target={popoverTargetRef} />
```

**Applies to all reactstrap components with a `target` prop**: `Popover`, `Tooltip`, `UncontrolledPopover`, `UncontrolledTooltip`, etc.

**Safe uses of `useId()`**: `id=`, `htmlFor=`, `aria-labelledby=`, `aria-describedby=` — these use `getElementById` internally, which does not parse CSS.
