/** Public author handoff only. It never emits approvals, adjudications or synthetic reviewer identities. */
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const dependencies=createRequire(import.meta.resolve("vitest/package.json"));
const {createServer}=await import(dependencies.resolve("vite"));
const server=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},resolve:{alias:{"@":path.join(root,"src")}},server:{middlewareMode:true,watch:null},appType:"custom",logLevel:"error"});
const sha=value=>createHash("sha256").update(value).digest("hex");
const json=async file=>JSON.parse(await readFile(path.join(root,file),"utf8"));
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
try {
 const {getDecisionCatalog}=await server.ssrLoadModule("/src/lib/competitions/v6/catalog.ts");
 const {catalogContentDigest}=await server.ssrLoadModule("/src/lib/competitions/v6/catalog-review.ts");
 const {TASK_FAMILIES}=await server.ssrLoadModule("/src/lib/competitions/v6/catalog-types.ts");
 const {preparationPaths}=await server.ssrLoadModule("/src/content/competitions-v6/preparation-paths.ts");
 const outputIndex=process.argv.indexOf("--output");
 const out=path.resolve(root,outputIndex>=0?process.argv[outputIndex+1]:"artifacts/v6/content-review");
 await mkdir(path.join(out,"reading-logs"),{recursive:true});
 const records=getDecisionCatalog(); const frozen=await json("artifacts/v6/content-research/frozen-source-text/index.json");
 const coverage=await json("artifacts/v6/evaluation/coverage-results.json");
 const gapAssessment=await json("artifacts/v6/content-review/deep-gap-assessment.json");
 const logs=new Map();const sourceRows=new Map();
 for(const record of records)for(const source of record.sources){
  const key=source.id+"|"+source.url;
  if(sourceRows.has(key))continue;
  const f=frozen.sources.find(row=>row.sourceId===source.id&&row.url===source.url);
  let reading=null;
  if(source.evidenceArtifact){
   if(!logs.has(source.evidenceArtifact)){try{logs.set(source.evidenceArtifact,await json(source.evidenceArtifact));}catch{logs.set(source.evidenceArtifact,null);}}
   const log=logs.get(source.evidenceArtifact);reading=(log?.entries??log?.sources??[]).find(row=>(row.sourceId??row.id)===source.id&&row.url===source.url)??null;
  }
  let byteIntegrity=false,bodyIntegrity=false;
  if(f?.sourceArtifact&&f.sourceByteSha256){try{byteIntegrity=sha(await readFile(path.join(root,f.sourceArtifact)))===f.sourceByteSha256;}catch{}}
  if(f?.bodyArtifact&&f.bodySha256){try{bodyIntegrity=sha(await readFile(path.join(root,f.bodyArtifact)))===f.bodySha256;}catch{}}
  let archivedReadingArtifact=null,readingLogSha256=null;
  if(source.evidenceArtifact&&logs.get(source.evidenceArtifact)){
   const data=JSON.stringify(logs.get(source.evidenceArtifact),null,2)+"\n";readingLogSha256=sha(data);
   archivedReadingArtifact=path.relative(root,path.join(out,"reading-logs",readingLogSha256+".json"));
   await writeFile(path.join(root,archivedReadingArtifact),data);
  }
  sourceRows.set(key,{...source,authorReading:reading,archivedReadingArtifact,readingLogSha256,frozen:f??null,byteIntegrity,bodyIntegrity,independentReview:false});
 }
 const sourcesFor=r=>r.sources.map(s=>sourceRows.get(s.id+"|"+s.url));
 const drafts=records.filter(r=>r.deepDive).map(r=>({recordId:r.recordId,seriesId:r.seriesId,name:r.name,edition:r.edition,track:r.track,group:r.group,scope:r.scope,identity:r.identity,taskFamily:r.taskFamily,authorAgentId:r.review.authorAgentId,contentDigest:catalogContentDigest(r),contentTier:r.contentTier,reviewStatus:r.review.status,humanReview:r.review.humanReview,deepDive:r.deepDive,gapClassification:gapAssessment.seriesAssessments.find(item=>item.seriesId===r.seriesId)??null,sources:sourcesFor(r),facts:r.facts.filter(f=>f.kind==="official_fact"),eligibilityRules:r.eligibilityRules,preparationPaths:preparationPaths.filter(p=>p.seriesId===r.seriesId&&p.trackId===r.track.id),record:r}));
 // Split only explicit sentence/semicolon boundaries. Reviewers must re-atomize compound clauses;
 // the surrounding full claim and entity scope always travel with a fragment.
 const candidates=[];const seen=new Set();
 for(const r of records)for(const fact of r.facts){
  if(fact.kind!=="official_fact"||!["verified_current","historical"].includes(fact.status)||!fact.sourceIds.length)continue;
  const sources=fact.sourceIds.map(id=>sourcesFor(r).find(s=>s.id===id));
  if(sources.some(s=>!s||s.accessStatus!=="body_read"||!["organizer","official_host","university_local"].includes(s.authority)||s.integrity==="requires_recheck"))continue;
  for(const [index,fragment] of fact.text.split(/(?<=[。；;])/u).map(x=>x.trim()).filter(Boolean).entries()){
   const key=JSON.stringify([r.seriesId,r.identity,fact.field,fragment]);if(seen.has(key))continue;seen.add(key);
   candidates.push({candidateId:sha(key).slice(0,24),recordId:r.recordId,seriesId:r.seriesId,taskFamily:r.taskFamily,contentDigest:catalogContentDigest(r),factId:fact.id,field:fact.field,fragmentIndex:index,claimCandidate:fragment,fullClaim:fact.text,factStatus:fact.status,scope:fact.scope,entity:fact.entity,sourceScopes:fact.sourceScopes,sourceIds:fact.sourceIds,sources:sources.map(s=>({id:s.id,url:s.url,locator:s.locator,scope:s.scope,evidenceArtifact:s.evidenceArtifact,sourceArtifact:s.frozen?.sourceArtifact??null,sourceByteSha256:s.frozen?.sourceByteSha256??null,bodyArtifact:s.frozen?.bodyArtifact??null,bodySha256:s.frozen?.bodySha256??null,captureKind:s.frozen?.captureKind??null,byteIntegrity:s.byteIntegrity,bodyIntegrity:s.bodyIntegrity})),frozenTextAvailable:sources.every(s=>s.bodyIntegrity),atomicity:"candidate_requires_independent_check",supportVerdict:"not_reviewed",reviewerId:null});
  }
 }
 const pool=candidates.filter(c=>c.frozenTextAvailable);
 // Reproducible public order, balanced across independent series. It is not a hidden test set.
 const groups=new Map();for(const c of pool){if(!groups.has(c.seriesId))groups.set(c.seriesId,[]);groups.get(c.seriesId).push(c);}
 for(const list of groups.values())list.sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
 const order=[...groups.keys()].sort((a,b)=>sha(a).localeCompare(sha(b)));const selected=[];
 for(let round=0;selected.length<500;round++){let added=0;for(const key of order){const item=groups.get(key)[round];if(item&&selected.length<500){selected.push(item);added++;}}if(!added)break;}
 const matrix=TASK_FAMILIES.map(family=>{const d=drafts.filter(r=>r.taskFamily===family);const c=coverage.results.filter(r=>r.kind==="core"&&r.taskFamily===family);return {taskFamily:family,draftRecords:d.length,draftSeries:new Set(d.map(r=>r.seriesId)).size,noAuthorDeclaredGapSeries:new Set(d.filter(r=>!r.deepDive.missingForPublication.length).map(r=>r.seriesId)).size,approvedL3Series:new Set(d.filter(r=>r.contentTier==="L3").map(r=>r.seriesId)).size,preparationProfilesPassed:c.filter(r=>r.preparationCoverage.passed).length,formalProfilesPassed:c.filter(r=>r.strictCoveragePassed).length,profileCount:c.length,seriesIds:[...new Set(d.map(r=>r.seriesId))]};});
 const summary={catalogFingerprint:`v6-${sha(JSON.stringify(records)).slice(0,24)}`,recordCount:records.length,seriesCount:new Set(records.map(r=>r.seriesId)).size,draftRecordCount:drafts.length,draftSeriesCount:new Set(drafts.map(r=>r.seriesId)).size,noAuthorDeclaredGapSeries:new Set(drafts.filter(r=>!r.deepDive.missingForPublication.length).map(r=>r.seriesId)).size,deepGapRecordCount:drafts.filter(r=>r.deepDive.missingForPublication.length).length,approvedL3Series:new Set(records.filter(r=>r.contentTier==="L3").map(r=>r.seriesId)).size,claimCandidateCount:candidates.length,frozenTextClaimCandidates:pool.length,proposedSampleCount:selected.length,requestedIndependentAtomicFacts:500,atomicFactsIndependentlyChecked:0,missingFrozenTextCandidates:candidates.length-pool.length};
 const base={schemaVersion:"saitu.content-review-handoff.v1",generatedAt:new Date().toISOString(),authorAgentId:"/root/audit_catalog",independentReview:false,summary,limitations:["Author handoff only, not independent review or approval.","No-missing draft is merely author-complete; reviewer must check true task specificity, official criteria, qualifications, timeframe, usefulness and all cited source scope.","Fact fragments are mechanically separated candidate statements, not 500 certified atomic facts. Reviewer must split compounds, exclude duplicates/editorial caveats and report actual independently checked denominator.","DOM text is preserved as observed rendered text, never labelled original HTTP bytes; images and unavailable text require reviewers to open originals.","The 40 frozen profiles and threshold are unchanged; 36 preparation passes are author-assessed pending independent protocol/path review, formal participation remains separate."],matrix};
 
 const write=async(name,value)=>writeFile(path.join(out,name),JSON.stringify(value,null,2)+"\n");
 await write("review-pack.json",{...base,drafts});
 await write("catalog-records-frozen.json",{catalogFingerprint:summary.catalogFingerprint,records});
 await write("deep-gap-assessment.json",gapAssessment);
 await write("coverage-results.json",coverage);
 await write("legacy-semantic-triage.json",await json("src/content/competitions-v6/legacy-semantic-triage.json"));
 await writeFile(path.join(out,"review-protocol.md"),await readFile(path.join(root,"docs/v6/content-independent-review-handoff.md")));
 await writeFile(path.join(out,"coverage-protocol.md"),await readFile(path.join(root,"docs/v6/coverage-protocol-v3.md")));await write("fact-check-candidates.json",{...base,candidates});await write("fact-check-500-proposed.json",{...base,selectionMethod:"public deterministic series round-robin, candidate SHA order; not an independent frozen sample",candidates:selected});
 const link=(file,label)=>`<a href="${escape(path.relative(out,path.resolve(root,file)))}">${escape(label)}</a>`;
 const rows=drafts.map(r=>`<details data-search="${escape([r.seriesId,r.name,r.taskFamily,r.edition,r.recordId].join(" ").toLowerCase())}"><summary>${escape(r.name)} · ${escape(r.edition)} · ${escape(r.taskFamily)} · ${r.deepDive.missingForPublication.length?"有作者声明缺口":"作者完整，待独立核验"}</summary><p><code>${escape(r.recordId)}</code><br>作者 ${escape(r.authorAgentId)} · 摘要 <code>${escape(r.contentDigest)}</code></p><p>${escape(r.deepDive.representativeTask)}</p><p>${escape(r.deepDive.workedExample.sourceBoundary)}</p>${r.deepDive.missingForPublication.length?`<ul>${r.deepDive.missingForPublication.map(x=>`<li>${escape(x)}</li>`).join("")}</ul>`:""}<p>${escape(r.gapClassification?.proposedClass??"无作者声明缺口")}：${escape(r.gapClassification?.reason??"仍须独立核验，不代表已通过")}</p><h3>逐条来源与冻结证据</h3>${r.sources.map(s=>`<p><a href="${escape(s.url)}">${escape(s.id)} · ${escape(s.title)}</a><br>${escape(s.locator)}<br>${escape(s.scope)}<br>${s.frozen?.sourceArtifact?link(s.frozen.sourceArtifact,"来源冻结件"):"原件未冻结"} · ${s.bodyIntegrity?link(s.frozen.bodyArtifact,"正文文本"):"可验证正文冻结缺失"} · ${s.archivedReadingArtifact?link(s.archivedReadingArtifact,"已冻结作者阅读日志"):"无作者阅读日志"}<br>正文SHA <code>${escape(s.frozen?.bodySha256??"unknown")}</code> · ${escape(s.frozen?.captureKind??"capture类型见索引")}</p>`).join("")}<h3>主要事实（未独立判定）</h3><ul>${r.facts.map(f=>`<li><strong>${escape(f.field)}</strong> ${escape(f.text)} <small>${escape(f.sourceIds.join(", "))}</small></li>`).join("")}</ul></details>`).join("\n");
 const html=`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>内容独立审查入口</title><style>body{font:16px/1.6 system-ui;max-width:1150px;margin:36px auto;padding:0 20px;color:#20242a;background:#f5f7fa}h1{font-size:28px}details{background:white;border:1px solid #ccd4df;border-radius:8px;margin:12px 0;padding:15px}summary{cursor:pointer;font-weight:650}code{overflow-wrap:anywhere;font-size:12px}input{width:100%;padding:12px;box-sizing:border-box}a{color:#175d9e}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccd4df}small{color:#52606d}</style><h1>内容独立审查入口</h1><p>作者交接材料，全部待独立核验。当前 ${summary.draftRecordCount} 份深度草稿、${summary.draftSeriesCount} 个不同系列；无作者声明缺口 ${summary.noAuthorDeclaredGapSeries} 系列，实际批准 L3 ${summary.approvedL3Series}。正式参与与准备路径分开评估，不能把来源摘要或机器计数当事实通过。</p><p><a href="review-pack.json">完整草稿/事实/来源 JSON</a> · <a href="deep-gap-assessment.json">缺口分级建议（未裁定）</a> · <a href="fact-check-candidates.json">事实候选全集</a> · <a href="fact-check-500-proposed.json">500 抽核候选（实际 ${selected.length}，非已审原子事实）</a> · ${link("docs/v6/content-independent-review-handoff.md","独立审查协议")} · ${link("artifacts/v6/evaluation/coverage-results.json","40场景逐项结果")} · ${link("artifacts/v6/catalog-maintenance.html","135旧系列维护面板")}</p><table><thead><tr><th>任务族</th><th>草稿系列</th><th>无声明缺口</th><th>L3</th><th>准备/核心场景</th><th>正式</th></tr></thead><tbody>${matrix.map(m=>`<tr><td>${escape(m.taskFamily)}</td><td>${m.draftSeries}</td><td>${m.noAuthorDeclaredGapSeries}</td><td>${m.approvedL3Series}</td><td>${m.preparationProfilesPassed}/${m.profileCount}</td><td>${m.formalProfilesPassed}/${m.profileCount}</td></tr>`).join("")}</tbody></table><p>全文索引检索（系列、届次、赛道与记录ID）</p><input id="search" placeholder="例如 teaching-service / 2023 / ACM"><div id="records">${rows}</div><script>document.querySelector('#search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('details').forEach(d=>d.hidden=!d.dataset.search.includes(q));});</script></html>`;
 await writeFile(path.join(out,"index.html"),html);
 const manifestFiles=["review-pack.json","catalog-records-frozen.json","fact-check-candidates.json","fact-check-500-proposed.json","deep-gap-assessment.json","coverage-results.json","legacy-semantic-triage.json","review-protocol.md","coverage-protocol.md","index.html"];
 const manifest={schemaVersion:"saitu.content-review-freeze.v1",createdAt:base.generatedAt,independentReview:false,catalogFingerprint:summary.catalogFingerprint,files:[],sourceDependencies:[...sourceRows.values()].filter(s=>s.byteIntegrity||s.bodyIntegrity).map(s=>({sourceId:s.id,url:s.url,sourceArtifact:s.frozen?.sourceArtifact,sourceByteSha256:s.frozen?.sourceByteSha256,bodyArtifact:s.frozen?.bodyArtifact,bodySha256:s.frozen?.bodySha256,archivedReadingArtifact:s.archivedReadingArtifact,readingLogSha256:s.readingLogSha256})),note:"Read-only reviewer input. All files bind to these hashes; any substantive correction requires a new pack and renewed review. Author proposals are not independent findings. Legacy triage is not 135 official-source rechecks."};
 for(const name of manifestFiles)manifest.files.push({path:name,sha256:sha(await readFile(path.join(out,name)))});
 await write("freeze-manifest.json",manifest);
 console.log(JSON.stringify({output:path.relative(root,path.join(out,"index.html")),summary,matrix},null,2));
}finally{await server.close();}
