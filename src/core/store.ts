/** localStorage 持久化 + 订阅通知（无第三方依赖） */
import type { InspectionRecord, Press, ScannerProfile } from './types.ts';

const KEYS = {
  presses: 'scc.presses',
  profile: 'scc.profile',
  history: 'scc.history',
  activePress: 'scc.activePress',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
  listeners.get(key)?.forEach((fn) => fn());
}

const listeners = new Map<string, Set<() => void>>();

export function subscribe(key: keyof typeof KEYS, fn: () => void): () => void {
  const k = KEYS[key];
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k)!.add(fn);
  return () => listeners.get(k)?.delete(fn);
}

export const store = {
  getPresses(): Press[] {
    return read<Press[]>(KEYS.presses, []);
  },
  savePresses(presses: Press[]): void {
    write(KEYS.presses, presses);
  },
  getActivePressId(): string | null {
    return read<string | null>(KEYS.activePress, null);
  },
  setActivePressId(id: string | null): void {
    write(KEYS.activePress, id);
  },
  getProfile(): ScannerProfile | null {
    return read<ScannerProfile | null>(KEYS.profile, null);
  },
  saveProfile(profile: ScannerProfile): void {
    write(KEYS.profile, profile);
  },
  getHistory(): InspectionRecord[] {
    return read<InspectionRecord[]>(KEYS.history, []);
  },
  addHistory(record: InspectionRecord): void {
    const all = read<InspectionRecord[]>(KEYS.history, []);
    all.unshift(record);
    write(KEYS.history, all.slice(0, 500));
  },
  clearHistory(): void {
    write(KEYS.history, []);
  },
};
