import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '../models/user.model.js';

// Build a route guard that checks the verified session role against the route's allowlist.
export function authorize(...allowedRoles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.auth) {
      response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      return;
    }
    if (!allowedRoles.includes(request.auth.role)) {
      response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Your role cannot perform this action.' } });
      return;
    }
    next();
  };
}