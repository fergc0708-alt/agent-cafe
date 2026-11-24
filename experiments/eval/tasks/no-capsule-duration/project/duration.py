import re


def parse_duration(text):
    """Parse durations like "1h30m", "45m", "2h", "90s", "1h2m3s" into seconds."""
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", text)
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 60 + mi * 60 + s
