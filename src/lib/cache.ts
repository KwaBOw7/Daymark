import { emptySchedule, type ScheduleData } from '../domain/types';
const PREFIX='daymark:v1:';
export interface PendingOperation { table:'schedule_events'|'flexible_tasks'|'session_logs'|'schedule_preferences'|'sync_batch'; id:string; data?:unknown; expectedUpdatedAt?:string; deleted?:boolean; queuedAt:string }
export interface CachedEnvelope { data:ScheduleData; pending:PendingOperation[]; lastCloudSync?:string; error?:string }
const key=(userId?:string)=>`${PREFIX}${userId||'local'}`;
export function readCache(userId?:string):CachedEnvelope {
  try{const raw=localStorage.getItem(key(userId));if(raw){const parsed=JSON.parse(raw) as CachedEnvelope;if(parsed.data&&Array.isArray(parsed.data.events)&&Array.isArray(parsed.data.tasks))return parsed;}}
  catch(error){console.warn('Schedule cache could not be read',error);}
  return {data:emptySchedule(),pending:[]};
}
export function writeCache(envelope:CachedEnvelope,userId?:string) {
  try{localStorage.setItem(key(userId),JSON.stringify(envelope));return true;}
  catch(error){console.error('Schedule cache could not be saved',error);return false;}
}
export function queueOperation(op:PendingOperation,userId?:string) { const box=readCache(userId);box.pending.push(op);writeCache(box,userId); }
