# Multi-factor authentication and account security

## Supported factors

ForgeOps supports RFC 6238 time-based one-time passwords (TOTP), compatible with authenticator applications that accept an `otpauth://` provisioning URI. Codes are six digits, rotate every 30 seconds, and allow a one-step clock-skew window.

## Enrollment

1. An authenticated user opens **Account security**.
2. The API creates a random 160-bit Base32 secret and returns a provisioning URI and manual setup key.
3. The user adds the account to an authenticator application and confirms a current code.
4. ForgeOps encrypts the TOTP secret using AES-256-GCM and creates ten random recovery codes.
5. Only SHA-256 hashes of recovery codes are stored. The raw codes are displayed once.

## Sign-in flow

- Password verification happens first.
- If MFA is enabled, the API returns a signed five-minute MFA challenge, not an access token or refresh cookie.
- The challenge endpoint accepts a TOTP or unused recovery code. Only after proof succeeds does ForgeOps issue the normal access token and HTTP-only refresh session.
- TOTP time steps are consumed atomically to prevent replay. Recovery codes are atomically removed after use.
- MFA challenge requests share the authentication rate limit. Enrollment, disablement and recovery-code regeneration also have a dedicated rate limit.

## Account controls

- MFA status and remaining recovery-code count are available to the authenticated account owner.
- Disablement requires the current account password and a fresh MFA proof.
- Recovery-code regeneration requires a fresh MFA proof and invalidates all previous codes.
- MFA enablement/disablement is recorded in the tenant-scoped audit stream.

## Key management

Set a unique `MFA_ENCRYPTION_KEY` of at least 32 characters in each environment. Generate one with `openssl rand -base64 48`. Keep it stable across deployments and backups, store it in a secrets manager, and do not commit the real value. If omitted, ForgeOps falls back to the access-token secret for development compatibility; production should use the independent key.

Changing the MFA encryption key without migrating/re-encrypting existing secrets makes existing authenticator enrollments unreadable. Plan key rotation as a controlled migration, not a routine secret replacement.

## Limitations and operational notes

- TOTP is not phishing-resistant; WebAuthn/passkeys and enterprise SSO are future enhancements.
- Authenticator setup currently presents a manual secret and provisioning URI; users enter the key or scan the URI in their authenticator app.
- A code already used for enrollment cannot be reused for sign-in. Wait for the next authenticator code after confirming enrollment.
- Lost authenticator and recovery codes require an administrator-assisted identity recovery process; self-service email recovery is not implemented.
- MFA does not yet enforce mandatory enrollment for all tenant roles. It is opt-in per account.
