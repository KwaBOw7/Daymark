const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const isDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME_RE.test(value);
export const timeToMinutes = (time: string): number => { if (!isTime(time)) throw new Error(`Invalid time "${time}". Use HH:mm.`); const [h,m] = time.split(':').map(Number); return h*60+m; };
export const minutesToTime = (minutes: number): string => `${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(((minutes%60)+60)%60).padStart(2,'0')}`;
export const dateAddDays = (date: string, amount: number): string => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+amount); return d.toISOString().slice(0,10); };
export const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
export const dateTimeKey = (date: string, time: string) => `${date}T${time}`;
export interface ZonedParts { year:number; month:number; day:number; hour:number; minute:number; second:number }
export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date);
  const out = Object.fromEntries(parts.map(p => [p.type, Number(p.value)]));
  return { year:out.year, month:out.month, day:out.day, hour:out.hour, minute:out.minute, second:out.second };
}
export const dateInZone = (date: Date, timezone: string) => { const p = zonedParts(date, timezone); return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`; };
export const timeInZone = (date: Date, timezone: string) => { const p = zonedParts(date, timezone); return `${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`; };
/** Convert wall-clock time in IANA zone to UTC, handling offset changes without hardcoded Ghana/UTC assumptions. */
export function zonedDateTimeToDate(date: string, time: string, timezone: string): Date {
  if (!isDate(date) || !isTime(time)) throw new Error('Expected a valid date and HH:mm time.');
  const [y,mo,d] = date.split('-').map(Number), [h,mi] = time.split(':').map(Number);
  const target = Date.UTC(y,mo-1,d,h,mi,0);
  let guess = target;
  for (let i=0;i<4;i++) {
    const p = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    const delta = target - represented;
    guess += delta;
    if (delta === 0) break;
  }
  const result = new Date(guess);
  if (Number.isNaN(result.getTime())) throw new Error(`Could not resolve timezone ${timezone}.`);
  const actual=zonedParts(result,timezone);
  if(actual.year!==y||actual.month!==mo||actual.day!==d||actual.hour!==h||actual.minute!==mi)throw new Error(`The local time ${date} ${time} does not exist in ${timezone} because of a clock change.`);
  return result;
}
export const localDateTimeMs = (date:string,time:string,tz:string) => zonedDateTimeToDate(date,time,tz).getTime();
export const formatClock = (date: Date, timezone: string, options: Intl.DateTimeFormatOptions = {}) => new Intl.DateTimeFormat(undefined,{ timeZone:timezone, hour:'numeric', minute:'2-digit', ...options }).format(date);
export const formatDateLabel = (date:string, timezone:string, options:Intl.DateTimeFormatOptions = { weekday:'long', month:'long', day:'numeric' }) => new Intl.DateTimeFormat(undefined,{ timeZone:timezone, ...options }).format(new Date(`${date}T12:00:00Z`));
export const nowAtZone = (timezone: string, now = new Date()) => ({ date: dateInZone(now,timezone), time: timeInZone(now,timezone) });
export function isValidTimezone(timezone: string) { try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}); return true; } catch { return false; } }
