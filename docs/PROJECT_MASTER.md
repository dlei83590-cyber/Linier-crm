# Nilier CRM Project Master

## Product Vision

Nilier CRM gives small and medium-sized teams one dependable workspace for managing organizations, contacts, sales opportunities, activities, and follow-ups.

## Goals

- Provide a clear, searchable customer record.
- Make sales pipelines and ownership visible.
- Reduce missed follow-ups with tasks and activity history.
- Enforce tenant-scoped access and role-based permissions.
- Provide stable APIs for future integrations.

## Non-Goals for the Initial Release

- Marketing campaign automation.
- Customer support ticketing.
- Marketplace or arbitrary third-party plugins.
- Advanced forecasting driven by machine learning.
- Native mobile applications.

## Personas

| Persona | Primary needs |
| --- | --- |
| Workspace administrator | Manage members, roles, settings, and data safety |
| Sales manager | Configure pipelines and inspect team performance |
| Sales representative | Maintain contacts, opportunities, activities, and tasks |

## MVP Scope

1. Authentication and workspace membership.
2. Role-based authorization for administrator, manager, and member roles.
3. Organization and contact CRUD, search, filtering, and pagination.
4. Configurable pipelines and stages.
5. Opportunity CRUD with owner, value, stage, and expected close date.
6. Notes, calls, meetings, emails, and tasks on customer records.
7. Audit events for security-sensitive and destructive actions.
8. CSV import and export with validation and error reporting.

## Domain Rules

- Every business record MUST belong to exactly one workspace.
- A user MUST have active workspace membership to access workspace data.
- Authorization MUST be enforced server-side; UI visibility is not authorization.
- Monetary values MUST be stored in minor units with an ISO 4217 currency code.
- Destructive business operations SHOULD use soft deletion when recovery or auditability is required.
- All persisted timestamps MUST be UTC.

## Success Metrics

- A new workspace can import its first contacts and create a pipeline without support.
- A representative can locate a customer record and log an activity in under one minute.
- No confirmed cross-tenant data exposure.
- At least 80% of weekly active users complete a core workflow: contact update, activity log, task completion, or opportunity update.

## Definition of Done

A feature is done only when it meets `DEVELOPMENT_STANDARD.md`, `TEST_STANDARD.md`, and `ACCEPTANCE_STANDARD.md`, includes required documentation and observability, and is deployed or demonstrably deployable.

