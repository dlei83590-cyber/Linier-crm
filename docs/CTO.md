# CTO Engineering Directive

## Mission

Build Nilier CRM as a secure, maintainable, multi-tenant customer relationship platform that teams can operate with confidence.

## Engineering Principles

1. **Protect customer data.** Tenant isolation, least privilege, encryption, and auditable access are mandatory.
2. **Prefer simple systems.** Start with a modular monolith and introduce distributed components only when measurements justify them.
3. **Ship in small increments.** Every change should be reviewable, testable, observable, and reversible.
4. **Automate quality.** Formatting, static analysis, tests, migrations, and security checks belong in CI.
5. **Own production.** Teams define service-level indicators, alerts, runbooks, and rollback procedures for what they ship.

## Decision Policy

- Reversible decisions MAY be made by the responsible engineer and documented in the pull request.
- Cross-cutting or hard-to-reverse decisions MUST use an architecture decision record (ADR).
- Security, privacy, or data-retention exceptions require written approval from the CTO or delegated owner.
- Delivery pressure does not waive the definition of done in `ACCEPTANCE_STANDARD.md`.

## Initial Quality Targets

| Area | Target |
| --- | --- |
| Availability | 99.9% monthly for production API |
| API latency | p95 under 500 ms for standard CRUD operations |
| Recovery point objective | 24 hours or better |
| Recovery time objective | 4 hours or better |
| Critical vulnerabilities | None knowingly released |

