#!/usr/bin/env python3
"""Static file server for local development.

`python -m http.server` sends Last-Modified but no Cache-Control, so browsers
heuristically cache ES modules and keep executing a stale copy after an edit.
That surfaces as "does not provide an export named X" for a symbol that is
plainly there on disk, which costs far more time than it should. Sending
no-store removes the whole class of confusion.

Usage: python3 dev-server.py [port] [root]
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5199
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = partial(NoCacheHandler, directory=root)
    print(f"roomshow dev server -> http://localhost:{port}", flush=True)
    try:
        ThreadingHTTPServer(("", port), handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
