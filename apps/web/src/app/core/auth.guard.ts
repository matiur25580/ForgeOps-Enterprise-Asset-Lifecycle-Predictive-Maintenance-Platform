import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { OperationsApiService } from './operations-api.service';

export const authGuard: CanActivateFn = () => {
  const api = inject(OperationsApiService);
  const router = inject(Router);
  return api.ensureSession().pipe(map((valid) => valid ? true : router.createUrlTree(['/login'])));
};
