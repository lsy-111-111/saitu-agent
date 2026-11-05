// Auditable semantic briefs for the 100 competition cover illustrations.
// The renderer intentionally reads catalog IDs without executing application
// modules, so generation stays offline and cannot trigger runtime code.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

export const POSTER_GENERATED_AT = "2026-11-04";
export const posterDate = (entry) => entry.generatedAt ?? "2026-08-23";
export const POSTER_GENERATOR = "Codex code-native SVG renderer v2";
export const POSTER_CONTENT_PROVIDER = "Saitu Campus";
export const POSTER_CONTENT_PROPAGATOR = "Saitu Campus";

export function posterContentId(entry) {
  return createHash("sha256")
    .update(`saitu-campus:${entry.id}:${posterDate(entry)}`)
    .digest("hex")
    .slice(0, 32);
}

export function posterAigcMetadata(entry) {
  const contentId = posterContentId(entry);
  return {
    AIGC: {
      Label: "1",
      ContentProducer: POSTER_CONTENT_PROVIDER,
      ProduceID: contentId,
      ReservedCode1: "",
      ContentPropagator: POSTER_CONTENT_PROPAGATOR,
      PropagateID: contentId,
      ReservedCode2: ""
    }
  };
}

async function readCatalogIds(relativePath, declarationName) {
  const filePath = path.resolve(currentDirectory, relativePath);
  const sourceText = await readFile(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ESNext, true);
  let ids;

  function visit(node) {
    let initializer = ts.isVariableDeclaration(node) ? node.initializer : undefined;
    while (
      initializer &&
      (ts.isSatisfiesExpression(initializer) ||
        ts.isAsExpression(initializer) ||
        ts.isTypeAssertionExpression(initializer) ||
        ts.isParenthesizedExpression(initializer))
    ) {
      initializer = initializer.expression;
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === declarationName &&
      initializer &&
      ts.isArrayLiteralExpression(initializer)
    ) {
      ids = initializer.elements.map((element) => {
        if (!ts.isObjectLiteralExpression(element)) {
          throw new Error(`${declarationName} contains a non-object entry`);
        }
        const idProperty = element.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "id"
        );
        if (!idProperty || !ts.isPropertyAssignment(idProperty) || !ts.isStringLiteral(idProperty.initializer)) {
          throw new Error(`${declarationName} contains an entry without a static string id`);
        }
        return idProperty.initializer.text;
      });
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (!ids) throw new Error(`Unable to find ${declarationName} in ${filePath}`);
  return ids;
}

const palettes = {
  creative: ["#F3EFE6", "#20243B", "#5356C9", "#D65E73"],
  engineering: ["#F1EFE7", "#17343D", "#16858C", "#D36A3D"],
  computing: ["#F0F0E8", "#242B49", "#4D59C4", "#16A09A"],
  innovation: ["#F4EFE5", "#3B2C25", "#C45B38", "#3D8B72"],
  business: ["#F2EFE7", "#283039", "#476B91", "#B8743E"],
  research: ["#F1EFE8", "#26344A", "#3C6FA1", "#C85C52"],
  language: ["#F4EFE9", "#332C45", "#735AA5", "#C96555"]
};

function theme(id, direction, semantic, diagram, layout, palette, notation) {
  return {
    id,
    direction,
    semantic,
    diagram,
    layout,
    palette,
    notation,
    prompt: [
      "1280×480 competition directory cover in a rational technical-editorial style.",
      `Build an asymmetric diagram from ${semantic}.`,
      "Use an off-white paper ground, an engineering grid, two or three spot inks, clipped composition, hatching, registration marks and restrained manual annotations.",
      "No gradients, waves, random dots, glow, shadows, centered generic icon, competition logo, acronym mark, mascot, flag, emblem, map, seal, trophy, rocket, light bulb, brain or handshake."
    ].join(" ")
  };
}

// Every entry has its own diagram key and semantic brief. Direction families
// share an editorial grammar, but never a central icon or interchangeable base.
export const posterThemes = [
  theme("digital-media-creative-tech", "创意与数字", "storyboard frames, pixel samples, waveform and cursor trajectory", "digital-media", "cut-left", palettes.creative, "FRAME / 04"),
  theme("3d-digital-innovation-design", "创意与数字", "exploded volume, section plane, control points and dimension lines", "three-dimensional", "axis-right", palettes.creative, "SECTION / B"),
  theme("china-college-computer-design", "创意与数字", "interface panes, Bezier path and editing timeline", "computer-design", "rail-left", palettes.creative, "PATH / 07"),
  theme("national-college-industrial-design", "创意与数字", "orthographic product views, ergonomic contour and material swatches", "industrial-design", "cut-right", palettes.creative, "VIEW / 03"),
  theme("future-designer-ncda", "创意与数字", "crop marks, halftone density field, offset color plates and keyframes", "visual-design", "full-field", palettes.creative, "PLATE / 02"),

  theme("future-aircraft-design", "工程与制造", "airfoil section, airflow streamlines and pressure center", "aircraft", "cut-right", palettes.engineering, "LOAD / C"),
  theme("low-altitude-industry", "工程与制造", "altitude bands, flight corridor and sensing cones", "low-altitude", "axis-right", palettes.engineering, "ALT / 120"),
  theme("mechanical-innovation-design", "工程与制造", "cam profile, articulated linkage and torque arc", "mechanical", "rail-left", palettes.engineering, "TORQUE / 08"),
  theme("national-college-electronic-design", "工程与制造", "PCB traces, oscilloscope waveform and pin headers", "electronics", "full-field", palettes.engineering, "CH / 02"),
  theme("energy-conservation-emission-reduction", "工程与制造", "Sankey energy flow, heat exchange and loss branches", "energy-efficiency", "cut-left", palettes.engineering, "LOSS / 14%"),
  theme("integrated-circuit-innovation", "工程与制造", "integrated-circuit layout, vias and timing lanes", "integrated-circuit", "axis-right", palettes.engineering, "CLK / 40"),
  theme("advanced-graphics-bim", "工程与制造", "isometric structure, section cut and dimension chain", "bim", "cut-right", palettes.engineering, "GRID / D4"),
  theme("siemens-intelligent-manufacturing", "工程与制造", "production cells, robot-arm envelope, takt marks and feedback loop", "manufacturing", "rail-left", palettes.engineering, "TAKT / 06"),

  theme("iot-design", "人工智能与物联", "sensor nodes, gateway and routed data packets", "iot", "full-field", palettes.computing, "NODE / 12"),
  theme("youth-tech-challenge", "人工智能与物联", "problem card, constraint matrix and verification trajectory", "challenge", "cut-left", palettes.computing, "TEST / 05"),
  theme("graduate-rural-revitalization-agritech", "学术科研", "field plots, evidence samples, research milestones and rural deployment path", "academic-research--graduate-rural-revitalization-agritech", "axis-right", palettes.research, "AGR / 05"),
  theme("icpc-programming", "人工智能与物联", "weighted graph, call stack, complexity scale and judge flow", "algorithm", "rail-left", palettes.computing, "O(E LOG V)"),
  theme("smart-car", "人工智能与物联", "cropped track, steering trajectory and perception fan", "smart-car", "cut-right", palettes.computing, "RADIUS / 18"),
  theme("china-software-cup", "人工智能与物联", "layered architecture, interface flow and test matrix", "software", "axis-right", palettes.computing, "BUILD / 17"),
  theme("information-security", "人工智能与物联", "network zones, encrypted blocks and anomalous traffic", "security", "full-field", palettes.computing, "ANOM / 03"),
  theme("china-college-computer-contest", "人工智能与物联", "compute units, data array and verification window", "computing", "cut-left", palettes.computing, "ARRAY / 08"),
  theme("robocon", "人工智能与物联", "robot chassis projection, actuator envelope and task trajectory", "robocon", "cut-right", palettes.computing, "ACT / 04"),
  theme("robocup-china", "人工智能与物联", "motion vectors, prediction cones and formation nodes", "robocup", "rail-left", palettes.computing, "PRED / T+2"),
  theme("lanqiao-cup", "人工智能与物联", "recursion tree, stack frames and test-case grid", "recursion", "axis-right", palettes.computing, "CASE / 09"),

  theme("vocational-innovation-entrepreneurship", "创新创业", "workstation sequence, skill modules and assembly steps", "vocational", "cut-left", palettes.innovation, "STEP / 06"),
  theme("ican-innovation-entrepreneurship", "创新创业", "problem-to-prototype path, user test and iteration loop", "prototype", "axis-right", palettes.innovation, "ITER / 04"),
  theme("green-development", "创新创业", "lifecycle stages, material loop and impact assessment", "green-lifecycle", "full-field", palettes.innovation, "LCA / 05"),
  theme("china-international-college-innovation", "创新创业", "capability matrix, maturity ladder and stakeholder network", "innovation-matrix", "rail-left", palettes.innovation, "VALID / 03"),
  theme("challenge-cup-entrepreneurship-plan", "创新创业", "social need, value model and service journey", "venture", "cut-right", palettes.innovation, "VALUE / 07"),
  theme("ecommerce-innovation-creativity-entrepreneurship", "创新创业", "product grid, order funnel and logistics line", "ecommerce", "axis-right", palettes.innovation, "ORDER / 24"),

  theme("career-planning", "商业与职业", "capability radar, role path and career milestones", "career", "rail-left", palettes.business, "ROLE / 03"),
  theme("xuechuangbei-business-simulation", "商业与职业", "operating rounds, cash-flow bands and inventory curve", "business-simulation", "full-field", palettes.business, "ROUND / 06"),
  theme("business-elite-innovation", "商业与职业", "exhibition grid, customer route and marketing funnel", "business-elite", "cut-left", palettes.business, "FLOW / 12"),
  theme("market-research-analysis", "商业与职业", "questionnaire matrix, sample distribution and analysis heatmap", "market-research", "axis-right", palettes.business, "N / 240"),
  theme("national-college-logistics-design", "商业与职业", "warehouse locations, routing graph and dispatch timeline", "logistics", "cut-right", palettes.business, "ROUTE / 08"),
  theme("icbc-fintech-innovation", "商业与职业", "anonymous ledger blocks, risk scatter and settlement flow", "fintech", "rail-left", palettes.business, "RISK / .21"),

  theme("challenge-cup-academic-science", "学术科研", "research notebook, evidence tags, causal graph and confidence interval", "academic-research", "cut-left", palettes.research, "CI / 95"),
  theme("national-college-math-modeling", "学术科研", "variable matrix, contour surface, optimization path and residual plot", "math-modeling", "full-field", palettes.research, "MIN / F(X)"),
  theme("energy-economics-academic-creativity", "学术科研", "energy mix, supply-demand curves, dual axes and scenario branches", "energy-economics", "axis-right", palettes.research, "SCEN / B"),

  theme("understanding-contemporary-china-foreign-language", "语言人文", "parallel corpus columns, sentence alignment, terminology cards and cross-context arrows", "translation", "cut-right", palettes.language, "TERM / 11"),
  theme("21st-century-english-speaking", "语言人文", "argument structure, speech cadence, breath marks and timecode", "speaking", "rail-left", palettes.language, "PACE / 132")
  ,theme("graduate-cybersecurity-innovation", "人工智能与物联", "attack graph, trust boundaries, evidence packets and defense validation", "security--graduate-cybersecurity-innovation", "cut-left", palettes.computing, "CTF / 05")
  ,theme("national-structural-design", "工程与制造", "load paths, truss joints and deflection gauge", "bim--national-structural-design", "cut-right", palettes.engineering, "SPAN / 09")
  ,theme("national-advertising-art", "创意与数字", "campaign panels, audience segments and message hierarchy", "visual-design--national-advertising-art", "rail-left", palettes.creative, "BRIEF / 12")
  ,theme("engineering-practice-innovation", "工程与制造", "work cells, assembly route and tolerance checkpoints", "manufacturing--engineering-practice-innovation", "full-field", palettes.engineering, "CELL / 05")
  ,theme("huacan-design-award", "创意与数字", "cultural motif decomposition, material cards and layout studies", "visual-design--huacan-design-award", "axis-right", palettes.creative, "MOTIF / 07")
  ,theme("national-innovation-training-annual", "创新创业", "research milestones, prototype evidence and review gates", "innovation-matrix--national-innovation-training-annual", "cut-left", palettes.innovation, "GATE / 04")
  ,theme("chemical-engineering-design", "工程与制造", "process vessels, mass-flow lines and safety interlocks", "energy-efficiency--chemical-engineering-design", "axis-right", palettes.engineering, "FLOW / 18")
  ,theme("service-outsourcing-innovation", "创新创业", "service blueprint, API modules and user validation loop", "software--service-outsourcing-innovation", "rail-left", palettes.innovation, "SLA / 03")
  ,theme("milan-design-week-china", "创意与数字", "exhibition bays, object elevations and curatorial sequence", "industrial-design--milan-design-week-china", "cut-right", palettes.creative, "BAY / 11")
  ,theme("geology-skills", "学术科研", "strata sections, sample tags and field traverse", "academic-research--geology-skills", "full-field", palettes.research, "STRATA / C")
  ,theme("optoelectronic-design", "工程与制造", "optical rays, detector plane and signal trace", "electronics--optoelectronic-design", "cut-left", palettes.engineering, "LENS / 04")
  ,theme("metallographic-skills", "工程与制造", "microstructure grains, polishing stages and scale bar", "integrated-circuit--metallographic-skills", "axis-right", palettes.engineering, "μm / 50")
  ,theme("zhou-peiyuan-mechanics", "学术科研", "free-body diagram, moment arcs and boundary constraints", "mechanical--zhou-peiyuan-mechanics", "rail-left", palettes.research, "ΣM / 0")
  ,theme("mechanical-engineering-innovation", "工程与制造", "gear train, linkage envelope and exploded fasteners", "mechanical--mechanical-engineering-innovation", "cut-right", palettes.engineering, "GEAR / 13")
  ,theme("china-us-young-maker", "创新创业", "maker bench, prototype iterations and cross-team handoff", "prototype--china-us-young-maker", "full-field", palettes.innovation, "MAKE / 05")
  ,theme("raicom-robot-developer", "人工智能与物联", "robot modules, control bus and task checkpoints", "robocon--raicom-robot-developer", "cut-left", palettes.computing, "RAIL / 08")
  ,theme("datang-ict", "人工智能与物联", "radio cells, routing lanes and spectrum blocks", "computing--datang-ict", "axis-right", palettes.computing, "5G / N78")
  ,theme("huawei-ict", "人工智能与物联", "cloud regions, network fabric and compute clusters", "computing--huawei-ict", "rail-left", palettes.computing, "CLOUD / 3")
  ,theme("embedded-chip-system-design", "人工智能与物联", "chip core, peripheral buses and firmware timeline", "integrated-circuit--embedded-chip-system-design", "cut-right", palettes.computing, "BUS / 32")
  ,theme("culsc-life-sciences", "学术科研", "sample groups, assay timeline and confidence bands", "academic-research--culsc-life-sciences", "full-field", palettes.research, "ASSAY / 06")
  ,theme("physics-experiment-innovation", "学术科研", "apparatus modules, measured waveform and uncertainty bars", "electronics--physics-experiment-innovation", "cut-left", palettes.research, "Δ / .02")
  ,theme("bim-graduation-design", "工程与制造", "federated building model, clash markers and section cuts", "bim--bim-graduation-design", "axis-right", palettes.engineering, "LOD / 300")
  ,theme("intelligent-robot-creativity", "人工智能与物联", "robot morphology, sensor cones and motion plan", "robocon--intelligent-robot-creativity", "rail-left", palettes.computing, "POSE / 07")
  ,theme("china-good-design", "创意与数字", "digital art layers, crop windows and motion keyframes", "visual-design--china-good-design", "cut-right", palettes.creative, "LAYER / 09")
  ,theme("china-robot-ai", "人工智能与物联", "perception graph, robot formation and policy loop", "robocup--china-robot-ai", "full-field", palettes.computing, "POLICY / 4")
  ,theme("chinese-classics", "语言人文", "text columns, seal-grid proportions and recitation cadence", "translation--chinese-classics", "cut-left", palettes.language, "章句 / 08")
  ,theme("intercultural-competence", "语言人文", "context cards, perspective shifts and dialogue turns", "translation--intercultural-competence", "axis-right", palettes.language, "CTX / 05")
  ,theme("baidu-star", "人工智能与物联", "search states, heap operations and judge verdicts", "algorithm--baidu-star", "rail-left", palettes.computing, "AC / 17")
  ,theme("water-innovation-design", "工程与制造", "catchment branches, control gates and water balance", "energy-efficiency--water-innovation-design", "cut-right", palettes.engineering, "Q / 2.4")
  ,theme("chemical-engineering-experiment", "学术科研", "reactor controls, sampling points and calibration curve", "academic-research--chemical-engineering-experiment", "full-field", palettes.research, "RUN / 06")
  ,theme("chemistry-experiment-innovation", "学术科研", "reaction scheme, apparatus train and replicate matrix", "academic-research--chemistry-experiment-innovation", "cut-left", palettes.research, "REP / 03")
  ,theme("computer-system-ability", "人工智能与物联", "kernel layers, memory pages and instruction pipeline", "computing--computer-system-ability", "axis-right", palettes.computing, "PAGE / 4K")
  ,theme("garden-design-build", "创意与数字", "site grid, planting patches and construction sequence", "industrial-design--garden-design-build", "rail-left", palettes.creative, "PLOT / 12")
  ,theme("information-security-confrontation", "人工智能与物联", "attack paths, trust zones and defense checkpoints", "security--information-security-confrontation", "cut-right", palettes.computing, "CVE / 05")
  ,theme("surveying-innovation", "工程与制造", "survey traverse, control points and terrain contours", "low-altitude--surveying-innovation", "full-field", palettes.engineering, "CTRL / 06")
  ,theme("statistical-modeling", "学术科研", "sample strata, regression surface and residual diagnostics", "math-modeling--statistical-modeling", "cut-left", palettes.research, "R² / .84")
  ,theme("basic-medicine-innovation", "学术科研", "cell groups, protocol steps and assay comparison", "academic-research--basic-medicine-innovation", "axis-right", palettes.research, "BIO / 09")
  ,theme("tax-risk-case", "商业与职业", "invoice chain, tax nodes and anomaly bands", "fintech--tax-risk-case", "rail-left", palettes.business, "RISK / 07")
  ,theme("enterprise-competition-simulation", "商业与职业", "market rounds, capacity decisions and cash curves", "business-simulation--enterprise-competition-simulation", "cut-right", palettes.business, "ROUND / 08")
  ,theme("digital-enterprise-sandbox", "商业与职业", "digital operations board, inventory bands and decision clocks", "business-simulation--digital-enterprise-sandbox", "full-field", palettes.business, "SIM / 06")
  ,theme("digital-building-innovation", "工程与制造", "construction model, schedule lanes and sensor checkpoints", "bim--digital-building-innovation", "cut-left", palettes.engineering, "4D / 12")
  ,theme("global-campus-ai-algorithm", "人工智能与物联", "dataset partitions, model blocks and leaderboard curve", "ai-pipeline--global-campus-ai-algorithm", "axis-right", palettes.computing, "AUC / .91")
  ,theme("smart-agricultural-equipment", "工程与制造", "field rows, autonomous implement and coverage path", "manufacturing--smart-agricultural-equipment", "rail-left", palettes.engineering, "ROW / 16")
  ,theme("keyun-accounting", "商业与职业", "ledger columns, reconciliation links and close checklist", "fintech--keyun-accounting", "cut-right", palettes.business, "LEDGER / 9")
  ,theme("world-vocational-skills", "商业与职业", "skill stations, tool sequence and quality gauges", "vocational--world-vocational-skills", "full-field", palettes.business, "SKILL / 11")
  ,theme("robotac", "人工智能与物联", "arena lanes, robot formations and tactical arcs", "robocon--robotac", "cut-left", palettes.computing, "TACT / 06")
  ,theme("worldskills", "商业与职业", "global skill benchmarks, workpiece stages and tolerance marks", "vocational--worldskills", "axis-right", palettes.business, "WS / 48")
  ,theme("worldskills-china-selection", "商业与职业", "selection ladder, skill trials and scoring thresholds", "career--worldskills-china-selection", "rail-left", palettes.business, "CUT / 03")
  ,theme("brics-skills", "商业与职业", "technical modules, cross-border lanes and assessment gates", "vocational--brics-skills", "cut-right", palettes.business, "BRICS / 5")
  ,theme("matiji-programming", "人工智能与物联", "loop states, test batches and runtime bars", "recursion--matiji-programming", "full-field", palettes.computing, "TLE / 2S")
  ,theme("national-college-mathematics", "学术科研", "proof steps, function plots and theorem dependencies", "math-modeling--national-college-mathematics", "cut-left", palettes.research, "LEMMA / 4")
  ,theme("red-tourism-creative-planning", "语言人文", "field notes, route stops and narrative touchpoints", "market-research--red-tourism-creative-planning", "axis-right", palettes.language, "ROUTE / 7")
  ,theme("graduate-math-modeling", "学术科研", "parameter matrix, optimization basin and validation residuals", "math-modeling--graduate-math-modeling", "rail-left", palettes.research, "ARGMIN / X")
  ,theme("graduate-electronic-design", "工程与制造", "mixed-signal board, module interfaces and test traces", "electronics--graduate-electronic-design", "cut-right", palettes.engineering, "PCB / R3")
  ,theme("graduate-ai-innovation", "人工智能与物联", "training pipeline, feature embeddings and deployment checks", "ai-pipeline--graduate-ai-innovation", "full-field", palettes.computing, "EPOCH / 24")
  ,theme("graduate-public-management-case", "商业与职业", "stakeholder map, interview evidence and policy options", "market-research--graduate-public-management-case", "cut-left", palettes.business, "CASE / 06")
  ,theme("graduate-culture-china", "语言人文", "heritage source cards, transformation paths and media frames", "translation--graduate-culture-china", "axis-right", palettes.language, "两创 / 05")
  ,theme("comap-mcm-icm", "学术科研", "interdisciplinary variables, scenario branches and sensitivity plots", "math-modeling--comap-mcm-icm", "rail-left", palettes.research, "MCM / 96H")
  ,theme("igem-collegiate", "学术科研", "genetic parts, design-build-test cycle and safety gates", "academic-research--igem-collegiate", "cut-right", palettes.research, "DBTL / 04")
];

const researchedSeries = JSON.parse(await readFile(new URL("../../src/content/competition-series-20261104.json", import.meta.url), "utf8"));
const seriesPosterFamilies = {
  "algo": [
    "人工智能与物联",
    "algorithm",
    "computing"
  ],
  "compute": [
    "人工智能与物联",
    "computing",
    "computing"
  ],
  "robot": [
    "工程与制造",
    "robocon",
    "engineering"
  ],
  "biomed": [
    "工程与制造",
    "electronics",
    "engineering"
  ],
  "pharma": [
    "学术科研",
    "academic-research",
    "research"
  ],
  "transport": [
    "工程与制造",
    "manufacturing",
    "engineering"
  ],
  "materials": [
    "工程与制造",
    "mechanical",
    "engineering"
  ],
  "gis": [
    "学术科研",
    "bim",
    "research"
  ],
  "language": [
    "语言人文",
    "translation",
    "language"
  ],
  "oral": [
    "语言人文",
    "speaking",
    "language"
  ],
  "law": [
    "语言人文",
    "market-research",
    "language"
  ],
  "lawcn": [
    "语言人文",
    "market-research",
    "language"
  ],
  "finance": [
    "商业与职业",
    "fintech",
    "business"
  ],
  "brand": [
    "商业与职业",
    "market-research",
    "business"
  ],
  "venture": [
    "创新创业",
    "venture",
    "innovation"
  ],
  "design": [
    "创意与数字",
    "industrial-design",
    "creative"
  ],
  "field": [
    "创新创业",
    "academic-research",
    "innovation"
  ],
  "startup": [
    "创新创业",
    "software",
    "innovation"
  ],
  "chem": [
    "学术科研",
    "academic-research",
    "research"
  ],
  "process": [
    "工程与制造",
    "energy-efficiency",
    "engineering"
  ],
  "cosmetic": [
    "创意与数字",
    "industrial-design",
    "creative"
  ],
  "arts": [
    "创意与数字",
    "visual-design",
    "creative"
  ],
  "vehicle": [
    "工程与制造",
    "smart-car",
    "engineering"
  ],
  "math": [
    "学术科研",
    "math-modeling",
    "research"
  ],
  "geo": [
    "学术科研",
    "academic-research",
    "research"
  ]
};
const layouts = ["cut-left", "axis-right", "rail-left", "cut-right", "full-field"];
for (const [index, entry] of researchedSeries.entries()) {
  const [direction, family, palette] = seriesPosterFamilies[entry.theme];
  const brief = theme(entry.id, direction, entry.deliverable, family + "--" + entry.id,
    layouts[index % layouts.length], palettes[palette], entry.category + " / " + (index + 1));
  posterThemes.push({ ...brief, generatedAt: POSTER_GENERATED_AT });
}

const existingIds = await readCatalogIds("../../src/content/competitions.ts", "competitionDisplayEntries");
const guideIds = await readCatalogIds("../../src/content/competition-guide.ts", "guideCompetitionDisplayEntries");
const expansionIds = await readCatalogIds("../../src/content/competition-expansion.ts", "expansionCompetitionSpecs");
const catalogIds = [...existingIds, ...guideIds, ...expansionIds, ...researchedSeries.map(entry => entry.id)];
const themeIds = posterThemes.map((entry) => entry.id);

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

if (new Set(catalogIds).size !== catalogIds.length) {
  throw new Error(`Expected unique catalog IDs; received ${catalogIds.length} (${duplicates(catalogIds).join(", ")})`);
}

const missingThemes = catalogIds.filter((id) => !themeIds.includes(id));
const extraThemes = themeIds.filter((id) => !catalogIds.includes(id));
const duplicatedDiagrams = duplicates(posterThemes.map((entry) => entry.diagram));
if (missingThemes.length || extraThemes.length || new Set(themeIds).size !== themeIds.length || duplicatedDiagrams.length) {
  throw new Error(
    `Poster theme/catalog mismatch. Missing: ${missingThemes.join(", ") || "none"}; extra: ${extraThemes.join(", ") || "none"}; duplicated diagrams: ${duplicatedDiagrams.join(", ") || "none"}`
  );
}

const themeById = new Map(posterThemes.map((entry) => [entry.id, entry]));
export const posterEntries = catalogIds.map((id) => themeById.get(id));
