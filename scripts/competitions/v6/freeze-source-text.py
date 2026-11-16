#!/usr/bin/env python3
"""Normalize captured public bytes into immutable text; does not certify claims."""
import argparse, datetime, gzip, hashlib, html, io, json, pathlib, re, sys, zipfile, subprocess
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
ROOT = pathlib.Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('captures', nargs='+')
parser.add_argument('--pypdf-path', default='')
parser.add_argument('--output', default='artifacts/v6/content-research/frozen-source-text')
args = parser.parse_args()
if args.pypdf_path: sys.path.insert(0, args.pypdf_path)
from pypdf import PdfReader
class BodyText(HTMLParser):
    def __init__(self): super().__init__(); self.ignore = 0; self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','noscript','svg'): self.ignore += 1
        if tag in ('p','br','div','li','h1','h2','h3','h4','tr','section'): self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','noscript','svg') and self.ignore: self.ignore -= 1
    def handle_data(self, data):
        if not self.ignore: self.parts.append(data)
def xml_member(archive, name):
    info=archive.getinfo(name)
    if info.file_size > 5_000_000: raise ValueError('office_xml_expansion_limit')
    return ET.fromstring(archive.read(info))
def office_text(archive):
    names=archive.namelist()
    if 'word/document.xml' in names:
        doc=xml_member(archive,'word/document.xml')
        ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        return '\n'.join(''.join(t.text or '' for t in p.findall('.//w:t',ns)) for p in doc.findall('.//w:p',ns)), 'docx_document_xml'
    if 'xl/workbook.xml' in names:
        ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        shared=[]
        if 'xl/sharedStrings.xml' in names:
            shared=[''.join(si.itertext()) for si in xml_member(archive,'xl/sharedStrings.xml').findall('s:si',ns)]
        parts=[]
        for name in sorted(names):
            if not re.fullmatch(r'xl/worksheets/sheet[0-9]+\.xml',name): continue
            cells=[]
            for cell in xml_member(archive,name).findall('.//s:c',ns):
                value=cell.find('s:v',ns); raw=value.text if value is not None else ''
                if cell.get('t')=='s': value=shared[int(raw)] if raw else ''
                elif cell.get('t')=='inlineStr': value=''.join(cell.find('s:is',ns).itertext())
                else: value=raw
                formula=cell.find('s:f',ns)
                if value or formula is not None: cells.append('['+cell.get('r','?')+'] '+(str(value) if value is not None else '')+(' [formula, cached result only: '+(formula.text or '')+']' if formula is not None else ''))
            parts.append('[WORKSHEET XML '+name+']\n'+'\n'.join(cells))
        return '\n\n'.join(parts), 'xlsx_cells_xml_cached_values_not_recalculated'
    return None
output = ROOT / args.output; output.mkdir(parents=True, exist_ok=True)
entries = []
existing=output/'index.json'
if existing.exists(): entries=json.loads(existing.read_text()).get('sources',[])
for filename in args.captures:
    capture = json.loads((ROOT/filename).read_text())
    for source in capture.get('sources', []):
        entry = {key: source.get(key) for key in ('sourceId','url','finalUrl','retrievedAt','sha256','artifact','captureKind','authorReadingLog','authorReadLocator')}
        entry['sourceByteSha256'] = entry.pop('sha256')
        entry['sourceArtifact'] = entry.pop('artifact')
        entry['captureIndex'] = filename
        entry['independentReview'] = False
        if source.get('status') != 'captured_bytes_not_verified':
            entries.append({**entry, 'status':'unavailable', 'reason':source.get('reason',source.get('status'))}); continue
        try:
            data = (ROOT/source['artifact']).read_bytes()
            if hashlib.sha256(data).hexdigest() != source['sha256']: raise ValueError('source_digest_mismatch')
            if data.startswith(b'\x1f\x8b'):
                with gzip.GzipFile(fileobj=io.BytesIO(data)) as compressed:
                    decoded_data=compressed.read(50_000_001)
                if len(decoded_data)>50_000_000: raise ValueError('gzip_expansion_limit')
                entry['transportDecoding']='gzip_magic_bytes'
                entry['decodedByteSha256']=hashlib.sha256(decoded_data).hexdigest()
                data=decoded_data
            # A PDF-looking URL/file suffix is not proof of PDF content. Reject denial pages.
            probe=data[:8000].decode('utf-8',errors='ignore')
            if re.search(r'<title[^>]*>\s*(?:请求被拦截|Access Denied|Forbidden|Just a moment|NinjaFirewall)',probe,re.I) or ('您的请求因某些原因已被拦截' in probe):
                raise ValueError('access_challenge_not_a_source_body')
            if data.startswith(b'%PDF'):
                reader = PdfReader(io.BytesIO(data)); parts = ['[PAGE '+str(i+1)+']\n'+(page.extract_text() or '') for i,page in enumerate(reader.pages)]; text = '\n\n'.join(parts); method='pypdf_text_extraction'
            elif data.startswith(b'PK'):
                parts=[]; expanded=0
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    office=office_text(archive)
                    if office is not None:
                        text,method=office
                    else:
                        for member in archive.infolist():
                            if not member.filename.lower().endswith(('.pdf', '.docx')) or member.filename.startswith('__MACOSX/') or pathlib.PurePosixPath(member.filename).name.startswith('._'): continue
                            selected = source.get('selectedArchiveMembers')
                            if selected is not None and member.filename not in selected: continue
                            expanded += member.file_size
                            if expanded > 50_000_000: raise ValueError('archive_expansion_limit')
                            pdf=archive.read(member)
                            if member.filename.lower().endswith('.docx'):
                                with zipfile.ZipFile(io.BytesIO(pdf)) as doc:
                                    info=doc.getinfo('word/document.xml')
                                    if info.file_size > 5_000_000: raise ValueError('docx_xml_expansion_limit')
                                    document=ET.fromstring(doc.read(info))
                                ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                                paragraphs=[''.join(p.itertext()) for p in document.findall('.//w:p',ns)]
                                parts.append('[ARCHIVE MEMBER '+member.filename+'; sha256='+hashlib.sha256(pdf).hexdigest()+']\n'+'\n'.join(paragraphs))
                                continue
                            reader=PdfReader(io.BytesIO(pdf))
                            parts.append('[ARCHIVE MEMBER '+member.filename+'; sha256='+hashlib.sha256(pdf).hexdigest()+']\n'+'\n\n'.join('[PAGE '+str(i+1)+']\n'+(page.extract_text() or '') for i,page in enumerate(reader.pages)))
                        text='\n\n'.join(parts); method='zip_pdf_docx_members_in_memory'
            elif data.startswith(b'Rar!'):
                archive_path = str(ROOT/source['artifact'])
                listing = subprocess.run(['bsdtar','-tf',archive_path],capture_output=True,text=True,check=True,timeout=15).stdout.splitlines()
                parts=[]; expanded=0
                for member in listing:
                    if not member.lower().endswith('.pdf'): continue
                    # Stream one named member only; no archive path is written to disk.
                    pdf=subprocess.run(['bsdtar','-xOf',archive_path,member],capture_output=True,check=True,timeout=20).stdout
                    expanded += len(pdf)
                    if expanded > 50_000_000: raise ValueError('archive_expansion_limit')
                    reader=PdfReader(io.BytesIO(pdf))
                    parts.append('[ARCHIVE MEMBER '+member+'; sha256='+hashlib.sha256(pdf).hexdigest()+']\n'+'\n\n'.join('[PAGE '+str(i+1)+']\n'+(page.extract_text() or '') for i,page in enumerate(reader.pages)))
                text='\n\n'.join(parts); method='rar_pdf_members_streamed_pypdf'
            elif 'html' in source.get('contentType',''):

                encoding = re.search(br'charset=[\"\']?([\w-]+)',data[:5000],re.I)
                try: decoded = data.decode(encoding.group(1).decode() if encoding else 'utf-8')
                except (UnicodeDecodeError,LookupError): decoded=data.decode('gb18030',errors='replace')
                parser = BodyText(); parser.feed(decoded); text=''.join(parser.parts); method='html_parser_without_scripts_styles'
            else: text=data.decode('utf-8'); method='browser_rendered_dom_text' if source.get('captureKind') == 'rendered_dom_text' else 'web_tool_extracted_text' if source.get('captureKind') == 'web_tool_extracted_text' else 'utf8_text'
            text='\n'.join(line.strip() for line in text.splitlines() if line.strip())+'\n'
            if len(text.strip())<100: raise ValueError('insufficient_extracted_text')
            if re.search(r'^(?:Please enable JavaScript|Just a moment|Access Denied)',text.strip(),re.I): raise ValueError('access_challenge_not_a_source_body')
            digest=hashlib.sha256(text.encode()).hexdigest(); target=output/(digest+'.txt')
            if not target.exists(): target.write_text(text)
            entries.append({**entry, 'status':'body_available_not_verified', 'bodyArtifact':str(target.relative_to(ROOT)), 'bodySha256':digest, 'characters':len(text), 'extractionMethod':method})
        except Exception as exc: entries.append({**entry, 'status':'unavailable', 'reason':type(exc).__name__+': '+str(exc)})
# Keep one latest observation per identity; an inaccessible refresh must not masquerade as fresh older text.
entries=list({(entry['sourceId'],entry['url']):entry for entry in entries}.values())
report={'schemaVersion':'saitu.frozen-source-text.v1','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'independentReview':False,'limitation':'Frozen text is retrieval evidence, not an official-fact or eligibility approval. Check applicability and quote exact passages; insufficient or inaccessible text remains unknown.','sources':entries}
target=output/'index.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'index':str(target.relative_to(ROOT)),'available':sum(s['status']=='body_available_not_verified' for s in entries),'total':len(entries)}))
