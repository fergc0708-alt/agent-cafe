from distutils.version import LooseVersion


def is_newer(a, b):
    """True if version string a is newer than b, e.g. is_newer("1.10", "1.9")."""
    return LooseVersion(a) > LooseVersion(b)
