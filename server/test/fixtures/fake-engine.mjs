#!/usr/bin/env node
// A stand-in UCI engine for the search-watchdog tests. Stockfish's own
// misbehaviour is rare and nondeterministic; these modes reproduce it on
// demand, without burning twelve cores to do it.
//
//   healthy             — answers `go` with info lines then `bestmove`
//   wedge-honours-stop  — goes silent on `go`, but answers `stop` (what the
//                         real wedged engine looked like: its main thread was
//                         sitting in read() on stdin the whole time)
//   wedge-ignores-stop  — goes silent on `go` and ignores `stop` too
//   chatty-never-lands  — keeps printing info forever, never sends bestmove
const mode = process.env.FAKE_ENGINE_MODE ?? 'healthy';
let chatter;

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    handle(line);
  }
});

function say(s) { process.stdout.write(s + '\n'); }

function handle(line) {
  if (line === 'uci') { say('id name FakeEngine 1'); say('uciok'); return; }
  if (line === 'isready') { say('readyok'); return; }
  if (line === 'quit') { clearInterval(chatter); process.exit(0); }
  if (line.startsWith('setoption') || line.startsWith('position') || line === 'ucinewgame') return;

  if (line.startsWith('go')) {
    if (mode === 'healthy') {
      say('info depth 1 seldepth 1 multipv 1 score cp 20 pv e2e4');
      say('info depth 14 seldepth 18 multipv 1 score cp 31 pv e2e4 e7e5');
      say('bestmove e2e4');
    } else if (mode === 'chatty-never-lands') {
      chatter = setInterval(() => say('info depth 9 seldepth 9 multipv 1 score cp 12 pv e2e4'), 50);
    }
    // the wedge modes say nothing at all
    return;
  }

  if (line === 'stop') {
    clearInterval(chatter);
    if (mode === 'wedge-honours-stop') {
      say('info depth 7 seldepth 9 multipv 1 score cp 18 pv d2d4');
      say('bestmove d2d4');
    } else if (mode === 'chatty-never-lands') {
      say('bestmove e2e4');
    }
    // wedge-ignores-stop: nothing, like an engine that won't come back
  }
}
