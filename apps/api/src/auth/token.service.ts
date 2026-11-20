import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserRole } from '../models/user.model.js';

export interface AccessClaims {
  sub: string;
  tenantId: string;
  role: UserRole;
  facilityIds: string[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function createFamilyId(): string {
  return randomUUID();
}

export function signAccessToken(claims: AccessClaims): string {
  const options: SignOptions = {
    algorithm: 'HS256',
    // Zod validates the configured duration at the application boundary.
    expiresIn: env.AUTH_ACCESS_TOKEN_TTL as NonNullable<SignOptions['expiresIn']>
  };
  return jwt.sign(claims, env.AUTH_ACCESS_TOKEN_SECRET, options);
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.AUTH_ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || !decoded.sub || !decoded.tenantId ||
      !['owner', 'admin', 'manager', 'technician', 'viewer'].includes(String(decoded.role)) ||
      !Array.isArray(decoded.facilityIds)) {
    throw new Error('Invalid access token claims');
  }
  return decoded as AccessClaims;
}

export const refreshExpiry = (): Date => new Date(Date.now() + env.AUTH_REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
