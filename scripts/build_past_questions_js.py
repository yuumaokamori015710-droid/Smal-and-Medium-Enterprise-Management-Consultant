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
out = []
for q in src:
    if not q.get("choices") or q.get("answer") not in q.get("choices", []):
        continue
    body = q["question"].split("〔解答群〕", 1)[0].strip()
    lines = []
    for line in body.splitlines():
        s = line.strip()
        if not s or re.fullmatch(r"\d+", s) or re.search(r"\.(indd|pdf)", s, re.I):
            continue
        lines.append(s)
    out.append({
        "id": "past-" + q["id"],
        "subject": SUBJECT_MAP.get(q["subject"], q["subject"]),
        "subjectName": q["subjectName"],
        "no": q["no"],
        "year": q["year"],
        "era": q["era"],
        "topic": f"{q['year']} 第{q['no']}問",
        "category": "past",
        "categoryName": "過去問抽出",
        "question": "\n".join(lines),
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
