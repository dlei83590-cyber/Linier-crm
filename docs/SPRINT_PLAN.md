# Sprint Plan

## Sprint 0: Project Standards

| Field | Value |
| --- | --- |
| Status | Accepted with Minor Changes |
| Version | v0.0.1 |

### Accepted Outcomes

- [x] Established the product vision, MVP scope, domain rules, and definition of done.
- [x] Documented engineering, repository, Git, database, API, test, and acceptance standards.
- [x] Added documentation maintenance instructions and a prioritized delivery backlog.

Minor changes identified during acceptance are incorporated into the next planning revision and do not block acceptance of v0.0.1.

## Sprint 1: Infrastructure

**Objective:** Establish a deployable skeleton and secure workspace boundary.

### Planned Outcomes

- [ ] Select and scaffold the web, API, database, and shared contract toolchain.
- [ ] Add formatter, linter, type checking, unit test, and build commands.
- [ ] Configure CI with required quality and secret-scanning checks.
- [ ] Implement authentication and session lifecycle.
- [ ] Model users, workspaces, memberships, and roles.
- [ ] Enforce and test tenant isolation on a health-checkable API slice.
- [ ] Add local environment setup and initial deployment runbook.

### Exit Criteria

- A new contributor can start the system using documented commands.
- CI builds and tests the repository from a clean checkout.
- An authenticated user can access only their active workspace.
- The application can be deployed and rolled back in a non-production environment.

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
