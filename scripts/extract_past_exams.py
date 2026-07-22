import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "tmp" / "pdfs"
OUT_DIR = ROOT / "data"
OUT_FILE = OUT_DIR / "past_exam_questions.json"
TARGET_SUBJECTS = set(sys.argv[1:])
FAILURE_SUBJECT_MAP = {
    "strategy": "management",
    "it": "systems",
    "policy": "sme",
}

SUBJECTS = [
    ("economics", "経済学・経済政策", "A"),
    ("finance", "財務・会計", "B"),
    ("management", "企業経営理論", "C"),
    ("operations", "運営管理", "D"),
    ("law", "経営法務", "E"),
    ("systems", "経営情報システム", "F"),
    ("sme", "中小企業経営・中小企業政策", "G"),
]

YEARS = [
    ("令和7年度", "R07", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2025/", lambda k: f"{k}1JI2025.pdf"),
    ("令和6年度", "R06", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2024/", lambda k: f"{k}1JI2024.pdf"),
    ("令和5年度", "R05", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2023/", lambda k: f"{k}1JI2023.pdf"),
    ("令和4年度", "R04", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2022/", lambda k: f"{k}1ji2022.pdf"),
    ("令和3年度", "R03", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2021/", lambda k: f"{k}1ji2021.pdf"),
    ("令和2年度", "R02", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2020/", lambda k: f"{k}1ji2020.pdf"),
    ("令和元年度", "R01", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2019/", lambda k: f"{k}1ji2019.pdf"),
    ("平成30年度", "H30", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2018/", lambda k: f"{k}1ji2018.pdf"),
    ("平成29年度", "H29", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2017/", lambda k: f"{k.lower()}1ji2017.pdf"),
    ("平成28年度", "H28", "https://www.jf-cmca.jp/attach/test/shikenmondai/1ji2016/", lambda k: f"{k.lower()}1ji2016.pdf"),
]

ANSWER_PDFS = {
    "R07": ["https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025a.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025b.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025c.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/d_v2_20250902.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025e.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/f_v2_20250902.pdf", "https://www.jf-cmca.jp/attach/test/r07/1ji_seikai/2025g.pdf"],
    "R06": ["https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024a.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024b.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024c.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/Dv2_20240903.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024e.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/Fv2_20240903.pdf", "https://www.jf-cmca.jp/attach/test/r06/1ji_seikai/2024g.pdf"],
    "R05": ["https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023a.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023b.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023c.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023dv2.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023e.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023f.pdf", "https://www.jf-cmca.jp/attach/test/r05/1ji_seikai/2023g.pdf"],
    "R04": ["https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022a.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022b.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022c.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022dv2.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022e.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022fv2.pdf", "https://www.jf-cmca.jp/attach/test/r04/1j_seikai/2022g.pdf"],
    "R03": ["https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021a.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021b.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021c.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021d.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021e.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021f.pdf", "https://www.jf-cmca.jp/attach/test/r03/1j_seikai/2021g_teisei.pdf"],
    "R02": ["https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020a.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020b.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020c.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020d.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020e.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020f.pdf", "https://www.jf-cmca.jp/attach/test/r02/1j_seikai/2020g.pdf"],
    "R01": ["https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019a.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019b.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019c.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019d.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019e.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019f.pdf", "https://www.jf-cmca.jp/attach/test/h31/1j_seikai/2019g.pdf"],
    "H30": ["https://www.jf-cmca.jp/attach/test/h30/1j_seikai/a2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/b2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/c2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/d2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/e2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/f2018.pdf", "https://www.jf-cmca.jp/attach/test/h30/1j_seikai/g2018.pdf"],
    "H29": ["https://www.jf-cmca.jp/attach/test/h29/1j_seikai/a2017.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/b2017.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/c2017.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/d2017.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/e2017v2.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/f2017.pdf", "https://www.jf-cmca.jp/attach/test/h29/1j_seikai/g2017.pdf"],
    "H28": ["https://www.jf-cmca.jp/attach/test/h28/1j_seikai/a2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/b2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/c2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/d2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/e2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/f2016.pdf", "https://www.jf-cmca.jp/attach/test/h28/1j_seikai/g2016.pdf"],
}


def download(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 1000:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as res:
        path.write_bytes(res.read())
    time.sleep(0.08)


def extract_text(path: Path) -> str:
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            parts.append(text)
    text = "\n".join(parts)
    text = text.replace("\u3000", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_questions(text: str):
    marker = re.compile(r"(?:^|\n)\s*第\s*(\d{1,2})\s*問")
    matches = list(marker.finditer(text))
    items = []
    for i, m in enumerate(matches):
        no = int(m.group(1))
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        body = re.sub(r"\n?\s*第\s*\d{1,2}\s*問\s*", f"第{no}問\n", body, count=1)
        if len(body) > 20:
            items.append((no, body))
    return items


def parse_choices(body: str):
    block = body.split("〔解答群〕", 1)[1] if "〔解答群〕" in body else body
    lines = [line.strip() for line in block.splitlines() if line.strip()]
    choices = []
    current = ""
    for line in lines:
        line = re.sub(r"^\d+$", "", line).strip()
        if not line:
            continue
        m = re.match(r"^([アイウエオカキクケコ])\s+(.+)", line)
        if m:
            if current:
                choices.append(current.strip())
            current = f"{m.group(1)} {m.group(2).strip()}"
        elif current and not re.match(r"^第\s*\d+\s*問", line):
            current += " " + line
    if current:
        choices.append(current.strip())
    return choices


def parse_answers(text: str):
    rows = {}
    current_no = None
    for line in text.splitlines():
        line = line.strip()
        m = re.search(r"第\s*(\d{1,2})\s*問\s+(?:-\s+|設問\s*(\d+)\s+)?([アイウエオカキクケコ])\s+\d+", line)
        if m:
            current_no = int(m.group(1))
            label = f"設問{m.group(2)}" if m.group(2) else ""
            rows.setdefault(current_no, []).append((label, m.group(3)))
            continue
        m = re.search(r"設問\s*(\d+)\s+([アイウエオカキクケコ])\s+\d+", line)
        if m and current_no:
            rows.setdefault(current_no, []).append((f"設問{m.group(1)}", m.group(2)))
    answers = {}
    for no, vals in rows.items():
        if len(vals) == 1 and not vals[0][0]:
            answers[no] = vals[0][1]
        else:
            answers[no] = " / ".join(f"{label} {mark}".strip() for label, mark in vals)
    return answers


def full_answer(answer: str, choices):
    if re.fullmatch(r"[アイウエオカキクケコ]", answer or ""):
        for choice in choices:
            if choice.startswith(answer + " "):
                return choice
    return answer


def main() -> int:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    existing = {"questions": [], "failures": []}
    if TARGET_SUBJECTS and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text(encoding="utf-8"))
    records = [item for item in existing.get("questions", []) if item.get("subject") not in TARGET_SUBJECTS]
    failures = [
        item
        for item in existing.get("failures", [])
        if item.get("subject") not in TARGET_SUBJECTS
        and FAILURE_SUBJECT_MAP.get(item.get("subject"), item.get("subject")) not in TARGET_SUBJECTS
    ]
    for year_name, era, base, make_name in YEARS:
        for si, (subject_id, subject_name, letter) in enumerate(SUBJECTS):
            if TARGET_SUBJECTS and subject_id not in TARGET_SUBJECTS:
                continue
            paper_url = base + make_name(letter)
            answer_url = ANSWER_PDFS[era][si]
            paper_path = PDF_DIR / era / f"{subject_id}.pdf"
            answer_path = PDF_DIR / era / f"{subject_id}_answer.pdf"
            try:
                download(paper_url, paper_path)
                download(answer_url, answer_path)
                paper_text = extract_text(paper_path)
                answer_text = extract_text(answer_path)
                answers = parse_answers(answer_text)
                questions = split_questions(paper_text)
                for no, body in questions:
                    choices = parse_choices(body)
                    answer = answers.get(no, "")
                    records.append({
                        "id": f"{era}-{subject_id}-{no:02d}",
                        "year": year_name,
                        "era": era,
                        "subject": subject_id,
                        "subjectName": subject_name,
                        "no": no,
                        "question": body,
                        "answer": full_answer(answer, choices),
                        "answerMark": answer,
                        "choices": choices,
                        "sourcePdf": paper_url,
                        "answerPdf": answer_url,
                    })
                print(f"{era} {subject_id}: {len(questions)} questions, {len(answers)} answers")
            except Exception as exc:
                failures.append({"era": era, "subject": subject_id, "error": str(exc), "url": paper_url})
                print(f"ERROR {era} {subject_id}: {exc}", file=sys.stderr)
    OUT_FILE.write_text(json.dumps({"questions": records, "failures": failures}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT_FILE} questions={len(records)} failures={len(failures)}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
