#!/usr/bin/env python3
"""Create a local validation source snapshot, never copying secrets or sealed evaluator answers."""
import hashlib,json,pathlib,subprocess,tarfile,datetime,os,io,shutil,argparse
root=pathlib.Path(__file__).resolve().parents[3]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=pathlib.Path,default=root/'artifacts/v6/linux-validation-20261105')
out=parser.parse_args().output.resolve();out.mkdir(parents=True,exist_ok=True)
allowed={'src','tests','ops','db','scripts','public','docs','deploy'}
root_files={'bootstrap-source-manifest.txt','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','next.config.ts','next.config.mjs','next.config.js','next-env.d.ts','tailwind.config.ts','postcss.config.mjs','postcss.config.js','eslint.config.mjs','.eslintrc.json','vitest.config.ts','playwright.config.ts','README.md','.gitignore','.npmrc'}
blocked={'node_modules','tmp','.git','.next','.next-e2e','__pycache__','author-private','review-a-private','review-b-private','private','secrets'}
files=[]
for directory,dirs,names in os.walk(root):
 relative=pathlib.Path(directory).relative_to(root)
 dirs[:]=[name for name in dirs if name not in blocked and not name.startswith('.env') and 'sealed' not in name.lower() and not pathlib.Path(directory,name).is_symlink() and (relative.parts or name in allowed)]
 for name in names:
  path=pathlib.Path(directory,name);rel=path.relative_to(root)
  if rel.parts[0] not in allowed and str(rel) not in root_files:continue
  if name.startswith('.env') or name.endswith('.tsbuildinfo') or path.suffix in {'.key','.p12','.pfx'} or path.is_symlink():continue
  if name=='.npmrc':
   # Only the audited non-secret engine policy is allowed in the test snapshot.
   if path.read_text().strip()!='engine-strict=true':raise ValueError('npmrc changed: review for credentials before snapshot')
  files.append((str(rel),path))
files.sort()
frozen=[(name,path,path.read_bytes()) for name,path in files]
entries=[{'path':name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,path,data in frozen]
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'description':'working tree snapshot; git HEAD alone is not source identity','files':entries,'excluded':'all .env, tmp, artifacts, node_modules, private/sealed answers, private key extensions and symlinks'}
encoded=json.dumps(manifest,ensure_ascii=False,indent=2).encode();(out/'source-manifest.json').write_bytes(encoded)
with tarfile.open(out/'source.tar.gz','w:gz') as archive:
 for name,path,data in frozen:
  info=archive.gettarinfo(str(path),arcname='saitu-agent/'+name);info.size=len(data);archive.addfile(info,io.BytesIO(data))
 archive.add(out/'source-manifest.json',arcname='saitu-agent/linux-source-manifest.json')
version=out/'snapshots'/hashlib.sha256(encoded).hexdigest();version.mkdir(parents=True,exist_ok=False)
shutil.copyfile(out/'source-manifest.json',version/'source-manifest.json');shutil.copyfile(out/'source.tar.gz',version/'source.tar.gz')
print(json.dumps({'files':len(files),'sourceManifestSha256':hashlib.sha256(encoded).hexdigest(),'archiveSha256':hashlib.sha256((out/'source.tar.gz').read_bytes()).hexdigest(),'archiveBytes':(out/'source.tar.gz').stat().st_size}))
