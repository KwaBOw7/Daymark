import type { ScheduleEvent } from './types';
import { dateAddDays, weekdayOf } from './time';
/** Expand recurring wall-clock definitions into concrete instances over an inclusive date range. */
export function expandEvents(events: ScheduleEvent[], from: string, through: string): ScheduleEvent[] {
  const out: ScheduleEvent[] = [];
  for (const event of events) {
    if (!event.recurrence) {
      if (event.date >= from && event.date <= through) out.push(event);
      continue;
    }
    const rule = event.recurrence;
    let date = from < rule.startDate ? rule.startDate : from;
    const finish = [through, rule.endDate || through].sort()[0];
    while (date <= finish) {
      const allowed = rule.frequency === 'daily' || (rule.weekdays || []).includes(weekdayOf(date));
      if (date >= event.date && allowed && !(rule.exceptions || []).includes(date)) {
        out.push({ ...event, id: `${event.id}@${date}`, originalId: event.id, date, recurrence: undefined });
      }
      date = dateAddDays(date, 1);
    }
  }
  return out.sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}


/** Move one expanded occurrence without changing the remaining series; the caller persists both rows atomically. */
export function moveRecurringOccurrence(events: ScheduleEvent[], occurrence: ScheduleEvent, date: string, start: string, end: string, updatedAt: string): { events: ScheduleEvent[]; updatedRoot: ScheduleEvent; override: ScheduleEvent } | undefined {
  if (!occurrence.originalId) return undefined;
  const root = events.find(event => event.id === occurrence.originalId);
  if (!root?.recurrence) return undefined;
  const originalDate = occurrence.date;
  const updatedRoot: ScheduleEvent = {
    ...root,
    recurrence: { ...root.recurrence, exceptions: [...new Set([...root.recurrence.exceptions, originalDate])] },
    updatedAt
  };
  const override: ScheduleEvent = {
    ...occurrence,
    id: `${root.id}__override__${originalDate}`,
    date,
    start,
    end,
    recurrence: undefined,
    originalId: undefined,
    locked: true,
    origin: 'manual',
    updatedAt
  };
  const nextEvents = [...events.filter(event => event.id !== root.id && event.id !== override.id), updatedRoot, override];
  return { events: nextEvents, updatedRoot, override };
}
