import os
import sys
import tempfile

from reader import header


def main():
    errors = []
    # Shipped file (starts with a BOM).
    h = header("data.csv")
    if h != ["name", "price"]:
        errors.append(f"data.csv header {h!r}")

    with tempfile.TemporaryDirectory() as d:
        bom = os.path.join(d, "bom.csv")
        with open(bom, "wb") as f:
            f.write(b"\xef\xbb\xbfname,qty\r\nx,1\r\n")
        h = header(bom)
        if h != ["name", "qty"]:
            errors.append(f"BOM file header {h!r}")

        plain = os.path.join(d, "plain.csv")
        with open(plain, "wb") as f:
            f.write("name,ciudad\nñ,1\n".encode("utf-8"))
        h = header(plain)
        if h != ["name", "ciudad"]:
            errors.append(f"plain file header {h!r}")

    if errors:
        print("FAIL:", "; ".join(errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
