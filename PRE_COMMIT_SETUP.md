# Pre-Commit Quality Hooks

This repository uses comprehensive pre-commit hooks to ensure code quality and prevent broken commits.

## What Gets Checked

Every commit automatically runs:

1. **🏗️ Build Compilation** - `npm run build`

   - Ensures TypeScript compiles without errors
   - Verifies all imports and exports are valid

2. **🔍 Type Checking** - `npm run type-check`

   - Runs TypeScript compiler in no-emit mode
   - Catches type errors before they reach the repository

3. **📝 Code Linting** - `npm run lint`

   - ESLint checks for code style violations
   - Enforces consistent coding standards

4. **✨ Code Formatting** - `prettier --write` (via lint-staged)

   - Automatically formats staged files
   - Ensures consistent code style across the project

5. **🧪 Test Suite** - `npm test`
   - Runs all 1087 tests to ensure functionality
   - Prevents broken code from entering the repository

## Setup

Pre-commit hooks are automatically installed when you run:

```bash
npm install
```

The hooks are managed by [Husky](https://typicode.github.io/husky/) and [lint-staged](https://github.com/okonet/lint-staged).

## Manual Quality Check

You can run all quality checks manually:

```bash
npm run check-all
```

This runs the same checks as the pre-commit hook without committing.

## If Hooks Fail

When pre-commit hooks fail:

1. **Fix the issues** reported by the tools
2. **Stage your fixes** with `git add`
3. **Retry the commit**

Common failures:

- **Build errors**: Fix TypeScript compilation issues
- **Test failures**: Fix broken tests before committing
- **Lint errors**: Run `npm run lint:fix` to auto-fix style issues
- **Type errors**: Fix TypeScript type issues

## Benefits

✅ **Prevents broken builds** from reaching the repository  
✅ **Ensures all tests pass** before any commit  
✅ **Maintains consistent code style** across the team  
✅ **Catches errors early** in the development process  
✅ **Improves code quality** and reduces bugs

## Configuration Files

- `.husky/pre-commit` - Main pre-commit hook script
- `.lintstagedrc.json` - Lint-staged configuration for staged files
- `package.json` - Scripts and dependencies

This ensures that **every commit maintains production-quality standards** and prevents the QA failures that previously allowed broken code to be committed.
