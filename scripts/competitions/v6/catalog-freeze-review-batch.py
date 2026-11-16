#!/usr/bin/env python3
# coding: utf-8
"""Freeze current authored deep records and source bytes; strip all review decisions.
Run catalog-continuation-audit.mjs first. Never overwrite an existing immutable batch.
"""
import pathlib,json,hashlib,datetime,argparse
parser=argparse.ArgumentParser();parser.add_argument('--batch',required=True);parser.add_argument('--previous',default='review-batch-01');parser.add_argument('--extra-source-log',action='append',default=[]);parser.add_argument('--record-id',action='append',default=[]);parser.add_argument('--only-record-dependencies',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[3];out=root/'artifacts/continuation-20261105/content'/args.batch;out.mkdir(exist_ok=False)
sha=lambda b:hashlib.sha256(b).hexdigest()
def load(p):return json.loads((root/p).read_text())
current=load('artifacts/continuation-20261105/content/current-records.json')
records=[x for x in current['records'] if x['record'].get('deepDive')]
if args.record_id:
 records=[x for x in records if x['recordId'] in args.record_id]
 if set(args.record_id)!={x['recordId'] for x in records}:raise ValueError('Unknown or non-deep record selection')
prior=load('artifacts/continuation-20261105/content/'+args.previous+'/records.json')['records']
oldmap={x['recordId']:x for x in prior}
index=load('artifacts/v6/content-research/frozen-source-text/index.json')['sources'];files={};missing=[];sourcekeys=set()
def copyfile(p):
 p=pathlib.Path(p);p=p if p.is_absolute() else root/p
 try:rel=p.relative_to(root)
 except ValueError:return None
 # Independent reviewer decisions, evidence and summaries are not author inputs.
 if 'content-review-a2' in str(rel) or 'content-review-b2' in str(rel):
  if 'live-originals' not in str(rel):raise RuntimeError('Review-output path forbidden: '+str(rel))
 if not p.is_file():missing.append(str(rel));return None
 if str(rel) not in files:
  dest=out/'dependencies'/rel;dest.parent.mkdir(parents=True,exist_ok=True);b=p.read_bytes();dest.write_bytes(b);files[str(rel)]={'path':str(dest.relative_to(out)),'originalPath':str(rel),'sha256':sha(b),'bytes':len(b)}
 return files[str(rel)]
def nested_paths(v):
 if isinstance(v,dict):
  for x in v.values():nested_paths(x)
 elif isinstance(v,list):
  for x in v:nested_paths(x)
 elif isinstance(v,str) and '/' in v and len(v)<1000 and not v.startswith(('https://','http://')):
  try:
   if (root/v).is_file():copyfile(v)
  except OSError:pass
for row in records:
 r=row['record'];old=oldmap.get(r['recordId'])
 if old is None:old=next((x for x in prior if x['record']['seriesId']==r['seriesId'] and x['record']['track']['id']==r['track']['id']),None)
 author=r['review']['authorAgentId'];original=(old.get('authorship',{}).get('originalAuthorAgentId') if old else None) or (old['record']['review']['authorAgentId'] if old else author)
 row['authorship']={'originalAuthorAgentId':original,'currentRecordAuthorAgentId':author,'revisionAuthorAgentId':'/root/continue_catalog' if author=='/root/continue_catalog' else None,'previousRecordId':old['recordId'] if old else None,'previousContentDigest':old['contentDigest'] if old else None,'excludeReviewers':sorted(set([original,author]+((old.get('authorship',{}).get('excludeReviewers',[])) if old else [])))}
 r['review']={'authorAgentId':author};r.pop('publication',None);r.pop('contentTier',None);r.pop('catalogVersion',None);r['deepDive']['status']='draft'
 row['sources']=[]
 for s in r['sources']:
  sourcekeys.add(s['id']+'|'+s['url']);f=next((x for x in index if x['sourceId']==s['id'] and x['url']==s['url']),None)
  entry={'id':s['id'],'url':s['url'],'locator':s.get('locator'),'frozenIndex':f}
  if f:
   for key,hkey in [('sourceArtifact','sourceByteSha256'),('bodyArtifact','bodySha256')]:
    if f.get(key):
     c=copyfile(f[key]);entry[key]=c
     if c and f.get(hkey):assert c['sha256']==f[hkey],s['id']
  if s.get('evidenceArtifact'):
   entry['authorReadingLog']=copyfile(s['evidenceArtifact'])
   if entry['authorReadingLog']:
    try:nested_paths(load(s['evidenceArtifact']))
    except (ValueError,KeyError):pass
  row['sources'].append(entry)
# Source-only supplements and author reading dependencies; never copy review decisions.
for name in ([] if args.only_record_dependencies else ['import-log.json','igem-assets.json','igem-assets-avif.json','igem-ranges-log.json','newblood-ranges.json','reading-log.json']):
 rel='artifacts/continuation-20261105/content/source-rechecks-batch02/'+name;copyfile(rel);nested_paths(load(rel))
for rel in args.extra_source_log:
 copyfile(rel);nested_paths(load(rel))
# Preserve source extraction index as an inventory, not a semantic approval.
if not args.only_record_dependencies:copyfile('artifacts/v6/content-research/frozen-source-text/index.json')
(out/'records.json').write_text(json.dumps({'schemaVersion':'saitu.isolated-content-review-batch.v2','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'independentReview':False,'recordCount':len(records),'seriesCount':len(set(x['record']['seriesId'] for x in records)),'records':records},ensure_ascii=False,indent=2)+'\n')
(out/'README.md').write_text('''# 不可变作者输入\n\n本包只提供正文、作者身份、原文及字节哈希。所有记录的 review 仅保留 authorAgentId；publication、contentTier、catalogVersion 已去除，deepDive.status 统一为 draft。未包含任何独立审者结论、评语或批准。摘要绑定实质正文，以上剥离不改变 catalogContentDigest；包外另有机械验证结果。\n\n每个审者须在独立上下文实际核对同一摘要的事实、适用届次/赛道/地区、12模块、具体完整题或作品及适用正式评分；不能把作者阅读记录或原件下载当批准。作者不担任本稿独立审者。保留的 missingForPublication 和 sourceBoundary 是作者明确的资料边界，不是审者结论。\n\n来源在 dependencies 保留原路径。部分来源仍无原始字节，记录明确保留缺口。带curl错误的早期分段/部分件不作为完整原件；权威完整件以各条来源sourceArtifact及SHA为准。\n\n此包只读，后续修改必须进入新批次。历史完整案例不证明当届可报名，免费报名不证明个人全程费用为零，准备路线不替代严格参赛覆盖。\n''')
manifest={'schemaVersion':'saitu.immutable-content-batch.v2','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'noApprovalIncluded':True,'files':[{'path':'records.json','sha256':sha((out/'records.json').read_bytes())},{'path':'README.md','sha256':sha((out/'README.md').read_bytes())}]+list(files.values()),'missingFiles':sorted(set(missing)),'sourceCount':len(sourcekeys),'recordCount':len(records),'seriesCount':len(set(x['record']['seriesId'] for x in records))}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'directory':str(out),'manifestSha256':sha((out/'manifest.json').read_bytes()),'recordCount':len(records),'seriesCount':manifest['seriesCount'],'dependencyFiles':len(files),'missingFiles':manifest['missingFiles']},ensure_ascii=False))
