# GitHub Actions CI/CD Pipeline

This repository uses GitHub Actions for continuous integration and deployment.

## Workflow Overview

The CI/CD pipeline is defined in `.github/workflows/ci.yml` and consists of three jobs:

### 1. Test Job
- Runs on: Ubuntu Latest
- Node versions: 18.x and 20.x
- Steps:
  - Installs dependencies
  - Runs linter (`npm run lint`)
  - Runs all tests (`npm test`)
  - Uploads coverage reports to Codecov (Node 20.x only)

### 2. Build Job
- Runs on: Ubuntu Latest
- Depends on: Test job passing
- Steps:
  - Installs dependencies
  - Builds the project (`npm run build`)
  - Runs TypeScript type checking (`npm run type-check`)

### 3. Publish Job
- Runs on: Ubuntu Latest
- Conditions: Only on push to main branch
- Depends on: Build job passing
- Steps:
  - Builds the project
  - Publishes to npm registry (requires NPM_TOKEN secret)

## Required Secrets

To enable npm publishing, add the following secret to your repository:
- `NPM_TOKEN`: Your npm authentication token

## Test Coverage

The project enforces the following coverage thresholds:
- Statements: 80%
- Branches: 80%
- Functions: 80%
- Lines: 80%

Coverage reports are generated in the following formats:
- Text (console output)
- LCOV (for Codecov integration)
- HTML (for local viewing)

## Local Testing

Run tests locally with:
```bash
npm test              # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

## Code Quality

The project uses TypeScript's strict mode and runs type checking as part of the CI pipeline:
```bash
npm run lint       # Run TypeScript compiler checks
npm run type-check # Same as lint
```