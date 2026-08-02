# API Standard

## Conventions

- Public HTTP APIs use versioned paths such as `/api/v1/contacts`.
- Resources use plural nouns; HTTP methods express the operation.
- JSON fields use `camelCase`; timestamps use ISO 8601 UTC strings.
- Identifiers are opaque strings. Clients MUST NOT infer meaning from them.
- Breaking changes require a new API version and a documented migration window.

## Requests and Responses

- Validate path, query, header, and body inputs before executing business logic.
- Successful creation returns `201`; deletion returns `204` when there is no body.
- List endpoints MUST paginate and SHOULD support documented filtering and sorting.
- Cursor pagination is preferred for large or frequently changing collections.
- Mutation endpoints that may be retried SHOULD support idempotency keys.

## Error Shape

Errors MUST use a stable machine-readable structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [{ "field": "email", "reason": "invalid_format" }],
    "requestId": "req_opaque"
  }
}
```

Messages MUST be safe for clients. Internal stack traces, SQL, and secrets MUST NOT be returned.

## Security and Documentation

- Authentication and authorization MUST be checked for every protected endpoint.
- Role and department data scope MUST come from authenticated user authorization, not from trusted client-supplied identifiers alone.
- State-changing browser requests MUST address CSRF where cookie authentication is used.
- Rate limits SHOULD protect authentication, export, import, and expensive search routes.
- The API contract MUST be maintained as OpenAPI and validated in CI.
