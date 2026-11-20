import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth/token.service.js';

export function authenticate(request: Request, response: Response, next: NextFunction): void {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A valid bearer token is required.' } });
    return;
  }

  try {
    request.auth = verifyAccessToken(header.slice(7));
    next();
  } catch {
    response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'The access token is invalid or expired.' } });
  }
}