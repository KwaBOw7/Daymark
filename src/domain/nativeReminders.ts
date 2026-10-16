import type { Preferences, ScheduleEvent } from './types';
import { dateAddDays, dateInZone, localDateTimeMs } from './time';
import { expandEvents } from './recurrence';

/**
 * A platform-neutral plan for OS-scheduled notifications. The native notification
 * system delivers these offline after scheduling; the web page does not need to run.
 */
export interface NativeReminderPlan {
  id: number;
  key: string;
  title: string;
  body: string;
  fireAt: number;
  extra: { daymark: true; key: string; eventId: string; date: string; start: string; minutesBefore: number };
}

export const NATIVE_NOTIFICATION_HORIZON_DAYS = 30;
/** Keep under iOS's practical pending-local-notification limit, leaving room for system/plugin notifications. */
export const NATIVE_NOTIFICATION_LIMIT = 60;

function stableNotificationId(value: string): number {
  // FNV-1a; positive 31-bit IDs are accepted by both Android and iOS bridges.
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const id = (hash >>> 0) & 0x7fffffff;
  return id || 1;
}

export function buildNativeReminderPlan(
  events: ScheduleEvent[],
  preferences: Preferences,
  now = new Date(),
  limit = NATIVE_NOTIFICATION_LIMIT,
  horizonDays = NATIVE_NOTIFICATION_HORIZON_DAYS
): NativeReminderPlan[] {
  if (!preferences.remindersEnabled || limit <= 0 || horizonDays <= 0) return [];
  const timezone = preferences.timezone;
  const from = dateInZone(now, timezone);
  const through = dateAddDays(from, horizonDays);
  const occurrences = expandEvents(events, from, through);
  const candidates: NativeReminderPlan[] = [];
  const seen = new Set<string>();

  for (const event of occurrences) {
    if (!preferences.categoryNotifications[event.category]) continue;
    for (const minutesBefore of [...new Set(event.reminderMinutes)]) {
      let eventStart: number;
      try {
        eventStart = localDateTimeMs(event.date, event.start, timezone);
      } catch {
        // A DST transition can make a requested wall-clock time nonexistent.
        continue;
      }
      const fireAt = eventStart - minutesBefore * 60_000;
      if (!Number.isFinite(fireAt) || fireAt <= now.getTime() + 1000) continue;
      const key = `${event.originalId || event.id}:${event.date}:${minutesBefore}:${fireAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const body = minutesBefore === 0
        ? `${event.title} starts now (${event.start}).`
        : `${event.title} starts in ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'} at ${event.start}.`;
      candidates.push({
        id: stableNotificationId(key),
        key,
        title: `Daymark · ${event.title}`,
        body,
        fireAt,
        extra: { daymark: true, key, eventId: event.originalId || event.id, date: event.date, start: event.start, minutesBefore }
      });
    }
  }
  // Stable order means a refresh schedules the same nearest reminders first.
  return candidates.sort((a, b) => a.fireAt - b.fireAt || a.id - b.id).slice(0, limit);
}
