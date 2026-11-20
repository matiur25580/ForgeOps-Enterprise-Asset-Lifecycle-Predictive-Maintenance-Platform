import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthComponent } from './pages/auth.component';
import { AssetsComponent } from './pages/assets.component';
import { FacilitiesComponent } from './pages/facilities.component';
import { DashboardComponent } from './pages/dashboard.component';
import { MaintenanceComponent } from './pages/maintenance.component';
import { InventoryComponent } from './pages/inventory.component';
import { ProcurementComponent } from './pages/procurement.component';
import { TelemetryComponent } from './pages/telemetry.component';
import { InspectionsComponent } from './pages/inspections.component';
import { AnalyticsComponent } from './pages/analytics.component';
import { DowntimeComponent } from './pages/downtime.component';
import { FinancialsComponent } from './pages/financials.component';
import { VendorIntelligenceComponent } from './pages/vendor-intelligence.component';
import { ReportsComponent } from './pages/reports.component';
import { NotificationsComponent } from './pages/notifications.component';
import { NotificationPreferencesComponent } from './pages/notification-preferences.component';
import { AuditExplorerComponent } from './pages/audit-explorer.component';
import { TeamAdminComponent } from './pages/team-admin.component';
import { TeamInvitationAcceptComponent } from './pages/team-invitation-accept.component';

export const routes: Routes = [
  { path: 'login', component: AuthComponent },
  { path: 'overview', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'assets', component: AssetsComponent, canActivate: [authGuard] },
  { path: 'facilities', component: FacilitiesComponent, canActivate: [authGuard] },
  { path: 'maintenance', component: MaintenanceComponent, canActivate: [authGuard] },
  { path: 'inventory', component: InventoryComponent, canActivate: [authGuard] },
  { path: 'procurement', component: ProcurementComponent, canActivate: [authGuard] },
  { path: 'telemetry', component: TelemetryComponent, canActivate: [authGuard] },
  { path: 'inspections', component: InspectionsComponent, canActivate: [authGuard] },
  { path: 'analytics', component: AnalyticsComponent, canActivate: [authGuard] },
  { path: 'downtime', component: DowntimeComponent, canActivate: [authGuard] },
  { path: 'financials', component: FinancialsComponent, canActivate: [authGuard] },
  { path: 'vendors', component: VendorIntelligenceComponent, canActivate: [authGuard] },
  { path: 'reports', component: ReportsComponent, canActivate: [authGuard] },
  { path: 'notifications', component: NotificationsComponent, canActivate: [authGuard] },
  { path: 'notification-preferences', component: NotificationPreferencesComponent, canActivate: [authGuard] },
  { path: 'audit', component: AuditExplorerComponent, canActivate: [authGuard] },
  { path: 'team', component: TeamAdminComponent, canActivate: [authGuard] },
  { path: 'team/accept', component: TeamInvitationAcceptComponent },
  { path: '', pathMatch: 'full', redirectTo: 'assets' },
  { path: '**', redirectTo: 'assets' }
];
