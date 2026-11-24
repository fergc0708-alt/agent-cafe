import os
from plugins import load
os.makedirs("plugs", exist_ok=True)
open("plugs/p1.py", "w").write("VALUE = 41 + 1\ndef f():\n    return VALUE\n")
m = load("plugs/p1.py")
assert m.VALUE == 42 and m.f() == 42
print("graded ok")
