"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Database,
  Gauge,
  HardDrive,
  RefreshCw,
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
import { FREE_DB_LIMIT, FREE_STORAGE_LIMIT, type BoardData, type UsageSnapshot } from "@/lib/board-types";
import { supabaseConfig } from "@/lib/supabase-config";

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

// 한도 대비 사용 비율을 보여 주는 링 미터. 채움 색은 사용량 단계(정상 → 주의 → 위험)를 나타내고
// 빈 부분은 같은 파랑 계열의 연한 단계라 상태가 한눈에 읽힙니다. 색만으로 뜻을 전하지 않도록 숫자와 아이콘을 함께 둡니다.
function RingMeter({ label, used, limit, icon, note }: { label: string; used: number; limit: number; icon: React.ReactNode; note?: string }) {
  const ratio = Math.min(1, Math.max(0, used / limit));
  const percent = Math.round(ratio * 100);
  const severity = ratio >= 0.9 ? "critical" : ratio >= 0.7 ? "warning" : "ok";
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(ratio > 0 ? 2 : 0, circumference * ratio);
  return (
    <figure className={`ring-meter is-${severity}`} role="img" aria-label={`${label} ${formatSize(used)} / ${formatSize(limit)}, ${used > 0 && percent < 1 ? "1% 미만" : `${percent}%`} 사용`}>
      <div className="ring-graphic">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle className="ring-track" cx="56" cy="56" r={radius} />
          <circle className="ring-fill" cx="56" cy="56" r={radius} strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 56 56)" />
        </svg>
        <div className="ring-center"><strong>{used > 0 && percent < 1 ? "<1%" : `${percent}%`}</strong></div>
      </div>
      <figcaption>
        <span className="ring-label">{icon}{label}</span>
        <span className="ring-values">{formatSize(used)} <small>/ {formatSize(limit)}</small></span>
        {severity !== "ok" && <em className="ring-status"><AlertTriangle aria-hidden="true" />{severity === "critical" ? "거의 찼습니다" : "70%를 넘었습니다"}</em>}
        {note && <span className="ring-note">{note}</span>}
      </figcaption>
    </figure>
  );
}

function UsagePanel({ usage, loading, demo, onRefresh }: { usage: UsageSnapshot | null; loading: boolean; demo: boolean; onRefresh: () => void }) {
  const projectRef = supabaseConfig.url.match(/https?:\/\/([^.]+)\./)?.[1];
  const dashboard = projectRef ? `https://supabase.com/dashboard/project/${projectRef}` : "https://supabase.com/dashboard";
  return (
    <section className="usage-panel" aria-label="무료 사용량">
      <div className="usage-head">
        <Gauge aria-hidden="true" />
        <strong>무료 사용량</strong>
        <span className="usage-time">{usage ? `${formatUpdated(usage.measuredAt)} 기준` : loading ? "세는 중" : ""}{usage?.partial ? " · 일부만 셈" : ""}</span>
        <button type="button" className="text-button" onClick={onRefresh} disabled={loading} aria-label="사용량 새로 고침"><RefreshCw aria-hidden="true" className={loading ? "spin" : undefined} />새로 고침</button>
      </div>
      {usage ? (
        <>
          <div className="usage-meters">
            <RingMeter label="파일 저장 공간" used={usage.storageBytes} limit={FREE_STORAGE_LIMIT} icon={<HardDrive aria-hidden="true" />} note={`이미지·PDF ${usage.storageFiles.toLocaleString()}개`} />
            <RingMeter label="보드 데이터" used={usage.dbBytes} limit={FREE_DB_LIMIT} icon={<Database aria-hidden="true" />} note="카드 내용과 댓글이 차지하는 크기" />
          </div>
          <dl className="usage-stats">
            <div><dt>보드</dt><dd>{usage.boardCount.toLocaleString()}</dd></div>
            <div><dt>카드</dt><dd>{usage.cardCount.toLocaleString()}</dd></div>
            <div><dt>첨부 파일</dt><dd>{usage.storageFiles.toLocaleString()}</dd></div>
            <div><dt>댓글</dt><dd>{usage.commentCount.toLocaleString()}</dd></div>
          </dl>
          <p className="usage-foot">
            {demo ? "로컬 데모 모드라 이 브라우저에 저장된 양입니다. " : ""}한 달 전송량(무료 5GB)은 여기서 셀 수 없어 <a href={dashboard} target="_blank" rel="noreferrer">Supabase 대시보드<ExternalLink aria-hidden="true" /></a>에서 확인하세요.
          </p>
        </>
      ) : (
        <p className="usage-foot">{loading ? "저장소와 데이터베이스 사용량을 세고 있습니다." : "사용량을 불러오지 못했습니다. 새로 고침을 눌러 다시 시도하세요."}</p>
      )}
    </section>
  );
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

export function BoardHome({ boards, demo, showLogout, usage, usageLoading, onRefreshUsage, onOpen, onCreate, onRename, onDelete, onLogout, onToggleShare }: {
  boards: BoardData[];
  demo: boolean;
  showLogout: boolean;
  usage: UsageSnapshot | null;
  usageLoading: boolean;
  onRefreshUsage: () => void;
  onOpen: (boardId: string) => void;
  onCreate: () => void;
  onRename: (board: BoardData) => void;
  onDelete: (board: BoardData) => void;
  onLogout: () => void;
  onToggleShare: (board: BoardData, enabled: boolean) => void;
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
        <UsagePanel usage={usage} loading={usageLoading} demo={demo} onRefresh={onRefreshUsage} />
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
                {sharedBoards.map((board) => (
                  <li key={board.id}>
                    <button className="share-list-title" onClick={() => onOpen(board.id)}>
                      <Link2 aria-hidden="true" />
                      <strong>{board.title}</strong>
                      {board.commentsEnabled && <em><MessageCircle aria-hidden="true" />댓글</em>}
                    </button>
                    <input readOnly value={shareUrl(board)} aria-label={`${board.title} 공유 링크`} onFocus={(event) => event.currentTarget.select()} />
                    <button className="share-list-copy" onClick={() => copyLink(board)} aria-label={`${board.title} 공유 링크 복사`} title="링크 복사"><Copy aria-hidden="true" /></button>
                    <a href={shareUrl(board) || undefined} target="_blank" rel="noreferrer" aria-label={`${board.title} 공유 화면 열기`} title="공유 화면 열기"><ExternalLink aria-hidden="true" /></a>
                    <button onClick={() => onToggleShare(board, false)} aria-label={`${board.title} 공유 중지`} title="공유 중지"><Link2Off aria-hidden="true" /></button>
                  </li>
                ))}
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
