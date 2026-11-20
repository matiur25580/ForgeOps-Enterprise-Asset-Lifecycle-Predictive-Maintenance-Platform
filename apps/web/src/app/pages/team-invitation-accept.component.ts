import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { OperationsApiService } from '../core/operations-api.service';

@Component({
 selector:'fo-team-invitation-accept',standalone:true,imports:[CommonModule,FormsModule],
 template:`
 <main><section class="card"><a href="/login" class="brand">FORGEOPS <span>TEAM INVITATION</span></a><small>SECURE ORGANIZATION ACCESS</small><h1>Join your team</h1><p>Confirm the invited name and create a password to activate your account.</p><form (ngSubmit)="accept()"><label>First name<input name="firstName" [(ngModel)]="firstName" required maxlength="80"></label><label>Last name<input name="lastName" [(ngModel)]="lastName" required maxlength="80"></label><label>Create password<input name="password" type="password" [(ngModel)]="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><small>Use at least 12 characters. Passwords are securely hashed.</small><button [disabled]="busy||!token">Accept invitation</button></form><p class="error" *ngIf="error">{{error}}</p><p class="success" *ngIf="success">{{success}}</p><a *ngIf="success" href="/login">Continue to sign in →</a></section></main>`,
 styles:[`
 :host{display:grid;min-height:100vh;place-items:center;background:#f2f5fa;font:14px Inter,system-ui;color:#1b293d}.card{width:min(420px,calc(100vw - 32px));box-sizing:border-box;background:#fff;border:1px solid #e5ebf3;border-radius:12px;padding:30px;box-shadow:0 12px 35px #172b4810}.brand{display:block;color:#1d3760;font-weight:800;text-decoration:none;font-size:16px;margin-bottom:30px}.brand span{display:block;font-size:8px;letter-spacing:1.4px;color:#7e8da2;margin-top:4px}small{font-size:9px;color:#8290a2;letter-spacing:.8px}h1{font-size:25px;margin:8px 0}p{font-size:11px;color:#7d8ba0;line-height:1.6}form{display:grid;gap:12px;margin-top:22px}label{display:grid;gap:6px;font-size:10px;color:#68788e}input{padding:11px;border:1px solid #dce4ee;border-radius:6px;font:12px inherit}button{border:0;border-radius:6px;padding:12px;background:#286bd1;color:#fff;font-size:11px;cursor:pointer}button:disabled{opacity:.45}.error{color:#b83f3f}.success{color:#17865d}.card>a:last-child{font-size:11px;color:#286bd1}`
 ]
})
export class TeamInvitationAcceptComponent implements OnInit{
 private readonly api=inject(OperationsApiService);private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);
 token='';firstName='';lastName='';password='';busy=false;error='';success='';
 ngOnInit(){this.route.queryParamMap.subscribe(p=>this.token=p.get('token')??'');}
 accept(){this.busy=true;this.error='';this.api.post<{data:{user:{email:string}}}>('/team/invitations/accept',{token:this.token,firstName:this.firstName,lastName:this.lastName,password:this.password}).subscribe({next:r=>{this.success='Your account is active for '+r.data.user.email+'. You can now sign in using your organization slug.';this.password='';this.busy=false;},error:e=>{this.error=e?.error?.error?.code==='INVITATION_INVALID_OR_EXPIRED'?'This invitation is invalid, expired or has already been used. Ask your organization administrator for a new invitation.':e?.error?.error?.code??'Could not accept this invitation.';this.busy=false;}});}
}
