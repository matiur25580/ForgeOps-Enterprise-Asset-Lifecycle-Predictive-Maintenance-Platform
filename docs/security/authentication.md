# Authentication and tenant access

## Implemented endpoints

All routes are under `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Create an organization and its first owner |
| POST | `/auth/login` | Authenticate within an organization slug |
| POST | `/auth/refresh` | Rotate the HTTP-only refresh cookie |
| POST | `/auth/logout` | Revoke the current refresh session |
| GET | `/auth/me` | Return the authenticated user's profile |
| GET | `/account/context` | Return token-derived tenant and facility scope |
| GET | `/account/administration-check` | Example owner/admin-only route |

## Session design

- Passwords are hashed with bcrypt (12 rounds); inputs are bounded to bcrypt's 72-byte limit.
- Access tokens are short-lived HS256 JWTs. Send them as `Authorization: Bearer <token>`.
- Refresh tokens are cryptographically random opaque values, stored only as SHA-256 hashes.
- Refresh tokens are delivered in an HTTP-only, SameSite=Lax cookie scoped to `/api/v1/auth`; production cookies are Secure.
- Rotation is an atomic compare-and-swap on one refresh-family document. Reuse of a previously rotated token revokes that family.
- Logout revokes the current refresh token. Access tokens remain valid until their short expiry; add a denylist or token-version check if immediate access-token revocation becomes a requirement.

## Tenant isolation rules

1. Resolve the organization from its slug during login; never accept a client-supplied tenant ID as proof of scope.
2. Authenticated tenant scope comes only from the verified JWT claim.
3. Every tenant-owned database query must include `tenantId: request.auth.tenantId` (and facility scope where applicable).
4. Apply role authorization after authentication. Do not rely on Angular route guards for API security.
5. Do not expose password hashes, refresh-token hashes, or raw refresh tokens in API responses or logs.

## Local configuration

Set `AUTH_ACCESS_TOKEN_SECRET` in the root `.env` to a unique cryptographically random secret of at least 32 characters. Do not use the example placeholder in production. For example, generate a value with:

```bash
openssl rand -base64 48
```

## Current limitations / next hardening

- MFA, email verification, password reset, invitation flows, audit events, account lockout, and device/session management are not implemented yet.
- The first organization owner is created by public registration. Production deployments should add email verification and an organization onboarding policy before enabling open registration.
- Facility IDs in JWTs are an authorization snapshot; refresh tokens after facility membership changes, and use a database-backed membership check for high-risk operations.
- The example administration route demonstrates RBAC only; it does not manage organization settings.
- Add integration tests against a disposable MongoDB replica-set test environment before production use.
