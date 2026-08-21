import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Capabilities,
  type EnrollStartResponse,
  type EnrollStatusResponse,
  ROUTES,
} from "@couloir/protocol";
import { generateDeviceKeys } from "./ports/keys.js";

/**
 * L'identité de l'écran, telle qu'elle est gardée sur le disque.
 *
 * Elle est le seul état qui doit absolument survivre à tout : redémarrage,
 * coupure de courant, mise à jour. Sans elle, l'écran redemanderait un code
 * d'appairage à chaque coupure, et il faudrait retourner dans le couloir.
 */

export interface Identity {
  deviceId: string;
  screenId: string | null;
  screenCode: string | null;
  deviceToken: string | null;
  /** Ne quitte jamais le boîtier. Le serveur n'en voit que la partie publique. */
  privateKeyPem: string;
  publicKey: string;
}

export interface Pairing {
  code: string;
  expiresAt: string;
}

export class IdentityFile {
  private readonly path: string;

  constructor(private readonly directory: string) {
    this.path = join(directory, "identity.json");
  }

  async read(): Promise<Identity | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as Identity;
    } catch {
      return null;
    }
  }

  /** Écriture atomique : une coupure ne doit pas laisser un fichier à moitié écrit. */
  async write(identity: Identity): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.path}.tmp`;
    // Le fichier contient la clé privée de l'appareil : lisible par son
    // seul propriétaire, jamais par le reste du système.
    await writeFile(temporary, JSON.stringify(identity, null, 2), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }
}

export interface EnrollmentCallbacks {
  /** Appelé dès que le code est connu, pour l'afficher en grand à l'écran. */
  onPairingCode: (pairing: Pairing) => void;
  onClaimed: (identity: Identity) => void;
  log?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Déroule l'enrôlement jusqu'au rattachement.
 *
 * Le processus reste bloqué ici tant que personne n'a saisi le code dans la
 * console — mais l'écran, lui, affiche le code : c'est exactement ce qu'on
 * veut voir en arrivant dans le couloir avec son téléphone.
 */
export async function enroll(
  baseUrl: string,
  capabilities: Capabilities,
  file: IdentityFile,
  callbacks: EnrollmentCallbacks,
  signal?: AbortSignal,
): Promise<Identity> {
  const existing = await file.read();
  // Une identité sans clé date d'avant la signature des requêtes : elle ne
  // serait plus acceptée par le serveur, autant repartir proprement.
  if (existing?.screenId && existing.privateKeyPem) return existing;

  const keys =
    existing?.privateKeyPem && existing.publicKey
      ? { privateKeyPem: existing.privateKeyPem, publicKey: existing.publicKey }
      : generateDeviceKeys();

  let deviceId = existing?.privateKeyPem ? (existing.deviceId ?? null) : null;
  let pollIntervalSec = 5;

  if (!deviceId) {
    const response = await fetch(new URL(ROUTES.enrollStart, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicKey: keys.publicKey, capabilities }),
    });
    if (!response.ok) throw new Error(`enrôlement : HTTP ${response.status}`);

    const start = (await response.json()) as EnrollStartResponse;
    deviceId = start.deviceId;
    pollIntervalSec = start.pollIntervalSec;
    await file.write({ deviceId, screenId: null, screenCode: null, deviceToken: null, ...keys });
    callbacks.onPairingCode({ code: start.pairingCode, expiresAt: start.expiresAt });
    callbacks.log?.(`code d'appairage ${start.pairingCode}, à saisir dans la console`);
  }

  while (!signal?.aborted) {
    await sleep(pollIntervalSec * 1000, signal);

    const status = await fetch(
      new URL(`${ROUTES.enrollStatus}?deviceId=${encodeURIComponent(deviceId)}`, baseUrl),
    )
      .then((r) => (r.ok ? (r.json() as Promise<EnrollStatusResponse>) : null))
      .catch(() => null);

    if (!status) continue;

    if (status.state === "expired") {
      // Le code a vécu 24 h sans être saisi : on en redemande un plutôt que
      // de laisser l'écran bloqué sur un code mort.
      callbacks.log?.("code d'appairage expiré, nouvelle demande");
      // On garde la clé : c'est l'identité cryptographique du boîtier.
      await file.write({ deviceId: "", screenId: null, screenCode: null, deviceToken: null, ...keys });
      return enroll(baseUrl, capabilities, file, callbacks, signal);
    }

    if (status.state === "claimed" && status.screenId) {
      const identity: Identity = {
        deviceId,
        screenId: status.screenId,
        screenCode: status.screenCode ?? null,
        deviceToken: status.deviceToken ?? null,
        ...keys,
      };
      await file.write(identity);
      callbacks.onClaimed(identity);
      callbacks.log?.(`écran rattaché : ${identity.screenCode ?? identity.screenId}`);
      return identity;
    }
  }

  throw new Error("enrôlement interrompu");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
