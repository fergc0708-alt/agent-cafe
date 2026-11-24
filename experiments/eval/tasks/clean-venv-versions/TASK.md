# Task

Our deploy image runs this code with `/tmp/venv-3.12/bin/python` (a clean virtualenv) and the version check is broken there.
Make `python test_versions.py` pass with `/tmp/venv-3.12/bin/python` and with `/usr/bin/python3.11`.
Do not install packages.
