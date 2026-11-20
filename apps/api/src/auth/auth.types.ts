import type { Request } from 'express';
import type { AccessClaims } from './token.service.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessClaims;
    }
  }
}

export type AuthenticatedRequest = Request & { auth: AccessClaims };