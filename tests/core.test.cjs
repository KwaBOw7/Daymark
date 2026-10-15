const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { emptySchedule, DEFAULT_PREFERENCES } = require('../.core-build/src/domain/types.js');
const { parseScheduleImport, applyImport, exportScheduleDocument } = require('../.core-build/src/domain/importer.js');
const { expandEvents, moveRecurringOccurrence } = require('../.core-build/src/domain/recurrence.js');
const { findConflicts } = require('../.core-build/src/domain/conflicts.js');
const { planFlexibleTasks, applyProposal } = require('../.core-build/src/domain/scheduler.js');
const { zonedDateTimeToDate, dateInZone, timeInZone } = require('../.core-build/src/domain/time.js');
const { getDueReminders } = require('../.core-build/src/domain/reminders.js');
const sample = require('../.core-build/src/domain/sampleSchedule.js').SAMPLE_SCHEDULE;

function event(overrides = {}) {
  return { id: 'fixed-1', title: 'Lecture', date: '2026-11-02', start: '09:00', end: '10:00', category: 'class', kind: 'fixed', reminderMinutes: [], locked: true, origin: 'manual', updatedAt: '2026-10-01T00:00:00.000Z', ...overrides };
}
function task(overrides = {}) {
  return { id: 'study-1', title: 'Study algorithms', category: 'study', priority: 'high', durationMinutes: 60, eligibleDays: [1, 2, 3, 4, 5, 6, 0], preferredWindows: [{ start: '14:00', end: '18:00' }], weeklyFrequency: 1, splittable: false, minimumSessionMinutes: 25, status: 'active', reminderMinutes: [10, 0], updatedAt: '2026-10-01T00:00:00.000Z', ...overrides };
}
function prefs(overrides = {}) {
  return { ...DEFAULT_PREFERENCES, timezone: 'Africa/Accra', dayStart: '06:00', dayEnd: '22:00', sleepStart: '23:00', sleepEnd: '05:30', restBufferMinutes: 0, travelBufferMinutes: 0, ...overrides };
}

// Import validation and stable-ID merge behavior.
test('public download sample matches the documented in-app example and never becomes seeded data', () => {
  const publicSample = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/sample-schedule.json'), 'utf8'));
  assert.deepEqual(publicSample, sample);
  assert.equal(emptySchedule().events.length, 0);
  assert.equal(emptySchedule().tasks.length, 0);
});

test('accepts the versioned sample and previews new events/tasks', () => {
  const preview = parseScheduleImport(JSON.stringify(sample), emptySchedule());
  assert.equal(preview.valid, true, JSON.stringify(preview.invalid));
  assert.equal(preview.events.additions.length, 1);
  assert.equal(preview.tasks.additions.length, 1);
});
test('rejects malformed JSON, wrong versions, invalid dates, and strict field types', () => {
  assert.equal(parseScheduleImport('{oops', emptySchedule()).valid, false);
  assert.match(parseScheduleImport(JSON.stringify({ ...sample, schemaVersion: 9 }), emptySchedule()).invalid[0].message, /Unsupported/);
  const badDate = structuredClone(sample); badDate.events[0].date = '2026-02-30';
  assert.equal(parseScheduleImport(JSON.stringify(badDate), emptySchedule()).valid, false);
  const badLock = structuredClone(sample); badLock.events[0].locked = 'yes';
  assert.equal(parseScheduleImport(JSON.stringify(badLock), emptySchedule()).invalid.some(x => x.path.endsWith('.locked')), true);
  const badSplit = structuredClone(sample); badSplit.tasks[0].splittable = 'sometimes';
  assert.equal(parseScheduleImport(JSON.stringify(badSplit), emptySchedule()).invalid.some(x => x.path.endsWith('.splittable')), true);
  const unknownField = structuredClone(sample); unknownField.events[0].internalCacheField = true;
  assert.equal(parseScheduleImport(JSON.stringify(unknownField), emptySchedule()).invalid.some(x => x.path.endsWith('.internalCacheField')), true);
  const badReminders = structuredClone(sample); badReminders.events[0].reminderMinutes = 'ten';
  assert.equal(parseScheduleImport(JSON.stringify(badReminders), emptySchedule()).invalid.some(x => x.path.endsWith('.reminderMinutes')), true);
  const badDailyWeekday = structuredClone(sample); badDailyWeekday.events[0].recurrence = { frequency: 'daily', weekdays: [9], startDate: badDailyWeekday.events[0].date, exceptions: [] };
  assert.equal(parseScheduleImport(JSON.stringify(badDailyWeekday), emptySchedule()).invalid.some(x => x.path.endsWith('.recurrence.weekdays')), true);
});
test('rejects explicit nulls in optional fields instead of silently dropping invalid input', () => {
  const variants = [
    ['event recurrence', (doc) => { doc.events[0].recurrence = null; }, '$.events[0].recurrence'],
    ['event location', (doc) => { doc.events[0].location = null; }, '$.events[0].location'],
    ['task deadline', (doc) => { doc.tasks[0].deadline = null; }, '$.tasks[0].deadline'],
    ['task notBefore', (doc) => { doc.tasks[0].notBefore = null; }, '$.tasks[0].notBefore'],
    ['task description', (doc) => { doc.tasks[0].description = null; }, '$.tasks[0].description']
  ];
  for (const [label, mutate, pathName] of variants) {
    const document = structuredClone(sample); mutate(document);
    const preview = parseScheduleImport(JSON.stringify(document), emptySchedule());
    assert.equal(preview.valid, false, `${label} should be invalid`);
    assert.ok(preview.invalid.some((item) => item.path === pathName), `${label} should identify ${pathName}`);
  }
});

test('rejects duplicate stable IDs within an import and does not partially apply invalid data', () => {
  const dupe = structuredClone(sample); dupe.events.push({ ...dupe.events[0], title: 'Duplicate ID' });
  const data = emptySchedule(); const preview = parseScheduleImport(JSON.stringify(dupe), data);
  assert.equal(preview.valid, false);
  assert.throws(() => applyImport(data, preview), /Fix all invalid/);
  assert.equal(data.events.length, 0);
});
test('re-importing unchanged IDs is idempotent and reports unchanged rows', () => {
  let data = emptySchedule();
  const first = parseScheduleImport(JSON.stringify(sample), data); data = applyImport(data, first);
  const second = parseScheduleImport(JSON.stringify(sample), data);
  assert.equal(second.valid, true);
  assert.equal(second.events.additions.length, 0); assert.equal(second.events.changes.length, 0); assert.equal(second.events.unchanged.length, 1);
  assert.equal(second.tasks.unchanged.length, 1);
});


test('exported schedule is valid v1 JSON and round-trips without mutating preferences', () => {
  let data = emptySchedule();
  const originalPreferences = data.preferences;
  const first = parseScheduleImport(JSON.stringify(sample), data);
  data = applyImport(data, first);
  const exported = exportScheduleDocument(data);
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(Object.keys(exported).sort(), ['events', 'schemaVersion', 'tasks', 'timezone']);
  assert.equal('updatedAt' in exported.events[0], false);
  assert.equal('origin' in exported.events[0], false);
  const second = parseScheduleImport(JSON.stringify(exported), data);
  assert.equal(second.valid, true, JSON.stringify(second.invalid));
  assert.equal(second.events.unchanged.length, 1);
  assert.equal(second.tasks.unchanged.length, 1);
  assert.equal(data.preferences.timezone, originalPreferences.timezone);
  assert.deepEqual(data.preferences, originalPreferences);
});

// Timezones and recurrence expansion operate on local wall time, not the device's timezone.
test('converts IANA wall times and round-trips through timezone-aware local parts', () => {
  const accra = zonedDateTimeToDate('2026-11-02', '09:00', 'Africa/Accra');
  assert.equal(accra.toISOString(), '2026-11-02T09:00:00.000Z');
  const newYork = zonedDateTimeToDate('2026-11-02', '09:00', 'America/New_York');
  assert.equal(newYork.toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(dateInZone(newYork, 'America/New_York'), '2026-11-02');
  assert.equal(timeInZone(newYork, 'America/New_York'), '09:00');
  assert.throws(() => zonedDateTimeToDate('2026-03-08', '02:30', 'America/New_York'), /does not exist/);
});
test('preview detects recurring conflicts beyond the first occurrence when a series has no end date', () => {
  const existing = event({ id: 'weekly-root', recurrence: { frequency: 'weekly', weekdays: [1], startDate: '2026-11-02', exceptions: [] } });
  const data = { ...emptySchedule(), events: [existing] };
  const later = { schemaVersion:1, timezone:'Africa/Accra', events:[{ id:'weekly-incoming', title:'Overlapping Monday', date:'2026-11-03', start:'09:30', end:'10:30', category:'meeting', recurrence:{frequency:'weekly',weekdays:[1],startDate:'2026-11-03',exceptions:[]} }], tasks:[] };
  const preview = parseScheduleImport(JSON.stringify(later), data);
  assert.equal(preview.valid, true, JSON.stringify(preview.invalid));
  assert.ok(preview.conflicts.some(c => c.date === '2026-11-09'));
});

test('expands weekly and daily recurrence with end dates and exceptions', () => {
  const weekly = event({ recurrence: { frequency: 'weekly', weekdays: [1], startDate: '2026-11-02', endDate: '2026-11-30', exceptions: ['2026-11-16'] } });
  const dates = expandEvents([weekly], '2026-11-01', '2026-12-01').map(e => e.date);
  assert.deepEqual(dates, ['2026-11-02', '2026-11-09', '2026-11-23', '2026-11-30']);
  const daily = event({ recurrence: { frequency: 'daily', startDate: '2026-11-02', endDate: '2026-11-04', exceptions: [] } });
  assert.deepEqual(expandEvents([daily], '2026-11-02', '2026-11-10').map(e => e.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
});


test('moving a recurring occurrence creates an exception and a locked one-off override', () => {
  const root = event({ id: 'weekly-class', recurrence: { frequency: 'weekly', weekdays: [1], startDate: '2026-11-02', endDate: '2026-11-30', exceptions: [] } });
  const occurrence = expandEvents([root], '2026-11-09', '2026-11-09')[0];
  const moved = moveRecurringOccurrence([root], occurrence, '2026-11-10', '16:00', '17:00', '2026-10-31T00:00:00.000Z');
  assert.ok(moved);
  assert.deepEqual(moved.updatedRoot.recurrence.exceptions, ['2026-11-09']);
  assert.equal(moved.override.locked, true);
  const instances = expandEvents(moved.events, '2026-11-02', '2026-11-16');
  assert.equal(instances.some(e => e.date === '2026-11-09'), false);
  assert.equal(instances.some(e => e.id === moved.override.id && e.date === '2026-11-10' && e.start === '16:00'), true);
  assert.equal(instances.some(e => e.date === '2026-11-16' && e.originalId === 'weekly-class'), true);
});

// Conflicts and deterministic scheduling.
test('detects overlaps and respects optional travel/rest buffers', () => {
  const a = event({ start: '09:00', end: '10:00' });
  const b = event({ id: 'fixed-2', title: 'Tutorial', start: '10:05', end: '11:00' });
  assert.equal(findConflicts([a, b], 'Africa/Accra', 0, a.date, a.date).length, 0);
  assert.equal(findConflicts([a, b], 'Africa/Accra', 10, a.date, a.date).length, 1);
  assert.equal(findConflicts([a, { ...b, start: '09:30' }], 'Africa/Accra', 0, a.date, a.date).length, 1);
});
test('allocator respects fixed commitments, preferred windows, and task deadline', () => {
  const fixed = event();
  const result = planFlexibleTasks([fixed], [task({ deadline: '2026-11-02', eligibleDays: [1] })], prefs(), { from: '2026-11-02', through: '2026-11-02', now: new Date('2026-10-31T12:00:00Z') });
  assert.equal(result.created.length, 1, JSON.stringify(result.unscheduled));
  const placed = result.created[0];
  assert.equal(placed.date, '2026-11-02');
  assert.ok(placed.start >= '14:00' && placed.end <= '18:00');
  assert.ok(placed.end <= '22:00');
  assert.equal(fixed.start, '09:00');
  assert.equal(findConflicts([fixed, ...result.created], 'Africa/Accra', 0, '2026-11-02', '2026-11-02').length, 0);
});
test('ISO deadlines are interpreted in the selected schedule timezone', () => {
  const dueNextLocalDay = task({ deadline:'2026-11-02T23:30:00-05:00', notBefore:'2026-11-03', eligibleDays:[2], preferredWindows:[] });
  const result = planFlexibleTasks([], [dueNextLocalDay], prefs(), { from:'2026-11-03', through:'2026-11-03', now:new Date('2026-10-31T12:00:00Z') });
  assert.equal(result.created.length, 1, JSON.stringify(result.unscheduled));
  assert.equal(result.created[0].date, '2026-11-03');
});

test('allocator never silently overbooks and explains an infeasible deadline/window', () => {
  const allDay = event({ start: '06:00', end: '22:00' });
  const result = planFlexibleTasks([allDay], [task({ deadline: '2026-11-02', eligibleDays: [1], preferredWindows: [] })], prefs(), { from: '2026-11-02', through: '2026-11-02', now: new Date('2026-10-31T12:00:00Z') });
  assert.equal(result.created.length, 0);
  assert.equal(result.unscheduled.length, 1);
  assert.match(result.unscheduled[0].reason, /No conflict-free slot|remain unplaced|working window/i);
  assert.equal(findConflicts([allDay, ...result.created], 'Africa/Accra', 0, '2026-11-02', '2026-11-02').length, 0);
});

test('splittable study sessions are broken into feasible chunks across eligible days', () => {
  const fixed = [
    event({ id: 'monday-early', date: '2026-11-02', start: '06:00', end: '08:30' }),
    event({ id: 'monday-mid', date: '2026-11-02', start: '09:00', end: '13:30' }),
    event({ id: 'monday-late', date: '2026-11-02', start: '14:00', end: '22:00' }),
    event({ id: 'tuesday-early', date: '2026-11-03', start: '06:00', end: '08:30' }),
    event({ id: 'tuesday-mid', date: '2026-11-03', start: '09:00', end: '13:30' }),
    event({ id: 'tuesday-late', date: '2026-11-03', start: '14:00', end: '22:00' })
  ];
  const result = planFlexibleTasks(fixed, [task({ durationMinutes: 60, deadline: '2026-11-03', eligibleDays: [1, 2], preferredWindows: [], splittable: true, minimumSessionMinutes: 25 })], prefs(), { from: '2026-11-02', through: '2026-11-03', now: new Date('2026-10-31T12:00:00Z') });
  assert.equal(result.created.reduce((sum, e) => sum + (Number(e.end.slice(0, 2)) * 60 + Number(e.end.slice(3)) - Number(e.start.slice(0, 2)) * 60 - Number(e.start.slice(3))), 0), 60);
  assert.equal(result.created.length, 2);
  assert.equal(new Set(result.created.map(e => e.date)).size, 2);
  assert.equal(result.unscheduled.length, 0);
  assert.equal(findConflicts([...fixed, ...result.created], 'Africa/Accra', 0, '2026-11-02', '2026-11-03').length, 0);
});

test('replacement proposal only targets unlocked generated blocks and requires explicit confirmation', () => {
  const lockedGenerated = event({ id: 'keep-locked', origin: 'scheduler', locked: true });
  const replaceable = event({ id: 'replace-me', origin: 'scheduler', locked: false });
  const result = planFlexibleTasks([lockedGenerated, replaceable], [task()], prefs(), { from: '2026-11-02', through: '2026-11-02', replacePlanned: true, now: new Date('2026-10-31T12:00:00Z') });
  assert.deepEqual(result.replaceIds, ['replace-me']);
  assert.throws(() => applyProposal([lockedGenerated, replaceable], result, false), /Confirmation/);
  const committed = applyProposal([lockedGenerated, replaceable], result, true);
  assert.ok(committed.some(e => e.id === 'keep-locked'));
  assert.ok(!committed.some(e => e.id === 'replace-me'));
});
test('missed session recovery planning preserves fixed events and returns a new suggestion', () => {
  const fixed = event({ date: '2026-11-03' });
  const missed = event({ id: 'missed-study', title: 'Study recovery', date: '2026-11-02', category: 'study', kind: 'study', locked: false, origin: 'scheduler', taskId: 'study-1', start: '15:00', end: '16:00' });
  const result = planFlexibleTasks([fixed, missed], [task({ id: 'study-1', preferredWindows: [{ start: '12:00', end: '17:00' }] })], prefs(), { from: '2026-11-03', through: '2026-11-03', now: new Date('2026-11-02T12:00:00Z') });
  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].date, '2026-11-03');
  assert.equal(result.created[0].id.includes('missed-study'), false);
  assert.equal(fixed.start, '09:00');
});

test('due reminder engine respects category settings, timing windows, and durable deduplication keys', () => {
  const fixed = event({ date: '2026-11-02', start: '10:00', end: '11:00', category: 'class', reminderMinutes: [10, 0] });
  const p = prefs({ categoryNotifications: { ...DEFAULT_PREFERENCES.categoryNotifications, class: true } });
  const atTenBefore = new Date('2026-11-02T09:50:00Z');
  const due = getDueReminders([fixed], p, atTenBefore, new Set());
  assert.equal(due.length, 1); assert.equal(due[0].minutesBefore, 10);
  assert.equal(getDueReminders([fixed], p, atTenBefore, new Set([due[0].key])).length, 0);
  const disabled = { ...p, categoryNotifications: { ...p.categoryNotifications, class: false } };
  assert.equal(getDueReminders([fixed], disabled, atTenBefore, new Set()).length, 0);
});

test('reminder sweep safely skips a recurring wall-clock time that does not exist during DST spring-forward', () => {
  const recurring = event({
    date: '2026-03-08', start: '02:30', end: '03:00', category: 'study', reminderMinutes: [0],
    recurrence: { frequency: 'daily', startDate: '2026-03-08', exceptions: [] }
  });
  const preferences = prefs({ timezone: 'America/New_York' });
  assert.doesNotThrow(() => getDueReminders([recurring], preferences, new Date('2026-03-08T07:30:00Z')));
});

test('database migration requires owner-scoped RLS and authenticated compare-and-swap RPCs', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202610140001_initial_schema.sql'), 'utf8');
  assert.match(migration, /alter table public\.schedule_events enable row level security/i);
  for (const table of ['flexible_tasks','schedule_preferences','session_logs','push_subscriptions','reminder_queue']) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(migration, /primary key \(user_id, id\)/i);
  assert.match(migration, /auth\.uid\(\)\s*=\s*user_id/i);
  assert.match(migration, /drop policy if exists \"owner manages push_subscriptions\" on public\.push_subscriptions;\s*create policy \"owner manages push_subscriptions\"/i);
  assert.match(migration, /create or replace function public\.sync_schedule_batch/i);
  assert.match(migration, /raise exception 'concurrent_edit'/i);
  assert.match(migration, /grant execute on function public\.sync_schedule_batch\(jsonb\) to authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.reminder_queue from authenticated, anon/i);
  assert.match(migration, /drop policy if exists "owner reads their reminder_queue" on public\.reminder_queue;\s*create policy "owner reads their reminder_queue"/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /add column if not exists claimed_until/i);
  assert.match(migration, /grant execute on function public\.claim_due_reminders\(integer\) to service_role/i);
});
test('server reminder dispatcher authenticates its cron caller and limits retries', () => {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/dispatch-reminders/index.ts'), 'utf8');
  assert.match(source, /x-daymark-cron-secret/);
  assert.match(source, /rpc\('claim_due_reminders'/);
  assert.match(source, /webpush\.sendNotification/);
});

test('cloud sync surfaces structured Supabase errors instead of misreporting them as generic offline', () => {
  const repository = fs.readFileSync(path.join(__dirname, '../src/services/repository.ts'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8');
  assert.match(repository, /export function describeCloudError\(error:unknown\)/);
  assert.match(repository, /stringField\('code'\)/);
  assert.match(repository, /stringField\('details'\)/);
  assert.match(repository, /Supabase schedule read failed/);
  assert.match(repository, /Supabase rejected the schedule update/);
  assert.match(app, /snap\.sync==='error'\?'Sync issue'/);
  assert.match(app, /Retry sync/);
  assert.match(app, /toLowerCase\(\)\.includes\('conflict'\)/);
});
