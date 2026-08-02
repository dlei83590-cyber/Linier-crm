# Sprint Plan

## Sprint 0: Project Standards

| Field   | Value                       |
| ------- | --------------------------- |
| Status  | Accepted with Minor Changes |
| Version | v0.0.1                      |

### Accepted Outcomes

- [x] Established the product vision, MVP scope, domain rules, and definition of done.
- [x] Documented engineering, repository, Git, database, API, test, and acceptance standards.
- [x] Added documentation maintenance instructions and a prioritized delivery backlog.

Minor changes identified during acceptance are incorporated into the next planning revision and do not block acceptance of v0.0.1.

## Sprint 1: Infrastructure

**Objective:** Establish a deployable, observable, and testable application foundation without implementing CRM business modules.

### Planned Outcomes

- [ ] Initialize Next.js and TypeScript with formatting, lint, type checking, tests, and production builds.
- [ ] Configure PostgreSQL, Prisma, migrations, and an idempotent infrastructure seed.
- [ ] Provide Docker and Docker Compose workflows for the application and database.
- [ ] Add validated environment configuration, structured logging, and a consistent error handler.
- [ ] Add JWT authentication and RBAC foundations with automated allow/deny tests.
- [ ] Publish the infrastructure API contract through OpenAPI and Swagger.
- [ ] Configure GitHub Actions to install, migrate, seed, lint, typecheck, test, and build.

Customer, Supplier, Quotation, Order, Product, and Report implementation is prohibited in Sprint 1 and remains deferred to later approved Sprints.

### Exit Criteria

- `npm install`, `npm run dev`, `npm run build`, lint, typecheck, and tests pass from a clean checkout.
- `docker compose up` starts the application and a healthy PostgreSQL service.
- Prisma migration and seed commands succeed against an empty database.
- Swagger is reachable and accurately describes the infrastructure endpoints.
- JWT accepts valid tokens and rejects invalid or expired tokens; RBAC allows and denies requests according to permission.

## Prioritized Backlog

1. Organizations and contacts.
2. Pipelines, stages, and opportunities.
3. Activities and tasks.
4. Search, filtering, and pagination.
5. CSV import and export.
6. Audit views and operational hardening.

## Sprint Operating Rules

- Scope changes require an explicit trade-off and product owner approval.
- Blockers are raised within one working day.
- Work is not counted complete until it satisfies `ACCEPTANCE_STANDARD.md`.
- The plan is updated during refinement, sprint planning, review, and retrospective.
