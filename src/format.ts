import type { Language, Session } from './domain.ts';
import { monitorTime } from './time.ts';
import { translate } from './i18n.ts';

export function displayDate(wall: string, language: Language): string {
  return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(wall + 'Z'));
}

export function displayTime(at: number, session: Session): string { return monitorTime(at, session).slice(11); }

export function basis(session: Session): string {
  const minutes = session.clock.utcOffsetMinutes;
  const hours = Math.floor(Math.abs(minutes) / 60).toString().padStart(2, '0');
  const mins = (Math.abs(minutes) % 60).toString().padStart(2, '0');
  return `UTC${minutes >= 0 ? '+' : '-'}${hours}:${mins}`;
}

// Display only: the stored calibration and timestamp conversion keep their precision.
export function displayClockDifference(offsetMs: number, language: Language): string {
  if (offsetMs === 0) return translate(language, 'differenceZero');
  const magnitude = Math.abs(offsetMs);
  let duration: string;
  if (magnitude < 1000) duration = translate(language, 'differenceSubsecond');
  else {
    const seconds = Math.round(magnitude / 1000);
    const units = [
      [Math.floor(seconds / 3600), 'differenceHours'],
      [Math.floor(seconds % 3600 / 60), 'differenceMinutes'],
      [seconds % 60, 'differenceSeconds'],
    ] as const;
    duration = units.filter(([value]) => value > 0)
      .map(([value, key]) => translate(language, key, { count: value })).join(' ');
  }
  return translate(language, offsetMs > 0 ? 'differenceAhead' : 'differenceBehind', { duration });
}
