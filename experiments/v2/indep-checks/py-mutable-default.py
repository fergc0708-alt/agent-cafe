import sys

from bag import add


def main():
    errors = []
    r1 = add(1)
    if r1 != [1]:
        errors.append(f"add(1) -> {r1!r}")
    r2 = add(2)
    if r2 != [2]:
        errors.append(f"add(2) -> {r2!r}")
    if r1 is r2:
        errors.append("two default calls returned the same list object")
    if r1 != [1]:
        errors.append(f"first result changed to {r1!r}")
    # explicit bucket still appended to
    b = ["a"]
    r3 = add("b", b)
    if r3 != ["a", "b"] or b != ["a", "b"]:
        errors.append(f"explicit bucket -> {r3!r}, {b!r}")
    r4 = add(3)
    if r4 != [3]:
        errors.append(f"add(3) -> {r4!r}")
    if errors:
        print("FAIL:", "; ".join(errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
