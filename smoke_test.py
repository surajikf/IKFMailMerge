import sys
from urllib.parse import urljoin

import requests


DEFAULT_BASE_URL = "http://localhost:8000"


def check(url: str, expected_status: int = 200):
    response = requests.get(url, timeout=15)
    ok = response.status_code == expected_status
    return ok, response


def main():
    base_url = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else DEFAULT_BASE_URL
    targets = [
        ("/", 200),
        ("/ikf.png", 200),
        ("/api", 200),
        ("/api/health", 200),
        ("/api/ready", 200),
        ("/api/settings", 200),
    ]

    failures = []
    print(f"Smoke testing {base_url}")

    for path, expected in targets:
        ok, response = check(urljoin(base_url + "/", path.lstrip("/")), expected)
        content_type = response.headers.get("content-type", "")
        print(f"{response.status_code} {path} [{content_type}]")
        if not ok:
            failures.append(path)

    if failures:
        print("\nFAILED:")
        for path in failures:
            print(f"- {path}")
        sys.exit(1)

    print("\nSmoke test passed.")


if __name__ == "__main__":
    main()
