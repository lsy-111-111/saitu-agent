import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { installSourceLoader } from '../../lib/load-typescript-source.mjs';

installSourceLoader();
const { getDecisionCatalog } = await import('../../../src/lib/competitions/v6/catalog.ts');
const { matchingCoreDigest, matchingMetadataDigest } = await import('../../../src/lib/competitions/v7/catalog.ts');
const args = process.argv.slice(2);
const argument = name => args[args.indexOf(name) + 1];
if (!args.includes('--input') || !args.includes('--reviews')) throw new Error('Require --input and --reviews artifacts.');
const inputPath = argument('--input'), reviewsPath = argument('--reviews');
const targetPath = 'src/content/competitions-v6/catalog-metadata-v7.json';
const inputs = JSON.parse(await readFile(inputPath, 'utf8'));
const receipt = JSON.parse(await readFile(reviewsPath, 'utf8'));
const ledger = JSON.parse(await readFile(targetPath, 'utf8'));
const records = new Map(getDecisionCatalog().map(record => [record.recordId, record]));
const seen = new Set();
const sha = value => createHash('sha256').update(value).digest('hex');
for (const candidate of inputs) {
  const { expectedMetadataDigest, ...metadata } = candidate;
  const record = records.get(metadata.recordId);
  if (!record || matchingCoreDigest(record) !== metadata.coreDigest || matchingMetadataDigest(metadata) !== expectedMetadataDigest) throw new Error(`Stale metadata ${metadata.recordId}`);
  if (seen.has(metadata.recordId)) throw new Error(`Duplicate metadata ${metadata.recordId}`);
  seen.add(metadata.recordId);
  const reviews = receipt.rows.filter(review => review.recordId === metadata.recordId);
  const approved = reviews.find(review => review.metadataDigest === expectedMetadataDigest && review.outcome === 'approved');
  if (!approved || !approved.reviewerId || approved.reviewerId === metadata.authorAgentId || approved.method !== 'independent_official_page_recheck' ||
      !approved.runId || !Number.isFinite(Date.parse(approved.reviewedAt))) throw new Error(`Independent approval missing ${metadata.recordId}`);
  for (const source of approved.evidence?.sources ?? []) {
    if (source.rawArtifact && source.sourceByteSha256 && sha(await readFile(source.rawArtifact)) !== source.sourceByteSha256) throw new Error(`Raw source digest changed ${source.rawArtifact}`);
    if (source.textArtifact && source.textSha256 && sha(await readFile(source.textArtifact)) !== source.textSha256) throw new Error(`Source text digest changed ${source.textArtifact}`);
  }
  for (const visual of approved.evidence?.visuals ?? []) if (visual.artifact && visual.sha256 && sha(await readFile(visual.artifact)) !== visual.sha256) throw new Error(`Visual digest changed ${visual.artifact}`);
  const existing = ledger.findIndex(row => row.recordId === metadata.recordId);
  if (existing >= 0 && matchingMetadataDigest(ledger[existing]) !== expectedMetadataDigest) throw new Error(`Refuse to replace different existing metadata ${metadata.recordId}`);
  metadata.reviews = [...metadata.reviews];
  for (const review of reviews) {
    const row = { reviewerId: review.reviewerId, runId: review.runId, reviewedAt: review.reviewedAt, metadataDigest: review.metadataDigest, evidenceArtifact: reviewsPath, outcome: review.outcome };
    if (!metadata.reviews.some(item => JSON.stringify(item) === JSON.stringify(row))) metadata.reviews.push(row);
  }
  if (existing < 0) ledger.push(metadata); else {
    for (const review of ledger[existing].reviews) if (!metadata.reviews.some(item => JSON.stringify(item) === JSON.stringify(review))) metadata.reviews.push(review);
    ledger[existing] = metadata;
  }
}
await writeFile(targetPath, JSON.stringify(ledger, null, 2) + '\n');
console.log(JSON.stringify({ importedCurrentApprovals: inputs.length, totalMetadataRows: ledger.length, reviewerId: receipt.reviewerId, receiptArtifact: reviewsPath }));
