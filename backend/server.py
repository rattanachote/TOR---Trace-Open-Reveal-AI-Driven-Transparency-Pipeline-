"""TOR web app entry point: loopback-only HTTP server for frontend/ and the JSON API.

  python backend/server.py --setup        create .env with random secrets (first run)
  python backend/server.py --port 8770    start the server (account database must be running)
"""
import argparse, os, sys
from http.server import ThreadingHTTPServer

import config
from api.handler import Handler
from services import accounts, cases


class Server(ThreadingHTTPServer):
 daemon_threads = True

 def handle_error(self, request, client_address):
  # Browsers routinely drop connections (closed tab, cancelled fetch); only log real errors.
  if not isinstance(sys.exc_info()[1], ConnectionError): super().handle_error(request, client_address)


def main():
 parser = argparse.ArgumentParser()
 parser.add_argument('--port', type=int, default=8770)
 parser.add_argument('--setup', action='store_true', help='create .env with random secrets')
 args = parser.parse_args()
 if args.setup:
  config.setup(); return
 config.load_env()
 if 'TOR_PG_PASSWORD' not in os.environ:
  sys.exit('Missing .env - run: python backend/server.py --setup, then docker compose -f docker/docker-compose.yml --env-file .env up -d')
 try: accounts.init(); cases.init()
 except RuntimeError as e: sys.exit(str(e))
 print(f'TOR local explorer: http://127.0.0.1:{args.port}', flush=True)
 Server(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
 main()
