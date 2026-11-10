from __future__ import annotations

import csv
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "원문"
OUTPUT_CSV = ROOT / "data" / "문항목록.csv"

HEADERS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]


def normalize_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def append_text(current: str, text: str) -> str:
    text = text.strip()
    if not text:
        return current
    if not current:
        return text
    return f"{current}\n{text}"


def parse_deadline(line: str) -> str:
    match = re.search(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.", line)
    if not match:
        raise ValueError(f"제출기한을 찾지 못했습니다: {line}")
    year, month, day = match.groups()
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"


def parse_header(line: str) -> tuple[str, str]:
    match = re.match(r"(.+?)\s+(.+?)\s+의원실\s+자료요구서$", line)
    if not match:
        raise ValueError(f"첫 줄 형식이 맞지 않습니다: {line}")
    return match.group(1), match.group(2)


def finish_item(item: dict[str, str] | None, rows: list[dict[str, str]]) -> None:
    if item is not None:
        rows.append(item)


def parse_pdf(path: Path) -> list[dict[str, str]]:
    reader = PdfReader(str(path))
    lines: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        lines.extend(normalize_line(line) for line in text.splitlines())
    lines = [line for line in lines if line]

    if len(lines) < 2:
        raise ValueError(f"내용 줄이 부족합니다: {path.name}")

    committee, member = parse_header(lines[0])
    deadline = parse_deadline(lines[1])

    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    last_field = "요구내용"

    for line in lines[2:]:
        if line.startswith("수신:") or line.startswith("담당 보좌관:") or line == "끝.":
            continue

        number_match = re.match(r"^(\d+)\.\s*(.*)$", line)
        detail_match = re.match(r"^([가나])\.\s*(.*)$", line)

        if number_match:
            finish_item(current, rows)
            current = {
                "파일명": path.name,
                "위원회": committee,
                "의원": member,
                "제출기한": deadline,
                "문항번호": number_match.group(1),
                "요구내용": number_match.group(2).strip(),
                "세부항목": "",
                "비고": "",
                "_원문": line,
            }
            last_field = "요구내용"
            continue

        if current is None:
            continue

        if detail_match:
            current["세부항목"] = append_text(
                current["세부항목"],
                f"{detail_match.group(1)}. {detail_match.group(2).strip()}",
            )
            current["_원문"] = append_text(current["_원문"], line)
            last_field = "세부항목"
            continue

        if line.startswith("※"):
            current["비고"] = append_text(current["비고"], line)
            current["_원문"] = append_text(current["_원문"], line)
            last_field = "비고"
            continue

        current[last_field] = append_text(current[last_field], line)
        current["_원문"] = append_text(current["_원문"], line)

    finish_item(current, rows)
    return rows


def expected_count_from_filename(name: str) -> int | None:
    match = re.search(r"_(\d+)문항\.pdf$", name)
    return int(match.group(1)) if match else None


def is_continuous(numbers: list[int]) -> bool:
    return numbers == list(range(1, len(numbers) + 1))


def main() -> None:
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    all_rows: list[dict[str, str]] = []
    summaries: list[dict[str, str]] = []

    for path in pdf_paths:
        rows = parse_pdf(path)
        all_rows.extend(rows)

        numbers = [int(row["문항번호"]) for row in rows]
        expected = expected_count_from_filename(path.name)
        continuous = is_continuous(numbers)
        matched = expected == len(rows) == (numbers[-1] if numbers else 0) and continuous
        summaries.append(
            {
                "파일명": path.name,
                "파일명의 문항 수": str(expected) if expected is not None else "",
                "뽑은 문항 수": str(len(rows)),
                "마지막 번호": str(numbers[-1] if numbers else ""),
                "번호 연속": "O" if continuous else "X",
                "일치(O/X)": "O" if matched else "X",
            }
        )

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=HEADERS)
        writer.writeheader()
        for row in all_rows:
            writer.writerow({header: row[header] for header in HEADERS})

    print("확인표")
    print("파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X)")
    for row in summaries:
        print(
            " | ".join(
                [
                    row["파일명"],
                    row["파일명의 문항 수"],
                    row["뽑은 문항 수"],
                    row["마지막 번호"],
                    row["번호 연속"],
                    row["일치(O/X)"],
                ]
            )
        )

    print()
    print("세부항목·비고가 있는 문항 3개 원문 PDF 대조")
    shown = 0
    for row in all_rows:
        if row["세부항목"] and row["비고"]:
            print("---")
            print(f"파일명: {row['파일명']}")
            print(f"문항번호: {row['문항번호']}")
            print(f"원문 PDF: {row['_원문']}")
            print(
                "CSV 분해: "
                f"요구내용={row['요구내용']} | "
                f"세부항목={row['세부항목']} | "
                f"비고={row['비고']}"
            )
            shown += 1
            if shown == 3:
                break


if __name__ == "__main__":
    main()
