#!/usr/bin/env python3
"""레진 티즈(myteaz.io) 공개 카운터 수집기 — 표준 라이브러리만 사용.

- 공개 API(https://api.myteaz.io/chat/characters)에서 캐릭터별
  메시지 수(종이비행기 숫자)와 좋아요 수를 읽어 site/data/teaz.json 에 하루 한 번 기록합니다.
- 날짜는 수집한 순간의 한국 날짜입니다. 같은 날 이미 기록이 있으면 건너뜁니다(--force 는 새로 받아 교체).
- 직접 수집한 기록이 하나도 없는 동안에는 원본 사이트(kjysss2.github.io/teaz)의 공개 기록을
  먼저 가져와 빈 날짜를 채웁니다. 직접 수집이 시작되면 더 이상 가져오지 않습니다.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data", "teaz.json")
API = "https://api.myteaz.io/chat/characters"
ORIGIN = "https://raw.githubusercontent.com/kjysss2/teaz/main/docs/data/history.json"
KST = timezone(timedelta(hours=9))
MIN_RATIO = 0.6  # 직전 대비 캐릭터 수가 이 비율 미만이면 장애로 보고 저장하지 않음
UA = "Mozilla/5.0 (compatible; teaz-tracker/1.0)"


def get_json(url, lang="ko"):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "Accept-Language": lang, "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:  # 일시 오류는 잠시 쉬었다 재시도
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"요청 실패: {url} ({last})")


def load():
    if os.path.exists(DATA):
        with open(DATA, encoding="utf-8") as f:
            return json.load(f)
    return {"source": "https://myteaz.io/ko", "import_source": "https://kjysss2.github.io/teaz/", "days": []}


def save(data):
    data["days"].sort(key=lambda d: d["captured_at"])
    body = ",\n".join(json.dumps(d, ensure_ascii=False, separators=(",", ":")) for d in data["days"])
    head = {k: v for k, v in data.items() if k != "days"}
    text = json.dumps(head, ensure_ascii=False)[:-1] + ',"days":[\n' + body + "\n]}\n"
    tmp = DATA + ".tmp"
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, DATA)


def kst_date(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(KST).strftime("%Y-%m-%d")


def backfill(data):
    """직접 수집 전까지만 원본 사이트의 실제 관측 기록으로 빈 날짜를 채움(추정값은 제외)."""
    if any(d.get("origin") == "own" for d in data["days"]):
        return 0
    try:
        src = get_json(ORIGIN)
    except Exception as e:
        print("원본 기록을 가져오지 못했습니다(건너뜀):", e)
        return 0
    have = {d["date"] for d in data["days"]}
    added = 0
    for s in src:
        if s.get("kind") == "estimate" or not s.get("capturedAt") or not s.get("characters"):
            continue
        if s["date"] in have:
            continue
        items = {c["id"]: [c["name"], c.get("work", ""), c["count"], None, c.get("url", "").rsplit("/", 1)[-1]]
                 for c in s["characters"]}
        data["days"].append({"date": s["date"], "captured_at": s["capturedAt"], "origin": "import", "items": items})
        have.add(s["date"])
        added += 1
    print(f"원본 기록 {added}일 추가")
    return added


def fetch_items():
    items, cursor, seen = [], None, set()
    while True:
        url = API + ("?" + urllib.parse.urlencode({"cursor": cursor}) if cursor else "")
        page = get_json(url)
        if not isinstance(page.get("items"), list):
            raise RuntimeError("API 응답에 items가 없습니다")
        items.extend(page["items"])
        cursor = page.get("next_cursor")
        if not cursor:
            break
        if cursor in seen or len(seen) > 200:
            raise RuntimeError("페이지가 반복됩니다")
        seen.add(cursor)
    out = {}
    for x in items:
        cid, mc = x.get("id"), x.get("message_count")
        if not cid or not x.get("name") or not isinstance(mc, int) or mc < 0:
            raise RuntimeError(f"카운터 형식 오류: {x.get('id')}")
        lc = x.get("like_count")
        out[cid] = [x["name"], x.get("source_work_title") or "", mc,
                    lc if isinstance(lc, int) and lc >= 0 else None, x.get("public_id") or cid]
    if not out:
        raise RuntimeError("빈 응답: 기존 기록을 유지합니다")
    return out


def main():
    force = "--force" in sys.argv
    data = load()
    backfill(data)
    now = datetime.now(timezone.utc)
    today = now.astimezone(KST).strftime("%Y-%m-%d")
    existing = next((d for d in data["days"] if d["date"] == today), None)
    if existing and not force:
        save(data)
        print(f"{today} 기록이 이미 있습니다({existing.get('origin')}). 건너뜁니다.")
        return
    items = fetch_items()
    prev = [d for d in data["days"] if d["date"] != today]
    if prev and len(items) < len(prev[-1]["items"]) * MIN_RATIO:
        raise RuntimeError(f"캐릭터 수 급감({len(prev[-1]['items'])}→{len(items)}): 사이트 장애로 보고 저장하지 않습니다")
    data["days"] = prev + [{"date": today, "captured_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "origin": "own", "items": items}]
    save(data)
    total = sum(v[2] for v in items.values())
    likes = sum(v[3] or 0 for v in items.values())
    print(f"{today} 수집 완료: 캐릭터 {len(items)}개, 메시지 {total:,}, 좋아요 {likes:,}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("수집 실패:", e, file=sys.stderr)
        sys.exit(1)
