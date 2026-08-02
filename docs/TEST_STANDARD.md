# Test Standard

## Test Layers

| Layer       | Purpose                                  | Expectation                                 |
| ----------- | ---------------------------------------- | ------------------------------------------- |
| Unit        | Business rules and pure transformations  | Fast, deterministic, isolated               |
| Integration | Database, queues, and service boundaries | Use production-like dependencies            |
| Contract    | API schema and compatibility             | Validate requests, responses, and errors    |
| End-to-end  | Critical user journeys                   | Cover a small, stable set of core workflows |

## Required Coverage

Every change MUST test its happy path, meaningful failure paths, and authorization boundaries. Tenant-scoped features MUST include a negative cross-tenant test. Bug fixes MUST include a regression test that fails before the fix.

Critical journeys include:

- Sign in and workspace access.
- Create and locate an organization or contact.
- Move an opportunity through a pipeline.
- Create and complete a follow-up task.
- Reject unauthorized and cross-tenant access.
- Import valid rows and report invalid rows.

## Quality Rules

- Tests MUST be deterministic, independent, and safe to run in parallel.
- Do not use arbitrary sleeps; wait on observable conditions with bounded timeouts.
- Fixtures SHOULD be minimal and created through factories or builders.
- External services MUST be stubbed in unit tests and exercised in dedicated integration tests.
- Coverage is a diagnostic, not a substitute for behavior-focused assertions; changed code SHOULD maintain at least 80% line coverage unless justified.
- Flaky tests MUST be fixed or quarantined with an owner and deadline; they MUST NOT be silently retried indefinitely.
