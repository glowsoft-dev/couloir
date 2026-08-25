import type {
  Capabilities,
  CommandResult,
  DeviceCommand,
  Manifest,
  TelemetryAck,
  TelemetryBatch,
  VersionDuLecteur,
} from "@couloir/protocol";

/**
 * Le contrat d'abstraction.
 *
 * C'est la frontière entre ce qui est commun à toutes les plateformes
 * (l'agent, au-dessus) et ce qui leur est propre (la coque, en dessous).
 * Chaque coque — Linux, Android, Electron, navigateur — fournit une
 * implémentation de ces interfaces, et rien d'autre.
 *
 * Ajouter une plateforme, c'est implémenter ce fichier. Ce n'est jamais
 * toucher à l'agent ni au noyau de rendu.
 *
 * Règle : une opération qu'une plateforme ne sait pas faire lève
 * `UnsupportedOperation`. Elle ne renvoie pas un succès de façade —
 * la console doit pouvoir dire à l'utilisateur que le bouton est gris
 * parce que l'appareil ne sait pas faire, et non parce que ça a raté.
 */

export class UnsupportedOperation extends Error {
  constructor(readonly operation: string) {
    super(`Opération non disponible sur cette plateforme : ${operation}`);
    this.name = "UnsupportedOperation";
  }
}

/** Réseau. Toutes les méthodes peuvent échouer : c'est le cas nominal ici. */
export interface NetPort {
  /**
   * `none` : le serveur répond, mais aucun contenu n'a encore été publié sur
   * cet écran. C'est très différent d'une panne réseau — la connexion marche,
   * et l'écran doit continuer à donner signe de vie.
   */
  fetchManifest(etag: string | null): Promise<
    | { status: "unchanged" }
    | { status: "none" }
    | { status: "updated"; manifest: Manifest; etag: string }
  >;
  /**
   * Télécharge un média dans le cache.
   * `offsetBytes` permet de reprendre là où on s'était arrêté plutôt que
   * de repartir de zéro après une coupure.
   */
  downloadAsset(
    assetId: string,
    url: string,
    offsetBytes: number,
    onProgress?: (receivedBytes: number) => void,
  ): Promise<void>;
  /** Récupère une source vivante (emploi du temps, actualités, météo). */
  fetchDataSource(url: string): Promise<unknown>;
  /**
   * La version du lecteur que le serveur met à disposition, et ses fichiers.
   *
   * `null` quand le serveur ne l'annonce pas : un serveur plus ancien que le
   * boîtier n'est pas un serveur qui annonce la version zéro, et il ne doit
   * surtout pas déclencher un remplacement.
   */
  fetchVersionDuLecteur(): Promise<VersionDuLecteur | null>;
  /** Télécharge un fichier du lecteur. L'empreinte est vérifiée par l'agent. */
  fetchFichierDuLecteur(nom: string): Promise<Uint8Array>;
  sendTelemetry(batch: TelemetryBatch): Promise<TelemetryAck>;
  /**
   * Canal temps réel. Le poll du manifeste reste le filet de sécurité s'il
   * tombe : aucune fonction essentielle n'en dépend.
   */
  subscribeCommands(handler: (command: DeviceCommand) => void): Promise<() => void>;
  /** Rend compte d'une commande exécutée, réussie ou non. */
  reportCommand(result: CommandResult): Promise<void>;
}

/** Cache média sur disque. */
export interface StorePort {
  has(assetId: string, sha256: string): Promise<boolean>;
  /** Octets déjà reçus pour un téléchargement interrompu. */
  partialBytes(assetId: string): Promise<number>;
  /** Vérifie l'empreinte puis publie le fichier par un renommage atomique. */
  commit(assetId: string, sha256: string): Promise<void>;
  delete(assetId: string): Promise<void>;
  usedBytes(): Promise<number>;
  /** Éviction LRU pour rester sous le budget. Renvoie les identifiants purgés. */
  evictTo(budgetBytes: number, keep: readonly string[]): Promise<string[]>;
}

/**
 * File d'attente persistante de la télémétrie.
 *
 * Elle survit au redémarrage : c'est elle qui garantit qu'une coupure de
 * plusieurs jours ne fait perdre aucune preuve de diffusion. On ne purge
 * qu'après acquittement explicite du serveur.
 */
export interface QueuePort {
  append(batch: TelemetryBatch): Promise<void>;
  peek(maxEvents: number): Promise<TelemetryBatch>;
  acknowledge(eventIds: readonly string[]): Promise<void>;
  pendingCount(): Promise<number>;
  /** Purge des événements trop vieux, pour borner la taille sur disque. */
  prune(olderThanIso: string): Promise<number>;
}

export interface DisplayPort {
  setPower(on: boolean): Promise<void>;
  isOn(): Promise<boolean>;
  screenshot(): Promise<Uint8Array>;
}

export interface SystemPort {
  reboot(): Promise<void>;
  restartApp(): Promise<void>;
  metrics(): Promise<{
    uptimeSec: number;
    cpuTempC?: number;
    freeDiskBytes: number;
    freeMemoryBytes: number;
  }>;
  capabilities(): Promise<Capabilities>;
}

/**
 * La mise à jour du lecteur lui-même.
 *
 * Une plateforme qui ne sait pas se remplacer lève `UnsupportedOperation` —
 * un navigateur, par exemple, est mis à jour en rechargeant la page. La
 * console peut alors le dire au lieu de laisser croire à un échec.
 *
 * L'ordre des opérations n'est pas négociable : on écrit à côté, on vérifie
 * l'empreinte, on garde l'ancienne version, et on ne bascule qu'ensuite. Un
 * lecteur à moitié écrit, c'est un couloir noir qu'on ne rallume qu'à la main.
 */
export interface UpdatePort {
  /** La version installée, telle que le boîtier la connaît. */
  versionInstallee(): Promise<string | null>;
  /**
   * Installe les fichiers déjà téléchargés et vérifiés, en gardant les
   * précédents. Ne relance rien : c'est l'agent qui décide du moment.
   */
  installer(version: string, fichiers: { nom: string; contenu: Uint8Array }[]): Promise<void>;
  /** Revient à la version précédente. Faux s'il n'y en a pas. */
  revenirEnArriere(): Promise<boolean>;
  /**
   * Combien de démarrages ont échoué depuis la dernière bascule.
   *
   * Remis à zéro dès que le boîtier a repris contact avec le serveur : c'est
   * la seule preuve qu'il tient debout, plus fiable qu'un processus démarré
   * qui plantera trois secondes plus tard.
   */
  demarragesRates(): Promise<number>;
  marquerDemarrageReussi(): Promise<void>;
}

export interface ClockPort {
  nowMs(): number;
  /**
   * Faux quand l'horloge n'a pas survécu à la coupure de courant —
   * typiquement un Raspberry Pi sans module RTC. Dans ce cas l'agent
   * refuse d'appliquer la programmation horaire et joue le repli.
   */
  isReliable(): boolean;
  syncFromNetwork(): Promise<boolean>;
}

/** Toutes les portes réunies. C'est ce que reçoit l'agent à sa construction. */
export interface PlatformPorts {
  net: NetPort;
  store: StorePort;
  queue: QueuePort;
  display: DisplayPort;
  system: SystemPort;
  clock: ClockPort;
  /** Absente sur les plateformes qui ne savent pas se remplacer. */
  update?: UpdatePort;
}
