export type AttachmentKind = "image" | "pdf";

export interface Attachment {
  id: string;
  name: string;
  kind: AttachmentKind;
  mimeType: string;
  size: number;
  url: string;
  storagePath?: string;
}

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string;
  image?: string;
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

// 공유 링크 만료 기간. 무제한은 만료 시각을 0으로 저장합니다.
export type ShareDuration = "month" | "year" | "forever";

export const SHARE_DURATIONS: { value: ShareDuration; label: string; days: number }[] = [
  { value: "month", label: "1개월", days: 30 },
  { value: "year", label: "1년", days: 365 },
  { value: "forever", label: "무제한", days: 0 },
];

export const DEFAULT_SHARE_DURATION: ShareDuration = "year";

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
  // 공유 링크 만료 시각(밀리초). 0이거나 없으면 만료되지 않습니다.
  shareExpiresAt?: number;
  // 만료 시각을 계산할 때 고른 기간. 링크를 다시 발급할 때도 이 값을 씁니다.
  shareDuration?: ShareDuration;
  // 카드 뷰어의 댓글 기능. 꺼져 있으면 주인도 공유받은 사람도 댓글을 볼 수 없습니다.
  commentsEnabled?: boolean;
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
