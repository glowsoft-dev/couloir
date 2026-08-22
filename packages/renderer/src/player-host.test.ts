// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPlayer } from "./player-host.js";

/**
 * Le nom de l'onglet.
 *
 * Sans lui toutes les pages d'écran s'appellent « Couloir ». Trois onglets
 * ouverts et on ne sait plus lequel regarde quel couloir : on publie sur un
 * écran en observant l'autre, on conclut que la publication ne marche pas, et
 * on reclique. C'est arrivé lors de la première prise en main.
 *
 * Ce n'est pas cosmétique, c'est ce qui rattache une page à un lieu.
 */

class ResizeObserverMuet {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let lecteur: { stop(): void } | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMuet);
  document.title = "Couloir";
});

afterEach(() => {
  lecteur?.stop();
  lecteur = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Démarre un lecteur dont `/state` répond ce qu'on lui donne. */
async function lecteurAvec(état: unknown): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(état), { status: 200 })),
  );
  const racine = document.createElement("div");
  document.body.append(racine);
  lecteur = startPlayer(racine, {
    stateUrl: "/state",
    assetUrl: (id: string) => `/media/${id}`,
  });
  // Le premier relevé part immédiatement ; on lui laisse le temps d'arriver.
  await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
}

const ÉTAT_VIDE = {
  manifest: null,
  sources: {},
  availableAssetIds: [],
  forceFallback: false,
  identify: null,
  screenCode: null,
  pairing: null,
};

describe("le nom de l'onglet", () => {
  it("porte le code de l'écran une fois rattaché", async () => {
    await lecteurAvec({ ...ÉTAT_VIDE, screenCode: "B·1·01" });
    expect(document.title).toBe("B·1·01");
  });

  it("porte le code d'appairage tant que l'écran n'est pas rattaché", async () => {
    // C'est le moment où l'on a le plus besoin de distinguer deux boîtiers :
    // on les rattache l'un après l'autre.
    await lecteurAvec({
      ...ÉTAT_VIDE,
      pairing: { code: "QSM6KL", expiresAt: "2026-08-23T10:00:00Z" },
    });
    expect(document.title).toBe("À rattacher · QSM6KL");
  });

  it("retombe sur « Couloir » quand l'écran ne sait encore rien de lui-même", async () => {
    await lecteurAvec(ÉTAT_VIDE);
    expect(document.title).toBe("Couloir");
  });
});
