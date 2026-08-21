import { randomUUID } from "node:crypto";
import {
  type Capabilities,
  type Manifest,
  PAIRING_CODE_TTL_SEC,
  type ScreenId,
  findBrokenReferences,
  generatePairingCode,
} from "@couloir/protocol";

/**
 * Entrepôt en mémoire.
 *
 * Volontairement temporaire : il tient l'API debout pour dérouler le
 * scénario d'enrôlement et de synchronisation de bout en bout, sans avoir à
 * décider tout de suite du schéma PostgreSQL. Il expose exactement les
 * opérations qu'un vrai dépôt devra fournir, ce qui rend la bascule
 * mécanique — et il est remplacé au lot suivant.
 */

export interface PendingDevice {
  deviceId: string;
  publicKey: string;
  capabilities: Capabilities;
  pairingCode: string;
  expiresAtMs: number;
  screenId: ScreenId | null;
  deviceToken: string | null;
}

export interface Screen {
  id: ScreenId;
  code: string;
  label: string;
  building: string;
  floor: number;
  area: string;
  manifestVersion: number;
}

export class MemoryStore {
  private readonly devices = new Map<string, PendingDevice>();
  private readonly byPairingCode = new Map<string, string>();
  private readonly screens = new Map<ScreenId, Screen>();
  private readonly manifests = new Map<ScreenId, Manifest>();

  constructor(private readonly now: () => number = Date.now) {}

  startEnrollment(publicKey: string, capabilities: Capabilities): PendingDevice {
    const deviceId = randomUUID();
    const pairingCode = this.freshPairingCode();
    const device: PendingDevice = {
      deviceId,
      publicKey,
      capabilities,
      pairingCode,
      expiresAtMs: this.now() + PAIRING_CODE_TTL_SEC * 1000,
      screenId: null,
      deviceToken: null,
    };
    this.devices.set(deviceId, device);
    this.byPairingCode.set(pairingCode, deviceId);
    return device;
  }

  /** Un code non ambigu, et jamais deux fois le même en circulation. */
  private freshPairingCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generatePairingCode((n) => crypto.getRandomValues(new Uint8Array(n)));
      if (!this.byPairingCode.has(code)) return code;
    }
    throw new Error("impossible de tirer un code d'appairage libre");
  }

  getDevice(deviceId: string): PendingDevice | undefined {
    return this.devices.get(deviceId);
  }

  findByPairingCode(code: string): PendingDevice | undefined {
    const deviceId = this.byPairingCode.get(code);
    return deviceId ? this.devices.get(deviceId) : undefined;
  }

  isExpired(device: PendingDevice): boolean {
    return device.screenId === null && this.now() > device.expiresAtMs;
  }

  /**
   * Rattache l'appareil à un écran.
   * Si l'écran existe déjà, on est dans le cas du remplacement de boîtier :
   * le nouvel appareil hérite de tout, y compris s'il est d'une autre
   * plateforme. Le code d'appairage est consommé.
   */
  claim(device: PendingDevice, screen: Screen): { deviceToken: string } {
    const existing = this.screens.get(screen.id);
    this.screens.set(screen.id, existing ?? screen);

    // L'ancien boîtier, s'il y en avait un, perd son rattachement.
    for (const other of this.devices.values()) {
      if (other.screenId === screen.id && other.deviceId !== device.deviceId) {
        other.screenId = null;
        other.deviceToken = null;
      }
    }

    const deviceToken = randomUUID();
    device.screenId = screen.id;
    device.deviceToken = deviceToken;
    this.byPairingCode.delete(device.pairingCode);
    return { deviceToken };
  }

  getScreen(screenId: ScreenId): Screen | undefined {
    return this.screens.get(screenId);
  }

  listScreens(): Screen[] {
    return [...this.screens.values()];
  }

  /** Refuse d'enregistrer un manifeste qui référencerait du vide. */
  putManifest(manifest: Manifest): void {
    const problems = findBrokenReferences(manifest);
    if (problems.length > 0) {
      throw new Error(`manifeste incohérent :\n  - ${problems.join("\n  - ")}`);
    }
    this.manifests.set(manifest.screenId, manifest);
    const screen = this.screens.get(manifest.screenId);
    if (screen) screen.manifestVersion = manifest.version;
  }

  getManifest(screenId: ScreenId): Manifest | undefined {
    return this.manifests.get(screenId);
  }
}
