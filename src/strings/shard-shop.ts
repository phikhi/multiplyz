const shards = (n: number) => `${n} éclat${n > 1 ? "s" : ""}`;

export const shardShop = {
  link: "Choisir un compagnon avec mes éclats",
  eyebrow: "La magie des retrouvailles",
  title: "Un ami à choisir",
  intro:
    "Tes éclats de retrouvailles peuvent inviter un compagnon qui manque à ta collection. Lequel aimerais-tu rencontrer ?",
  guide:
    "Les légendaires t’attendent auprès des gardiens. Ici, tu peux choisir un compagnon commun ou rare des mondes déjà ouverts.",
  wallet: "Tes éclats",
  price: shards,
  choose: (name: string) => `Rencontrer ${name}`,
  confirmTitle: (name: string) => `Et si tu invitais ${name} ?`,
  confirm: (name: string, n: number) => `Inviter ${name} · ${shards(n)}`,
  after: (n: number) => `Après cette invitation : ${shards(n)}.`,
  missing: (n: number) =>
    `Encore ${shards(n)} pour cette rencontre. Les compagnons déjà trouvés dans les œufs t’en offrent.`,
  change: "Choisir un autre compagnon",
  empty:
    "Tu as déjà rencontré tous les compagnons à choisir ici. D’autres t’attendront dans les prochains mondes.",
  loading: "Teddy rassemble les compagnons…",
  saving: "Teddy prépare votre rencontre…",
  welcome: (name: string) => `Bienvenue, ${name} !`,
  saved: "Ton nouvel ami a rejoint ta collection. Son histoire et son petit nom t’y attendent.",
  paid: (price: number, balance: number) =>
    `Invitation enregistrée : ${shards(price)}. Solde après cet achat : ${shards(balance)}.`,
  network:
    "La connexion a été interrompue. Réessaie pour retrouver ton invitation ou ta rencontre.",
  unavailable:
    "Ce compagnon n’est plus à choisir ici. Retrouvons les autres compagnons disponibles.",
  owned: "Ce compagnon t’a déjà rejoint. Retrouve-le dans ta collection ou choisis un autre ami.",
  broke: "Ton solde d’éclats a changé. Tu peux poursuivre ton aventure et revenir plus tard.",
  error: "La rencontre n’est pas encore prête. Réessaie dans un instant.",
  shop: "← La clairière aux œufs",
} as const;
