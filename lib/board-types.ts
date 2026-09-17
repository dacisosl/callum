export type AttachmentKind = "image" | "pdf";

export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  url: string;
  storagePath?: string;
  // PDF 첫 쪽을 이미지로 만든 썸네일. 카드 타일과 휴대폰 뷰어에서 iframe 대신 씁니다.
  thumbnailUrl?: string;
  thumbnailPath?: string;
}

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image?: string;
  // 대표 이미지가 없는 사이트를 위한 파비콘 주소
  icon?: string;
  siteName?: string;
}

// 카드 배경 색. 저장값은 이름이고 실제 색은 styles.css의 .card-tone-* 규칙이 정합니다.
export type CardTone =
  | "default"
  | "yellow"
  | "peach"
  | "rose"
  | "lilac"
  | "sky"
  | "mint"
  | "slate";

export const CARD_TONES: { value: CardTone; label: string }[] = [
  { value: "default", label: "기본" },
  { value: "yellow", label: "노랑" },
  { value: "peach", label: "살구" },
  { value: "rose", label: "분홍" },
  { value: "lilac", label: "연보라" },
  { value: "sky", label: "하늘" },
  { value: "mint", label: "민트" },
  { value: "slate", label: "회색" },
];

// 칼럼 제목 막대와 + 버튼에 쓰는 색상(HSL 색조). 값이 없으면 모든 칼럼이 같은 기본색을 씁니다.
export const COLUMN_HUES: { value: number; label: string }[] = [
  { value: 222, label: "파랑" },
  { value: 262, label: "보라" },
  { value: 336, label: "장미" },
  { value: 168, label: "청록" },
  { value: 24, label: "주황" },
  { value: 200, label: "하늘" },
  { value: 96, label: "초록" },
  { value: 215, label: "남색" },
];

export interface BoardCard {
  id: string;
  title: string;
  body: string;
  attachments: Attachment[];
  link?: LinkPreviewData;
  tone?: CardTone;
  // 주인이 만든 카드에 저장하는 표시 이름(이메일 앞부분)
  authorName?: string;
  // 공유 링크로 들어온 사람이 올린 카드면 작성자 이름이 들어갑니다.
  guestAuthor?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BoardColumn {
  id: string;
  title: string;
  collapsed: boolean;
  hue?: number;
  cards: BoardCard[];
}

export interface CardComment {
  id: string;
  boardId: string;
  cardId: string;
  author: string;
  body: string;
  createdAt: number;
  // 보드 주인이 로그인한 상태로 남긴 댓글이면 true
  byOwner: boolean;
}

export interface BoardData {
  id: string;
  title: string;
  columns: BoardColumn[];
  ownerId?: string;
  shareEnabled: boolean;
  shareToken: string;
  // 카드 뷰어의 댓글 기능. 꺼져 있으면 주인도 공유받은 사람도 댓글을 볼 수 없습니다.
  commentsEnabled?: boolean;
  // 공유 링크로 들어온 사람이 이 보드에 카드를 올릴 수 있는지. 보드마다 따로 켭니다.
  guestPostEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CardDraft {
  id?: string;
  columnId: string;
  title: string;
  body: string;
  attachments: Attachment[];
  link?: LinkPreviewData;
  tone?: CardTone;
}

// 홈 화면 사용량 대시보드에 보여 주는 값. 무료 요금제 한도와 비교합니다.
export interface UsageSnapshot {
  storageBytes: number;
  storageFiles: number;
  dbBytes: number;
  boardCount: number;
  cardCount: number;
  commentCount: number;
  measuredAt: number;
  // 저장소 목록이 너무 길어 일부만 세었으면 true
  partial?: boolean;
}

// Supabase 무료 요금제 한도. 전송량(월 5GB)은 클라이언트에서 셀 수 없어 대시보드 링크로 안내합니다.
export const FREE_STORAGE_LIMIT = 1024 * 1024 * 1024;
export const FREE_DB_LIMIT = 500 * 1024 * 1024;
