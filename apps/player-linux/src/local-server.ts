import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AgentRuntime } from "@couloir/agent";
import type { PlayEvent } from "@couloir/protocol";
import type { FileStore } from "./ports/store.js";

/**
 * Le serveur local du player.
 *
 * Chromium ne parle jamais au serveur de l'école : il ne voit que cette
 * adresse sur la boucle locale. Elle lui sert la page de rendu, l'état
 * courant de l'agent, et les médias depuis le cache disque.
 *
 * Ce cloisonnement est ce qui fait que l'écran ne dépend pas du réseau pour
 * afficher : tout ce que le navigateur demande est déjà sur la machine.
 */

export interface LocalServerOptions {
  port: number;
  /**
   * Différé : le serveur local démarre AVANT l'enrôlement, pour pouvoir
   * afficher le code d'appairage. Le runtime n'existe qu'après.
   */
  runtime: () => AgentRuntime | null;
  store: FileStore;
  screenCode: () => string | null;
  pairing: () => { code: string; expiresAt: string } | null;
  sources: () => Record<string, { fetchedAtMs: number; payload: unknown }>;
  identify: () => { screenCode: string; label: string; ipAddress: string } | null;
  forceFallback: () => boolean;
  /**
   * Ce que la dalle mesure, tel que le navigateur le voit.
   *
   * Seule la page peut le savoir : l'agent tourne dans Node, sans accès à
   * l'écran. Il l'apprend donc par cette porte, et le joint à sa télémétrie.
   */
  onResolution?: (resolution: unknown) => void;
}

const PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>Couloir</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0E1211; overflow: hidden;
        font-family: "Archivo", "DejaVu Sans", sans-serif }
      /* Aucune interaction possible : c'est un écran, pas une page web. */
      * { user-select: none; -webkit-user-select: none; cursor: none }
      #screen { position: fixed; inset: 0 }
    </style>
  </head>
  <body>
    <div id="screen"></div>
    <script type="module">
      import { startPlayer } from "/couloir.js";
      startPlayer(document.getElementById("screen"), {
        stateUrl: "/state",
        transitionsUrl: "/transitions",
        assetUrl: (id) => "/media/" + id,
        // La dalle se présente à l'agent. On garde la requete en vie pour
        // que le dernier releve parte meme si la page se ferme dans la
        // foulee. (Cette page est un litteral de gabarit : pas d'accent
        // grave ici, il terminerait la chaine.)
        onResolution: (resolution) => {
          fetch("/resolution", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(resolution),
            keepalive: true,
          }).catch(() => {});
        },
      });
    </script>
  </body>
</html>`;

/**
 * Le bundle navigateur du noyau de rendu.
 *
 * Cherché à côté de l'exécutable une fois déployé, dans le dépôt en
 * développement. `COULOIR_RENDERER_BUNDLE` permet de le placer ailleurs.
 */
const BUNDLE_PATH =
  process.env["COULOIR_RENDERER_BUNDLE"] ??
  firstExisting([
    fileURLToPath(new URL("./couloir.js", import.meta.url)),
    fileURLToPath(new URL("../../../packages/renderer/dist-browser/couloir.js", import.meta.url)),
  ]);

function firstExisting(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

export function createLocalServer(options: LocalServerOptions): Server {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGE);
      return;
    }

    if (url.pathname === "/couloir.js") {
      void readFile(BUNDLE_PATH)
        .then((bundle) => {
          response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
          response.end(bundle);
        })
        .catch(() => {
          response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          response.end("Bundle de rendu absent. Lancez `pnpm --filter @couloir/renderer build:browser`.");
        });
      return;
    }

    if (url.pathname === "/state") {
      const manifest = options.runtime()?.getManifest() ?? null;
      const body = JSON.stringify({
        manifest,
        sources: options.sources(),
        availableAssetIds: manifest?.assets.map((a) => a.id) ?? [],
        forceFallback: options.forceFallback(),
        identify: options.identify(),
        screenCode: options.screenCode(),
        pairing: options.pairing(),
      });
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(body);
      return;
    }

    if (url.pathname === "/resolution" && request.method === "POST") {
      void collectJson(request)
        .then((payload) => options.onResolution?.(payload))
        .catch(() => {})
        .finally(() => {
          response.writeHead(204);
          response.end();
        });
      return;
    }

    if (url.pathname === "/transitions" && request.method === "POST") {
      void collectJson(request)
        .then((payload) => {
          const runtime = options.runtime();
          return runtime ? recordTransitions(runtime, payload) : undefined;
        })
        .catch(() => {})
        .finally(() => {
          response.writeHead(204);
          response.end();
        });
      return;
    }

    if (url.pathname.startsWith("/media/")) {
      const assetId = decodeURIComponent(url.pathname.slice("/media/".length));
      const path = options.store.pathFor(assetId);

      // Le type vient du manifeste, qui fait autorité. Sans en-tête
      // `Content-Type`, le navigateur refuse de rendre un SVG dans une
      // balise `img` et affiche une image cassée.
      const asset = options.runtime()?.getManifest()?.assets.find((a) => a.id === assetId);

      void stat(path)
        .then((info) => {
          response.writeHead(200, {
            "content-type": asset?.mime ?? "application/octet-stream",
            "content-length": String(info.size),
            "cache-control": "no-cache",
          });
          createReadStream(path).pipe(response);
        })
        .catch(() => {
          response.writeHead(404);
          response.end();
        });
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

async function collectJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

interface ReportedTransition {
  zoneId: string;
  fromSlideId: string | null;
  toSlideId: string | null;
  atMs: number;
}

/**
 * Transforme les changements de diapositive en preuves de diffusion.
 *
 * Une transition ferme la diapositive précédente : c'est de là que sortent
 * les durées réelles d'affichage, celles qu'on présentera à un partenaire.
 */
async function recordTransitions(runtime: AgentRuntime, payload: unknown): Promise<void> {
  const transitions = (payload as { transitions?: ReportedTransition[] })?.transitions;
  if (!Array.isArray(transitions)) return;

  const version = runtime.getManifest()?.version ?? 0;
  const started = new Map<string, number>();
  const playEvents: PlayEvent[] = [];

  for (const transition of transitions) {
    const previousStart = started.get(transition.zoneId);
    if (transition.fromSlideId && previousStart !== undefined) {
      playEvents.push({
        eventId: randomUUID(),
        slideId: transition.fromSlideId,
        zoneId: transition.zoneId,
        manifestVersion: version,
        startedAt: new Date(previousStart).toISOString(),
        endedAt: new Date(transition.atMs).toISOString(),
        reason: "completed",
        offline: false,
      });
    }
    started.set(transition.zoneId, transition.atMs);
  }

  if (playEvents.length > 0) {
    await runtime.record({ heartbeats: [], playEvents, logs: [] });
  }
}
