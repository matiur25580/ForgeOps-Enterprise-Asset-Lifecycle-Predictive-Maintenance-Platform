import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { requireTenantScope } from '../middleware/tenant-scope.js';

export const accountRouter = Router();

accountRouter.get('/context', authenticate, requireTenantScope, (request, response) => {
  response.status(200).json({
    data: {
      tenantId: request.auth!.tenantId,
      role: request.auth!.role,
      facilityIds: request.auth!.facilityIds
    }
  });
});

accountRouter.get('/administration-check', authenticate, authorize('owner', 'admin'), (_request, response) => {
  response.status(200).json({ data: { allowed: true } });
});