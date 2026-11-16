import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const A0_SOURCE_COMMIT = "3fb65140589be510e9db3296e792156e690648a6";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function projectHistoricalProfile(profile, schema) {
  const projected = structuredClone(profile), omittedFields = [];
  const first = schema.safeParse(projected);
  if (!first.success) {
    for (const issue of first.error.issues) {
      if (issue.code !== "unrecognized_keys") throw new Error("historical_profile_requires_semantic_migration");
      let owner = projected;
      for (const key of issue.path) owner = owner[key];
      for (const key of issue.keys) {
        omittedFields.push({path:[...issue.path,key],reason:"not_representable_in_frozen_A0_contract"});
        delete owner[key];
      }
    }
  }
  return {profile:schema.parse(projected),omittedFields};
}

/** Runs the literal historical product rule adapter. Never uses the live v6 scorer. */
export async function captureHistoricalBaseline({ input, output, commit = A0_SOURCE_COMMIT }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("full_commit_sha_required");
  const resolved = execFileSync("git", ["rev-parse", "--verify", `${commit}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
  if (resolved !== commit) throw new Error("commit_resolution_changed");
  const archive = execFileSync("git", ["archive", "--format=tar", commit, "src", "package.json", "pnpm-lock.yaml"], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  await mkdir(path.dirname(output), {recursive:true});
  await mkdir(output); // Refuse to overwrite a prior baseline.
  // Extract under tsconfig-excluded tmp, not artifacts (which the app typecheck scans).
  await mkdir(path.join(root,"tmp"),{recursive:true});
  const source = await mkdtemp(path.join(root,"tmp","historical-a0-"));
  await writeFile(path.join(output, "source.tar"), archive);
  execFileSync("tar", ["-xf", path.join(output, "source.tar"), "-C", source]);
  const deps = createRequire(import.meta.resolve("vitest/package.json"));
  const { createServer } = await import(deps.resolve("vite"));
  const server = await createServer({ root, configFile:false, server:{middlewareMode:true,watch:null},
    resolve:{alias:{"@":path.join(source,"src"),"server-only":path.join(root,"tests/fixtures/server-only.ts")}}, appType:"custom",logLevel:"silent" });
  try {
    const engine = await server.ssrLoadModule(path.join(source, "src/lib/competitions/recommendation-engine.ts"));
    const schema = await server.ssrLoadModule(path.join(source, "src/lib/ai/competition-request-schema.ts"));
    const bytes = await readFile(input);
    const fixture = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(fixture.profiles) || !fixture.profiles.length || !/(?:Z|[+-]\d{2}:\d{2})$/.test(fixture.asOf) || !Number.isFinite(Date.parse(fixture.asOf))) throw new Error("valid_profiles_and_timestamp_required");
    if (new Set(fixture.profiles.map(row => row.profileId)).size !== fixture.profiles.length) throw new Error("duplicate_profile_identity");
    const results = fixture.profiles.map(row => {
      const projection = projectHistoricalProfile(row.profile,schema.competitionRecommendationProfileV5Schema);
      const report = engine.recommendCompetitions(projection.profile, {now:new Date(fixture.asOf)});
      return {profileId:row.profileId, familyId:row.familyId, taskGroup:row.taskGroup, projection, report};
    });
    const files = [];
    async function inventory(directory) {
      for (const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
        const filename=path.join(directory,entry.name);
        if(entry.isDirectory()) await inventory(filename);
        else if(entry.isFile()) files.push({path:path.relative(source,filename),sha256:hash(await readFile(filename))});
        else throw new Error("historical_source_must_not_contain_symlink");
      }
    }
    await inventory(source);
    const result = {schemaVersion:"saitu.historical-baseline.v1",algorithm:"A0",sourceCommit:commit,sourceArchiveSha256:hash(archive),profileInputSha256:hash(bytes),
      executedAt:new Date().toISOString(),asOf:fixture.asOf,origin:fixture.origin,modelCalls:0,costCny:0,
      comparisonScope:"historical_product_baseline_not_E2_same_candidate_algorithm_comparison",sourceFiles:files,results};
    await writeFile(path.join(output,"baseline.json"),JSON.stringify(result,null,2)+"\n");
    return {output,algorithm:"A0",profileCount:results.length,sourceCommit:commit,sourceArchiveSha256:result.sourceArchiveSha256};
  } finally { await server.close(); await rm(source,{recursive:true,force:true}); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), get=flag=>args[args.indexOf(flag)+1];
  if(!args.includes("--input")||!args.includes("--output")) throw new Error("Usage: capture-historical-baseline.mjs --input INPUT --output NEW_DIRECTORY");
  console.log(JSON.stringify(await captureHistoricalBaseline({input:path.resolve(get("--input")),output:path.resolve(get("--output"))})));
}
