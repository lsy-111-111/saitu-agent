import { readFile, writeFile } from "node:fs/promises";
import { installSourceLoader } from "../../lib/load-typescript-source.mjs";

installSourceLoader();
const { getDecisionCatalog } = await import("../../../src/lib/competitions/v6/catalog.ts");
const { projectIndependentCoreReviews } = await import("../../../src/lib/competitions/v7/catalog.ts");
const ledger = JSON.parse(await readFile("src/content/competitions-v6/ai-review-ledger.json", "utf8"));
const rows = getDecisionCatalog().flatMap(record => projectIndependentCoreReviews(record, ledger[record.recordId] ?? []));
await writeFile("src/content/competitions-v6/core-review-ledger-v7.json", JSON.stringify(rows, null, 2) + "\n");
console.log(JSON.stringify({ projectedRows: rows.length, records: new Set(rows.map(row => row.recordId)).size, newReviewsClaimed: 0 }));
