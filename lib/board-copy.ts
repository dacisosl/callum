// 보드를 복사할 때 "무엇이 어떻게 되어야 하는지" 만 계산합니다. 저장소도 네트워크도 건드리지
// 않는 순수 함수라 따로 시험할 수 있습니다. 실제 파일 복사는 lib/supabase-client.ts 가 맡습니다.
import type { Attachment, BoardCard, BoardColumn, BoardData } from "./board-types";

// 새 보드 폴더로 옮겨야 할 파일 하나. field 는 첨부의 어느 경로인지(본체인지 PDF 썸네일인지)입니다.
export interface CopyFile {
  from: string;
  to: string;
  field: "storagePath" | "thumbnailPath";
  cardId: string;
  attachmentId: string;
}

export interface CopyOptions {
  title: string;
  // 복사할 칼럼의 원래 ID 들. 순서는 원본 보드의 순서를 따릅니다.
  columnIds: string[];
  includeCards: boolean;
  newBoardId: string;
  ownerId?: string;
  makeId: (prefix: string) => string;
  now: number;
}

// 저장소 경로에서 파일 이름만 꺼냅니다. 새 경로를 만들 때 원래 이름을 살리려고 씁니다.
function fileNameOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  // 업로드할 때 앞에 붙인 "{첨부ID}-" 를 떼어 원래 이름에 가깝게 만듭니다.
  const dash = name.indexOf("-");
  const stripped = dash > 0 ? name.slice(dash + 1) : name;
  return stripped || "file";
}

// 복사본이 쓸 저장소 경로. 업로드할 때와 같은 모양이라 정리 기능도 그대로 알아봅니다.
function copyPath(ownerId: string | undefined, boardId: string, attachmentId: string, from: string) {
  // 주인 폴더가 없는 상황(데모 등)에서는 원래 경로를 그대로 둡니다. 부를 쪽에서 파일 복사를 건너뜁니다.
  if (!ownerId) return from;
  return `${ownerId}/${boardId}/${attachmentId}-${fileNameOf(from)}`;
}

// 고른 칼럼만 남기고 ID 를 모두 새로 만든 보드를 돌려줍니다. 함께 돌려주는 files 는 새 보드
// 폴더로 옮겨야 할 파일 목록입니다. 보드 안의 경로는 이미 새 경로로 적혀 있으므로, 파일 복사에
// 실패하면 부르는 쪽에서 그 항목만 원래 경로로 되돌려야 합니다.
export function planBoardCopy(source: BoardData, options: CopyOptions): { board: BoardData; files: CopyFile[] } {
  const { title, columnIds, includeCards, newBoardId, ownerId, makeId, now } = options;
  const wanted = new Set(columnIds);
  const files: CopyFile[] = [];

  function copyAttachment(attachment: Attachment, cardId: string): Attachment {
    const id = makeId("file");
    const next: Attachment = { ...attachment, id };
    if (attachment.storagePath) {
      const to = copyPath(ownerId, newBoardId, id, attachment.storagePath);
      if (to !== attachment.storagePath) {
        files.push({ from: attachment.storagePath, to, field: "storagePath", cardId, attachmentId: id });
        next.storagePath = to;
      }
    }
    if (attachment.thumbnailPath) {
      const to = copyPath(ownerId, newBoardId, `${id}-thumb`, attachment.thumbnailPath);
      if (to !== attachment.thumbnailPath) {
        files.push({ from: attachment.thumbnailPath, to, field: "thumbnailPath", cardId, attachmentId: id });
        next.thumbnailPath = to;
      }
    }
    return next;
  }

  function copyCard(card: BoardCard): BoardCard {
    const id = makeId("card");
    // editKeyHash 는 버립니다. 카드 ID 가 새로 생겨 손님 브라우저의 열쇠와 짝이 맞지 않습니다.
    const { editKeyHash: _dropped, ...rest } = card;
    void _dropped;
    return {
      ...rest,
      id,
      attachments: card.attachments.map((attachment) => copyAttachment(attachment, id)),
      createdAt: now,
      updatedAt: now,
    };
  }

  function copyColumn(column: BoardColumn): BoardColumn {
    return {
      ...column,
      id: makeId("column"),
      cards: includeCards ? column.cards.map(copyCard) : [],
    };
  }

  const board: BoardData = {
    ...source,
    id: newBoardId,
    title,
    // 복사본은 공유가 꺼진 채로 시작합니다. share_token 에 고유 인덱스가 걸려 있어
    // 원본의 토큰을 그대로 두면 저장이 실패합니다.
    shareEnabled: false,
    shareToken: "",
    columns: source.columns.filter((column) => wanted.has(column.id)).map(copyColumn),
    createdAt: now,
    updatedAt: now,
  };

  return { board, files };
}

// 고른 칼럼이 안고 있는 첨부의 개수와 크기. 복사 창에서 "얼마나 더 쓰게 되는지" 보여 줍니다.
export function attachmentWeight(source: BoardData, columnIds: string[], includeCards: boolean) {
  if (!includeCards) return { count: 0, bytes: 0 };
  const wanted = new Set(columnIds);
  let count = 0;
  let bytes = 0;
  for (const column of source.columns) {
    if (!wanted.has(column.id)) continue;
    for (const card of column.cards) {
      for (const attachment of card.attachments) {
        count += 1;
        bytes += attachment.size || 0;
      }
    }
  }
  return { count, bytes };
}
