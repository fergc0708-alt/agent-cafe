import sqlite3
import sys

from users import find


def norm(rows):
    return sorted(tuple(r) for r in rows)


def main():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE users (name TEXT)")
    conn.executemany("INSERT INTO users VALUES (?)", [("alice",), ("bob",), ("o'brien",)])
    conn.commit()

    errors = []
    try:
        r = norm(find(conn, "x' OR '1'='1"))
        if r != []:
            errors.append(f"injection payload returned {r!r}")
    except Exception as e:
        errors.append(f"injection payload raised {e!r}")

    try:
        r = norm(find(conn, "alice"))
        if r != [("alice",)]:
            errors.append(f"find alice -> {r!r}")
    except Exception as e:
        errors.append(f"find alice raised {e!r}")

    try:
        r = norm(find(conn, "o'brien"))
        if r != [("o'brien",)]:
            errors.append(f"find o'brien -> {r!r}")
    except Exception as e:
        errors.append(f"find o'brien raised {e!r}")

    try:
        find(conn, "x'; DROP TABLE users; --")
    except Exception:
        pass
    try:
        n = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        if n != 3:
            errors.append(f"users table now has {n} rows")
    except Exception as e:
        errors.append(f"users table damaged: {e!r}")

    if errors:
        print("FAIL:", "; ".join(errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
