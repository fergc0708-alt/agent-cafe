// Upgrade-break capsules: each "before" uses an API that a newer runtime removed, so the evidence
// matrix itself says where the problem exists:
//   PROBLEM_NOT_REPRODUCED -> the old code still works in that environment (not affected)
//   PASS                   -> the old code breaks there AND this fix works there
//   FIX_FAILS              -> it breaks there and this fix does not work there either
// Every removal below was observed on real interpreters before writing the capsule (see the commit
// history: probes on Python 3.11/3.12/3.13 and Node 22/24). `detect` lets `cafe doctor` find the
// pattern in a project; it runs locally and nothing is uploaded.
import { CAPSULE_SCHEMA, type Capsule, type Detect } from "../core/capsule/capsule.ts";

const AUTHOR = "cafe-curator";
const PY = ["*.py"];
const JS = ["*.js", "*.cjs", "*.mjs", "*.ts", "*.mts", "*.cts"];

interface Spec {
  title: string;
  symptom: string;
  symptom_regex?: string;
  description: string;
  refs: string[];
  tags: string[];
  claims: Record<string, string>;
  before: Record<string, string>;
  after: Record<string, string>;
  check: string;
  proves: string;
  does_not_prove: string;
  detect: Detect;
}

function py(s: Spec): Capsule {
  return {
    schema: CAPSULE_SCHEMA,
    author: AUTHOR,
    title: s.title,
    problem: { symptom: s.symptom, description: s.description, tags: s.tags, refs: s.refs, ...(s.symptom_regex ? { symptom_regex: s.symptom_regex } : {}) },
    runtime: "python",
    applicability: { claims: s.claims },
    before: { files: s.before },
    after: { files: s.after },
    check: { run: ["python3", "check.py"], files: { "check.py": s.check }, timeout_ms: 10000 },
    limitations: { proves: s.proves, does_not_prove: s.does_not_prove },
    detect: s.detect,
  };
}

function node(s: Spec): Capsule {
  return {
    ...py(s),
    runtime: "node",
    check: { run: ["node", "check.cjs"], files: { "check.cjs": s.check }, timeout_ms: 10000 },
  };
}

const imp = (mod: string) => `^\\s*(import\\s+${mod}\\b|from\\s+${mod}\\s+import)`;

export const COMPAT: Record<string, Capsule> = {
  // ---------------- Python 3.13 (PEP 594 "dead batteries" and API removals) ----------------
  "py-imghdr-removed": py({
    title: "imghdr was removed in Python 3.13: detect PNG by its magic bytes",
    symptom: "ModuleNotFoundError: No module named 'imghdr'",
    symptom_regex: "No module named '?imghdr",
    description: "PEP 594 removed imghdr in 3.13. For a single format, compare the 8-byte signature; for many formats use a maintained library (e.g. filetype, Pillow).",
    refs: ["https://peps.python.org/pep-0594/", "https://docs.python.org/3/whatsnew/3.13.html"],
    tags: ["python", "imghdr", "pep594", "removed-3.13"],
    claims: { python: ">=3.0" },
    before: { "detect.py": "import imghdr\n\n\ndef kind(path):\n    return imghdr.what(path)\n" },
    after: { "detect.py": 'PNG = b"\\x89PNG\\r\\n\\x1a\\n"\n\n\ndef kind(path):\n    with open(path, "rb") as f:\n        return "png" if f.read(8) == PNG else None\n' },
    check:
      'from detect import kind\n\nwith open("photo.dat", "wb") as f:\n    f.write(b"\\x89PNG\\r\\n\\x1a\\n" + b"\\x00" * 24)\nwith open("notes.png", "wb") as f:\n    f.write(b"just text, not an image")\nassert kind("photo.dat") == "png", kind("photo.dat")\nassert kind("notes.png") is None, kind("notes.png")\n',
    proves: "PNG content is recognized by signature and a text file named .png is rejected.",
    does_not_prove: "Detection of formats other than PNG (imghdr knew ~15).",
    detect: { files: PY, pattern: imp("imghdr") },
  }),
  "py-pipes-removed": py({
    title: "pipes was removed in Python 3.13: use shlex.quote",
    symptom: "ModuleNotFoundError: No module named 'pipes'",
    symptom_regex: "No module named '?pipes",
    description: "pipes.quote was an alias of shlex.quote; the module is gone in 3.13 (PEP 594).",
    refs: ["https://peps.python.org/pep-0594/"],
    tags: ["python", "pipes", "shlex", "pep594", "removed-3.13"],
    claims: { python: ">=3.3" },
    before: { "shell.py": "import pipes\n\n\ndef cmd(path):\n    return 'cat ' + pipes.quote(path)\n" },
    after: { "shell.py": "import shlex\n\n\ndef cmd(path):\n    return 'cat ' + shlex.quote(path)\n" },
    check: "from shell import cmd\n\nassert cmd('a b.txt') == \"cat 'a b.txt'\", cmd('a b.txt')\nassert cmd(\"it's\") == \"cat 'it'\\\"'\\\"'s'\", cmd(\"it's\")\nassert cmd('plain') == 'cat plain'\n",
    proves: "Paths with spaces and quotes are quoted exactly as before.",
    does_not_prove: "Use of pipes.Template (no stdlib replacement; use subprocess pipelines).",
    detect: { files: PY, pattern: imp("pipes") },
  }),
  "py-cgi-parse-header": py({
    title: "cgi was removed in Python 3.13: parse Content-Type with email.message",
    symptom: "ModuleNotFoundError: No module named 'cgi'",
    symptom_regex: "No module named '?cgi",
    description: "cgi.parse_header is gone in 3.13 (PEP 594). email.message.Message parses header parameters the same way.",
    refs: ["https://peps.python.org/pep-0594/"],
    tags: ["python", "cgi", "http", "pep594", "removed-3.13"],
    claims: { python: ">=3.0" },
    before: { "headers.py": "import cgi\n\n\ndef content_type(value):\n    return cgi.parse_header(value)\n" },
    after: {
      "headers.py": "from email.message import Message\n\n\ndef content_type(value):\n    m = Message()\n    m['content-type'] = value\n    params = m.get_params()\n    return params[0][0], dict(params[1:])\n",
    },
    check: "from headers import content_type\n\nassert content_type('text/html; charset=utf-8') == ('text/html', {'charset': 'utf-8'}), content_type('text/html; charset=utf-8')\nassert content_type('application/json') == ('application/json', {})\nassert content_type('multipart/form-data; boundary=\"x y\"') == ('multipart/form-data', {'boundary': 'x y'})\n",
    proves: "Media type and parameters (including quoted ones) parse as cgi.parse_header did.",
    does_not_prove: "Replacements for cgi.FieldStorage (use a web framework or multipart parser).",
    detect: { files: PY, pattern: imp("cgi") },
  }),
  "py-unittest-makesuite": py({
    title: "unittest.makeSuite was removed in Python 3.13: use TestLoader().loadTestsFromTestCase",
    symptom: "AttributeError: module 'unittest' has no attribute 'makeSuite'",
    symptom_regex: "has no attribute 'makeSuite'",
    description: "makeSuite, findTestCases and getTestCaseNames were deprecated in 3.11 and removed in 3.13.",
    refs: ["https://docs.python.org/3/whatsnew/3.13.html"],
    tags: ["python", "unittest", "testing", "removed-3.13"],
    claims: { python: ">=3.0" },
    before: { "suite.py": "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_a(self):\n        pass\n\n    def test_b(self):\n        pass\n\n\ndef suite():\n    return unittest.makeSuite(T)\n" },
    after: { "suite.py": "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_a(self):\n        pass\n\n    def test_b(self):\n        pass\n\n\ndef suite():\n    return unittest.TestLoader().loadTestsFromTestCase(T)\n" },
    check: "import unittest\nfrom suite import suite\n\ns = suite()\nassert s.countTestCases() == 2, s.countTestCases()\nr = unittest.TextTestRunner(stream=open('/dev/null', 'w')).run(s)\nassert r.wasSuccessful()\n",
    proves: "The suite is built with the same tests and runs.",
    does_not_prove: "Custom prefix/sortUsing arguments of makeSuite (set them on the TestLoader).",
    detect: { files: PY, pattern: "\\b(makeSuite|findTestCases|getTestCaseNames)\\(" },
  }),
  "py-typing-io": py({
    title: "typing.io / typing.re were removed in Python 3.13: import IO, Pattern from typing",
    symptom: "ModuleNotFoundError: No module named 'typing.io'",
    symptom_regex: "typing\\.(io|re)",
    description: "The typing.io and typing.re pseudo-submodules warned since 3.8 and are gone in 3.13.",
    refs: ["https://docs.python.org/3/whatsnew/3.13.html"],
    tags: ["python", "typing", "removed-3.13"],
    claims: { python: ">=3.5" },
    before: { "types_.py": "from typing.io import IO\n\n\ndef name(f: IO) -> str:\n    return f.name\n" },
    after: { "types_.py": "from typing import IO\n\n\ndef name(f: IO) -> str:\n    return f.name\n" },
    check: "import typing\nfrom types_ import name\n\nwith open('x.txt', 'w') as f:\n    assert name(f) == 'x.txt'\nassert name.__annotations__['f'] is typing.IO\n",
    proves: "The annotation resolves to typing.IO and the function works.",
    does_not_prove: "Third-party stubs that still reference typing.io.",
    detect: { files: PY, pattern: "typing\\.(io|re)\\b" },
  }),
  "py-uu-removed": py({
    title: "uu was removed in Python 3.13: use binascii.b2a_uu",
    symptom: "ModuleNotFoundError: No module named 'uu'",
    symptom_regex: "No module named '?uu",
    description: "uu is gone in 3.13 (PEP 594). binascii implements the same line encoding.",
    refs: ["https://peps.python.org/pep-0594/"],
    tags: ["python", "uu", "encoding", "pep594", "removed-3.13"],
    claims: { python: ">=3.0" },
    before: { "uuenc.py": "import io\nimport uu\n\n\ndef encode(data, name='file'):\n    out = io.BytesIO()\n    uu.encode(io.BytesIO(data), out, name, 0o644)\n    return out.getvalue()\n" },
    after: {
      "uuenc.py": "import binascii\n\n\ndef encode(data, name='file'):\n    lines = [b'begin 644 ' + name.encode() + b'\\n']\n    for i in range(0, len(data), 45):\n        lines.append(binascii.b2a_uu(data[i:i + 45]))\n    lines.append(b' \\nend\\n')\n    return b''.join(lines)\n",
    },
    check: "import binascii\nfrom uuenc import encode\n\ndata = bytes(range(256)) * 2\nout = encode(data, 'blob.bin')\nlines = out.split(b'\\n')\nassert lines[0] == b'begin 644 blob.bin', lines[0]\nassert out.endswith(b'end\\n')\nbody = [l for l in lines[1:] if l not in (b'', b' ', b'end')]\nassert b''.join(binascii.a2b_uu(l) for l in body) == data\n",
    proves: "Output round-trips byte-exact and keeps the begin/end framing.",
    does_not_prove: "uu.decode replacements (use binascii.a2b_uu per line).",
    detect: { files: PY, pattern: imp("uu") },
  }),
  // ---------------- Python 3.12 ----------------
  "py-imp-removed": py({
    title: "imp was removed in Python 3.12: load modules with importlib.util",
    symptom: "ModuleNotFoundError: No module named 'imp'",
    symptom_regex: "No module named '?imp'",
    description: "The imp module, deprecated since 3.4, is gone in 3.12. importlib.util.spec_from_file_location replaces load_source.",
    refs: ["https://docs.python.org/3/whatsnew/3.12.html"],
    tags: ["python", "imp", "importlib", "plugins", "removed-3.12"],
    claims: { python: ">=3.5" },
    before: { "plugins.py": "import imp\n\n\ndef load(path):\n    return imp.load_source('plugin', path)\n" },
    after: {
      "plugins.py": "import importlib.util\nimport sys\n\n\ndef load(path):\n    spec = importlib.util.spec_from_file_location('plugin', path)\n    mod = importlib.util.module_from_spec(spec)\n    sys.modules['plugin'] = mod\n    spec.loader.exec_module(mod)\n    return mod\n",
    },
    check: "import os\nfrom plugins import load\n\nos.makedirs('p', exist_ok=True)\nwith open('p/plug.py', 'w') as f:\n    f.write('VALUE = 41 + 1\\n')\nm = load('p/plug.py')\nassert m.VALUE == 42, m.VALUE\n",
    proves: "A module is loaded from an arbitrary path and executed.",
    does_not_prove: "Other imp functions (find_module, reload: use importlib.reload).",
    detect: { files: PY, pattern: imp("imp") },
  }),
  "py-unittest-assertequals": py({
    title: "assertEquals and other unittest aliases were removed in Python 3.12: use assertEqual",
    symptom: "AttributeError: 'T' object has no attribute 'assertEquals'",
    symptom_regex: "has no attribute 'assert",
    description: "Deprecated camelCase aliases (assertEquals, assertNotEquals, assertRegexpMatches, failUnless, ...) are gone in 3.12; tests error out.",
    refs: ["https://docs.python.org/3/whatsnew/3.12.html"],
    tags: ["python", "unittest", "testing", "removed-3.12"],
    claims: { python: ">=3.2" },
    before: { "legacy_tests.py": "import sys\nimport unittest\n\n\nclass T(unittest.TestCase):\n    def test_sum(self):\n        self.assertEquals(1 + 1, 2)\n\n\ndef run():\n    s = unittest.TestLoader().loadTestsFromTestCase(T)\n    return unittest.TextTestRunner(stream=sys.stderr).run(s).wasSuccessful()\n" },
    after: { "legacy_tests.py": "import sys\nimport unittest\n\n\nclass T(unittest.TestCase):\n    def test_sum(self):\n        self.assertEqual(1 + 1, 2)\n\n\ndef run():\n    s = unittest.TestLoader().loadTestsFromTestCase(T)\n    return unittest.TextTestRunner(stream=sys.stderr).run(s).wasSuccessful()\n" },
    check: "from legacy_tests import run\n\nassert run() is True\n",
    proves: "The test runs and passes with the current method names.",
    does_not_prove: "That the assertion itself is meaningful.",
    detect: { files: PY, pattern: "\\.(assertEquals|assertNotEquals|assertAlmostEquals|assertNotAlmostEquals|assertRegexpMatches|assertRaisesRegexp|assertDictContainsSubset|failUnless|failIf|failUnlessEqual|assert_)\\(" },
  }),
  "py-safeconfigparser": py({
    title: "configparser.SafeConfigParser was removed in Python 3.12: use ConfigParser",
    symptom: "AttributeError: module 'configparser' has no attribute 'SafeConfigParser'",
    symptom_regex: "has no attribute 'SafeConfigParser'",
    description: "SafeConfigParser was an alias of ConfigParser since 3.2 and is gone in 3.12.",
    refs: ["https://docs.python.org/3/whatsnew/3.12.html"],
    tags: ["python", "configparser", "removed-3.12"],
    claims: { python: ">=3.2" },
    before: { "conf.py": "import configparser\n\n\ndef port(text):\n    p = configparser.SafeConfigParser()\n    p.read_string(text)\n    return p.getint('server', 'port')\n" },
    after: { "conf.py": "import configparser\n\n\ndef port(text):\n    p = configparser.ConfigParser()\n    p.read_string(text)\n    return p.getint('server', 'port')\n" },
    check: "from conf import port\n\nassert port('[server]\\nport = 8080\\n') == 8080\nassert port('[DEFAULT]\\nport = 1\\n[server]\\n') == 1\n",
    proves: "Values and DEFAULT inheritance work the same.",
    does_not_prove: "readfp() (also removed: use read_file).",
    detect: { files: PY, pattern: "SafeConfigParser\\b" },
  }),
  "py-ssl-wrap-socket": py({
    title: "ssl.wrap_socket was removed in Python 3.12: use an SSLContext",
    symptom: "AttributeError: module 'ssl' has no attribute 'wrap_socket'",
    symptom_regex: "has no attribute 'wrap_socket'",
    description: "The module-level ssl.wrap_socket is gone in 3.12. Build an SSLContext; this capsule keeps the OLD default (no certificate verification) on purpose so behavior does not change silently. Turn verification on for real clients.",
    refs: ["https://docs.python.org/3/whatsnew/3.12.html"],
    tags: ["python", "ssl", "tls", "removed-3.12"],
    claims: { python: ">=3.6" },
    before: { "tls.py": "import ssl\n\n\ndef client(sock):\n    return ssl.wrap_socket(sock, do_handshake_on_connect=False)\n" },
    after: {
      "tls.py": "import ssl\n\n\ndef client(sock):\n    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)\n    ctx.check_hostname = False\n    ctx.verify_mode = ssl.CERT_NONE  # same as the old default; enable verification for real clients\n    return ctx.wrap_socket(sock, do_handshake_on_connect=False)\n",
    },
    check: "import socket\nimport ssl\nfrom tls import client\n\na, b = socket.socketpair()\ns = client(a)\nassert isinstance(s, ssl.SSLSocket)\nassert s.context.verify_mode == ssl.CERT_NONE\ns.close(); b.close()\n",
    proves: "A client TLS socket is created with the same (unverified) defaults.",
    does_not_prove: "That skipping verification is safe for your use (it usually is not).",
    detect: { files: PY, pattern: "ssl\\.wrap_socket\\(" },
  }),
  "py-locale-format": py({
    title: "locale.format was removed in Python 3.12: use locale.format_string",
    symptom: "AttributeError: module 'locale' has no attribute 'format'",
    symptom_regex: "has no attribute 'format'",
    description: "locale.format (deprecated since 3.7) is gone in 3.12.",
    refs: ["https://docs.python.org/3/whatsnew/3.12.html"],
    tags: ["python", "locale", "removed-3.12"],
    claims: { python: ">=3.0" },
    before: { "money.py": "import locale\n\n\ndef fmt(n):\n    return locale.format('%d', n, grouping=True)\n" },
    after: { "money.py": "import locale\n\n\ndef fmt(n):\n    return locale.format_string('%d', n, grouping=True)\n" },
    check: "import locale\nfrom money import fmt\n\nlocale.setlocale(locale.LC_ALL, 'C')\nassert fmt(1234567) == '1234567', fmt(1234567)\nassert fmt(-5) == '-5'\n",
    proves: "Formatting output is identical under the C locale.",
    does_not_prove: "Output under other locales (same function, so it should match).",
    detect: { files: PY, pattern: "locale\\.format\\(" },
  }),
  // ---------------- Python 3.11 ----------------
  "py-getargspec": py({
    title: "inspect.getargspec was removed in Python 3.11: use getfullargspec or signature",
    symptom: "AttributeError: module 'inspect' has no attribute 'getargspec'",
    symptom_regex: "has no attribute 'getargspec'",
    description: "getargspec (deprecated since 3.0) is gone in 3.11.",
    refs: ["https://docs.python.org/3/whatsnew/3.11.html"],
    tags: ["python", "inspect", "removed-3.11"],
    claims: { python: ">=3.0" },
    before: { "intro.py": "import inspect\n\n\ndef params(f):\n    return inspect.getargspec(f).args\n" },
    after: { "intro.py": "import inspect\n\n\ndef params(f):\n    return inspect.getfullargspec(f).args\n" },
    check: "from intro import params\n\n\ndef f(a, b=2, *rest, **kw):\n    pass\n\n\nassert params(f) == ['a', 'b'], params(f)\nassert params(lambda: 0) == []\n",
    proves: "Positional parameter names match getargspec's.",
    does_not_prove: "Keyword-only parameters (getargspec refused them; getfullargspec reports them separately).",
    detect: { files: PY, pattern: "getargspec\\(" },
  }),
  "py-asyncio-coroutine": py({
    title: "@asyncio.coroutine was removed in Python 3.11: use async def",
    symptom: "AttributeError: module 'asyncio' has no attribute 'coroutine'",
    symptom_regex: "has no attribute 'coroutine'",
    description: "Generator-based coroutines were removed in 3.11.",
    refs: ["https://docs.python.org/3/whatsnew/3.11.html"],
    tags: ["python", "asyncio", "removed-3.11"],
    claims: { python: ">=3.5" },
    before: { "jobs.py": "import asyncio\n\n\n@asyncio.coroutine\ndef double(x):\n    yield from asyncio.sleep(0)\n    return x * 2\n" },
    after: { "jobs.py": "import asyncio\n\n\nasync def double(x):\n    await asyncio.sleep(0)\n    return x * 2\n" },
    check: "import asyncio\nfrom jobs import double\n\n\nasync def main():\n    return await asyncio.gather(double(1), double(21))\n\n\nassert asyncio.run(main()) == [2, 42]\n",
    proves: "The coroutine is awaitable and returns the same values.",
    does_not_prove: "Code that relied on generator methods (send/throw) of the old coroutine.",
    detect: { files: PY, pattern: "asyncio\\.coroutine\\b" },
  }),
  // ---------------- Node 24 removals (observed: present in 22.23, gone in 24.22) ----------------
  "node-util-is-removed": node({
    title: "util.isBoolean/isString/... were removed in Node 23+: use typeof and Array.isArray",
    symptom: "TypeError: util.isBoolean is not a function",
    symptom_regex: "util\\.is[A-Za-z]+ is not a function",
    description: "The deprecated util.is* type checks (except isArray) were removed in Node 23, so Node 24 LTS breaks code that still calls them.",
    refs: ["https://nodejs.org/api/deprecations.html"],
    tags: ["node", "util", "removed-node-23"],
    claims: { node: ">=0.10" },
    before: { "types.cjs": "const util = require('node:util');\nexports.kind = (v) => (util.isBoolean(v) ? 'bool' : util.isString(v) ? 'str' : util.isNullOrUndefined(v) ? 'none' : 'other');\n" },
    after: { "types.cjs": "exports.kind = (v) => (typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str' : v === null || v === undefined ? 'none' : 'other');\n" },
    check: "const { kind } = require('./types.cjs');\nconst assert = require('node:assert');\nassert.deepStrictEqual([true, 'x', null, undefined, 3, {}].map(kind), ['bool', 'str', 'none', 'none', 'other', 'other']);\n",
    proves: "Same classification for booleans, strings, null/undefined and others.",
    does_not_prove: "util.isDate/isRegExp/isError replacements (use instanceof or util.types).",
    detect: { files: JS, pattern: "util\\.(isBoolean|isBuffer|isDate|isError|isFunction|isNull|isNullOrUndefined|isNumber|isObject|isPrimitive|isRegExp|isString|isSymbol|isUndefined)\\(" },
  }),
  "node-util-log": node({
    title: "util.log was removed in Node 23+: log with console.log and your own timestamp",
    symptom: "TypeError: util.log is not a function",
    symptom_regex: "util\\.log is not a function",
    description: "util.log was deprecated and removed in Node 23.",
    refs: ["https://nodejs.org/api/deprecations.html"],
    tags: ["node", "util", "logging", "removed-node-23"],
    claims: { node: ">=0.10" },
    before: { "log.cjs": "const util = require('node:util');\nexports.info = (msg) => util.log(msg);\n" },
    after: { "log.cjs": "exports.info = (msg) => console.log(`${new Date().toISOString()} - ${msg}`);\n" },
    check: "const lines = [];\nconst orig = process.stdout.write.bind(process.stdout);\nprocess.stdout.write = (s) => { lines.push(String(s)); return true; };\ntry { require('./log.cjs').info('cafe-ready'); } finally { process.stdout.write = orig; }\nconst out = lines.join('');\nif (!/cafe-ready/.test(out) || !/\\d{2}:\\d{2}:\\d{2}/.test(out)) { console.error('bad output', JSON.stringify(out)); process.exit(1); }\n",
    proves: "The message is printed with a time of day, like util.log did.",
    does_not_prove: "The exact util.log timestamp format.",
    detect: { files: JS, pattern: "util\\.log\\(" },
  }),
  "node-dirent-path": node({
    title: "Dirent.path was removed in Node 24: use dirent.parentPath (Node >= 20.12)",
    symptom: "TypeError [ERR_INVALID_ARG_TYPE]: The \"path\" argument must be of type string. Received undefined",
    symptom_regex: "Received undefined",
    description: "fs.Dirent#path was an alias of parentPath; it is undefined in Node 24, so path.join(d.path, d.name) throws. parentPath only exists since Node 20.12/21.4.",
    refs: ["https://nodejs.org/api/fs.html#direntparentpath"],
    tags: ["node", "fs", "readdir", "removed-node-24"],
    claims: { node: ">=20.12" },
    before: { "walk.cjs": "const fs = require('node:fs');\nconst path = require('node:path');\nexports.files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.path, d.name)).sort();\n" },
    after: { "walk.cjs": "const fs = require('node:fs');\nconst path = require('node:path');\nexports.files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath, d.name)).sort();\n" },
    check: "const fs = require('node:fs');\nconst assert = require('node:assert');\nfs.mkdirSync('d/sub', { recursive: true });\nfs.writeFileSync('d/a.txt', '1');\nfs.writeFileSync('d/b.txt', '2');\nassert.deepStrictEqual(require('./walk.cjs').files('d'), ['d/a.txt', 'd/b.txt']);\n",
    proves: "Full paths of directory entries are built correctly.",
    does_not_prove: "Recursive readdir behavior.",
    detect: { files: JS, pattern: "\\b(dirent|entry|ent|de|d|e|f|file|item)\\.path\\b", also: "withFileTypes" },
  }),
  "node-zlib-bytesread": node({
    title: "zlib bytesRead was removed in Node 24: use bytesWritten",
    symptom: "Compression stats are NaN/undefined: zlib stream bytesRead is undefined",
    description: "The misnamed zlib bytesRead property (deprecated since Node 10) is undefined in Node 24; bytesWritten has the same value.",
    refs: ["https://nodejs.org/api/zlib.html#zlibbyteswritten"],
    tags: ["node", "zlib", "removed-node-24"],
    claims: { node: ">=10" },
    before: { "gz.cjs": "const zlib = require('node:zlib');\nexports.gzipStats = (buf) => new Promise((res) => { const z = zlib.createGzip(); const out = []; z.on('data', (c) => out.push(c)); z.on('end', () => res({ input: z.bytesRead, output: Buffer.concat(out).length })); z.end(buf); });\n" },
    after: { "gz.cjs": "const zlib = require('node:zlib');\nexports.gzipStats = (buf) => new Promise((res) => { const z = zlib.createGzip(); const out = []; z.on('data', (c) => out.push(c)); z.on('end', () => res({ input: z.bytesWritten, output: Buffer.concat(out).length })); z.end(buf); });\n" },
    check: "const assert = require('node:assert');\nrequire('./gz.cjs').gzipStats(Buffer.alloc(5000, 'a')).then((s) => { assert.strictEqual(s.input, 5000); assert.ok(s.output > 0 && s.output < 5000); }).catch((e) => { console.error(e.message); process.exit(1); });\n",
    proves: "The number of input bytes is reported correctly.",
    does_not_prove: "Other zlib stream properties.",
    detect: { files: JS, pattern: "\\.bytesRead\\b", also: "zlib" },
  }),
  "node-crypto-createcipher": node({
    title: "crypto.createCipher was removed in Node 22: use createCipheriv with a real key and IV",
    symptom: "TypeError: crypto.createCipher is not a function",
    symptom_regex: "createCipher is not a function",
    description: "createCipher derived keys insecurely (MD5, no salt) and was removed in Node 22. Old ciphertexts need the legacy EVP_BytesToKey derivation to decrypt; new data should use scrypt + random IV.",
    refs: ["https://nodejs.org/api/deprecations.html#DEP0106"],
    tags: ["node", "crypto", "security", "removed-node-22"],
    claims: { node: ">=10" },
    before: { "box.cjs": "const crypto = require('node:crypto');\nexports.seal = (secret, text) => { const c = crypto.createCipher('aes-256-cbc', secret); return c.update(text, 'utf8', 'hex') + c.final('hex'); };\nexports.open = (secret, hex) => { const d = crypto.createDecipher('aes-256-cbc', secret); return d.update(hex, 'hex', 'utf8') + d.final('utf8'); };\n" },
    after: { "box.cjs": "const crypto = require('node:crypto');\nconst key = (secret, salt) => crypto.scryptSync(secret, salt, 32);\nexports.seal = (secret, text) => { const salt = crypto.randomBytes(16), iv = crypto.randomBytes(16); const c = crypto.createCipheriv('aes-256-cbc', key(secret, salt), iv); return [salt, iv, Buffer.concat([c.update(text, 'utf8'), c.final()])].map((b) => b.toString('hex')).join(':'); };\nexports.open = (secret, sealed) => { const [salt, iv, ct] = sealed.split(':').map((h) => Buffer.from(h, 'hex')); const d = crypto.createDecipheriv('aes-256-cbc', key(secret, salt), iv); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); };\n" },
    check: "const assert = require('node:assert');\nconst { seal, open } = require('./box.cjs');\nconst s = seal('pw', 'hola café');\nassert.strictEqual(open('pw', s), 'hola café');\nassert.notStrictEqual(seal('pw', 'x'), seal('pw', 'x'));\nassert.throws(() => open('wrong', s));\n",
    proves: "Round trip works, ciphertexts are randomized, and a wrong password fails.",
    does_not_prove: "Decrypting data produced by the old createCipher (needs EVP_BytesToKey; not included).",
    detect: { files: JS, pattern: "\\bcreate(Cipher|Decipher)\\(" },
  }),
};

/** Detection rules for older catalog capsules that are compatibility problems. */
export const DETECT: Record<string, Detect> = {
  "node-esm-dirname": { files: ["*.mjs", "*.mts"], pattern: "\\b__(dirname|filename)\\b", note: "Also applies to .js files when package.json has \"type\": \"module\"." },
  "node-ts-parameter-properties": {
    files: ["*.ts", "*.mts", "*.cts"],
    pattern: "constructor\\s*\\([^)]*\\b(public|private|protected|readonly)\\s+\\w",
    note: "Only matters if you run .ts files directly with Node (type stripping); tsc and bundlers accept it.",
  },
  "node-import-assert-to-with": { files: JS, pattern: "\\bassert\\s*\\{\\s*type\\s*:" },
  "py-distutils-removed": { files: PY, pattern: imp("distutils"), note: "Hidden when setuptools is installed in the same environment (it ships a distutils shim)." },
  "py-utcnow-deprecated": { files: PY, pattern: "\\butc(now|fromtimestamp)\\(" },
  "py-fromisoformat-z": { files: PY, pattern: "fromisoformat\\(", note: "Only a problem for strings ending in 'Z' before Python 3.11." },
  "py-fromtimestamp-local-tz": { files: PY, pattern: "\\.fromtimestamp\\([^,)]*\\)", note: "Calls without tz= depend on the machine's time zone." },
};

export const COMPAT_SUPERSEDES: Record<string, string[]> = {
  "py-imghdr-removed": ["py-imghdr-OLD"],
};
