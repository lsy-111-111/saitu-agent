import { renderMaintenanceView } from "./maintenance-view.mjs";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import {sourceManifest} from "./run-experiment.mjs";
import {canonicalHash} from "./frozen-ranking-executor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const argument = key => { const index=process.argv.indexOf(key); return index>=0?process.argv[index+1]:undefined; };
const requestedOutput=argument('--output');
const dependencies = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(dependencies.resolve("vite"));
const server = await createServer({ root, optimizeDeps: { noDiscovery: true, entries: [] }, configFile: false, server: { middlewareMode: true, watch: null }, resolve: { alias: { "@": path.join(root, "src") } }, appType: "custom", logLevel: "error" });
try {
  const catalog = await server.ssrLoadModule("/src/lib/competitions/v6/catalog.ts");
  const validation = await server.ssrLoadModule("/src/lib/competitions/v6/catalog-validation.ts");
  const maintenance = await server.ssrLoadModule("/src/lib/competitions/v6/catalog-maintenance.ts");
  const output = requestedOutput?path.resolve(root,requestedOutput):path.join(root, "artifacts/v6");
  await mkdir(output, { recursive: !requestedOutput });
  const now = new Date(argument('--as-of')??Date.now());
  if(!Number.isFinite(now.valueOf()))throw new Error('invalid_audit_timestamp');
  const records = catalog.getDecisionCatalog();
  const audit = validation.validateCatalogSnapshot(records, now);
  const summary = catalog.getCatalogSummary();
  const report = { generatedAt: now.toISOString(), command: "node scripts/competitions/v6/catalog-audit.mjs", summary, audit, limitation: "这是内容结构与证据关联检查；真实AI双审按用户授权政策另行记录，不等于人工审核、学生理解或匹配效果验收。" };
  await writeFile(path.join(output, "catalog-audit.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(output, "catalog-snapshot.json"), JSON.stringify({ catalogVersion: summary.catalogVersion, records }, null, 2) + "\n");
  const maintenanceReport = maintenance.buildCatalogMaintenanceReport(records, now);
  await writeFile(path.join(output, "catalog-maintenance-report.json"), JSON.stringify(maintenanceReport, null, 2) + "\n");
  await writeFile(path.join(output, "catalog-maintenance.html"), renderMaintenanceView(maintenanceReport));
  const profiles = catalog.getCoverageProfiles();
  const { preparationPaths } = await server.ssrLoadModule("/src/content/competitions-v6/preparation-paths.ts");
  const preparationEvidenceDigest = createHash("sha256").update(JSON.stringify(preparationPaths)).digest("hex");
  const catalogFingerprint = `v6-${createHash("sha256").update(JSON.stringify(records)).digest("hex").slice(0, 24)}`;
  const evaluationPath = argument('--coverage')??"artifacts/v6/evaluation/coverage-results.json";
  let execution = null;
  try { execution = JSON.parse(await readFile(path.resolve(root, evaluationPath), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const implementationSha256=canonicalHash(await sourceManifest(root));
  const snapshotMatches = execution?.schemaVersion === "saitu.coverage-execution.v1" && execution.protocolVersion === "saitu.coverage-protocol.v5" && execution.implementationUnchanged===true && execution.implementationSha256===implementationSha256 && execution.preparationEvidenceDigest === preparationEvidenceDigest && execution.results?.length === profiles.length && profiles.every(profile => execution.results.some(result => result.profileId === profile.id && result.catalogVersion === catalogFingerprint && JSON.stringify(result.sourceProfile) === JSON.stringify(profile)));
  await writeFile(path.join(output, "catalog-coverage.json"), JSON.stringify({
    definition: "9任务族各含4个固定组合：新手独自300元、新手可组队1000元、有课程作品独自1000元、有课程作品可组队300元，另4个领域压力画像。其它资源是显式测试假设。",
    profiles, measuredCoverage: snapshotMatches ? execution.measuredCoverage : null,
    status: snapshotMatches ? "measured_by_actual_engine" : execution ? "pending_stale_evaluation_refresh" : "pending_qualification_and_feasibility_assessment",
    evaluationEvidence: { path: evaluationPath, generatedAt: execution?.generatedAt ?? null, asOf: execution?.asOf ?? null, catalogFingerprint, preparationEvidenceDigest, acceptanceStatus: execution?.acceptanceStatus ?? "pending", snapshotMatches: Boolean(snapshotMatches), independentSuitabilityMeasured: false, realStudentEvidence: false },
    limitation: "正式参与与学习准备分开统计，均需3个独立系列及2条具体任务/角色路径。正式参与要求资格及个人总费用证实；准备任务使用独立标明的编辑增量成本估算及已确认资源，不等同参赛成本。未知不计通过；作者检查结果仍待独立协议与路径评审，90%目标不能先宣称通过。"
  }, null, 2) + "\n");
  const proposalIndex = process.argv.indexOf("--propose");
  if (proposalIndex >= 0) {
    const inputPath = process.argv[proposalIndex + 1];
    if (!inputPath) throw new Error("--propose需要一个提取结果JSON文件");
    const inputs = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
    if (!Array.isArray(inputs)) throw new Error("提案输入须为数组");
    const proposals = inputs.map((input, index) => {
      const record = catalog.getDecisionRecord(input.recordId);
      if (!record || !record.sources.some(source => source.id === input.sourceId)) throw new Error(`第${index + 1}条提案的记录或来源不存在`);
      if (typeof input.field !== "string" || /(^|\.)(__proto__|prototype|constructor)(\.|$)/.test(input.field)) throw new Error("提案字段不合法");
      const previousValue = input.field.split(".").reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, record);
      return validation.createCatalogChangeProposal({ id: input.id ?? `proposal-${now.getTime()}-${index + 1}`, recordId: record.recordId, createdAt: now.toISOString(), sourceId: input.sourceId, field: input.field, previousValue: previousValue ?? null, proposedValue: input.proposedValue, reason: input.reason ?? "抽取到内容变化，等待核验其范围与有效性。" });
    });
    await writeFile(path.join(output, "catalog-change-proposals.json"), JSON.stringify({ generatedAt: now.toISOString(), autoPublished: false, proposals }, null, 2) + "\n");
  }
  console.log(JSON.stringify({ ...summary, duplicateRecordIds: audit.duplicateRecordIds, output: path.join(output,"catalog-audit.json") }, null, 2));
  if (!audit.valid) process.exitCode = 1;
} finally {
  await server.close();
}
