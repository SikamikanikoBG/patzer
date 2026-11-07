#!/usr/bin/env node
/** Generates a portable mcp.json for an already-live HTTPS tunnel. No secrets are written. */
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
const base = resolve(import.meta.dirname, '..');
const input = process.argv[2];
if(!input) { console.error('Usage: node integrations/mcp/scripts/build-plugin.mjs https://hostname:8443/mcp'); process.exit(1); }
const endpoint = new URL(input);
if(endpoint.protocol !== 'https:' || endpoint.pathname !== '/mcp' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Expected full HTTPS /mcp endpoint with no secrets or query string');
const out=resolve(base,'dist-plugin/patzer-chess-review');
mkdirSync(out,{recursive:true});
cpSync(resolve(base,'plugin-template/plugin.json'),resolve(out,'plugin.json'));
cpSync(resolve(base,'plugin-template/skills'),resolve(out,'skills'),{recursive:true});
writeFileSync(resolve(out,'mcp.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:{'patzer-chess-review':{type:'streamable-http',url:endpoint.href,extensions:{'com.openai':{auth:{type:'api_key',headerScheme:'bearer'}}}}}},null,2)+'\n');
console.log(`Generated ${out}. Configure API-key auth during the plugin connection flow; do not commit credentials.`);
