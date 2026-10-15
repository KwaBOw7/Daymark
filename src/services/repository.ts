import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readCache, writeCache, type CachedEnvelope, type PendingOperation } from '../lib/cache';
import type { FlexibleTask, Preferences, ScheduleData, ScheduleEvent, SessionLog } from '../domain/types';

export type SyncState = 'local'|'syncing'|'synced'|'offline'|'error';
export interface RepositorySnapshot { data:ScheduleData; sync:SyncState; syncMessage:string; loading:boolean; user:User|null }
export type BatchChange = Omit<PendingOperation,'queuedAt'|'table'> & { table: Exclude<PendingOperation['table'],'sync_batch'> };
const iso=()=>new Date().toISOString();
const cloudAvailable=()=>Boolean(supabase);

type CloudErrorDetails = { message:string; code:string; network:boolean; conflict:boolean };
/** Supabase/PostgREST errors are not always native Error instances. Preserve their code/details. */
export function describeCloudError(error:unknown):CloudErrorDetails {
  const value = (typeof error === 'object' && error !== null) ? error as Record<string, unknown> : {};
  const stringField = (key:string) => typeof value[key] === 'string' ? String(value[key]).trim() : '';
  const code = stringField('code');
  const message = stringField('message') || stringField('error_description') || stringField('error') || (error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown cloud request error');
  const details = stringField('details');
  const hint = stringField('hint');
  const network = /failed to fetch|fetch failed|network ?error|network request failed|load failed|connection refused|timed? ?out|offline|\bERR_(NETWORK|CONNECTION|INTERNET)/i.test(message) || value.name === 'TypeError' && /fetch/i.test(message);
  const conflict = /concurrent_edit|row changed|conflict/i.test([code,message,details,hint].join(' '));
  const parts = [code ? `[${code}]` : '', message, details && details !== message ? `Details: ${details}` : '', hint ? `Hint: ${hint}` : ''].filter(Boolean);
  return {message:parts.join(' — '),code,network,conflict};
}
function applyLocal(data:ScheduleData,op:PendingOperation):ScheduleData {
  const next={...data};
  if(op.table==='schedule_events'){
    if(op.deleted)next.events=data.events.filter(x=>x.id!==op.id);
    else {const v=op.data as ScheduleEvent;next.events=[...data.events.filter(x=>x.id!==v.id),v];}
  } else if(op.table==='flexible_tasks'){
    if(op.deleted)next.tasks=data.tasks.filter(x=>x.id!==op.id);
    else {const v=op.data as FlexibleTask;next.tasks=[...data.tasks.filter(x=>x.id!==v.id),v];}
  } else if(op.table==='session_logs') {
    const v=op.data as SessionLog;next.sessionLogs=op.deleted?data.sessionLogs.filter(x=>x.id!==op.id):[...data.sessionLogs.filter(x=>x.id!==v.id),v];
  } else if(op.table==='schedule_preferences') next.preferences=op.data as Preferences;
  else for(const child of (op.data as PendingOperation[])) Object.assign(next,applyLocal(next,child));
  return next;
}
function mapRemote<T>(rows:unknown[]|null):T[]{return (rows||[]).map((row)=>((row as {data:T}).data));}
export class ScheduleRepository {
  private envelope:CachedEnvelope;
  private listeners=new Set<()=>void>();
  private user:User|null=null;
  private snapshot:RepositorySnapshot;
  private channel:ReturnType<NonNullable<typeof supabase>['channel']>|null=null;
  private hasCloudPreferences=false;
  constructor(){this.envelope=readCache();this.snapshot={data:this.envelope.data,sync:cloudAvailable()?'offline':'local',syncMessage:cloudAvailable()?'Sign in to sync this schedule.':'Local mode · this device only',loading:false,user:null};}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
  getSnapshot=()=>this.snapshot;
  private emit(){this.snapshot={...this.snapshot,data:this.envelope.data,user:this.user};this.listeners.forEach(fn=>fn());}
  private setSync(sync:SyncState,message:string){this.snapshot={...this.snapshot,sync,syncMessage:message};this.emit();}
  setUser(user:User|null){this.user=user;this.envelope=readCache(user?.id);this.snapshot={...this.snapshot,user,loading:Boolean(user),sync:user?'syncing':cloudAvailable()?'offline':'local',syncMessage:user?'Connecting your schedule…':cloudAvailable()?'Sign in to sync changes.':'Local mode · this device only'};this.emit();if(user)void this.loadCloud();else this.stopRealtime();}
  private stopRealtime(){if(this.channel&&supabase)supabase.removeChannel(this.channel);this.channel=null;}
  private async loadCloud(){
    if(!supabase||!this.user)return;
    this.snapshot={...this.snapshot,loading:true,sync:'syncing',syncMessage:'Syncing your schedule…'};this.emit();
    try{
      const uid=this.user.id;
      const [ev,ta,logs,pref]=await Promise.all([
        supabase.from('schedule_events').select('id,data,updated_at').eq('user_id',uid),
        supabase.from('flexible_tasks').select('id,data,updated_at').eq('user_id',uid),
        supabase.from('session_logs').select('id,data,updated_at').eq('user_id',uid),
        supabase.from('schedule_preferences').select('id,data,updated_at').eq('user_id',uid).eq('id','default').maybeSingle()
      ]);
      if(ev.error)throw {...ev.error,message:`schedule_events read failed: ${ev.error.message}`};
      if(ta.error)throw {...ta.error,message:`flexible_tasks read failed: ${ta.error.message}`};
      if(logs.error)throw {...logs.error,message:`session_logs read failed: ${logs.error.message}`};
      if(pref.error)throw {...pref.error,message:`schedule_preferences read failed: ${pref.error.message}`};
      this.hasCloudPreferences=Boolean(pref.data);
      const remote:ScheduleData={events:mapRemote<ScheduleEvent>(ev.data),tasks:mapRemote<FlexibleTask>(ta.data),sessionLogs:mapRemote<SessionLog>(logs.data),preferences:pref.data?(pref.data as {data:Preferences}).data:this.envelope.data.preferences};
      // Offline local edits are replayed after reading the latest cloud state. Server-side compare-and-swap
      // rejects an operation whose target row changed since the client's previous version.
      this.envelope.data=remote;
      for(const op of this.envelope.pending)this.envelope.data=applyLocal(this.envelope.data,op);
      this.envelope.lastCloudSync=iso();writeCache(this.envelope,uid);this.snapshot={...this.snapshot,loading:false,sync:this.envelope.pending.length?'syncing':'synced',syncMessage:this.envelope.pending.length?'Local changes queued for safe sync.':'All changes synced'};this.emit();
      await this.flushQueue();
      this.stopRealtime();
      const refreshLater=()=>window.setTimeout(()=>{if(!this.envelope.pending.length)void this.loadCloud();},700);
      this.channel=supabase.channel(`daymark:${uid}`).on('postgres_changes',{event:'*',schema:'public',table:'schedule_events',filter:`user_id=eq.${uid}`},refreshLater).on('postgres_changes',{event:'*',schema:'public',table:'flexible_tasks',filter:`user_id=eq.${uid}`},refreshLater).on('postgres_changes',{event:'*',schema:'public',table:'session_logs',filter:`user_id=eq.${uid}`},refreshLater).on('postgres_changes',{event:'*',schema:'public',table:'schedule_preferences',filter:`user_id=eq.${uid}`},refreshLater).subscribe();
    }catch(error){
      const detail=describeCloudError(error);
      const sync:SyncState=detail.network?'offline':'error';
      const prefix=detail.network?'Cannot reach Supabase':'Supabase schedule read failed';
      this.snapshot={...this.snapshot,loading:false,sync,syncMessage:`${prefix}${detail.code?` (${detail.code})`:''}: ${detail.message}. Your locally cached schedule is preserved.`};
      writeCache(this.envelope,this.user.id);this.emit();
    }
  }
  async commit(op:Omit<PendingOperation,'queuedAt'>,optimisticData?:ScheduleData){
    const operation:PendingOperation={...op,queuedAt:iso()};
    if(optimisticData)this.envelope.data=optimisticData;else this.envelope.data=applyLocal(this.envelope.data,operation);
    const cloudWrite=Boolean(this.user&&supabase);if(cloudWrite)this.envelope.pending.push(operation);
    const cached=writeCache(this.envelope,this.user?.id);
    this.emit();
    if(!cached){this.setSync('error','Device storage is full or unavailable. Export your JSON schedule before continuing.');return false;}
    if(!this.user||!supabase){this.setSync('local','Saved on this device. Sign in to sync between devices.');return true;}
    return this.flushQueue();
  }
  async commitBatch(changes:BatchChange[],optimisticData:ScheduleData){
    if(!changes.length)return true;
    const batch:PendingOperation={table:'sync_batch',id:`batch-${crypto.randomUUID?.()||Date.now()}`,data:changes,queuedAt:iso()};
    // A missing preference row is a create; CAS must receive null instead of the local default timestamp.
    if(!this.hasCloudPreferences){for(const c of changes)if(c.table==='schedule_preferences')c.expectedUpdatedAt=undefined;}
    this.envelope.data=optimisticData;if(this.user&&supabase)this.envelope.pending.push(batch);const cached=writeCache(this.envelope,this.user?.id);this.emit();
    if(!cached){this.setSync('error','Device storage is full or unavailable. Export your JSON schedule before continuing.');return false;}
    if(!this.user||!supabase){this.setSync('local','Saved on this device. Sign in to sync between devices.');return true;}
    return this.flushQueue();
  }
  discardPendingAfterExport(){this.envelope.pending=[];writeCache(this.envelope,this.user?.id);this.setSync(this.user?'syncing':'local',this.user?'Reloading cloud data…':'Local changes preserved in the recovery export.');}
  preferenceExpectedVersion(current:string){return this.hasCloudPreferences?current:undefined;}
  async flushQueue():Promise<boolean>{
    if(!supabase||!this.user||!this.envelope.pending.length)return true;
    this.setSync('syncing','Syncing changes securely…');
    while(this.envelope.pending.length){
      const op=this.envelope.pending[0];
      try {
        const payload={p_id:op.id,p_data:op.data??{},p_expected_updated_at:op.table==='schedule_preferences'&&!this.hasCloudPreferences?null:op.expectedUpdatedAt??null,p_delete:op.deleted===true};
        const rpc=op.table==='sync_batch'?'sync_schedule_batch':op.table==='schedule_events'?'sync_schedule_event':op.table==='flexible_tasks'?'sync_flexible_task':op.table==='session_logs'?'sync_session_log':'sync_schedule_preferences';
        const result=op.table==='sync_batch'?await supabase.rpc(rpc,{p_ops:op.data}):await supabase.rpc(rpc,payload);
        const {error}=result;
        if(error)throw {...error,message:`${rpc} failed: ${error.message}`};
        if(op.table==='schedule_preferences')this.hasCloudPreferences=true;
        if(op.table==='sync_batch'&&(op.data as BatchChange[]).some(change=>change.table==='schedule_preferences'))this.hasCloudPreferences=true;
        this.envelope.pending.shift();writeCache(this.envelope,this.user.id);
      }catch(error){
        const detail=describeCloudError(error);
        if(detail.conflict)this.setSync('error',`A cloud edit conflict was detected${detail.code?` (${detail.code})`:''}: ${detail.message}. Your local copy is preserved; export it before reconciling.`);
        else if(detail.network)this.setSync('offline',`Cannot reach Supabase${detail.code?` (${detail.code})`:''}: ${detail.message}. Sync is pending; your last local save is preserved.`);
        else this.setSync('error',`Supabase rejected the schedule update${detail.code?` (${detail.code})`:''}: ${detail.message}. Your last local save and pending operation are preserved.`);
        writeCache(this.envelope,this.user.id);return false;
      }
    }
    this.envelope.lastCloudSync=iso();writeCache(this.envelope,this.user.id);this.setSync('synced','All changes synced');return true;
  }
  async refresh(){if(this.user)await this.loadCloud();}
  get userId(){return this.user?.id;}
}
export function saveEvent(repo:ScheduleRepository,data:ScheduleData,event:ScheduleEvent,expectedUpdatedAt?:string){return repo.commit({table:'schedule_events',id:event.id,data:event,expectedUpdatedAt},data);}
export function removeEvent(repo:ScheduleRepository,data:ScheduleData,event:ScheduleEvent){return repo.commit({table:'schedule_events',id:event.id,deleted:true,expectedUpdatedAt:event.updatedAt},data);}
export function saveTask(repo:ScheduleRepository,data:ScheduleData,task:FlexibleTask,expectedUpdatedAt?:string){return repo.commit({table:'flexible_tasks',id:task.id,data:task,expectedUpdatedAt},data);}
export function saveLog(repo:ScheduleRepository,data:ScheduleData,log:SessionLog,expectedUpdatedAt?:string){return repo.commit({table:'session_logs',id:log.id,data:log,expectedUpdatedAt},data);}
export function savePreferences(repo:ScheduleRepository,data:ScheduleData,prefs:Preferences,expectedUpdatedAt?:string){return repo.commit({table:'schedule_preferences',id:'default',data:prefs,expectedUpdatedAt:repo.preferenceExpectedVersion(expectedUpdatedAt||prefs.updatedAt)},data);}
