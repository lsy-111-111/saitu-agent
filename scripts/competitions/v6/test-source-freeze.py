#!/usr/bin/env python3
"""Regression checks for transport decoding and denial pages, without network access."""
import argparse,gzip,hashlib,json,pathlib,subprocess,sys,tempfile
p=argparse.ArgumentParser();p.add_argument('--pypdf-path',default='');args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix='saitu-source-freeze-test-') as folder:
 tmp=pathlib.Path(folder);html=('<html><head><title>规则正文</title></head><body>'+('真实资格与分组标准。'*30)+'</body></html>').encode()
 rows=[]
 for sid,data,mime in [('gzip',gzip.compress(html),'text/html'),('denial',b'<html><head><title>Access Denied</title></head><body>'+b'no access '*30+b'</body></html>','application/pdf'),('corrupt',b'\x1f\x8bnotgzip','text/html')]:
  file=tmp/(sid+'.bin');file.write_bytes(data);rows.append(dict(sourceId=sid,url='https://example.test/'+sid,status='captured_bytes_not_verified',artifact=str(file),sha256=hashlib.sha256(data).hexdigest(),contentType=mime))
 capture=tmp/'capture.json';capture.write_text(json.dumps({'sources':rows}))
 command=[sys.executable,str(root/'scripts/competitions/v6/freeze-source-text.py'),str(capture),'--output',str(tmp/'output')]
 if args.pypdf_path: command+=['--pypdf-path',args.pypdf_path]
 # Artifact paths must remain within the configured workspace for the production registry.
 # Use an isolated temporary directory under the repository for this one command.
 with tempfile.TemporaryDirectory(prefix='.source-freeze-test-',dir=root/'artifacts/v6') as target:
  command[command.index('--output')+1]=target
  subprocess.run(command,check=True,capture_output=True,text=True)
  sources={s['sourceId']:s for s in json.loads((pathlib.Path(target)/'index.json').read_text())['sources']}
  assert sources['gzip']['status']=='body_available_not_verified'
  assert sources['gzip']['transportDecoding']=='gzip_magic_bytes'
  assert sources['gzip']['decodedByteSha256']==hashlib.sha256(html).hexdigest()
  assert '真实资格' in (root/sources['gzip']['bodyArtifact']).read_text()
  assert sources['denial']['status']=='unavailable' and 'access_challenge' in sources['denial']['reason']
  assert sources['corrupt']['status']=='unavailable'
print('3 source-freeze regression checks passed')
