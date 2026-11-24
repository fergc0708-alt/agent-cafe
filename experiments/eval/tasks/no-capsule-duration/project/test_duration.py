from duration import parse_duration

assert parse_duration("45m") == 2700
assert parse_duration("1h30m") == 5400, parse_duration("1h30m")
print("ok")
