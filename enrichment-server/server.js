import express from "express";
import dotenv from "dotenv";
import { enrichBatch } from "./enrich.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Claude health check — once per day
let lastClaudeCheck = null;
let claudeStatus = "unknown";

async function checkClaude() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  if (lastClaudeCheck === today) return claudeStatus;

  try {
    for await (const message of query({
      prompt: "Réponds juste OK",
      options: { maxTurns: 1, allowedTools: [] }
    })) {
      if (message.type === "assistant") {
        claudeStatus = "ok";
        lastClaudeCheck = today;
        console.log("[HEALTH] Claude check OK");
        return claudeStatus;
      }
    }
  } catch (err) {
    claudeStatus = "error: " + err.message;
    lastClaudeCheck = today;
    console.error("[HEALTH] Claude check FAILED:", err.message);
  }
  return claudeStatus;
}

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/status", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const [pending, doneToday, failedToday, skippedToday, totalDone, claude] = await Promise.all([
      supabase.from("agencies").select("id", { count: "exact", head: true }).eq("enrichment_status", "pending"),
      supabase.from("agencies").select("id", { count: "exact", head: true }).eq("enrichment_status", "done").gte("enriched_at", today),
      supabase.from("agencies").select("id", { count: "exact", head: true }).eq("enrichment_status", "failed").gte("enriched_at", today),
      supabase.from("agencies").select("id", { count: "exact", head: true }).eq("enrichment_status", "skipped").gte("enriched_at", today),
      supabase.from("agencies").select("id", { count: "exact", head: true }).eq("enrichment_status", "done"),
      checkClaude(),
    ]);
    const config = await supabase.rpc("get_enrich_config");
    res.json({
      status: "ok",
      claude: claude,
      claude_last_check: lastClaudeCheck,
      pending: pending.count || 0,
      today: { done: doneToday.count || 0, failed: failedToday.count || 0, skipped: skippedToday.count || 0 },
      total_done: totalDone.count || 0,
      config: config.data || {},
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
});

app.post("/enrich", async (req, res) => {
  const batchSize = Math.min(req.body.batch_size || 1, 10);
  try {
    console.log("[API] batch_size=" + batchSize);
    const result = await enrichBatch(batchSize);
    res.json(result);
  } catch (err) {
    console.error("[API] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log("Enrichment server on port " + PORT));
