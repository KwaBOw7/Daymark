import type { ScheduleEvent } from './types';
import { expandEvents } from './recurrence';
import { timeToMinutes } from './time';
export interface Conflict { firstId:string; secondId:string; date:string; overlapStart:string; overlapEnd:string; message:string }
export function findConflicts(events: ScheduleEvent[], _timezone: string, bufferMinutes = 0, from?:string, through?:string): Conflict[] {
  const dates = events.map(e=>e.date).sort();
  const start = from || dates[0]; const end = through || dates.at(-1);
  if (!start || !end) return [];
  const concrete = expandEvents(events,start,end).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  const conflicts:Conflict[]=[];
  for (let i=0;i<concrete.length;i++) for(let j=i+1;j<concrete.length;j++) {
    const a=concrete[i], b=concrete[j]; if(a.date!==b.date) { if(b.date>a.date) break; continue; }
    const aStart=timeToMinutes(a.start), aEnd=timeToMinutes(a.end);
    const bStart=timeToMinutes(b.start), bEnd=timeToMinutes(b.end);
    if (aStart < bEnd + bufferMinutes && bStart < aEnd + bufferMinutes) {
      conflicts.push({ firstId:a.originalId||a.id,secondId:b.originalId||b.id,date:a.date,overlapStart:a.start>b.start?a.start:b.start,overlapEnd:a.end<b.end?a.end:b.end,message:`“${a.title}” and “${b.title}” overlap on ${a.date}.` });
    }
  }
  return conflicts;
}
export function eventOverlap(a:Pick<ScheduleEvent,'date'|'start'|'end'>,b:Pick<ScheduleEvent,'date'|'start'|'end'>,_timezone:string,bufferMinutes=0):boolean {
  if(a.date!==b.date)return false;
  const as=timeToMinutes(a.start),ae=timeToMinutes(a.end),bs=timeToMinutes(b.start),be=timeToMinutes(b.end);
  return as < be+bufferMinutes && bs < ae+bufferMinutes;
}
export function isValidInterval(start:string,end:string) { try { return timeToMinutes(end)>timeToMinutes(start); } catch { return false; } }
