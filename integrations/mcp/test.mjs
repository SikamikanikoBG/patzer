import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const auth='Bearer '+ 'x'.repeat(64);
const mock=http.createServer(async(req,res)=>{
  if(req.url==='/api/auth/login') {res.writeHead(200,{'content-type':'application/json','set-cookie':'patzer_session=testsession; HttpOnly'});res.end('{"user":{"id":7}}');return;}
  if(req.headers.cookie !== 'patzer_session=testsession') {res.writeHead(401);res.end('{}');return;}
  if(req.url==='/api/games?limit=2') {res.setHeader('content-type','application/json');res.end('{"games":[{"id":42}]}');return;}
  if(req.url==='/api/games/42') {res.setHeader('content-type','application/json');res.end('{"id":42,"pgn":"1. e4 e5"}');return;}
  if(req.url==='/api/analyze') {res.setHeader('content-type','application/json');res.end('{"analysis":{"accuracy_white":90}}');return;}
  if(req.url==='/api/games/42/review' && req.method==='POST') {res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: progress\ndata: {"step":1}\n\nevent: done\ndata: {"review":{"summary":"Good game"}}\n\n');return;}
  res.writeHead(404);res.end('{}');
});
await new Promise(ok=>mock.listen(0,'127.0.0.1',ok));
const mockPort=mock.address().port;
const bridge=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{env:{...process.env,MCP_HOST:'127.0.0.1',MCP_PORT:'18811',PATZER_URL:`http://127.0.0.1:${mockPort}`,PATZER_USERNAME:'test',PATZER_PASSWORD:'test',MCP_API_KEY:'x'.repeat(64)},stdio:['ignore','ignore','pipe']});
const url='http://127.0.0.1:18811/mcp';
async function rpc(method,params={},authorization=auth){return fetch(url,{method:'POST',headers:{authorization,'content-type':'application/json','accept':'application/json,text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
try {
  for(let i=0;i<60;i++){try {const r=await fetch('http://127.0.0.1:18811/healthz');if(r.ok)break;}catch{} await new Promise(r=>setTimeout(r,50));}
  await test('rejects missing or invalid tokens',async()=>{assert.equal((await rpc('tools/list',{},'')).status,401);assert.equal((await rpc('tools/list',{},'Bearer wrong')).status,401);});
  await test('MCP initialize and tool discovery',async()=>{const init=await (await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1.0'}})).json();assert.equal(init.result.serverInfo.name,'patzer-mcp');const tools=(await (await rpc('tools/list')).json()).result.tools;assert.equal(tools.length,8);});
  await test('lists saved games via session auth',async()=>{const response=await (await rpc('tools/call',{name:'list_games',arguments:{limit:2}})).json();assert.deepEqual(JSON.parse(response.result.content[0].text).games,[{id:42}]);});
  await test('fetch game and analyze',async()=>{const game=await(await rpc('tools/call',{name:'get_game',arguments:{game_id:42}})).json();assert.equal(JSON.parse(game.result.content[0].text).id,42);const analyzed=await(await rpc('tools/call',{name:'analyze_game',arguments:{game_id:42}})).json();assert.equal(JSON.parse(analyzed.result.content[0].text).analysis.accuracy_white,90);});
  await test('decodes AI review SSE',async()=>{const resp=await(await rpc('tools/call',{name:'generate_game_review',arguments:{game_id:42}})).json();assert.equal(JSON.parse(resp.result.content[0].text).review.summary,'Good game');});
  await test('invalid arguments are rejected without API side effect',async()=>{const resp=await(await rpc('tools/call',{name:'get_game',arguments:{game_id:-5}})).json();assert.equal(resp.result.isError,true);});
  await test('rejects cross origin calls',async()=>{const res=await fetch(url,{method:'POST',headers:{authorization:auth,'content-type':'application/json',origin:'https://evil.example'},body:'{}'});assert.equal(res.status,403);});
} finally {bridge.kill('SIGTERM');mock.close();await once(bridge,'exit').catch(()=>{});}
