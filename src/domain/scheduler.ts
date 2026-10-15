import type { FlexibleTask, Preferences, ScheduleEvent } from './types';
import { dateAddDays, dateInZone, isDate, minutesToTime, timeInZone, timeToMinutes, weekdayOf } from './time';
import { expandEvents } from './recurrence';

export interface UnscheduledTask { taskId:string; title:string; reason:string; alternatives:{date:string;start:string;end:string}[] }
export interface ScheduleProposal { created:ScheduleEvent[]; replaceIds:string[]; unscheduled:UnscheduledTask[]; explanations:string[]; range:{from:string;through:string} }
export interface SchedulerOptions { from:string; through:string; replacePlanned?:boolean; maxDailyStudyMinutes?:number; now?:Date }
const priorityRank:Record<FlexibleTask['priority'],number>={urgent:0,high:1,normal:2,low:3};
const isoNow=()=>new Date().toISOString();
const overlaps=(a:{date:string;start:string;end:string},b:{date:string;start:string;end:string},buffer:number)=>a.date===b.date&&timeToMinutes(a.start)<timeToMinutes(b.end)+buffer&&timeToMinutes(a.end)+buffer>timeToMinutes(b.start);
const weekKey=(date:string,weekStartsOn:0|1)=>{const d=new Date(`${date}T12:00:00Z`);const offset=(d.getUTCDay()-weekStartsOn+7)%7;d.setUTCDate(d.getUTCDate()-offset);return d.toISOString().slice(0,10);};
function deadlineDate(deadline:string|undefined,timezone?:string) { if(!deadline)return undefined;if(deadline.length===10)return deadline;const instant=new Date(deadline);return timezone&&!Number.isNaN(instant.getTime())?dateInZone(instant,timezone):deadline.slice(0,10); }
function preferred(task:FlexibleTask,date:string,start:string,end:string):boolean {
  if(!task.preferredWindows.length)return true;
  const a=timeToMinutes(start),b=timeToMinutes(end),day=weekdayOf(date);
  return task.preferredWindows.some(w=>(!w.weekdays||w.weekdays.includes(day))&&a>=timeToMinutes(w.start)&&b<=timeToMinutes(w.end));
}
function inQuietHours(start:number,end:number,p:Preferences) {
  const ss=timeToMinutes(p.sleepStart),se=timeToMinutes(p.sleepEnd);
  if(ss===se)return false;
  if(ss<se)return start<se&&end>ss;
  return end>ss||start<se;
}
function candidateDays(task:FlexibleTask, date:string) { return task.eligibleDays.includes(weekdayOf(date)); }
function makeEvent(task:FlexibleTask,date:string,start:number,end:number):ScheduleEvent {
  return {id:`plan_${task.id}_${date.replaceAll('-','')}_${String(start).padStart(4,'0')}`,title:task.title,date,start:minutesToTime(start),end:minutesToTime(end),category:task.category,kind:task.category==='study'?'study':'task',location:undefined,notes:task.description,reminderMinutes:[...task.reminderMinutes],locked:false,taskId:task.id,origin:'scheduler',updatedAt:isoNow()};
}
/**
 * Deterministic greedy allocation. It ranks tasks by priority, then deadline, then title/ID;
 * it scans wall-clock minutes and never mutates the input. Splittable sessions are divided
 * only when no uninterrupted full-duration placement exists, respecting their minimum chunk.
 */
export function planFlexibleTasks(events:ScheduleEvent[],tasks:FlexibleTask[],preferences:Preferences,options:SchedulerOptions):ScheduleProposal {
  if(!isDate(options.from)||!isDate(options.through)||options.through<options.from)throw new Error('Choose a valid scheduling range.');
  const tz=preferences.timezone;
  const now=options.now||new Date();
  const localNowDate=dateInZone(now,tz), localNowTime=timeInZone(now,tz);
  const generated:ScheduleEvent[]=[];const unscheduled:UnscheduledTask[]=[];const explanations:string[]=[];
  const replaceIds=options.replacePlanned?[...new Set(events.filter(e=>e.origin==='scheduler'&&!e.locked&&e.date>=options.from&&e.date<=options.through).map(e=>e.id))]:[];
  const stableEvents=events.filter(e=>!replaceIds.includes(e.id));
  const occupied=[...expandEvents(stableEvents,options.from,options.through)];
  const active=tasks.filter(t=>t.status==='active').slice().sort((a,b)=>priorityRank[a.priority]-priorityRank[b.priority]||(deadlineDate(a.deadline,tz)||'9999-12-31').localeCompare(deadlineDate(b.deadline,tz)||'9999-12-31')||a.title.localeCompare(b.title)||a.id.localeCompare(b.id));
  const perDayMinutes=new Map<string,number>();
  for(const e of occupied)if(e.taskId&&e.date>=options.from&&e.date<=options.through)perDayMinutes.set(e.date,(perDayMinutes.get(e.date)||0)+timeToMinutes(e.end)-timeToMinutes(e.start));
  const hardStart=timeToMinutes(preferences.dayStart),hardEnd=timeToMinutes(preferences.dayEnd);
  const maxMinutes=options.maxDailyStudyMinutes??240;
  const buffer=preferences.restBufferMinutes+preferences.travelBufferMinutes;

  const findBest=(task:FlexibleTask,dates:string[],usedDays:Set<string>,duration:number):{event:ScheduleEvent;score:number}|undefined=>{
    let best:{event:ScheduleEvent;score:number}|undefined;
    for(const date of dates){
      if(!candidateDays(task,date)||usedDays.has(date))continue;
      if((perDayMinutes.get(date)||0)+duration>maxMinutes)continue;
      const floor=date===localNowDate?Math.max(hardStart,timeToMinutes(localNowTime)):hardStart;
      for(let start=floor;start+duration<=hardEnd;start++){
        const end=start+duration;
        if(inQuietHours(start,end,preferences))continue;
        const candidate={date,start:minutesToTime(start),end:minutesToTime(end)};
        if(occupied.some(e=>overlaps(candidate,e,buffer)))continue;
        const pref=preferred(task,date,candidate.start,candidate.end);
        const center=(start+end)/2, ideal=12*60;
        // Preferred window matches are ranked first, then mid-day, lighter days and earlier dates.
        const score=(pref?0:5000)+Math.abs(center-ideal)+(perDayMinutes.get(date)||0)*0.2+start*0.0001;
        if(!best||score<best.score)best={event:makeEvent(task,date,start,end),score};
      }
    }
    return best;
  };
  for(const task of active){
    const due=deadlineDate(task.deadline,tz);const from=task.notBefore&&task.notBefore>options.from?task.notBefore:options.from;const through=due&&due<options.through?due:options.through;
    if(through<from){unscheduled.push({taskId:task.id,title:task.title,reason:`The task's deadline (${due}) is before its available scheduling window.`,alternatives:[]});continue;}
    const already=stableEvents.filter(e=>e.taskId===task.id&&e.date>=options.from&&e.date<=options.through);
    const sessionsNeeded=new Map<string,number>();
    for(let d=from;d<=through;d=dateAddDays(d,1)){const wk=weekKey(d,preferences.weekStartsOn);if(!sessionsNeeded.has(wk))sessionsNeeded.set(wk,task.weeklyFrequency);}
    // Existing task-linked blocks count as already planned sessions for their week.
    for(const e of already){const wk=weekKey(e.date,preferences.weekStartsOn);if(sessionsNeeded.has(wk))sessionsNeeded.set(wk,Math.max(0,(sessionsNeeded.get(wk)||0)-1));}
    const slotsWanted=[...sessionsNeeded.values()].reduce((sum,n)=>sum+n,0);
    let placedSessions=0;let incompleteSessions=0;const taskAlternatives:{date:string;start:string;end:string}[]=[];
    for(const [week,count] of sessionsNeeded){
      if(count<=0)continue;
      const weekDates:string[]=[];let cursor=week>from?week:from;while(cursor<=through&&weekKey(cursor,preferences.weekStartsOn)===week){weekDates.push(cursor);cursor=dateAddDays(cursor,1);}
      const usedDays=new Set<string>();
      for(let n=0;n<count;n++){
        // Prefer one uninterrupted block; split only if the complete session cannot fit anywhere.
        const whole=findBest(task,weekDates,usedDays,task.durationMinutes);
        if(whole){
          const ev=whole.event;generated.push(ev);occupied.push(ev);usedDays.add(ev.date);perDayMinutes.set(ev.date,(perDayMinutes.get(ev.date)||0)+task.durationMinutes);placedSessions++;continue;
        }
        if(!task.splittable){incompleteSessions++;continue;}
        let remaining=task.durationMinutes;let chunkCount=0;
        // Largest feasible chunks first. Re-evaluate each time because every accepted chunk occupies time.
        while(remaining>0){
          let found:{event:ScheduleEvent;score:number}|undefined;let foundDuration=0;
          const upper=Math.min(remaining,90);
          const startAt=Math.max(task.minimumSessionMinutes,Math.floor(upper/5)*5);
          for(let duration=startAt;duration>=task.minimumSessionMinutes;duration=Math.max(task.minimumSessionMinutes,duration-5)){
            found=findBest(task,weekDates,usedDays,duration);
            if(found){foundDuration=duration;break;}
            if(duration===task.minimumSessionMinutes)break;
          }
          if(!found||foundDuration===0)break;
          const ev=found.event;generated.push(ev);occupied.push(ev);usedDays.add(ev.date);perDayMinutes.set(ev.date,(perDayMinutes.get(ev.date)||0)+foundDuration);remaining-=foundDuration;chunkCount++;
        }
        if(remaining<=0&&chunkCount>0)placedSessions++;
        else {incompleteSessions++;}
      }
    }
    if(incompleteSessions>0){
      for(let d=from;d<=through&&taskAlternatives.length<5;d=dateAddDays(d,1)){
        if(!candidateDays(task,d))continue;
        const duration=task.splittable?Math.min(task.durationMinutes,Math.max(task.minimumSessionMinutes,Math.floor((hardEnd-hardStart)/5)*5)):task.durationMinutes;
        const best=findBest(task,[d],new Set(),duration);
        if(best)taskAlternatives.push({date:d,start:best.event.start,end:best.event.end});
      }
      let reason:string;
      if(due&&due<options.from)reason=`Deadline passed on ${due}; no slot can satisfy it.`;
      else if(!task.eligibleDays.some(day=>{let x=from;while(x<=through){if(weekdayOf(x)===day)return true;x=dateAddDays(x,1);}return false;}))reason='None of the eligible weekdays fall inside this scheduling range.';
      else if(!task.splittable&&task.durationMinutes>hardEnd-hardStart)reason=`The ${task.durationMinutes}-minute session is longer than your ${hardEnd-hardStart}-minute working window. Enable splitting or shorten the session.`;
      else if(taskAlternatives.length===0)reason='No conflict-free slot fits the duration, working hours, rest/travel buffers and daily load limit.';
      else reason=`${incompleteSessions} requested session(s) remain unplaced after checking eligible days, preferred windows, buffers and existing commitments.`;
      unscheduled.push({taskId:task.id,title:task.title,reason,alternatives:taskAlternatives});
    }
    const requested=slotsWanted;const placed= Math.max(0,requested-incompleteSessions);
    explanations.push(`${task.title}: ${placed}/${requested} requested session(s) placed${task.splittable?' (splitting used only where a full block did not fit)':''}. ${incompleteSessions?'Unplaced sessions remain unscheduled; no existing commitments were moved.':`Ranked ${task.priority} priority${due?`, deadline ${due}`:''}.`}`);
  }
  // Stable IDs also make repeated previews idempotent even if the same task is proposed again.
  const unique=new Map<string,ScheduleEvent>();for(const ev of generated)unique.set(ev.id,ev);
  return {created:[...unique.values()],replaceIds,unscheduled,explanations,range:{from:options.from,through:options.through}};
}
export function applyProposal(events:ScheduleEvent[],proposal:ScheduleProposal,confirmedReplacement=false):ScheduleEvent[] {
  if(proposal.replaceIds.length&&!confirmedReplacement)throw new Error('Confirmation is required before replacing existing planned blocks.');
  const remove=new Set(proposal.replaceIds);
  return [...events.filter(e=>!remove.has(e.id)),...proposal.created];
}
