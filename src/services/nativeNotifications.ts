import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Preferences, ScheduleEvent } from '../domain/types';
import { buildNativeReminderPlan, NATIVE_NOTIFICATION_LIMIT, type NativeReminderPlan } from '../domain/nativeReminders';

export type NativePermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type NativeReminderSyncResult =
  | { status: 'web' }
  | { status: 'permission-needed'; message: string }
  | { status: 'synced'; scheduled: number; limit: number }
  | { status: 'synced-inexact'; scheduled: number; limit: number; message: string }
  | { status: 'failed'; message: string };

export const isNativeDaymark = (): boolean => Capacitor.isNativePlatform();

export async function requestNativeReminderPermission(): Promise<NativePermissionState> {
  if (!isNativeDaymark()) return 'unsupported';
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display === 'granted') return 'granted';
  const requested = await LocalNotifications.requestPermissions();
  if (requested.display === 'granted') return 'granted';
  if (requested.display === 'denied') return 'denied';
  return 'prompt';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  await LocalNotifications.createChannel({
    id: 'daymark-reminders',
    name: 'Daymark reminders',
    description: 'Class, appointment, and personal-study reminders.',
    importance: 4,
    vibration: true,
    lights: true,
    lightColor: '#2e5948'
  });
}

export async function sendNativeTestReminder(): Promise<void> {
  if (!isNativeDaymark()) throw new Error('Local device notifications are only available in the installed native app.');
  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') throw new Error('Allow notifications for Daymark in device settings first.');
  await ensureAndroidChannel();
  const id = Math.floor(Date.now() % 2_000_000_000) + 1;
  await LocalNotifications.schedule({
    notifications: [{
      id,
      title: 'Daymark test reminder',
      body: 'Your phone can deliver scheduled Daymark reminders without mobile data or Wi-Fi.',
      schedule: { at: new Date(Date.now() + 7_000), allowWhileIdle: true },
      extra: { daymark: true, test: true, key: `test:${id}` },
      channelId: 'daymark-reminders',
      smallIcon: 'ic_stat_daymark',
      isExactNotification: true,
      isExactMandatory: false
    }]
  });
}

function toNativeNotification(plan: NativeReminderPlan) {
  return {
    id: plan.id,
    title: plan.title,
    body: plan.body,
    schedule: { at: new Date(plan.fireAt), allowWhileIdle: true },
    extra: plan.extra,
    channelId: 'daymark-reminders',
    smallIcon: 'ic_stat_daymark',
    isExactNotification: true,
    isExactMandatory: false
  };
}

/**
 * Schedule upcoming reminders with Android/iOS itself. Delivery after this call is
 * local, so it does not require a running JS app or a network connection. Plans
 * are reconciled when the app opens, returns to foreground, or data/preferences change.
 */
export async function syncNativeReminders(events: ScheduleEvent[], preferences: Preferences): Promise<NativeReminderSyncResult> {
  if (!isNativeDaymark()) return { status: 'web' };
  try {
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') return { status: 'permission-needed', message: 'Allow notification permission to schedule offline reminders.' };

    await ensureAndroidChannel();
    const plans = buildNativeReminderPlan(events, preferences);
    const plannedIds = new Set(plans.map(plan => plan.id));
    const pending = await LocalNotifications.getPending();
    const owned = pending.notifications.filter(item => {
      const extra = item.extra as { daymark?: unknown } | undefined;
      return extra?.daymark === true;
    });

    // Cancel obsolete IDs first so a busy schedule never exceeds iOS's pending-notification budget.
    // IDs shared with the new plan remain pending and are updated by schedule().
    const stale = owned.filter(item => !plannedIds.has(item.id)).map(item => ({ id: item.id }));
    if (stale.length) await LocalNotifications.cancel({ notifications: stale });
    if (plans.length) {
      const scheduled = await LocalNotifications.schedule({ notifications: plans.map(toNativeNotification) });
      if (scheduled.warning) {
        return {
          status: 'synced-inexact',
          scheduled: plans.length,
          limit: NATIVE_NOTIFICATION_LIMIT,
          message: 'Android scheduled the reminders, but exact-alarm access is off. They may arrive late; allow Daymark under Settings → Apps → Daymark → Alarms & reminders for more precise timing.'
        };
      }
    }
    return { status: 'synced', scheduled: plans.length, limit: NATIVE_NOTIFICATION_LIMIT };
  } catch (error) {
    return { status: 'failed', message: error instanceof Error ? error.message : 'Could not schedule device reminders.' };
  }
}
