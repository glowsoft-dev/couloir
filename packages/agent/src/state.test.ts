import { describe, expect, it } from "vitest";
import {
  type AgentContext,
  type AgentEffect,
  type AgentEvent,
  type AgentSettings,
  initialContext,
  reduce,
} from "./state.js";
import { RETRY_STEPS_MS } from "./backoff.js";

const SETTINGS: AgentSettings = { offlineGraceDays: 7, pollIntervalSec: 60 };
const T0 = Date.UTC(2026, 7, 21, 8, 0, 0);
const DAY = 86_400_000;

/** Rejoue une suite d'événements, comme une vraie journée d'écran. */
function run(
  context: AgentContext,
  steps: readonly { event: AgentEvent; atMs?: number }[],
): { context: AgentContext; effects: AgentEffect[] } {
  let current = context;
  let effects: AgentEffect[] = [];
  for (const step of steps) {
    const result = reduce(current, step.event, SETTINGS, step.atMs ?? T0, () => 0.5);
    current = result.context;
    effects = result.effects;
  }
  return { context: current, effects };
}

/** Un écran déjà en service, avec la version 4 à l'écran. */
function activeScreen(): AgentContext {
  return {
    ...initialContext(),
    state: "active",
    activeVersion: 4,
    clockReliable: true,
    lastContactMs: T0,
  };
}

describe("démarrage", () => {
  it("joue le repli tant que l'horloge n'est pas fiable", () => {
    // Cas du Raspberry Pi sans module RTC après une coupure de courant :
    // il redémarre à une date fantaisiste. Mieux vaut le repli qu'un
    // emploi du temps affiché au mauvais moment.
    const { context, effects } = run(initialContext(), [
      { event: { type: "boot", clockReliable: false } },
    ]);

    expect(context.state).toBe("clock-unreliable");
    expect(effects).toContainEqual({ type: "play-fallback", reason: "clock-unreliable" });
    expect(effects).toContainEqual({ type: "sync-clock" });
    expect(effects).not.toContainEqual({ type: "fetch-manifest" });
  });

  it("part chercher son manifeste dès que l'heure est sûre", () => {
    const { context, effects } = run(initialContext(), [
      { event: { type: "boot", clockReliable: false } },
      { event: { type: "clock-synced" } },
    ]);

    expect(context.state).toBe("syncing");
    expect(context.clockReliable).toBe(true);
    expect(effects).toContainEqual({ type: "fetch-manifest" });
  });
});

describe("coupure réseau", () => {
  it("ne change RIEN à l'affichage quand la connexion tombe", () => {
    const before = activeScreen();
    const { context } = run(before, [{ event: { type: "sync-failed" }, atMs: T0 + 60_000 }]);

    expect(context.state).toBe("degraded");
    // L'invariant du projet : la version affichée est intacte.
    expect(context.activeVersion).toBe(before.activeVersion);
  });

  it("espace ses tentatives : 5 s, 15 s, 60 s, puis 5 min", () => {
    let context = activeScreen();
    const delays: number[] = [];

    for (let i = 0; i < 5; i++) {
      const result = reduce(context, { type: "sync-failed" }, SETTINGS, T0 + i * 1000, () => 0.5);
      context = result.context;
      const retry = result.effects.find((e) => e.type === "schedule-retry");
      if (retry?.type === "schedule-retry") delays.push(retry.delayMs);
    }

    expect(delays).toEqual([...RETRY_STEPS_MS, RETRY_STEPS_MS[RETRY_STEPS_MS.length - 1]]);
  });

  it("tient sept jours puis bascule sur la playlist de repli", () => {
    const context = activeScreen();

    const stillFine = reduce(context, { type: "sync-failed" }, SETTINGS, T0 + 6.9 * DAY, () => 0.5);
    expect(stillFine.context.state).toBe("degraded");
    expect(stillFine.effects.some((e) => e.type === "play-fallback")).toBe(false);

    const tooLong = reduce(context, { type: "sync-failed" }, SETTINGS, T0 + 7.1 * DAY, () => 0.5);
    expect(tooLong.context.state).toBe("fallback");
    expect(tooLong.effects).toContainEqual({ type: "play-fallback", reason: "offline-too-long" });
  });

  it("se disperse avant de se manifester au retour du réseau", () => {
    // Quarante écrans qui redémarrent ensemble ne doivent pas tomber sur le
    // serveur à la même seconde.
    const degraded = { ...activeScreen(), state: "degraded" as const };
    const { effects } = reduce(degraded, { type: "tick" }, SETTINGS, T0, () => 0.75);

    const retry = effects.find((e) => e.type === "schedule-retry");
    expect(retry).toEqual({ type: "schedule-retry", delayMs: 45_000 });
  });

  it("ne se disperse pas quand tout va bien", () => {
    const { effects } = reduce(activeScreen(), { type: "tick" }, SETTINGS, T0, () => 0.75);
    expect(effects).toEqual([{ type: "fetch-manifest" }]);
  });
});

describe("bascule de manifeste", () => {
  it("applique tout de suite quand rien ne manque", () => {
    const { context, effects } = run(activeScreen(), [
      { event: { type: "manifest-received", version: 5, missingAssets: 0 } },
    ]);

    expect(context.state).toBe("active");
    expect(context.activeVersion).toBe(5);
    expect(effects).toContainEqual({ type: "apply-manifest", version: 5 });
  });

  it("continue l'ancienne version pendant le téléchargement", () => {
    const { context, effects } = run(activeScreen(), [
      { event: { type: "manifest-received", version: 5, missingAssets: 3 } },
    ]);

    expect(context.state).toBe("staging");
    expect(context.stagingVersion).toBe(5);
    // Le point important : l'écran affiche toujours la 4.
    expect(context.activeVersion).toBe(4);
    expect(effects).not.toContainEqual({ type: "apply-manifest", version: 5 });
  });

  it("ne bascule qu'au dernier fichier reçu", () => {
    let context = activeScreen();
    context = reduce(
      context,
      { type: "manifest-received", version: 5, missingAssets: 3 },
      SETTINGS,
      T0,
    ).context;

    for (const remaining of [2, 1]) {
      const step = reduce(context, { type: "asset-downloaded", remaining }, SETTINGS, T0);
      context = step.context;
      expect(context.activeVersion).toBe(4);
      expect(step.effects).toEqual([]);
    }

    const last = reduce(context, { type: "asset-downloaded", remaining: 0 }, SETTINGS, T0);
    expect(last.context.activeVersion).toBe(5);
    expect(last.effects).toContainEqual({ type: "apply-manifest", version: 5 });
  });

  it("garde l'ancienne version si un téléchargement échoue", () => {
    const { context } = run(activeScreen(), [
      { event: { type: "manifest-received", version: 5, missingAssets: 3 } },
      { event: { type: "asset-downloaded", remaining: 1 } },
      { event: { type: "staging-failed" } },
    ]);

    expect(context.activeVersion).toBe(4);
    expect(context.stagingVersion).toBeNull();
    expect(context.state).toBe("degraded");
  });

  it("donne le contenu embarqué à un écran neuf dont le premier téléchargement échoue", () => {
    // Sans ça, un écran fraîchement posé restait bloqué en « préparation » :
    // rien à l'écran, aucun signal, et personne ne comprend pourquoi.
    const fresh = { ...initialContext(), state: "syncing" as const, clockReliable: true };
    const staging = reduce(
      fresh,
      { type: "manifest-received", version: 1, missingAssets: 2 },
      SETTINGS,
      T0,
    ).context;
    expect(staging.state).toBe("staging");

    const failed = reduce(staging, { type: "staging-failed" }, SETTINGS, T0);
    expect(failed.context.state).toBe("fallback");
    expect(failed.effects.some((e) => e.type === "play-fallback")).toBe(true);
  });

  it("donne le contenu embarqué à un écran neuf qui ne joint pas le serveur", () => {
    const fresh = { ...initialContext(), state: "syncing" as const, clockReliable: true };

    const first = reduce(fresh, { type: "sync-failed" }, SETTINGS, T0);
    expect(first.context.state).toBe("fallback");
    expect(first.effects.some((e) => e.type === "play-fallback")).toBe(true);

    // On ne le resignale pas à chaque tentative ratée.
    const second = reduce(first.context, { type: "sync-failed" }, SETTINGS, T0 + 5_000);
    expect(second.effects.some((e) => e.type === "play-fallback")).toBe(false);
  });

  it("ignore un manifeste plus ancien rejoué après coupure", () => {
    const { context } = run(activeScreen(), [
      { event: { type: "manifest-received", version: 3, missingAssets: 0 } },
    ]);

    expect(context.activeVersion).toBe(4);
  });

  it("remet le compteur d'échecs à zéro dès que le serveur répond", () => {
    let context = activeScreen();
    context = reduce(context, { type: "sync-failed" }, SETTINGS, T0).context;
    context = reduce(context, { type: "sync-failed" }, SETTINGS, T0).context;
    expect(context.consecutiveFailures).toBe(2);

    context = reduce(context, { type: "manifest-unchanged" }, SETTINGS, T0 + 5000).context;
    expect(context.consecutiveFailures).toBe(0);
    expect(context.lastContactMs).toBe(T0 + 5000);
  });
});

describe("scénario complet : la coupure de 48 h de la recette", () => {
  it("survit à la coupure et se remet à jour au retour", () => {
    let context = activeScreen();

    // Le réseau tombe. On laisse deux jours passer, avec des tentatives.
    for (let hour = 1; hour <= 48; hour += 4) {
      context = reduce(context, { type: "sync-failed" }, SETTINGS, T0 + hour * 3_600_000).context;
    }
    expect(context.state).toBe("degraded");
    expect(context.activeVersion).toBe(4); // rien n'a bougé à l'écran

    // Le réseau revient : dispersion, puis récupération du manifeste.
    const back = reduce(context, { type: "tick" }, SETTINGS, T0 + 2 * DAY, () => 0.1);
    expect(back.effects).toContainEqual({ type: "schedule-retry", delayMs: 6_000 });

    // Une nouvelle version est arrivée entre-temps, avec des médias à prendre.
    context = reduce(
      back.context,
      { type: "manifest-received", version: 9, missingAssets: 2 },
      SETTINGS,
      T0 + 2 * DAY,
    ).context;
    expect(context.state).toBe("staging");
    expect(context.activeVersion).toBe(4);

    context = reduce(context, { type: "asset-downloaded", remaining: 1 }, SETTINGS, T0 + 2 * DAY).context;
    const done = reduce(context, { type: "asset-downloaded", remaining: 0 }, SETTINGS, T0 + 2 * DAY);

    expect(done.context.state).toBe("active");
    expect(done.context.activeVersion).toBe(9);
    expect(done.effects).toContainEqual({ type: "apply-manifest", version: 9 });
  });
});
