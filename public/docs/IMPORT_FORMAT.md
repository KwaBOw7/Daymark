# Daymark schedule import format (version 1)

A file is a UTF-8 JSON object with exactly `schemaVersion: 1`, a valid IANA `timezone` (normally `Africa/Accra`), and `events` and `tasks` arrays. Version 1 rejects unknown fields so typos are shown as validation errors rather than silently ignored. IDs are stable user-chosen strings: reuse an existing ID to update an item on the next import. An ID absent from an import is **not** deleted. Re-importing unchanged data produces no duplicate and is listed as unchanged. The app validates the entire import before any change is applied. Any invalid record blocks Apply; fix it and preview again. Conflicts are listed for human review and never silently resolved.

## Fixed events

```json
{
  "id": "lecture-data-structures-2026-monday",
  "title": "Data Structures lecture",
  "date": "2026-11-02",
  "start": "09:00",
  "end": "10:30",
  "category": "class",
  "kind": "fixed",
  "recurrence": {
    "frequency": "weekly",
    "weekdays": [1],
    "startDate": "2026-11-02",
    "endDate": "2026-12-14",
    "exceptions": ["2026-11-16"]
  },
  "location": "Lecture theatre",
  "notes": "Bring lecture notes",
  "reminderMinutes": [15, 0],
  "locked": true
}
```

- `date`, `start`, `end` are required. Dates use `YYYY-MM-DD`; times use 24-hour `HH:mm` with minute precision. Overnight items must be split at midnight.
- `category`: `class`, `study`, `teaching`, `meeting`, `ujexa`, `social`, `personal`, `rest`, `errand`, `other`.
- `kind`: `fixed`, `study`, `task`, `personal`, `rest` (defaults to `fixed`).
- `recurrence.frequency` is `daily` or `weekly`; for weekly, `weekdays` is required and uses JavaScript weekday values: Sunday `0`, Monday `1`, … Saturday `6`. `startDate` is required; `endDate` is optional; `exceptions` is an array of omitted dates.
- `reminderMinutes` are minutes before start; `0` means exactly at the start. Default is `[10, 0]`.
- `locked` must be a boolean when provided and defaults to `true`. Imported fixed commitments are never moved by the scheduling engine. `kind` must be one of `fixed`, `study`, `task`, `personal`, `rest` when supplied.

## Flexible tasks

```json
{
  "id": "personal-study-algorithms",
  "title": "Study algorithms",
  "description": "Revise notes and practice problems.",
  "category": "study",
  "priority": "high",
  "durationMinutes": 60,
  "deadline": "2026-12-14",
  "notBefore": "2026-11-02",
  "eligibleDays": [1, 3, 5],
  "preferredWindows": [{ "start": "14:00", "end": "18:00", "weekdays": [1, 3, 5] }],
  "weeklyFrequency": 2,
  "splittable": true,
  "minimumSessionMinutes": 25,
  "reminderMinutes": [10, 0]
}
```

- `id`, `title`, `category`, `durationMinutes` are required. Duration is the length of each requested session (1–1440 minutes).
- `priority`: `low`, `normal`, `high`, `urgent` (default `normal`). Deadline accepts `YYYY-MM-DD` or an ISO-8601 datetime with an explicit timezone offset; the current deterministic allocator uses its local-calendar date in the selected schedule timezone.
- `notBefore` is optional `YYYY-MM-DD`.
- `eligibleDays` accepts weekdays 0–6; default is every day. `preferredWindows` is optional; each window has `start`, `end` and optional `weekdays`.
- `weeklyFrequency` defaults to 1 and is 1–14 sessions per week. `splittable` and `minimumSessionMinutes` control whether a session may be split across multiple eligible days. The engine first searches for one uninterrupted block; only if none fits does it try chunks of at least `minimumSessionMinutes`, up to 90 minutes each. Every chunk still respects existing commitments, daily limits and buffers; incomplete sessions are reported rather than treated as complete. `preferredWindows` affect ranking but remain a soft preference when no slot within a preferred window is available.
- Task `status` can be `active`, `completed`, or `archived`.

Unknown properties, duplicate IDs, wrong field types, invalid dates, and malformed windows are validation errors. Correct every reported issue before applying. Settings such as working hours and sleep preferences are configured in the app rather than imported in v1.

## How to use it

1. Ask for a JSON object conforming to this file's v1 specification; use stable IDs and include explicit dates, timezone, time precision and reminders.
2. Save it as `.json` and open **Import plan** in Daymark (or paste the JSON into the editor).
3. Read additions, updates, invalid entries and overlap conflicts. Nothing changes until **Apply import** is selected.
4. If records are invalid, no part of the import is applied. Correct the source and preview again.
