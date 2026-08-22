/**
 * Le client de l'API console.
 *
 * Un seul endroit qui parle au serveur : les composants ne connaissent que
 * des fonctions typées, et le jeton d'accès ne se promène pas dans l'arbre
 * React.
 */

export interface ScreenStatus {
  id: string;
  code: string;
  label: string;
  building: string;
  floor: number;
  area: string;
  orientation: string;
  manifestVersion: number;
  deviceId: string | null;
  platform: string | null;
  lastHeartbeatAtMs: number | null;
  agentState: string | null;
  online: boolean;
}

export interface PendingDevice {
  deviceId: string;
  pairingCode: string;
  pairingExpiresAtMs: number;
  platform: string | null;
}

export interface Media {
  id: string;
  sha256: string;
  bytes: number;
  mime: string;
  filename?: string;
}

export interface PublishItem {
  assetId?: string;
  text?: { eyebrow?: string; titre: string; texte?: string };
  durationMs?: number;
}

export interface Emergency {
  id: string;
  title: string;
  body?: string;
  issuedAt: string;
  validUntil: string;
}

export interface PublishSpec {
  layout: "plein-ecran" | "principal-et-cours";
  items: PublishItem[];
  ticker?: string;
  /** Vide = toutes les classes défilent. Une seule = écran fixe. */
  timetableClassIds?: string[];
}

// --- Emploi du temps -------------------------------------------------

export interface SchoolClass {
  id: string;
  code: string;
  label: string;
  level: string | null;
}

export interface Period {
  id: string;
  label: string;
  startsAt: string;
  endsAt: string;
  position: number;
}

export interface Holiday {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
}

export interface SchoolYear {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  parityAnchor: string | null;
}

export interface Lesson {
  id: string;
  classId: string;
  subjectLabel: string;
  teacherName: string | null;
  roomCode: string;
  dayOfWeek: number;
  periodId: string;
  weekParity: "all" | "A" | "B";
  startsOn: string | null;
  endsOn: string | null;
}

export type ExceptionKind = "cancelled" | "room" | "teacher" | "added";

export interface TimetableException {
  id: string;
  date: string;
  kind: ExceptionKind;
  lessonId: string | null;
  classId: string;
  periodId: string | null;
  subjectLabel: string | null;
  teacherName: string | null;
  roomCode: string | null;
  note: string | null;
}

export interface TimetableSetup {
  classes: SchoolClass[];
  periods: Period[];
  holidays: Holiday[];
  year: SchoolYear | null;
  today: string;
}

/** Le message du serveur est déjà rédigé pour un humain : on le garde tel quel. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

const TOKEN_KEY = "couloir.token";

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function forgetToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      body?.message ?? `Le serveur a répondu ${response.status}.`,
      response.status,
      body?.code,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const call = <T>(path: string, init?: RequestInit) => request<T>(`/v1/console${path}`, init);
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

export const api = {
  screens: () => call<{ screens: ScreenStatus[]; pending: PendingDevice[] }>("/screens"),
  screen: (id: string) => call<{ screen: ScreenStatus; manifest: unknown }>(`/screens/${id}`),

  media: () => call<{ media: Media[] }>("/media"),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ media: Media }>("/media", { method: "POST", body: form });
  },

  pair: (input: {
    pairingCode: string;
    code: string;
    label: string;
    building: string;
    floor: number;
    area: string;
  }) => call<{ screenId: string; screenCode: string }>("/pair", json("POST", input)),

  publish: (screenId: string, spec: PublishSpec) =>
    call<{ screenId: string; version: number }>(`/screens/${screenId}/publish`, json("POST", spec)),

  /** Compose sans enregistrer : le même chemin que la publication. */
  previewSpec: (screenId: string, spec: PublishSpec) =>
    call<{ manifest: unknown }>(`/screens/${screenId}/preview`, json("POST", spec)),

  emergency: {
    current: () => call<{ emergency: Emergency | null }>("/emergency"),
    raise: (input: { title: string; body?: string; screenIds?: string[]; validHours?: number }) =>
      call<{ emergency: Emergency; applied: string[]; skipped: string[] }>(
        "/emergency",
        json("POST", input),
      ),
    clear: () => call<{ applied: string[]; skipped: string[] }>("/emergency", { method: "DELETE" }),
  },

  timetable: {
    setup: () => call<TimetableSetup>("/timetable/setup"),

    lessons: (classId?: string) =>
      call<{ lessons: Lesson[] }>(`/timetable/lessons${classId ? `?classId=${classId}` : ""}`),

    saveLesson: (lesson: Partial<Lesson> & Pick<Lesson, "classId" | "subjectLabel" | "dayOfWeek" | "periodId">) =>
      call<{ lesson: Lesson }>("/timetable/lessons", json("POST", lesson)),

    deleteLesson: (lessonId: string) =>
      call<void>(`/timetable/lessons/${lessonId}`, { method: "DELETE" }),

    exceptions: (date: string) =>
      call<{ date: string; exceptions: TimetableException[] }>(`/timetable/exceptions?date=${date}`),

    saveException: (exception: Partial<TimetableException> & Pick<TimetableException, "date" | "kind" | "classId">) =>
      call<{ exception: TimetableException }>("/timetable/exceptions", json("POST", exception)),

    deleteException: (exceptionId: string) =>
      call<void>(`/timetable/exceptions/${exceptionId}`, { method: "DELETE" }),

    saveClass: (input: { id?: string; code: string; label: string; level?: string | null; position?: number }) =>
      call<{ schoolClass: SchoolClass }>("/timetable/classes", json("POST", input)),

    savePeriods: (periods: { label: string; startsAt: string; endsAt: string }[]) =>
      call<{ periods: Period[] }>("/timetable/periods", json("PUT", { periods })),

    saveHolidays: (holidays: { label: string; startsOn: string; endsOn: string }[]) =>
      call<{ holidays: Holiday[] }>("/timetable/holidays", json("PUT", { holidays })),

    saveYear: (year: { label: string; startsOn: string; endsOn: string; parityAnchor: string | null }) =>
      call<{ year: SchoolYear }>("/timetable/year", json("PUT", year)),
  },

  /** Ce qu'un écran afficherait aujourd'hui — l'aperçu de la saisie. */
  preview: (classId: string, date: string) =>
    request<{ classId: string; classLabel: string; date: string; entries: PreviewEntry[]; notice?: string }>(
      `/v1/timetable/classes/${classId}/day?date=${date}`,
    ),
};

export interface PreviewEntry {
  time: string;
  endTime: string;
  subject: string;
  room: string;
  teacher?: string;
  change: "none" | "cancelled" | "room" | "teacher" | "added";
  note?: string;
}

export const DAYS = [
  { value: 1, label: "Lundi", short: "Lun" },
  { value: 2, label: "Mardi", short: "Mar" },
  { value: 3, label: "Mercredi", short: "Mer" },
  { value: 4, label: "Jeudi", short: "Jeu" },
  { value: 5, label: "Vendredi", short: "Ven" },
  { value: 6, label: "Samedi", short: "Sam" },
] as const;

/** « il y a 2 min », plutôt qu'un horodatage à décoder de tête. */
export function relativeTime(atMs: number | null): string {
  if (atMs === null) return "jamais vu";
  const seconds = Math.round((Date.now() - atMs) / 1000);
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.round(hours / 24)} j`;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
}

/** « lundi 24 août », pour que la date se lise sans effort. */
export function humanDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${iso}T12:00:00`));
}
