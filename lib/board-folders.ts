// 홈 화면의 폴더. 폴더는 따로 저장하지 않고 보드마다 적힌 folder 이름에서 끌어냅니다.
// 그래서 데이터베이스에 표를 더하지 않아도 어느 기기에서나 같은 폴더가 보입니다.
// 비어 있는 폴더(막 만들었거나 보드를 모두 옮긴 폴더)만 브라우저에 잠시 기억합니다.
import type { BoardData } from "./board-types";

export const MAX_FOLDER_NAME = 30;

// 앞뒤 공백을 떼고 길이를 제한합니다. 빈 문자열이면 "폴더 없음" 입니다.
export function normalizeFolderName(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME);
}

export function boardFolder(board: BoardData): string {
  return normalizeFolderName(board.folder);
}

// 보드에 적힌 폴더와 비어 있는 폴더를 합쳐 이름순으로 돌려줍니다. 같은 이름은 하나만 남깁니다.
export function folderNames(boards: BoardData[], empty: string[] = []): string[] {
  const names = new Set<string>();
  for (const board of boards) { const name = boardFolder(board); if (name) names.add(name); }
  for (const name of empty) { const clean = normalizeFolderName(name); if (clean) names.add(clean); }
  return [...names].sort((a, b) => a.localeCompare(b, "ko"));
}

// 보드가 들어 있는 폴더는 "비어 있는 폴더" 목록에서 뺍니다. 그래야 기억이 쌓이지 않습니다.
export function pruneEmptyFolders(boards: BoardData[], empty: string[]): string[] {
  const used = new Set(boards.map(boardFolder));
  return [...new Set(empty.map(normalizeFolderName))].filter((name) => name && !used.has(name));
}

export function boardsInFolder(boards: BoardData[], folder: string | null): BoardData[] {
  if (folder === null) return boards;
  return boards.filter((board) => boardFolder(board) === folder);
}
