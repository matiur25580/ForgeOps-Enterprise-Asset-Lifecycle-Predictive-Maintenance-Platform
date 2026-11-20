# Authentication integration tests

ForgeOps includes HTTP-level authentication integration tests backed by an isolated,
ephemeral MongoDB instance from `mongodb-memory-server`. The suite imports the
Express application directly and binds it to an ephemeral localhost port; it does
not start the production server or connect to a developer's configured database.

## Run

From the repository root:

```bash
npm install
npm test
```

The first run may download a MongoDB binary for the local platform. The binary and
database are test infrastructure only; `mongodb-memory-server` is a development
dependency and is not included in the API runtime dependencies.

## Coverage

- Organization registration creates a tenant and owner with a bcrypt password hash.
- Public user responses do not expose password hashes.
- Refresh credentials are issued as HTTP-only, SameSite=Lax cookies scoped to the
  authentication routes; only a SHA-256 digest is persisted.
- Login is scoped to the organization slug, preventing credentials from another
  tenant from authenticating against the selected organization.
- Authenticated `/me` requests resolve the user within the tenant claim.
- Refresh-token rotation replaces the cookie and records the consumed token hash.
- Replaying a consumed refresh token revokes the entire refresh-token family.
- Logout revokes the session and clears the refresh cookie.

## Test isolation and limitations

Each test clears the tenant, user, and refresh-session collections. The in-memory
MongoDB server is started once for the test file and stopped after the suite.
These tests exercise real Mongoose persistence and HTTP middleware, but they do
not replace production-like tests against the exact MongoDB server version used
in deployment, load tests, browser-level cookie tests, or a formal security review.

The integration suite uses test-only secrets and must never be used as deployment
configuration.
