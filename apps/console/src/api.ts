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

export interface Visibility {
  startsAt?: string;
  endsAt?: string;
  daysOfWeek?: number[];
  dailyStart?: string;
  dailyEnd?: string;
}

export interface PublishItem {
  assetId?: string;
  text?: { eyebrow?: string; titre: string; texte?: string };
  durationMs?: number;
  /** Absente = le contenu passe toujours. C'est le cas courant. */
  visibility?: Visibility;
}

export type CommandKind =
  | "sync-now"
  | "identify"
  | "screenshot"
  | "display-power"
  | "clear-cache"
  | "restart-app"
  | "reboot";

export interface CommandResult {
  commandId: string;
  outcome: "done" | "unsupported" | "failed";
  message?: string;
  /** Une capture d'écran, en base64. */
  payload?: string;
}

export interface Emergency {
  id: string;
  title: string;
  body?: string;
  issuedAt: string;
  validUntil: string;
}

export interface DisplayOffWindow {
  daysOfWeek: number[];
  from: string;
  to: string;
}

export interface PublishSpec {
  layout: "plein-ecran" | "principal-et-cours";
  items: PublishItem[];
  ticker?: string;
  /** Vide = toutes les classes défilent. Une seule = écran fixe. */
  timetableClassIds?: string[];
  /** Plages d'extinction de la dalle. Un message d'urgence la rallume. */
  displayOff?: DisplayOffWindow[];
  /** Combien d'actualités du site tournent avec le reste. 0 = aucune. */
  actualites?: number;
}

export interface Article {
  id: string;
  titre: string;
  extrait?: string;
  categorie?: string;
  image?: string;
  publieLe?: string;
}

export interface ChargeActualites {
  articles: Article[];
  source: "wordpress" | "rss" | "aucune";
  recupereLe: string;
}

export interface ReglagesActualites {
  url: string;
  categorie?: string;
  nombre: number;
  actif: boolean;
  modifieLe: string | null;
}

export interface ManifestVersion {
  version: number;
  issuedAt: string;
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

/**
 * La clé de secours, gardée le temps d'une page.
 *
 * Elle ne sert qu'à créer le premier administrateur ou à réparer un compte.
 * Volontairement en mémoire et non dans `localStorage` : elle ne doit pas
 * traîner sur le poste après la fermeture de l'onglet. La session, elle,
 * voyage dans un cookie que le JavaScript de la page ne peut pas lire.
 */
let clefDeSecours: string | null = null;

export function poserClefDeSecours(clef: string | null): void {
  clefDeSecours = clef;
}

export function clefDeSecoursPosée(): boolean {
  return clefDeSecours !== null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Le cookie de session est `SameSite=Strict` : il faut le demander
    // explicitement, `fetch` ne l'envoie pas de lui-même sur toutes les
    // configurations.
    credentials: "same-origin",
    headers: {
      ...(clefDeSecours ? { authorization: `Bearer ${clefDeSecours}` } : {}),
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

export interface Utilisateur {
  id: string;
  courriel: string;
  nom: string;
  role: Role;
  actif: boolean;
  creeLe: string;
  derniereConnexion: string | null;
}

export type Role = "administrateur" | "editeur" | "lecteur";

export interface EntreeJournal {
  id: string;
  au: string;
  auteur: string;
  action: string;
  cible: string | null;
  details: unknown;
}

export function libelléDuRole(role: Role): string {
  return { administrateur: "Administrateur", editeur: "Éditeur", lecteur: "Lecteur" }[role];
}

export function descriptionDuRole(role: Role): string {
  return {
    administrateur: "Publie, et gère les comptes.",
    editeur: "Publie sur les écrans, tient l'emploi du temps, déclenche une urgence.",
    lecteur: "Consulte sans rien modifier.",
  }[role];
}

/** Ce que le rôle autorise. Sert à masquer, pas à protéger : le serveur tranche. */
export function peutPublier(role: Role | undefined): boolean {
  return role === "administrateur" || role === "editeur";
}

export function peutAdministrer(role: Role | undefined): boolean {
  return role === "administrateur";
}

export const api = {
  /** Faut-il demander de se connecter, ou de créer le premier compte ? */
  amorce: () => call<{ comptesExistants: boolean }>("/amorce"),

  connexion: (courriel: string, motDePasse: string) =>
    call<{ utilisateur: Utilisateur }>("/session", json("POST", { courriel, motDePasse })),

  deconnexion: () => call<{ fermée: boolean }>("/session", { method: "DELETE" }),

  moi: () => call<{ utilisateur: Utilisateur }>("/moi"),

  premierCompte: (input: { courriel: string; nom: string; motDePasse: string }) =>
    call<{ utilisateur: Utilisateur }>("/utilisateurs/premier", json("POST", input)),

  utilisateurs: {
    lister: () => call<{ utilisateurs: Utilisateur[] }>("/utilisateurs"),
    creer: (input: { courriel: string; nom: string; motDePasse: string; role: Role }) =>
      call<{ utilisateur: Utilisateur }>("/utilisateurs", json("POST", input)),
    modifier: (id: string, patch: { role?: Role; actif?: boolean; motDePasse?: string }) =>
      call<{ utilisateur: Utilisateur }>(`/utilisateurs/${id}`, json("PATCH", patch)),
  },

  journal: () => call<{ entrees: EntreeJournal[] }>("/journal"),

  identite: {
    lire: () => call<{ identite: { nom: string; accent: string | null } }>("/identite"),
    enregistrer: (identite: { nom: string; accent: string | null }) =>
      call<{ identite: { nom: string; accent: string | null } }>("/identite", json("PUT", identite)),
  },

  actualites: {
    lire: () =>
      call<{
        reglages: ReglagesActualites;
        etat: { enCache: boolean; recupereLe: string | null; articles: number };
      }>("/actualites"),
    enregistrer: (reglages: { url: string; categorie?: string; nombre: number; actif: boolean }) =>
      call<{ reglages: ReglagesActualites }>("/actualites", json("PUT", reglages)),
    essayer: (reglages: { url: string; categorie?: string; nombre: number }) =>
      call<{ charge: ChargeActualites }>("/actualites/essai", json("POST", { ...reglages, actif: true })),
  },

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

  /** Ce qui est actuellement en ligne, pour rouvrir l'éditeur dessus. */
  composition: (screenId: string) =>
    call<{ version: number | null; spec: PublishSpec | null }>(`/screens/${screenId}/composition`),

  history: (screenId: string) =>
    call<{ versions: ManifestVersion[] }>(`/screens/${screenId}/history`),

  restore: (screenId: string, version: number) =>
    call<{ version: number; restoredFrom: number }>(
      `/screens/${screenId}/history/${version}/restore`,
      { method: "POST" },
    ),

  command: (screenId: string, kind: CommandKind, params?: Record<string, unknown>) =>
    call<{ command: { id: string; kind: CommandKind }; result: CommandResult }>(
      `/screens/${screenId}/command`,
      json("POST", { kind, ...(params ? { params } : {}) }),
    ),

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
