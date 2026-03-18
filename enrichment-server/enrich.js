import { query } from "@anthropic-ai/claude-agent-sdk";
import { createClient } from "@supabase/supabase-js";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const LOCK_FILE = "/tmp/enrichment.lock";
const MAX_PER_RUN = 5;

const PROMPT = `Tu recherches les informations de contact d'une agence immobilière française. Le but est de la contacter en se faisant passer pour un prospect dans un premier temps.

AGENCE : {name} - {city}
Site web : {website}
Téléphone : {phone}

D'abord, est-ce réellement une agence immobilière qui fait de la transaction ? Si c'est clairement autre chose (diagnostiqueur, notaire, courtier en prêt, constructeur, etc.), mets valid_agency=false. En cas de doute, garde-la.

Si c'est une vraie agence, recherche :
1. L'email de contact de CETTE agence locale (pas l'email générique du réseau national si c'est une franchise)
2. Le nom du gérant/directeur de CETTE agence locale (pas le PDG du réseau national). Vérifie sur societe.com ou pappers.fr.
3. Le LinkedIn du gérant
4. Franchise ou indépendant ?
5. SIRET
6. Score commercial (1-5) : quelle chance de closer cette agence sur une assistante commerciale IA 24/7 qui répond aux prospects acheteurs/vendeurs, collecte et analyse les dossiers, propose les créneaux de visite optimisés et gère l'agenda ? C'est nouveau en France, personne n'est équipé. Score 5 = cible idéale (petite équipe débordée, beaucoup d'annonces, indépendant qui fait tout seul). Score 1 = sera dur à convaincre (réseau très hiérarchisé où le directeur local ne décide pas seul). Une phrase de raison.
7. Brief commercial (1-2 phrases) : un conseil concret pour approcher cette agence et vendre le produit.

Ne cherche rien d'autre. Ne renvoie QUE des infos trouvées et vérifiées. Si pas trouvé = "NON_TROUVE".

JSON valide sans markdown :
{"valid_agency":true/false,"reject_reason":"","email":"...","owner_name":"...","linkedin":"...","is_franchise":true/false,"siret":"...","confidence":"high/medium/low","score":3,"score_reason":"...","sales_brief":"...","notes":"..."}`;

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    console.log("[SKIP] Another enrichment is running");
    process.exit(0);
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(0); });
process.on("SIGTERM", () => { releaseLock(); process.exit(0); });

async function getConfig() {
  const { data, error } = await supabase.rpc("get_enrich_config");
  if (error) throw error;
  return data;
}

async function getEnrichedToday() {
  const today = new Date().toISOString().split("T")[0];
  const { count } = await supabase
    .from("agencies")
    .select("id", { count: "exact", head: true })
    .in("enrichment_status", ["done", "failed", "skipped"])
    .gte("enriched_at", today);
  return count || 0;
}

async function callClaude(prompt, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let text = "";
      for await (const message of query({
        prompt,
        options: { maxTurns: 15, allowedTools: ["WebSearch", "WebFetch"] }
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
        console.log("[RETRY] Attempt " + attempt + "/" + retries + " failed (529 overloaded), waiting " + delay + "s...");
        await new Promise(r => setTimeout(r, delay * 1000));
        continue;
      }
      throw err;
    }
  }
}

async function enrichAgency(agency) {
  const prompt = PROMPT
    .replace("{name}", agency.name || "")
    .replace("{city}", agency.city || "")
    .replace("{website}", agency.website || "aucun")
    .replace("{phone}", agency.phone || "aucun");

  try {
    const text = await callClaude(prompt);

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const data = JSON.parse(jsonMatch[0]);

    if (data.valid_agency === false) {
      const reason = data.reject_reason || "Pas une agence immobilière";

      await supabase.from("agencies").update({
        enrichment_status: "skipped",
        enrichment_note: "Rejeté: " + reason,
        enriched_at: new Date().toISOString()
      }).eq("id", agency.id);

      return { id: agency.id, name: agency.name, status: "skipped", data };
    }

    const updateFields = {
      enrichment_status: "done",
      enrichment_note: buildNote(data),
      enriched_at: new Date().toISOString()
    };

    if (data.email && data.email !== "NON_TROUVE") updateFields.email = data.email;
    if (data.owner_name && data.owner_name !== "NON_TROUVE") updateFields.owner_name = data.owner_name;
    if (data.linkedin && data.linkedin !== "NON_TROUVE") updateFields.linkedin = data.linkedin;
    if (data.siret && data.siret !== "NON_TROUVE") updateFields.siret = data.siret;
    if (typeof data.is_franchise === "boolean") updateFields.is_franchise = data.is_franchise;
    if (typeof data.score === "number") updateFields.score = data.score;
    if (data.score_reason) updateFields.score_reason = data.score_reason;
    if (data.sales_brief) updateFields.sales_brief = data.sales_brief;

    await supabase.from("agencies").update(updateFields).eq("id", agency.id);

    return { id: agency.id, name: agency.name, status: "done", data };

  } catch (err) {

    console.error("[FAIL]", agency.name, err.message);

    await supabase.from("agencies").update({
      enrichment_status: "failed",
      enrichment_note: err.message,
      enriched_at: new Date().toISOString()
    }).eq("id", agency.id);

    return { id: agency.id, name: agency.name, status: "failed", error: err.message };
  }
}

function buildNote(data) {
  const parts = [];
  if (data.confidence) parts.push("Confiance: " + data.confidence);
  if (data.notes) parts.push(data.notes);
  return parts.join(" | ") || "Enrichi via Claude";
}

export async function enrichBatch(batchSize) {

  const { data: agencies, error } = await supabase
    .from("agencies")
    .select("id, name, city, website, phone, email, owner_name")
    .eq("enrichment_status", "pending")
    .not("website", "is", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  if (!agencies || agencies.length === 0) return { processed: 0, results: [] };

  const results = [];

  for (const agency of agencies) {

    console.log("[ENRICHING]", agency.name, "(" + agency.city + ")...");

    const result = await enrichAgency(agency);

    if (result.status === "skipped") {
      console.log("[SKIPPED]", agency.name, "->", result.data?.reject_reason || "pas une agence");
    } else {
      console.log("[" + result.status.toUpperCase() + "]", agency.name, "-> email:", result.data?.email || "none", "| score:", result.data?.score || "-");
    }

    results.push(result);
  }

  return { processed: results.length, results };
}

async function cronRun() {

  acquireLock();

  try {

    const config = await getConfig();

    if (config.paused) {
      console.log("[PAUSED] Enrichment is paused");
      return;
    }

    const doneToday = await getEnrichedToday();
    const remaining = config.daily_target - doneToday;

    if (remaining <= 0) {
      console.log("[DONE] Daily target reached (" + doneToday + "/" + config.daily_target + ")");
      return;
    }

    const todo = Math.min(remaining, MAX_PER_RUN);

    console.log("[CRON] " + doneToday + "/" + config.daily_target + " today, enriching " + todo + "...");

    const result = await enrichBatch(todo);

    console.log("[CRON] Finished: " + result.processed + " processed");

  } catch (err) {

    console.error("[CRON] Error:", err);

  } finally {

    releaseLock();

  }
}

const args = process.argv.slice(2);

if (args[0] === "cron") {

  cronRun().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });

} else if (args.length > 0 || process.argv[1]?.endsWith("enrich.js")) {

  const batchSize = parseInt(args[0]) || 5;

  console.log("Manual enrichment: " + batchSize + " agencies...");

  enrichBatch(batchSize).then(r => {
    console.log("Done!", r.processed, "processed.");
    process.exit(0);
  }).catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
  });

}
