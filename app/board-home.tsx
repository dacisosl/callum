"use client";

import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  LayoutGrid,
  Link2,
  Link2Off,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardData } from "@/lib/board-types";

// 공유 링크 만료 안내. 0이거나 없으면 만료되지 않습니다.
function shareExpiry(board: BoardData) {
  const expires = board.shareExpiresAt;
  if (!expires) return { expired: false, text: "만료 없음" };
  const until = new Date(expires).toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
  if (expires <= Date.now()) return { expired: true, text: `${until} 만료됨` };
  const days = Math.ceil((expires - Date.now()) / 86400000);
  return { expired: false, text: `${until}까지 · ${days}일 남음` };
}

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

export function BoardHome({ boards, demo, showLogout, onOpen, onCreate, onRename, onDelete, onLogout, onToggleShare, onRenewShare }: {
  boards: BoardData[];
  demo: boolean;
  showLogout: boolean;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
  onRename: (board: BoardData) => void;
  onDelete: (board: BoardData) => void;
  onLogout: () => void;
  onToggleShare: (board: BoardData, enabled: boolean) => void;
  onRenewShare: (board: BoardData) => void;
}) {
  const [queryText, setQueryText] = useState("");
  const [listOpen, setListOpen] = useState(true);
  // 주소는 브라우저에서만 읽을 수 있어 첫 렌더 뒤에 채웁니다. 그전에는 링크 칸이 비어 있습니다.
  const [origin, setOrigin] = useState("");
  const needle = queryText.trim().toLowerCase();
  const visible = boards.filter((board) => !needle || board.title.toLowerCase().includes(needle));
  const sharedBoards = boards.filter((board) => board.shareEnabled && board.shareToken);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(`${window.location.origin}${window.location.pathname}`);
  }, []);

  const shareUrl = (board: BoardData) => (origin ? `${origin}?share=${board.shareToken}` : "");
  function copyLink(board: BoardData) {
    const url = shareUrl(board);
    if (!url) return;
    void navigator.clipboard.writeText(url);
    toast.success(`${board.title} 공유 링크를 복사했습니다.`);
  }

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
        {sharedBoards.length > 0 && (
          <section className="share-list" aria-label="공유 링크 목록">
            <div className="share-list-head">
              <Share2 aria-hidden="true" />
              <strong>공유 중인 보드</strong>
              <span>{sharedBoards.length}</span>
              <button className="text-button" onClick={() => setListOpen((open) => !open)} aria-expanded={listOpen}>
                {listOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{listOpen ? "접기" : "펼치기"}
              </button>
            </div>
            {listOpen && (
              <ul>
                {sharedBoards.map((board) => {
                  const expiry = shareExpiry(board);
                  return (
                  <li key={board.id} className={expiry.expired ? "is-expired" : undefined}>
                    <button className="share-list-title" onClick={() => onOpen(board.id)}>
                      <Link2 aria-hidden="true" />
                      <strong>{board.title}</strong>
                      {board.commentsEnabled && <em><MessageCircle aria-hidden="true" />댓글</em>}
                    </button>
                    <span className="share-list-expiry"><CalendarClock aria-hidden="true" />{expiry.text}</span>
                    <input readOnly value={shareUrl(board)} aria-label={`${board.title} 공유 링크`} onFocus={(event) => event.currentTarget.select()} />
                    {expiry.expired && <button onClick={() => onRenewShare(board)} aria-label={`${board.title} 공유 기간 연장`} title="기간 연장"><RotateCcw aria-hidden="true" /></button>}
                    <button className="share-list-copy" onClick={() => copyLink(board)} aria-label={`${board.title} 공유 링크 복사`} title="링크 복사"><Copy aria-hidden="true" /></button>
                    <a href={shareUrl(board) || undefined} target="_blank" rel="noreferrer" aria-label={`${board.title} 공유 화면 열기`} title="공유 화면 열기"><ExternalLink aria-hidden="true" /></a>
                    <button onClick={() => onToggleShare(board, false)} aria-label={`${board.title} 공유 중지`} title="공유 중지"><Link2Off aria-hidden="true" /></button>
                  </li>
                  );
                })}
              </ul>
            )}
            {demo && <p className="share-list-note">로컬 데모 링크는 이 브라우저에서만 열립니다.</p>}
          </section>
        )}
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
                      {board.shareEnabled && board.shareToken ? <>
                        <DropdownMenuItem onClick={() => copyLink(board)}><Copy />공유 링크 복사</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onToggleShare(board, false)}><Link2Off />공유 중지</DropdownMenuItem>
                      </> : <DropdownMenuItem onClick={() => onToggleShare(board, true)}><Share2 />공유 링크 만들기</DropdownMenuItem>}
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
