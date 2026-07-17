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
    r"図|表|下図|下表|上図|次図|グラフ|画像|体系図|散布図|模式図|チャート|"
    r"マトリックス|曲線|線分|点線|実線|矢印|空\s*欄|穴埋め|下線部|囲み|"
    r"フローチャート|ネットワーク図|回路|画面|帳票|資料\s*\d|ケース図"
)


def clean_line(line):
    s = line.strip()
    s = re.sub(r"\s+", " ", s)
    if not s or re.fullmatch(r"\d+", s):
        return ""
    if re.search(r"\.(indd|pdf)", s, re.I):
        return ""
    return s


def join_japanese_lines(lines):
    cleaned = [clean_line(line) for line in lines]
    cleaned = [line for line in cleaned if line]
    if not cleaned:
        return ""
    title = ""
    if re.fullmatch(r"第\d+問", cleaned[0]):
        title = cleaned.pop(0)
    parts = []
    for line in cleaned:
        if line.startswith(("出所：", "注）", "注:", "※")):
            parts.append("\n" + line)
        elif not parts:
            parts.append(line)
        elif re.search(r"[A-Za-z0-9]$", parts[-1]) and re.match(r"^[A-Za-z0-9]", line):
            parts[-1] += " " + line
        else:
            parts[-1] += line
    body = "\n".join(part.strip() for part in parts if part.strip())
    return f"{title}\n{body}" if title else body


def is_quiz_usable(q, body):
    if not q.get("choices") or q.get("answer") not in q.get("choices", []):
        return False
    if LAYOUT_DEPENDENT.search(body):
        return False
    if any(LAYOUT_DEPENDENT.search(choice) for choice in q.get("choices", [])):
        return False
    if len(q.get("choices", [])) < 3:
        return False
    return True


out = []
for q in src:
    body = q["question"].split("〔解答群〕", 1)[0].strip()
    if not is_quiz_usable(q, body):
        continue
    question = join_japanese_lines(body.splitlines())
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
        "choices": q["choices"],
        "answer": q["answer"],
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
