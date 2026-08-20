# XSS Security Report

## Status: LOW → FIXED

## Findings

Two uses of `dangerouslySetInnerHTML`:

1. `src/components/LaunchWizard.tsx:918` — `desc` from a hardcoded inline array.
   One entry contained `&apos;` HTML entity.
2. `src/components/Home/perks/index.tsx:38` — `item.text` from static `data.tsx`.
   All values were plain text strings.

Neither sourced user input, so live XSS risk was zero. However, the pattern was
dangerous for future refactors.

## Fixes applied

1. `LaunchWizard.tsx` — replaced with plain text + `.replace(/&apos;/g, "'")`.
2. `Home/perks/index.tsx` — replaced `dangerouslySetInnerHTML` with `<p>{item.text}</p>`.

## Recommendations

- Do not use `dangerouslySetInnerHTML` with any value that could ever come from user input.
- If rich HTML rendering is ever needed (e.g., markdown), use DOMPurify:
  ```typescript
  import DOMPurify from "dompurify";
  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />
  ```
