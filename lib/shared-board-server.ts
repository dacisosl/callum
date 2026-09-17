// 서버(메타데이터, OG 이미지)에서 공유 보드를 읽습니다. 브라우저용 supabase-client 와 달리 "use client" 가 없습니다.
import { createClient } from "@supabase/supabase-js";
import type { BoardData } from "./board-types";
import { supabaseConfig, supabaseConfigured } from "./supabase-config";

export async function loadSharedBoardOnServer(token: string): Promise<BoardData | null> {
  if (!supabaseConfigured || !token) return null;
  try {
    const client = createClient(supabaseConfig.url, supabaseConfig.anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.rpc("get_shared_board", { token });
    if (error) return null;
    return (data as BoardData | null) ?? null;
  } catch {
    return null;
  }
}

export { siteOrigin } from "./site-url";

export function boardSummary(board: BoardData) {
  const cardCount = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
  return { cardCount, columnCount: board.columns.length, columnTitles: board.columns.map((column) => column.title) };
}
