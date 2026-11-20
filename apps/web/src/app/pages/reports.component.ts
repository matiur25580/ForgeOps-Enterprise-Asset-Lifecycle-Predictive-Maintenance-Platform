import {Component,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {OperationsApiService} from '../core/operations-api.service';
interface ReportDefinition{id:string;title:string;dateField:string;description:string;}
@Component({selector:'fo-reports',standalone:true,imports:[CommonModule,FormsModule],template:`
<main><nav><a href="/overview">ForgeOps</a> · <b>Reporting & exports</b></nav><section class="page"><header><div><small>MANAGEMENT INTELLIGENCE · REPORTING</small><h1>Report centre</h1><p>Export tenant-scoped operational records for reviews, audits and management analysis.</p></div></header>
<section class="filters"><label>From<input type="date" name="from" [(ngModel)]="from"></label><label>To<input type="date" name="to" [(ngModel)]="to"></label><label>Facility ID (optional)<input name="facilityId" [(ngModel)]="facilityId" placeholder="All authorized facilities"></label></section>
<div class="error" *ngIf="error">{{error}}</div><div class="success" *ngIf="message">{{message}}</div>
<section class="reports"><article class="report" *ngFor="let item of reports"><div class="icon">CSV</div><div class="body"><small>OPERATIONAL EXPORT</small><h2>{{item.title}}</h2><p>{{item.description}}</p><span>Period field: {{item.dateField}} · Maximum 366 days · Up to 10,000 rows</span></div><button (click)="download(item)" [disabled]="busy!==''">{{busy===item.id?'Preparing…':'Export CSV'}}</button></article></section>
<p class="footnote">Exports enforce authenticated tenant and facility scope. CSV fields are escaped and spreadsheet formula prefixes neutralized. Purchase orders represent commitments, not paid invoices. Exports are capped at 10,000 rows.</p></section></main>`,
styles:[`:host{display:block;min-height:100vh;background:#f3f6fb;color:#1c2a3d;font:14px Inter,system-ui}nav{background:#101b2d;color:#dce6f5;padding:19px 26px}nav a{color:#a9c7f4;text-decoration:none}.page{max-width:1050px;margin:auto;padding:30px}header{margin-bottom:20px}header small,.body small{font-size:9px;letter-spacing:1px;color:#7c8ba0}h1{font-size:28px;margin:7px 0}header p,.body p{font-size:12px;color:#7d8da3}.filters{display:flex;flex-wrap:wrap;gap:12px;background:white;border:1px solid #e4eaf2;border-radius:9px;padding:16px;margin-bottom:16px}label{display:grid;gap:5px;font-size:10px;color:#75849a}input{padding:9px;border:1px solid #dce4ed;border-radius:6px;min-width:155px}.reports{display:grid;gap:12px}.report{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #e4eaf2;border-radius:9px;padding:18px}.icon{width:44px;height:44px;display:grid;place-items:center;background:#e9f2ff;color:#2768c7;border-radius:8px;font-weight:700;font-size:11px}.body{flex:1}.body h2{font-size:16px;margin:5px 0}.body p{margin:5px 0}.body span{font-size:10px;color:#8a97a8}button{border:0;border-radius:6px;background:#286bd1;color:white;padding:10px 14px;white-space:nowrap}button:disabled{opacity:.55}.footnote{font-size:10px;color:#8390a2;line-height:1.6;margin-top:18px}.error{color:#b83f3f;margin:10px 0}.success{color:#21805d;margin:10px 0}@media(max-width:650px){.page{padding:16px}.report{align-items:flex-start;flex-wrap:wrap}.body{min-width:calc(100% - 65px)}button{margin-left:60px}.filters label{width:100%}}`]
})
export class ReportsComponent{
 private api=inject(OperationsApiService);
 reports:ReportDefinition[]=[
 {id:'work-orders',title:'Work order register',dateField:'createdAt',description:'Status, priority, assigned technician, due dates and maintenance costs.'},
 {id:'downtime',title:'Downtime event register',dateField:'startedAt',description:'Downtime causes, resolution and independent verification status.'},
 {id:'inspections',title:'Inspection compliance register',dateField:'performedAt',description:'Checklist outcomes, findings and independent review decisions.'},
 {id:'purchase-orders',title:'Purchase order register',dateField:'issuedAt',description:'Supplier commitments, currency, order value and expected delivery.'}];
 from=new Date(Date.now()-30*86400000).toISOString().slice(0,10);to=new Date().toISOString().slice(0,10);facilityId='';busy='';error='';message='';
 download(item:ReportDefinition){
  if(!this.from||!this.to||this.from>this.to){this.error='Select a valid reporting date range.';return;}
  const start=new Date(this.from+'T00:00:00Z'),end=new Date(this.to+'T23:59:59Z');
  if(end.getTime()-start.getTime()>366*86400000){this.error='Date range cannot exceed 366 days.';return;}
  this.busy=item.id;this.error='';this.message='';
  const query=new URLSearchParams({from:this.from,to:this.to});if(this.facilityId.trim())query.set('facilityId',this.facilityId.trim());
  this.api.download('/reports/exports/'+item.id+'.csv?'+query.toString()).subscribe({next:blob=>{
   const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download='forgeops-'+item.id+'-'+this.from+'-to-'+this.to+'.csv';anchor.click();URL.revokeObjectURL(url);this.message=item.title+' export generated.';this.busy='';
  },error:err=>{this.error=err?.error?.error?.code||'Export failed. Check your date range and permissions.';this.busy='';}});
 }
}
