"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, BoardCard, BoardData, CardComment, LinkPreviewData } from "./board-types";
import { supabaseConfig, supabaseConfigured } from "./supabase-config";

export type AppUser = { uid: string; email: string | null };

const BUCKET = "attachments";
let client: SupabaseClient | null = null;

function supabase() {
  if (!supabaseConfigured) throw new Error("Supabase 설정값이 없습니다.");
  client ??= createClient(supabaseConfig.url, supabaseConfig.anonKey);
  return client;
}

function toUser(user: { id: string; email?: string } | null | undefined): AppUser | null {
  return user ? { uid: user.id, email: user.email ?? null } : null;
}

const messages: Record<string, string> = {
  "Invalid login credentials": "이메일 또는 비밀번호가 올바르지 않습니다.",
  "Email not confirmed": "이메일 인증이 필요합니다. 받은 메일의 링크를 눌러 주세요.",
  "Email rate limit exceeded": "잠시 후 다시 시도해 주세요.",
};

function translate(error: { message: string }): Error {
  return new Error(messages[error.message] ?? error.message);
}

export function observeUser(callback: (user: AppUser | null) => void) {
  // 토큰 갱신 등으로 같은 사용자가 반복 통지되는 것은 걸러내고, 로그인·로그아웃 때만 알립니다.
  let lastUid: string | null | undefined;
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    const user = toUser(session?.user);
    const uid = user?.uid ?? null;
    if (lastUid !== undefined && uid === lastUid) return;
    lastUid = uid;
    // supabase-js 콜백 안에서 다른 요청을 기다리면 잠금이 걸릴 수 있어 다음 틱으로 넘깁니다.
    setTimeout(() => callback(user), 0);
  });
  return () => data.subscription.unsubscribe();
}

export async function login(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw translate(error);
}

export async function logout() {
  const { error } = await supabase().auth.signOut();
  if (error) throw translate(error);
}

export async function loadOwnedBoards(ownerId: string): Promise<BoardData[]> {
  const { data, error } = await supabase()
    .from("boards")
    .select("data")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw translate(error);
  return (data ?? []).map((row) => ({ ...(row.data as BoardData), ownerId }));
}

export async function loadSharedBoard(token: string): Promise<BoardData | null> {
  const { data, error } = await supabase().rpc("get_shared_board", { token });
  if (error) throw translate(error);
  return (data as BoardData | null) ?? null;
}

export async function saveBoard(board: BoardData, ownerId: string) {
  const payload: BoardData = { ...board, ownerId, updatedAt: Date.now() };
  const { error } = await supabase().from("boards").upsert({
    id: payload.id,
    owner_id: ownerId,
    title: payload.title,
    data: payload,
    share_enabled: payload.shareEnabled,
    share_token: payload.shareToken || "",
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
  });
  if (error) throw translate(error);
  return payload;
}

export async function removeBoard(board: BoardData, ownerId: string) {
  if (board.ownerId && board.ownerId !== ownerId) {
    throw new Error("이 보드를 삭제할 권한이 없습니다.");
  }
  const paths = board.columns.flatMap((column) =>
    column.cards.flatMap((card) =>
      card.attachments.map((attachment) => attachment.storagePath).filter(Boolean),
    ),
  ) as string[];
  if (paths.length) await supabase().storage.from(BUCKET).remove(paths);
  const { error } = await supabase().from("boards").delete().eq("id", board.id);
  if (error) throw translate(error);
}

export async function uploadAttachment(
  file: File,
  ownerId: string,
  boardId: string,
  attachmentId: string,
): Promise<Attachment> {
  // Storage 객체 키는 영문·숫자·일부 기호만 허용됩니다. 한글 등이 들어가면 업로드가
  // 거부되므로 키는 ASCII로만 만들고, 원래 파일 이름은 name 필드에 그대로 보존합니다.
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  const storagePath = `${ownerId}/${boardId}/${attachmentId}-${stem}${ext}`;
  const storage = supabase().storage.from(BUCKET);
  const { error } = await storage.upload(storagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw translate(error);
  return {
    id: attachmentId,
    name: file.name,
    kind: file.type === "application/pdf" ? "pdf" : "image",
    mimeType: file.type,
    size: file.size,
    url: storage.getPublicUrl(storagePath).data.publicUrl,
    storagePath,
  };
}

export async function removeAttachment(path?: string) {
  if (!path) return;
  const { error } = await supabase().storage.from(BUCKET).remove([path]);
  if (error) throw translate(error);
}

// ---- 댓글 ----

type CommentRow = {
  id: string;
  board_id: string;
  card_id: string;
  author_name: string;
  author_id?: string | null;
  by_owner?: boolean;
  body: string;
  created_at: number | string;
};

function toComment(row: CommentRow): CardComment {
  return {
    id: row.id,
    boardId: row.board_id,
    cardId: row.card_id,
    author: row.author_name,
    body: row.body,
    createdAt: Number(row.created_at),
    byOwner: row.by_owner ?? Boolean(row.author_id),
  };
}

// 보드 주인용. RLS가 자기 보드의 댓글만 돌려줍니다.
export async function loadComments(boardId: string): Promise<CardComment[]> {
  const { data, error } = await supabase()
    .from("card_comments")
    .select("id, board_id, card_id, author_name, author_id, body, created_at")
    .eq("board_id", boardId)
    .order("created_at", { ascending: true });
  if (error) throw translate(error);
  return ((data ?? []) as CommentRow[]).map(toComment);
}

// 공유 링크로 보는 사람용. 토큰이 맞고 보드의 댓글 기능이 켜져 있을 때만 결과가 옵니다.
export async function loadSharedComments(token: string): Promise<CardComment[]> {
  const { data, error } = await supabase().rpc("get_shared_comments", { token });
  if (error) throw translate(error);
  return ((data as CommentRow[] | null) ?? []).map(toComment);
}

export async function addComment(comment: CardComment, ownerId: string): Promise<CardComment> {
  const { error } = await supabase().from("card_comments").insert({
    id: comment.id,
    board_id: comment.boardId,
    card_id: comment.cardId,
    author_name: comment.author,
    author_id: ownerId,
    body: comment.body,
    created_at: comment.createdAt,
  });
  if (error) throw translate(error);
  return { ...comment, byOwner: true };
}

export async function addSharedComment(token: string, comment: CardComment): Promise<CardComment> {
  const { data, error } = await supabase().rpc("add_shared_comment", {
    token,
    comment_id: comment.id,
    target_card: comment.cardId,
    author: comment.author,
    content: comment.body,
  });
  if (error) throw translate(error);
  return toComment(data as CommentRow);
}

export async function removeComment(commentId: string) {
  const { error } = await supabase().from("card_comments").delete().eq("id", commentId);
  if (error) throw translate(error);
}

// 공유 링크로 들어온 사람이 카드를 올립니다. 보드의 글쓰기 허용이 켜져 있을 때만 통과합니다.
export async function addSharedCard(
  token: string,
  card: { id: string; columnId: string; title: string; body: string; link?: LinkPreviewData; author: string },
): Promise<BoardCard> {
  const { data, error } = await supabase().rpc("add_shared_card", {
    token,
    card_id: card.id,
    target_column: card.columnId,
    card_title: card.title,
    card_body: card.body,
    card_link: card.link ?? null,
    author: card.author,
  });
  if (error) throw translate(error);
  return data as BoardCard;
}
