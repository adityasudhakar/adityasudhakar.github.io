#!/usr/bin/env python3

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


GRAPHQL_URL = "https://api.github.com/graphql"
QUERY = """
query($login:String!,$from:DateTime!,$to:DateTime!){
  user(login:$login){
    contributionsCollection(from:$from,to:$to){
      contributionCalendar{
        weeks{
          contributionDays{
            date
            contributionCount
          }
        }
      }
    }
  }
}
""".strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh GitHub contribution data for the static site."
    )
    parser.add_argument("--username", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    return parser.parse_args()


def daterange(start: dt.date, end: dt.date):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += dt.timedelta(days=1)


def fetch_window(token: str, username: str, start: dt.date, end: dt.date) -> dict[str, int]:
    payload = json.dumps(
        {
            "query": QUERY,
            "variables": {
                "login": username,
                "from": f"{start.isoformat()}T00:00:00Z",
                "to": f"{end.isoformat()}T23:59:59Z",
            },
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        GRAPHQL_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "adityasudhakar.github.io-contributions-updater",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GitHub API request failed: {exc.code} {details}") from exc

    if body.get("errors"):
        raise RuntimeError(f"GitHub API returned errors: {body['errors']}")

    user = body["data"]["user"]
    if user is None:
        raise RuntimeError(f"GitHub user not found: {username}")

    counts: dict[str, int] = {}
    weeks = user["contributionsCollection"]["contributionCalendar"]["weeks"]
    for week in weeks:
        for day in week["contributionDays"]:
            counts[day["date"]] = int(day["contributionCount"])
    return counts


def year_windows(start: dt.date, end: dt.date):
    year = start.year
    while year <= end.year:
        window_start = max(start, dt.date(year, 1, 1))
        window_end = min(end, dt.date(year, 12, 31))
        yield window_start, window_end
        year += 1


def build_payload(username: str, start: dt.date, end: dt.date, counts: dict[str, int]) -> dict:
    series = []
    running = 0
    first_active_date = None
    peak_date = None
    peak_count = -1

    for current in daterange(start, end):
        date_key = current.isoformat()
        count = counts.get(date_key, 0)
        running += count
        if count > 0 and first_active_date is None:
            first_active_date = date_key
        if count > peak_count:
            peak_count = count
            peak_date = date_key
        series.append(
            {
                "date": date_key,
                "count": count,
                "cumulative": running,
            }
        )

    last_90 = sum(point["count"] for point in series[-90:])
    last_365 = sum(point["count"] for point in series[-365:])

    return {
        "generatedAt": end.isoformat(),
        "source": "GitHub GraphQL contributionCalendar",
        "username": username,
        "summary": {
            "firstActiveDate": first_active_date,
            "totalContributions": running,
            "contributionsLast90Days": last_90,
            "contributionsLast365Days": last_365,
            "peakDay": {
                "date": peak_date,
                "count": max(peak_count, 0),
            },
        },
        "series": series,
    }


def main() -> int:
    args = parse_args()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN is required")

    start = dt.date.fromisoformat(args.start_date)
    today = dt.datetime.now(dt.timezone.utc).date()

    counts: dict[str, int] = {}
    for window_start, window_end in year_windows(start, today):
        counts.update(fetch_window(token, args.username, window_start, window_end))

    payload = build_payload(args.username, start, today, counts)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
