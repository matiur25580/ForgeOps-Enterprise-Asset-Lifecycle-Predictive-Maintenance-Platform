import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env.js';
import { createFamilyId, createRefreshToken, hashToken, refreshExpiry, signAccessToken } from '../auth/token.service.js';
import { RefreshSession } from '../models/refresh-session.model.js';
import { Tenant } from '../models/tenant.model.js';
import { User } from '../models/user.model.js';
import { authenticate } from '../middleware/authenticate.js';

export const authRouter = Router();
const refreshCookie = 'forgeops_refresh';
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/v1/auth',
  maxAge: env.AUTH_REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
};

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(48),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});

const loginSchema = z.object({
  organizationSlug: z.string().trim().toLowerCase().min(3).max(48),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});

function publicUser(user: { id: string; tenantId: { toString(): string }; email: string; firstName: string; lastName: string; role: string; facilityIds: { toString(): string }[] }) {
  return {
    id: user.id,
    tenantId: user.tenantId.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    facilityIds: user.facilityIds.map((id) => id.toString())
  };
}

async function issueSession(user: { id: string; tenantId: { toString(): string }; role: 'owner' | 'admin' | 'manager' | 'technician' | 'viewer'; facilityIds: { toString(): string }[] }, familyId = createFamilyId()) {
  const refreshToken = createRefreshToken();
  const tokenHash = hashToken(refreshToken);
  await RefreshSession.create({
    userId: user.id,
    tenantId: user.tenantId,
    tokenHash,
    familyId,
    expiresAt: refreshExpiry()
  });
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId.toString(),
    role: user.role,
    facilityIds: user.facilityIds.map((id) => id.toString())
  });
  return { accessToken, refreshToken };
}

authRouter.post('/register', async (request, response, next) => {
  try {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const input = parsed.data;
    const email = input.email.toLowerCase();
    if (await Tenant.exists({ slug: input.organizationSlug })) {
      response.status(409).json({ error: { code: 'ORGANIZATION_SLUG_TAKEN', message: 'This organization URL is already in use.' } });
      return;
    }

    const tenant = await Tenant.create({ name: input.organizationName, slug: input.organizationSlug });
    try {
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await User.create({
        tenantId: tenant._id,
        email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'owner'
      });
      const tokens = await issueSession(user);
      response.cookie(refreshCookie, tokens.refreshToken, cookieOptions);
      response.status(201).json({ data: { user: publicUser(user), accessToken: tokens.accessToken } });
    } catch (error) {
      await Tenant.deleteOne({ _id: tenant._id });
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', async (request, response, next) => {
  try {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      return;
    }
    const input = parsed.data;
    const tenant = await Tenant.findOne({ slug: input.organizationSlug, status: 'active' }).select('_id');
    const user = tenant
      ? await User.findOne({ tenantId: tenant._id, email: input.email.toLowerCase(), status: 'active' }).select('+passwordHash')
      : null;

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Organization, email, or password is incorrect.' } });
      return;
    }

    user.lastLoginAt = new Date();
    await user.save();
    const tokens = await issueSession(user);
    response.cookie(refreshCookie, tokens.refreshToken, cookieOptions);
    response.status(200).json({ data: { user: publicUser(user), accessToken: tokens.accessToken } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', async (request, response, next) => {
  try {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (!token) {
      response.status(401).json({ error: { code: 'REFRESH_TOKEN_MISSING' } });
      return;
    }

    const tokenHash = hashToken(token);
    const replacementRefreshToken = createRefreshToken();
    const replacementHash = hashToken(replacementRefreshToken);

    // Compare-and-swap: only one concurrent request can rotate the current token.
    const session = await RefreshSession.findOneAndUpdate(
      { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { tokenHash: replacementHash }, $addToSet: { usedTokenHashes: tokenHash } },
      { new: true }
    ).select('+tokenHash +usedTokenHashes');

    if (!session) {
      const previous = await RefreshSession.findOne({ usedTokenHashes: tokenHash }).select('+usedTokenHashes');
      if (previous) {
        await RefreshSession.updateOne({ _id: previous._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      }
      response.clearCookie(refreshCookie, cookieOptions);
      response.status(401).json({ error: { code: 'REFRESH_TOKEN_INVALID', message: 'Session expired or refresh token reuse was detected. Please sign in again.' } });
      return;
    }

    const user = await User.findOne({ _id: session.userId, tenantId: session.tenantId, status: 'active' });
    const tenant = await Tenant.findOne({ _id: session.tenantId, status: 'active' });
    if (!user || !tenant) {
      await RefreshSession.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
      response.clearCookie(refreshCookie, cookieOptions);
      response.status(401).json({ error: { code: 'ACCOUNT_UNAVAILABLE' } });
      return;
    }

    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId.toString(),
      role: user.role,
      facilityIds: user.facilityIds.map((id) => id.toString())
    });
    response.cookie(refreshCookie, replacementRefreshToken, cookieOptions);
    response.status(200).json({ data: { accessToken } });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', async (request, response, next) => {
  try {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (token) {
      await RefreshSession.updateOne({ tokenHash: hashToken(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
    }
    response.clearCookie(refreshCookie, cookieOptions);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', authenticate, async (request, response, next) => {
  try {
    const claims = request.auth!;
    const user = await User.findOne({ _id: claims.sub, tenantId: claims.tenantId, status: 'active' });
    if (!user) {
      response.status(401).json({ error: { code: 'ACCOUNT_UNAVAILABLE' } });
      return;
    }
    response.status(200).json({ data: { user: publicUser(user) } });
  } catch (error) {
    next(error);
  }
});