/** Real Patzer API integration test against an isolated disposable DB. Never touches the original DB. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=resolve(fileURLToPath(new URL('.',import.meta.url)),'../../../patzer');
const source=resolve(process.env.PATZER_SOURCE || root);
const require=createRequire(join(source,'package.json'));
const Database=require('better-sqlite3');
const tmp=mkdtempSync(join(tmpdir(),'patzer-audit-'));
const dbPath=join(tmp,'chess.db');
const username='mcp_audit';
const password='Temporary_Audit_Password_2026!';
const key='x'.repeat(64);
const passwordFile=join(tmp,'patzer-password');
writeFileSync(passwordFile,password,{mode:0o600});
const processes=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function wait(url){let last;for(let i=0;i<80;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch(e){last=e;}await sleep(100);}throw Error(`No response from ${url}: ${last}`);}
function launch(cmd,args,opts){const p=spawn(cmd,args,{...opts,stdio:['ignore','pipe','pipe']});p._err='';p.stderr.on('data',d=>p._err+=(String(d)).slice(0,2500));processes.push(p);return p;}
async function rpc(mcp,method,params={}){const r=await fetch(mcp,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','accept':'application/json,text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)}); assert.equal(r.status,200,`MCP status ${r.status}`);return r.json();}
try {
  const appPort=await port(),mcpPort=await port();
  const app=launch(join(source,'node_modules/.bin/tsx'),['server/src/index.ts'],{cwd:source,env:{...process.env,DB_PATH:dbPath,STOCKFISH_PATH:join(source,'bin/stockfish'),PORT:String(appPort),HOST:'127.0.0.1',SESSION_SECRET:'AuditOnly_NotProduction_OnlyTest_2026'}});
  const api=`http://127.0.0.1:${appPort}`;
  try{await wait(api+'/api/health');}catch(e){throw Error(e.message+'; Patzer stderr '+app._err);}
  const setup=await fetch(api+'/api/setup/init',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'patzer'},body:JSON.stringify({username,password,display_name:'Audit User',language:'en'})});
  assert.equal(setup.status,200,`Patzer setup failed: ${await setup.text()}`);
  const db=new Database(dbPath);
  const pgn='[Event "Audit"]\n[Site "Local"]\n[Date "2026.11.07"]\n[Round "1"]\n[White "Test"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0';
  const id=Number(db.prepare('INSERT INTO games (user_id,source,pgn,white,black,result,user_color) VALUES (1,\'imported\',?,?,?,?,?)').run(pgn,'Test','Opponent','win','white').lastInsertRowid);
  db.close();
  const bridge=launch(process.execPath,[resolve(fileURLToPath(new URL('./server.mjs',import.meta.url)))],{env:{...process.env,MCP_API_KEY:key,PATZER_USERNAME:username,PATZER_PASSWORD_FILE:passwordFile,PATZER_PASSWORD:'',PATZER_URL:api,MCP_PORT:String(mcpPort)}});
  const mcp=`http://127.0.0.1:${mcpPort}/mcp`;
  try{await wait(`http://127.0.0.1:${mcpPort}/healthz`);}catch(e){throw Error(e.message+'; MCP stderr '+bridge._err);}
  const list=await rpc(mcp,'tools/call',{name:'list_games',arguments:{limit:10}});
  assert.equal(JSON.parse(list.result.content[0].text).games[0].id,id);
  console.log('PASS: Patzer session login and real games listing');
  const game=await rpc(mcp,'tools/call',{name:'get_game',arguments:{game_id:id}});
  assert.match(JSON.parse(game.result.content[0].text).game.pgn,/e4 e5/);
  console.log('PASS: retrieve real stored PGN');
  const position=await rpc(mcp,'tools/call',{name:'analyze_position',arguments:{fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',depth:8}});
  assert.equal(position.result.isError,undefined,JSON.stringify(position.result));
  console.log('PASS: real Stockfish FEN evaluation');
  const result=await rpc(mcp,'tools/call',{name:'analyze_game',arguments:{game_id:id,depth:8}});
  assert.equal(result.result.isError,undefined,JSON.stringify(result.result));
  const analysis=JSON.parse(result.result.content[0].text).analysis;
  assert.equal(typeof analysis.accuracy_white,'number');
  console.log('PASS: actual game analysis and move classifications');
  const cached=await rpc(mcp,'tools/call',{name:'get_game_review',arguments:{game_id:id}});
  assert.equal(JSON.parse(cached.result.content[0].text).review,null);
  const prose=await rpc(mcp,'tools/call',{name:'generate_game_review',arguments:{game_id:id}});
  assert.equal(prose.result.isError,true);
  assert.match(prose.result.content[0].text,/503|llm_not_configured/);
  console.log('PASS: cached review & honest LLM-unconfigured error');
} catch(e) {console.error('FAIL:',e.message);process.exitCode=1;}
finally {for(const p of processes.reverse())p.kill('SIGTERM');await sleep(250);rmSync(tmp,{recursive:true,force:true});}
