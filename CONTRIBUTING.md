# Contributing to MCP Memory Keeper

Thank you for your interest in contributing to MCP Memory Keeper! This guide will help you get started with contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct:

- **Be respectful**: Treat everyone with respect. No harassment, discrimination, or inappropriate behavior.
- **Be collaborative**: Work together to solve problems and improve the project.
- **Be constructive**: Provide helpful feedback and accept criticism gracefully.
- **Be inclusive**: Welcome contributors of all backgrounds and experience levels.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/mcp-memory-keeper.git
   cd mcp-memory-keeper
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/mkreyman/mcp-memory-keeper.git
   ```

## Development Setup

### Prerequisites

- Node.js 18+ and npm
- Git
- TypeScript knowledge
- Familiarity with MCP (Model Context Protocol)

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Run in development mode
npm run dev
```

### Project Structure

```
mcp-memory-keeper/
├── src/
│   ├── index.ts           # Main MCP server
│   ├── utils/             # Utility modules
│   │   ├── database.ts    # Database operations
│   │   ├── validation.ts  # Input validation
│   │   ├── git.ts         # Git integration
│   │   ├── knowledge-graph.ts
│   │   ├── vector-store.ts
│   │   └── agents.ts
│   └── __tests__/         # Test files
├── dist/                  # Built files
├── docs/                  # Documentation
└── examples/              # Example usage
```

## How to Contribute

### Reporting Issues

1. **Search existing issues** to avoid duplicates
2. **Create a new issue** with:
   - Clear, descriptive title
   - Steps to reproduce (for bugs)
   - Expected vs actual behavior
   - System information (OS, Node version)
   - Error messages or logs

**Issue Template:**

```markdown
## Description

Brief description of the issue

## Steps to Reproduce

1. Step one
2. Step two
3. ...

## Expected Behavior

What should happen

## Actual Behavior

What actually happens

## Environment

- OS: [e.g., macOS 14.0]
- Node: [e.g., 18.17.0]
- MCP Memory Keeper: [e.g., 0.8.0]
```

### Suggesting Features

1. **Check existing issues** and discussions
2. **Open a feature request** with:
   - Use case description
   - Proposed solution
   - Alternative approaches
   - Implementation considerations

### Contributing Code

#### 1. Choose an Issue

- Look for issues labeled `good first issue` or `help wanted`
- Comment on the issue to claim it
- Ask questions if requirements are unclear

#### 2. Create a Branch

```bash
# Update your fork
git checkout main
git pull upstream main
git push origin main

# Create feature branch
git checkout -b feature/your-feature-name
# Or for bugs:
git checkout -b fix/issue-description
```

#### 3. Make Changes

- Write clean, documented code
- Follow existing patterns
- Add tests for new functionality
- Update documentation as needed

#### 4. Commit Guidelines

Follow conventional commits format:

```bash
# Format: <type>(<scope>): <subject>

# Examples:
git commit -m "feat(search): add semantic search capability"
git commit -m "fix(database): resolve connection pool leak"
git commit -m "docs(api): update context_save examples"
git commit -m "test(agents): add multi-agent coordination tests"
git commit -m "refactor(validation): simplify input validation logic"
```

**Types:**

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions/changes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks

## Pull Request Process

### 1. Before Submitting

```bash
# Run all checks
npm run lint
npm run type-check
npm test
npm run build

# Ensure no conflicts
git pull upstream main
git rebase upstream/main
```

### 2. PR Guidelines

- **Title**: Use conventional commit format
- **Description**:
  - Reference related issues (#123)
  - Describe what changed and why
  - Include screenshots for UI changes
  - List breaking changes
- **Size**: Keep PRs focused and small
- **Tests**: Include tests for new code

**PR Template:**

```markdown
## Description

Brief description of changes

## Related Issues

Closes #123

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Tests pass locally
- [ ] Added new tests
- [ ] Updated existing tests

## Checklist

- [ ] Code follows project style
- [ ] Self-reviewed code
- [ ] Updated documentation
- [ ] No console.logs left
```

### 3. Review Process

- Maintainers will review within 48-72 hours
- Address feedback constructively
- Push additional commits (don't force-push during review)
- Once approved, maintainer will merge

## Coding Standards

### TypeScript Guidelines

```typescript
// Use explicit types
function processContext(items: ContextItem[]): ProcessedResult {
  // Implementation
}

// Avoid any type
// Bad: let data: any = {};
// Good: let data: Record<string, unknown> = {};

// Use interfaces for objects
interface ContextItem {
  id: string;
  key: string;
  value: string;
  category?: ContextCategory;
  priority?: Priority;
}

// Use enums for constants
enum Priority {
  Critical = 'critical',
  High = 'high',
  Normal = 'normal',
  Low = 'low',
}

// Document complex functions
/**
 * Analyzes context items to extract entities and relationships
 * @param items - Array of context items to analyze
 * @param options - Analysis options
 * @returns Extracted entities and relationships
 */
function analyzeContext(items: ContextItem[], options?: AnalysisOptions): AnalysisResult {
  // Implementation
}
```

### Error Handling

```typescript
// Use specific error types
class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Handle errors gracefully
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
    throw new McpError(ErrorCode.INVALID_PARAMS, `Validation failed: ${error.message}`);
  }
  // Log unexpected errors
  console.error('Unexpected error:', error);
  throw new McpError(ErrorCode.INTERNAL_ERROR, 'An unexpected error occurred');
}
```

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- Add trailing commas in multiline objects/arrays
- Maximum line length: 100 characters
- Use async/await over promises
- Prefer const over let

## Testing Guidelines

### Test Structure

```typescript
describe('ContextStorage', () => {
  let storage: ContextStorage;

  beforeEach(() => {
    storage = new ContextStorage();
  });

  afterEach(() => {
    storage.close();
  });

  describe('save', () => {
    it('should save context with all fields', async () => {
      const item = {
        key: 'test_key',
        value: 'test value',
        category: 'task' as const,
        priority: 'high' as const,
      };

      const result = await storage.save(item);

      expect(result.id).toBeDefined();
      expect(result.key).toBe(item.key);
    });

    it('should throw on duplicate key', async () => {
      const item = { key: 'duplicate', value: 'value' };

      await storage.save(item);

      await expect(storage.save(item)).rejects.toThrow('Duplicate key');
    });
  });
});
```

### Test Coverage

- Aim for 90%+ coverage
- Test edge cases and error conditions
- Include integration tests
- Test with real-world scenarios

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- storage.test.ts

# Run in watch mode
npm run test:watch
```

## Documentation

### Code Documentation

- Document all public APIs
- Include JSDoc comments for functions
- Add inline comments for complex logic
- Keep README.md up to date

### Examples

When adding new features, include:

1. API documentation in API.md
2. Usage examples in EXAMPLES.md
3. Common patterns in RECIPES.md
4. Troubleshooting tips if applicable

### Commit Messages

Good commit messages help maintain project history:

```bash
# Good examples
feat(search): implement semantic search with vector embeddings
fix(database): prevent connection leak in transaction handler
docs(api): add examples for context_delegate tool
test(integration): add session branching test cases

# Bad examples
fix: fixed stuff
update code
WIP
```

## Community

### Getting Help

- **Issues**: For bugs and feature requests
- **Discussions**: For questions and ideas
- **Discord**: [Join our Discord](https://discord.gg/mcp-memory-keeper) (if available)

### Ways to Contribute

Not just code! You can help by:

- Improving documentation
- Creating tutorials or blog posts
- Helping others in discussions
- Testing pre-releases
- Translating documentation
- Sharing the project

### Recognition

Contributors are recognized in:

- GitHub contributors page
- Release notes
- Annual contributor spotlight

## Release Process

1. **Version Bumping**: Follow semantic versioning

   - MAJOR: Breaking changes
   - MINOR: New features
   - PATCH: Bug fixes

2. **Release Notes**: Include

   - New features
   - Bug fixes
   - Breaking changes
   - Contributors

3. **Testing**: All tests must pass
   - Unit tests
   - Integration tests
   - Manual smoke tests

## Questions?

If you have questions about contributing:

1. Check existing documentation
2. Search closed issues
3. Ask in discussions
4. Contact maintainers

Thank you for contributing to MCP Memory Keeper! 🎉
