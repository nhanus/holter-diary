import { openDiaryStore } from '../../src/storage.ts';
import { newEntry } from '../../src/domain.ts';
import { newSession, calibrate, monitorTime } from '../../src/time.ts';
import { persistenceStatus } from '../../src/persistence.ts';

const diary = { openDiaryStore, newEntry, newSession, calibrate, monitorTime, persistenceStatus };
declare global { interface Window { diary: typeof diary } }
window.diary = diary;
