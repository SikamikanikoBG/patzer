import { db } from './db.js';
import { hashPassword } from './auth/passwords.js';
import { analyzePgnFull } from './routes/analyze.js';
import { SCORING_VERSION } from './chess/classifier.js';

export async function seedDemoData() {
  const pwhash = await hashPassword('demo');

  // Use INSERT OR IGNORE so this is idempotent just in case it runs twice.
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role)
    VALUES (1, 'demo1', ?, 'user'), (2, 'demo2', ?, 'user')
  `).run(pwhash, pwhash);

  db.prepare(`
    INSERT OR IGNORE INTO profiles (user_id, display_name, avatar_emoji)
    VALUES (1, 'Demo Player 1', '♟'), (2, 'Demo Player 2', '♞')
  `).run();

  const games = [
    {
      pgn: '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2024.01.01"]\n[Round "-"]\n[White "demo1"]\n[Black "Opponent"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 12. Nbd2 cxd4 13. cxd4 Nc6 14. d5 Nb4 15. Bb1 a5 16. Nf1 Bd7 17. Bd2 Na6 18. N1h2 Nc5 19. a3 a4 20. Bb4 Nb3 21. Bd3 Nxa1 22. Qxa1 Nh5 23. Bf1 Rfc8 24. Qd1 Qc2 25. Qe2 Nf4 26. Qe3 Qxb2 27. Ng4 h5 28. Ngh2 Rc2 29. g3 Nxh3+ 30. Bxh3 Bxh3 31. Nd2 Rac8 32. Nhf1 Bxf1 33. Kxf1 h4 34. gxh4 Bxh4 35. Re2 Rc1+ 36. Kg2 R8c2 37. Qh3 Bf6 38. Qd7 Qa1 39. Qe8+ Kh7 40. Qxf7 Rg1+ 41. Kf3 Qd1 42. Qh5+ Kg8 43. Qe8+ 1-0',
      white: 'demo1', black: 'Opponent', result: '1-0', color: 'white'
    },
    {
      pgn: '[Event "Live Chess"]\n[Site "Chess.com"]\n[Date "2024.01.02"]\n[Round "-"]\n[White "demo1"]\n[Black "Opponent2"]\n[Result "0-1"]\n\n1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 7. f4 Qb6 8. Qd2 Qxb2 9. Rb1 Qa3 10. e5 dxe5 11. fxe5 Nfd7 12. Ne4 h6 13. Bh4 Qxa2 14. Rd1 Qd5 15. Qe3 Qxe5 16. Be2 Bc5 17. Bg3 Qd5 18. c4 Bxd4 19. Rxd4 Qa5+ 20. Rd2 O-O 21. Bd6 Re8 22. O-O Nc6 23. Qg3 f5 24. Qg6 Qd8 25. Bc7 Qe7 26. Nd6 Rf8 27. c5 Nde5 28. Qh5 Qxc7 29. g4 Ne7 30. Rc2 b6 31. g5 bxc5 32. Rd1 Nd5 33. Nc4 hxg5 34. Qxg5 Bb7 35. Re1 Nf7 36. Qg6 Nf4 37. Qg3 e5 38. Bf1 Qc6 0-1',
      white: 'demo1', black: 'Opponent2', result: '0-1', color: 'white'
    }
  ];

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const r = db.prepare(`
      INSERT OR IGNORE INTO games (id, user_id, source, pgn, white, black, result, user_color, rated, end_time)
      VALUES (?, 1, 'played', ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(i + 1, g.pgn, g.white, g.black, g.result, g.color);
    
    if (r.changes > 0) {
      try {
        const analysis = await analyzePgnFull(g.pgn, 12, {
          score: g.result === '1-0' ? 1 : 0, userColor: 'white', opponentRating: null, opponentRd: null
        });
        db.prepare(`
          INSERT OR REPLACE INTO analyses (game_id, depth, accuracy_white, accuracy_black,
            estimated_elo_white, estimated_elo_black, performance_white, performance_black,
            opening_eco, opening_name, key_moments_json, phase_split_json,
            moves_json, scoring_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          i + 1, analysis.depth,
          analysis.accuracy_white, analysis.accuracy_black,
          analysis.estimated_elo_white, analysis.estimated_elo_black,
          analysis.performance_white, analysis.performance_black,
          analysis.opening_eco, analysis.opening_name,
          JSON.stringify(analysis.key_moments),
          analysis.phase_split ? JSON.stringify(analysis.phase_split) : null,
          JSON.stringify(analysis.moves), SCORING_VERSION
        );
        if (analysis.opening_eco || analysis.opening_name) {
          db.prepare(`UPDATE games SET eco = ?, opening_name = ? WHERE id = ?`)
            .run(analysis.opening_eco, analysis.opening_name, i + 1);
        }
      } catch (err) {
        console.error('[demo-seed] analysis failed', err);
      }
    }
  }
}
