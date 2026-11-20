import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../auth/token.service.js';
import { User } from '../models/user.model.js';

/**
 * Verify the signed token and reload current authorization state.
 * This makes account disablement, role changes and facility reassignment
 * effective immediately instead of waiting for the access-token TTL.
 */
export async function authenticate(request: Request, response: Response, next: NextFunction): Promise<void> {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A valid bearer token is required.' } });
    return;
  }

  try {
    const claims = verifyAccessToken(header.slice(7));
    const user = await User.findOne({
      _id: claims.sub,
      tenantId: claims.tenantId,
      status: 'active'
    }).select('_id role facilityIds');
    if (!user) {
      response.status(401).json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'This account is no longer active.' } });
      return;
    }
    request.auth = {
      ...claims,
      role: user.role,
      facilityIds: user.facilityIds.map((id) => id.toString())
    };
    next();
  } catch {
    response.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'The access token is invalid, expired, or no longer valid for this account.' } });
  }
}
