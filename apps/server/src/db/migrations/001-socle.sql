-- Le socle : le parc, les manifestes, la télémétrie.
--
-- Deux principes guident ce schéma :
--
--   1. L'écran (`screens`) et le boîtier (`devices`) sont deux choses.
--      Remplacer un Raspberry Pi par un boîtier Android déplace la ligne
--      `devices`, jamais la ligne `screens` — les playlists et l'historique
--      restent attachés à l'emplacement.
--
--   2. Tout ce que remonte un player porte son propre identifiant, généré
--      en local. Les insertions sont donc idempotentes : un lot rejoué
--      après une coupure de 48 h ne crée pas de doublon.

CREATE TABLE screens (
  id                UUID PRIMARY KEY,
  -- Le code imprimé sur l'étiquette : bâtiment · étage · numéro.
  code              TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  building          TEXT NOT NULL,
  floor             INTEGER NOT NULL,
  area              TEXT NOT NULL,
  orientation       TEXT NOT NULL DEFAULT 'landscape',
  manifest_version  INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id                  UUID PRIMARY KEY,
  public_key          TEXT NOT NULL,
  capabilities        JSONB NOT NULL,
  hardware_id         TEXT,
  -- Nul une fois le code consommé : il ne sert qu'une fois.
  pairing_code        TEXT,
  pairing_expires_at  TIMESTAMPTZ,
  -- Un boîtier détaché repasse à NULL sans perdre son historique.
  screen_id           UUID REFERENCES screens(id) ON DELETE SET NULL,
  -- On garde l'empreinte, jamais le jeton lui-même.
  device_token_hash   TEXT,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deux écrans ne peuvent pas afficher le même code d'appairage en même temps.
CREATE UNIQUE INDEX devices_pairing_code_key ON devices (pairing_code) WHERE pairing_code IS NOT NULL;
-- Un écran n'est piloté que par un boîtier à la fois.
CREATE UNIQUE INDEX devices_active_screen_key ON devices (screen_id) WHERE screen_id IS NOT NULL;

-- Historisé : c'est ce qui permettra le retour à la version précédente
-- en un clic, promis au cahier des charges.
CREATE TABLE manifests (
  screen_id   UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  document    JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (screen_id, version)
);

CREATE TABLE heartbeats (
  event_id          UUID PRIMARY KEY,
  screen_id         UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  at                TIMESTAMPTZ NOT NULL,
  state             TEXT NOT NULL,
  manifest_version  INTEGER NOT NULL,
  was_offline       BOOLEAN NOT NULL,
  metrics           JSONB NOT NULL,
  -- L'écart avec `at` mesure le retard d'une remontée différée.
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX heartbeats_screen_at_idx ON heartbeats (screen_id, at DESC);

-- Les preuves de diffusion. Ce sont elles qu'on présentera à un partenaire,
-- d'où l'exigence de n'en perdre ni d'en dupliquer aucune.
CREATE TABLE play_events (
  event_id          UUID PRIMARY KEY,
  screen_id         UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  slide_id          TEXT NOT NULL,
  zone_id           TEXT NOT NULL,
  manifest_version  INTEGER NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ NOT NULL,
  reason            TEXT NOT NULL,
  -- Vrai si le passage a été journalisé pendant une coupure.
  offline           BOOLEAN NOT NULL,
  campaign_id       TEXT,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX play_events_campaign_idx ON play_events (campaign_id, started_at) WHERE campaign_id IS NOT NULL;
CREATE INDEX play_events_screen_idx ON play_events (screen_id, started_at DESC);

CREATE TABLE agent_logs (
  event_id     UUID PRIMARY KEY,
  screen_id    UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  at           TIMESTAMPTZ NOT NULL,
  level        TEXT NOT NULL,
  code         TEXT NOT NULL,
  message      TEXT NOT NULL,
  context      JSONB,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_logs_screen_at_idx ON agent_logs (screen_id, at DESC);
