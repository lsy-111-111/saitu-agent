#!/usr/bin/env python3
"""Export selected public HEAD files only, without Git credentials/history or sealed answers."""
import subprocess,pathlib,tarfile,io,hashlib,json
root=pathlib.Path(__file__).resolve().parents[3];out=root/'artifacts/v6/linux-validation-20261105'
manifest=json.loads((out/'source-manifest.json').read_text());allowed={row['path'] for row in manifest['files']}
entries=[]
with tarfile.open(out/'sanitized-head.tar.gz','w:gz') as tar:
 for name in sorted(allowed):
  result=subprocess.run(['git','show','HEAD:'+name],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
  if result.returncode:continue
  data=result.stdout
  if name=='.npmrc' and data.strip()!=b'engine-strict=true':raise ValueError('unreviewed historical npmrc')
  info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o755 if name.endswith(('.sh','.py')) else 0o644;tar.addfile(info,io.BytesIO(data));entries.append({'path':name,'sha256':hashlib.sha256(data).hexdigest()})
(out/'sanitized-head-manifest.json').write_text(json.dumps({'originalHead':manifest['gitHead'],'scope':'Only files allowed in the validation source snapshot; no original Git database, config, remotes, history, dotenv or private paths','files':entries},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'exportedPublicHeadFiles':len(entries),'sha256':hashlib.sha256((out/'sanitized-head.tar.gz').read_bytes()).hexdigest()}))
