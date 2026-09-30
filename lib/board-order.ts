// 홈 화면의 보드 순서. 보드마다 position 숫자를 두고 작은 것부터 보여 줍니다.
// 아직 숫자가 없는 보드(예전에 만든 것)는 숫자가 있는 보드 뒤에, 읽어 온 순서대로 둡니다.
// 저장소나 화면과 무관한 순수 함수라 따로 시험합니다.
import type { BoardData } from "./board-types";

export function sortBoards(boards: BoardData[]): BoardData[] {
  return boards
    .map((board, index) => ({ board, index }))
    .sort((a, b) => {
      const pa = a.board.position;
      const pb = b.board.position;
      if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
      if (pa !== undefined && pb === undefined) return -1;
      if (pa === undefined && pb !== undefined) return 1;
      return a.index - b.index;
    })
    .map((item) => item.board);
}

// 새 보드가 맨 앞에 오도록 하는 position. 아무 보드에도 숫자가 없으면 0 입니다.
export function firstPosition(boards: BoardData[]): number {
  const known = boards.map((board) => board.position).filter((value): value is number => value !== undefined);
  return known.length ? Math.min(...known) - 1 : 0;
}

export interface PositionUpdate { id: string; position: number }

// activeId 보드를 overId 보드 자리로 옮긴 뒤의 전체 순서와, 숫자를 새로 적어야 하는 보드들.
// 화면에 폴더 하나만 보일 때도 전체 순서 안에서 옮기므로 다른 폴더의 보드 순서는 흐트러지지 않습니다.
// 처음 옮길 때는 숫자가 없던 보드들에도 자리를 매겨 그 뒤로는 순서가 흔들리지 않게 합니다.
export function reorderBoards(boards: BoardData[], activeId: string, overId: string): { order: BoardData[]; updates: PositionUpdate[] } {
  const sorted = sortBoards(boards);
  const from = sorted.findIndex((board) => board.id === activeId);
  const to = sorted.findIndex((board) => board.id === overId);
  if (from < 0 || to < 0 || from === to) return { order: sorted, updates: [] };
  const order = [...sorted];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const updates = order
    .map((board, index) => ({ id: board.id, position: index }))
    .filter((item, index) => order[index].position !== item.position);
  return { order: order.map((board, index) => board.position === index ? board : { ...board, position: index }), updates };
}
