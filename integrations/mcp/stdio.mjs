#!/usr/bin/env node
/** Stdio MCP transport for OpenAI Secure MCP Tunnel. No inbound HTTP or API-key auth. */
import readline from 'node:readline';
import { dispatch } from './core.mjs';

const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
let chain=Promise.resolve();
for await(const line of rl){
  if(!line.trim())continue;
  // One response per request, in order. The stdio stream must contain *only* MCP JSON-RPC.
  chain=chain.then(async()=>{
    let result;
    try {const msg=JSON.parse(line);result=await dispatch(msg);}catch(e){
      console.error('MCP stdio error:',e.message);
      result={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON request'}};
    }
    if(result!==null)process.stdout.write(JSON.stringify(result)+'\n');
  });
}
await chain;
