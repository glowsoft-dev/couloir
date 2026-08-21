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

export interface PublishSpec {
  layout: "plein-ecran" | "principal-et-cours";
  items: PublishItem[];
  ticker?: string;
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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = storedToken();
  const response = await fetch(`/v1/console${path}`, {
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
  return (await response.json()) as T;
}

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
  }) => call<{ screenId: string; screenCode: string }>("/pair", {
    method: "POST",
    body: JSON.stringify(input),
  }),

  publish: (screenId: string, spec: PublishSpec) =>
    call<{ screenId: string; version: number }>(`/screens/${screenId}/publish`, {
      method: "POST",
      body: JSON.stringify(spec),
    }),
};

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
