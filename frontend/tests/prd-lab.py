"""Disposable, loopback-only QA tenant. Requires the existing MySQL binary, not a download."""
import atexit,json,os,secrets,socket,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timezone
import pymysql
from sqlalchemy import URL
from PIL import Image,ImageDraw
import argparse, re, shutil
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['prepare','serve']);parser.add_argument('run_dir',type=Path);opts=parser.parse_args()
if not __debug__:raise SystemExit('Run without -O: disposable-environment guards must stay enabled.')
os.umask(0o077)
PROJ=Path(__file__).resolve().parents[2]; BOX=opts.run_dir.resolve(); parent=(PROJ/'.local'/'showcase').resolve()
if BOX.parent!=parent or not re.fullmatch(r'prd-selftest\.[a-zA-Z0-9]+',BOX.name) or not BOX.is_dir():
 raise SystemExit('Supply a private, newly created .local/showcase/prd-selftest.<unique> directory.')
located=os.environ.get('PRD_MYSQLD') or shutil.which('mysqld');
if not located or not Path(located).is_file():raise SystemExit('Set PRD_MYSQLD to an existing local MySQL 8 server binary; nothing will be installed.')
BIN=Path(located).resolve(); DATA=BOX/'dbdata'; SECRET=BOX/'private.json'; META=BOX/'fixture.json'
if not (BOX.parent/'tls.crt').is_file() or not (BOX.parent/'tls.key').is_file():raise SystemExit('Missing local QA TLS certificate/key for 127.0.0.1.')
if opts.action=='prepare' and any(BOX.iterdir()):raise SystemExit('Refusing to prepare a nonempty run directory.')
def write(f,v): f.write_text(json.dumps(v,ensure_ascii=False),encoding='utf-8')
def generate():
 assert not SECRET.exists() and not DATA.exists();DATA.mkdir();(BOX/'media').mkdir();(BOX/'assets').mkdir()
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 assert port not in (3306,1604,5143,5144,5155)
 actors={k:{'login':'prd-'+k.lower(),'temporary':secrets.token_urlsafe(24),'password':secrets.token_urlsafe(24)} for k in ('A','E','P')}
 cfg={'port':port,'dbpass':secrets.token_hex(24),'stoppass':secrets.token_hex(24),'actors':actors};write(SECRET,cfg)
 subprocess.run([str(BIN),'--no-defaults','--initialize-insecure',f'--basedir={BIN.parent.parent}',f'--datadir={DATA}',f'--log-error={BOX/"init.log"}'],check=True,timeout=85,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 sql=BOX/'first.sql';sql.write_text("ALTER USER 'root'@'localhost' IDENTIFIED BY '"+secrets.token_hex(32)+"';\nCREATE DATABASE fp_prd_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\nCREATE USER 'prd_web'@'127.0.0.1' IDENTIFIED BY '"+cfg['dbpass']+"';\nGRANT ALL ON fp_prd_e2e.* TO 'prd_web'@'127.0.0.1';\nCREATE USER 'prd_stop'@'127.0.0.1' IDENTIFIED BY '"+cfg['stoppass']+"';\nGRANT SHUTDOWN ON *.* TO 'prd_stop'@'127.0.0.1';\n",encoding='ascii');return cfg

def start(c):
 with socket.socket() as s:assert s.connect_ex(('127.0.0.1',c['port']))!=0,'Dedicated port is occupied; no other server will be used'
 opts=[str(BIN),'--no-defaults',f'--basedir={BIN.parent.parent}',f'--datadir={DATA}','--bind-address=127.0.0.1',f'--port={c["port"]}','--mysqlx=OFF','--skip-name-resolve',f'--pid-file={BOX/"owned.pid"}',f'--log-error={BOX/"mysql.log"}'];init=BOX/'first.sql'
 p=subprocess.Popen(opts+([f'--init-file={init}'] if init.exists() else []),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 for _ in range(100):
  if p.poll() is not None:raise RuntimeError('Dedicated MySQL exited before readiness')
  try:
   with pymysql.connect(host='127.0.0.1',port=c['port'],database='fp_prd_e2e',user='prd_web',password=c['dbpass'],connect_timeout=1) as db,db.cursor() as cur:
    cur.execute('SELECT @@datadir,@@port,DATABASE()');d,port,n=cur.fetchone();assert Path(d).resolve()==DATA and port==c['port'] and n=='fp_prd_e2e'
   init.unlink(missing_ok=True);break
  except pymysql.OperationalError:time.sleep(.25)
 else:p.terminate();raise RuntimeError('Dedicated MySQL not ready')
 os.environ['ASSET_ROOT']=str(BOX/'media');os.environ['DATABASE_URL']=URL.create('mysql+pymysql','prd_web',c['dbpass'],'127.0.0.1',c['port'],'fp_prd_e2e').render_as_string(hide_password=False);sys.path.insert(0,str(PROJ));return p

def stop(c,p=None):
 if p is not None and p.poll() is not None:return
 try:
  with pymysql.connect(host='127.0.0.1',port=c['port'],user='prd_stop',password=c['stoppass'],connect_timeout=2) as db,db.cursor() as cur:
   cur.execute('SELECT @@datadir,@@port');d,port=cur.fetchone();assert Path(d).resolve()==DATA and port==c['port'] and port!=3306;cur.execute('SHUTDOWN')
 except pymysql.OperationalError as ex:
  if ex.args[0] not in (2003,2013):raise
 if p is not None:p.wait(timeout=20)

def assets():
 files={};out=BOX/'assets'
 for k,(w,h),color in [('square',(150,150),'#beceb9'),('cover',(320,180),'#accfe0'),('long',(240,900),'#d7ebd0'),('service',(320,1024),'#c6bfd0'),('poster1',(390,1230),'#d9e9ee'),('poster2',(390,1340),'#e8dcd3'),('poster3',(390,1400),'#c5ded0')]:
  img=Image.new('RGB',(w,h),color);dr=ImageDraw.Draw(img);dr.text((15,25),'QA '+k,fill='black');dr.line((0,h-24,w,h-24),fill='#38505a',width=4);f=out/(k+'.png');img.save(f);files[k]=str(f)
 for k in ('qrA','qrB'):
  target=out/(k+'.png');shutil.copyfile(PROJ/'frontend/tests/fixtures/prd'/target.name,target);files[k]=str(target)
 return files

if opts.action=='prepare':
 c=generate();child=start(c)
 try:
  from alembic import command
  from alembic.config import Config
  from app.cli.bootstrap import create_first_admin
  command.upgrade(Config(str(PROJ/'alembic.ini')),'head');create_first_admin(c['actors']['A']['login'],c['actors']['A']['temporary']);write(META,{'origin':'https://127.0.0.1:5155','runId':BOX.name,'files':assets()});print('QA tenant explicitly migrated and bootstrapped; no business fixtures inserted.')
 finally:stop(c,child)
elif opts.action=='serve':
 for entry in ('frontend/admin/dist/index.html', 'frontend/h5/dist/build/h5/index.html'):
  if not (PROJ/entry).is_file():
   raise SystemExit(f'Missing {entry}; run npm --prefix frontend run build before starting the QA site.')
 assert META.exists();c=json.loads(SECRET.read_text());child=start(c);atexit.register(stop,c,child)
 from app.application import create_app
 from app.local import local_site
 import uvicorn
 app=create_app()
 @app.middleware('http')
 async def marker(req,nxt):
  resp=await nxt(req)
  if req.url.path=='/health/ready':resp.headers['X-Showcase-QA-Run']=BOX.name
  return resp
 site=local_site(app,PROJ);(BOX/'serving').touch()
 try:uvicorn.run(site,host='127.0.0.1',port=5155,ssl_keyfile=str(BOX.parent/'tls.key'),ssl_certfile=str(BOX.parent/'tls.crt'),proxy_headers=False,access_log=False,log_level='warning')
 finally:(BOX/'serving').unlink(missing_ok=True)
