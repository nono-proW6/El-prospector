import { query } from "@anthropic-ai/claude-agent-sdk";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PROMPT = `On va contacter cette agence en se faisant passer pour un prospect intéressé par un de leurs biens. Pour ça, essaie de trouver UN bien immobilier actuellement en vente par cette agence en allant directement sur leur site web.

AGENCE : {name} - {city}
Site web : {website}

Prends n'importe quel bien disponible, du moment qu'il est réel et actuellement en ligne. Le listing_url doit être l'URL exacte de la page de l'annonce sur le site de l'agence, pas une page de listing général ou d'accueil — c'est ce qui garantit que le bien existe vraiment.

Si le site bloque l'accès ou si tu ne trouves pas d'annonce précise avec une URL vérifiable, c'est tout à fait normal (beaucoup de sites d'agences ont des protections). Dans ce cas, mets simplement NON_TROUVE pour tous les champs listing, on préfère largement ça plutôt qu'une info approximative ou inventée.

TRÈS IMPORTANT : ta réponse FINALE doit contenir UNIQUEMENT un JSON valide, rien d'autre. Pas de texte, pas d'explication, pas de "Let me try", juste le JSON. Si tu n'as rien trouvé :
{"listing_title":"NON_TROUVE","listing_price":"NON_TROUVE","listing_url":"NON_TROUVE","listing_ref":"NON_TROUVE","listing_type":"NON_TROUVE"}`;

async function callClaude(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let lastText = "";
      for await (const message of query({
        prompt,
        options: { maxTurns: 10, allowedTools: ["WebSearch", "WebFetch"] }
      })) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") {
              // Si ce bloc contient un JSON listing, on le garde
              if (block.text.includes("listing_title")) lastText = block.text;
              // Sinon on garde le dernier bloc de texte
              else lastText = block.text;
            }
          }
        }
      }
      return lastText;
    } catch (err) {
      const isOverloaded = err.message?.includes("529") || err.message?.includes("Overloaded") || err.message?.includes("overloaded");
      if (isOverloaded && attempt < retries) {
        const delay = attempt * 30;
        console.log(`[RETRY] Attempt ${attempt}/${retries} (529), waiting ${delay}s...`);
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }
}

async function updateListing(agency) {
  const prompt = PROMPT
    .replace("{name}", agency.name || "")
    .replace("{city}", agency.city || "")
    .replace("{website}", agency.website || "aucun");

  try {
    const text = await callClaude(prompt);
    const jsonMatch = text.match(/\{[^{}]*"listing_title"[^{}]*\}/) || text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in response: " + text.slice(0, 150));

    const data = JSON.parse(jsonMatch[0]);
    const updates = {};

    if (data.listing_title && data.listing_title !== "NON_TROUVE" && data.listing_url && data.listing_url !== "NON_TROUVE") {
      updates.listing_title = data.listing_title;
      updates.listing_price = data.listing_price !== "NON_TROUVE" ? data.listing_price : null;
      updates.listing_url = data.listing_url;
      updates.listing_ref = data.listing_ref !== "NON_TROUVE" ? data.listing_ref : null;
      updates.listing_type = data.listing_type !== "NON_TROUVE" ? data.listing_type : null;

      await supabase.from("agencies").update(updates).eq("id", agency.id);
      console.log(`[OK] ${agency.name} (${agency.city}) -> ${data.listing_title} - ${data.listing_price}`);
      return "found";
    } else {
      console.log(`[SKIP] ${agency.name} (${agency.city}) -> pas d'annonce trouvée`);
      return "not_found";
    }
  } catch (err) {
    console.error(`[FAIL] ${agency.name} (${agency.city}) -> ${err.message}`);
    return "failed";
  }
}

async function main() {
  const batchSize = parseInt(process.argv[2]) || 0; // 0 = toutes

  // Agences prêtes : enrichies + email + site web + pas de conversation + pas de listing
  const { data: agencies, error } = await supabase.rpc("get_agencies_needing_listing", { p_limit: batchSize || 1000 });

  if (error) { console.error("Query error:", error); process.exit(1); }
  if (!agencies || agencies.length === 0) {
    console.log("Aucune agence prête à mettre à jour.");
    process.exit(0);
  }

  const readyAgencies = agencies;

  console.log(`\n${readyAgencies.length} agences à mettre à jour (listing manquant)\n`);

  let found = 0, notFound = 0, failed = 0;

  for (let i = 0; i < readyAgencies.length; i++) {
    const agency = readyAgencies[i];
    console.log(`[${i + 1}/${readyAgencies.length}] ${agency.name}...`);

    const result = await updateListing(agency);
    if (result === "found") found++;
    else if (result === "not_found") notFound++;
    else failed++;

    // Petite pause entre chaque pour pas surcharger
    if (i < readyAgencies.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n--- RÉSULTAT ---`);
  console.log(`Annonces trouvées : ${found}`);
  console.log(`Pas d'annonce : ${notFound}`);
  console.log(`Échouées : ${failed}`);
  console.log(`Total : ${readyAgencies.length}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
