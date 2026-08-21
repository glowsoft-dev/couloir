import { randomUUID } from "node:crypto";
import { type Manifest, demoManifest } from "@couloir/protocol";
import type { MediaStore } from "./media.js";
import type { Store } from "./store.js";

/**
 * Amorce un écran de démonstration, pour dérouler le scénario avant que la
 * console existe. Le manifeste vient de `@couloir/protocol` : serveur et
 * noyau de rendu travaillent ainsi sur exactement le même exemple.
 */
export async function seedDemoScreen(
  store: Store,
  media?: MediaStore,
): Promise<{ screenId: string; manifest: Manifest }> {
  // On passe par le vrai chemin d'enrôlement plutôt que d'injecter des
  // lignes à la main : le jeu d'essai reste ainsi représentatif.
  const device = await store.startEnrollment("seed".padEnd(44, "x"), {} as never);
  const { screen } = await store.claimNew(device.deviceId, {
    code: `A·1·${randomUUID().slice(0, 2)}`,
    label: "Hall central, face à l'accueil",
    building: "A",
    floor: 1,
    area: "hall central",
    orientation: "landscape",
  });
  const screenId = screen.id;

  let manifest = demoManifest(screenId);

  // Une affiche de démonstration réellement servie, pour que le player ait
  // quelque chose à télécharger et à vérifier.
  if (media) {
    const stored = await media.put("affiche-po-2026", Buffer.from(DEMO_POSTER), "image/svg+xml");
    manifest = {
      ...manifest,
      assets: manifest.assets.map((asset) => ({
        ...asset,
        sha256: stored.sha256,
        bytes: stored.bytes,
        mime: stored.mime,
      })),
    };
  }

  await store.putManifest(manifest);
  return { screenId, manifest };
}

const DEMO_POSTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="#0B5D45"/>
  <circle cx="1080" cy="120" r="220" fill="#0A6E51"/>
  <circle cx="180" cy="640" r="180" fill="#0A6E51"/>
  <text x="90" y="300" fill="#DCE9E2" font-family="Archivo, Helvetica, sans-serif"
        font-size="34" letter-spacing="6">SAMEDI 12 SEPTEMBRE</text>
  <text x="90" y="410" fill="#FFFFFF" font-family="Archivo, Helvetica, sans-serif"
        font-size="104" font-weight="700">Portes ouvertes</text>
  <text x="90" y="490" fill="#A8CFBD" font-family="Archivo, Helvetica, sans-serif"
        font-size="40">9 h – 17 h · tous les bâtiments</text>
</svg>`;
