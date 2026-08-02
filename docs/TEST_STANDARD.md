# Test Standard

## Test Layers

| Layer       | Purpose                                  | Expectation                                 |
| ----------- | ---------------------------------------- | ------------------------------------------- |
| Unit        | Business rules and pure transformations  | Fast, deterministic, isolated               |
| Integration | Database, queues, and service boundaries | Use production-like dependencies            |
| Contract    | API schema and compatibility             | Validate requests, responses, and errors    |
| End-to-end  | Critical user journeys                   | Cover a small, stable set of core workflows |

## Required Coverage

Every change MUST test its happy path, meaningful failure paths, and authorization boundaries. Department-scoped features MUST include negative tests for access to another department and another responsible user's data. Bug fixes MUST include a regression test that fails before the fix.

Critical journeys include:

- Sign in and role/department access.
- Create and locate a customer or contact.
- Move an opportunity through its approved stages.
- Record a customer follow-up and execute a visit plan.
- Reject unauthorized cross-department and cross-user access.
- Submit and approve a quotation, order, and expense claim through their permitted stages.

## Quality Rules

- Tests MUST be deterministic, independent, and safe to run in parallel.
- Do not use arbitrary sleeps; wait on observable conditions with bounded timeouts.
- Fixtures SHOULD be minimal and created through factories or builders.
- External services MUST be stubbed in unit tests and exercised in dedicated integration tests.
- Coverage is a diagnostic, not a substitute for behavior-focused assertions; changed code SHOULD maintain at least 80% line coverage unless justified.
- Flaky tests MUST be fixed or quarantined with an owner and deadline; they MUST NOT be silently retried indefinitely.
