/**
 * A compact, dependency-free chess engine: full legal move generation
 * (castling, en passant, promotion), check/checkmate/stalemate detection and
 * a minimax AI with three difficulty levels.
 *
 * Board indexing: 0 = a8 (top-left), 63 = h1 (bottom-right).
 *   index = (7 - rank) * 8 + file   (file 0..7 = a..h, rank 0..7 = 1..8)
 * Uppercase pieces are White, lowercase are Black.
 */

export type ChessColor = "w" | "b";
export type PieceCode = string;
export type ChessBoard = (PieceCode | null)[];

export interface ChessMove {
  from: number;
  to: number;
  promo?: "q" | "r" | "b" | "n";
  castle?: "K" | "Q" | "k" | "q";
  ep?: boolean;
}

export interface ChessState {
  board: ChessBoard;
  turn: ChessColor;
  castling: string; // subset of "KQkq"
  ep: number | null; // en-passant target square
  halfmove: number;
}

export type ChessLevel = "beginner" | "intermediate" | "professional";

export const CHESS_LEVEL_LABELS: Record<ChessLevel, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  professional: "محترف",
};

const KNIGHT_DELTAS: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: Array<[number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const ALL_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

export function pieceColor(p: PieceCode): ChessColor {
  return p === p.toUpperCase() ? "w" : "b";
}

export function sqName(i: number): string {
  return "abcdefgh"[i % 8] + String(8 - Math.floor(i / 8));
}

export function initialState(): ChessState {
  const back: PieceCode[] = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board: ChessBoard = new Array(64).fill(null);
  for (let f = 0; f < 8; f++) {
    board[f] = back[f]; // black back rank (rank 8)
    board[8 + f] = "p"; // black pawns
    board[48 + f] = "P"; // white pawns
    board[56 + f] = back[f].toUpperCase(); // white back rank (rank 1)
  }
  return { board, turn: "w", castling: "KQkq", ep: null, halfmove: 0 };
}

/* ------------------------------------------------------------------ */
/* Move generation                                                     */
/* ------------------------------------------------------------------ */

function inBounds(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

export function isSquareAttacked(
  board: ChessBoard,
  target: number,
  by: ChessColor
): boolean {
  const tf = target % 8;
  const tr = 7 - Math.floor(target / 8); // rank 0..7 from bottom

  // Pawns: a white pawn attacks upward, so it sits one rank below and one
  // file aside of the target.
  for (const df of [-1, 1]) {
    const af = tf + df;
    const ar = tr - (by === "w" ? 1 : -1);
    if (inBounds(af, ar)) {
      const p = board[(7 - ar) * 8 + af];
      if (p && p.toLowerCase() === "p" && pieceColor(p) === by) return true;
    }
  }
  // Knights
  for (const [df, dr] of KNIGHT_DELTAS) {
    const af = tf + df;
    const ar = tr + dr;
    if (!inBounds(af, ar)) continue;
    const p = board[(7 - ar) * 8 + af];
    if (p && p.toLowerCase() === "n" && pieceColor(p) === by) return true;
  }
  // King
  for (const [df, dr] of KING_DELTAS) {
    const af = tf + df;
    const ar = tr + dr;
    if (!inBounds(af, ar)) continue;
    const p = board[(7 - ar) * 8 + af];
    if (p && p.toLowerCase() === "k" && pieceColor(p) === by) return true;
  }
  // Sliding: rook/queen on ranks & files
  for (const [df, dr] of ROOK_DIRS) {
    let af = tf + df;
    let ar = tr + dr;
    while (inBounds(af, ar)) {
      const p = board[(7 - ar) * 8 + af];
      if (p) {
        if (pieceColor(p) === by && (p.toLowerCase() === "r" || p.toLowerCase() === "q"))
          return true;
        break;
      }
      af += df;
      ar += dr;
    }
  }
  // Sliding: bishop/queen on diagonals
  for (const [df, dr] of BISHOP_DIRS) {
    let af = tf + df;
    let ar = tr + dr;
    while (inBounds(af, ar)) {
      const p = board[(7 - ar) * 8 + af];
      if (p) {
        if (pieceColor(p) === by && (p.toLowerCase() === "b" || p.toLowerCase() === "q"))
          return true;
        break;
      }
      af += df;
      ar += dr;
    }
  }
  return false;
}

export function findKing(board: ChessBoard, color: ChessColor): number {
  const k = color === "w" ? "K" : "k";
  for (let i = 0; i < 64; i++) if (board[i] === k) return i;
  return -1;
}

export function isInCheck(state: ChessState, color: ChessColor): boolean {
  const king = findKing(state.board, color);
  if (king < 0) return false;
  return isSquareAttacked(state.board, king, color === "w" ? "b" : "w");
}

function pseudoMoves(state: ChessState): ChessMove[] {
  const { board, turn } = state;
  const moves: ChessMove[] = [];
  const push = (m: ChessMove) => moves.push(m);

  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p || pieceColor(p) !== turn) continue;
    const f = i % 8;
    const r = 7 - Math.floor(i / 8);
    const lower = p.toLowerCase();

    if (lower === "p") {
      const dir = turn === "w" ? 1 : -1;
      const startRank = turn === "w" ? 1 : 6;
      const promoRank = turn === "w" ? 7 : 0;
      const one = (7 - (r + dir)) * 8 + f;
      if (r + dir >= 0 && r + dir <= 7 && !board[one]) {
        if (r + dir === promoRank) {
          for (const promo of ["q", "r", "b", "n"] as const)
            push({ from: i, to: one, promo });
        } else {
          push({ from: i, to: one });
          const two = (7 - (r + 2 * dir)) * 8 + f;
          if (r === startRank && !board[two]) push({ from: i, to: two });
        }
      }
      for (const df of [-1, 1]) {
        const cf = f + df;
        const cr = r + dir;
        if (!inBounds(cf, cr)) continue;
        const to = (7 - cr) * 8 + cf;
        const t = board[to];
        if (t && pieceColor(t) !== turn) {
          if (cr === promoRank) {
            for (const promo of ["q", "r", "b", "n"] as const)
              push({ from: i, to, promo });
          } else {
            push({ from: i, to });
          }
        } else if (!t && state.ep === to) {
          push({ from: i, to, ep: true });
        }
      }
    } else if (lower === "n") {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const cf = f + df;
        const cr = r + dr;
        if (!inBounds(cf, cr)) continue;
        const to = (7 - cr) * 8 + cf;
        const t = board[to];
        if (!t || pieceColor(t) !== turn) push({ from: i, to });
      }
    } else if (lower === "b" || lower === "r" || lower === "q") {
      const dirs =
        lower === "b" ? BISHOP_DIRS : lower === "r" ? ROOK_DIRS : ALL_DIRS;
      for (const [df, dr] of dirs) {
        let cf = f + df;
        let cr = r + dr;
        while (inBounds(cf, cr)) {
          const to = (7 - cr) * 8 + cf;
          const t = board[to];
          if (!t) {
            push({ from: i, to });
          } else {
            if (pieceColor(t) !== turn) push({ from: i, to });
            break;
          }
          cf += df;
          cr += dr;
        }
      }
    } else if (lower === "k") {
      for (const [df, dr] of KING_DELTAS) {
        const cf = f + df;
        const cr = r + dr;
        if (!inBounds(cf, cr)) continue;
        const to = (7 - cr) * 8 + cf;
        const t = board[to];
        if (!t || pieceColor(t) !== turn) push({ from: i, to });
      }
      // Castling
      const enemy: ChessColor = turn === "w" ? "b" : "w";
      const home = turn === "w" ? 60 : 4;
      if (i === home && !isSquareAttacked(board, home, enemy)) {
        const kSide = turn === "w" ? "K" : "k";
        const qSide = turn === "w" ? "Q" : "q";
        if (
          state.castling.includes(kSide) &&
          !board[home + 1] &&
          !board[home + 2] &&
          board[home + 3] === (turn === "w" ? "R" : "r") &&
          !isSquareAttacked(board, home + 1, enemy) &&
          !isSquareAttacked(board, home + 2, enemy)
        )
          push({ from: i, to: home + 2, castle: kSide as "K" | "k" });
        if (
          state.castling.includes(qSide) &&
          !board[home - 1] &&
          !board[home - 2] &&
          !board[home - 3] &&
          board[home - 4] === (turn === "w" ? "R" : "r") &&
          !isSquareAttacked(board, home - 1, enemy) &&
          !isSquareAttacked(board, home - 2, enemy)
        )
          push({ from: i, to: home - 2, castle: qSide as "Q" | "q" });
      }
    }
  }
  return moves;
}

export function applyMove(state: ChessState, m: ChessMove): ChessState {
  const board = state.board.slice();
  const p = board[m.from]!;
  const lower = p.toLowerCase();
  const turn = state.turn;
  let castling = state.castling;
  let ep: number | null = null;
  let halfmove = state.halfmove + 1;

  board[m.from] = null;
  board[m.to] = m.promo
    ? turn === "w"
      ? m.promo.toUpperCase()
      : m.promo
    : p;

  if (lower === "p" || lower === "k") halfmove = 0;
  if (m.ep) {
    // The captured pawn sits behind the target square.
    const capSq = m.to + (turn === "w" ? 8 : -8);
    board[capSq] = null;
    halfmove = 0;
  }
  if (m.castle) {
    // King already moved; slide the rook.
    const rankHome = turn === "w" ? 56 : 0;
    if (m.castle === "K" || m.castle === "k") {
      board[rankHome + 5] = board[rankHome + 7];
      board[rankHome + 7] = null;
    } else {
      board[rankHome + 3] = board[rankHome + 0];
      board[rankHome + 0] = null;
    }
  }
  if (lower === "p" && Math.abs(m.to - m.from) === 16) {
    ep = (m.from + m.to) / 2;
  }
  // Update castling rights
  if (lower === "k")
    castling = castling.replace(turn === "w" ? /[KQ]/g : /[kq]/g, "");
  if (m.from === 63 || m.to === 63) castling = castling.replace("K", "");
  if (m.from === 56 || m.to === 56) castling = castling.replace("Q", "");
  if (m.from === 7 || m.to === 7) castling = castling.replace("k", "");
  if (m.from === 0 || m.to === 0) castling = castling.replace("q", "");

  return {
    board,
    turn: turn === "w" ? "b" : "w",
    castling,
    ep,
    halfmove,
  };
}

export function generateLegalMoves(state: ChessState): ChessMove[] {
  const legal: ChessMove[] = [];
  for (const m of pseudoMoves(state)) {
    const next = applyMove(state, m);
    if (!isInCheck(next, state.turn)) legal.push(m);
  }
  return legal;
}

export type ChessStatus =
  | { over: false }
  | { over: true; result: "checkmate"; winner: ChessColor }
  | { over: true; result: "stalemate" }
  | { over: true; result: "draw" };

function insufficientMaterial(board: ChessBoard): boolean {
  const pieces = board.filter(Boolean) as PieceCode[];
  const minors = pieces.filter((p) => {
    const l = p.toLowerCase();
    return l === "b" || l === "n";
  });
  // K vs K, K+minor vs K, K+B vs K+B (same or opposite colors doesn't matter
  // enough here to distinguish — treated as a draw for a friendly game).
  if (minors.length <= 1 && pieces.length <= 3) return true;
  if (minors.length === 2 && pieces.length === 4 && minors.every((p) => p.toLowerCase() === "b"))
    return true;
  return false;
}

export function getStatus(state: ChessState): ChessStatus {
  const legal = generateLegalMoves(state);
  if (legal.length === 0) {
    if (isInCheck(state, state.turn))
      return { over: true, result: "checkmate", winner: state.turn === "w" ? "b" : "w" };
    return { over: true, result: "stalemate" };
  }
  if (state.halfmove >= 100) return { over: true, result: "draw" };
  if (insufficientMaterial(state.board)) return { over: true, result: "draw" };
  return { over: false };
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

const PIECE_VALUES: Record<string, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 0,
};

// Piece-square tables (White's perspective, a8-first row order).
const PST: Record<string, number[]> = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

/** Static evaluation from White's perspective (centipawns). */
function evaluate(state: ChessState): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p) continue;
    const lower = p.toLowerCase();
    const value = PIECE_VALUES[lower] + PST[lower][pieceColor(p) === "w" ? i : 63 - i];
    score += pieceColor(p) === "w" ? value : -value;
  }
  return score;
}

function orderMoves(moves: ChessMove[], board: ChessBoard): ChessMove[] {
  return moves
    .map((m) => {
      const victim = board[m.to]?.toLowerCase() ?? "";
      const attacker = board[m.from]?.toLowerCase() ?? "";
      const score =
        (victim ? PIECE_VALUES[victim] * 10 - PIECE_VALUES[attacker] : 0) +
        (m.promo ? 800 : 0);
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

function negamax(
  state: ChessState,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number
): number {
  if (depth === 0 || Date.now() > deadline) {
    const e = evaluate(state);
    return state.turn === "w" ? e : -e;
  }
  const moves = orderMoves(generateLegalMoves(state), state.board);
  if (moves.length === 0) {
    if (isInCheck(state, state.turn)) return -100000 - depth; // prefer faster mates
    return 0; // stalemate
  }
  let best = -Infinity;
  for (const m of moves) {
    const score = -negamax(applyMove(state, m), depth - 1, -beta, -alpha, deadline);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function randomMove(moves: ChessMove[]): ChessMove {
  return moves[Math.floor(Math.random() * moves.length)];
}

/** Pick a computer move for the given difficulty level. */
export function chooseComputerMove(
  state: ChessState,
  level: ChessLevel
): ChessMove | null {
  const moves = generateLegalMoves(state);
  if (moves.length === 0) return null;

  if (level === "beginner") {
    // Mostly random, but grabs an obvious free capture ~40% of the time.
    const captures = moves.filter((m) => state.board[m.to] || m.ep);
    if (captures.length > 0 && Math.random() < 0.4)
      return captures[Math.floor(Math.random() * captures.length)];
    return randomMove(moves);
  }

  const depth = level === "intermediate" ? 2 : 4;
  const budget = level === "intermediate" ? 700 : 2500;
  const deadline = Date.now() + budget;

  let bestMove = moves[0];
  let bestScore = -Infinity;
  // Iterative deepening so we always have a move even if the budget runs out.
  for (let d = 2; d <= depth; d++) {
    let alpha = -Infinity;
    let found = false;
    for (const m of orderMoves(moves, state.board)) {
      const score = -negamax(applyMove(state, m), d - 1, -Infinity, -alpha, deadline);
      if (score > bestScore || !found) {
        bestScore = score;
        bestMove = m;
        found = true;
      }
      if (score > alpha) alpha = score;
      if (Date.now() > deadline) break;
    }
    if (Date.now() > deadline) break;
  }
  return bestMove;
}

/** Human-readable notation for a move in the position *before* it is played. */
export function moveNotation(state: ChessState, m: ChessMove): string {
  const p = state.board[m.from];
  if (!p) return "";
  const symbol = p === p.toUpperCase() ? p : p.toUpperCase();
  const capture = state.board[m.to] || m.ep ? "x" : "-";
  if (m.castle) return m.castle === "K" || m.castle === "k" ? "O-O" : "O-O-O";
  const promo = m.promo ? "=" + m.promo.toUpperCase() : "";
  return `${symbol}${sqName(m.from)}${capture}${sqName(m.to)}${promo}`;
}
