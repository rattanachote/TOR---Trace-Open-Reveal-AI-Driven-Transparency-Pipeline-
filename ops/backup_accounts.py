"""Back up the account database (users, roles, reviews, cases, corrections, audit log).

Writes Web App/backups/accounts-YYYYMMDD-HHMM.dump with pg_dump (custom format) from the
tor-auth-db container and keeps the newest KEEP files. Copy the backups folder to another
machine or drive as well; a backup on the same disk does not survive a disk failure.

  python ops/backup_accounts.py              make a backup
  python ops/backup_accounts.py --restore FILE   restore one (replaces current accounts!)

Schedule daily on Windows (run once in an elevated prompt from the Web App folder):
  schtasks /Create /SC DAILY /ST 02:00 /TN "TOR account backup" /TR "python \"%CD%\\ops\\backup_accounts.py\""
"""
import argparse, subprocess, sys, time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
BACKUPS = APP / 'backups'
KEEP = 14
CONTAINER, USER, DB = 'tor-auth-db', 'tor', 'tor'


def backup():
 BACKUPS.mkdir(exist_ok=True)
 target = BACKUPS / f"accounts-{time.strftime('%Y%m%d-%H%M')}.dump"
 with open(target, 'wb') as out:
  done = subprocess.run(['docker', 'exec', CONTAINER, 'pg_dump', '-U', USER, '-d', DB, '--format=custom'], stdout=out, stderr=subprocess.PIPE)
 if done.returncode or target.stat().st_size == 0:
  target.unlink(missing_ok=True); sys.exit('Backup failed: ' + done.stderr.decode(errors='replace'))
 old = sorted(BACKUPS.glob('accounts-*.dump'))[:-KEEP]
 for f in old: f.unlink()
 print(f'Saved {target} ({target.stat().st_size:,} bytes); kept newest {KEEP}, removed {len(old)}.')


def restore(path):
 data = Path(path).read_bytes()
 done = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'pg_restore', '-U', USER, '-d', DB, '--clean', '--if-exists'], input=data, stderr=subprocess.PIPE)
 if done.returncode: sys.exit('Restore reported errors: ' + done.stderr.decode(errors='replace'))
 print(f'Restored {path}. Restart the web server.')


if __name__ == '__main__':
 parser = argparse.ArgumentParser(); parser.add_argument('--restore', metavar='FILE'); args = parser.parse_args()
 restore(args.restore) if args.restore else backup()
