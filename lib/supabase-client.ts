"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Attachment, BoardData } from "./board-types";
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
  "User already registered": "이미 가입된 이메일입니다.",
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

export async function register(email: string, password: string) {
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error) throw translate(error);
  // 대시보드에서 이메일 확인이 켜져 있으면 세션 없이 돌아옵니다.
  return { needsEmailConfirm: !data.session };
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
  const safeName = file.name.replace(/[^a-zA-Z0-9._가-힣-]/g, "-");
  const storagePath = `${ownerId}/${boardId}/${attachmentId}-${safeName}`;
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
