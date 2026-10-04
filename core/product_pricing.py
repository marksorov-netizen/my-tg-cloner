"""Price snapshot for the server photo worker; same maximum-base policy as UI."""
import math
import re


def prices(text, req):
    found = []
    patterns = [r"(?:оптом|опт|от\s*\d+\s*(?:шт|пар|ед|уп))\s*[:\-—]?\s*(\d[\d\s.,]*)",
                r"(?:дроп|дропшиппинг)\s*[:\-—]?\s*(\d[\d\s.,]*)",
                r"(?:цена|стоимость|розница|в\s*розницу|прайс|штучно)\s*[:\-—]?\s*(\d[\d\s.,]*)",
                r"(\d[\d\s.,]*)\s*(?:руб|рублей|р\b|₽|\$|€|usd)"]
    for pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.I):
            raw = re.sub(r"\s+", "", match.group(1)).replace(",", ".")
            number = re.match(r"\d+(?:\.\d+)?", raw)
            if number and 50 <= float(number.group()) <= 10_000_000:
                found.append(float(number.group()))
    found.extend(float(m) for m in re.findall(r"\b([1-9]\d{2,5})\b", text)
                 if 150 <= float(m) <= 1_000_000 and int(m) not in (2024, 2025, 2026, 2027))
    if not found:
        return {}
    base = max(found)
    rounded = lambda pct: math.floor(base * (1 + pct / 100) + 0.5)
    result = {"retail": rounded(req.single_markup if req.price_mode == "single" else req.retail_markup)}
    if req.price_mode != "single":
        result["wholesale"] = rounded(req.wholesale_markup)
    if req.price_mode == "three_tier":
        result["drop"] = rounded(req.drop_markup)
    return result
