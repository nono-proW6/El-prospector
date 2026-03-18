import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";

const supabase = createClient(
  "https://fimedehqtcpijcfjunlh.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbWVkZWhxdGNwaWpjZmp1bmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Njk5NTAsImV4cCI6MjA4ODI0NTk1MH0.SXWsWNHDJj0kT23-W_Msq3y2_M0sI7vvU4AWqfvvPIc"
);

// ============================================================
// CONFIG (meme logique que generate-grid.ts)
// ============================================================

const CSV_PATH = "../communes-france-2025.csv";
const FRANCE_SW_LAT = 41.3, FRANCE_SW_LNG = -5.3, FRANCE_NE_LAT = 51.2, FRANCE_NE_LNG = 9.7;
const CELL_LAT = 0.09, CELL_LNG = 0.133;

const SUBDIVISION_BY_INSEE: Record<number, number> = {
  1: 10, 2: 3, 3: 2, 4: 1, 5: 1, 6: 1, 7: 1,
};

function classifyDensity(code: number): "dense" | "intermediate" | "rural" {
  if (code <= 2) return "dense";
  if (code <= 4) return "intermediate";
  return "rural";
}

const PRIORITY_ZONES = [
  { lat: 44.837, lng: -0.5792, radius: 0.25, priority: 1 },
  { lat: 48.8566, lng: 2.3522, radius: 0.3, priority: 2 },
  { lat: 45.764, lng: 4.8357, radius: 0.2, priority: 2 },
  { lat: 43.2965, lng: 5.3698, radius: 0.2, priority: 2 },
  { lat: 43.6047, lng: 1.4442, radius: 0.2, priority: 2 },
  { lat: 43.7102, lng: 7.262, radius: 0.15, priority: 2 },
  { lat: 47.2184, lng: -1.5536, radius: 0.2, priority: 2 },
  { lat: 50.6292, lng: 3.0573, radius: 0.2, priority: 2 },
  { lat: 48.5734, lng: 7.7521, radius: 0.15, priority: 2 },
  { lat: 43.6108, lng: 3.8767, radius: 0.15, priority: 2 },
  { lat: 48.1173, lng: -1.6778, radius: 0.15, priority: 2 },
];

function getPriority(lat: number, lng: number, density: string): number {
  for (const z of PRIORITY_ZONES) {
    if (Math.abs(lat - z.lat) <= z.radius && Math.abs(lng - z.lng) <= z.radius) return z.priority;
  }
  return (density === "dense" || density === "intermediate") ? 3 : 4;
}

// ============================================================
// GENERATE ZONES
// ============================================================

console.log("Lecture du CSV...");
const csv = readFileSync(CSV_PATH, "utf-8");
const records = parse(csv, { columns: true, skip_empty_lines: true });

const cellMap = new Map<string, { row: number; col: number; bestInsee: number }>();

for (const r of records) {
  const lat = parseFloat(r.latitude_centre);
  const lng = parseFloat(r.longitude_centre);
  const g = parseInt(r.grille_densite);
  if (isNaN(lat) || isNaN(lng) || lat < FRANCE_SW_LAT || lat > FRANCE_NE_LAT || lng < FRANCE_SW_LNG || lng > FRANCE_NE_LNG) continue;
  const row = Math.floor((lat - FRANCE_SW_LAT) / CELL_LAT);
  const col = Math.floor((lng - FRANCE_SW_LNG) / CELL_LNG);
  const key = `${row}_${col}`;
  if (!cellMap.has(key)) cellMap.set(key, { row, col, bestInsee: 7 });
  const cell = cellMap.get(key)!;
  const code = isNaN(g) ? 7 : g;
  if (code < cell.bestInsee) cell.bestInsee = code;
}

const zones: {
  sw_lat: number; sw_lng: number; ne_lat: number; ne_lng: number;
  density_type: string; priority: number; status: string;
}[] = [];

for (const cell of cellMap.values()) {
  const divisor = SUBDIVISION_BY_INSEE[cell.bestInsee];
  const swLat = FRANCE_SW_LAT + cell.row * CELL_LAT;
  const swLng = FRANCE_SW_LNG + cell.col * CELL_LNG;
  const subLatStep = CELL_LAT / divisor;
  const subLngStep = CELL_LNG / divisor;
  const density = classifyDensity(cell.bestInsee);

  for (let i = 0; i < divisor; i++) {
    for (let j = 0; j < divisor; j++) {
      const zSwLat = Math.round((swLat + i * subLatStep) * 1e6) / 1e6;
      const zSwLng = Math.round((swLng + j * subLngStep) * 1e6) / 1e6;
      const zNeLat = Math.round((swLat + (i + 1) * subLatStep) * 1e6) / 1e6;
      const zNeLng = Math.round((swLng + (j + 1) * subLngStep) * 1e6) / 1e6;
      const centerLat = (zSwLat + zNeLat) / 2;
      const centerLng = (zSwLng + zNeLng) / 2;

      zones.push({
        sw_lat: zSwLat, sw_lng: zSwLng, ne_lat: zNeLat, ne_lng: zNeLng,
        density_type: density,
        priority: getPriority(centerLat, centerLng, density),
        status: "pending",
      });
    }
  }
}

console.log(`${zones.length} zones generees. Insertion en base...`);

// ============================================================
// INSERT IN BATCHES
// ============================================================

async function insertAll() {
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < zones.length; i += BATCH_SIZE) {
    const batch = zones.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("scan_zones").insert(batch);

    if (error) {
      console.error(`Erreur batch ${i / BATCH_SIZE}:`, error.message);
      process.exit(1);
    }

    inserted += batch.length;
    const pct = ((inserted / zones.length) * 100).toFixed(1);
    process.stdout.write(`\r  Insere: ${inserted}/${zones.length} (${pct}%)`);
  }

  console.log("\n\nVerification...");
  const { count } = await supabase.from("scan_zones").select("*", { count: "exact", head: true });
  console.log(`Total en base: ${count} zones`);
  console.log("Done!");
}

insertAll();
