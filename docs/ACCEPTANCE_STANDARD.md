# Acceptance Standard

## Story Readiness

A story is ready when it has a user outcome, explicit scope, testable acceptance criteria, dependencies, designs where applicable, and identified security or migration considerations.

## Definition of Done Checklist

- [ ] Acceptance criteria are demonstrated and approved by the product owner or delegate.
- [ ] Code is reviewed and all required CI checks pass.
- [ ] Unit, integration, contract, and end-to-end tests are added as appropriate.
- [ ] Accessibility supports keyboard operation, visible focus, semantic markup, and sufficient contrast.
- [ ] Authorization and tenant isolation are verified.
- [ ] API, database, user, and operational documentation is updated.
- [ ] Logs, metrics, alerts, and audit events are present where required.
- [ ] Migrations, deployment order, compatibility, rollback, and feature flags are documented.
- [ ] No unresolved critical or high-severity security findings remain.
- [ ] The change has been validated in a production-like environment.

## Release Acceptance

A release MUST have an owner, version or traceable commit, release notes, successful automated checks, a rollback decision point, and post-deployment verification. Any waived criterion MUST record the risk, approver, owner, and remediation deadline.
