import { describe, expect, it } from 'vitest';
import { validateRuntimeKey, validateTunnelId } from '../src/mcp/tunnel.js';

describe('Patzer local MCP connection wizard input validation', () => {
  it('accepts an OpenAI tunnel ID with exactly 32 hex digits', () => {
    expect(validateTunnelId('tunnel_6aee75738a388191881ae8e41540cdb9')).toBe(true);
  });
  it('rejects invalid IDs, shell metacharacters and hostnames', () => {
    for (const id of ['', 'tunnel_x', 'tunnel_6aee75738a388191881ae8e41540cdb9;id', 'https://evil.example', 'tunnel_6AEE75738A388191881AE8E41540CDB9']) {
      expect(validateTunnelId(id)).toBe(false);
    }
  });
  it('accepts normal runtime API keys and refuses unsafe content', () => {
    expect(validateRuntimeKey('sk-proj_exampleSecret_1234567')).toBe(true);
    for (const key of ['', 'short', 'sk-proj_ok\nOTHER_SETTING=evil', 'sk-proj_bad key', 'sk-proj_bad"key', 'x'.repeat(513)]) {
      expect(validateRuntimeKey(key)).toBe(false);
    }
  });
});
