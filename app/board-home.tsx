"use client";

import {
  Clock3,
  ExternalLink,
  LayoutGrid,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardData } from "@/lib/board-types";

function formatUpdated(value: number) {
  const minutes = Math.round((Date.now() - value) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

export function BoardHome({ boards, demo, showLogout, onOpen, onCreate, onRename, onDelete, onLogout }: {
  boards: BoardData[];
  demo: boolean;
  showLogout: boolean;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
  onRename: (board: BoardData) => void;
  onDelete: (board: BoardData) => void;
  onLogout: () => void;
}) {
  const [queryText, setQueryText] = useState("");
  const needle = queryText.trim().toLowerCase();
  const visible = boards.filter((board) => !needle || board.title.toLowerCase().includes(needle));

  return (
    <>
      <header className="topbar">
        <div className="brand-row">
          <span className="brand-mark" aria-hidden="true">P</span>
          <div className="home-title"><span>Pillar</span><strong>내 보드<em>{boards.length}</em></strong></div>
        </div>
        <div className="top-actions">
          <label className="search-box"><Search aria-hidden="true" /><span className="sr-only">보드 검색</span><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="보드 검색" />{queryText && <button onClick={() => setQueryText("")} aria-label="검색어 지우기"><X /></button>}</label>
          {showLogout && <button className="icon-button desktop-only" onClick={onLogout} aria-label="로그아웃"><LogOut aria-hidden="true" /></button>}
          <button className="primary-button" onClick={onCreate}><Plus aria-hidden="true" />새 보드</button>
        </div>
      </header>

      {demo && <aside className="demo-banner"><span>로컬 데모 모드 · Supabase 설정을 추가하면 계정과 클라우드 저장이 활성화됩니다.</span><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase 열기 <ExternalLink /></a></aside>}

      <section className="home" aria-label="보드 목록">
        <div className="home-grid">
          {visible.map((board) => {
            const cardCount = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
            return (
              <article key={board.id} className="home-card">
                <button className="home-open" onClick={() => onOpen(board.id)} aria-label={`${board.title} 열기`}>
                  <span className="home-card-head"><LayoutGrid aria-hidden="true" /><strong>{board.title}</strong></span>
                  <span className="home-chips">
                    {board.columns.slice(0, 3).map((column) => <span key={column.id} className="home-chip">{column.title}<b>{column.cards.length}</b></span>)}
                    {board.columns.length > 3 && <span className="home-chip more">+{board.columns.length - 3}</span>}
                    {board.columns.length === 0 && <span className="home-chip more">칼럼 없음</span>}
                  </span>
                  <span className="home-meta"><span>칼럼 {board.columns.length} · 카드 {cardCount}</span><span><Clock3 aria-hidden="true" />{formatUpdated(board.updatedAt)}</span></span>
                </button>
                <div className="home-card-controls">
                  {board.shareEnabled && <span className="home-badge"><Share2 aria-hidden="true" />공유 중</span>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="quiet-button" aria-label={`${board.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpen(board.id)}><LayoutGrid />열기</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRename(board)}><Pencil />이름 변경</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(board)}><Trash2 />보드 삭제</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
          <button className="home-new" onClick={onCreate}><Plus aria-hidden="true" />새 보드 만들기</button>
        </div>
        {needle && visible.length === 0 && <p className="home-empty">일치하는 보드가 없습니다.</p>}
      </section>
    </>
  );
}
