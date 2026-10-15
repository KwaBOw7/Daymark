/** Downloadable sample spec; these entries are never seeded into a user's schedule. */
export const SAMPLE_SCHEDULE = {
  schemaVersion: 1,
  timezone: 'Africa/Accra',
  events: [
    {
      id: 'class-data-structures-mon-2026-11-02',
      title: 'Data Structures lecture',
      date: '2026-11-02',
      start: '09:00',
      end: '10:30',
      category: 'class',
      kind: 'fixed',
      recurrence: { frequency: 'weekly', weekdays: [1], startDate: '2026-11-02', endDate: '2026-12-14', exceptions: [] },
      location: 'Lecture theatre',
      notes: 'Bring lecture notes',
      reminderMinutes: [15, 0],
      locked: true
    }
  ],
  tasks: [
    {
      id: 'study-algorithms-weekly',
      title: 'Review algorithms',
      description: 'Revise notes and complete practice problems.',
      category: 'study',
      priority: 'high',
      durationMinutes: 60,
      deadline: '2026-12-14',
      notBefore: '2026-11-02',
      eligibleDays: [1, 3, 5],
      preferredWindows: [{ start: '14:00', end: '18:00', weekdays: [1, 3, 5] }],
      weeklyFrequency: 2,
      splittable: true,
      minimumSessionMinutes: 25,
      reminderMinutes: [10, 0]
    }
  ]
};
