import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthComponent } from './pages/auth.component';
import { AssetsComponent } from './pages/assets.component';
import { FacilitiesComponent } from './pages/facilities.component';
import { DashboardComponent } from './pages/dashboard.component';

export const routes: Routes = [
  { path: 'login', component: AuthComponent },
  { path: 'overview', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'assets', component: AssetsComponent, canActivate: [authGuard] },
  { path: 'facilities', component: FacilitiesComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'assets' },
  { path: '**', redirectTo: 'assets' }
];
