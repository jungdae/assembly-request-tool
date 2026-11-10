from __future__ import annotations

import csv
import re
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
RULES_CSV = BASE_DIR / "data" / "배분기준표_소관키워드_304건.csv"
TEST_CSV = BASE_DIR / "data" / "시험_요구문항_40건.csv"
GENERIC_KEYWORDS = {
    "예산",
    "성과지표",
    "언론",
    "언론보도",
}


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text.lower())


def _contains(text: str, keyword: str) -> bool:
    return _normalize(keyword) in _normalize(text)


def _load_rules(path: Path = RULES_CSV) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def rank_departments(question: str, rules_path: Path = RULES_CSV) -> list[tuple[str, float]]:
    """요구 문항을 넣으면 점수가 높은 소관 과부터 반환한다."""
    scores: dict[str, float] = {}
    matches: list[dict[str, str]] = []

    for rule in _load_rules(rules_path):
        keyword = rule["키워드"].strip()
        if not keyword or not _contains(question, keyword):
            continue

        excluded_words = [
            word.strip()
            for word in rule["제외어"].split("|")
            if word.strip()
        ]
        if any(_contains(question, word) for word in excluded_words):
            continue

        matches.append(rule)

    has_specific_match = any(rule["키워드"].strip() not in GENERIC_KEYWORDS for rule in matches)

    for rule in matches:
        keyword = rule["키워드"].strip()
        department = rule["과"].strip()
        priority = int(rule["우선순위"] or 1)
        score = priority * 10 + min(len(keyword), 20) / 10

        if has_specific_match and keyword in GENERIC_KEYWORDS:
            score *= 0.1

        # 긴 복합 키워드는 단어 하나보다 소관성이 강하다.
        if " " in keyword or len(keyword) >= 5:
            score += 2

        scores[department] = scores.get(department, 0) + score

    if not scores:
        return []

    return sorted(scores.items(), key=lambda item: (-item[1], item[0]))


def predict_department(question: str) -> str | None:
    """요구 문항 하나를 넣으면 1순위 소관 과명을 알려 준다."""
    ranked = rank_departments(question)
    return ranked[0][0] if ranked else None


def score_test(test_path: Path = TEST_CSV) -> tuple[int, int]:
    correct = 0
    total = 0

    with test_path.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            total += 1
            predicted = predict_department(row["요구내용"])
            if predicted == row["정답_배분과"]:
                correct += 1

    return correct, total


if __name__ == "__main__":
    correct_count, total_count = score_test()
    print(f"1순위 정답 수: {correct_count}/{total_count}")
