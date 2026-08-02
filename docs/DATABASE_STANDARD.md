# Database Standard

## Data Model

- Use a relational database as the system of record.
- Tables and columns use `snake_case`; table names are plural.
- Primary keys SHOULD be UUIDs or another non-sequential, globally unique identifier.
- Department-scoped business tables MUST contain the ownership fields required to enforce responsible-user and department data access.
- Mutable tables MUST include `created_at` and `updated_at` UTC timestamps.
- Foreign keys and uniqueness constraints MUST enforce business invariants where practical.
- Currency amounts MUST use integer minor units, never floating-point values.

## Internal Data Access

The system uses one internal-company data model, not a tenant or workspace model. Queries MUST enforce authenticated role, department, and responsible-user data scope where required. Database row-level security MAY be used as defense in depth where supported, but it does not replace application authorization tests.

## Migrations

- Every schema change MUST be represented by a versioned migration.
- Applied migrations are immutable; corrections require a new migration.
- Migrations MUST be safe for rolling deployment and SHOULD separate expand, backfill, and contract phases.
- Large backfills MUST be resumable, observable, and rate limited.
- Destructive changes require a tested backup and rollback or forward-fix plan.

## Queries and Operations

- Prevent unbounded reads; list operations require pagination and deterministic ordering.
- Add indexes based on measured query patterns and validate them with query plans.
- Transactions MUST be as short as practical and encompass all writes for one invariant.
- Production access MUST be audited and limited to authorized personnel.
- Backups MUST be encrypted, monitored, and restored in a scheduled recovery test.
