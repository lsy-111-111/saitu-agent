#!/usr/bin/env python3
"""Capture public source bytes for later rechecking; this does not approve any fact."""
import argparse, concurrent.futures, datetime, hashlib, json, pathlib, re, urllib.request, urllib.parse, subprocess, tempfile
ROOT = pathlib.Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('logs', nargs='+', help='Author reading-log JSON files (entries with sourceId/url)')
parser.add_argument('--output', default='artifacts/v6/content-research/source-byte-snapshots')
args = parser.parse_args()
out = (ROOT / args.output).resolve()
out.mkdir(parents=True, exist_ok=True)
entries = {}
for filename in args.logs:
    log = json.loads((ROOT / filename).read_text())
    for source in log.get('entries', log.get('sources', [])):
        source_id = source.get('sourceId', source.get('id'))
        if source.get('url') and source_id:
            entries[(source_id, source['url'])] = source

def capture(item):
    source_id, url = item
    entry = {'sourceId': source_id, 'url': url, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'independentReview': False}
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or not parsed.hostname or re.match(r'^(localhost|127\.|10\.|192\.168\.|169\.254\.)', parsed.hostname):
        return {**entry, 'status': 'unsupported_public_url'}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SaituSourceEvidence/1.0', 'Accept': 'text/html,application/pdf,text/plain'})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read(25_000_001)
                mime, final_url = response.headers.get('content-type', ''), response.url
        except Exception:
            # A different TLS client is a transport fallback, never an access-control bypass.
            with tempfile.TemporaryDirectory(prefix='saitu-public-source-') as temp:
                body = pathlib.Path(temp) / 'body'
                result = subprocess.run(['curl', '--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10', '--max-time', '35', '--max-filesize', '25000000', '--user-agent', 'SaituSourceEvidence/1.0', '--output', str(body), '--write-out', '%{content_type}\n%{url_effective}', url], capture_output=True, text=True, timeout=40)
                if result.returncode: raise ValueError('curl_transport_failed: ' + result.stderr[-300:])
                data = body.read_bytes()
                mime, final_url = result.stdout.split('\n', 1)
        if len(data) > 25_000_000: raise ValueError('document_too_large')
        if not data: raise ValueError('empty_body')
        digest = hashlib.sha256(data).hexdigest()
        extension = '.pdf' if data.startswith(b'%PDF') else '.zip' if data.startswith(b'PK') else '.html' if 'html' in mime else '.bin'
        target = out / (digest + extension)
        if not target.exists(): target.write_bytes(data)
        return {**entry, 'status': 'captured_bytes_not_verified', 'finalUrl': final_url, 'sha256': digest, 'bytes': len(data), 'contentType': mime, 'artifact': str(target.relative_to(ROOT)), 'limitation': 'HTTP success or a byte digest does not establish that a document is a usable rule or that facts are true; reviewers must open and read it.'}
    except Exception as exc:
        return {**entry, 'status': 'unavailable', 'reason': type(exc).__name__ + ': ' + str(exc)}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(capture, entries))
report = {'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'independentReview': False, 'sources': results}
name = 'capture-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.json'
(out / name).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'report': str((out/name).relative_to(ROOT)), 'captured': sum(r['status']=='captured_bytes_not_verified' for r in results), 'attempted': len(results)}, ensure_ascii=False))
