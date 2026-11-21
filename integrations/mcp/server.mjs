#!/usr/bin/env node
/** Optional localhost HTTP transport for MCP clients which can supply Bearer keys. ChatGPT web cannot. */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { dispatch } from './core.mjs';

const host = process.env.MCP_HOST || '127.0.0.1';
const port = Number(process.env.MCP_PORT || 8811);
const token = process.env.MCP_API_KEY || '';
if (token.length < 32) {console.error('Set MCP_API_KEY to a random 32+ character secret for HTTP mode.');process.exit(1);}
if (!['127.0.0.1','::1','localhost'].includes(host)) {console.error('HTTP MCP transport only binds to loopback; use a trusted tunnel or proxy with OAuth for ChatGPT.');process.exit(1);}
function safeEq(a,b) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
function send(res,code,body,headers={}){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(body));}
function err(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz' && req.method==='GET') return send(res,200,{ok:true});
  if(req.url!=='/mcp') return send(res,404,{error:'not_found'});
  // Reject cross-origin browser requests entirely. ChatGPT/Codex/tunnel-client are not browser-origin requests.
  if(req.headers.origin) return send(res,403,{error:'origin_not_allowed'});
  if(!safeEq(req.headers.authorization||'',`Bearer ${token}`)) return send(res,401,{error:'unauthorized'}, {'www-authenticate':'Bearer realm="patzer-mcp"'});
  if(req.method==='GET') {res.writeHead(405,{'allow':'POST'});return res.end();}
  if(req.method!=='POST') {res.writeHead(405,{'allow':'POST'});return res.end();}
  if(req.headers['mcp-protocol-version'] && req.headers['mcp-protocol-version']!=='2025-03-26') return send(res,400,err(null,-32600,'Unsupported MCP protocol version; supported: 2025-03-26'));
  let body='';
  try {for await(const chunk of req){body+=chunk.toString();if(Buffer.byteLength(body)>65536)return send(res,413,{error:'too_large'});}} catch {return send(res,400,err(null,-32700,'Request body error'));}
  let message;
  try {message=JSON.parse(body);}catch{return send(res,400,err(null,-32700,'Invalid JSON request'));}
  if(Array.isArray(message))return send(res,400,err(null,-32600,'Batch requests not supported'));
  try {const result=await dispatch(message);if(result===null){res.writeHead(202);return res.end();}return send(res,200,result);}catch(e){console.error('MCP dispatch failure:',e.message);return send(res,500,err(message?.id??null,-32603,'Internal MCP server error'));}
});
server.requestTimeout=190000;
server.listen(port,host,()=>console.error(`Patzer MCP HTTP on http://${host}:${port}/mcp (loopback only; Bearer auth)`));
