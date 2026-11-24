# Task

Our CI moved to Python 3.13 and `python test_plugins.py` fails there.
Make it pass with `/usr/bin/python3.13` and keep it working with `/usr/bin/python3.11`.
Keep `load(path)` returning the loaded module. Do not install packages.
