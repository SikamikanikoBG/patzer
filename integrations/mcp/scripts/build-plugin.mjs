#!/usr/bin/env node
/** Optional portable private ChatGPT plugin, backed by an already provisioned OpenAI Secure MCP Tunnel. */
import { writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
const base = resolve(import.meta.dirname, '..');
const tunnelId = process.argv[2];
if(!/^tunnel_[a-z0-9]{32}$/.test(tunnelId||'')) {
  console.error('Usage: node integrations/mcp/scripts/build-plugin.mjs tunnel_<32-alphanumeric-lowercase-id>');
  console.error('Create a real tunnel in OpenAI Platform first. Do not use a placeholder.');
  process.exit(1);
}
const out=resolve(base,'dist-plugin/patzer-chess-review');
mkdirSync(out,{recursive:true});
cpSync(resolve(base,'plugin-template/plugin.json'),resolve(out,'plugin.json'));
cpSync(resolve(base,'plugin-template/skills'),resolve(out,'skills'),{recursive:true});
writeFileSync(resolve(out,'mcp.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{'patzer-chess-review':{type:'streamable-http',extensions:{'com.openai':{tunnelId,auth:{type:'none'}}}}}},null,2)+'\n');
console.log(`Wrote ${out}. Secure MCP Tunnel transport uses its own Platform credential; no MCP server API key is embedded.`);
