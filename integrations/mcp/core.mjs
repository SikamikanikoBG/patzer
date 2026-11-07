#!/usr/bin/env node
/** Shared Patzer MCP tools for the stdio and local HTTP transports; no third-party dependencies. */

// Node 22+ dotenv loader reads the private file without executing its contents as shell commands.
import { existsSync, readFileSync } from 'node:fs';
const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiBase = process.env.PATZER_URL || 'http://127.0.0.1:8800';
const username = process.env.PATZER_USERNAME || '';
const password = process.env.PATZER_PASSWORD_FILE ? readFileSync(process.env.PATZER_PASSWORD_FILE, 'utf8') : (process.env.PATZER_PASSWORD || '');
if (!username || !password) {
  console.error('Set PATZER_USERNAME and PATZER_PASSWORD locally.');
  process.exit(1);
}
const parsedApi = new URL(apiBase);
if (!['http:', 'https:'].includes(parsedApi.protocol) || parsedApi.username || parsedApi.password) {
  throw Error('PATZER_URL must be an HTTP(S) URL without credentials');
}
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedApi.hostname) && process.env.PATZER_ALLOW_REMOTE !== 'true') {
  throw Error('Refusing to transmit Patzer credentials to a non-loopback host without PATZER_ALLOW_REMOTE=true');
}
let cookie = '';
let authInProgress;

const defs = [
  { name: 'list_games', description: 'List your saved Patzer chess games. Read only.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum recent games to return' } }, additionalProperties: false } },
  { name: 'get_game', description: 'Retrieve a saved game, its PGN and any existing Stockfish analysis by numeric game ID.', inputSchema: { type: 'object', properties: { game_id: { type: 'integer', minimum: 1 } }, required: ['game_id'], additionalProperties: false } },
  { name: 'analyze_game', description: 'Run or retrieve Stockfish analysis for a saved game. Can use significant CPU.', inputSchema: { type: 'object', properties: { game_id: { type: 'integer', minimum: 1 }, depth: { type: 'integer', minimum: 8, maximum: 22, default: 16 }, force: { type: 'boolean', default: false } }, required: ['game_id'], additionalProperties: false } },
  { name: 'analyze_position', description: 'Analyze a FEN position with Stockfish and return up to five principal variations.', inputSchema: { type: 'object', properties: { fen: { type: 'string', minLength: 10, maxLength: 180 }, depth: { type: 'integer', minimum: 8, maximum: 22, default: 16 }, lines: { type: 'integer', minimum: 1, maximum: 5, default: 3 } }, required: ['fen'], additionalProperties: false } },
  { name: 'get_game_review', description: 'Get existing cached AI-coach prose for a game; does not generate new prose.', inputSchema: { type: 'object', properties: { game_id: { type: 'integer', minimum: 1 } }, required: ['game_id'], additionalProperties: false } },
  { name: 'generate_game_review', description: 'Generate the AI coach game review (requires a configured LLM and completed Stockfish analysis); writes a review cache.', inputSchema: { type: 'object', properties: { game_id: { type: 'integer', minimum: 1 } }, required: ['game_id'], additionalProperties: false } },
  { name: 'import_chesscom_games', description: 'Import up to 200 public Chess.com games by username into your Patzer account.', inputSchema: { type: 'object', properties: { username: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,40}$' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } }, required: ['username'], additionalProperties: false } },
  { name: 'import_lichess_games', description: 'Import up to 200 public Lichess games by username into your Patzer account.', inputSchema: { type: 'object', properties: { username: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,30}$' }, limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 } }, required: ['username'], additionalProperties: false } },
];
// Advertise correct read/write semantics in MCP tool discovery.
for (const d of defs) {
  const readOnly = ['list_games','get_game','get_game_review','analyze_position'].includes(d.name);
  d.annotations = { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: d.name.startsWith('import_'), idempotentHint: !d.name.startsWith('import_') && d.name !== 'generate_game_review' };
}
const byName = new Map(defs.map(d => [d.name, d]));
function fail(message) { throw new Error(message); }
function integer(v, name, min, max, fallback) {
  if (v === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(v) || v < min || v > max) fail(`${name} must be an integer between ${min} and ${max}`);
  return v;
}
function name(v, max) { if (typeof v !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{2,${max}}$`).test(v)) fail('Invalid public username'); return v; }
function gameId(a) { return integer(a.game_id, 'game_id', 1, 2147483647); }
function checkArgs(n, a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail('Arguments must be an object');
  const def = byName.get(n);
  if (!def) fail(`Unknown tool: ${n}`);
  const keys = Object.keys(def.inputSchema.properties);
  for (const k of Object.keys(a)) if (!keys.includes(k)) fail(`Unexpected argument: ${k}`);
  if (['get_game','get_game_review','generate_game_review','analyze_game'].includes(n)) gameId(a);
  if (n === 'analyze_game') { integer(a.depth,'depth',8,22,16); if(a.force !== undefined && typeof a.force !== 'boolean') fail('force must be boolean'); }
  if (n === 'analyze_position') { if (typeof a.fen !== 'string' || a.fen.length < 10 || a.fen.length > 180) fail('Invalid FEN'); integer(a.depth,'depth',8,22,16); integer(a.lines,'lines',1,5,3); }
  if (n.startsWith('import_')) { name(a.username,n==='import_chesscom_games'?40:30); integer(a.limit,'limit',1,200,20); }
  if (n==='list_games') {if(a.limit!==undefined) integer(a.limit,'limit',1,100); }
}
async function login() {
  if (authInProgress) return authInProgress;
  authInProgress = (async () => {
    const res = await fetch(new URL('/api/auth/login', apiBase), {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'patzer'}, body:JSON.stringify({username,password}), signal:AbortSignal.timeout(12000)});
    if (!res.ok) throw Error(`Patzer login failed (HTTP ${res.status})`);
    const header = res.headers.get('set-cookie') || '';
    const first = header.split(';')[0];
    if (!first.includes('=')) throw Error('Patzer did not return a session cookie');
    cookie=first;
  })();
  try { await authInProgress; } finally { authInProgress=undefined; }
}
async function request(path, method='GET', data, retry=true) {
  if (!cookie) await login();
  const response=await fetch(new URL(path,apiBase),{method,headers:{'Cookie':cookie,'X-Requested-With':'patzer',...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(180000)});
  if(response.status===401 && retry){cookie=''; return request(path,method,data,false);}
  if(response.status===401) throw Error('Patzer session expired / authentication failed');
  if(!response.ok) {const body=(await response.text()).slice(0,500); throw Error(`Patzer HTTP ${response.status}: ${body}`);}
  if(response.headers.get('content-type')?.includes('text/event-stream')) {
    const raw=await response.text();
    const events=raw.split(/\r?\n\r?\n/).map(segment=>{const event=segment.match(/^event:\s*(.*)$/m)?.[1];const data=segment.match(/^data:\s*(.*)$/m)?.[1];return {event,data};}).filter(e=>e.event);
    const error=events.find(e=>e.event==='error'); if(error) throw Error(`Patzer review error: ${error.data}`);
    const done=events.findLast(e=>e.event==='done'); if (!done) throw Error('Review stream ended without completion');
    return JSON.parse(done.data);
  }
  return response.json();
}
async function callTool(n,a) {
  checkArgs(n,a);
  switch(n) {
    case 'list_games': { const p=new URLSearchParams();if(a.limit!==undefined)p.set('limit',String(a.limit));return request(`/api/games${p.size?'?'+p:''}`); }
    case 'get_game': return request(`/api/games/${gameId(a)}`);
    case 'get_game_review': return request(`/api/games/${gameId(a)}/review`);
    case 'generate_game_review': return request(`/api/games/${gameId(a)}/review`,'POST',{});
    case 'analyze_game': return request('/api/analyze','POST',{game_id:gameId(a),depth:a.depth??16,force:a.force??false});
    case 'analyze_position': return request('/api/analyze/position','POST',{fen:a.fen,depth:a.depth??16,lines:a.lines??3});
    case 'import_chesscom_games': return request('/api/games/import/chesscom','POST',{username:a.username,limit:a.limit??20});
    case 'import_lichess_games': return request('/api/games/import/lichess','POST',{username:a.username,limit:a.limit??20});
  }
}
function rpc(id,result){return {jsonrpc:'2.0',id,result};}
function rpcError(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
export async function dispatch(msg) {
  if (!msg || msg.jsonrpc!=='2.0' || typeof msg.method!=='string') return rpcError(msg?.id??null,-32600,'Invalid request');
  if(msg.id===undefined) return null; // JSON-RPC notification
  if(msg.method==='initialize') return rpc(msg.id,{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'patzer-mcp',version:'0.2.0'}});
  if(msg.method==='ping') return rpc(msg.id,{});
  if(msg.method==='tools/list') return rpc(msg.id,{tools:defs});
  if(msg.method==='tools/call') {
    try { const n=msg.params?.name;const out=await callTool(n,msg.params?.arguments??{});return rpc(msg.id,{content:[{type:'text',text:JSON.stringify(out)}]}); }
    catch(e){return rpc(msg.id,{isError:true,content:[{type:'text',text:e.message}]});}
  }
  return rpcError(msg.id,-32601,'Method not found');
}
