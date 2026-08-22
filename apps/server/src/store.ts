import { createHash, randomUUID } from "node:crypto";
import {
  type Capabilities,
  type Manifest,
  PAIRING_CODE_TTL_SEC,
  type ScreenId,
  type TelemetryBatch,
  findBrokenReferences,
  generatePairingCode,
} from "@couloir/protocol";

/**
 * Le contrat d'accès aux données.
 *
 * Deux implémentations le respectent : `MemoryStore`, qui sert aux tests et
 * au développement, et `PostgresStore`, qui sert en production. L'API ne
 * connaît que cette interface — c'est ce qui permet de tester tout le
 * serveur sans base de données, et de changer de moteur sans toucher aux
 * routes.
 *
 * Tout y est asynchrone, y compris côté mémoire : une interface qui ment sur
 * son coût finit toujours par se payer au moment de la bascule.
 */

export interface DeviceRecord {
  deviceId: string;
  publicKey: string;
  capabilities: Capabilities;
  /** Nul une fois le code consommé : il ne sert qu'une fois. */
  pairingCode: string | null;
  pairingExpiresAtMs: number | null;
  screenId: ScreenId | null;
}

export interface ScreenRecord {
  id: ScreenId;
  code: string;
  label: string;
  building: string;
  floor: number;
  area: string;
  orientation: string;
  manifestVersion: number;
}

export interface NewScreen {
  code: string;
  label: string;
  building: string;
  floor: number;
  area: string;
  orientation: string;
}

export interface ClaimResult {
  deviceToken: string;
  screen: ScreenRecord;
}

/**
 * Un écran tel que la console le présente.
 *
 * L'état est déduit du dernier battement de cœur, pas déclaré : un écran
 * débranché n'a aucun moyen de dire qu'il est parti.
 */
export interface ScreenStatus extends ScreenRecord {
  deviceId: string | null;
  platform: string | null;
  lastHeartbeatAtMs: number | null;
  agentState: string | null;
  online: boolean;
}

/** Un boîtier qui affiche son code et attend d'être rattaché. */
export interface PendingDevice {
  deviceId: string;
  pairingCode: string;
  pairingExpiresAtMs: number;
  platform: string | null;
}

/**
 * Au-delà, on considère l'écran muet.
 *
 * Trois battements manqués : assez pour absorber une requête perdue, assez
 * court pour qu'une panne remonte dans le quart d'heure promis.
 */
export const OFFLINE_AFTER_MS = 3 * 60_000;

export interface Store {
  startEnrollment(
    publicKey: string,
    capabilities: Capabilities,
    hardwareId?: string,
  ): Promise<DeviceRecord & { pairingCode: string; pairingExpiresAtMs: number }>;

  getDevice(deviceId: string): Promise<DeviceRecord | null>;
  findByPairingCode(code: string): Promise<DeviceRecord | null>;

  /**
   * Rattache un boîtier à un écran existant.
   *
   * C'est le chemin du remplacement de matériel : l'ancien boîtier est
   * détaché, le nouveau hérite de l'emplacement, des playlists et de
   * l'historique — y compris s'il est d'une autre plateforme.
   */
  claimExisting(deviceId: string, screenId: ScreenId): Promise<ClaimResult | null>;
  claimNew(deviceId: string, screen: NewScreen): Promise<ClaimResult>;

  getScreen(screenId: ScreenId): Promise<ScreenRecord | null>;
  listScreens(): Promise<ScreenRecord[]>;

  /** Le parc tel que la console l'affiche, état compris. */
  listScreenStatuses(nowMs?: number): Promise<ScreenStatus[]>;
  /** Les boîtiers qui affichent un code et attendent un rattachement. */
  listPendingDevices(nowMs?: number): Promise<PendingDevice[]>;

  /**
   * `spec` est la composition qui a produit ce manifeste — « plein écran,
   * cette affiche, ce bandeau ». La conserver permet de rouvrir une
   * publication pour en changer un détail, au lieu de tout resaisir.
   */
  putManifest(manifest: Manifest, spec?: unknown): Promise<void>;
  getManifest(screenId: ScreenId): Promise<Manifest | null>;
  /**
   * L'historique des publications, de la plus récente à la plus ancienne.
   *
   * Sans lui, publier serait irréversible : on ne pourrait revenir en
   * arrière qu'en refaisant la composition de mémoire.
   */
  listManifests(screenId: ScreenId, limit?: number): Promise<{ version: number; issuedAt: string }[]>;
  getManifestVersion(screenId: ScreenId, version: number): Promise<Manifest | null>;
  /** La composition d'une version, si elle a été enregistrée. */
  getSpec(screenId: ScreenId, version?: number): Promise<unknown | null>;

  /**
   * Enregistre un lot remonté par un écran.
   *
   * Renvoie les identifiants réellement acceptés — c'est la seule chose qui
   * autorise l'agent à purger sa file locale. L'écriture est idempotente :
   * un lot rejoué après une coupure de 48 h ne crée aucun doublon.
   */
  recordTelemetry(screenId: ScreenId, batch: TelemetryBatch): Promise<string[]>;

  close(): Promise<void>;
}

/** Un code d'appairage non consommé et périmé n'ouvre plus rien. */
export function isPairingExpired(device: DeviceRecord, nowMs: number): boolean {
  return (
    device.screenId === null &&
    device.pairingExpiresAtMs !== null &&
    nowMs > device.pairingExpiresAtMs
  );
}

/** On garde l'empreinte du jeton, jamais le jeton lui-même. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newPairingCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = generatePairingCode((n) => crypto.getRandomValues(new Uint8Array(n)));
    if (!taken(code)) return code;
  }
  throw new Error("impossible de tirer un code d'appairage libre");
}

export const PAIRING_TTL_MS = PAIRING_CODE_TTL_SEC * 1000;

/**
 * Implémentation en mémoire.
 *
 * Elle reste utile après l'arrivée de PostgreSQL : les tests du serveur
 * tournent en quelques millisecondes sans conteneur, et un développeur peut
 * lancer le projet sans rien installer.
 */
export class MemoryStore implements Store {
  private readonly devices = new Map<string, DeviceRecord & { deviceTokenHash: string | null }>();
  private readonly screens = new Map<ScreenId, ScreenRecord>();
  private readonly manifests = new Map<ScreenId, Manifest>();
  private readonly history = new Map<ScreenId, Manifest[]>();
  private readonly specs = new Map<string, unknown>();
  private readonly seenEventIds = new Set<string>();
  private readonly lastBeat = new Map<ScreenId, { atMs: number; state: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  async startEnrollment(
    publicKey: string,
    capabilities: Capabilities,
    _hardwareId?: string,
  ): Promise<DeviceRecord & { pairingCode: string; pairingExpiresAtMs: number }> {
    const taken = new Set([...this.devices.values()].map((d) => d.pairingCode));
    const pairingCode = newPairingCode((code) => taken.has(code));
    const record = {
      deviceId: randomUUID(),
      publicKey,
      capabilities,
      pairingCode,
      pairingExpiresAtMs: this.now() + PAIRING_TTL_MS,
      screenId: null,
      deviceTokenHash: null,
    };
    this.devices.set(record.deviceId, record);
    return { ...record, pairingCode, pairingExpiresAtMs: record.pairingExpiresAtMs };
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    return this.devices.get(deviceId) ?? null;
  }

  async findByPairingCode(code: string): Promise<DeviceRecord | null> {
    for (const device of this.devices.values()) {
      if (device.pairingCode === code) return device;
    }
    return null;
  }

  async claimExisting(deviceId: string, screenId: ScreenId): Promise<ClaimResult | null> {
    const screen = this.screens.get(screenId);
    if (!screen) return null;
    return this.attach(deviceId, screen);
  }

  async claimNew(deviceId: string, screen: NewScreen): Promise<ClaimResult> {
    const record: ScreenRecord = { id: randomUUID(), manifestVersion: 0, ...screen };
    this.screens.set(record.id, record);
    return this.attach(deviceId, record);
  }

  private attach(deviceId: string, screen: ScreenRecord): ClaimResult {
    const device = this.devices.get(deviceId);
    if (!device) throw new Error(`appareil ${deviceId} inconnu`);

    // Un écran n'est piloté que par un boîtier à la fois : l'ancien est
    // détaché avant que le nouveau prenne sa place.
    for (const other of this.devices.values()) {
      if (other.screenId === screen.id && other.deviceId !== deviceId) {
        other.screenId = null;
        other.deviceTokenHash = null;
      }
    }

    const deviceToken = randomUUID();
    device.screenId = screen.id;
    device.deviceTokenHash = hashToken(deviceToken);
    device.pairingCode = null;
    return { deviceToken, screen };
  }

  async getScreen(screenId: ScreenId): Promise<ScreenRecord | null> {
    return this.screens.get(screenId) ?? null;
  }

  async listScreens(): Promise<ScreenRecord[]> {
    return [...this.screens.values()];
  }

  async listScreenStatuses(nowMs = this.now()): Promise<ScreenStatus[]> {
    return [...this.screens.values()].map((screen) => {
      const device = [...this.devices.values()].find((d) => d.screenId === screen.id);
      const beat = this.lastBeat.get(screen.id);
      return {
        ...screen,
        deviceId: device?.deviceId ?? null,
        platform: device?.capabilities?.platform ?? null,
        lastHeartbeatAtMs: beat?.atMs ?? null,
        agentState: beat?.state ?? null,
        online: beat !== undefined && nowMs - beat.atMs < OFFLINE_AFTER_MS,
      };
    });
  }

  async listPendingDevices(nowMs = this.now()): Promise<PendingDevice[]> {
    return [...this.devices.values()]
      .filter((d) => d.screenId === null && d.pairingCode !== null)
      .filter((d) => d.pairingExpiresAtMs !== null && d.pairingExpiresAtMs > nowMs)
      .map((d) => ({
        deviceId: d.deviceId,
        pairingCode: d.pairingCode!,
        pairingExpiresAtMs: d.pairingExpiresAtMs!,
        platform: d.capabilities?.platform ?? null,
      }));
  }

  async putManifest(manifest: Manifest, spec?: unknown): Promise<void> {
    if (spec !== undefined) this.specs.set(`${manifest.screenId}:${manifest.version}`, spec);
    const problems = findBrokenReferences(manifest);
    if (problems.length > 0) {
      throw new Error(`manifeste incohérent :\n  - ${problems.join("\n  - ")}`);
    }
    this.manifests.set(manifest.screenId, manifest);
    const past = this.history.get(manifest.screenId) ?? [];
    this.history.set(manifest.screenId, [...past.filter((m) => m.version !== manifest.version), manifest]);
    const screen = this.screens.get(manifest.screenId);
    if (screen) screen.manifestVersion = manifest.version;
  }

  async getManifest(screenId: ScreenId): Promise<Manifest | null> {
    return this.manifests.get(screenId) ?? null;
  }

  async listManifests(screenId: ScreenId, limit = 20) {
    return (this.history.get(screenId) ?? [])
      .slice()
      .sort((a, b) => b.version - a.version)
      .slice(0, limit)
      .map((m) => ({ version: m.version, issuedAt: m.issuedAt }));
  }

  async getManifestVersion(screenId: ScreenId, version: number): Promise<Manifest | null> {
    return (this.history.get(screenId) ?? []).find((m) => m.version === version) ?? null;
  }

  async getSpec(screenId: ScreenId, version?: number): Promise<unknown | null> {
    const target = version ?? this.manifests.get(screenId)?.version;
    return target === undefined ? null : (this.specs.get(`${screenId}:${target}`) ?? null);
  }

  async recordTelemetry(screenId: ScreenId, batch: TelemetryBatch): Promise<string[]> {
    for (const beat of batch.heartbeats) {
      const atMs = Date.parse(beat.at);
      const previous = this.lastBeat.get(screenId);
      // Un lot rattrapé après coupure contient des battements anciens : on ne
      // fait jamais reculer la date du dernier signe de vie.
      if (!previous || atMs > previous.atMs) this.lastBeat.set(screenId, { atMs, state: beat.state });
    }

    const ids = [
      ...batch.heartbeats.map((h) => h.eventId),
      ...batch.playEvents.map((p) => p.eventId),
      ...batch.logs.map((l) => l.eventId),
    ];
    // On acquitte aussi ce qu'on avait déjà : sinon l'agent garderait
    // indéfiniment un événement que le serveur possède déjà.
    for (const id of ids) this.seenEventIds.add(id);
    return ids;
  }

  async close(): Promise<void> {}
}
