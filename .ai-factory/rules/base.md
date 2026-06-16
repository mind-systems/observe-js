# Base Rules

> Auto-detected conventions. Edit as needed.

## Naming Conventions

- Files: `kebab-case.ts`
- Variables/functions: `camelCase`
- Classes/interfaces/types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

## Module Structure

- Platform-neutral code in core (no Node or browser globals)
- Node-specific code isolated to the Node layer entry
- Browser-specific code isolated to the browser layer entry
- `package.json` conditional `exports` selects the right entry per runtime

## Error Handling

- Export failures degrade silently — never throw into the host's log path
- All async export work runs off the caller's synchronous path

## Logging

- The SDK emits OTLP/HTTP only — no console output in production paths
- `log()` must return synchronously; batching and export happen asynchronously
