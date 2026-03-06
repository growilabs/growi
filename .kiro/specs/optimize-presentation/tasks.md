# Implementation Plan

- [x] 1. Set up shared constants and build-time CSS extraction infrastructure
- [x] 1.1 Move the Marp container class name constant to the shared constants module and update growi-marpit to import from there
  - Add the `MARP_CONTAINER_CLASS_NAME` string constant to the existing shared constants module in the presentation package
  - Update growi-marpit to import the constant from the shared module instead of defining it locally
  - Re-export the constant from growi-marpit for backward compatibility with MarpSlides
  - _Requirements: 1.4_

- [x] 1.2 Create the build-time CSS extraction script
  - Write a Node.js ESM script that instantiates Marp with the same configuration as growi-marpit (container classes, inlineSVG, emoji/html/math disabled)
  - The script renders empty strings through both slide and presentation Marp instances to extract their CSS output
  - Write the CSS strings as exported TypeScript constants to the constants directory
  - Include a file header comment indicating the file is auto-generated and how to regenerate it
  - Validate that extracted CSS is non-empty before writing
  - _Requirements: 3.1_

- [x] 1.3 Wire the extraction script into the build pipeline and generate the initial CSS file
  - Add a `pre:build:src` script entry in the presentation package's package.json that runs the extraction script before the main Vite build
  - Execute the script once to generate the initial pre-extracted CSS constants file
  - Commit the generated file so that dev mode works without running extraction first
  - _Requirements: 3.2, 3.3_

- [x] 2. (P) Decouple GrowiSlides from Marp runtime dependencies
  - Replace the growi-marpit import in GrowiSlides with imports from the shared constants module and the pre-extracted CSS constants
  - Replace the runtime `marpit.render('')` call with a lookup of the pre-extracted CSS constant based on the presentation mode flag
  - After this change, GrowiSlides must have no import path leading to `@marp-team/marp-core` or `@marp-team/marpit`
  - Depends on task 1 (shared constants and CSS file must exist)
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. (P) Add dynamic import for MarpSlides in the Slides routing component
  - Replace the static import of MarpSlides with a React.lazy dynamic import that resolves the named export
  - Wrap the MarpSlides rendering branch in a Suspense boundary with a simple loading fallback
  - Keep GrowiSlides as a static import (the common, lightweight path)
  - The dynamic import ensures MarpSlides and its transitive Marp dependencies are only loaded when `hasMarpFlag` is true
  - Depends on task 1 (shared constants must exist); parallel-safe with task 2 (different file)
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 4. Build verification and functional validation
- [x] 4.1 Build the presentation package and verify module separation in the output
  - Run the presentation package build and confirm it succeeds
  - Inspect the built GrowiSlides output file to confirm it contains no references to `@marp-team/marp-core` or `@marp-team/marpit`
  - Inspect the built Slides output file to confirm it contains a dynamic `import()` expression for MarpSlides
  - _Requirements: 5.1, 5.3, 5.4_

- [x] 4.2 Build the main GROWI application and verify successful compilation
  - Run the full app build to confirm no regressions from the presentation package changes
  - Verify that both Marp and non-Marp slide rendering paths are intact by checking the build completes without type errors
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.2_
