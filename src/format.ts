import type { Language, Session } from './domain.ts';
import { monitorTime } from './time.ts';

export function displayDate(wall: string, language: Language): string {
  return new Intl.DateTimeFormat(language, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(wall + 'Z'));
}

export function displayTime(at: number, session: Session): string { return monitorTime(at, session).slice(11); }

export function basis(session: Session): string {
  const minutes = session.clock.utcOffsetMinutes;
  const hours = Math.floor(Math.abs(minutes) / 60).toString().padStart(2, '0');
  const mins = (Math.abs(minutes) % 60).toString().padStart(2, '0');
  const offset = session.calibration.offsetMs / 1000;
  return `UTC${minutes >= 0 ? '+' : '-'}${hours}:${mins}; ${offset >= 0 ? '+' : ''}${offset} s`;
}
