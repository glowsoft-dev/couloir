import { exec } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import { freemem, uptime } from "node:os";
import { promisify } from "node:util";
import type { Capabilities } from "@couloir/protocol";
import { FEATURE_PROFILES } from "@couloir/protocol";
import { type ClockPort, type DisplayPort, type SystemPort, UnsupportedOperation } from "@couloir/agent";

const run = promisify(exec);

/**
 * Les portes propres à Linux.
 *
 * Elles sont volontairement minces : tout ce qui peut être décidé ailleurs
 * l'est ailleurs. Leur seule règle, c'est celle du cahier des charges — une
 * capacité absente lève `UnsupportedOperation`, elle ne renvoie jamais un
 * succès de façade.
 */

export interface LinuxSystemOptions {
  screenCode: string;
  dataDirectory: string;
  shellVersion: string;
  rendererVersion: string;
  agentVersion: string;
  cacheBudgetBytes: number;
  /** Coupé en développement : on ne redémarre pas le poste du développeur. */
  allowReboot?: boolean;
}

export class LinuxSystem implements SystemPort {
  constructor(private readonly options: LinuxSystemOptions) {}

  async reboot(): Promise<void> {
    if (!this.options.allowReboot) throw new UnsupportedOperation("redémarrage (désactivé)");
    await run("systemctl reboot");
  }

  async restartApp(): Promise<void> {
    if (!this.options.allowReboot) throw new UnsupportedOperation("relance du service (désactivée)");
    await run("systemctl restart couloir-player");
  }

  async metrics(): Promise<{
    uptimeSec: number;
    cpuTempC?: number;
    freeDiskBytes: number;
    freeMemoryBytes: number;
  }> {
    const stats = await statfs(this.options.dataDirectory).catch(() => null);
    const temperature = await cpuTemperature();
    return {
      uptimeSec: Math.round(uptime()),
      ...(temperature !== undefined ? { cpuTempC: temperature } : {}),
      freeDiskBytes: stats ? stats.bavail * stats.bsize : 0,
      freeMemoryBytes: freemem(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    const clockIsReliable = await hasHardwareClock();
    return {
      platform: "linux",
      shellVersion: this.options.shellVersion,
      rendererVersion: this.options.rendererVersion,
      agentVersion: this.options.agentVersion,
      display: await detectDisplay(),
      codecs: ["h264"],
      maxVideoHeight: 1080,
      storageBudgetBytes: this.options.cacheBudgetBytes,
      features: {
        ...FEATURE_PROFILES.linux,
        // Détecté au démarrage, jamais supposé : c'est ce champ qui remonte
        // jusqu'à la console pour signaler un Pi sans module RTC.
        reliableClock: clockIsReliable,
      },
    };
  }
}

export class LinuxDisplay implements DisplayPort {
  constructor(private readonly enabled: boolean) {}

  /**
   * Allume ou éteint la dalle.
   *
   * `vcgencmd` sur Raspberry Pi, `xset dpms` sur un Linux avec serveur X.
   * Quand ni l'un ni l'autre n'existe, on refuse EXPLICITEMENT au lieu de
   * laisser remonter l'échec de la commande : « non disponible » envoie
   * l'opérateur vers la bonne conclusion, « échec » le ferait chercher une
   * panne qui n'existe pas.
   */
  async setPower(on: boolean): Promise<void> {
    if (!this.enabled) throw new UnsupportedOperation("pilotage de la dalle");

    if (await hasBinary("vcgencmd")) {
      await run(`vcgencmd display_power ${on ? 1 : 0}`);
      return;
    }
    if (process.env["DISPLAY"] && (await hasBinary("xset"))) {
      await run(`xset dpms force ${on ? "on" : "off"}`);
      return;
    }
    throw new UnsupportedOperation("pilotage de la dalle (ni vcgencmd ni xset)");
  }

  async isOn(): Promise<boolean> {
    if (!this.enabled || !(await hasBinary("vcgencmd"))) {
      throw new UnsupportedOperation("état de la dalle");
    }
    const { stdout } = await run("vcgencmd display_power");
    return stdout.trim().endsWith("=1");
  }

  /**
   * Capture ce qui est réellement à l'écran.
   *
   * On photographie la fenêtre X, pas une page rendue à part : c'est la
   * seule façon de voir ce que voient les élèves, y compris si Chromium a
   * planté ou affiche autre chose que prévu.
   *
   * L'outil est détecté à l'exécution. Sans serveur graphique — un boîtier
   * de test, une VM — on refuse explicitement plutôt que de renvoyer une
   * image vide qui ferait croire à un écran noir.
   */
  async screenshot(): Promise<Uint8Array> {
    if (!process.env["DISPLAY"]) {
      throw new UnsupportedOperation("capture d'écran (aucun serveur graphique)");
    }

    for (const [binary, args] of SCREENSHOT_TOOLS) {
      if (!(await hasBinary(binary))) continue;
      const { stdout } = await run(`${binary} ${args}`, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
      return new Uint8Array(stdout as unknown as Buffer);
    }

    throw new UnsupportedOperation(
      `capture d'écran (installez ${SCREENSHOT_TOOLS.map(([b]) => b).join(" ou ")})`,
    );
  }
}

export class LinuxClock implements ClockPort {
  private reliable: boolean;

  constructor(reliable: boolean) {
    this.reliable = reliable;
  }

  nowMs(): number {
    return Date.now();
  }

  isReliable(): boolean {
    return this.reliable;
  }

  /**
   * Interroge systemd-timesyncd plutôt que de faire du NTP nous-mêmes : c'est
   * lui qui synchronise, on se contente de savoir s'il a réussi.
   */
  async syncFromNetwork(): Promise<boolean> {
    this.reliable = await hasHardwareClock();
    return this.reliable;
  }
}

/**
 * Les outils de capture, par ordre de préférence.
 *
 * Tous écrivent le PNG sur la sortie standard : pas de fichier temporaire à
 * nettoyer sur un boîtier qui tourne des mois.
 */
const SCREENSHOT_TOOLS: readonly [string, string][] = [
  ["scrot", "--overwrite --silent /dev/stdout"],
  ["import", "-window root png:-"],
  ["maim", "--hidecursor"],
];

async function hasBinary(name: string): Promise<boolean> {
  try {
    await run(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * L'appareil garde-t-il l'heure sans courant ?
 *
 * La question ne se pose vraiment que sur Raspberry Pi, qui n'a pas
 * d'horloge sauvegardée tant qu'on ne lui ajoute pas un module RTC. Tout
 * autre matériel — mini-PC, boîtier Android, poste de développement — en a
 * une d'origine, et répondre « non » pour eux bloquerait l'écran sur sa
 * playlist de repli sans raison.
 */
export async function hasHardwareClock(): Promise<boolean> {
  if (process.env["COULOIR_ASSUME_CLOCK_OK"] === "1") return true;
  // macOS et Windows : horloge sauvegardée par la pile de la carte mère.
  if (process.platform !== "linux") return true;

  try {
    const { stdout } = await run("timedatectl show --property=NTPSynchronized --value");
    if (stdout.trim() === "yes") return true;
  } catch {
    // timedatectl absent : on retombe sur la détection du module.
  }
  try {
    const devices = await readFile("/proc/driver/rtc", "utf8");
    return devices.trim().length > 0;
  } catch {
    return false;
  }
}

async function cpuTemperature(): Promise<number | undefined> {
  try {
    const raw = await readFile("/sys/class/thermal/thermal_zone0/temp", "utf8");
    const milliDegrees = Number(raw.trim());
    return Number.isFinite(milliDegrees) ? milliDegrees / 1000 : undefined;
  } catch {
    return undefined;
  }
}

async function detectDisplay(): Promise<Capabilities["display"]> {
  try {
    const { stdout } = await run("xrandr --current");
    const match = /(\d+)x(\d+)\s+\d+.*\*/.exec(stdout);
    if (match) {
      const widthPx = Number(match[1]);
      const heightPx = Number(match[2]);
      return { widthPx, heightPx, orientation: widthPx >= heightPx ? "landscape" : "portrait" };
    }
  } catch {
    // Pas de serveur X — cas normal en test et sur une image sans bureau.
  }
  return { widthPx: 1920, heightPx: 1080, orientation: "landscape" };
}
