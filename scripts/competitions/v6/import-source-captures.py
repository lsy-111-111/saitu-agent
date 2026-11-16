#!/usr/bin/env python3
"""Freeze already-read public research copies, validating author-recorded byte hashes.
Rendered DOM captures stay explicitly distinct from original HTTP documents.
This imports evidence only; it never changes a fact or a review status.
"""
import argparse, datetime, hashlib, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[3]
p=argparse.ArgumentParser();p.add_argument('logs',nargs='+');args=p.parse_args()
out=ROOT/'artifacts/v6/content-research/source-byte-snapshots';out.mkdir(parents=True,exist_ok=True)
rows=[]
for logpath in args.logs:
 log=json.loads((ROOT/logpath).read_text())
 for source in log.get('sources',log.get('entries',[])):
  local=source.get('localResearchCopy');digest=source.get('sha256') or source.get('sourceByteSha256')
  if not local or not digest: continue
  source_path=(ROOT/local).resolve()
  if not source_path.is_relative_to((ROOT/'tmp/research-sources').resolve()): raise ValueError('not_public_research_directory: '+local)
  data=source_path.read_bytes()
  if hashlib.sha256(data).hexdigest()!=digest: raise ValueError('author_read_digest_mismatch: '+local)
  kind='web_tool_extracted_text' if source.get('method')=='web_tool_body_read' else 'rendered_dom_text' if 'browser' in source.get('method','') else 'original_document_bytes'
  extension=source_path.suffix.lower()
  target=out/(digest+extension)
  if not target.exists(): target.write_bytes(data)
  mime={'.pdf':'application/pdf','.html':'text/html','.txt':'text/plain','.png':'image/png','.jpg':'image/jpeg'}.get(extension,'application/octet-stream')
  rows.append(dict(sourceId=source.get('id',source.get('sourceId')),url=source['url'],finalUrl=source['url'],retrievedAt=source.get('retrievedAt',log.get('retrievedAt')),status='captured_bytes_not_verified',sha256=digest,bytes=len(data),contentType=mime,artifact=str(target.relative_to(ROOT)),captureKind=kind,authorReadingLog=logpath,authorReadLocator=source.get('locator'),independentReview=False,limitation=source.get('captureNote','Local public source bytes matched author reading-log digest; facts and exact scope require independent review.')))
name='capture-local-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json'
(out/name).write_text(json.dumps(dict(createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),independentReview=False,sources=rows),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(report=str((out/name).relative_to(ROOT)),imported=len(rows))))
