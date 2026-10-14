// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doitRecharger, startPlayer } from "./player-host.js";

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

/**
 * Le rechargement de la page après une mise à jour de l'affichage.
 *
 * Sans lui, le lecteur posait le nouveau moteur de rendu sur le disque et le
 * navigateur continuait d'afficher l'ancien, jusqu'au prochain redémarrage de
 * la machine. Un correctif de lisibilité pouvait ainsi attendre des semaines
 * avant d'atteindre la dalle.
 */
describe("doitRecharger", () => {
  it("recharge quand l'agent sert une autre version que celle chargée", () => {
    expect(doitRecharger("ancienne", "nouvelle", null)).toBe(true);
  });

  it("ne recharge pas quand la page porte déjà la version servie", () => {
    expect(doitRecharger("nouvelle", "nouvelle", null)).toBe(false);
  });

  it("n'insiste pas après un rechargement resté sans effet", () => {
    // Sans ce garde-fou, une empreinte qui ne concorde jamais ferait
    // recharger la page toutes les deux secondes, indéfiniment.
    expect(doitRecharger("ancienne", "nouvelle", "nouvelle")).toBe(false);
  });

  it("recharge de nouveau pour une version suivante", () => {
    expect(doitRecharger("ancienne", "suivante", "nouvelle")).toBe(true);
  });

  it("ne fait rien tant qu'une des deux empreintes manque", () => {
    // Une page d'avant ce mécanisme, ou un agent qui ne publie pas encore
    // l'empreinte : on ne recharge pas à l'aveugle.
    expect(doitRecharger(undefined, "nouvelle", null)).toBe(false);
    expect(doitRecharger("ancienne", undefined, null)).toBe(false);
  });
});
