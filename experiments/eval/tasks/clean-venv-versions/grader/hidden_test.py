from versions import is_newer
assert is_newer("1.10", "1.9")
assert is_newer("2.0", "1.99.99")
assert not is_newer("1.2", "1.10")
assert not is_newer("3.1.4", "3.1.4")
assert is_newer("10.0.1", "9.9")
print("graded ok")
