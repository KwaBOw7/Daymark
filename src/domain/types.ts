export type Category = 'class' | 'study' | 'teaching' | 'meeting' | 'ujexa' | 'social' | 'personal' | 'rest' | 'errand' | 'other';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type EventKind = 'fixed' | 'study' | 'task' | 'personal' | 'rest';
export type RecurrenceFrequency = 'daily' | 'weekly';
export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  weekdays?: number[]; // JS weekday: Sunday = 0
  startDate: string;
  endDate?: string;
  exceptions: string[]; // YYYY-MM-DD dates to skip
}
export interface ScheduleEvent {
  id: string;
  title: string;
  date: string; // local calendar date in `timezone`
  start: string; // local HH:mm, minute precision
  end: string;
  category: Category;
  kind: EventKind;
  recurrence?: RecurrenceRule;
  location?: string;
  notes?: string;
  reminderMinutes: number[]; // 0 means at start
  locked: boolean;
  taskId?: string;
  origin: 'manual' | 'import' | 'scheduler';
  updatedAt: string;
  originalId?: string; // only present on expanded recurrence instances
}
export interface PreferredWindow { start: string; end: string; weekdays?: number[] }
export interface FlexibleTask {
  id: string;
  title: string;
  description?: string;
  category: Category;
  priority: Priority;
  durationMinutes: number; // duration per session
  deadline?: string; // YYYY-MM-DD or ISO timestamp
  notBefore?: string; // YYYY-MM-DD
  eligibleDays: number[];
  preferredWindows: PreferredWindow[];
  weeklyFrequency: number;
  splittable: boolean;
  minimumSessionMinutes: number;
  status: 'active' | 'completed' | 'archived';
  reminderMinutes: number[];
  updatedAt: string;
}
export interface Preferences {
  timezone: string;
  dayStart: string;
  dayEnd: string;
  sleepStart: string;
  sleepEnd: string;
  restBufferMinutes: number;
  travelBufferMinutes: number;
  defaultReminders: number[];
  remindersEnabled: boolean;
  pushEnabled: boolean;
  categoryNotifications: Record<Category, boolean>;
  weekStartsOn: 0 | 1;
  updatedAt: string;
}
export type SessionStatus = 'completed' | 'skipped' | 'missed';
export interface SessionLog {
  id: string;
  eventId: string;
  taskId?: string;
  title: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: SessionStatus;
  loggedAt: string;
  note?: string;
}
export interface ScheduleData {
  events: ScheduleEvent[];
  tasks: FlexibleTask[];
  preferences: Preferences;
  sessionLogs: SessionLog[];
}
export const CATEGORIES: Category[] = ['class','study','teaching','meeting','ujexa','social','personal','rest','errand','other'];
export const DEFAULT_PREFERENCES: Preferences = {
  timezone: 'Africa/Accra', dayStart: '05:30', dayEnd: '23:00', sleepStart: '23:00', sleepEnd: '05:30',
  restBufferMinutes: 10, travelBufferMinutes: 15, defaultReminders: [10, 0], remindersEnabled: true, pushEnabled: false,
  categoryNotifications: { class: true, study: true, teaching: true, meeting: true, ujexa: true, social: true, personal: true, rest: false, errand: true, other: true },
  weekStartsOn: 1, updatedAt: new Date().toISOString()
};
export const emptySchedule = (): ScheduleData => ({ events: [], tasks: [], preferences: { ...DEFAULT_PREFERENCES, categoryNotifications: { ...DEFAULT_PREFERENCES.categoryNotifications }, updatedAt: new Date().toISOString() }, sessionLogs: [] });
