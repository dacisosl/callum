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

// 배포 도메인. Vercel 이 넣어 주는 고정 도메인을 우선 쓰고, 없으면 로컬 주소입니다.
export function siteOrigin() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function boardSummary(board: BoardData) {
  const cardCount = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
  return { cardCount, columnCount: board.columns.length, columnTitles: board.columns.map((column) => column.title) };
}
