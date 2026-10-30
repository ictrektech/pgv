#!/usr/bin/env python3
"""Exercise signed custom sidecars, checksum rejection, Marketplace and plugin UI in a disposable PGV viewer."""
import argparse,base64,hashlib,io,json,secrets,subprocess,zipfile
from urllib.request import Request,urlopen
from urllib.error import HTTPError
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--origin',required=True);args=p.parse_args()
origin=args.origin;base=origin+'/app/com.ictrek.pgv/api'
def request(path,payload=None,cookie=None,raw=None,ctype=None):
 headers={'Origin':origin}
 if cookie:headers['Cookie']=cookie
 if raw is not None:data=raw;headers['Content-Type']=ctype
 elif payload is not None:data=json.dumps(payload).encode();headers['Content-Type']='application/json'
 else:data=None
 with urlopen(Request(base+'/'+path,data=data,headers=headers),timeout=120) as r:return r.headers,r.read()
headers,_=request('vos/login',{'access_token':'validation-admin'});cookie=headers['Set-Cookie'].split(';')[0]
def api(path,payload=None):return json.loads(request(path,payload,cookie)[1])
plugin_id='ictrek.pgv.validation'
if plugin_id in json.dumps(api('plugins')):api('plugins/uninstall',{'plugin_id':plugin_id})
key_id='pgv-validation-'+secrets.token_hex(4)
manifest={'manifest_version':1,'id':plugin_id,'name':'PGV Signed Plugin Validation','version':'1.0.0','publisher':'ictrek-validation','engines':{'dbx':'>=0.6.0','host_api':'^1.0'},'permissions':[], 'entrypoints':{'backend':{'executable':'bin/plugin','transport':'stdio-jsonl','protocol_versions':[1]},'ui':{'root':'ui','entry':'ui/index.html'}},'contributions':[{'type':'workbench','id':'ictrek.pgv.validation.main','label':'PGV Validation'}]}
files={'manifest.json':json.dumps(manifest).encode(),'ui/index.html':b'<!doctype html><html><head><link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script></head><body><h1>Loading signed plugin sandbox</h1></body></html>', 'ui/main.js':b'import {label} from "./chunk.js";document.querySelector("h1").textContent=label;', 'ui/chunk.js':b'export const label="PGV sandbox modules ready";', 'ui/style.css':b'body{font-family:system-ui;padding:24px;color:#2563eb}', 'bin/plugin':b'#!/bin/sh\nexec node "$(dirname "$0")/plugin.mjs"\n', 'bin/plugin.mjs':('''import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line);if(m.id===undefined)continue;
 const result=m.method==='plugin/initialize'?{protocolVersion:1,capabilities:[],plugin:{id:'ictrek.pgv.validation',version:'1.0.0'}}:m.params;
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}
''').encode()}
checksums=json.dumps({'algorithm':'sha256','files':{k:hashlib.sha256(v).hexdigest() for k,v in sorted(files.items())}},indent=2).encode()
# Only ephemeral validation keys; never use a production repository signing key.
js="const c=require('node:crypto');const {privateKey,publicKey}=c.generateKeyPairSync('ed25519');let b=[];process.stdin.on('data',v=>b.push(v));process.stdin.on('end',()=>console.log(JSON.stringify({publicKey:publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('base64'),signature:c.sign(null,Buffer.concat(b),privateKey).toString('base64')})));"
signed=json.loads(subprocess.run(['node','-e',js],input=checksums,capture_output=True,check=True).stdout)
api('plugins/trusted-keys/save',{'keyId':key_id,'publicKey':signed['publicKey']})
signature=json.dumps({'algorithm':'ed25519','key_id':key_id,'signature':signed['signature']}).encode()
def package(tamper=False,unsigned=False):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for k,v in files.items():
   item=zipfile.ZipInfo(k);item.external_attr=(0o100755 if k=='bin/plugin' else 0o100644)<<16
   z.writestr(item,v+(b' tampered' if tamper and k=='ui/index.html' else b''))
  z.writestr('checksums.json',checksums)
  if not unsigned:z.writestr('signature.json',signature)
 return out.getvalue()
def upload(data):
 boundary='PGVValidationBoundary'
 body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="validation.dbxp"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()+data+f'\r\n--{boundary}--\r\n'.encode())
 return request('plugins/install',cookie=cookie,raw=body,ctype='multipart/form-data; boundary='+boundary)
for kind,data in [('tampered',package(tamper=True)),('unsigned',package(unsigned=True))]:
 try:upload(data)
 except HTTPError as e:assert e.code in [400,403],(kind,e.code)
 else:raise AssertionError(kind+' plugin accepted')
upload(package())
plugins=api('plugins');assert plugin_id in json.dumps(plugins)
active=api('plugins/activate',{'plugin_id':plugin_id})
result=api('plugins/invoke',{'pluginId':plugin_id,'method':'validation/echo','params':{'result':'PGV native sidecar OK'}})
assert 'PGV native sidecar OK' in json.dumps(result)
_,html=request('plugins/'+plugin_id+'/ui',cookie=cookie);assert b'Loading signed plugin sandbox' in html
catalog=api('plugins/marketplace/catalogs')
# Report fetch availability separately from the signed custom-plugin acceptance.
print('PASS: signed custom plugin install/activation/invoke/UI; tampered and unsigned packages rejected')
print('Marketplace catalog: '+('available' if 'plugins' in json.dumps(catalog) and 'io.github.t8y2.s3' in json.dumps(catalog) else 'unavailable'))
print('PLUGIN_ID='+plugin_id)
