"""Capture public source bytes/text without treating network availability as factual review."""
import argparse
import concurrent.futures
import hashlib
import html.parser
import io
import json
from pathlib import Path
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone


class PageText(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.parts = []
        self.links = []
    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"): self.hidden += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href: self.links.append(href)
        if tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3"): self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"): self.hidden = max(0, self.hidden - 1)
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def extract_archive(raw_path, member_filter=None):
    from pypdf import PdfReader
    text = []
    errors = []
    raw = raw_path.read_bytes()
    if raw.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if "word/document.xml" in archive.namelist():
                document = ET.fromstring(archive.read("word/document.xml"))
                text.append("\n".join(node.text or "" for node in document.iter() if node.tag.endswith("}t")))
            else:
                for item in archive.infolist():
                    if item.filename.lower().endswith(".pdf") and item.file_size < 20000000 and (not member_filter or member_filter in item.filename):
                        try:
                            reader = PdfReader(io.BytesIO(archive.read(item)))
                            text.append(f"FILE {item.filename}\n" + "\n".join(page.extract_text() or "" for page in reader.pages))
                        except Exception as error:
                            errors.append({"member": item.filename, "error": f"{type(error).__name__}: {error}"})
    elif raw.startswith(b"Rar!"):
        listed = subprocess.run(["tar", "-tf", str(raw_path)], capture_output=True, text=True, timeout=15)
        for name in listed.stdout.splitlines()[:100]:
            if not name.lower().endswith(".pdf") or member_filter and member_filter not in name: continue
            extracted = subprocess.run(["tar", "-xOf", str(raw_path), name], capture_output=True, timeout=15)
            if extracted.returncode or len(extracted.stdout) > 20000000: continue
            try:
                reader = PdfReader(io.BytesIO(extracted.stdout))
                text.append(f"FILE {name}\n" + "\n".join(page.extract_text() or "" for page in reader.pages))
            except Exception as error:
                errors.append({"member": name, "error": f"{type(error).__name__}: {error}"})
    return "\n\n".join(text), errors


def capture(row, output, max_bytes=16000000, max_time=30):
    url = row["url"]
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    raw_path = output / (key + ".bytes")
    header_path = output / (key + ".headers")
    command = ["curl", "--location", "--silent", "--show-error", "--connect-timeout", "8", "--max-time", str(max_time), "--max-filesize", str(max_bytes), "--user-agent", "Mozilla/5.0 (compatible; Saitu-source-check/7)", "--dump-header", str(header_path), "--output", str(raw_path), "--write-out", "%{http_code}\n%{url_effective}\n%{content_type}", url]
    result = subprocess.run(command, capture_output=True, text=True)
    fields = result.stdout.splitlines()
    observation = {"url": url, "retrievedAt": datetime.now(timezone.utc).isoformat(), "httpStatus": int(fields[0]) if fields and fields[0].isdigit() else 0, "effectiveUrl": fields[1] if len(fields) > 1 else None, "contentType": fields[2] if len(fields) > 2 else None, "networkExitCode": result.returncode, "error": result.stderr.strip() or None, "rawArtifact": str(raw_path) if raw_path.exists() else None, "textArtifact": None, "textCharacters": 0, "status": "unavailable", "factReviewPerformed": False}
    if not raw_path.exists(): return observation
    raw = raw_path.read_bytes()
    observation.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
    if result.returncode or observation["httpStatus"] >= 400: return observation
    text = ""
    try:
        if raw.startswith(b"%PDF"):
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw))
            text = "\n".join(f"PAGE {i + 1}\n{page.extract_text() or ''}" for i, page in enumerate(reader.pages))
            observation["pages"] = len(reader.pages)
        elif raw.startswith(b"Rar!") or raw.startswith(b"PK\x03\x04"):
            text, archive_errors = extract_archive(raw_path, row.get("archiveMember"))
            if archive_errors: observation["archiveParseErrors"] = archive_errors
            if row.get("archiveMember"): observation["archiveMemberFilter"] = row["archiveMember"]
            observation["status"] = "archive_requires_extraction" if not text else "parsed_body_available"
        else:
            head = raw[:10000].decode("ascii", errors="ignore")
            encoding = re.search(r"charset\s*=\s*[\"']?([\w-]+)", head, re.I)
            encoding = encoding.group(1) if encoding else "utf-8"
            try: decoded = raw.decode(encoding, errors="replace")
            except LookupError: decoded = raw.decode("utf-8", errors="replace")
            parser = PageText()
            parser.feed(decoded)
            text = "\n".join(line.strip() for line in "".join(parser.parts).splitlines() if line.strip())
            observation["links"] = list(dict.fromkeys(parser.links))
        if text:
            text_path = output / (key + ".txt")
            text_path.write_text(text, encoding="utf-8")
            observation.update(textArtifact=str(text_path), textCharacters=len(text), textSha256=hashlib.sha256(text.encode()).hexdigest())
            blocked = bool(re.search(r"(just a moment|checking your browser|access denied|captcha|安全验证|访问被拒绝)", text[:6000], re.I))
            observation["status"] = "access_challenge" if blocked and len(text) < 10000 else "parsed_body_available" if len(text) >= 160 else "insufficient_text"
    except Exception as error:
        observation["parseError"] = f"{type(error).__name__}: {error}"
        observation["status"] = "parse_failed"
    return observation


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--input", required=True)
    args.add_argument("--output", required=True)
    args.add_argument("--workers", type=int, default=8)
    args.add_argument("--max-bytes", type=int, default=16000000)
    args.add_argument("--max-time", type=int, default=30)
    parsed = args.parse_args()
    rows = json.loads(Path(parsed.input).read_text())
    output = Path(parsed.output)
    output.mkdir(parents=True, exist_ok=True)
    observations = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=parsed.workers) as executor:
        jobs = {executor.submit(capture, row, output, parsed.max_bytes, parsed.max_time): row for row in rows}
        for job in concurrent.futures.as_completed(jobs):
            item = job.result()
            observations.append(item)
            print(json.dumps({"completed": len(observations), "total": len(rows), "url": item["url"], "status": item["status"]}), flush=True)
    observations.sort(key=lambda item: item["url"])
    (output / "observations.json").write_text(json.dumps(observations, ensure_ascii=False, indent=2) + "\n")
    summary = {"totalUrls": len(rows), "byStatus": {status: sum(item["status"] == status for item in observations) for status in sorted(set(item["status"] for item in observations))}, "newFactualApprovalsClaimed": 0}
    (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary), flush=True)


if __name__ == "__main__": main()
