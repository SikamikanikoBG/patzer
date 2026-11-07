#!/usr/bin/env bash
# Run interactively on the user's own machine. Never sends the password to a chat or command line.
set -euo pipefail
base="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -t 0 ]]; then
  printf 'Run in an interactive terminal so the password can be entered privately.\n' >&2
  exit 1
fi
printf 'Configuring Patzer MCP for your existing account (not creating a new account).\n'
read -r -p 'Patzer username: ' username
if [[ ${#username} -lt 2 || ${#username} -gt 40 || "$username" == *$'\n'* || "$username" == *'='* || "$username" == *'#'* ]]; then
  printf 'Username must be 2-40 characters, without # or =; otherwise edit .env manually.\n' >&2
  exit 1
fi
read -r -s -p 'Patzer password (hidden): ' password
printf '\n'
if [[ -z "$password" ]]; then printf 'Password cannot be empty.\n' >&2; exit 1; fi
umask 077
passwordFile="$base/.patzer-password"
credEnv="$base/.env"
printf '%s' "$password" > "$passwordFile"
unset password
printf 'PATZER_URL=http://127.0.0.1:8800\nPATZER_USERNAME=%s\nPATZER_PASSWORD_FILE=%s\n' "$username" "$passwordFile" > "$credEnv"
chmod 600 "$passwordFile" "$credEnv"
printf 'Saved local private credentials. Testing Patzer API through MCP...\n'
output="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_games","arguments":{"limit":1}}}' | node "$base/stdio.mjs")"
if printf '%s' "$output" | node -e '
  let s=""; process.stdin.on("data",x=>s+=x); process.stdin.on("end",()=>{
    try {const r=JSON.parse(s);if(r.result?.isError) {console.error("Patzer auth failed:",r.result.content?.[0]?.text||"unknown");process.exitCode=1;return;}
    const games=JSON.parse(r.result.content[0].text).games;
    if (!Array.isArray(games)) throw Error("Unexpected games response");
    console.log("PASS: authenticated MCP connection to Patzer (games accessible)");}
    catch(e){console.error("MCP verification failed:",e.message);process.exitCode=1;}
  });
'; then
  printf '\nPatzer MCP credentials are ready for the OpenAI tunnel client.\n'
else
  printf '\nCredentials saved, but the login test failed. Please re-run the script to correct them.\n' >&2
  exit 1
fi
