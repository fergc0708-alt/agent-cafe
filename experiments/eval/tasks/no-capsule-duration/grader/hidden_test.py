from duration import parse_duration
for t, v in {"1h30m": 5400, "45m": 2700, "2h": 7200, "90s": 90, "1h2m3s": 3723, "0m": 0}.items():
    assert parse_duration(t) == v, (t, parse_duration(t))
print("graded ok")
