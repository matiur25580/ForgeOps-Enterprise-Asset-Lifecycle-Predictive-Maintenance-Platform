import type { NextFunction, Request, Response } from 'express';

/**
 * Prevents controllers from trusting tenant IDs supplied by request payloads.
 * Always derive tenant scope from the verified access token.
 */
export function requireTenantScope(request: Request, response: Response, next: NextFunction): void {
  if (!request.auth?.tenantId) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A tenant-scoped session is required.' } });
    return;
  }
  next();
}