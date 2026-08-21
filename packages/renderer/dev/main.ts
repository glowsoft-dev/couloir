import { type Manifest, demoManifest } from "@couloir/protocol";
import { type RotationState, type SourceSnapshot, direct, mountRenderer } from "../src/index.js";

/**
 * Harnais de développement.
 *
 * Il rejoue le noyau de rendu avec le manifeste de référence et des données
 * simulées, et permet de basculer à la main dans chacun des états que
 * l'écran peut prendre en vrai. C'est le moyen le plus rapide de vérifier
 * qu'une mise en page tient, sans matériel et sans serveur.
 */

const stage = document.getElementById("stage")!;
const stateLabel = document.getElementById("state")!;

const renderer = mountRenderer(stage, {
  // En vrai, l'agent sert les médias depuis le cache local.
  assetUrl: () => "https://placehold.co/1280x720/171C1A/54BE95/png?text=Portes+ouvertes",
});

const TIMETABLE = [
  { time: "08:00", subject: "Mathématiques", room: "B 204" },
  { time: "09:00", subject: "Histoire-géo", room: "A 112" },
  { time: "10:15", subject: "Physique-chimie", room: "C 007", changed: true, note: "salle changée" },
  { time: "11:15", subject: "Anglais", room: "B 118" },
  { time: "13:30", subject: "EPS", room: "Gymnase" },
  { time: "14:30", subject: "SVT", room: "C 102", changed: true, note: "annulé" },
  { time: "15:30", subject: "Philosophie", room: "A 210" },
];

const NEWS = [
  {
    category: "Vie de l'école",
    title: "Portes ouvertes le samedi 12 septembre",
    excerpt:
      "Visite des ateliers, rencontre avec les équipes pédagogiques et démonstrations du club robotique de 9 h à 17 h.",
  },
];

type Scenario = "normal" | "stale" | "emergency" | "identify" | "fallback" | "off";
let scenario: Scenario = "normal";
let rotations = new Map<string, RotationState>();
let mediaEnded = new Set<string>();

const screenId = "demo-a-1-12";
const baseManifest = demoManifest(screenId);

function manifestFor(now: number): Manifest {
  if (scenario === "emergency") {
    return {
      ...baseManifest,
      emergency: {
        id: "evac-1",
        title: "Évacuation immédiate du bâtiment A",
        body: "Rejoignez le point de rassemblement sur le parking nord. N'utilisez pas les ascenseurs.",
        issuedAt: new Date(now).toISOString(),
        validUntil: new Date(now + 3_600_000).toISOString(),
      },
    };
  }
  if (scenario === "off") {
    // Une plage d'extinction qui couvre l'instant présent, quel qu'il soit.
    return {
      ...baseManifest,
      settings: {
        ...baseManifest.settings,
        displayOff: [{ daysOfWeek: [1, 2, 3, 4, 5, 6, 7], from: "00:00", to: "23:59" }],
      },
    };
  }
  return baseManifest;
}

function sourcesFor(now: number): Map<string, SourceSnapshot> {
  // `maxStaleSec` de l'emploi du temps vaut 4 h, avec une politique « hide » :
  // au-delà, la colonne se retire et la zone principale s'étire.
  const timetableAge = scenario === "stale" ? 5 * 3_600_000 : 60_000;
  return new Map<string, SourceSnapshot>([
    ["edt", { fetchedAtMs: now - timetableAge, payload: TIMETABLE }],
    ["actus-site", { fetchedAtMs: now - 300_000, payload: NEWS }],
  ]);
}

function tick() {
  const now = Date.now();
  const output = direct({
    manifest: manifestFor(now),
    nowMs: now,
    sources: sourcesFor(now),
    availableAssetIds: new Set(["affiche-po-2026"]),
    rotations,
    forceFallback: scenario === "fallback",
    identify:
      scenario === "identify"
        ? { screenCode: "A·1·12", label: "Hall central, face à l'accueil", ipAddress: "10.20.1.12" }
        : null,
    mediaEndedZoneIds: mediaEnded,
    screenCode: "A·1·12",
  });

  mediaEnded = new Set();
  rotations = output.rotations;
  renderer.update(output.screen);

  const shown = output.screen.zones
    .map((z) => `${z.zoneId}=${z.slide?.slideId ?? "—"}`)
    .join("  ");
  stateLabel.textContent = `mode ${output.screen.mode}   ${shown}`;
}

renderer.onMediaEnded((zoneId) => {
  mediaEnded.add(zoneId);
  tick();
});

const buttons: Record<Scenario, string> = {
  normal: "btn-normal",
  stale: "btn-stale",
  emergency: "btn-emergency",
  identify: "btn-identify",
  fallback: "btn-fallback",
  off: "btn-off",
};

for (const [key, id] of Object.entries(buttons) as [Scenario, string][]) {
  document.getElementById(id)!.addEventListener("click", () => {
    scenario = key;
    // Changer de scénario remet les tourniquets à zéro, comme le ferait
    // l'arrivée d'un nouveau manifeste.
    rotations = new Map();
    for (const [k, buttonId] of Object.entries(buttons)) {
      document.getElementById(buttonId)!.setAttribute("aria-pressed", String(k === key));
    }
    tick();
  });
}

// 16:9, borné à la fenêtre — on regarde un écran de couloir, pas une page web.
function fitStage() {
  const width = Math.min(window.innerWidth - 32, (window.innerHeight - 100) * (16 / 9));
  stage.style.width = `${Math.max(320, width)}px`;
  stage.style.height = `${Math.max(180, width * (9 / 16))}px`;
  stage.style.margin = "16px auto";
}
window.addEventListener("resize", fitStage);
fitStage();

tick();
setInterval(tick, 500);
