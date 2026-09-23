"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, BoardCard, BoardData, CardComment, LinkPreviewData, UsageSnapshot } from "./board-types";
import { chunk, orphanFiles, referencedPaths, type StoredFile } from "./attachment-sweep";
import { isMissingFunction, type GuestFunctions } from "./rpc-errors";
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
  // 저장소 정책에 막힌 업로드. 보드 설정이 꺼져 있거나, 보드 주인이 supabase/schema.sql 의
  // 최신 손님 업로드 정책을 아직 실행하지 않은 경우입니다.
  "new row violates row-level security policy": "파일을 올릴 수 없습니다. 보드 주인에게 공유 설정의 글쓰기 허용과 Supabase 첨부 정책을 확인해 달라고 알려 주세요.",
  "The object exceeded the maximum allowed size": "파일이 너무 큽니다. 30MB 이하만 올릴 수 있습니다.",
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

// 보드 하나만 다시 읽습니다. RLS 가 걸려 있어 자기 보드만 읽힙니다.
export async function loadBoardById(boardId: string): Promise<BoardData | null> {
  const { data, error } = await supabase().from("boards").select("data").eq("id", boardId).maybeSingle();
  if (error || !data?.data) return null;
  return data.data as BoardData;
}

// 같은 보드를 보고 있는 사람들에게 "내용이 바뀌었다"고 알리는 통로입니다. 표 구독이 아니라
// 방송이라 Supabase 쪽에 따로 켤 설정도, 실행할 SQL 도 없습니다. 방송이 막혀 있어도
// 주기적 확인과 화면 복귀 시 확인이 대신 잡아 주므로 기능이 멈추지는 않습니다.
export function connectBoardChannel(boardId: string, onChange: () => void) {
  const channel = supabase().channel(`board-${boardId}`, { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: "changed" }, () => onChange()).subscribe();
  return {
    notify: () => { void channel.send({ type: "broadcast", event: "changed", payload: {} }).catch(() => {}); },
    close: () => { void supabase().removeChannel(channel); },
  };
}

export async function loadSharedBoard(token: string): Promise<BoardData | null> {
  const { data, error } = await supabase().rpc("get_shared_board", { token });
  if (error) throw translate(error);
  return (data as BoardData | null) ?? null;
}

// 내 화면에 없는 손님 카드를 서버에서 되살립니다. 주인이 보드를 열어 둔 사이 손님이 올린 카드는
// 주인 화면에 없기 때문에, 그대로 덮어쓰면 사라집니다. 주인이 방금 지운 카드는 removedCardIds 로
// 걸러 내어 되살아나지 않게 합니다.
async function withGuestCards(board: BoardData, removedCardIds?: Set<string>): Promise<BoardData> {
  try {
    const { data, error } = await supabase().from("boards").select("data").eq("id", board.id).maybeSingle();
    const remote = (data?.data ?? null) as BoardData | null;
    if (error || !remote?.columns) return board;
    const mine = new Set(board.columns.flatMap((column) => column.cards.map((card) => card.id)));
    let restored = 0;
    const columns = board.columns.map((column) => {
      const remoteColumn = remote.columns.find((item) => item.id === column.id);
      if (!remoteColumn?.cards?.length) return column;
      // 손님 카드는 서버 함수가 항상 맨 앞에 붙이므로 순서를 유지한 채 앞으로 되돌립니다.
      const missing = remoteColumn.cards.filter((card) => card.guestAuthor && !mine.has(card.id) && !removedCardIds?.has(card.id));
      if (!missing.length) return column;
      restored += missing.length;
      return { ...column, cards: [...missing, ...column.cards] };
    });
    return restored ? { ...board, columns } : board;
  } catch {
    // 못 읽으면 평소대로 저장합니다. 저장 자체를 막지는 않습니다.
    return board;
  }
}

export async function saveBoard(board: BoardData, ownerId: string, removedCardIds?: Set<string>) {
  const merged = board.shareEnabled && board.guestPostEnabled ? await withGuestCards(board, removedCardIds) : board;
  const payload: BoardData = { ...merged, ownerId, updatedAt: Date.now() };
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
      card.attachments.flatMap((attachment) => [attachment.storagePath, attachment.thumbnailPath]).filter(Boolean),
    ),
  ) as string[];
  if (paths.length) await supabase().storage.from(BUCKET).remove(paths);
  const { error } = await supabase().from("boards").delete().eq("id", board.id);
  if (error) throw translate(error);
}

// Storage 객체 키는 영문·숫자·일부 기호만 허용됩니다. 한글 등이 들어가면 업로드가
// 거부되므로 키는 ASCII로만 만들고, 원래 파일 이름은 name 필드에 그대로 보존합니다.
function safeFileKey(file: File, attachmentId: string) {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "file";
  return `${attachmentId}-${stem}${ext}`;
}

export async function uploadAttachment(
  file: File,
  ownerId: string,
  boardId: string,
  attachmentId: string,
): Promise<Attachment> {
  const storagePath = `${ownerId}/${boardId}/${safeFileKey(file, attachmentId)}`;
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

// 공유 링크로 들어온 사람의 첨부. guest/{보드ID}/ 경로에 올리며, 저장소 정책이
// 그 보드가 공유 중이고 글쓰기가 켜져 있는지 확인합니다.
export async function uploadGuestAttachment(file: File, boardId: string, attachmentId: string): Promise<Attachment> {
  const storagePath = `guest/${boardId}/${safeFileKey(file, attachmentId)}`;
  const storage = supabase().storage.from(BUCKET);
  const { error } = await storage.upload(storagePath, file, { contentType: file.type, upsert: false });
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

// 첨부 파일을 새 보드 폴더로 복사합니다. 서버 안에서 복사되므로 내려받고 다시 올리지 않습니다.
// 실패한 것은 목록으로 돌려주어, 부르는 쪽이 그 첨부만 원래 경로로 되돌릴 수 있게 합니다.
export async function copyAttachmentFiles(
  files: { from: string; to: string }[],
  onProgress?: (done: number) => void,
): Promise<{ copied: number; failed: string[] }> {
  const storage = supabase().storage.from(BUCKET);
  const failed: string[] = [];
  let done = 0;
  // 한 번에 네 개씩. 많은 파일을 한꺼번에 던지면 저장소가 거부할 수 있습니다.
  for (let index = 0; index < files.length; index += 4) {
    await Promise.all(files.slice(index, index + 4).map(async (file) => {
      try {
        const { error } = await storage.copy(file.from, file.to);
        if (error) failed.push(file.to);
      } catch {
        failed.push(file.to);
      } finally {
        done += 1;
        onProgress?.(done);
      }
    }));
  }
  return { copied: files.length - failed.length, failed };
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
const missingFunction = isMissingFunction;

// 손님 기능에 필요한 데이터베이스 함수가 있는지 확인합니다. 빈 토큰으로 한 번씩 불러 보고
// "함수 없음" 오류인지만 봅니다. 세 함수 모두 보드를 찾는 조건에 token <> '' 가 있어
// 아무것도 쓰기 전에 예외로 빠지므로, 어떤 보드도 건드리지 않습니다.
export async function checkGuestFunctions(): Promise<GuestFunctions> {
  async function exists(name: string, args: Record<string, unknown>) {
    const { error } = await supabase().rpc(name, args);
    return !isMissingFunction(error);
  }
  const [post, edit, remove, upload] = await Promise.all([
    // 수정 열쇠를 받는 새 형태로 확인합니다. 옛 형태만 있으면 새 글에 열쇠가 저장되지 않아
    // 수정도 삭제도 성립하지 않습니다.
    exists("add_shared_card", { token: "", card_id: "", target_column: "", card_title: "", card_body: "", card_link: null, author: "", card_attachments: [], card_edit_key: "" }),
    exists("update_shared_card", { token: "", card_id: "", card_title: "", card_body: "", card_link: null, edit_key: "", card_attachments: [] }),
    exists("delete_shared_card", { token: "", card_id: "", edit_key: "" }),
    // 이 함수가 없으면 손님 업로드 정책도 옛 버전입니다. 둘이 같은 스크립트로 함께 들어갑니다.
    exists("board_accepts_guest_files", { board_id: "" }),
  ]);
  return { post, edit, remove, upload };
}

export async function addSharedCard(
  token: string,
  card: { id: string; columnId: string; title: string; body: string; link?: LinkPreviewData; author: string; attachments: Attachment[]; editKey: string },
): Promise<BoardCard> {
  const base = {
    token,
    card_id: card.id,
    target_column: card.columnId,
    card_title: card.title,
    card_body: card.body,
    card_link: card.link ?? null,
    author: card.author,
    card_attachments: card.attachments,
  };
  const { data, error } = await supabase().rpc("add_shared_card", { ...base, card_edit_key: card.editKey });
  if (!error) return data as BoardCard;
  // 수정 열쇠를 받는 새 함수가 아직 없으면 예전 함수로 그냥 올립니다. 글은 정상적으로 올라가고
  // 나중에 고치는 것만 안 됩니다. 이 때문에 글쓰기 자체가 막히지는 않게 합니다.
  if (!missingFunction(error)) throw translate(error);
  const retry = await supabase().rpc("add_shared_card", base);
  if (retry.error) throw translate(retry.error);
  return retry.data as BoardCard;
}

// 손님이 자기가 올린 글을 고칩니다. 글을 올릴 때 받은 열쇠가 맞아야만 서버가 통과시킵니다.
export async function updateSharedCard(
  token: string,
  card: { id: string; title: string; body: string; link?: LinkPreviewData; attachments: Attachment[]; editKey: string },
): Promise<BoardCard> {
  const { data, error } = await supabase().rpc("update_shared_card", {
    token,
    card_id: card.id,
    card_title: card.title,
    card_body: card.body,
    card_link: card.link ?? null,
    edit_key: card.editKey,
    card_attachments: card.attachments,
  });
  if (missingFunction(error)) throw new Error("이 보드는 아직 글 수정을 받을 준비가 되지 않았습니다. 보드 주인에게 알려 주세요.");
  if (error) throw translate(error);
  return data as BoardCard;
}

// 손님이 자기가 올린 글을 지웁니다. 수정과 같은 열쇠 검사를 거칩니다.
export async function deleteSharedCard(token: string, cardId: string, editKey: string) {
  const { error } = await supabase().rpc("delete_shared_card", { token, card_id: cardId, edit_key: editKey });
  if (missingFunction(error)) throw new Error("이 보드는 아직 글 삭제를 받을 준비가 되지 않았습니다. 보드 주인에게 알려 주세요.");
  if (error) throw translate(error);
}

// ---- 사용량 ----

type StorageEntry = { name: string; id: string | null; created_at?: string | null; metadata?: { size?: number } | null };

// 한 폴더의 파일 크기를 더합니다. 하위 폴더는 재귀로 들어갑니다. 1000개가 넘으면 partial 로 표시합니다.
async function sumFolder(prefix: string, depth: number): Promise<{ bytes: number; files: number; partial: boolean }> {
  if (depth > 3) return { bytes: 0, files: 0, partial: true };
  const { data, error } = await supabase().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return { bytes: 0, files: 0, partial: Boolean(error) };
  let bytes = 0;
  let files = 0;
  let partial = data.length >= 1000;
  for (const entry of data as StorageEntry[]) {
    if (entry.id === null) {
      const nested = await sumFolder(`${prefix}/${entry.name}`, depth + 1);
      bytes += nested.bytes; files += nested.files; partial = partial || nested.partial;
    } else {
      bytes += Number(entry.metadata?.size ?? 0);
      files += 1;
    }
  }
  return { bytes, files, partial };
}

// 한 폴더의 파일을 경로·크기·업로드 시각으로 모읍니다. sumFolder 와 같은 순회 규칙을 씁니다.
async function listFiles(prefix: string, depth: number): Promise<StoredFile[]> {
  if (depth > 3) return [];
  const { data, error } = await supabase().storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const files: StoredFile[] = [];
  for (const entry of data as StorageEntry[]) {
    if (entry.id === null) files.push(...await listFiles(`${prefix}/${entry.name}`, depth + 1));
    else files.push({ path: `${prefix}/${entry.name}`, size: Number(entry.metadata?.size ?? 0), createdAt: entry.created_at ?? undefined });
  }
  return files;
}

// 이 보드의 어느 카드도 가리키지 않는 첨부 파일을 지웁니다. 판단 기준이 되는 board 는 반드시
// 서버에서 막 읽어 온 것이어야 합니다. 화면에 있는 보드는 손님이 방금 올린 글을 모를 수 있습니다.
export async function sweepOrphanAttachments(ownerId: string, board: BoardData, minAgeMs: number): Promise<{ removed: number; bytes: number }> {
  const referenced = referencedPaths(board);
  const files = [...await listFiles(`${ownerId}/${board.id}`, 1), ...await listFiles(`guest/${board.id}`, 1)];
  const targets = orphanFiles(files, referenced, minAgeMs, Date.now());
  if (!targets.length) return { removed: 0, bytes: 0 };
  let removed = 0;
  let bytes = 0;
  for (const group of chunk(targets, 100)) {
    const { error } = await supabase().storage.from(BUCKET).remove(group.map((file) => file.path));
    // 일부가 실패해도 지운 만큼만 알리고 넘어갑니다. 다음에 열 때 다시 시도합니다.
    if (error) continue;
    removed += group.length;
    bytes += group.reduce((sum, file) => sum + file.size, 0);
  }
  return { removed, bytes };
}

// 내 파일({내 ID}/...)과 내 보드에 손님이 올린 파일(guest/{보드ID}/...)을 모두 셉니다.
export async function measureUsage(ownerId: string, boards: BoardData[]): Promise<UsageSnapshot> {
  const mine = await sumFolder(ownerId, 0);
  let guestBytes = 0;
  let guestFiles = 0;
  let partial = mine.partial;
  for (const board of boards) {
    const guest = await sumFolder(`guest/${board.id}`, 1);
    guestBytes += guest.bytes; guestFiles += guest.files; partial = partial || guest.partial;
  }
  const { data } = await supabase().rpc("get_my_usage");
  const db = (data ?? {}) as { board_count?: number; board_bytes?: number; comment_count?: number; comment_bytes?: number };
  return {
    storageBytes: mine.bytes + guestBytes,
    storageFiles: mine.files + guestFiles,
    dbBytes: Number(db.board_bytes ?? 0) + Number(db.comment_bytes ?? 0),
    boardCount: Number(db.board_count ?? boards.length),
    cardCount: boards.reduce((sum, board) => sum + board.columns.reduce((inner, column) => inner + column.cards.length, 0), 0),
    commentCount: Number(db.comment_count ?? 0),
    measuredAt: Date.now(),
    partial,
  };
}
