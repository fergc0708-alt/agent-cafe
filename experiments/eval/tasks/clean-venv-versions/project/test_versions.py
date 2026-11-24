from versions import is_newer

assert is_newer("1.10", "1.9")
assert not is_newer("1.2", "1.10")
print("ok")
