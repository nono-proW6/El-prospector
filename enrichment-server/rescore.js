import { query } from "@anthropic-ai/claude-agent-sdk";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const RESCORE_PROMPT = `Tu réévalues le score commercial d'une agence immobilière française déjà enrichie. On ajuste le scoring pour mieux cibler les grosses agences indépendantes (les solos convertissent mal en cold call).

AGENCE : {name} - {city}
Site web : {website}
Gérant : {owner_name}
Franchise : {is_franchise}
Note Google : {rating} ({user_ratings_total} avis)

Recherche et renvoie :
1. estimated_team_size (entier) : nombre de négociateurs/agents dans CETTE agence locale. Regarde la page "équipe", "nos agents", "notre équipe" du site web, le LinkedIn de l'agence, les mentions textuelles. Si impossible à estimer avec confiance = null. Ne compte QUE l'effectif local.
2. Nouveau score commercial (1-5) pour une campagne sur assistante IA commerciale 24/7 (réponse prospects, qualification, prise de RDV). Notre cible IDÉALE = agence indépendante structurée, 3-15 négociateurs, ≥30 avis Google, site pro, gérant décideur local.
   - 5 = cible parfaite : indépendante, 3-15 négociateurs, ≥30 avis, site pro, gérant qui décide
   - 4 = bonne cible : indépendante bien structurée, hors fourchette idéale mais volume solide
   - 3 = moyen : trop petite (1-2 négociateurs) OU franchise locale avec marge de décision
   - 2 = faible : solo sans structure, ou franchise encadrée
   - 1 = à éviter : siège de réseau, micro-structure sans moyens
   IMPORTANT : un solo (1-2 agents) ne doit JAMAIS être noté >3, même s'il semble débordé — on veut de la structure et du budget. Une phrase de raison.
3. Brief commercial actualisé (1-2 phrases) : conseil concret d'approche.

JSON valide sans markdown :
{"estimated_team_size":5,"score":4,"score_reason":"...","sales_brief":"..."}`;

async function callClaude(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let text = "";
      for await (const message of query({
        prompt,
        options: { maxTurns: 10, allowedTools: ["WebSearch", "WebFetch"] }
      })) {
        if (message.type === "assistant" && message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === "text") text += block.text;
          }
        }
      }
      return text;
    } catch (err) {
      const isOverloaded = err.message?.includes("529") || err.message?.includes("Overloaded") || err.message?.includes("overloaded");
      if (isOverloaded && attempt < retries) {
        const delay = attempt * 30;
        console.log("[RETRY] Attempt " + attempt + "/" + retries + " (529), waiting " + delay + "s...");
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }
}

async function rescoreAgency(agency) {
  const prompt = RESCORE_PROMPT
    .replace("{name}", agency.name || "")
    .replace("{city}", agency.city || "")
    .replace("{website}", agency.website || "aucun")
    .replace("{owner_name}", agency.owner_name || "inconnu")
    .replace("{is_franchise}", agency.is_franchise ? "oui" : "non")
    .replace("{rating}", agency.rating != null ? String(agency.rating) : "inconnue")
    .replace("{user_ratings_total}", agency.user_ratings_total != null ? String(agency.user_ratings_total) : "0");

  try {
    const text = await callClaude(prompt);
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const data = JSON.parse(jsonMatch[0]);

    const updateFields = {};
    if (typeof data.score === "number") updateFields.score = data.score;
    if (data.score_reason) updateFields.score_reason = data.score_reason;
    if (data.sales_brief) updateFields.sales_brief = data.sales_brief;
    if (typeof data.estimated_team_size === "number") {
      updateFields.estimated_team_size = data.estimated_team_size;
    } else if (data.estimated_team_size === null) {
      updateFields.estimated_team_size = null;
    }

    if (Object.keys(updateFields).length === 0) {
      return { id: agency.id, name: agency.name, status: "noop" };
    }

    await supabase.from("agencies").update(updateFields).eq("id", agency.id);
    return {
      id: agency.id,
      name: agency.name,
      status: "done",
      old_score: agency.score,
      new_score: data.score,
      team_size: data.estimated_team_size,
    };
  } catch (err) {
    console.error("[FAIL]", agency.name, err.message);
    return { id: agency.id, name: agency.name, status: "failed", error: err.message };
  }
}

async function rescoreBatch(limit) {
  // Cible : les 4-5★ actuels (ceux qu'on propose en cold call). On réévalue en priorité ceux
  // avec peu d'avis Google (susceptibles d'être des solos mal notés par l'ancien prompt).
  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name, city, website, owner_name, is_franchise, rating, user_ratings_total, score")
    .eq("enrichment_status", "done")
    .gte("score", 4)
    .is("estimated_team_size", null)
    .order("user_ratings_total", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw error;
  if (!agencies || agencies.length === 0) {
    console.log("[DONE] Aucune agence à re-scorer (toutes ont déjà estimated_team_size)");
    return { processed: 0, results: [] };
  }

  console.log("[RESCORE] " + agencies.length + " agences à traiter...");
  const results = [];

  for (const agency of agencies) {
    console.log("[RESCORING]", agency.name, "(" + agency.city + ", " + (agency.user_ratings_total || 0) + " avis, score actuel " + agency.score + ")...");
    const result = await rescoreAgency(agency);
    if (result.status === "done") {
      const arrow = result.old_score !== result.new_score ? (result.old_score + " → " + result.new_score) : "= " + result.new_score;
      console.log("[OK]", agency.name, "| score " + arrow + " | team " + (result.team_size ?? "?"));
    } else {
      console.log("[" + result.status.toUpperCase() + "]", agency.name, result.error || "");
    }
    results.push(result);
  }

  return { processed: results.length, results };
}

const args = process.argv.slice(2);
const limit = parseInt(args[0]) || 10;

console.log("Rescore batch: " + limit + " agencies...");
rescoreBatch(limit).then(r => {
  const byStatus = r.results.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, {});
  console.log("Done!", r.processed, "processed.", JSON.stringify(byStatus));
  process.exit(0);
}).catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
