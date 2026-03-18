import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";

// ============================================================
// CONFIG
// ============================================================

const CSV_PATH = "../communes-france-2025.csv";

// Bounding box France metropolitaine (avec marge)
const FRANCE_SW_LAT = 41.3;
const FRANCE_SW_LNG = -5.3;
const FRANCE_NE_LAT = 51.2;
const FRANCE_NE_LNG = 9.7;

// Taille d'une cellule de base en degres (~10km)
// 1 degre latitude ~ 111km, donc 10km ~ 0.09 degres
// 1 degre longitude ~ 75km (a 46°N), donc 10km ~ 0.133 degres
const CELL_LAT = 0.09;
const CELL_LNG = 0.133;

// Subdivision par densite INSEE (7 niveaux)
// Diviseur = combien de sous-zones par axe dans une case 10km
// Ex: divisor 10 → 10x10 = 100 sous-zones de 1km
const SUBDIVISION_BY_INSEE: Record<number, { divisor: number; label: string }> = {
  1: { divisor: 10, label: "1km x 1km" },    // Grands centres urbains
  2: { divisor: 3, label: "3.3km x 3.3km" }, // Centres urbains intermediaires
  3: { divisor: 2, label: "5km x 5km" },     // Ceintures urbaines
  4: { divisor: 1, label: "10km (7km~)" },    // Petites villes - pas subdivisable en 7km propre
  5: { divisor: 1, label: "10km x 10km" },    // Bourgs ruraux
  6: { divisor: 1, label: "10km x 10km" },    // Rural a habitat disperse
  7: { divisor: 1, label: "10km x 10km" },    // Rural tres peu dense
};

// Mapping INSEE vers nos 3 categories (pour la table scan_zones.density_type)
function classifyDensity(inseeCode: number): "dense" | "intermediate" | "rural" {
  if (inseeCode <= 2) return "dense";
  if (inseeCode <= 4) return "intermediate";
  return "rural";
}

// Priorites geographiques (centres approximatifs + rayon en degres)
const PRIORITY_ZONES: { name: string; lat: number; lng: number; radius: number; priority: number }[] = [
  // Priorite 1 : Bordeaux
  { name: "Bordeaux", lat: 44.837, lng: -0.5792, radius: 0.25, priority: 1 },
  // Priorite 2 : Grandes villes
  { name: "Paris", lat: 48.8566, lng: 2.3522, radius: 0.3, priority: 2 },
  { name: "Lyon", lat: 45.764, lng: 4.8357, radius: 0.2, priority: 2 },
  { name: "Marseille", lat: 43.2965, lng: 5.3698, radius: 0.2, priority: 2 },
  { name: "Toulouse", lat: 43.6047, lng: 1.4442, radius: 0.2, priority: 2 },
  { name: "Nice", lat: 43.7102, lng: 7.262, radius: 0.15, priority: 2 },
  { name: "Nantes", lat: 47.2184, lng: -1.5536, radius: 0.2, priority: 2 },
  { name: "Lille", lat: 50.6292, lng: 3.0573, radius: 0.2, priority: 2 },
  { name: "Strasbourg", lat: 48.5734, lng: 7.7521, radius: 0.15, priority: 2 },
  { name: "Montpellier", lat: 43.6108, lng: 3.8767, radius: 0.15, priority: 2 },
  { name: "Rennes", lat: 48.1173, lng: -1.6778, radius: 0.15, priority: 2 },
  // Priorite 3 : Villes intermediaires (tout ce qui est dense/intermediate et pas dans les zones ci-dessus)
];

// ============================================================
// TYPES
// ============================================================

interface Commune {
  code_insee: string;
  nom: string;
  lat: number;
  lng: number;
  grille_densite: number;
  dep_code: string;
}

interface GridCell {
  row: number;
  col: number;
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
  density: "dense" | "intermediate" | "rural";
  bestInsee: number; // meilleur (plus bas) code INSEE dans la case
  communes: string[];
}

interface ScanZone {
  sw_lat: number;
  sw_lng: number;
  ne_lat: number;
  ne_lng: number;
  density_type: "dense" | "intermediate" | "rural";
  priority: number;
  parent_row?: number;
  parent_col?: number;
}

// ============================================================
// STEP 1 : Lire le CSV
// ============================================================

console.log("=== GENERATION DE LA GRILLE FRANCE ===\n");
console.log("1. Lecture du fichier INSEE...");

const csvContent = readFileSync(CSV_PATH, "utf-8");
const records = parse(csvContent, {
  columns: true,
  skip_empty_lines: true,
  delimiter: ",",
});

const communes: Commune[] = [];
let skippedNoCoords = 0;
let skippedOutsideFrance = 0;

for (const record of records) {
  const lat = parseFloat(record.latitude_centre);
  const lng = parseFloat(record.longitude_centre);
  const grille = parseInt(record.grille_densite);

  if (isNaN(lat) || isNaN(lng)) {
    skippedNoCoords++;
    continue;
  }

  // Filtrer les communes hors France metropolitaine (DOM-TOM)
  if (lat < FRANCE_SW_LAT || lat > FRANCE_NE_LAT || lng < FRANCE_SW_LNG || lng > FRANCE_NE_LNG) {
    skippedOutsideFrance++;
    continue;
  }

  communes.push({
    code_insee: record.code_insee,
    nom: record.nom_standard,
    lat,
    lng,
    grille_densite: isNaN(grille) ? 7 : grille,
    dep_code: record.dep_code,
  });
}

console.log(`   Communes lues : ${records.length}`);
console.log(`   Communes France metro : ${communes.length}`);
console.log(`   Skippees (pas de coords) : ${skippedNoCoords}`);
console.log(`   Skippees (hors metro / DOM-TOM) : ${skippedOutsideFrance}`);

// ============================================================
// STEP 2 : Generer la grille 10km
// ============================================================

console.log("\n2. Generation de la grille 10km...");

const numRows = Math.ceil((FRANCE_NE_LAT - FRANCE_SW_LAT) / CELL_LAT);
const numCols = Math.ceil((FRANCE_NE_LNG - FRANCE_SW_LNG) / CELL_LNG);
console.log(`   Grille : ${numRows} lignes x ${numCols} colonnes = ${numRows * numCols} cases potentielles`);

// Placer chaque commune dans sa case
const cellMap = new Map<string, GridCell>();

for (const commune of communes) {
  const row = Math.floor((commune.lat - FRANCE_SW_LAT) / CELL_LAT);
  const col = Math.floor((commune.lng - FRANCE_SW_LNG) / CELL_LNG);
  const key = `${row}_${col}`;

  if (!cellMap.has(key)) {
    cellMap.set(key, {
      row,
      col,
      sw_lat: FRANCE_SW_LAT + row * CELL_LAT,
      sw_lng: FRANCE_SW_LNG + col * CELL_LNG,
      ne_lat: FRANCE_SW_LAT + (row + 1) * CELL_LAT,
      ne_lng: FRANCE_SW_LNG + (col + 1) * CELL_LNG,
      density: "rural",
      bestInsee: 7,
      communes: [],
    });
  }

  const cell = cellMap.get(key)!;
  cell.communes.push(commune.nom);

  // Le code INSEE le plus bas (= plus dense) l'emporte
  if (commune.grille_densite < cell.bestInsee) {
    cell.bestInsee = commune.grille_densite;
  }
  cell.density = classifyDensity(cell.bestInsee);
}

const totalCells = cellMap.size;
const emptyCells = numRows * numCols - totalCells;

const densityCounts = { dense: 0, intermediate: 0, rural: 0 };
for (const cell of cellMap.values()) {
  densityCounts[cell.density]++;
}

console.log(`   Cases avec communes : ${totalCells}`);
console.log(`   Cases vides (ocean/etranger) : ${emptyCells} (skippees)`);
console.log(`   Dense : ${densityCounts.dense} cases`);
console.log(`   Intermediaire : ${densityCounts.intermediate} cases`);
console.log(`   Rural : ${densityCounts.rural} cases`);

// ============================================================
// STEP 3 : Subdiviser et generer les scan_zones
// ============================================================

console.log("\n3. Subdivision des cases...");

function getPriority(lat: number, lng: number, density: string): number {
  for (const zone of PRIORITY_ZONES) {
    const distLat = Math.abs(lat - zone.lat);
    const distLng = Math.abs(lng - zone.lng);
    if (distLat <= zone.radius && distLng <= zone.radius) {
      return zone.priority;
    }
  }
  // Default : priorite 3 pour dense/intermediate, 4 pour rural
  if (density === "dense" || density === "intermediate") return 3;
  return 4;
}

const scanZones: ScanZone[] = [];

for (const cell of cellMap.values()) {
  const sub = SUBDIVISION_BY_INSEE[cell.bestInsee];
  const subLatStep = (cell.ne_lat - cell.sw_lat) / sub.divisor;
  const subLngStep = (cell.ne_lng - cell.sw_lng) / sub.divisor;

  for (let i = 0; i < sub.divisor; i++) {
    for (let j = 0; j < sub.divisor; j++) {
      const sw_lat = cell.sw_lat + i * subLatStep;
      const sw_lng = cell.sw_lng + j * subLngStep;
      const ne_lat = sw_lat + subLatStep;
      const ne_lng = sw_lng + subLngStep;

      const centerLat = (sw_lat + ne_lat) / 2;
      const centerLng = (sw_lng + ne_lng) / 2;

      scanZones.push({
        sw_lat: Math.round(sw_lat * 1e6) / 1e6,
        sw_lng: Math.round(sw_lng * 1e6) / 1e6,
        ne_lat: Math.round(ne_lat * 1e6) / 1e6,
        ne_lng: Math.round(ne_lng * 1e6) / 1e6,
        density_type: cell.density,
        priority: getPriority(centerLat, centerLng, cell.density),
        parent_row: cell.row,
        parent_col: cell.col,
      });
    }
  }
}

// Stats par densite apres subdivision
const zonesByDensity = { dense: 0, intermediate: 0, rural: 0 };
const zonesByPriority: Record<number, number> = {};

for (const zone of scanZones) {
  zonesByDensity[zone.density_type]++;
  zonesByPriority[zone.priority] = (zonesByPriority[zone.priority] || 0) + 1;
}

// Stats par code INSEE
const cellsByInsee: Record<number, number> = {};
for (const cell of cellMap.values()) {
  cellsByInsee[cell.bestInsee] = (cellsByInsee[cell.bestInsee] || 0) + 1;
}
const inseeLabels: Record<number, string> = {
  1: "Grands centres (1km)",
  2: "Centres intermediaires (3.3km)",
  3: "Ceintures urbaines (5km)",
  4: "Petites villes (10km)",
  5: "Bourgs ruraux (10km)",
  6: "Rural disperse (10km)",
  7: "Rural tres peu dense (10km)",
};
for (const [code, count] of Object.entries(cellsByInsee).sort()) {
  const div = SUBDIVISION_BY_INSEE[Number(code)].divisor;
  console.log(`   INSEE ${code} - ${inseeLabels[Number(code)]} : ${count} cases x ${div}x${div} = ${count * div * div} zones`);
}
console.log(`   TOTAL : ${scanZones.length} scan_zones`);

console.log("\n4. Repartition par priorite :");
for (const [prio, count] of Object.entries(zonesByPriority).sort()) {
  const label =
    prio === "1" ? "Bordeaux" :
    prio === "2" ? "Grandes villes" :
    prio === "3" ? "Villes intermediaires" :
    "Rural";
  console.log(`   Priorite ${prio} (${label}) : ${count} zones`);
}

// ============================================================
// STEP 4 : Verifications
// ============================================================

console.log("\n5. Verifications...");

let errors = 0;

// Check 1 : Toutes les zones sont dans la bounding box France
const outOfBounds = scanZones.filter(
  (z) => z.sw_lat < FRANCE_SW_LAT - 0.01 || z.ne_lat > FRANCE_NE_LAT + 0.01 ||
         z.sw_lng < FRANCE_SW_LNG - 0.01 || z.ne_lng > FRANCE_NE_LNG + 0.01
);
if (outOfBounds.length > 0) {
  console.log(`   ERREUR : ${outOfBounds.length} zones hors bounding box France`);
  errors++;
} else {
  console.log("   OK : Toutes les zones sont dans la bounding box France");
}

// Check 2 : Aucune zone avec des dimensions negatives ou nulles
const invalidDims = scanZones.filter((z) => z.ne_lat <= z.sw_lat || z.ne_lng <= z.sw_lng);
if (invalidDims.length > 0) {
  console.log(`   ERREUR : ${invalidDims.length} zones avec dimensions invalides`);
  errors++;
} else {
  console.log("   OK : Toutes les zones ont des dimensions valides");
}

// Check 3 : Fourchette attendue
if (scanZones.length < 5000 || scanZones.length > 500000) {
  console.log(`   ATTENTION : ${scanZones.length} zones — hors fourchette attendue (5k-500k)`);
  errors++;
} else {
  console.log(`   OK : ${scanZones.length} zones dans la fourchette attendue`);
}

// Check 4 : Pas de zones dans l'ocean (spot check sur des points connus en mer)
const oceanPoints = [
  { name: "Atlantique ouest Bretagne", lat: 47.5, lng: -4.5 },
  { name: "Mediterranee sud", lat: 41.5, lng: 5.0 },
  { name: "Manche", lat: 50.5, lng: -1.0 },
];
for (const point of oceanPoints) {
  const zonesAtPoint = scanZones.filter(
    (z) => z.sw_lat <= point.lat && z.ne_lat >= point.lat && z.sw_lng <= point.lng && z.ne_lng >= point.lng
  );
  if (zonesAtPoint.length > 0) {
    console.log(`   ATTENTION : ${zonesAtPoint.length} zones trouvees a ${point.name} (devrait etre 0 si ocean pur)`);
  } else {
    console.log(`   OK : Pas de zone a ${point.name}`);
  }
}

// Check 5 : Bordeaux a bien des zones priorite 1
const bordeauxZones = scanZones.filter((z) => z.priority === 1);
if (bordeauxZones.length === 0) {
  console.log("   ERREUR : Aucune zone priorite 1 (Bordeaux)");
  errors++;
} else {
  console.log(`   OK : ${bordeauxZones.length} zones priorite 1 (Bordeaux)`);
}

if (errors > 0) {
  console.log(`\n ERREURS DETECTEES : ${errors}. Ne pas inserer en base.`);
} else {
  console.log("\n TOUTES LES VERIFICATIONS OK");
}

// ============================================================
// STEP 5 : Export GeoJSON pour verification visuelle
// ============================================================

console.log("\n6. Export GeoJSON pour verification visuelle...");

// Exporter un echantillon : zones priorite 1 (Bordeaux) + quelques zones de chaque type
function exportGeoJSON(zones: ScanZone[], filename: string) {
  const features = zones.map((z) => ({
    type: "Feature" as const,
    properties: {
      density: z.density_type,
      priority: z.priority,
    },
    geometry: {
      type: "Polygon" as const,
      coordinates: [[
        [z.sw_lng, z.sw_lat],
        [z.ne_lng, z.sw_lat],
        [z.ne_lng, z.ne_lat],
        [z.sw_lng, z.ne_lat],
        [z.sw_lng, z.sw_lat],
      ]],
    },
  }));

  const geojson = {
    type: "FeatureCollection",
    features,
  };

  writeFileSync(filename, JSON.stringify(geojson, null, 2));
  console.log(`   Exporte : ${filename} (${features.length} zones)`);
}

// Bordeaux (priorite 1)
exportGeoJSON(
  scanZones.filter((z) => z.priority === 1),
  "grid-bordeaux.geojson"
);

// Paris (priorite 2, centre)
exportGeoJSON(
  scanZones.filter((z) => {
    const centerLat = (z.sw_lat + z.ne_lat) / 2;
    const centerLng = (z.sw_lng + z.ne_lng) / 2;
    return Math.abs(centerLat - 48.8566) < 0.15 && Math.abs(centerLng - 2.3522) < 0.15;
  }),
  "grid-paris.geojson"
);

// Grille complete 10km (avant subdivision) pour vue d'ensemble
const gridCells10km: ScanZone[] = [];
for (const cell of cellMap.values()) {
  gridCells10km.push({
    sw_lat: Math.round(cell.sw_lat * 1e6) / 1e6,
    sw_lng: Math.round(cell.sw_lng * 1e6) / 1e6,
    ne_lat: Math.round(cell.ne_lat * 1e6) / 1e6,
    ne_lng: Math.round(cell.ne_lng * 1e6) / 1e6,
    density_type: cell.density,
    priority: 0,
  });
}
exportGeoJSON(gridCells10km, "grid-france-10km.geojson");

console.log("\n   Tu peux visualiser ces fichiers sur https://geojson.io");
console.log("\n=== DRY RUN TERMINE ===");
console.log(`\nPour inserer en base, relance avec : npx tsx generate-grid.ts --insert`);
