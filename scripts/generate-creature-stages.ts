/** Owner-run art production. Read-only catalogue; never seeds or publishes to a database.
 * --plan prepares inspectable prompts. --generate uses the project's existing image client.
 * --species=… restricts a pilot; existing outputs are retained. */
import Database from "better-sqlite3";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG_DEFAULTS } from "../src/config/server-config";
import { generateImage } from "../src/lib/worldgen/image-client";
import { floodFillTransparency } from "../src/lib/image/flood-fill-transparency";
import { isRenderableAssetRef } from "../src/lib/game/world-theme";

const root = "assets/creature-stages";
const rawRoot = "storage/creature-stages";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const directions: Record<string, readonly [string, string, string]> = {
  creature_world_0_0: [
    "lavender round star-eyed alien with one glowing antenna",
    "pear-shaped body, longer arms and feet, curved antenna",
    "tall slender pear-shaped torso twice as tall as wide, large petal-shaped side fins extended outwards, two large round feet, very long antenna looping into a spiral with a glowing tip, star eyes unchanged",
  ],
  creature_world_0_1: [
    "lavender comet kitten with one star cheek and a forked comet tail",
    "standing slim young comet CAT with a distinct neck and chest, four long visible legs, raised front paw, long forked comet tail curving high above the body; do NOT keep the baby round ball body",
    "tall graceful mature CAT with pronounced long neck, fluffy star-shaped cream chest tuft, four long legs and huge flowing forked comet tail curling around and above the body; do NOT keep the baby round ball body",
  ],
  creature_world_0_2: [
    "pale lavender space jelly creature with two ear-like fins and spotted belly",
    "longer bell body, extended soft side fins, little tentacle feet",
    "elegant long bell, broad frilled side fins and six flowing rounded tentacles",
  ],
  creature_world_0_3: [
    "lavender smiling round planet with a cyan and pink ring",
    "oval body with two small flipper feet, tilted wider ring",
    "upright pear body, four rounded flipper limbs, one wide diagonal ring and a small star crown tuft",
  ],
  creature_world_0_4: [
    "blue lavender starry fluffy cloud spirit",
    "pear-shaped cloud, elongated soft arms and two fluffy feet",
    "standing tall fluffy cloud body, broad scalloped shoulder tufts and large soft feet",
  ],
  creature_world_0_5: [
    "lavender owl-like alien with glowing white star on belly",
    "longer body, opening small wings, two distinct feet",
    "broad friendly owl silhouette, two spread soft wings, tall ear tufts, glowing belly star unchanged",
  ],
  creature_world_1_0: [
    "pale lilac sparkling rounded ghost",
    "taller teardrop body, two flowing small arms, curled tail",
    "flowing bell-shaped body, wide soft sleeve arms and double curled ghost tail",
  ],
  creature_world_1_1: [
    "lavender unicorn with pastel rainbow mane",
    "longer legs, small flowing mane and curled tail",
    "graceful standing unicorn, longer neck, long sweeping rainbow mane and tail, same single horn",
  ],
  creature_world_1_2: [
    "lavender round mouse holding a tiny golden lantern, curled tail",
    "elongated body and longer paws, clear ears and tail",
    "standing round mouse, broad soft ruff, long spiral tail, same tiny golden lantern in paw",
  ],
  creature_world_1_3: [
    "lavender blue furry butterfly with pale pastel wings and glowing antenna tips",
    "elongated furry body and broader upper wings",
    "long plush butterfly body, four very broad scalloped wings, long curved antennae",
  ],
  creature_world_1_4: [
    "purple translucent glowing star-speckled slime",
    "taller teardrop shape and two soft little arms",
    "tall flowing translucent bell shape with two broad soft arms and scalloped foot, same starry interior",
  ],
  creature_world_2_0: [
    "cyan ice crystal kitten surrounded by a star-shaped ice frame",
    "longer legs and ears, longer pointed crystal tail",
    "standing tall cat with a soft faceted mane and long crystal tail, same cyan star-shaped ice motif",
  ],
  creature_world_2_1: [
    "pale blue seal wearing a cyan and cream striped scarf",
    "longer seal body, larger flippers and visible curved tail",
    "long graceful seal, two broad flippers and wide curled tail, same striped scarf",
  ],
  creature_world_2_2: [
    "pale blue plush polar bear with round ears",
    "standing little bear, longer paws and small chest tuft",
    "tall rounded friendly polar bear with broad shoulders, large soft paws and fluffy neck ruff",
  ],
  creature_world_2_3: [
    "pale cyan ice sprite with wavy ice hair and white heart on chest",
    "longer body and curved arms, growing ice crest",
    "tall pear-shaped ice sprite with large sweeping icicle crest and broad soft arms, white heart unchanged",
  ],
  creature_world_2_4: [
    "fluffy cyan reindeer ball with red nose and tiny antlers",
    "little deer body with four visible short legs and curved antlers",
    "standing friendly reindeer, long legs, soft chest ruff and rounded branched antlers, red nose unchanged",
  ],
  creature_world_2_5: [
    "pale icy blue fox with fluffy white chest",
    "longer legs and larger sweeping tail",
    "graceful standing arctic fox with broad white ruff and huge curved icy fluffy tail",
  ],
  creature_world_3_0: [
    "pink round mochi blob with rosy cheeks",
    "taller mochi body with two short soft arms and two feet",
    "tall pear-shaped mochi with broad rounded arms, soft scalloped mochi collar and distinct feet",
  ],
  creature_world_3_1: [
    "pink cupcake spirit with cream swirl and red cherry",
    "taller fluted cupcake body and two soft arms, growing cream swirl",
    "tall rounded fluted cake body, long soft arms, three-tier flowing cream swirl, single red cherry unchanged",
  ],
  creature_world_3_2: [
    "brown chocolate teardrop creature with white sprinkles",
    "longer rounded body and larger feet, one curled chocolate tip",
    "tall friendly chocolate drop with curled top, broad soft arms and ribbon-like chocolate tail, white sprinkles unchanged",
  ],
  creature_world_3_3: [
    "pink cotton-candy sheep with pastel candy tail",
    "longer legs and a puffier rounded fleece",
    "standing graceful pink sheep with large cloud fleece, soft curled ears and long candy-cloud tail",
  ],
  creature_world_3_4: [
    "caramel gingerbread teddy with cream icing and spiral belly",
    "longer arms and legs, wider round ears",
    "tall soft gingerbread bear, broad rounded paws and scalloped icing shoulder details, spiral belly unchanged",
  ],
  creature_world_3_5: [
    "pink translucent candy axolotl blob with mint patch and candy side gills",
    "longer axolotl body with four little feet and small curled tail",
    "long smiling axolotl, four legs, large curled tail and broad soft candy gills, mint forehead patch unchanged",
  ],
  creature_world_4_0: [
    "sage green forest fox with cream chest and small flowers beside ear",
    "longer legs, larger tail and growing neck fluff",
    "tall seated mature green fox with a LONG upright neck, huge fluffy cream chest ruff, large front paws and an enormous curled tail wrapping around its body then sweeping upwards, same small ear flowers",
  ],
  creature_world_4_1: [
    "light green round frog wearing a broad leaf as a hat",
    "longer frog body with folded hind legs and larger leaf",
    "tall sitting friendly frog, broad folded legs and wide leaf hat with curled tip",
  ],
  creature_world_4_2: [
    "sage green long-eared rabbit holding a clover",
    "standing tall rabbit, two upright ears AND the same two long leaf-shaped side flaps beside its cheeks as the baby, longer legs and fluffy chest",
    "standing tall soft rabbit, long draping ears, fluffy chest and large hind feet, same clover in paws",
  ],
  creature_world_4_3: [
    "green firefly with golden glowing belly and pale dotted wings",
    "longer segmented golden belly, larger side wings",
    "long graceful firefly with broad translucent rounded wings and three glowing belly segments, curved antennae",
  ],
  creature_world_4_4: [
    "round green leafy hedgehog with an acorn by its ear",
    "longer body, four visible paws and larger leaf spikes",
    "standing elongated friendly hedgehog with a lush layered leaf mantle, four paws, same acorn beside ear",
  ],
  creature_world_5_0: [
    "soft blue five-pointed starfish",
    "longer rounded star arms, small rounded feet",
    "large graceful five-pointed starfish with elongated curving arms and scalloped arm edges, same simple face",
  ],
  creature_world_5_1: [
    "blue crab with striped cyan claws and floating bubbles",
    "wider shell, longer articulated rounded claws and legs",
    "broad friendly blue crab with large raised striped claws, four long curved walking legs, soft scalloped shell",
  ],
  creature_world_5_2: [
    "lavender blue whale with cream belly and diamond-shaped water spout",
    "substantially elongated whale body, very long flippers held out to the sides, lifted heart-shaped tail, keep the HEART-shaped water spout",
    "long slender graceful whale body three times as long as tall, very broad sweeping flippers and huge curved forked tail, keep the HEART-shaped water spout from the baby",
  ],
  creature_world_5_3: [
    "round blue pufferfish with pink cheeks and a yellow forehead star",
    "long oval body, two large flowing side fins extended outwards and a tall dorsal fin, same yellow forehead star",
    "long rounded fish body, HUGE sweeping fan-shaped tail taking a third of silhouette width, broad scalloped side fins and soft tiny spikes, same yellow forehead star",
  ],
  creature_world_5_4: [
    "cyan translucent jellyfish with a glossy rounded bell",
    "taller bell and longer separate tentacles",
    "broad scalloped cyan bell and long flowing rounded tentacles of different lengths, same friendly eyes",
  ],
  creature_world_5_5: [
    "pale lavender seahorse with pastel segmented belly and spiral tail",
    "long upright seahorse neck twice as long as baby, open extended spiral tail with a large empty loop, large translucent fan-shaped side fins",
    "very tall graceful seahorse, extremely long double-curled tail occupying half the height, wide flowing scalloped dorsal and side fins, same pastel segmented belly",
  ],
  creature_world_5_6: [
    "blue clam creature with pink pearl and pink lips",
    "taller scalloped shell and two small soft side fins",
    "broad open scalloped shell with a tall fan-shaped upper half and wide soft lower lip, same round pink pearl",
  ],
  legendary_world_0: [
    "blue lavender cosmic whale with tiny golden crown and starry body",
    "long crescent-shaped cosmic whale swimming UPWARDS, head at the top, large two side flippers extended, tail curled underneath to the right, same golden crown and star-speckled lavender skin",
    "very long slender majestic cosmic whale with a clearly elongated body three times longer than its head, very broad flowing flippers and huge raised forked tail, same tiny gold crown and starry lavender skin",
  ],
  legendary_world_1: [
    "pink lavender serpentine dragon with gold crown and cream feathered wings",
    "longer curled body, larger wings and small rounded forepaws",
    "long elegantly coiled friendly dragon with large spread cream wings and flowing tail, same gold crown",
  ],
  legendary_world_2: [
    "blue ice lion with huge fluffy white mane and crystal crown",
    "longer body and legs, fuller mane and little curled tail",
    "standing majestic friendly ice lion with four large paws, flowing white mane and long tail, same crystal crown",
  ],
  legendary_world_3: [
    "caramel kitten with golden crown and pink cream angel wings",
    "longer body and paws, wider cream wings and curled tail",
    "standing graceful caramel cat with large spread cream wings, fluffy chest and long curved tail, same gold crown",
  ],
  legendary_world_4: [
    "green forest spirit with yellow flowers crowning its round leafy body",
    "taller body, two branch-soft arms and leaf feet",
    "tall friendly leafy spirit with broad branch-soft arms, layered leaf mantle and root-shaped rounded feet, flower crown unchanged",
  ],
  legendary_world_5: [
    "blue pastel ocean dragon with pearl crown and pink fins",
    "longer body and curled tail, larger fins and two small forepaws",
    "long coiled friendly sea dragon with broad flowing pink fins, long curved tail, pearl crown and cream belly unchanged",
  ],
};

async function main() {
  mkdirSync(root, { recursive: true });
  mkdirSync(rawRoot, { recursive: true });
  const db = new Database("data/multiplyz.sqlite", { readonly: true, fileMustExist: true });
  const rows = db
    .prepare("SELECT id, species_key species, art_ref artRef FROM characters ORDER BY id")
    .all() as { id: string; species: string; artRef: string }[];
  db.close();
  const prompts = rows.flatMap((row) => {
    if (!isRenderableAssetRef(row.artRef)) throw new Error(`Invalid base ref: ${row.id}`);
    const direction = directions[row.species];
    if (!direction) throw new Error(`Review growth direction for ${row.species} first`);
    const source = readFileSync(`public/generated/${row.artRef}`);
    return ([2, 3] as const).map((stage) => ({
      characterId: row.id,
      species: row.species,
      baseArtRef: row.artRef,
      baseSha256: sha(source),
      stage,
      file: `${row.species}-${stage === 2 ? "ado" : "adulte"}.png`,
      prompt: `${CONFIG_DEFAULTS.worldgen.prompts.style}.\nUse case: identity-preserving collectible creature growth. Image 1 is the EXACT EXISTING BABY and identity reference. \nCreate ONE ${stage === 2 ? "ADOLESCENT" : "ADULT"} stage of this same companion: ${direction[0]}. New silhouette: ${direction[stage - 1]}. This must be a genuinely newly drawn older anatomy and pose, not a scaled or recolored copy. ${stage === 2 ? "Draw a NEW ADOLESCENT in a lively three-quarter pose facing gently RIGHT, with a significantly longer torso and visibly enlarged appendages. About 2.5 heads tall. Show a clear new anatomy and silhouette, not a near-copy of the reference pose." : "Draw a NEW ADULT in three-quarter view facing gently to the left: body substantially taller/longer with visibly developed broad appendages, a new standing or swimming pose. Adult proportions about three heads tall, not the baby two-head proportions. New pose and outline are ESSENTIAL. Still cute and approachable, no muscles or battle armor."}\nIdentity invariants: same species, exact body colors and markings, eye color, defining motifs, same number of eyes. Keep distinctive features from image 1 even if text differs. Do not invent unrelated accessories or a new creature. Full body, centered, one creature only, square 1024px composition, 10% clean margin around the entire silhouette. Solid perfectly flat saturated magenta background (#FF00FF) for clean cutout, absolutely no white background and no glow outside the creature; no floor shadow, no particles outside the silhouette, no text or stage labels. ${CONFIG_DEFAULTS.worldgen.prompts.negative}.`,
    }));
  });
  writeFileSync(`${root}/prompts.json`, JSON.stringify(prompts, null, 2) + "\n");
  console.log(`Prepared ${prompts.length} prompts. Catalogue read only.`);
  if (!process.argv.includes("--generate")) return;
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required in local environment");
  const selected = process.argv.find((a) => a.startsWith("--species="))?.split("=")[1];
  const species = rows.map((r) => r.species).filter((s) => !selected || s === selected);
  let cursor = 0;
  async function worker() {
    while (cursor < species.length) {
      const current = species[cursor++];
      for (const job of prompts.filter((p) => p.species === current)) {
        if (existsSync(`${root}/${job.file}`)) {
          console.log(`Retained ${job.file}`);
          continue;
        }
        const refs = [
          {
            data: await sharp(readFileSync(`public/generated/${job.baseArtRef}`))
              .flatten({ background: "#ffffff" })
              .png()
              .toBuffer(),
            mimeType: "image/png",
          },
        ];
        const rawFile = `${rawRoot}/${job.file}`;
        let bytes: Buffer;
        if (existsSync(rawFile)) bytes = readFileSync(rawFile);
        else {
          console.log(`Generating ${job.file}`);
          bytes = await generateImage(
            { prompt: job.prompt, refImages: refs },
            {
              fetchImpl: (url, init) =>
                fetch(url, { ...init, signal: AbortSignal.timeout(180000) }),
            },
          );
          writeFileSync(rawFile, bytes);
        }
        const { data, info } = await sharp(bytes)
          .flatten({ background: "#ffffff" })
          .resize(768, 768, { fit: "contain", background: "#ffffff" })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const rgba = floodFillTransparency({
          data,
          width: info.width,
          height: info.height,
          channels: info.channels,
          fuzz: 38,
        });
        await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
          .png()
          .toFile(`${root}/${job.file}`);
        console.log(`Saved ${job.file}`);
      }
    }
  }
  await Promise.all([worker(), worker(), worker()]);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Generation failed");
  process.exitCode = 1;
});
