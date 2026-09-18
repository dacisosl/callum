// 어느 카드도 가리키지 않는 첨부 파일을 골라내는 규칙입니다. 저장소를 건드리지 않는 순수 계산이라
// 따로 두고 시험합니다. 실제 삭제는 lib/supabase-client.ts 의 sweepOrphanAttachments 가 맡습니다.
import type { BoardData } from "./board-types";

export interface StoredFile {
  path: string;
  size: number;
  // 저장소가 알려 주는 업로드 시각(ISO 문자열). 없으면 나이를 알 수 없어 건드리지 않습니다.
  createdAt?: string;
}

// 보드의 카드들이 쓰고 있는 파일 경로. 카드를 복제하면 여러 카드가 같은 파일을 가리키므로
// 반드시 집합으로 모아야 합니다. 그래야 한 카드를 지워도 남은 카드의 파일이 살아남습니다.
export function referencedPaths(board: BoardData): Set<string> {
  const paths = new Set<string>();
  for (const column of board.columns) {
    for (const card of column.cards) {
      for (const attachment of card.attachments) {
        if (attachment.storagePath) paths.add(attachment.storagePath);
        // PDF 첫 쪽 썸네일도 따로 올린 파일이라 함께 지켜야 합니다.
        if (attachment.thumbnailPath) paths.add(attachment.thumbnailPath);
      }
    }
  }
  return paths;
}

// 지워도 되는 파일만 남깁니다. 카드가 안 쓰면서 올라간 지 minAgeMs 가 지난 것만 고릅니다.
// 나이 조건이 있는 이유: 편집창에 붙여 둔 파일은 저장소에는 있지만 아직 카드에는 없습니다.
// 시각을 알 수 없는 파일은 안전한 쪽으로 남겨 둡니다.
export function orphanFiles(files: StoredFile[], referenced: Set<string>, minAgeMs: number, now: number): StoredFile[] {
  return files.filter((file) => {
    if (referenced.has(file.path)) return false;
    if (!file.createdAt) return false;
    const uploadedAt = Date.parse(file.createdAt);
    if (Number.isNaN(uploadedAt)) return false;
    return now - uploadedAt >= minAgeMs;
  });
}

// 저장소 삭제 요청은 한 번에 너무 많이 보내지 않도록 나눠 보냅니다.
export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

// 자동 정리는 하루가 지난 파일만 건드립니다. 편집창을 하루 열어 두는 경우는 없습니다.
export const AUTO_SWEEP_AGE = 24 * 60 * 60 * 1000;
// 사람이 직접 누른 정리는 10분이면 충분합니다. 지금 쓰고 있지 않다는 것을 본인이 알기 때문입니다.
export const MANUAL_SWEEP_AGE = 10 * 60 * 1000;
