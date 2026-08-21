/**
 * @couloir/protocol — le contrat entre le serveur et les écrans.
 *
 * Ce paquet est la seule dépendance partagée entre le serveur, l'agent et
 * les coques natives. Il ne contient que des schémas et de la logique pure :
 * aucun accès réseau, aucun accès disque, aucune dépendance à Node. C'est ce
 * qui lui permet de tourner aussi bien dans le serveur que dans un WebView
 * Android ou un navigateur.
 *
 * Toute évolution du protocole passe par ici, et par `SCHEMA_VERSION`.
 */
export * from "./common.js";
export * from "./capabilities.js";
export * from "./manifest.js";
export * from "./enroll.js";
export * from "./telemetry.js";
export * from "./negotiation.js";
export * from "./routes.js";
export * from "./demo.js";
