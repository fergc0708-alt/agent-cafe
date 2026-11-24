import imp
import cgi


def load(path):
    return imp.load_source("plugin", path)


def content_type(value):
    return cgi.parse_header(value)
