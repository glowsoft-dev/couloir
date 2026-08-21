import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  type Capabilities,
  Manifest,
  type ScreenId,
  type TelemetryBatch,
  findBrokenReferences,
} from "@couloir/protocol";
import {
  type ClaimResult,
  type DeviceRecord,
  type NewScreen,
  OFFLINE_AFTER_MS,
  PAIRING_TTL_MS,
  type PendingDevice,
  type ScreenRecord,
  type ScreenStatus,
  type Store,
  hashToken,
  newPairingCode,
} from "../store.js";

/**
 * L'implémentation PostgreSQL.
 *
 * Deux exigences du cahier des charges se jouent ici, et pas ailleurs :
 *
 *   - le remplacement d'un boîtier ne doit rien faire perdre à l'écran.
 *     C'est une transaction : détacher l'ancien et rattacher le nouveau se
 *     font ensemble, ou pas du tout ;
 *
 *   - une remontée rejouée après coupure ne doit créer aucun doublon.
 *     C'est `ON CONFLICT DO NOTHING` sur l'identifiant généré par l'agent.
 */
export class PostgresStore implements Store {
  constructor(private readonly sql: Sql) {}

  async startEnrollment(
    publicKey: string,
    capabilities: Capabilities,
    hardwareId?: string,
  ): Promise<DeviceRecord & { pairingCode: string; pairingExpiresAtMs: number }> {
    const deviceId = randomUUID();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);

    // L'unicité du code est garantie par un index : on retire ici les codes
    // déjà en circulation, la base tranche en cas de collision simultanée.
    const taken = new Set(
      (
        await this.sql<{ pairing_code: string }[]>`
          SELECT pairing_code FROM devices WHERE pairing_code IS NOT NULL
        `
      ).map((row) => row.pairing_code),
    );
    const pairingCode = newPairingCode((code) => taken.has(code));

    await this.sql`
      INSERT INTO devices (id, public_key, capabilities, hardware_id, pairing_code, pairing_expires_at)
      VALUES (${deviceId}, ${publicKey}, ${this.sql.json(capabilities as never)},
              ${hardwareId ?? null}, ${pairingCode}, ${expiresAt})
    `;

    return {
      deviceId,
      publicKey,
      capabilities,
      pairingCode,
      pairingExpiresAtMs: expiresAt.getTime(),
      screenId: null,
    };
  }

  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    const rows = await this.sql<DeviceRow[]>`
      SELECT id, public_key, capabilities, pairing_code, pairing_expires_at, screen_id
      FROM devices WHERE id = ${deviceId}
    `;
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async findByPairingCode(code: string): Promise<DeviceRecord | null> {
    const rows = await this.sql<DeviceRow[]>`
      SELECT id, public_key, capabilities, pairing_code, pairing_expires_at, screen_id
      FROM devices WHERE pairing_code = ${code}
    `;
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async claimExisting(deviceId: string, screenId: ScreenId): Promise<ClaimResult | null> {
    return this.sql.begin(async (tx) => {
      const screens = await tx<ScreenRow[]>`SELECT * FROM screens WHERE id = ${screenId}`;
      const screen = screens[0];
      if (!screen) return null;
      return this.attach(tx, deviceId, toScreen(screen));
    }) as Promise<ClaimResult | null>;
  }

  async claimNew(deviceId: string, screen: NewScreen): Promise<ClaimResult> {
    return this.sql.begin(async (tx) => {
      const id = randomUUID();
      await tx`
        INSERT INTO screens (id, code, label, building, floor, area, orientation)
        VALUES (${id}, ${screen.code}, ${screen.label}, ${screen.building},
                ${screen.floor}, ${screen.area}, ${screen.orientation})
      `;
      return this.attach(tx, deviceId, { id, manifestVersion: 0, ...screen });
    }) as Promise<ClaimResult>;
  }

  /**
   * Détache l'ancien boîtier et rattache le nouveau, dans la même transaction.
   *
   * L'ordre compte : un index unique interdit deux boîtiers actifs sur le
   * même écran, donc le détachement doit précéder le rattachement.
   */
  private async attach(
    tx: TransactionSql,
    deviceId: string,
    screen: ScreenRecord,
  ): Promise<ClaimResult> {
    await tx`
      UPDATE devices SET screen_id = NULL, device_token_hash = NULL
      WHERE screen_id = ${screen.id} AND id <> ${deviceId}
    `;

    const deviceToken = randomUUID();
    const updated = await tx`
      UPDATE devices
      SET screen_id = ${screen.id}, device_token_hash = ${hashToken(deviceToken)},
          pairing_code = NULL, last_seen_at = now()
      WHERE id = ${deviceId}
      RETURNING id
    `;
    if (updated.length === 0) throw new Error(`appareil ${deviceId} inconnu`);

    return { deviceToken, screen };
  }

  async getScreen(screenId: ScreenId): Promise<ScreenRecord | null> {
    const rows = await this.sql<ScreenRow[]>`SELECT * FROM screens WHERE id = ${screenId}`;
    return rows[0] ? toScreen(rows[0]) : null;
  }

  async listScreens(): Promise<ScreenRecord[]> {
    const rows = await this.sql<ScreenRow[]>`SELECT * FROM screens ORDER BY code`;
    return rows.map(toScreen);
  }

  /**
   * Le parc avec son état.
   *
   * Le dernier battement est agrégé en SQL plutôt que ligne par ligne :
   * la console rafraîchit cette vue en continu, et une requête par écran
   * ferait mal dès la trentaine.
   */
  async listScreenStatuses(nowMs = Date.now()): Promise<ScreenStatus[]> {
    const rows = await this.sql<StatusRow[]>`
      SELECT s.*,
             d.id AS device_id,
             d.capabilities ->> 'platform' AS platform,
             b.at AS last_heartbeat_at,
             b.state AS agent_state
      FROM screens s
      LEFT JOIN devices d ON d.screen_id = s.id
      LEFT JOIN LATERAL (
        SELECT at, state FROM heartbeats
        WHERE screen_id = s.id
        ORDER BY at DESC
        LIMIT 1
      ) b ON true
      ORDER BY s.code
    `;

    return rows.map((row) => {
      const lastHeartbeatAtMs = row.last_heartbeat_at?.getTime() ?? null;
      return {
        ...toScreen(row),
        deviceId: row.device_id,
        platform: row.platform,
        lastHeartbeatAtMs,
        agentState: row.agent_state,
        online: lastHeartbeatAtMs !== null && nowMs - lastHeartbeatAtMs < OFFLINE_AFTER_MS,
      };
    });
  }

  async listPendingDevices(nowMs = Date.now()): Promise<PendingDevice[]> {
    const rows = await this.sql<PendingRow[]>`
      SELECT id, pairing_code, pairing_expires_at, capabilities ->> 'platform' AS platform
      FROM devices
      WHERE screen_id IS NULL AND pairing_code IS NOT NULL AND pairing_expires_at > ${new Date(nowMs)}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      deviceId: row.id,
      pairingCode: row.pairing_code,
      pairingExpiresAtMs: row.pairing_expires_at.getTime(),
      platform: row.platform,
    }));
  }

  async putManifest(manifest: Manifest): Promise<void> {
    const problems = findBrokenReferences(manifest);
    if (problems.length > 0) {
      throw new Error(`manifeste incohérent :\n  - ${problems.join("\n  - ")}`);
    }

    await this.sql.begin(async (tx) => {
      // Historisé, pour permettre le retour à la version précédente.
      await tx`
        INSERT INTO manifests (screen_id, version, document)
        VALUES (${manifest.screenId}, ${manifest.version}, ${tx.json(manifest as never)})
        ON CONFLICT (screen_id, version) DO UPDATE SET document = EXCLUDED.document
      `;
      await tx`
        UPDATE screens
        SET manifest_version = GREATEST(manifest_version, ${manifest.version}), updated_at = now()
        WHERE id = ${manifest.screenId}
      `;
    });
  }

  async getManifest(screenId: ScreenId): Promise<Manifest | null> {
    const rows = await this.sql<{ document: unknown }[]>`
      SELECT document FROM manifests
      WHERE screen_id = ${screenId}
      ORDER BY version DESC
      LIMIT 1
    `;
    return rows[0] ? Manifest.parse(rows[0].document) : null;
  }

  async recordTelemetry(screenId: ScreenId, batch: TelemetryBatch): Promise<string[]> {
    const accepted: string[] = [];

    await this.sql.begin(async (tx) => {
      for (const beat of batch.heartbeats) {
        await tx`
          INSERT INTO heartbeats (event_id, screen_id, at, state, manifest_version, was_offline, metrics)
          VALUES (${beat.eventId}, ${screenId}, ${beat.at}, ${beat.state},
                  ${beat.manifestVersion}, ${beat.wasOffline}, ${tx.json(beat.metrics as never)})
          ON CONFLICT (event_id) DO NOTHING
        `;
        accepted.push(beat.eventId);
      }

      for (const event of batch.playEvents) {
        await tx`
          INSERT INTO play_events (event_id, screen_id, slide_id, zone_id, manifest_version,
                                   started_at, ended_at, reason, offline, campaign_id)
          VALUES (${event.eventId}, ${screenId}, ${event.slideId}, ${event.zoneId},
                  ${event.manifestVersion}, ${event.startedAt}, ${event.endedAt},
                  ${event.reason}, ${event.offline}, ${event.campaignId ?? null})
          ON CONFLICT (event_id) DO NOTHING
        `;
        accepted.push(event.eventId);
      }

      for (const entry of batch.logs) {
        await tx`
          INSERT INTO agent_logs (event_id, screen_id, at, level, code, message, context)
          VALUES (${entry.eventId}, ${screenId}, ${entry.at}, ${entry.level},
                  ${entry.code}, ${entry.message}, ${entry.context ? tx.json(entry.context as never) : null})
          ON CONFLICT (event_id) DO NOTHING
        `;
        accepted.push(entry.eventId);
      }

      await tx`UPDATE devices SET last_seen_at = now() WHERE screen_id = ${screenId}`;
    });

    // On acquitte aussi ce qui existait déjà : sinon l'agent garderait
    // indéfiniment un événement que le serveur possède.
    return accepted;
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

interface DeviceRow {
  id: string;
  public_key: string;
  capabilities: Capabilities;
  pairing_code: string | null;
  pairing_expires_at: Date | null;
  screen_id: string | null;
}

interface StatusRow extends ScreenRow {
  device_id: string | null;
  platform: string | null;
  last_heartbeat_at: Date | null;
  agent_state: string | null;
}

interface PendingRow {
  id: string;
  pairing_code: string;
  pairing_expires_at: Date;
  platform: string | null;
}

interface ScreenRow {
  id: string;
  code: string;
  label: string;
  building: string;
  floor: number;
  area: string;
  orientation: string;
  manifest_version: number;
}

function toDevice(row: DeviceRow): DeviceRecord {
  return {
    deviceId: row.id,
    publicKey: row.public_key,
    capabilities: row.capabilities,
    pairingCode: row.pairing_code,
    pairingExpiresAtMs: row.pairing_expires_at?.getTime() ?? null,
    screenId: row.screen_id,
  };
}

function toScreen(row: ScreenRow): ScreenRecord {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    building: row.building,
    floor: row.floor,
    area: row.area,
    orientation: row.orientation,
    manifestVersion: row.manifest_version,
  };
}
