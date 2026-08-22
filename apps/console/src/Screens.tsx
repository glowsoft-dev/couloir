import { useState } from "react";
import { type PendingDevice, type ScreenStatus, api, relativeTime } from "./api.js";

/**
 * La vue du parc.
 *
 * L'état vient du dernier battement de cœur, pas d'une déclaration : un
 * écran débranché n'a aucun moyen de dire qu'il est parti. Il est encodé
 * dans la forme — une pastille — autant que dans le texte, pour se repérer
 * sans lire.
 */

export function ScreenList({
  screens,
  selectedId,
  onSelect,
}: {
  screens: ScreenStatus[];
  selectedId: string | null;
  onSelect: (screen: ScreenStatus) => void;
}) {
  const [query, setQuery] = useState("");

  // Le filtre n'apparaît qu'à partir du moment où parcourir la liste des
  // yeux devient pénible. Avant, c'est un champ de plus à ignorer.
  const filterable = screens.length > 8;
  const needle = query.trim().toLowerCase();
  const shown =
    filterable && needle
      ? screens.filter((s) =>
          [s.code, s.label, s.building, s.area].some((v) => v?.toLowerCase().includes(needle)),
        )
      : screens;

  return (
    <section className="panel">
      <header>
        <h2>Écrans</h2>
        <span className="spacer" />
        <span className="pill">{screens.length}</span>
      </header>

      {filterable && (
        <div className="body tight">
          <input
            type="search"
            value={query}
            placeholder="Filtrer par code, nom ou bâtiment"
            aria-label="Filtrer les écrans"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="body tight">
        {screens.length === 0 ? (
          <p className="empty">
            Aucun écran pour l'instant. Branchez un boîtier : il affichera un code d'appairage, et
            il apparaîtra ici tout seul.
          </p>
        ) : shown.length === 0 ? (
          <p className="empty">Aucun écran ne correspond à « {query.trim()} ».</p>
        ) : (
          shown.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className="screen-row"
              aria-selected={screen.id === selectedId}
              onClick={() => onSelect(screen)}
            >
              <span
                className={`dot ${screen.online ? "online" : "offline"}`}
                title={screen.online ? "en ligne" : "ne répond plus"}
              />
              <span>
                <span className="screen-code">{screen.code}</span>
                <br />
                <span className="screen-label">{screen.label}</span>
              </span>
              <span className="screen-meta">
                {screen.online ? relativeTime(screen.lastHeartbeatAtMs) : "hors ligne"}
                <br />
                {/* « v0 » ne veut rien dire pour personne : on nomme l'état. */}
                {screen.manifestVersion === 0 ? (
                  <span className="warn-text">rien de publié</span>
                ) : (
                  `version ${screen.manifestVersion}`
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * Les boîtiers qui attendent d'être rattachés.
 *
 * Le code est repris automatiquement : on n'a pas à le recopier depuis le
 * couloir, il suffit de renseigner l'emplacement.
 */
export function PendingPanel({
  pending,
  onPaired,
}: {
  pending: PendingDevice[];
  onPaired: () => void;
}) {
  const [pairing, setPairing] = useState<PendingDevice | null>(null);

  if (pending.length === 0) return null;

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <header>
        <h2>En attente de rattachement</h2>
        <span className="spacer" />
        <span className="pill accent">{pending.length}</span>
      </header>

      <div className="body tight">
        {pending.map((device) => (
          <div className="pending" key={device.deviceId}>
            <span className="pending-code">{device.pairingCode}</span>
            <span className="screen-label">{device.platform ?? "plateforme inconnue"}</span>
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <button type="button" onClick={() => setPairing(device)}>
              Rattacher
            </button>
          </div>
        ))}
      </div>

      {pairing && (
        <PairForm
          device={pairing}
          onCancel={() => setPairing(null)}
          onDone={() => {
            setPairing(null);
            onPaired();
          }}
        />
      )}
    </section>
  );
}

function PairForm({
  device,
  onCancel,
  onDone,
}: {
  device: PendingDevice;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [building, setBuilding] = useState("A");
  const [floor, setFloor] = useState(1);
  const [number, setNumber] = useState(1);
  const [label, setLabel] = useState("");
  const [area, setArea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Le code d'étiquette se construit tout seul : c'est lui qui sera imprimé
  // et collé sur le cadre, il ne doit pas dépendre d'une saisie libre.
  const code = `${building.toUpperCase()}·${floor}·${number}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.pair({
        pairingCode: device.pairingCode,
        code,
        label: label.trim() || code,
        building: building.toUpperCase(),
        floor,
        area: area.trim() || "non précisé",
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="body" onSubmit={submit} style={{ borderTop: "1px solid var(--rule)" }}>
      {error && <p className="notice error">{error}</p>}

      <div className="field-row">
        <div className="field">
          <label htmlFor="building">Bâtiment</label>
          <input id="building" value={building} maxLength={4} onChange={(e) => setBuilding(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="floor">Étage</label>
          <input id="floor" type="number" value={floor} onChange={(e) => setFloor(Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="number">Numéro</label>
          <input id="number" type="number" min={1} value={number} onChange={(e) => setNumber(Number(e.target.value))} />
        </div>
      </div>

      <div className="field">
        <label htmlFor="label">Emplacement</label>
        <input
          id="label"
          value={label}
          placeholder="Hall central, face à l'accueil"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="area">Zone</label>
        <input id="area" value={area} placeholder="hall central" onChange={(e) => setArea(e.target.value)} />
      </div>

      <p className="hint">
        Étiquette à imprimer : <span className="mono">{code}</span>
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Rattachement…" : "Rattacher cet écran"}
        </button>
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
