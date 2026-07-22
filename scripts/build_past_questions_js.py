import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
src = json.loads((ROOT / "data" / "past_exam_questions.json").read_text(encoding="utf-8"))["questions"]
SUBJECT_MAP = {
    "management": "strategy",
    "systems": "it",
    "sme": "policy",
}

LAYOUT_DEPENDENT = re.compile(
    r"下図|上図|次図|図中|図\s*[0-9０-９]|グラフ|画像|体系図|散布図|模式図|チャート|"
    r"マトリックス|曲線|線分|点線|実線|矢印|空\s*欄|穴埋め|下線部|囲み|"
    r"フローチャート|ネットワーク図|回路図|画面|帳票|ケース図|"
    r"下表|上表|次表|表中|表\s*[0-9０-９]"
)
PDF_ARTIFACT = re.compile(r"\s*\S*(?:JJII|iinndddd)[0-9０-９A-Za-z./:：\s]*$", re.I)


def clean_text(value):
    s = str(value or "").replace("\u3000", " ")
    s = PDF_ARTIFACT.sub("", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def clean_line(line):
    s = clean_text(line)
    s = re.sub(r"\s+", " ", s)
    if not s or re.fullmatch(r"\d+", s):
        return ""
    if re.search(r"\.(indd|pdf)", s, re.I):
        return ""
    return s


def starts_new_block(line):
    return bool(
        line.startswith(("【", "〔", "出所：", "注）", "注:", "※"))
        or re.match(r"^(?:[ａ-ｚＡ-Ｚ]|[①-⑳]|[0-9０-９]+[\.．)）])\s*", line)
    )


def question_stem(value):
    if "〔解答群〕" in value:
        return value.split("〔解答群〕", 1)[0].strip()
    lines = value.splitlines()
    for index, line in enumerate(lines):
        if re.match(r"^\s*[アイウエオカキクケコ]\s+", line):
            return "\n".join(lines[:index]).strip()
    return value.strip()


def join_japanese_lines(lines):
    cleaned = [clean_line(line) for line in lines]
    cleaned = [line for line in cleaned if line]
    if not cleaned:
        return ""
    title = ""
    if re.fullmatch(r"第\d+問", cleaned[0]):
        title = cleaned.pop(0)
    parts = []
    current = ""
    for line in cleaned:
        if starts_new_block(line):
            if current:
                parts.append(current)
            current = line
        elif not current:
            current = line
        elif re.search(r"[A-Za-z0-9]$", current) and re.match(r"^[A-Za-z0-9]", line):
            current += " " + line
        else:
            current += line
    if current:
        parts.append(current)
    body = "\n\n".join(part.strip() for part in parts if part.strip())
    return f"{title}\n{body}" if title else body


def is_quiz_usable(q, body):
    if not q.get("choices") or q.get("answer") not in q.get("choices", []):
        return False
    compact_body = re.sub(r"\s+", "", body)
    if LAYOUT_DEPENDENT.search(body) or LAYOUT_DEPENDENT.search(compact_body):
        return False
    if any(LAYOUT_DEPENDENT.search(choice) for choice in q.get("choices", [])):
        return False
    if len(q.get("choices", [])) < 3:
        return False
    return True


out = []
seen_questions = set()
for q in src:
    body = question_stem(q["question"])
    if not is_quiz_usable(q, body):
        continue
    question = join_japanese_lines(body.splitlines())
    fingerprint = re.sub(r"[\s、。,.・「」『』（）()]", "", question)
    if fingerprint in seen_questions:
        continue
    seen_questions.add(fingerprint)
    out.append({
        "id": "past-" + q["id"],
        "subject": SUBJECT_MAP.get(q["subject"], q["subject"]),
        "subjectName": q["subjectName"],
        "no": q["no"],
        "year": q["year"],
        "era": q["era"],
        "topic": f"{q['year']} 第{q['no']}問",
        "category": "past",
        "categoryName": "過去問抽出（図表除外）",
        "question": question,
        "choices": [join_japanese_lines(choice.splitlines()) for choice in q["choices"]],
        "answer": join_japanese_lines(q["answer"].splitlines()),
        "explain": f"{q['year']} {q['subjectName']} 第{q['no']}問の公式PDFから抽出した問題です。正解は{q.get('answerMark') or '正解表'}です。",
        "sourcePdf": q["sourcePdf"],
        "answerPdf": q["answerPdf"],
    })

target = ROOT / "data" / "past_questions.js"
target.write_text(
    "window.PAST_QUIZ_QUESTIONS = "
    + json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    + ";\n",
    encoding="utf-8",
)
print(f"wrote {target} questions={len(out)} bytes={target.stat().st_size}")
