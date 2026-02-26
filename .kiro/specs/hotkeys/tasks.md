# Implementation Tasks

## Summary

All tasks completed. Migrated from `react-hotkeys` to `tinykeys` with subscriber-owned binding definitions and full TypeScript conversion.

| Task | Description | Requirements |
|------|-------------|--------------|
| 1 | Write HotkeysManager tests (TDD) | 2, 3, 5 |
| 2 | Rewrite HotkeysManager with tinykeys | 1, 2, 3, 4, 5, 6, 8 |
| 3 | Remove legacy hotkey infrastructure | 1, 7 |
| 4 | Verify quality and module reduction (-92 modules) | 1 |
| 5 | Convert 4 JSX subscribers to TypeScript, fix bugs, unify patterns | 7, 8 |
| 6.1 | Define shared types, add binding exports to all subscribers | 7, 8 |
| 6.2 | Refactor HotkeysManager to build binding map from subscriber exports | 6, 7 |
| 7 | Verify refactoring preserves all existing behavior | 1, 2, 3, 4, 5 |

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1. Replace react-hotkeys with tinykeys | 2, 3, 4, 7 |
| 2. Preserve single-key shortcuts | 1, 2, 7 |
| 3. Preserve modifier-key shortcuts | 1, 2, 7 |
| 4. Preserve multi-key sequences | 2, 7 |
| 5. Input element focus guard | 1, 2, 7 |
| 6. Lifecycle management and cleanup | 2, 6.2 |
| 7. Subscriber component architecture | 3, 5, 6.1, 6.2 |
| 8. TypeScript migration | 2, 5, 6.1 |
