"""Check independently completed seed reviews before freezing a benchmark."""
import argparse
import csv
from datetime import date
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / 'artifacts/competition-recommendation/expert-review-20261104/blind-cases.jsonl'
FIELDS = ('case_id', 'reviewer_id', 'decision', 'accepted_outcomes', 'forbidden_outcomes', 'evidence', 'reviewed_at')


def read_review(file, ids):
    with Path(file).open(encoding='utf-8-sig', newline='') as source:
        reader = csv.DictReader(source)
        if tuple(reader.fieldnames or []) != FIELDS:
            raise ValueError(f'{file}: unexpected columns')
        rows = list(reader)
    if len(rows) != len(ids) or {row['case_id'] for row in rows} != ids:
        raise ValueError(f'{file}: missing, duplicate or unknown seed IDs')
    if any(not row[field].strip() for row in rows for field in FIELDS):
        raise ValueError(f'{file}: pending review fields')
    reviewers = {row['reviewer_id'] for row in rows}
    if len(reviewers) != 1:
        raise ValueError(f'{file}: expected a single independent reviewer')
    for row in rows:
        if row['decision'] not in {'usable', 'conditional', 'unjudgeable'}:
            raise ValueError(f"{row['case_id']}: unsupported decision")
        date.fromisoformat(row['reviewed_at'])
    return reviewers.pop(), {row['case_id']: row for row in rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review_a')
    parser.add_argument('review_b')
    parser.add_argument('--adjudication', help='Third independent review CSV required for disagreements')
    args = parser.parse_args()
    ids = {json.loads(line)['id'] for line in CASES.read_text().splitlines()}
    ra, a = read_review(args.review_a, ids)
    rb, b = read_review(args.review_b, ids)
    if ra == rb:
        raise ValueError('Two different reviewer identifiers are required')
    matters = ('decision', 'accepted_outcomes', 'forbidden_outcomes')
    disputed = {i for i in ids if any(a[i][k] != b[i][k] for k in matters)}
    if disputed and not args.adjudication:
        raise ValueError('Adjudication needed: ' + ', '.join(sorted(disputed)))
    if disputed:
        rc, _ = read_review(args.adjudication, disputed)
        if rc in {ra, rb}:
            raise ValueError('Disagreements require an independent adjudicator')
    print(f'{len(ids)} independently reviewed seeds; {len(disputed)} adjudicated discrepancies. Form validation only.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit(str(error))
