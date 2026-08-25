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
import { createWriteStream, mkdirSync, rmSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JETON = "demo-couloir";
const PORT_SERVEUR = 3000;
/**
 * Combien d'écrans simuler.
 *
 * Deux suffisent pour éprouver une publication et une urgence. Il en faut
 * autant que de bâtiments pour voir chacun prendre son propre emploi du
 * temps — c'est le moment où la correspondance automatique se constate au
 * lieu de se croire sur parole.
 */
const NOMBRE_ÉCRANS = (() => {
  const drapeau = process.argv.indexOf("--ecrans");
  const demandé = drapeau >= 0 ? Number(process.argv[drapeau + 1]) : 2;
  return Number.isFinite(demandé) ? Math.min(Math.max(demandé, 1), 8) : 2;
})();

const ÉCRANS = Array.from({ length: NOMBRE_ÉCRANS }, (_, i) => ({
  nom: `écran ${i + 1}`,
  port: 8080 + i,
}));

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
 * Les journaux vont toujours dans un fichier, et à l'écran sur demande.
 *
 * Deux écrans et un serveur en JSON noient le terminal, et on cherche à voir
 * l'interface, pas les battements de cœur. Mais les cacher entièrement fait
 * qu'au moment où quelque chose cloche, il ne reste aucune trace de ce qui
 * s'est passé. Ils sont donc toujours écrits.
 */
const journauxVisibles = process.argv.includes("--journaux");
const FICHIER_JOURNAL = join(racine, "journal.log");
let fluxJournal = null;

function journaliser(nom, données) {
  for (const ligne of String(données).split("\n").filter(Boolean)) {
    fluxJournal?.write(`[${nom}] ${ligne}\n`);
    if (journauxVisibles) console.log(`${c.gris(`[${nom}]`)} ${ligne}`);
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

mkdirSync(racine, { recursive: true });
fluxJournal = createWriteStream(FICHIER_JOURNAL, { flags: "a" });

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
  /**
   * L'adresse par laquelle les ÉCRANS joignent le serveur.
   *
   * Sans elle, elle se déduit de l'en-tête `Host` de qui publie — donc
   * « localhost », qui pour un écran désigne l'écran lui-même. Les médias
   * s'en tiraient parce que l'agent les télécharge depuis Node ; les images
   * d'actualités, elles, sont chargées par le navigateur de la dalle, et
   * échouaient sans un mot. En production c'est le nom de domaine.
   */
  COULOIR_PUBLIC_URL: `http://127.0.0.1:${PORT_SERVEUR}`,
});
await attendre(`http://localhost:${PORT_SERVEUR}/health`, "le serveur");
fait(`http://localhost:${PORT_SERVEUR}`);

/*
 * L'emploi du temps de démonstration.
 *
 * Posé après le serveur, qui vient d'appliquer les migrations, et en SQL
 * plutôt que par l'API : créer un emploi du temps demande un compte, et il
 * n'en existe encore aucun à ce moment-là. Le fichier ne fait rien si des
 * classes sont déjà là — relancer la démonstration n'écrase pas ce qu'on y a
 * saisi.
 */
étape("emploi du temps");
exécuter("docker", ["compose", "exec", "-T", "postgres", "psql", "-q", "-U", "couloir", "-d", "couloir", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
  stdio: [openSync(join(process.cwd(), "scripts/demo-emploi-du-temps.sql"), "r"), "ignore", "ignore"],
});
fait("4 classes, une semaine type");

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

/**
 * Quel port affiche quel écran.
 *
 * On le demande à l'écran lui-même : l'ordre d'appairage n'a aucune raison de
 * suivre l'ordre de démarrage, si bien que « écran 1 » peut très bien être
 * B·2·02. Sans cette ligne on publie sur un écran en regardant l'autre, on
 * conclut que la publication ne marche pas, et on reclique.
 *
 * On réessaie quelques secondes : un boîtier qui vient de démarrer répond
 * avant d'avoir obtenu son code d'appairage, et l'afficher « pas encore
 * rattaché » ferait justement rater l'étape suivante.
 */
async function identifier(port) {
  for (let essai = 0; essai < 20; essai++) {
    try {
      const état = await fetch(`http://127.0.0.1:${port}/state`).then((r) => r.json());
      if (état.screenCode) return { texte: état.screenCode, code: null };
      if (état.pairing) return { texte: `à rattacher`, code: état.pairing.code };
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { texte: "pas encore rattaché", code: null };
}

for (const écran of ÉCRANS) {
  const { texte, code } = await identifier(écran.port);
  écran.identité = texte;
  écran.codeAppairage = code;
}

console.log(`
${c.gras("Ouvrez trois onglets")}

  ${c.gras("Console")}   http://localhost:${PORT_SERVEUR}
${ÉCRANS.map(
  (é) =>
    `  ${c.gras("Écran")}     http://127.0.0.1:${é.port}   ${
      é.codeAppairage ? `${c.gris("à rattacher, code")} ${c.jaune(é.codeAppairage)}` : c.vert(é.identité)
    }`,
).join("\n")}

  ${c.gris("Chaque onglet écran porte son code dans le titre : on sait toujours")}
  ${c.gris("lequel on regarde. Ce sont de vrais lecteurs, pas des aperçus — ils")}
  ${c.gris("téléchargent les médias et gardent leur contenu hors connexion.")}
`);

// Les comptes changent la première question posée à l'ouverture : créer
// l'administrateur, ou se connecter.
const comptes = await fetch(`http://localhost:${PORT_SERVEUR}/v1/console/amorce`)
  .then((r) => r.json())
  .then((r) => r.comptesExistants)
  .catch(() => null);

if (comptes === false) {
  console.log(`${c.gras("À l'ouverture de la console")} — créez le compte administrateur.
  La clé de secours demandée est ${c.jaune(JETON)}.
  ${c.gris("Elle ne sert qu'à ça, et à réparer un compte : elle ne publie rien.")}
`);
} else if (comptes === true) {
  console.log(`${c.gris("Connectez-vous avec le compte créé précédemment.")}\n`);
}

if (ÉCRANS.some((é) => é.codeAppairage)) {
  console.log(
    `${c.gras("Puis")} — rattachez les écrans dans l'onglet ${c.gras("Écrans")}. Les codes ci-dessus\n  y apparaissent d'eux-mêmes ; il ne reste qu'à indiquer bâtiment, étage et zone.\n`,
  );
}

console.log(`${c.gris("Scénarios à éprouver : docs/tester.md")}`);
console.log(`${c.gris(`Journaux : ${FICHIER_JOURNAL}`)}`);
console.log(
  `${c.gris("--journaux pour les voir défiler · --ecrans N pour en simuler plus · --neuf pour repartir de zéro · Ctrl-C pour arrêter")}\n`,
);

// On ne rend pas la main : les enfants tournent tant que la console est ouverte.
await new Promise(() => {});
