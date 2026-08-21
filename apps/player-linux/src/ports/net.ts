import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type DeviceCommand, HEADERS, Manifest, ROUTES, type TelemetryAck, type TelemetryBatch } from "@couloir/protocol";
import { signRequest } from "./keys.js";
import type { NetPort } from "@couloir/agent";
import type { FileStore } from "./store.js";

/**
 * L'accès réseau.
 *
 * Rien n'y est mis en cache et rien n'y est réessayé : les tentatives et
 * leur espacement sont décidés par la machine à états, pas ici. Cette porte
 * se contente d'échouer proprement, ce qui est le cas nominal sur un réseau
 * d'école.
 */

export interface HttpNetOptions {
  baseUrl: string;
  deviceId: string;
  agentVersion: string;
  /** Clé privée de l'appareil. Elle ne quitte jamais le boîtier. */
  privateKeyPem: string;
  /** Coupe une requête qui traîne, plutôt que de bloquer la boucle. */
  timeoutMs?: number;
}

export class HttpNet implements NetPort {
  private readonly timeoutMs: number;

  constructor(
    private readonly options: HttpNetOptions,
    private readonly store: FileStore,
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * En-têtes signés pour une requête donnée.
   *
   * La signature couvre la méthode, le chemin et l'empreinte du corps : une
   * signature valide ne peut donc pas être rejouée sur une autre route ni
   * avec un autre contenu.
   */
  private headers(method: string, path: string, body?: string): Record<string, string> {
    return signRequest(this.options.privateKeyPem, this.options.deviceId, this.options.agentVersion, {
      method,
      path,
      ...(body !== undefined ? { body } : {}),
    });
  }

  private url(path: string): string {
    return new URL(path, this.options.baseUrl).toString();
  }

  private async request(
    path: string,
    init: RequestInit & { body?: string } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          ...this.headers(init.method ?? "GET", path, init.body),
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchManifest(
    etag: string | null,
  ): Promise<{ status: "unchanged" } | { status: "updated"; manifest: Manifest; etag: string }> {
    const response = await this.request(ROUTES.manifest, {
      headers: etag ? { "if-none-match": etag } : {},
    });

    if (response.status === 304) return { status: "unchanged" };
    if (!response.ok) throw new Error(`manifeste : HTTP ${response.status}`);

    // On valide avant d'appliquer : un manifeste mal formé doit échouer ici,
    // pas au milieu du rendu sur un écran posé en hauteur.
    const manifest = Manifest.parse(await response.json());
    return { status: "updated", manifest, etag: response.headers.get("etag") ?? "" };
  }

  /**
   * Télécharge un média dans son fichier `.part`.
   *
   * `offsetBytes` non nul déclenche une requête `Range` : après une coupure,
   * un fichier de 400 Mo déjà reçu à 90 % ne repart pas de zéro.
   */
  async downloadAsset(
    assetId: string,
    url: string,
    offsetBytes: number,
    onProgress?: (receivedBytes: number) => void,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 20);

    try {
      // Les médias sont servis par une route publique, signée par URL : la
      // signature d'appareil n'y ajouterait rien et compliquerait le CDN.
      const response = await fetch(url, {
        signal: controller.signal,
        headers: offsetBytes > 0 ? { range: `bytes=${offsetBytes}-` } : {},
      });

      if (offsetBytes > 0 && response.status !== 206) {
        // Le serveur ignore les Range : on recommence proprement à zéro
        // plutôt que de concaténer deux morceaux qui ne se suivent pas.
        if (!response.ok) throw new Error(`média ${assetId} : HTTP ${response.status}`);
        await this.store.delete(assetId);
        return this.downloadAsset(assetId, url, 0, onProgress);
      }
      if (!response.ok || !response.body) {
        throw new Error(`média ${assetId} : HTTP ${response.status}`);
      }

      let received = offsetBytes;
      const sink = createWriteStream(this.store.partPathFor(assetId), {
        flags: offsetBytes > 0 ? "a" : "w",
      });
      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      source.on("data", (chunk: Buffer) => {
        received += chunk.byteLength;
        onProgress?.(received);
      });
      await pipeline(source, sink);
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchDataSource(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`source ${url} : HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async sendTelemetry(batch: TelemetryBatch): Promise<TelemetryAck> {
    // Le corps est sérialisé UNE fois : c'est cette chaîne exacte qui est
    // signée puis envoyée. Re-sérialiser donnerait d'autres octets, donc
    // une empreinte différente et un rejet.
    const body = JSON.stringify(batch);
    const response = await this.request(ROUTES.telemetry, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) throw new Error(`télémétrie : HTTP ${response.status}`);
    return (await response.json()) as TelemetryAck;
  }

  /**
   * Canal temps réel.
   *
   * Pas encore branché sur MQTT : le poll périodique fait tout le travail et
   * reste le filet de sécurité de toute façon. On renvoie donc un abonnement
   * inerte plutôt que de simuler une connexion qui n'existe pas.
   */
  async subscribeCommands(_handler: (command: DeviceCommand) => void): Promise<() => void> {
    return () => {};
  }
}
