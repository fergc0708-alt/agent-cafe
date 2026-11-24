import imp


def load(path):
    """Load a plugin module from a .py file path."""
    return imp.load_source("plugin", path)
