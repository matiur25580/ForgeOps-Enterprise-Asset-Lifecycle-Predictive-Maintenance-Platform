# Team administration and secure invitations

## Overview

The team module manages organization users without exposing passwords or deleting account history. Team records and invitations are always scoped to the tenant from the authenticated principal.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/team/members` | List tenant members |
| GET | `/api/v1/team/invitations` | List pending invitations |
| POST | `/api/v1/team/invitations` | Create a 72-hour invitation |
| POST | `/api/v1/team/invitations/accept` | Accept an invitation and activate account |
| PATCH | `/api/v1/team/members/:userId` | Change role, status or facility scope |
| DELETE | `/api/v1/team/invitations/:invitationId` | Cancel a pending invitation |

## Roles and safeguards

- Only tenant owners and administrators can administer the team.
- Only an owner can invite or promote an administrator.
- The owner role cannot be assigned through this API; existing owner accounts are protected from edits.
- Administrators cannot modify other administrator accounts.
- A user cannot change their own role or disable their own account through the team endpoint.
- Facility assignments must reference active facilities belonging to the same tenant.
- Team membership queries never return password hashes or refresh tokens.

## Invitation lifecycle

1. An owner or administrator creates an invitation for a name, email, role and facility scope.
2. The API generates a high-entropy random token and stores only its SHA-256 hash.
3. The raw token is returned once to the administrator. The UI provides a copyable acceptance link.
4. The invited person opens the link, confirms the invited name and chooses a password (minimum 12 characters; bcrypt hash).
5. The token is single-use and expires after 72 hours. Duplicate active invitations are rejected.
6. The new account is created active with the exact role and facility assignments from the invitation.

Email delivery for team invitations is not yet wired to SMTP. Administrators must securely share the one-time link themselves. Never paste invitation links into public channels or commit them to source control.

## Immediate authorization changes

The authentication middleware now reloads the active user record for each authenticated API request and replaces token role/facility claims with current database values. This makes role changes, facility reassignment and account disablement effective immediately for API authorization, rather than waiting for access-token expiry. Disabling an account also revokes all its refresh-session families.

## Audit and operational boundaries

Invitation creation, acceptance, cancellation and member updates write tenant-scoped audit events. Audit history records operational metadata and does not include password values or raw invitation tokens.

The current implementation uses normal MongoDB document writes, not a replica-set transaction spanning invitation consumption, user creation and audit insertion. The unique tenant/email index prevents duplicate user accounts; a production rollout should add transaction-backed acceptance and a transactional outbox for email delivery. Invitation email sending, SCIM/SSO provisioning, bulk import and advanced approval workflows remain future work.
