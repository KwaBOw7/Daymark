export interface SystemNotificationInput {
  title: string;
  body: string;
  tag: string;
  url?: string;
}

export type SystemNotificationResult =
  | { status: 'shown' }
  | { status: 'unsupported' }
  | { status: 'permission-needed' }
  | { status: 'blocked' }
  | { status: 'failed'; error: string };

/**
 * Shows an OS-level notification using the service worker when available.
 * This works for foreground notifications too and is the preferred path for PWAs.
 * It does not claim to schedule a future notification or wake a closed app; that
 * requires a push subscription plus the server-side dispatcher.
 */
export async function showSystemNotification(input: SystemNotificationInput): Promise<SystemNotificationResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) return { status: 'unsupported' };
  if (Notification.permission === 'denied') return { status: 'blocked' };
  if (Notification.permission !== 'granted') return { status: 'permission-needed' };

  const options: NotificationOptions & { renotify?: boolean; data?: { url: string }; badge?: string } = {
    body: input.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: input.tag,
    renotify: false,
    data: { url: input.url || '/' }
  };

  try {
    if ('serviceWorker' in navigator) {
      // Use an existing registration rather than waiting forever for a broken/uninstalled worker.
      const registration = await navigator.serviceWorker.getRegistration('/');
      if (registration) {
        await registration.showNotification(input.title, options);
        return { status: 'shown' };
      }
    }
    // Fallback for browsers that support Notification but don't expose a worker registration.
    // Some mobile browsers disallow this constructor; callers receive a structured failure.
    new Notification(input.title, options);
    return { status: 'shown' };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Notification display failed.' };
  }
}

/** Request permission only from a user gesture. */
export async function requestSystemNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}
