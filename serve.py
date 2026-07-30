"""Local dev server.

Python's plain http.server sends Last-Modified and no Cache-Control, so browsers
happily reuse an ES module they already have. Because a module graph is fetched
per URL, that leaves you running a mix of old and new files after an edit, which
looks exactly like a broken app. This sends no-store and maps .mjs, so a plain
reload always gets the current code.

    python serve.py            # http://localhost:8123
    python serve.py 9000       # pick a port
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class DevHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    # threaded: a single threaded server stalls whenever the browser holds a connection open
    # while fetching a module graph
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(DevHandler, directory="."))
    server.daemon_threads = True
    print("Resume Composer on http://localhost:%d  (ctrl+c to stop)" % port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
