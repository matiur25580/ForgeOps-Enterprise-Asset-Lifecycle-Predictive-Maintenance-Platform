import {Component,OnInit,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {OperationsApiService} from '../core/operations-api.service';

@Component({
 selector:'fo-telemetry',standalone:true,imports:[CommonModule,FormsModule],
 template:`
 <main><nav><a href="/overview">ForgeOps</a> · <a href="/assets">Assets</a> · <a href="/maintenance">Maintenance</a> · <a href="/inventory">Inventory</a> · <a href="/procurement">Procurement</a> · <b>Telemetry & Health</b></nav>
 <section><small>INDUSTRIAL IOT · CONDITION MONITORING</small><h1>Asset health intelligence</h1><p>Simulated sensor streams, configurable thresholds and explainable health scores.</p>
 <button (click)="simulate()" [disabled]="busy||!assets.length">{{busy?'Generating…':'Simulate telemetry'}}</button>
 <div class="notice">Health score is an explainable threshold heuristic, not a trained predictive model. Simulated readings are clearly marked.</div>
 <div class="stats"><article>Total assets <strong>{{summary.total||0}}</strong></article><article>Healthy <strong>{{summary.healthy||0}}</strong></article><article>Watch <strong>{{summary.watch||0}}</strong></article><article>At risk / critical <strong>{{(summary.atRisk||0)+(summary.critical||0)}}</strong></article></div>
 <p class="error" *ngIf="error">{{error}}</p>
 <section class="panel"><h2>Alert operations</h2><p>{{alertSummary.open||0}} open · {{alertSummary.acknowledged||0}} acknowledged · {{alertSummary.critical||0}} active critical</p>
 <div class="rule"><b>Temperature threshold rule</b><label>Warning °C <input type="number" [(ngModel)]="ruleDraft.warningThreshold"></label><label>Critical °C <input type="number" [(ngModel)]="ruleDraft.criticalThreshold"></label><button (click)="saveRule()" [disabled]="savingRule">Save rule</button></div>
 <article class="alert" *ngFor="let a of alerts"><div class="alert-info"><b>{{a.asset?.assetTag||'Asset'}} · {{metric(a.metric)}}</b><small>{{a.message}} · {{a.lastTriggeredAt|date:'short'}}</small><small>Status: {{a.status}} · Severity: {{a.severity}}</small></div>
 <button *ngIf="a.status==='open'" (click)="acknowledge(a._id)">Acknowledge</button><button *ngIf="!a.workOrderId&&a.status!=='resolved'" (click)="createWorkOrder(a._id)">Create work order</button><button *ngIf="a.status!=='resolved'" (click)="resolve(a._id)">Resolve</button><small *ngIf="a.workOrderId">Work order linked</small></article>
 <p *ngIf="!alerts.length">No alerts recorded. Simulate telemetry to evaluate the active rules.</p></section>
 <article class="asset" *ngFor="let item of assets"><div><b>{{item.asset.assetTag}} · {{item.asset.name}}</b><strong [class]="item.band">{{item.score}} / 100</strong></div><small>{{facility(item.asset.facility)}} · {{item.asset.criticality}} criticality</small><div class="bar"><i [style.width.%]="item.score" [class]="item.band"></i></div><span *ngFor="let f of item.factors" [class.alert]="f.severity!=='normal'">{{metric(f.metric)}}: {{f.value}} {{f.severity}}　</span><p *ngIf="!item.factors.length">No readings yet.</p></article>
 <p *ngIf="!assets.length">No accessible assets found.</p></section></main>`,
 styles:[`
 :host{display:block;background:#f5f7fb;min-height:100vh;color:#1d2b40;font:14px Inter,system-ui}nav{background:#101b2d;color:#dce6f5;padding:22px}nav a{color:#a9c7f4;text-decoration:none}section{max-width:1100px;margin:auto;padding:32px}h1{font-size:28px;margin:8px 0}small{color:#8290a4}button{background:#3478e5;color:white;border:0;border-radius:7px;padding:9px 12px;font-size:11px}.notice{background:#fff5df;padding:13px;margin:18px 0;border-radius:7px;font-size:12px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stats article,.asset,.panel{background:white;border:1px solid #e5ebf2;border-radius:9px;padding:18px}.stats strong{display:block;font-size:25px;margin-top:8px}.asset{margin-top:14px}.asset>div:first-child{display:flex;justify-content:space-between}.asset small{display:block;margin-top:7px}.bar{height:7px;background:#edf1f6;margin:14px 0;border-radius:8px;overflow:hidden}.bar i{display:block;height:100%;background:#259b70}.bar i.watch{background:#d59a38}.bar i.at_risk,.bar i.critical{background:#d65d55}.healthy{color:#259b70}.watch{color:#bd852d}.at_risk,.critical,.error{color:#c94f48}.asset span{font-size:11px;color:#65748a}.asset span.alert{color:#c94f48}.error{padding:12px}.panel{margin:20px 0}.panel h2{font-size:18px;margin:0}.panel>p{font-size:12px;color:#8290a4}.rule{display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:#f6f8fb;padding:12px;border-radius:7px;margin:12px 0}.rule b{width:100%;font-size:12px}.rule label{display:grid;gap:4px;font-size:11px;color:#65748a}.rule input{width:90px;padding:7px;border:1px solid #dce4ee;border-radius:5px}.alert{display:flex;gap:9px;align-items:center;padding:12px 0;border-bottom:1px solid #edf1f5;flex-wrap:wrap}.alert-info{flex:1;min-width:190px}.alert-info b,.alert-info small{display:block}.alert-info small{font-size:10px;margin-top:4px}.alert>small{font-size:10px}@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}section{padding:18px}}`
 ]
 })
export class TelemetryComponent implements OnInit{
 private api=inject(OperationsApiService);
 assets:any[]=[];summary:any={};alerts:any[]=[];alertSummary:any={};busy=false;savingRule=false;error='';
 ruleDraft={warningThreshold:75,criticalThreshold:90};
 ngOnInit(){this.load();}
 load(){this.api.get<any>('/telemetry/health').subscribe({next:r=>{this.assets=r.data.assets;this.summary=r.data.summary;},error:e=>this.error=e?.error?.error?.code||'Unable to load asset health.'});this.loadAlerts();}
 loadAlerts(){this.api.get<any>('/alerts').subscribe({next:r=>{this.alerts=r.data.alerts;this.alertSummary=r.data.summary;},error:e=>this.error=e?.error?.error?.code||'Unable to load alerts.'});}
 simulate(){if(!this.assets.length)return;this.busy=true;this.api.post<any>('/telemetry/simulate',{assetId:this.assets[0].asset._id,samples:24}).subscribe({next:()=>{this.busy=false;this.load();},error:e=>{this.busy=false;this.error=e?.error?.error?.code||'Simulation failed.';}});}
 saveRule(){this.savingRule=true;this.api.put<any>('/alerts/rules/temperature_c',{warningThreshold:Number(this.ruleDraft.warningThreshold),criticalThreshold:Number(this.ruleDraft.criticalThreshold),direction:'high',enabled:true}).subscribe({next:()=>{this.savingRule=false;this.error='Temperature alert rule saved.';},error:e=>{this.savingRule=false;this.error=e?.error?.error?.code||'Unable to save alert rule.';}});}
 acknowledge(id:string){this.api.patch('/alerts/'+id+'/acknowledge',{}).subscribe({next:()=>this.loadAlerts(),error:e=>this.error=e?.error?.error?.code||'Unable to acknowledge alert.'});}
 resolve(id:string){this.api.patch('/alerts/'+id+'/resolve',{}).subscribe({next:()=>this.loadAlerts(),error:e=>this.error=e?.error?.error?.code||'Unable to resolve alert.'});}
 createWorkOrder(id:string){this.api.post('/alerts/'+id+'/work-order',{}).subscribe({next:()=>this.loadAlerts(),error:e=>this.error=e?.error?.error?.code||'Unable to create work order.'});}
 facility(f:any){return typeof f==='object'?(f?.code||f?.name||'Facility'):'Facility';}
 metric(v:string){return ({temperature_c:'Temperature',vibration_mm_s:'Vibration',pressure_bar:'Pressure',current_amp:'Current'} as any)[v]||v;}
}
