import type { Category, FlexibleTask, PreferredWindow, ScheduleData, ScheduleEvent, RecurrenceRule, EventKind, Priority } from './types';
import { CATEGORIES } from './types';
import { findConflicts } from './conflicts';
import { dateAddDays,isDate,isTime,timeToMinutes,isValidTimezone } from './time';

export interface ImportProblem { path:string; message:string }
export interface ImportDiff<T> { additions:T[]; changes:T[]; unchanged:T[] }
export interface ImportPreview { version:number; timezone:string; events:ImportDiff<ScheduleEvent>; tasks:ImportDiff<FlexibleTask>; invalid:ImportProblem[]; conflicts:ReturnType<typeof findConflicts>; valid:boolean; sourceName?:string }
export function exportScheduleDocument(data:ScheduleData) {
  return { schemaVersion:1 as const, timezone:data.preferences.timezone,
    events:data.events.map(e=>({id:e.id,title:e.title,date:e.date,start:e.start,end:e.end,category:e.category,kind:e.kind,...(e.recurrence?{recurrence:e.recurrence}:{}),...(e.location?{location:e.location}:{}),...(e.notes?{notes:e.notes}:{}),reminderMinutes:e.reminderMinutes,locked:e.locked,...(e.taskId?{taskId:e.taskId}:{})})),
    tasks:data.tasks.map(t=>({id:t.id,title:t.title,...(t.description?{description:t.description}:{}),category:t.category,priority:t.priority,durationMinutes:t.durationMinutes,...(t.deadline?{deadline:t.deadline}:{}),...(t.notBefore?{notBefore:t.notBefore}:{}),eligibleDays:t.eligibleDays,preferredWindows:t.preferredWindows,weeklyFrequency:t.weeklyFrequency,splittable:t.splittable,minimumSessionMinutes:t.minimumSessionMinutes,status:t.status,reminderMinutes:t.reminderMinutes}))
  };
}
const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const str=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
function rejectUnknown(raw:Record<string,unknown>,allowed:string[],path:string,errors:ImportProblem[]){for(const key of Object.keys(raw))if(!allowed.includes(key))errors.push({path:`${path}.${key}`,message:`Unknown field "${key}" for schema version 1. Check the field name or update schemaVersion when a newer format is supported.`});}
function normalizeEvent(raw:Record<string,unknown>,path:string,errors:ImportProblem[]):ScheduleEvent|undefined {
  rejectUnknown(raw,['id','title','date','start','end','category','kind','recurrence','location','notes','reminderMinutes','locked','taskId'],path,errors);
  const required=['id','title','date','start','end','category']; let ok=true;
  for(const k of required) if(!str(raw[k])) { errors.push({path:`${path}.${k}`,message:`${k} is required.`}); ok=false; }
  if(!str(raw.id)||!str(raw.title)||!isDate(raw.date)||!isTime(raw.start)||!isTime(raw.end)||!CATEGORIES.includes(raw.category as Category)) ok=false;
  if(str(raw.date)&&!isDate(raw.date)) errors.push({path:`${path}.date`,message:'Use a real calendar date in YYYY-MM-DD format.'});
  for(const k of ['start','end']) if(str(raw[k])&&!isTime(raw[k])) errors.push({path:`${path}.${k}`,message:'Use 24-hour HH:mm format with minute precision.'});
  if(isTime(raw.start)&&isTime(raw.end)&&timeToMinutes(raw.end)<=timeToMinutes(raw.start)) {errors.push({path,message:'End time must be later than start time. Overnight events should be split at midnight.'});ok=false;}
  if(str(raw.category)&&!CATEGORIES.includes(raw.category as Category)){errors.push({path:`${path}.category`,message:`Choose one of: ${CATEGORIES.join(', ')}.`});ok=false;}
  let recurrence:RecurrenceRule|undefined;
  if(raw.recurrence!==undefined){
    const r=raw.recurrence;
    if(!isObj(r)){errors.push({path:`${path}.recurrence`,message:'Recurrence must be an object.'});ok=false;}
    else {
      rejectUnknown(r,['frequency','weekdays','startDate','endDate','exceptions'],`${path}.recurrence`,errors);
      if(r.weekdays!==undefined&&!Array.isArray(r.weekdays)){errors.push({path:`${path}.recurrence.weekdays`,message:'weekdays must be an array of weekday numbers.'});ok=false;}
      if(r.exceptions!==undefined&&!Array.isArray(r.exceptions)){errors.push({path:`${path}.recurrence.exceptions`,message:'exceptions must be an array of date strings.'});ok=false;}
      const frequency=r.frequency;
      if(frequency!=='daily'&&frequency!=='weekly'){errors.push({path:`${path}.recurrence.frequency`,message:'Frequency must be daily or weekly.'});ok=false;}
      const days=arr(r.weekdays);
      if(days.some(d=>!Number.isInteger(d)||Number(d)<0||Number(d)>6)){errors.push({path:`${path}.recurrence.weekdays`,message:'Weekdays must be integer values numbered 0 (Sunday) through 6 (Saturday).'});ok=false;}
      if(frequency==='weekly'&&!days.length){errors.push({path:`${path}.recurrence.weekdays`,message:'Weekly recurrence needs at least one weekday numbered 0 (Sunday) through 6 (Saturday).'});ok=false;}
      if(!isDate(r.startDate)|| (r.endDate!==undefined&&!isDate(r.endDate)) || (isDate(r.endDate)&&r.endDate<r.startDate)){errors.push({path:`${path}.recurrence`,message:'Recurrence needs a valid startDate and optional endDate not before it.'});ok=false;}
      const ex=arr(r.exceptions);
      if(ex.some(d=>!isDate(d))){errors.push({path:`${path}.recurrence.exceptions`,message:'Each exception must be a YYYY-MM-DD date.'});ok=false;}
      recurrence={frequency:frequency==='daily'?'daily':'weekly',weekdays:days.map(Number),startDate:isDate(r.startDate)?r.startDate:(raw.date as string),endDate:isDate(r.endDate)?r.endDate:undefined,exceptions:ex.filter(isDate)};
    }
  }
  if(raw.reminderMinutes!==undefined&&!Array.isArray(raw.reminderMinutes)){errors.push({path:`${path}.reminderMinutes`,message:'reminderMinutes must be an array of integer minute offsets.'});ok=false;}
  const reminders=raw.reminderMinutes===undefined?[10,0]:arr(raw.reminderMinutes);
  if(reminders.some(m=>!Number.isInteger(m)||Number(m)<0||Number(m)>10080)){errors.push({path:`${path}.reminderMinutes`,message:'Reminder minutes must be whole numbers between 0 and 10080; 0 means at start.'});ok=false;}
  const kinds:EventKind[]=['fixed','study','task','personal','rest'];
  if(raw.kind!==undefined&&!kinds.includes(raw.kind as EventKind)){errors.push({path:`${path}.kind`,message:'kind must be fixed, study, task, personal or rest.'});ok=false;}
  if(raw.locked!==undefined&&typeof raw.locked!=='boolean'){errors.push({path:`${path}.locked`,message:'locked must be true or false.'});ok=false;}
  for(const k of ['location','notes','taskId'])if(raw[k]!==undefined&&typeof raw[k]!=='string'){errors.push({path:`${path}.${k}`,message:`${k} must be a string when provided; omit the field when empty.`});ok=false;}
  if(!ok)return undefined;
  const kind=kinds.includes(raw.kind as EventKind)?raw.kind as EventKind:'fixed';
  return {id:raw.id as string,title:(raw.title as string).trim(),date:raw.date as string,start:raw.start as string,end:raw.end as string,category:raw.category as Category,kind,recurrence,location:str(raw.location)?raw.location as string:undefined,notes:str(raw.notes)?raw.notes as string:undefined,reminderMinutes:[...new Set(reminders as number[])],locked:raw.locked===undefined?true:raw.locked===true,taskId:str(raw.taskId)?raw.taskId as string:undefined,origin:'import',updatedAt:new Date().toISOString()};
}
function normalizeTask(raw:Record<string,unknown>,path:string,errors:ImportProblem[]):FlexibleTask|undefined {
  rejectUnknown(raw,['id','title','description','category','priority','durationMinutes','deadline','notBefore','eligibleDays','preferredWindows','weeklyFrequency','splittable','minimumSessionMinutes','status','reminderMinutes'],path,errors);
  let ok=true;
  for(const k of ['id','title','category','durationMinutes'])if(raw[k]===undefined||raw[k]===null||raw[k]===''){errors.push({path:`${path}.${k}`,message:`${k} is required.`});ok=false;}
  if(!str(raw.id)||!str(raw.title)||!CATEGORIES.includes(raw.category as Category)){if(str(raw.category)&&!CATEGORIES.includes(raw.category as Category))errors.push({path:`${path}.category`,message:'Unknown category.'});ok=false;}
  if(!Number.isInteger(raw.durationMinutes)||Number(raw.durationMinutes)<1||Number(raw.durationMinutes)>1440){errors.push({path:`${path}.durationMinutes`,message:'Duration must be a whole number from 1 to 1440 minutes.'});ok=false;}
  const validPriorities:Priority[]=['low','normal','high','urgent']; if(raw.priority!==undefined&&!validPriorities.includes(raw.priority as Priority)){errors.push({path:`${path}.priority`,message:'priority must be low, normal, high or urgent.'});ok=false;} const priority:Priority=validPriorities.includes(raw.priority as Priority)?raw.priority as Priority:'normal';
  if(raw.eligibleDays!==undefined&&!Array.isArray(raw.eligibleDays)){errors.push({path:`${path}.eligibleDays`,message:'eligibleDays must be an array of weekday numbers.'});ok=false;} const days=raw.eligibleDays===undefined?[1,2,3,4,5,6,0]:arr(raw.eligibleDays);
  if(days.some(d=>!Number.isInteger(d)||Number(d)<0||Number(d)>6)){errors.push({path:`${path}.eligibleDays`,message:'Use weekday numbers 0–6.'});ok=false;}
  if(raw.preferredWindows!==undefined&&!Array.isArray(raw.preferredWindows)){errors.push({path:`${path}.preferredWindows`,message:'preferredWindows must be an array of time windows.'});ok=false;} const winRaw=raw.preferredWindows===undefined?[]:arr(raw.preferredWindows); const windows:PreferredWindow[]=[];
  for(let i=0;i<winRaw.length;i++){
    const w=winRaw[i]; if(!isObj(w)||!isTime(w.start)||!isTime(w.end)||timeToMinutes(w.end)<=timeToMinutes(w.start)){errors.push({path:`${path}.preferredWindows[${i}]`,message:'A window needs start/end times (HH:mm), with end later than start.'});ok=false;continue;}
    rejectUnknown(w,['start','end','weekdays'],`${path}.preferredWindows[${i}]`,errors);
    if(w.weekdays!==undefined&&!Array.isArray(w.weekdays)){errors.push({path:`${path}.preferredWindows[${i}].weekdays`,message:'weekdays must be an array of weekday numbers.'});ok=false;} const wd=arr(w.weekdays);if(wd.some(d=>!Number.isInteger(d)||Number(d)<0||Number(d)>6)){errors.push({path:`${path}.preferredWindows[${i}].weekdays`,message:'Use weekday numbers 0–6.'});ok=false;}
    windows.push({start:w.start,end:w.end,weekdays:wd.length?wd as number[]:undefined});
  }
  const deadlineString=typeof raw.deadline==='string'?raw.deadline:'';const deadlineIsDate=isDate(deadlineString);const deadlineIsIso=deadlineString.length>10&&isDate(deadlineString.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(deadlineString)&&!Number.isNaN(Date.parse(deadlineString));if(raw.deadline!==undefined&&!(deadlineIsDate||deadlineIsIso)){errors.push({path:`${path}.deadline`,message:'Use YYYY-MM-DD or an ISO-8601 datetime with a timezone offset; omit deadline when none is set.'});ok=false;}
  if(raw.notBefore!==undefined&&!isDate(raw.notBefore)){errors.push({path:`${path}.notBefore`,message:'Use YYYY-MM-DD; omit notBefore when no start-date restriction applies.'});ok=false;}
  const frequency=raw.weeklyFrequency===undefined?1:raw.weeklyFrequency;
  if(!Number.isInteger(frequency)||Number(frequency)<1||Number(frequency)>14){errors.push({path:`${path}.weeklyFrequency`,message:'Must be an integer from 1 to 14 sessions per week.'});ok=false;}
  const min=raw.minimumSessionMinutes===undefined?Math.min(25,Number(raw.durationMinutes)||25):raw.minimumSessionMinutes;
  if(!Number.isInteger(min)||Number(min)<1||Number(min)>Number(raw.durationMinutes)){errors.push({path:`${path}.minimumSessionMinutes`,message:'Must be a whole number no greater than durationMinutes.'});ok=false;}
  if(raw.reminderMinutes!==undefined&&!Array.isArray(raw.reminderMinutes)){errors.push({path:`${path}.reminderMinutes`,message:'reminderMinutes must be an array of integer minute offsets.'});ok=false;} const reminders=raw.reminderMinutes===undefined?[10,0]:arr(raw.reminderMinutes);
  if(reminders.some(m=>!Number.isInteger(m)||Number(m)<0||Number(m)>10080)){errors.push({path:`${path}.reminderMinutes`,message:'Use whole minutes between 0 and 10080.'});ok=false;}
  if(raw.splittable!==undefined&&typeof raw.splittable!=='boolean'){errors.push({path:`${path}.splittable`,message:'splittable must be true or false.'});ok=false;}
  const taskStatuses:FlexibleTask['status'][]=['active','completed','archived']; if(raw.status!==undefined&&!taskStatuses.includes(raw.status as FlexibleTask['status'])){errors.push({path:`${path}.status`,message:'status must be active, completed or archived.'});ok=false;} if(raw.description!==undefined&&typeof raw.description!=='string'){errors.push({path:`${path}.description`,message:'description must be a string when provided; omit it when empty.'});ok=false;}
  if(!ok)return undefined;
  const status:FlexibleTask['status']=['active','completed','archived'].includes(raw.status as string)?raw.status as FlexibleTask['status']:'active';
  return {id:raw.id as string,title:(raw.title as string).trim(),description:str(raw.description)?raw.description as string:undefined,category:raw.category as Category,priority,durationMinutes:Number(raw.durationMinutes),deadline:raw.deadline as string|undefined,notBefore:raw.notBefore as string|undefined,eligibleDays:days as number[],preferredWindows:windows,weeklyFrequency:Number(frequency),splittable:raw.splittable===true,minimumSessionMinutes:Number(min),status,reminderMinutes:[...new Set(reminders as number[])],updatedAt:new Date().toISOString()};
}
function diff<T extends {id:string}>(incoming:T[], existing:T[]):ImportDiff<T>{
  const old=new Map(existing.map(x=>[x.id,x]));const additions:T[]=[],changes:T[]=[],unchanged:T[]=[];
  for(const item of incoming){const before=old.get(item.id);if(!before)additions.push(item);else{const clean=(x:T)=>{const c={...x} as Record<string,unknown>;delete c.updatedAt;delete c.origin;return JSON.stringify(c);};if(clean(item)===clean(before))unchanged.push(before);else changes.push(item);}}
  return {additions,changes,unchanged};
}
export function parseScheduleImport(text:string, existing:ScheduleData):ImportPreview {
  const invalid:ImportProblem[]=[];let raw:unknown;
  try{raw=JSON.parse(text);}catch(e){return {version:0,timezone:existing.preferences.timezone,events:{additions:[],changes:[],unchanged:[]},tasks:{additions:[],changes:[],unchanged:[]},invalid:[{path:'$',message:`JSON could not be parsed: ${e instanceof Error?e.message:'invalid syntax'}`}],conflicts:[],valid:false};}
  if(!isObj(raw))return {version:0,timezone:existing.preferences.timezone,events:{additions:[],changes:[],unchanged:[]},tasks:{additions:[],changes:[],unchanged:[]},invalid:[{path:'$',message:'The root must be a JSON object.'}],conflicts:[],valid:false};
  rejectUnknown(raw,['schemaVersion','timezone','events','tasks'],'$',invalid);
  if(raw.schemaVersion!==1) invalid.push({path:'$.schemaVersion',message:'Unsupported schemaVersion. This app currently accepts version 1.'});
  if(!str(raw.timezone)||!isValidTimezone(raw.timezone as string))invalid.push({path:'$.timezone',message:'timezone must be a valid IANA timezone such as Africa/Accra.'});
  for(const key of ['events','tasks'])if(!Array.isArray(raw[key]))invalid.push({path:`$.${key}`,message:`${key} must be an array (use [] when empty).`});
  const events:ScheduleEvent[]=[];const tasks:FlexibleTask[]=[];const seenEvents=new Set<string>(),seenTasks=new Set<string>();
  if(Array.isArray(raw.events))raw.events.forEach((item,i)=>{const path=`$.events[${i}]`;if(!isObj(item)){invalid.push({path,message:'Event must be an object.'});return;}const incomingId=str(item.id)?item.id as string:undefined;if(incomingId&&seenEvents.has(incomingId)){invalid.push({path:`${path}.id`,message:`Duplicate event ID "${incomingId}" in this import.`});return;}if(incomingId)seenEvents.add(incomingId);const event=normalizeEvent(item,path,invalid);if(event)events.push(event);});
  if(Array.isArray(raw.tasks))raw.tasks.forEach((item,i)=>{const path=`$.tasks[${i}]`;if(!isObj(item)){invalid.push({path,message:'Task must be an object.'});return;}const incomingId=str(item.id)?item.id as string:undefined;if(incomingId&&seenTasks.has(incomingId)){invalid.push({path:`${path}.id`,message:`Duplicate task ID "${incomingId}" in this import.`});return;}if(incomingId)seenTasks.add(incomingId);const task=normalizeTask(item,path,invalid);if(task)tasks.push(task);});
  const eventDiff=diff(events,existing.events),taskDiff=diff(tasks,existing.tasks);
  const touched=new Set([...eventDiff.additions,...eventDiff.changes].map(e=>e.id));
  const retained=existing.events.filter(e=>!touched.has(e.id));
  const all=[...retained,...eventDiff.additions,...eventDiff.changes];
  const dates=[...all.map(e=>e.date),...events.map(e=>e.recurrence?.endDate||e.date)].sort();
  const conflictThrough=dates.length&&all.some(e=>e.recurrence&&!e.recurrence.endDate)?dateAddDays(dates.at(-1)!,90):dates.at(-1);
  const conflicts=dates.length?findConflicts(all, str(raw.timezone)&&isValidTimezone(raw.timezone as string)?raw.timezone as string:existing.preferences.timezone,0,dates[0],conflictThrough):[];
  return {version:typeof raw.schemaVersion==='number'?raw.schemaVersion:0,timezone:str(raw.timezone)?raw.timezone as string:existing.preferences.timezone,events:eventDiff,tasks:taskDiff,invalid,conflicts,valid:invalid.length===0};
}
export function applyImport(existing:ScheduleData,preview:ImportPreview):ScheduleData {
  if(!preview.valid)throw new Error('Fix all invalid import entries before applying. Nothing was changed.');
  const merge=<T extends {id:string}>(old:T[],d:ImportDiff<T>)=>{const map=new Map(old.map(x=>[x.id,x]));for(const x of [...d.additions,...d.changes])map.set(x.id,x);return [...map.values()];};
  const preferences=preview.timezone===existing.preferences.timezone?existing.preferences:{...existing.preferences,timezone:preview.timezone,updatedAt:new Date().toISOString()};
  return {...existing,events:merge(existing.events,preview.events),tasks:merge(existing.tasks,preview.tasks),preferences};
}
