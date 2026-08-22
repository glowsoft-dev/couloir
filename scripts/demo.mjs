#!/usr/bin/env node
/**
 * Monter un couloir de démonstration sur un poste de travail.
 *
 * Le parc réel, c'est un serveur, des boîtiers, un réseau. Ici tout tourne
 * sur une machine : le serveur, deux écrans simulés, la console. Assez pour
 * éprouver tout ce qui compte — publier, couper le réseau, déclencher une
 * urgence — sans avoir acheté un seul boîtier.
 *
 * Une seule commande parce que l'ordre compte et qu'il est facile à rater :
 * un paquet de rendu périmé se sert sans erreur et affiche l'ancienne
 * version. Je m'y suis laissé prendre.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JETON = "demo-couloir";
const PORT_SERVEUR = 3000;
const ÉCRANS = [
  { nom: "écran 1", port: 8080 },
  { nom: "écran 2", port: 8081 },
];

const neuf = process.argv.includes("--neuf");
const racine = join(tmpdir(), "couloir-demo");
const enfants = [];
let arrêtEnCours = false;

const c = {
  gras: (t) => `\x1b[1m${t}\x1b[0m`,
  vert: (t) => `\x1b[32m${t}\x1b[0m`,
  gris: (t) => `\x1b[90m${t}\x1b[0m`,
  jaune: (t) => `\x1b[33m${t}\x1b[0m`,
};

function étape(texte) {
  process.stdout.write(`${c.gris("·")} ${texte}… `);
}
function fait(détail = "") {
  process.stdout.write(`${c.vert("ok")}${détail ? c.gris(` ${détail}`) : ""}\n`);
}

function exécuter(commande, args, options = {}) {
  const résultat = spawnSync(commande, args, { encoding: "utf8", ...options });
  if (résultat.status !== 0) {
    process.stdout.write("\n");
    console.error(c.jaune(`échec : ${commande} ${args.join(" ")}`));
    console.error(résultat.stderr || résultat.stdout);
    process.exit(1);
  }
  return résultat.stdout ?? "";
}

async function attendre(url, libellé, secondes = 45) {
  for (let i = 0; i < secondes * 2; i++) {
    try {
      const réponse = await fetch(url);
      if (réponse.ok) return;
    } catch {
      // pas encore là, c'est le cas nominal au démarrage
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${libellé} n'a pas répondu en ${secondes} s`);
}

function lancer(nom, commande, args, env) {
  const enfant = spawn(commande, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  enfant.stdout.on("data", (d) => journaliser(nom, d));
  enfant.stderr.on("data", (d) => journaliser(nom, d));
  enfant.on("exit", (code) => {
    if (!arrêtEnCours && code !== 0) {
      console.error(c.jaune(`\n${nom} s'est arrêté (code ${code}). Voir les lignes ci-dessus.`));
    }
  });
  enfants.push(enfant);
  return enfant;
}

/**
 * Les journaux ne s'affichent que sur demande.
 *
 * Deux écrans et un serveur en JSON noient l'écran, et on cherche à voir
 * l'interface, pas les battements de cœur. `--journaux` les fait revenir.
 */
const journauxVisibles = process.argv.includes("--journaux");
function journaliser(nom, données) {
  if (!journauxVisibles) return;
  for (const ligne of String(données).split("\n").filter(Boolean)) {
    console.log(`${c.gris(`[${nom}]`)} ${ligne}`);
  }
}

function arrêter() {
  if (arrêtEnCours) return;
  arrêtEnCours = true;
  console.log(c.gris("\narrêt…"));
  for (const enfant of enfants) enfant.kill("SIGTERM");
  setTimeout(() => process.exit(0), 700);
}
process.on("SIGINT", arrêter);
process.on("SIGTERM", arrêter);

// --- déroulé ---------------------------------------------------------

console.log(`\n${c.gras("Couloir")} ${c.gris("— démonstration locale")}\n`);

if (neuf) {
  étape("remise à zéro des données");
  // La base est montée depuis `./data/postgres`, un dossier du dépôt et non
  // un volume Docker : `down -v` ne l'efface pas. Il faut supprimer le
  // dossier, sans quoi le drapeau promettrait une remise à zéro qu'il ne
  // ferait pas — et on chercherait longtemps pourquoi un vieil écran
  // réapparaît.
  exécuter("docker", ["compose", "down"], { stdio: "ignore" });
  rmSync(racine, { recursive: true, force: true });
  for (const dossier of ["data/postgres", "data/media"]) {
    rmSync(join(process.cwd(), dossier), { recursive: true, force: true });
  }
  fait();
}

étape("base de données");
exécuter("docker", ["compose", "up", "-d", "postgres"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  const prêt = spawnSync("docker", ["compose", "exec", "-T", "postgres", "pg_isready", "-U", "couloir"], {
    stdio: "ignore",
  });
  if (prêt.status === 0) break;
  spawnSync("sleep", ["1"]);
}
fait();

// Le paquet de rendu et la console sont servis en fichiers statiques : un
// paquet périmé ne lève aucune erreur, il affiche simplement l'ancienne
// version. On les reconstruit à chaque fois.
étape("construction du rendu et de la console");
exécuter("pnpm", ["build"], { stdio: "ignore" });
exécuter("pnpm", ["build:browser"], { stdio: "ignore" });
exécuter("pnpm", ["build:console"], { stdio: "ignore" });
fait();

étape("serveur");
lancer("serveur", "pnpm", ["dev:server"], {
  COULOIR_DEV: "1",
  COULOIR_CONSOLE_TOKEN: JETON,
  COULOIR_PORT: String(PORT_SERVEUR),
});
await attendre(`http://localhost:${PORT_SERVEUR}/health`, "le serveur");
fait(`http://localhost:${PORT_SERVEUR}`);

for (const écran of ÉCRANS) {
  étape(écran.nom);
  const données = join(racine, `ecran-${écran.port}`);
  mkdirSync(données, { recursive: true });
  lancer(écran.nom, "pnpm", ["dev:player"], {
    COULOIR_SERVER: `http://localhost:${PORT_SERVEUR}`,
    COULOIR_DATA: données,
    COULOIR_PORT: String(écran.port),
  });
  await attendre(`http://127.0.0.1:${écran.port}/state`, écran.nom);
  fait(`http://127.0.0.1:${écran.port}`);
}

// Les boîtiers qui attendent d'être rattachés, avec leur code.
const attente = await fetch(`http://localhost:${PORT_SERVEUR}/v1/console/screens`, {
  headers: { Authorization: `Bearer ${JETON}` },
})
  .then((r) => r.json())
  .catch(() => ({ pending: [], screens: [] }));

console.log(`
${c.gras("Ouvrez trois onglets")}

  ${c.gras("Console")}    http://localhost:${PORT_SERVEUR}          ${c.gris(`jeton : ${JETON}`)}
${ÉCRANS.map((é, i) => `  ${c.gras(`Écran ${i + 1}`)}   http://127.0.0.1:${é.port}`).join("\n")}

  ${c.gris("Les deux écrans sont de vrais lecteurs : ils téléchargent les médias,")}
  ${c.gris("vérifient les empreintes et gardent leur contenu hors connexion.")}
`);

if (attente.pending?.length) {
  console.log(`${c.gras("À faire en premier")} — rattacher les écrans, onglet ${c.gras("Écrans")} :\n`);
  for (const boîtier of attente.pending) {
    console.log(`  code ${c.jaune(boîtier.pairingCode)}   ${c.gris("bâtiment, étage, zone — le code d'étiquette se construit seul")}`);
  }
  console.log("");
} else if (attente.screens?.length) {
  console.log(`${c.gris(`${attente.screens.length} écran(s) déjà rattaché(s) — les boîtiers ont retrouvé leur identité.`)}\n`);
}

console.log(`${c.gris("Scénarios à éprouver : docs/tester.md")}`);
console.log(`${c.gris("--journaux pour voir les journaux · --neuf pour repartir de zéro · Ctrl-C pour arrêter")}\n`);

// On ne rend pas la main : les enfants tournent tant que la console est ouverte.
await new Promise(() => {});
