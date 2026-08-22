import type { DataSourceRef, Manifest } from "@couloir/protocol";
import type { ClockPort, NetPort } from "./ports.js";

/**
 * Le rafraîchissement des sources vivantes.
 *
 * Portable, donc ici et non dans une coque : la logique est la même sur un
 * Raspberry Pi et sur un boîtier Android.
 *
 * Le point important est ce qu'il ne fait PAS. Un échec de récupération ne
 * supprime jamais la valeur précédente : elle reste en cache avec sa date
 * d'origine, et c'est le rendu qui décide quoi en faire selon la politique
 * de la source — l'afficher avec sa date, la masquer, ou basculer sur un
 * repli. Sans ça, une coupure de dix minutes viderait l'écran.
 */

export interface SourceSnapshot {
  fetchedAtMs: number;
  payload: unknown;
}

export class SourcePoller {
  private snapshots = new Map<string, SourceSnapshot>();
  private readonly inFlight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private manifest: Manifest | null = null;

  constructor(
    private readonly net: NetPort,
    private readonly clock: ClockPort,
    private readonly log?: (level: "info" | "warn", message: string, context?: Record<string, unknown>) => void,
  ) {}

  /**
   * Les instantanés survivent au changement de manifeste : ils sont datés.
   *
   * Mais une NOUVELLE version force un rafraîchissement immédiat. Quelqu'un
   * vient de publier et regarde l'écran : lui faire attendre la fin du TTL —
   * quinze minutes pour un emploi du temps — lui ferait croire que la
   * publication n'a pas pris.
   */
  setManifest(manifest: Manifest): void {
    const isNewVersion = manifest.version !== this.manifest?.version;
    this.manifest = manifest;
    if (isNewVersion) this.snapshots.clear();
    void this.refreshDue();
  }

  snapshotsBySourceId(): Record<string, SourceSnapshot> {
    return Object.fromEntries(this.snapshots);
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refreshDue(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Rafraîchit les sources dont la durée de fraîcheur est dépassée. */
  async refreshDue(): Promise<void> {
    const sources = this.manifest?.dataSources ?? [];
    await Promise.all(sources.filter((source) => this.isDue(source)).map((source) => this.refresh(source)));
  }

  private isDue(source: DataSourceRef): boolean {
    if (this.inFlight.has(source.id)) return false;
    const snapshot = this.snapshots.get(source.id);
    if (!snapshot) return true;
    return (this.clock.nowMs() - snapshot.fetchedAtMs) / 1000 >= source.ttlSec;
  }

  private async refresh(source: DataSourceRef): Promise<void> {
    this.inFlight.add(source.id);
    try {
      const payload = await this.net.fetchDataSource(source.url);
      this.snapshots.set(source.id, { fetchedAtMs: this.clock.nowMs(), payload });
    } catch (error) {
      // On garde la valeur précédente, avec sa date d'origine. C'est le rendu
      // qui décidera si elle est encore présentable.
      this.log?.("warn", `source ${source.id} inaccessible, on garde la précédente`, {
        error: String(error),
      });
    } finally {
      this.inFlight.delete(source.id);
    }
  }
}
