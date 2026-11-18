// LAST FLOOR V17.4.4 - secure TikTok relay + server-authoritative SOLO scorekeeper.
// Replaces previous server.mjs after testing. Works without DATABASE_URL as old relay.
import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { parseLiveComment, validToken, makeRingBuffer } from './relay-core.mjs';
import {SoloEngine} from './solo-engine.mjs';
import {SoloStore} from './solo-store.mjs';
const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.LIVE_ROOM_TOKEN || '';
const USERNAME = (process.env.TIKTOK_USERNAME || '').trim().replace(/^@/, '');
const TEST_ENABLED = process.env.ENABLE_TEST_ENDPOINT === '1';
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://rongrianthai.github.io')
    .split(',').map(v => v.trim()).filter(Boolean)
);
if (TOKEN.length < 24) {console.error('Configuration error: LIVE_ROOM_TOKEN must contain at least 24 characters.');process.exit(1)}
if (USERNAME && !/^[a-zA-Z0-9._]{2,30}$/.test(USERNAME)) {console.error('Configuration error: TIKTOK_USERNAME should be a valid TikTok handle without @.');process.exit(1)}
const ring = makeRingBuffer(5000);
const session = crypto.randomUUID();
let connected = false;
let lastError = '';
let stopping = false;
let currentConnection = null;
let database=null,dbError='';
const dbReady=SoloStore.connect(process.env.DATABASE_URL||'').then(result=>{
  database=result;
  console.log(database?'SOLO persistent ranking database connected':'SOLO ranking database not configured (existing relay still works)');
}).catch(e=>{dbError=String(e?.message||e).slice(0,100);console.error('SOLO database unavailable; existing relay remains active');});
const engine=new SoloEngine((id,rows)=>{
  if(!database)throw new Error('database unavailable');
  return database.saveRound(id,rows);
});
function respond(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(body)});
  res.end(body);
}
function authorize(req){return validToken(req.headers['x-relay-token'],TOKEN,crypto.timingSafeEqual)}
function setCors(req,res){
  const origin=req.headers.origin;
  if(origin&&ALLOWED_ORIGINS.has(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','X-Relay-Token, Content-Type');
    res.setHeader('Access-Control-Max-Age','3600');res.setHeader('Vary','Origin');return true;
  }
  return !origin;
}
function readJson(req,byteLimit=4096){
  return new Promise((resolve,reject)=>{
    let body='';let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>byteLimit){reject(new Error('body too large'));req.destroy();return}body+=chunk});
    req.on('end',()=>{try{resolve(JSON.parse(body))}catch{reject(new Error('invalid JSON'))}});
    req.on('error',reject);
  });
}
function emitComment(comment){
  if(!comment)return;
  ring.push(comment);
  engine.receive(comment);
}
const server=http.createServer(async(req,res)=>{
  const corsOkay=setCors(req,res);
  if(req.method==='OPTIONS'){res.writeHead(corsOkay?204:403,{'Cache-Control':'no-store'});res.end();return}
  const url=new URL(req.url||'/','http://localhost');
  if(url.pathname==='/'||url.pathname==='/health'){respond(res,200,{service:'LAST FLOOR Relay',ok:true});return}
  if(!url.pathname.startsWith('/api/')){respond(res,404,{error:'not found'});return}
  if(!corsOkay){respond(res,403,{error:'origin not allowed'});return}
  if(!authorize(req)){respond(res,401,{error:'unauthorized'});return}
  if(req.method==='GET'&&url.pathname==='/api/status'){
    respond(res,200,{session,cursor:ring.currentCursor(),connected,configured:Boolean(USERNAME),last_error:lastError,onlineRankingReady:!!database});return;
  }
  if(req.method==='GET'&&url.pathname==='/api/comments'){
    const afterRaw=Number(url.searchParams.get('after')||'0');
    const after=Number.isSafeInteger(afterRaw)&&afterRaw>=0?afterRaw:0;
    const {comments,cursor}=ring.after(after);
    respond(res,200,{session,cursor,comments,connected,configured:Boolean(USERNAME),last_error:lastError});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/test-comment'){
    if(!TEST_ENABLED){respond(res,404,{error:'test endpoint disabled'});return}
    if(connected){respond(res,409,{error:'test endpoint unavailable while TikTok LIVE is connected'});return}
    try{const payload=await readJson(req);const comment=parseLiveComment(payload,'test');
      if(!comment){respond(res,400,{error:'invalid test command or user ID'});return}
      emitComment(comment);respond(res,200,{ok:true,cursor:ring.currentCursor()});
    }catch(e){if(!res.headersSent&&!res.destroyed)respond(res,400,{error:'invalid request body'})}return;
  }
  if(url.pathname.startsWith('/api/solo/')){
    await dbReady;
    if(req.method==='GET'&&url.pathname==='/api/solo/status'){
      respond(res,200,{dbReady:!!database,dbConfigured:!!process.env.DATABASE_URL,
        dbError:dbError?'cannot reach database':'',connected,match:engine.snapshot()});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/solo/leaderboard'){
      if(!database){respond(res,503,{error:'database not configured or unavailable'});return}
      try{const leaderboard=await database.leaderboard(Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||10)));
        respond(res,200,{ok:true,leaderboard});}catch(e){respond(res,503,{error:'database read failed'})}return;
    }
    if(req.method==='POST'){
      if(!database){respond(res,503,{error:'database not configured or unavailable'});return}
      try{
        const body=await readJson(req);
        const id=String(body.roundId||'');let result;
        if(url.pathname==='/api/solo/round/start'){
          if(!connected&&!TEST_ENABLED)throw new Error('TikTok LIVE not connected');
          result=await engine.start(id);
        }else if(url.pathname==='/api/solo/stage/start'){
          result=engine.stageStart(id,body.stageIndex,body.safeChoice);
        }else if(url.pathname==='/api/solo/stage/resolve'){
          result=engine.stageResolve(id,body.stageIndex);
        }else if(url.pathname==='/api/solo/round/finish'){
          result=await engine.finish(id);
        }else {respond(res,404,{error:'unknown solo action'});return}
        respond(res,200,{ok:true,match:result});
      }catch(e){
        // Errors are returned to the host only; no token, DB URL, or player data is logged.
        const msg=String(e?.message||'request rejected').slice(0,120);
        respond(res,409,{ok:false,error:msg});
      }
      return;
    }
  }
  respond(res,404,{error:'not found'});
});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`LAST FLOOR relay listening on port ${PORT}; mock test ${TEST_ENABLED?'enabled':'disabled'}`);
});
async function runTikTok(){
  if(!USERNAME)return;
  let connector;
  try{connector=await import('tiktok-live-connector')}catch{lastError='TikTok connector module unavailable';console.error(lastError);return}
  const {TikTokLiveConnection,WebcastEvent,ControlEvent}=connector;
  let retry=5000;
  while(!stopping){
    let wake;const disconnected=new Promise(resolve=>{wake=resolve});
    try{
      const connection=new TikTokLiveConnection(USERNAME);currentConnection=connection;
      connection.on(WebcastEvent.CHAT,data=>{emitComment(parseLiveComment(data,'live'))});
      connection.on(ControlEvent.CONNECTED,()=>{connected=true;lastError=''});
      connection.on(ControlEvent.DISCONNECTED,()=>{connected=false;wake()});
      connection.on(ControlEvent.ERROR,()=>{lastError='TikTok connection reported an error'});
      await connection.connect();connected=true;lastError='';retry=5000;
      console.log('TikTok LIVE connected');await disconnected;
    }catch(e){lastError=`TikTok is not connected (${String(e?.message||'connection error').slice(0,100)})`;console.error('TikTok connection attempt failed')}
    finally{connected=false;if(currentConnection&&typeof currentConnection.disconnect==='function'){try{await currentConnection.disconnect()}catch{}}currentConnection=null}
    if(stopping)break;
    await new Promise(resolve=>setTimeout(resolve,retry));retry=Math.min(retry*2,60000);
  }
}
void runTikTok();
function shutdown(){stopping=true;try{currentConnection?.disconnect?.()}catch{}
  server.close(async()=>{try{await database?.close()}catch{}process.exit(0)});
  setTimeout(()=>process.exit(0),4000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
