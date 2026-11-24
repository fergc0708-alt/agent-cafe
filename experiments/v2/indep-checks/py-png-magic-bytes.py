import os
import sys
import tempfile
import zlib
import struct


def make_png():
    def chunk(t, data):
        c = t + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    idat = zlib.compress(b"\x00\x00")
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    try:
        from detect import kind
    except Exception as e:  # e.g. ModuleNotFoundError: imghdr
        print(f"FAIL: cannot import detect: {e!r}")
        return 1

    errors = []
    with tempfile.TemporaryDirectory() as d:
        cases = {
            "real.png": (make_png(), "png"),
            "sig_only.png": (b"\x89PNG\r\n\x1a\n", "png"),
            "jpeg.jpg": (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 20, None),
            "gif.gif": (b"GIF89a" + b"\x00" * 20, None),
            "text.png": (b"hello, not an image at all", None),
            "almost.png": (b"\x89PNG\r\n\x1a\x00" + b"\x00" * 20, None),
            "empty.bin": (b"", None),
        }
        for name, (data, want) in cases.items():
            p = os.path.join(d, name)
            with open(p, "wb") as f:
                f.write(data)
            try:
                got = kind(p)
            except Exception as e:
                errors.append(f"{name}: raised {e!r}")
                continue
            if got != want:
                errors.append(f"{name}: got {got!r}, want {want!r}")
    if errors:
        print("FAIL:", "; ".join(errors))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
