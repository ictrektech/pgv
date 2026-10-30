#!/usr/bin/env python3
"""Disposable native viewer acceptance; never joins vos_default or uses installed data."""
import argparse
import base64
import json
import ipaddress
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image', required=True)
parser.add_argument('--postgres-image', required=True)
parser.add_argument('--redis-image', required=True)
parser.add_argument('--keep-for-ui', action='store_true')
args = parser.parse_args()
project = 'pgv-dbx-check-' + secrets.token_hex(4)
root = Path(tempfile.mkdtemp(prefix=project + '-', dir=Path.home()/'dev/build'))
os.chmod(root, 0o700)
password = secrets.token_urlsafe(24)
base = '/app/com.ictrek.pgv'


def docker(*command, **kwargs):
    result = subprocess.run(['docker', *command], text=True, capture_output=True, **kwargs)
    if result.returncode:
        (root/'docker-error.log').write_text(result.stderr)
        os.chmod(root/'docker-error.log', 0o600)
        raise RuntimeError('Docker acceptance command failed: ' + command[0])
    return result.stdout.strip()


def client(url, payload=None, cookie=None, origin=None, headers=None):
    request_headers = dict(headers or {})
    if cookie: request_headers['Cookie'] = cookie
    if origin: request_headers['Origin'] = origin
    if payload is not None: request_headers['Content-Type'] = 'application/json'
    req = Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=request_headers)
    with urlopen(req, timeout=30) as response:
        return response.status, response.headers, response.read()


def ready(url):
    for _ in range(120):
        try:
            if client(url)[0] == 200: return
        except (OSError, HTTPError): pass
        cid = docker(*cmd, 'ps', '-aq', 'viewer')
        if cid and docker('inspect', '--format', '{{.State.Status}}', cid) == 'exited':
            raise RuntimeError('Candidate viewer exited during startup')
        time.sleep(1)
    raise RuntimeError('Candidate did not become healthy')


mock = """import http from 'node:http';
const handler=async(req,res)=>{
 const admin=req.headers.authorization==='Bearer validation-admin';
 const ordinary=req.headers.authorization==='Bearer validation-user';
 res.setHeader('content-type','application/json');
 if(req.url==='/api/v1/models'){
  if(!admin){res.writeHead(401);return res.end('{}');}
  return res.end(JSON.stringify({models:[{qualified:'validation/sql',name:'Validation SQL',endpoints:['chat_completions']},{qualified:'validation/embedding',endpoints:['embeddings']}]}));
 }
 if(req.url==='/v1/chat/completions'){
  let body='';for await(const chunk of req)body+=chunk;
  if(!admin||JSON.parse(body).model!=='validation/sql'){res.writeHead(401);return res.end('{}');}
  return res.end(JSON.stringify({id:'validation-completion',object:'chat.completion',model:'validation/sql',choices:[{index:0,message:{role:'assistant',content:'SELECT 1 AS answer;'},finish_reason:'stop'}]}));
 }
 res.writeHead(admin||ordinary?200:401);
 res.end(JSON.stringify({code:0,data:{sub:admin?'admin-subject':'user-subject',preferred_username:admin?'admin':'user'}}));
};
http.createServer(handler).listen(8090,'0.0.0.0');
http.createServer(handler).listen(8080,'0.0.0.0');"""
(root/'userinfo.mjs').write_text(mock)
# Test hosts may already use every default /16 Docker pool. Allocate only a small,
# non-overlapping test subnet without pruning or changing any existing network.
network_ids = docker('network','ls','-q').splitlines()
occupied = []
if network_ids:
    for network in json.loads(docker('network','inspect',*network_ids)):
        for entry in (network.get('IPAM',{}).get('Config') or []):
            if entry.get('Subnet'): occupied.append(ipaddress.ip_network(entry['Subnet'],strict=False))
for route in json.loads(subprocess.check_output(['ip','-j','route'],text=True)):
    if route.get('dst') and route['dst']!='default':
        try: occupied.append(ipaddress.ip_network(route['dst'],strict=False))
        except ValueError: pass
subnet = next((str(candidate) for prefix in ['10.251.0.0/16','192.168.254.0/24','172.30.0.0/16']
               for candidate in ipaddress.ip_network(prefix).subnets(new_prefix=28)
               if not any(candidate.version==other.version and candidate.overlaps(other) for other in occupied)),None)
if not subnet: raise RuntimeError('No non-overlapping disposable test subnet available')
compose = {
    'services': {
        'postgres': {'image': args.postgres_image, 'environment': {
            'POSTGRES_PASSWORD': password, 'POSTGRES_USER': 'postgres', 'POSTGRES_DB': 'postgres'},
            'networks': {'default': {'aliases': ['pgv']}},
            'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U postgres'], 'interval': '2s', 'start_period': '90s', 'retries': 60}},
        'redis': {'image': args.redis_image, 'command': ['redis-server', '--requirepass', password],
                  'networks': {'default': {'aliases': ['pgv-redis']}}},
        'userinfo': {'image': args.image, 'entrypoint': ['node', '/userinfo.mjs'],
                     'volumes': [str(root/'userinfo.mjs')+':/userinfo.mjs:ro'],
                     'healthcheck': {'disable': True},'networks':{'default':{'aliases':['v-scheduler']}}},
        'viewer': {'image': args.image, 'environment': {'PGHOST': 'pgv', 'PGUSER': 'postgres',
                    'PGPASSWORD': password, 'PGV_REDIS_PASSWORD': password,
                    'VOS_USERINFO_URL': 'http://userinfo:8090/userinfo'},
                   'ports': ['127.0.0.1::8081'], 'volumes': ['viewer-data:/data'],
                   'depends_on': {'postgres': {'condition': 'service_healthy'}}},
    }, 'volumes': {'viewer-data': {}}, 'networks': {'default': {'ipam': {'config': [{'subnet': subnet}]}}},
}
# userinfo's read-only test script must be readable by a process in the container.
os.chmod(root, 0o755)
config = root/'compose.json'
config.write_text(json.dumps(compose)); os.chmod(config, 0o600)
cmd = ['compose', '-p', project, '-f', str(config)]
succeeded = False
try:
    docker(*cmd, 'up', '-d')
    address = docker(*cmd, 'port', 'viewer', '8081')
    origin = 'http://' + address
    ready(origin+'/healthz')
    status, headers, page = client(origin+base+'/')
    assert status == 200 and b'/app/com.ictrek.pgv/assets/' in page
    assert "frame-ancestors 'self'" in headers['Content-Security-Policy']
    for token in [None, 'validation-user', 'invalid']:
        try:
            if token: client(origin+base+'/api/vos/login', {'access_token':token}, origin=origin)
            else: client(origin+base+'/api/connection/list')
        except HTTPError as e: assert e.code in [401,403]
        else: raise AssertionError('Unauthenticated/non-admin access accepted')
    _,headers,_=client(origin+base+'/api/vos/login',{'access_token':'validation-admin'},origin=origin)
    cookie=headers['Set-Cookie'].split(';')[0]
    def api(path,payload=None):
        _,_,body=client(origin+base+'/api/'+path,payload,cookie=cookie,origin=origin)
        return json.loads(body)
    connections=api('connection/list')
    managed={c['name']:c for c in connections}
    assert {'PGV PostgreSQL','PGV Redis'}<=set(managed)
    for c in managed.values():
        assert password not in c.get('password','')
        assert c['driver_profile']==c['db_type']
        api('connection/connect',{'config':c})
    pgid=managed['PGV PostgreSQL']['id']
    def query(sql):return api('query/execute',{'connectionId':pgid,'database':'postgres','sql':sql})
    assert '42' in json.dumps(query('SELECT 42 AS answer'))
    query('CREATE EXTENSION IF NOT EXISTS vector')
    assert '1,2,3' in json.dumps(query("SELECT '[1,2,3]'::vector AS embedding")).replace(' ','')
    redisid=managed['PGV Redis']['id']
    def redis(command):return api('redis/execute-command',{'connectionId':redisid,'db':0,'command':command})
    redis('SET pgv-check:viewer preserved')
    assert 'preserved' in json.dumps(redis('GET pgv-check:viewer'))
    ai_config=next(c for c in api('ai/configs') if c['id']=='pgv-v-scheduler')
    assert ai_config['apiKey']=='' and ai_config['model']=='validation/sql'
    assert [m['id'] for m in api('ai/models',{'config':ai_config})]==['validation/sql']
    completion=api('ai/complete',{'request':{'config':ai_config,'systemPrompt':'Return SQL only.','messages':[{'role':'user','content':'Return SELECT 1 AS answer;'}],'maxTokens':64}})
    assert 'SELECT 1' in completion
    # No plaintext DB credentials in persistent metadata.
    docker(*cmd,'exec','-T','viewer','node','-e',"const fs=require('fs'); const b=fs.readFileSync('/data/dbx/dbx.db'); if(b.includes(Buffer.from(process.env.PGPASSWORD)))process.exit(1);")
    for headers in [{}, {'Origin':'https://evil.invalid'}]:
        try:client(origin+base+'/api/connection/connect',{'config':managed['PGV PostgreSQL']},cookie=cookie,headers=headers)
        except HTTPError as e:assert e.code==403
        else:raise AssertionError('Cross-origin mutation accepted')
    # Guide is static and does not replace the connector session.
    _,guide_headers,_=client(origin+base+'/integration-guide',cookie=cookie)
    assert not guide_headers.get('Set-Cookie')
    assert '42' in json.dumps(query('SELECT 42 AS answer'))
    ids={c['name']:c['id'] for c in connections}
    docker(*cmd,'up','-d','--force-recreate','viewer')
    origin = 'http://' + docker(*cmd,'port','viewer','8081')
    ready(origin+'/healthz')
    _,headers,_=client(origin+base+'/api/vos/login',{'access_token':'validation-admin'},origin=origin)
    cookie=headers['Set-Cookie'].split(';')[0]
    assert ids=={c['name']:c['id'] for c in api('connection/list')}
    assert 'preserved' in json.dumps(redis('GET pgv-check:viewer'))
    subprocess.run([sys.executable,str(Path(__file__).with_name('verify_plugin_runtime.py')),'--origin',origin],check=True)
    succeeded=True
    print('PASS: admin auth, CSRF, managed connections, SQL/vector, Redis, encrypted persistence, recreation, static guide, native Scheduler AI')
    if args.keep_for_ui:
        print('UI_ORIGIN='+origin)
        print('PROJECT='+project)
        print('CONFIG='+str(config))
finally:
    if not succeeded:
        failure_log = root/'services.log'
        failure_log.write_text(docker(*cmd,'logs','--no-color'))
        os.chmod(failure_log, 0o600)
        print('Failure logs: '+str(failure_log))
    if not args.keep_for_ui or not succeeded:
        docker(*cmd,'down','-v','--remove-orphans')
