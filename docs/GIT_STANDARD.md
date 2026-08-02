# Git Standard

## Branches

Use short-lived branches named `<type>/<description>`, where type is one of `feat`, `fix`, `docs`, `refactor`, `test`, `build`, or `chore`. Example: `feat/contact-import`.

The default branch MUST be protected. Direct pushes and force pushes to protected branches are prohibited.

## Commits

Commit messages follow Conventional Commits:

```text
<type>(optional-scope): <imperative summary>
```

- Keep the summary concise and do not end it with punctuation.
- Each commit MUST represent one coherent change and leave the repository in a valid state.
- Generated files, when required, MUST be committed with their source changes.
- Secrets, build artifacts, local configuration, and editor state MUST NOT be committed.

## Pull Requests

Every pull request MUST include:

- The problem and chosen solution.
- Testing performed, including exact commands.
- Screenshots for perceptible UI changes.
- Migration, rollout, rollback, and compatibility notes when relevant.
- Links to the issue, sprint item, or decision record.

Prefer squash merging unless preserving a curated commit series improves traceability. Delete merged branches.
