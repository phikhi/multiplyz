"""Coherent backup and row fingerprints; after-check permits only published stage metadata."""
import sqlite3, json, hashlib, pathlib, datetime, sys
phase=sys.argv[1]; target=pathlib.Path(sys.argv[2]); report=pathlib.Path(sys.argv[3])
def digest(rows):
 values=sorted(json.dumps(list(row),ensure_ascii=False,default=lambda v: v.hex() if isinstance(v,bytes) else str(v)) for row in rows)
 return hashlib.sha256('\n'.join(values).encode()).hexdigest()
def fingerprint(db):
 out={}
 for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
  if name=='__drizzle_migrations':continue
  columns=[r[1] for r in db.execute(f'PRAGMA table_info("{name}")')]
  rows=db.execute(f'SELECT * FROM "{name}"').fetchall()
  out[name]={'rows':len(rows),'sha256':digest(rows)}
  if name=='characters':
   keep=[x for x in columns if x not in ['max_stage','art_ref_stages']]
   names=','.join('"'+x+'"' for x in keep)
   out[name]['identitySha256']=digest(db.execute(f'SELECT {names} FROM characters').fetchall())
 return out
# After publication SQLite may need to recreate its WAL/SHM sidecars. Query-only
# permits that housekeeping while prohibiting application writes during comparison.
c=sqlite3.connect(target.resolve().as_uri()+('?mode=rw' if phase=='after' else '?mode=ro'),uri=True)
if phase=='after':c.execute('pragma query_only=on')
assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
if phase=='before':
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=pathlib.Path('data/backups')/f'teddy-before-evolution-{stamp}.sqlite';backup.parent.mkdir(exist_ok=True)
 dest=sqlite3.connect(backup);c.backup(dest);assert dest.execute('pragma integrity_check').fetchone()[0]=='ok';dest.close()
 payload={'activeDatabase':str(target),'backup':str(backup),'backupSha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'before':fingerprint(c),'catalogueBefore':c.execute('select id,max_stage,art_ref_stages from characters order by id').fetchall()}
 report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps({k:v for k,v in payload.items() if k in ['activeDatabase','backup','backupSha256']}))
elif phase=='after':
 payload=json.loads(report.read_text());after=fingerprint(c);unchanged=[]
 for name, before in payload['before'].items():
  if name=='characters':assert before['identitySha256']==after[name]['identitySha256'];assert before['rows']==after[name]['rows']
  else:assert before==after[name],name;unchanged.append(name)
 assert after['evolution_receipts']['rows']==0
 changed=[];before_by_id={r[0]:r for r in payload['catalogueBefore']}
 for row in c.execute('select id,max_stage,art_ref_stages from characters order by id'):
  old=before_by_id[row[0]]
  if list(row)!=old:
   assert old[1:]==[1,None] and row[1]==3
   assert set(json.loads(row[2]))=={'2','3'}
   changed.append(row[0])
 payload.update({'checkedDatabase':str(target),'after':after,'unchangedTables':unchanged,'catalogueStageMetadataAdded':changed,'integrity':'ok','activeDatabaseReplaced':False,'seedExecuted':False})
 report.write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps({'unchangedTables':len(unchanged),'identitiesPreserved':after['characters']['rows'],'stageMetadataAdded':len(changed),'integrity':'ok'}))
else:raise ValueError(phase)
c.close()
