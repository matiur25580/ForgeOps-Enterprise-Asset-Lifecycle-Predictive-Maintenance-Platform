import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { OperationsApiService } from '../core/operations-api.service';

@Component({
  selector: 'fo-auth',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
  <main class="auth-shell">
    <section class="brand-panel"><a class="brand" href="/login"><span class="mark">F</span> forge<strong>ops</strong></a><div class="brand-copy"><span>INDUSTRIAL OPERATIONS CLOUD</span><h1>Keep every asset.<br>Every team.<br>In sync.</h1><p>One secure workspace for enterprise asset lifecycle, maintenance execution and operational reliability.</p></div><div class="brand-foot">FORGEOPS · ENTERPRISE ASSET MANAGEMENT</div></section>
    <section class="form-panel"><div class="mobile-brand"><span class="mark">F</span> forge<strong>ops</strong></div><div class="form-wrap">
      <div class="eyebrow">{{mfaChallenge?'TWO-STEP VERIFICATION':registerMode?'GET STARTED':'WELCOME BACK'}}</div><h2>{{mfaChallenge?'Verify your authenticator':registerMode?'Create your workspace':'Sign in to ForgeOps'}}</h2><p class="intro">{{mfaChallenge?'Enter a six-digit authenticator code or one-time recovery code.':registerMode?'Set up your organization and invite your operations team later.':'Access your organization’s secure operations workspace.'}}</p>
      <div class="mode" *ngIf="!mfaChallenge"><button [class.selected]="!registerMode" (click)="registerMode=false" type="button">Sign in</button><button [class.selected]="registerMode" (click)="registerMode=true" type="button">Create workspace</button></div>
      <form *ngIf="!mfaChallenge" (ngSubmit)="submit()">
        <label *ngIf="registerMode">Organization name<input name="organizationName" [(ngModel)]="form.organizationName" required minlength="2" maxlength="120" placeholder="Northstar Manufacturing"></label>
        <label>Organization slug<input name="organizationSlug" [(ngModel)]="form.organizationSlug" required minlength="3" maxlength="48" placeholder="northstar"><small>Use the organization URL identifier provided by your administrator.</small></label>
        <div class="two" *ngIf="registerMode"><label>First name<input name="firstName" [(ngModel)]="form.firstName" required maxlength="80" placeholder="First name"></label><label>Last name<input name="lastName" [(ngModel)]="form.lastName" required maxlength="80" placeholder="Last name"></label></div>
        <label>Email address<input name="email" type="email" [(ngModel)]="form.email" required maxlength="254" placeholder="you&#64;company.com"></label>
        <label>Password<input name="password" type="password" [(ngModel)]="form.password" required minlength="12" maxlength="128" placeholder="At least 12 characters"></label>
        <div *ngIf="registerMode" class="hint">Use at least 12 characters. Your password is securely hashed before storage.</div>
        <div class="error" *ngIf="error">{{error}}</div>
        <button class="submit" [disabled]="busy">{{busy?'Please wait…':registerMode?'Create secure workspace':'Sign in securely'}}</button>
      </form>
      <form *ngIf="mfaChallenge" (ngSubmit)="verifyMfa()" class="mfa-form"><label>Authenticator or recovery code<input name="mfaCode" [(ngModel)]="mfaCode" required minlength="6" maxlength="32" autocomplete="one-time-code" placeholder="000000"></label><button class="submit" [disabled]="busy">{{busy?'Verifying…':'Verify and continue'}}</button><button type="button" class="back" (click)="cancelMfa()">Back to sign in</button></form>
      <div class="security"><span>▣</span> Protected with encrypted sessions and role-based access</div>
    </div><footer>© 2026 ForgeOps · Enterprise operations platform</footer></section>
  </main>`,
  styles:[`
  :host{display:block;min-height:100vh;font-family:Inter,system-ui,sans-serif;color:#1b2b42}.auth-shell{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#fff}.brand-panel{background:radial-gradient(circle at 80% 10%,#203c63 0,#142943 34%,#101b2d 75%);color:white;padding:38px 9%;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:9px;color:white;text-decoration:none;font-size:20px;font-weight:750}.brand strong,.mobile-brand strong{font-weight:400;color:#a9b8cc}.mark{display:inline-grid;place-items:center;width:37px;height:37px;border-radius:10px;background:#3478e5;color:white;font-weight:800}.brand-copy{margin:auto 0;max-width:480px}.brand-copy>span,.eyebrow{font-size:9px;letter-spacing:1.5px;font-weight:750;color:#81a9e7}.brand-copy h1{font-size:clamp(36px,4vw,58px);line-height:1.12;letter-spacing:-2px;margin:18px 0}.brand-copy p{max-width:410px;color:#aebbd0;font-size:13px;line-height:1.8}.brand-foot{font-size:9px;letter-spacing:1px;color:#71839c}.form-panel{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 28px;position:relative}.form-wrap{width:min(100%,410px)}.form-wrap h2{font-size:27px;letter-spacing:-.8px;margin:9px 0}.intro{font-size:12px;color:#8390a3;line-height:1.6;margin:0 0 24px}.mode{display:grid;grid-template-columns:1fr 1fr;background:#f0f3f8;padding:4px;border-radius:8px;margin-bottom:22px}.mode button{border:0;background:transparent;color:#7a8799;padding:10px;border-radius:6px;font-size:10px}.mode button.selected{background:white;color:#326fc8;font-weight:750;box-shadow:0 1px 3px #15253b16}form{display:grid;gap:14px}label{display:grid;gap:7px;font-size:10px;font-weight:700;color:#52627a}input{border:1px solid #dfe6ef;border-radius:7px;padding:12px;font:12px Inter,system-ui;color:#25364c;outline:none}input:focus{border-color:#6c9ce8;box-shadow:0 0 0 3px #3478e51a}label small{font-size:9px;font-weight:400;color:#9aa6b5}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hint{font-size:9px;color:#8b98a9;margin-top:-5px}.submit{border:0;background:#3478e5;color:white;border-radius:7px;padding:13px;font-size:11px;font-weight:750;margin-top:3px}.submit:disabled{opacity:.6}.error{font-size:10px;background:#fff0ef;color:#c7524b;padding:10px;border-radius:6px}.mfa-form{display:grid;gap:13px}.back{border:0;background:transparent;color:#64758c;font-size:10px;padding:8px}.security{margin-top:22px;color:#8c99aa;font-size:9px;display:flex;align-items:center;gap:8px}.security span{color:#27966d}.form-panel footer{position:absolute;bottom:22px;color:#a2adba;font-size:9px}.mobile-brand{display:none}@media(max-width:760px){.auth-shell{grid-template-columns:1fr}.brand-panel{display:none}.form-panel{min-height:100vh;padding:25px 22px 65px}.mobile-brand{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:750;position:absolute;top:25px;left:22px}.form-wrap{margin-top:55px}.form-panel footer{bottom:17px}.form-wrap h2{font-size:24px}}`]
})
export class AuthComponent {
  private readonly api=inject(OperationsApiService);
  private readonly router=inject(Router);
  registerMode=false;busy=false;error='';mfaChallenge='';mfaCode='';
  form={organizationName:'',organizationSlug:'',firstName:'',lastName:'',email:'',password:''};
  verifyMfa():void{this.busy=true;this.error='';this.api.verifyMfaLogin(this.mfaChallenge,this.mfaCode).subscribe({next:()=>{this.busy=false;void this.router.navigate(['/overview']);},error:e=>{this.error=e.error?.error?.code||'Verification failed. Check your code and try again.';this.busy=false;}});}
  cancelMfa():void{this.mfaChallenge='';this.mfaCode='';this.error='';this.form.password='';}
  submit():void{
    this.busy=true;this.error='';
    const operation=this.registerMode
      ? this.api.register({...this.form})
      : this.api.login({organizationSlug:this.form.organizationSlug,email:this.form.email,password:this.form.password});
    operation.subscribe({
      next:(result:any)=>{this.busy=false;const data=result?.data;if(data?.mfaRequired&&data?.challengeToken){this.mfaChallenge=data.challengeToken;return;}void this.router.navigate(['/overview']);},
      error:(e)=>{this.error=e.error?.error?.message||e.error?.error?.code||'Sign-in failed. Check your organization details and credentials.';this.busy=false;}
    });
  }
}
