# Project Structure Standard

## Target Layout

```text
.
├── app/                     # Next.js App Router pages and HTTP route handlers
├── src/
│   ├── config/              # Validated environment configuration
│   └── lib/                 # Logger, Prisma, HTTP, JWT, RBAC, and OpenAPI foundations
├── prisma/
│   ├── migrations/          # Ordered, immutable schema migrations
│   ├── schema.prisma        # PostgreSQL schema
│   └── seed.ts              # Idempotent infrastructure seed
├── docs/                    # Product and engineering standards
├── tests/                   # Infrastructure unit and integration tests
├── .github/workflows/       # GitHub Actions quality gate
├── Dockerfile               # Production Next.js image
└── docker-compose.yml       # Local application and PostgreSQL services
```

Sprint 1 MUST remain infrastructure-only. Customer, Supplier, Quotation, Order, Product, and Report modules are added only in their approved later Sprint. The exact framework-specific folders MAY evolve, but dependency boundaries MUST remain explicit.

## Dependency Rules

- Domain logic MUST remain independent of HTTP handlers and UI components.
- Database access MUST be isolated behind repositories or application services.
- Route handlers MAY depend on `src/`; `src/` MUST NOT depend on route handlers or UI components.
- Configuration MUST be accessed through the validated configuration module.
- Authentication and authorization MUST use the shared JWT and RBAC frameworks.
- Circular dependencies are prohibited.
- Tests SHOULD live near the implementation unless they exercise multiple applications.

## Naming

- Directories and non-component source files use `kebab-case` unless ecosystem tooling requires otherwise.
- Types and UI components use `PascalCase`; variables and functions use `camelCase`; constants use `UPPER_SNAKE_CASE`.
- Names MUST describe business intent rather than implementation mechanics.
