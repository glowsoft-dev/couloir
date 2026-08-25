import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  COMMAND_WAIT_SEC,
  CommandBatch,
  type CommandResult,
  type DeviceCommand,
  HEADERS,
  Manifest,
  ROUTES,
  type TelemetryAck,
  type TelemetryBatch,
  VersionDuLecteur,
} from "@couloir/protocol";
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
    try {
      return await this.attempt(path, init);
    } catch (error) {
      // Un redémarrage du serveur laisse des sockets morts dans la grappe
      // de connexions : la requête suivante échoue avant même de partir. Un
      // seul essai de plus ouvre une connexion neuve.
      //
      // Sans ça, un déploiement coûterait à CHAQUE écran un échec puis son
      // espacement — quinze secondes, puis une minute, puis cinq. Un parc
      // entier mettrait de longues minutes à revenir.
      //
      // Le rejeu est sûr : la requête n'a pas atteint le serveur, et nos
      // écritures sont de toute façon idempotentes par identifiant.
      if (!isTransportError(error)) throw error;
      return await this.attempt(path, init);
    }
  }

  private async attempt(path: string, init: RequestInit & { body?: string }): Promise<Response> {
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
  ): Promise<
    | { status: "unchanged" }
    | { status: "none" }
    | { status: "updated"; manifest: Manifest; etag: string }
  > {
    const response = await this.request(ROUTES.manifest, {
      headers: etag ? { "if-none-match": etag } : {},
    });

    if (response.status === 304) return { status: "unchanged" };
    // Le serveur répond : l'écran est joignable, il n'a simplement pas encore
    // de contenu. Ce n'est pas une panne.
    if (response.status === 404) return { status: "none" };
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

  /**
   * La version du lecteur servie, s'il y en a une.
   *
   * Non signée : c'est la même adresse publique que celle où l'installateur
   * va chercher le lecteur, avant que le boîtier n'ait la moindre identité.
   * L'empreinte, elle, est vérifiée sur le contenu — c'est ce qui compte.
   *
   * `null` quand la route n'existe pas : un serveur plus ancien que le
   * boîtier ne doit surtout pas déclencher un remplacement.
   */
  async fetchVersionDuLecteur(): Promise<VersionDuLecteur | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url("/telechargements/version.json"), {
        signal: controller.signal,
      });
      if (response.status === 404 || response.status === 503) return null;
      if (!response.ok) throw new Error(`version du lecteur : HTTP ${response.status}`);
      const analyse = VersionDuLecteur.safeParse(await response.json());
      // Une réponse illisible vaut « pas de version » : on ne remplace pas un
      // lecteur qui fonctionne sur la foi d'un corps qu'on ne comprend pas.
      return analyse.success ? analyse.data : null;
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchFichierDuLecteur(nom: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url(`/telechargements/${nom}`), {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`lecteur ${nom} : HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
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
   * Canal temps réel, par interrogation longue.
   *
   * On demande ses commandes au serveur, qui retient la réponse jusqu'à en
   * avoir une ou jusqu'à l'expiration du délai. Puis on reboucle. C'est du
   * HTTP ordinaire : même port, même signature, et ça traverse les
   * mandataires d'un réseau d'école sans configuration.
   *
   * Une coupure ne casse rien — on réessaie en espaçant les tentatives, et le
   * poll périodique du manifeste continue en parallèle.
   */
  async subscribeCommands(handler: (command: DeviceCommand) => void): Promise<() => void> {
    const controller = new AbortController();
    let failures = 0;

    const loop = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(this.url(`${ROUTES.commands}?wait=${COMMAND_WAIT_SEC}`), {
            signal: controller.signal,
            headers: this.headers("GET", `${ROUTES.commands}?wait=${COMMAND_WAIT_SEC}`),
          });
          if (!response.ok) throw new Error(`commandes : HTTP ${response.status}`);

          failures = 0;
          const batch = CommandBatch.parse(await response.json());
          for (const command of batch.commands) handler(command);
        } catch (error) {
          if (controller.signal.aborted) return;
          // Même logique que la synchronisation : on espace plutôt que de
          // marteler un serveur qui ne répond pas.
          failures = Math.min(failures + 1, 5);
          await sleep(Math.min(2 ** failures, 30) * 1000, controller.signal);
        }
      }
    };

    void loop();
    return () => controller.abort();
  }

  async reportCommand(result: CommandResult): Promise<void> {
    const body = JSON.stringify(result);
    const response = await this.request(ROUTES.commandResult, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) throw new Error(`compte rendu : HTTP ${response.status}`);
  }
}

/**
 * Distingue une panne de transport d'une réponse d'erreur.
 *
 * Une réponse HTTP, même 500, a bien atteint le serveur : la rejouer serait
 * douteux. Un échec de transport, non — et c'est le seul cas où l'on
 * réessaie.
 */
function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Une requête volontairement interrompue par le délai n'est pas à rejouer.
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  return error.name === "TypeError" || "cause" in error;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
