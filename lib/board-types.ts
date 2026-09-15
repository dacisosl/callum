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

export interface BoardCard {
  id: string;
  title: string;
  body: string;
  attachments: Attachment[];
  link?: LinkPreviewData;
  createdAt: number;
  updatedAt: number;
}

export interface BoardColumn {
  id: string;
  title: string;
  collapsed: boolean;
  cards: BoardCard[];
}

export interface BoardData {
  id: string;
  title: string;
  columns: BoardColumn[];
  ownerId?: string;
  shareEnabled: boolean;
  shareToken: string;
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
}
