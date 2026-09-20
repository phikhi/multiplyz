import { forest } from "./forest";

/** Narrative belongs to the resolved theme, never to the mathematical difficulty. */
export const worldScenes = {
  forest: {
    title: forest.title,
    eyebrow: forest.eyebrow,
    invitation: forest.invitation,
    mapIntro: forest.mapIntro,
    guardian: forest.guardian,
    finale: forest.finale,
    encounter: forest.encounter,
  },
  grove: {
    title: "La clairière des lanternes",
    eyebrow: "UNE LUMIÈRE AU CREUX DES FEUILLES",
    invitation:
      "Une clairière s’ouvre entre les saules. Éveillons ses fleurs et ses lanternes, jusqu’à la vieille porte de pierre.",
    mapIntro:
      "Des saules penchés, des bassins tranquilles et une ronde de lanternes au milieu des fleurs.",
    guardian: "Le gardien de la clairière",
    finale: "La clairière s’est illuminée.",
    encounter:
      "Les fleurs et les lanternes éclairent la clairière. Teddy contemple les reflets de votre voyage dans les petits bassins.",
  },
  ocean: {
    title: "Le jardin des perles",
    eyebrow: "SOUS LES VAGUES SCINTILLANTES",
    invitation:
      "Des coquillages dorment au creux du sable. Éclairons les perles, jusqu’à la grande arche de corail.",
    mapIntro: "Des coraux tout ronds, des bulles et un sentier de perles. L’océan t’attend.",
    guardian: "Le gardien des perles",
    finale: "Les perles illuminent l’océan.",
    encounter:
      "Les coquillages brillent tout autour de Teddy. Un petit bout d’océan s’est éveillé grâce à notre voyage.",
  },
  magic: {
    title: "Les jardins suspendus",
    eyebrow: "LÀ OÙ FLEURISSENT LES SORTILÈGES",
    invitation:
      "Des jardins flottent entre les tours. Réveillons leurs fleurs de cristal, jusqu’à la porte du royaume.",
    mapIntro: "Des îlots fleuris, des lanternes suspendues et des tours au-dessus des nuages.",
    guardian: "Le gardien des jardins",
    finale: "Les jardins se sont éveillés.",
    encounter:
      "Les cristaux scintillent et les jardins fleurissent. Teddy s’arrête un instant pour admirer le chemin parcouru avec toi.",
  },
  galaxy: {
    title: "Le pont des constellations",
    eyebrow: "UN PETIT PAS ENTRE LES ÉTOILES",
    invitation:
      "Un pont traverse les étoiles. Allumons ses balises, jusqu’au grand anneau céleste.",
    mapIntro:
      "Des planètes aux grands anneaux et des îlots de lune. L’espace nous ouvre un chemin.",
    guardian: "Le gardien des étoiles",
    finale: "Une constellation s’est allumée.",
    encounter:
      "Les balises dessinent une constellation derrière Teddy. Toutes ces petites lumières racontent notre voyage.",
  },
  candy: {
    title: "La promenade des délices",
    eyebrow: "AU PAYS DES COLLINES SUCRÉES",
    invitation:
      "Un chemin de biscuits serpente entre les sucettes. Éclairons les petits bonbons, jusqu’à la porte de brioche.",
    mapIntro: "Des collines de guimauve, des rubans de caramel et un chemin croustillant.",
    guardian: "Le gardien des délices",
    finale: "La promenade pétille de lumière.",
    encounter:
      "Le sentier de biscuits brille entre les collines. Teddy et toi avez réveillé toutes ses petites merveilles.",
  },
  snow: {
    title: "Les lanternes du grand blanc",
    eyebrow: "SOUS LE CIEL DES AURORES",
    invitation:
      "La neige a tout enveloppé. Rallumons les lanternes, jusqu’à la porte de glace où nous attend une douce lumière.",
    mapIntro: "Des sommets de neige, des cristaux de glace et des lanternes bien au chaud.",
    guardian: "Le gardien des aurores",
    finale: "Les lanternes réchauffent la vallée.",
    encounter:
      "Les lanternes brillent dans la neige. Teddy regarde les aurores danser au-dessus de notre chemin.",
  },
  wonder: {
    title: "Le chemin des merveilles",
    eyebrow: "UN NOUVEAU MONDE À EXPLORER",
    invitation: "Un nouveau chemin t’attend. Avançons ensemble, une petite lumière après l’autre.",
    mapIntro: "Un nouvel horizon, un nouveau chemin à éclairer ensemble.",
    guardian: "Le gardien de ce monde",
    finale: "Un nouveau chemin s’est éclairé.",
    encounter: "Teddy admire toutes les petites lumières de votre voyage.",
  },
} as const;

export type WorldSceneKind = keyof typeof worldScenes;
export function worldSceneKind(slug?: string, worldIndex = 0): WorldSceneKind {
  if (slug === "forest" && worldIndex > 0) return "grove";
  if (slug === undefined) return "forest";
  return Object.hasOwn(worldScenes, slug) ? (slug as WorldSceneKind) : "wonder";
}
export const worldSceneStatus = {
  loading: "Le monde s’éveille…",
  fallback: "Le décor se repose. Ton chemin reste ouvert.",
};

export const worldPreview = {
  label: "Atelier des décors · aperçu sans partie ni gains",
  world: "Décor",
  grove: "Forêt enchantée · clairière",
  view: "Vue",
  map: "Carte",
  adventure: "Passage",
  progress: "Avancée",
  start: "Arrivée",
  middle: "À mi-chemin",
  end: "Passage ouvert",
  pause: "Figer le décor",
  resume: "Animer le décor",
  reduced: "Mouvements réduits",
};
