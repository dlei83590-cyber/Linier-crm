# Project Structure Standard

## Target Layout

```text
.
├── apps/
│   ├── api/                 # Backend application and HTTP entry point
│   └── web/                 # Browser application
├── packages/
│   ├── config/              # Shared tooling configuration
│   ├── contracts/           # API schemas and generated/shared types
│   └── ui/                  # Reusable presentation components
├── database/
│   ├── migrations/          # Ordered, immutable schema migrations
│   └── seeds/               # Deterministic development/test data
├── docs/                    # Product and engineering standards
├── scripts/                 # Repeatable repository automation
└── tests/                   # Cross-application and end-to-end tests
```

The exact framework-specific folders MAY evolve, but dependency boundaries MUST remain explicit.

## Dependency Rules

- Applications MAY depend on packages; packages MUST NOT depend on applications.
- Domain logic MUST remain independent of HTTP handlers and UI components.
- Database access MUST be isolated behind repositories or application services.
- Shared packages MUST have a clear owner and a demonstrated second consumer.
- Circular dependencies are prohibited.
- Tests SHOULD live near the implementation unless they exercise multiple applications.

## Naming

- Directories and non-component source files use `kebab-case` unless ecosystem tooling requires otherwise.
- Types and UI components use `PascalCase`; variables and functions use `camelCase`; constants use `UPPER_SNAKE_CASE`.
- Names MUST describe business intent rather than implementation mechanics.

