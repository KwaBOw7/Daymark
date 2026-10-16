import type { Preferences, ScheduleEvent } from './types';
import { dateAddDays, dateInZone, localDateTimeMs } from './time';
import { expandEvents } from './recurrence';
export interface DueReminder { key:string; eventId:string; title:string; category:ScheduleEvent['category']; minutesBefore:number; fireAt:number; message:string; date:string; start:string }
export const DEFAULT_REMINDER_GRACE_MS = 5 * 60_000;
/** Returns reminders within a short catch-up window so a background-throttled tab can recover without surfacing stale alerts. `seenKeys` is caller-owned durable dedupe state. */
export function getDueReminders(events:ScheduleEvent[],preferences:Preferences,now:Date,seenKeys:ReadonlySet<string>=new Set(),graceMs=DEFAULT_REMINDER_GRACE_MS):DueReminder[]{
 if(!preferences.remindersEnabled)return [];
 const timezone=preferences.timezone;const today=dateInZone(now,timezone);const from=dateAddDays(today,-8),through=dateAddDays(today,8);const nowMs=now.getTime();const out:DueReminder[]=[];
 for(const event of expandEvents(events,from,through)){
  if(!preferences.categoryNotifications[event.category])continue;
  for(const mins of event.reminderMinutes){
   let startMs:number;try{startMs=localDateTimeMs(event.date,event.start,timezone);}catch{continue;} // Skip a recurrence whose wall-clock time does not exist during a DST jump.
   const fireAt=startMs-mins*60_000;const key=`${event.id}:${mins}:${fireAt}`;
   if(seenKeys.has(key)||nowMs<fireAt||nowMs-fireAt>=graceMs)continue;
   const lateMs = Math.max(0, nowMs - fireAt);
   const untilStartMs = startMs - nowMs;
   let message: string;
   if (untilStartMs <= 0) message = `${event.title} was scheduled to start at ${event.start}.`;
   else if (lateMs >= 60_000) { const remaining = Math.max(1, Math.ceil(untilStartMs / 60_000)); message = `${event.title} starts in about ${remaining} minute${remaining===1?'':'s'} (reminder delayed).`; }
   else message = mins===0?`${event.title} starts now.`:`${event.title} starts in ${mins} minute${mins===1?'':'s'}.`;
   out.push({key,eventId:event.originalId||event.id,title:event.title,category:event.category,minutesBefore:mins,fireAt,message,date:event.date,start:event.start});
  }
 }
 return out.sort((a,b)=>a.fireAt-b.fireAt||a.eventId.localeCompare(b.eventId));
}
