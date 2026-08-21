import { describe, expect, it } from "vitest";
import { type Capabilities, FEATURE_PROFILES, isSuitableForPermanentScreen } from "./capabilities.js";
import { type VideoDerivative, chooseVideoDerivative, explainIncompatibility } from "./negotiation.js";

function caps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    platform: "linux",
    shellVersion: "0.1.0",
    rendererVersion: "0.1.0",
    agentVersion: "0.1.0",
    display: { widthPx: 1920, heightPx: 1080, orientation: "landscape" },
    codecs: ["h264"],
    maxVideoHeight: 1080,
    storageBudgetBytes: 8 * 1024 ** 3,
    features: { ...FEATURE_PROFILES.linux },
    ...overrides,
  };
}

const DERIVATIVES: VideoDerivative[] = [
  { id: "v-2160-hevc", codec: "hevc", heightPx: 2160, bytes: 400_000_000 },
  { id: "v-1080-h264", codec: "h264", heightPx: 1080, bytes: 120_000_000 },
  { id: "v-1080-hevc", codec: "hevc", heightPx: 1080, bytes: 70_000_000 },
  { id: "v-720-h264", codec: "h264", heightPx: 720, bytes: 45_000_000 },
];

describe("choix du dérivé vidéo", () => {
  it("ne sert pas de 4K à un boîtier limité au 1080p", () => {
    const result = chooseVideoDerivative(DERIVATIVES, caps({ maxVideoHeight: 1080 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.derivative.heightPx).toBe(1080);
    expect(result.choice.downgraded).toBe(true);
  });

  it("préfère le codec le plus économe parmi ceux que l'appareil sait lire", () => {
    // À résolution égale, moins d'octets = resynchronisation plus rapide
    // après une coupure.
    const result = chooseVideoDerivative(DERIVATIVES, caps({ codecs: ["h264", "hevc"] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.derivative.id).toBe("v-1080-hevc");
  });

  it("descend en résolution plutôt que d'échouer", () => {
    const result = chooseVideoDerivative(DERIVATIVES, caps({ maxVideoHeight: 720 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.derivative.id).toBe("v-720-h264");
    expect(result.choice.downgraded).toBe(true);
  });

  it("ne signale pas de dégradation quand l'appareil prend le meilleur", () => {
    const result = chooseVideoDerivative(DERIVATIVES, caps({ codecs: ["hevc"], maxVideoHeight: 2160 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choice.derivative.heightPx).toBe(2160);
    expect(result.choice.downgraded).toBe(false);
  });

  it("explique pourquoi quand aucun codec ne convient", () => {
    const result = chooseVideoDerivative(
      [{ id: "v-av1", codec: "av1", heightPx: 1080, bytes: 50_000_000 }],
      caps({ codecs: ["h264"] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe("codec-unsupported");
    // Le message part dans la console : il est lu par une personne, pas par
    // un développeur.
    expect(explainIncompatibility(result.problem)).toContain("ne sait pas lire");
  });

  it("explique pourquoi quand tout est trop grand", () => {
    const result = chooseVideoDerivative(
      [{ id: "v-2160", codec: "h264", heightPx: 2160, bytes: 400_000_000 }],
      caps({ maxVideoHeight: 1080 }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toMatchObject({ reason: "resolution-too-high", maxHeightPx: 1080 });
  });

  it("signale une vidéo pas encore convertie", () => {
    const result = chooseVideoDerivative([], caps());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe("no-derivatives");
  });
});

describe("aptitude à une pose permanente", () => {
  it("accepte les plateformes qui démarrent et se verrouillent seules", () => {
    for (const platform of ["linux", "android", "windows", "macos", "soc"] as const) {
      expect(isSuitableForPermanentScreen(caps({ platform, features: { ...FEATURE_PROFILES[platform] } })))
        .toBe(true);
    }
  });

  it("écarte le mode navigateur", () => {
    // Il ne redémarre pas seul et son cache peut être vidé : bon pour
    // dépanner, pas pour un couloir.
    const browser = caps({ platform: "browser", features: { ...FEATURE_PROFILES.browser } });
    expect(isSuitableForPermanentScreen(browser)).toBe(false);
  });
});
