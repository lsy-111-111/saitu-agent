"""Check the shipped research ledger, published guides and field-level source references offline."""
import json
import re
from pathlib import Path
from unicodedata import normalize

root = Path(__file__).resolve().parents[1]
archive = root / 'artifacts/catalog-research-20261104'
content = root / 'src/content'


def lines(name):
    with (archive / name).open() as stream:
        return [json.loads(line) for line in stream if line.strip()]


def check(ok, why):
    if not ok:
        raise SystemExit('核验失败：' + why)


queries = lines('search-log.jsonl')
sources = {r['url']: r for r in lines('source-index.jsonl')}
changes = lines('catalog-changes.jsonl')
decisions = lines('candidate-decisions.jsonl')
registry = lines('registry.jsonl')
guides = json.loads((content / 'competition-field-guides.json').read_text())
added = json.loads((content / 'competition-series-20261104.json').read_text())
facts = json.loads((content / 'competition-fact-sheets.json').read_text())
stats = json.loads((archive / 'counts.json').read_text())
qids = {r['queryId'] for r in queries}
terms = {normalize('NFKC', r['query']).casefold().strip() for r in queries}
valid = {r['queryId'] for r in queries if r['countsTowardMinimum']}
check(len(queries) == len(terms) == len(qids) == stats['uniqueQueries'], '检索式或编号重复')
check(len(valid) >= 500 and len(valid) == stats['eligibleQueries'], '有效检索统计不符')
check(all(r['returnedUrls'] for r in queries if r['countsTowardMinimum']), '空返回被计数')
check(all(u in sources for r in queries for u in r['returnedUrls']), '检索返回缺少来源索引')
check(len(guides) == 100 and len(added) == 35, '原库和新增系列数量不符')
check(len({r['seriesId'] for r in changes}) == len(changes) == len(facts), '变更表系列重复或缺失')
check({r['publishedId'] for r in decisions if r['publishedId']} == {r['id'] for r in added}, '候选处置与实际收录不一致')
by_type = {kind: {v['id'] for v in registry if v['type'] == kind} for kind in
           ['series','edition-record','notice-scope','milestone','track']}
check(by_type['series'] == {r['seriesId'] for r in changes}, '系列索引不完整')
check(sum(map(len, by_type.values())) == len(registry), '同类索引记录有重复编号')
for node in registry:
    if 'edition' in node:
        check(node['edition'] in by_type['edition-record'], '节点缺少届次')
    if 'noticeScope' in node:
        check(node['noticeScope'] in by_type['notice-scope'], '节点缺少适用范围')
    if node['type'] == 'track':
        check(node.get('source') in sources, '赛道缺少可追溯资料：' + node['label'])
guides.update({r['id']: r for r in added})
for row in changes:
    slug = row['seriesId']
    sheet = facts[row['searchKey']]
    guide = guides[slug]
    check(bool(row['queries']) and set(row['queries']) <= valid, '该系列无有效检索：' + slug)
    check(all(guide.get(k) for k in ['task','deliverable','role','experience','investment','firstStep']), '缺决策字段：' + slug)
    check(bool(sheet['edition']) and bool(sheet['sources']), '无届次说明或原文入口：' + slug)
    check(sheet['sources'] == row['sourceList'] and sheet['nodes'] == row['scheduleNodes'], '修订清单落后于网站：' + slug)
    for key in ('eligibility','team','mentor','fee'):
        check(sheet[key] == row['facts'][key], '清单事实过期：' + slug + key)
        refs = [int(n) for n in re.findall(r'〔(\d+)〕', sheet[key])]
        check(all(1 <= n <= len(sheet['sources']) for n in refs), '字段引用越界：' + slug)
        check(refs or any(w in sheet[key] for w in ('待核','未核','未取得','尚','待查')), '无引用且未声明未知：' + slug + key)
    for s in sheet['sources']:
        check(s['url'] in sources and s['scope'], '正式字段未记录来源或范围：' + slug)
    for node in sheet['nodes']:
        check(node['kind'] and node['scope'] and node['sourceUrl'] in sources, '节点无依据或范围：' + slug)
print(f'{len(valid)}/{len(queries)} 条有效检索；{len(changes)} 个系列、{sum(len(s["nodes"]) for s in facts.values())} 个有出处的节点通过核验。')
