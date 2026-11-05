"""Replay one attached design seed or verify all engineering mappings without exposing the expert answers."""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / 'artifacts/competition-recommendation/expert-review-20261104'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--case', help='Review or run just one seed, e.g. ECASE01')
parser.add_argument('--run', action='store_true', help='Run the linked implementation checks')
args = parser.parse_args()
ids = {json.loads(line)['id'] for line in (REVIEW / 'blind-cases.jsonl').read_text().splitlines()}
with (REVIEW / 'engineering-coverage.csv').open(encoding='utf-8-sig') as source:
    rows = list(csv.DictReader(source))
if len(rows) != 64 or {row['case_id'] for row in rows} != ids:
    sys.exit('Coverage manifest must address every one of the 64 unique IDs.')
if args.case and args.case not in ids:
    sys.exit(f'Unknown case: {args.case}')
selected = [row for row in rows if not args.case or row['case_id'] == args.case]
files = set()
for row in selected:
    kind = row['coverage']
    file, title = row['test_file'], row['test_title_fragment']
    if kind not in {'工程性质', '部分覆盖', '待人工'} or not row['scope']:
        sys.exit(f"Incomplete assessment for {row['case_id']}")
    if kind != '待人工':
        if not file or not title or title not in (ROOT / file).read_text():
            sys.exit(f"Missing referenced test for {row['case_id']}: {file} / {title}")
        files.add(file)
    if args.case:
        print(row['case_id'], kind, row['scope'], file, title, flush=True)
print(dict(Counter(row['coverage'] for row in selected)), flush=True)
if args.run:
    for file in sorted(f for f in files if f.endswith('.mjs')):
        subprocess.run(['node', file], cwd=ROOT, check=True)
    tests = sorted(f for f in files if f.endswith('.test.ts'))
    if tests:
        cmd = [str(ROOT / 'node_modules/.bin/vitest'), 'run', *tests]
        if args.case:
            import re
            cmd.extend(['-t', re.escape(selected[0]['test_title_fragment'])])
        subprocess.run(cmd, cwd=ROOT, check=True)
