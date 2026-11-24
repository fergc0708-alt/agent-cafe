from plugins import load

open("hello_plugin.py", "w").write("NAME = \"hello\"\n")
assert load("hello_plugin.py").NAME == "hello"
print("ok")
