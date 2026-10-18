/**
 * Tic Tac Toe game logic + AI with three difficulty levels.
 * Cells are indexes 0..8 (row-major). "X" always moves first.
 */

export type TttMark = "X" | "O";
export type TttCell = TttMark | null;
export type TttBoard = TttCell[];
export type TttLevel = "beginner" | "intermediate" | "professional";

export const TTT_LEVEL_LABELS: Record<TttLevel, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  professional: "محترف",
};

export const WIN_LINES: number[][] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diags
];

export function emptyBoard(): TttBoard {
  return new Array(9).fill(null);
}

export function winnerOf(board: TttBoard): { mark: TttMark; line: number[] } | null {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return { mark, line };
  }
  return null;
}

export function isFull(board: TttBoard): boolean {
  return board.every((c) => c !== null);
}

export function freeCells(board: TttBoard): number[] {
  const out: number[] = [];
  board.forEach((c, i) => {
    if (!c) out.push(i);
  });
  return out;
}

function opponent(mark: TttMark): TttMark {
  return mark === "X" ? "O" : "X";
}

/** Perfect play via minimax. */
function minimax(board: TttBoard, turn: TttMark): number {
  const win = winnerOf(board);
  if (win) return win.mark === "X" ? 1 : -1;
  if (isFull(board)) return 0;

  let best = turn === "X" ? -Infinity : Infinity;
  for (const i of freeCells(board)) {
    board[i] = turn;
    const score = minimax(board, opponent(turn));
    board[i] = null;
    best = turn === "X" ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

/** Choose the AI's move given the board, its mark and the difficulty. */
export function chooseTttMove(
  board: TttBoard,
  aiMark: TttMark,
  level: TttLevel
): number {
  const free = freeCells(board);
  if (free.length === 0) return -1;

  if (level === "beginner") {
    return free[Math.floor(Math.random() * free.length)];
  }

  if (level === "intermediate") {
    // Win if possible, block if the opponent can win, else random-ish.
    for (const i of free) {
      board[i] = aiMark;
      const wins = winnerOf(board)?.mark === aiMark;
      board[i] = null;
      if (wins) return i;
    }
    const foe = opponent(aiMark);
    for (const i of free) {
      board[i] = foe;
      const blocks = winnerOf(board)?.mark === foe;
      board[i] = null;
      if (blocks) return i;
    }
    // Prefer center, then corners, then edges.
    if (!board[4]) return 4;
    const corners = free.filter((i) => i % 2 === 0 && i !== 4);
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
    return free[Math.floor(Math.random() * free.length)];
  }

  // Professional: perfect minimax play — unbeatable.
  // `minimax` scores from X's perspective, so X maximizes and O minimizes.
  const isMax = aiMark === "X";
  let bestScore = isMax ? -Infinity : Infinity;
  let bestMoves: number[] = [];
  for (const i of free) {
    board[i] = aiMark;
    const score = minimax(board, opponent(aiMark));
    board[i] = null;
    const better = isMax ? score > bestScore : score < bestScore;
    if (better) {
      bestScore = score;
      bestMoves = [i];
    } else if (score === bestScore) {
      bestMoves.push(i);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
