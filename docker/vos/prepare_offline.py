"""Resolve pinned Git-only dependencies from local archives, without Git/network on builders."""
from pathlib import Path
import re, json, hashlib, tarfile
root=Path('/src')
archives=Path('/tmp/pgv-git-deps')
for name,source in json.loads((archives/'sources.json').read_text()).items():
 archive=archives/(name+'.tar.gz')
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=source['sha256']:
  raise SystemExit('Pinned Rust source archive checksum mismatch: '+name)
 destination=Path('/offline-git')/name
 destination.mkdir(parents=True,exist_ok=True)
 with tarfile.open(archive) as package:package.extractall(destination,filter='data')
replacements={
 'tokio-postgres':'/offline-git/postgres/tokio-postgres',
 'postgres-types':'/offline-git/postgres/postgres-types',
 'postgres-protocol':'/offline-git/postgres/postgres-protocol',
 'mysql_async':'/offline-git/mysql',
 'mysql_common':'/offline-git/mysql-common',
 'libsqlite3-hotbundle':'/offline-git/sqlite',
}
for p in [root/'Cargo.toml',*root.glob('crates/*/Cargo.toml'),*Path('/offline-git').glob('*/Cargo.toml')]:
 s=p.read_text()
 for name,path in replacements.items():
  pattern=r'^('+re.escape(name)+r'\s*=\s*\{)[^\n]*git[^\n]*\}'
  def replace(m):
   extras=[]
   for key in ['features','default-features','optional']:
    v=re.search(r'(?<![\w-])'+key+r'\s*=\s*(\[[^\]]*\]|true|false)',m[0])
    if v:extras.append(key+' = '+v[1])
   return name+' = { path = "'+str(root/path)+'"'+(' , '+', '.join(extras) if extras else '')+' }'
  s=re.sub(pattern,replace,s,flags=re.M)
 p.write_text(s)
