"""Read-only coherent snapshot of the active family DB. Never replaces or seeds it."""
import datetime
import hashlib
import json
import pathlib
import sqlite3
import sys

phase = sys.argv[1]
assert phase in ("before", "after")
active = pathlib.Path("data/multiplyz.sqlite")
report_path = pathlib.Path("docs/playthroughs/teddy-worlds/data-preservation.json")
if phase == "before":
    assert not report_path.exists(), "Preserve the original baseline"
else:
    assert report_path.exists()
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
prefix = "teddy-before-worlds" if phase == "before" else "teddy-worlds-delivered"
backup = pathlib.Path("data/backups") / f"{prefix}-{stamp}.sqlite"
assert not backup.exists()
backup.parent.mkdir(parents=True, exist_ok=True)
source = sqlite3.connect(active.resolve().as_uri() + "?mode=ro", uri=True)
snapshot = sqlite3.connect(backup)
source.backup(snapshot)
source.close()
assert snapshot.execute("pragma integrity_check").fetchone()[0] == "ok"
tables = {}
for (name,) in snapshot.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"):
    rows = sorted(json.dumps(list(row), ensure_ascii=False, default=str) for row in snapshot.execute(f'SELECT * FROM "{name}"'))
    tables[name] = {"rows": len(rows), "sha256": hashlib.sha256("\n".join(rows).encode()).hexdigest()}
snapshot.close()
sha = hashlib.sha256(backup.read_bytes()).hexdigest()
meta = {"source": str(active), "backup": str(backup), "sha256": sha, "integrity": "ok", "createdAt": stamp, "activeDatabaseReplaced": False, "seedExecuted": False}
backup.with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
if phase == "before":
    report = {"activeDatabase": str(active), "backup": str(backup), "backupSha256": sha, "before": tables}
else:
    report = json.loads(report_path.read_text())
    unchanged = [name for name in tables if report["before"].get(name) == tables[name]]
    report.update({"after": tables, "unchangedTables": unchanged, "deliveredBackup": str(backup), "deliveredBackupSha256": sha})
    assert set(tables) == set(report["before"]) and len(unchanged) == len(tables), "Activity differs from baseline; inspect without restoring anything."
report.update({"integrity": "ok", "activeDatabaseReplaced": False, "seedExecuted": False})
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"tables": len(tables), "unchanged": len(report.get("unchangedTables", [])), **meta}))
