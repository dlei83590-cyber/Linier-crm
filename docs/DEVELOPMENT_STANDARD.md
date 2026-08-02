# Development Standard

## Local Workflow

1. Start from an up-to-date protected default branch.
2. Create a focused branch following `GIT_STANDARD.md`.
3. Make the smallest coherent change.
4. Run formatting, linting, type checks, tests, and relevant migrations locally.
5. Update documentation and open a pull request.

## Code Requirements

- Code MUST pass the repository formatter and linter without new warnings.
- Public interfaces and non-obvious decisions MUST be documented.
- Errors MUST preserve useful context without exposing secrets or sensitive records.
- Inputs MUST be validated at trust boundaries.
- Configuration MUST come from validated environment variables or configuration files; secrets MUST NOT be committed.
- Dates, currencies, identifiers, and optional values MUST use explicit types and semantics.
- Feature flags SHOULD protect risky or incomplete production behavior.

## Security and Privacy

- Apply least privilege to application roles, database users, and infrastructure identities.
- Parameterize database queries and safely encode rendered output.
- Never log passwords, tokens, session identifiers, or complete sensitive records.
- Dependencies MUST be pinned through a lockfile and reviewed for known vulnerabilities.
- Sensitive changes require a threat-model note in the pull request.

## Observability

- Logs MUST be structured and include a request or correlation identifier.
- Metrics SHOULD cover request rate, errors, duration, and resource saturation.
- User-facing failures MUST be diagnosable without revealing internal implementation details.
- Background work MUST be idempotent or have a documented duplicate-handling strategy.

## Review

At least one qualified reviewer MUST approve a change. Authors MUST resolve discussions, ensure CI passes, and avoid self-merging security-critical or migration-heavy changes without explicit approval.
