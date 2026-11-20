# Authentication regression tests

ForgeOps keeps a small, fast API security test suite that runs in CI before type-checking and builds.

## Run locally

From the repository root:

```bash
npm install
npm test
```

The API test runner uses Node's built-in test framework and the existing `tsx` development dependency. No database is required for these unit tests.

## Coverage

- Refresh-token generation is URL-safe and produces distinct values.
- Refresh-token SHA-256 hashing is deterministic and does not expose the raw token.
- Access-token signing and verification preserve subject, tenant, role, and facility claims.
- Modified signatures and malformed access tokens are rejected.
- Authorization middleware returns 401 for missing authentication, 403 for disallowed roles, and calls the next handler for allowed roles.

## Security boundary

These are unit-level regression tests, not a complete authentication integration or penetration test. MongoDB refresh-session rotation/replay behavior, registration/login HTTP flows, cookie flags, tenant isolation across data routes, and rate-limit behavior still require integration tests with an isolated test database and HTTP client.

The test-only JWT secret is set inside the test process and must never be reused in any deployed environment.
