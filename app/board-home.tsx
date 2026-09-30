"use client";

import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  ExternalLink,
  Folder,
  FolderInput,
  FolderPlus,
  LayoutGrid,
  Link2,
  Link2Off,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { COLUMN_HUES, FREE_DB_LIMIT, FREE_STORAGE_LIMIT, type BoardData, type UsageSnapshot } from "@/lib/board-types";
import { boardFolder, boardsInFolder, folderNames, MAX_FOLDER_NAME, normalizeFolderName, pruneEmptyFolders } from "@/lib/board-folders";
import { reorderBoards, sortBoards, type PositionUpdate } from "@/lib/board-order";
import { supabaseConfig } from "@/lib/supabase-config";
import { publicSiteOrigin, shareLink } from "@/lib/site-url";

// 아직 보드가 하나도 없는 폴더는 이 브라우저에만 기억합니다. 보드가 들어가면 보드에 적힌 이름이 원본이 됩니다.
const EMPTY_FOLDERS_KEY = "pillar-folders-v1";
// 사이드바를 접어 둔 것도 이 브라우저에만 기억합니다.
const SIDEBAR_KEY = "pillar-sidebar-v1";
const BUILD_ID = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);

function readEmptyFolders(): string[] {
  try {
    const stored = localStorage.getItem(EMPTY_FOLDERS_KEY);
    const parsed = stored ? (JSON.parse(stored) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function writeEmptyFolders(names: string[]) {
  try { localStorage.setItem(EMPTY_FOLDERS_KEY, JSON.stringify(names)); } catch { /* 저장 못 해도 화면에는 남습니다. */ }
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
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

// 한도 대비 사용 비율. 채움 색은 사용량 단계(정상 → 주의 → 위험)를 나타내고 빈 부분은 같은 파랑 계열의
// 연한 단계입니다. 색만으로 뜻을 전하지 않도록 숫자와 이름을 함께 둡니다.
const RING_COLORS = {
  ok: { fill: "#155eef", track: "#dbe7fd" },
  warning: { fill: "#e08a00", track: "#fdebc8" },
  critical: { fill: "#d92d20", track: "#f9d5d1" },
} as const;

function usageOf(used: number, limit: number) {
  const ratio = Math.min(1, Math.max(0, limit > 0 ? used / limit : 0));
  const percent = Math.round(ratio * 100);
  const severity: keyof typeof RING_COLORS = ratio >= 0.9 ? "critical" : ratio >= 0.7 ? "warning" : "ok";
  return { ratio, percent, label: used > 0 && percent < 1 ? "<1%" : `${percent}%`, spoken: used > 0 && percent < 1 ? "1% 미만" : `${percent}%`, severity };
}

// 사이드바의 작은 링 하나. 크기와 색은 속성으로도 넣어, 스타일시트가 늦어도 커다란 검은 원이 되지 않습니다.
function MiniRing({ name, used, limit }: { name: string; used: number; limit: number }) {
  const { ratio, label, spoken, severity } = usageOf(used, limit);
  const colors = RING_COLORS[severity];
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(ratio > 0 ? 2 : 0, circumference * ratio);
  return (
    <figure className={`mini-ring is-${severity}`} role="img" aria-label={`${name} ${formatSize(used)} / ${formatSize(limit)}, ${spoken} 사용`}>
      <div className="mini-ring-graphic">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r={radius} fill="none" stroke={colors.track} strokeWidth="6" />
          <circle cx="32" cy="32" r={radius} fill="none" stroke={colors.fill} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 32 32)" />
        </svg>
        <strong>{label}</strong>
      </div>
      <figcaption>{name}</figcaption>
    </figure>
  );
}

// 사이드바 아래의 무료 사용량. 접혀 있을 때는 링 둘뿐이고, 펼치면 숫자와 정리 버튼이 나옵니다.
function UsageMini({ usage, loading, demo, onRefresh, onSweep, compact, onExpandSidebar }: { usage: UsageSnapshot | null; loading: boolean; demo: boolean; onRefresh: () => void; onSweep: () => Promise<void>; compact: boolean; onExpandSidebar: () => void }) {
  const [open, setOpen] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  async function sweep() {
    if (!window.confirm("어느 카드도 쓰지 않는 첨부 파일을 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    setSweeping(true);
    try { await onSweep(); } finally { setSweeping(false); }
  }
  const projectRef = supabaseConfig.url.match(/https?:\/\/([^.]+)\./)?.[1];
  const dashboard = projectRef ? `https://supabase.com/dashboard/project/${projectRef}` : "https://supabase.com/dashboard";
  const meters = usage ? [
    { name: "파일", used: usage.storageBytes, limit: FREE_STORAGE_LIMIT, note: `이미지·PDF ${usage.storageFiles.toLocaleString()}개` },
    { name: "데이터", used: usage.dbBytes, limit: FREE_DB_LIMIT, note: "카드 내용과 댓글" },
  ] : [];
  const warnings = meters.map((meter) => ({ ...meter, ...usageOf(meter.used, meter.limit) })).filter((meter) => meter.severity !== "ok");
  return (
    <section className={`side-usage${open ? " is-open" : ""}`} aria-label="무료 사용량">
      <button type="button" className="side-usage-toggle" onClick={() => { if (compact) { onExpandSidebar(); setOpen(true); } else setOpen((value) => !value); }} aria-expanded={open && !compact} title="무료 사용량">
        <span className="side-usage-rings">
          {usage
            ? meters.map((meter) => <MiniRing key={meter.name} name={meter.name} used={meter.used} limit={meter.limit} />)
            : <span className="side-usage-empty">{loading ? "사용량 세는 중" : "사용량 없음"}</span>}
        </span>
        <span className="side-usage-caption"><span>무료 사용량</span>{open ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}</span>
      </button>
      {warnings.length > 0 && !open && !compact && (
        <p className="side-usage-warn"><AlertTriangle aria-hidden="true" />{warnings.map((meter) => meter.name).join("·")} {warnings.some((meter) => meter.severity === "critical") ? "거의 찼습니다" : "70%를 넘었습니다"}</p>
      )}
      {open && !compact && (
        <div className="side-usage-detail">
          {usage ? (
            <>
              {meters.map((meter) => {
                const info = usageOf(meter.used, meter.limit);
                return (
                  <div key={meter.name} className={`side-usage-row is-${info.severity}`}>
                    <div><strong>{meter.name}</strong><span>{formatSize(meter.used)} / {formatSize(meter.limit)}</span></div>
                    <div className="side-usage-bar" aria-hidden="true"><i style={{ width: `${Math.max(info.ratio > 0 ? 1 : 0, info.ratio * 100)}%` }} /></div>
                    <small>{info.severity === "critical" ? "거의 찼습니다" : info.severity === "warning" ? "70%를 넘었습니다" : meter.note}</small>
                  </div>
                );
              })}
              <dl className="side-usage-stats">
                <div><dt>보드</dt><dd>{usage.boardCount.toLocaleString()}</dd></div>
                <div><dt>카드</dt><dd>{usage.cardCount.toLocaleString()}</dd></div>
                <div><dt>첨부</dt><dd>{usage.storageFiles.toLocaleString()}</dd></div>
                <div><dt>댓글</dt><dd>{usage.commentCount.toLocaleString()}</dd></div>
              </dl>
              <p className="side-usage-foot">{formatUpdated(usage.measuredAt)} 기준{usage.partial ? " · 일부만 셈" : ""}{demo ? " · 이 브라우저에 저장된 양" : ""}</p>
            </>
          ) : (
            <p className="side-usage-foot">{loading ? "저장소와 데이터베이스 사용량을 세고 있습니다." : "사용량을 불러오지 못했습니다. 새로 고침을 눌러 보세요."}</p>
          )}
          <div className="side-usage-actions">
            <button type="button" onClick={onRefresh} disabled={loading || sweeping}><RefreshCw aria-hidden="true" className={loading ? "spin" : undefined} />새로 고침</button>
            <button type="button" onClick={() => void sweep()} disabled={sweeping || loading}><Trash2 aria-hidden="true" className={sweeping ? "spin" : undefined} />파일 정리</button>
          </div>
          <a className="side-usage-link" href={dashboard} target="_blank" rel="noreferrer">전송량(월 5GB)은 Supabase에서<ExternalLink aria-hidden="true" /></a>
        </div>
      )}
    </section>
  );
}

// 끌어서 옮길 수 있는 보드 카드 한 장. 8px 이상 끌어야 옮기기가 시작되어 눌러서 여는 것과 겹치지 않습니다.
function SortableBoardCard({ id, className, style, children }: { id: string; className: string; style?: CSSProperties; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <article ref={setNodeRef} className={`${className}${isDragging ? " is-dragging" : ""}`} style={{ ...style, transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}>
      {children}
    </article>
  );
}

export function BoardHome({ boards, demo, showLogout, usage, usageLoading, onRefreshUsage, onSweep, onOpen, onCreate, onRename, onCopy, onDelete, onLogout, onToggleShare, onRecolor, onMoveToFolder, onRenameFolder, onReorder }: {
  boards: BoardData[];
  demo: boolean;
  showLogout: boolean;
  usage: UsageSnapshot | null;
  usageLoading: boolean;
  onRefreshUsage: () => void;
  onSweep: () => Promise<void>;
  onOpen: (boardId: string) => void;
  onCreate: (folder?: string) => void;
  onRename: (board: BoardData) => void;
  onCopy: (board: BoardData) => void;
  onDelete: (board: BoardData) => void;
  onLogout: () => void;
  onToggleShare: (board: BoardData, enabled: boolean) => void;
  onRecolor: (board: BoardData, hue: number | undefined) => void;
  onMoveToFolder: (board: BoardData, folder: string | undefined) => void;
  // to 가 빈 문자열이면 폴더를 없애고 그 안의 보드를 폴더 밖으로 꺼냅니다.
  onRenameFolder: (from: string, to: string) => void;
  onReorder: (updates: PositionUpdate[]) => void;
}) {
  const [queryText, setQueryText] = useState("");
  // 공유 목록은 접힌 채로 시작합니다. 링크가 필요할 때만 펼칩니다.
  const [listOpen, setListOpen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sensors = useSensors(
    // PointerSensor 하나로 하면 휴대폰에서 손가락이 닿자마자 그것이 먼저 잡고 화면 넘기기에 밀려 취소됩니다.
    // 그래서 마우스와 터치를 따로 둡니다. 휴대폰에서는 잠시 눌러야 옮기기가 시작되어 화면 넘기기와 겹치지 않습니다.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [emptyFolders, setEmptyFolders] = useState<string[]>([]);
  // 주소는 브라우저에서만 읽을 수 있어 첫 렌더 뒤에 채웁니다. 그전에는 링크 칸이 비어 있습니다.
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    // 공유 링크는 항상 고정 도메인으로. 로컬 개발 서버에서만 현재 주소를 씁니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(publicSiteOrigin());
    setEmptyFolders(readEmptyFolders());
    try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "collapsed"); } catch { /* 기본은 펼침 */ }
  }, []);

  function toggleSidebar() {
    setCollapsed((value) => {
      try { localStorage.setItem(SIDEBAR_KEY, value ? "open" : "collapsed"); } catch { /* 기억 못 해도 동작합니다. */ }
      return !value;
    });
  }

  // 끌어다 놓으면 전체 순서 안에서 옮기고 바뀐 자리만 저장합니다. 화면은 저장된 position 으로 바로 다시 정렬됩니다.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const { updates } = reorderBoards(boards, String(active.id), String(over.id));
    if (updates.length) onReorder(updates);
  }

  const ordered = sortBoards(boards);
  const folders = folderNames(boards, emptyFolders);
  // 보고 있던 폴더가 사라지면 전체로 돌아갑니다.
  const currentFolder = activeFolder !== null && folders.includes(activeFolder) ? activeFolder : null;
  const scoped = boardsInFolder(ordered, currentFolder);
  const needle = queryText.trim().toLowerCase();
  const visible = scoped.filter((board) => !needle || board.title.toLowerCase().includes(needle));
  const sharedBoards = boards.filter((board) => board.shareEnabled && board.shareToken);
  const countIn = (folder: string) => boards.filter((board) => boardFolder(board) === folder).length;

  function rememberEmpty(names: string[]) {
    const pruned = pruneEmptyFolders(boards, names);
    setEmptyFolders(pruned);
    writeEmptyFolders(pruned);
  }

  function createFolder() {
    const name = normalizeFolderName(window.prompt(`새 폴더 이름 (${MAX_FOLDER_NAME}자까지)`, ""));
    if (!name) return;
    if (folders.includes(name)) { toast.error("같은 이름의 폴더가 이미 있습니다."); setActiveFolder(name); return; }
    rememberEmpty([...emptyFolders, name]);
    setActiveFolder(name);
    toast.success(`"${name}" 폴더를 만들었습니다. 보드 메뉴의 "폴더로 이동"으로 보드를 넣으세요.`);
  }

  function renameFolder(from: string) {
    const to = normalizeFolderName(window.prompt("폴더 이름 변경", from));
    if (!to || to === from) return;
    if (folders.includes(to)) { toast.error("같은 이름의 폴더가 이미 있습니다."); return; }
    if (countIn(from)) onRenameFolder(from, to);
    rememberEmpty(emptyFolders.map((name) => name === from ? to : name).concat(countIn(from) ? [] : [to]));
    if (currentFolder === from) setActiveFolder(to);
  }

  function deleteFolder(name: string) {
    const count = countIn(name);
    if (count && !window.confirm(`"${name}" 폴더를 없앨까요? 안에 있는 보드 ${count}개는 지워지지 않고 폴더 밖으로 나옵니다.`)) return;
    if (count) onRenameFolder(name, "");
    rememberEmpty(emptyFolders.filter((item) => item !== name));
    if (currentFolder === name) setActiveFolder(null);
    toast.success(`"${name}" 폴더를 없앴습니다.`);
  }

  function moveBoard(board: BoardData, folder: string | undefined) {
    onMoveToFolder(board, folder);
    // 보드가 들어간 폴더는 더 이상 "비어 있는 폴더" 가 아닙니다. 나온 폴더가 비면 다시 기억합니다.
    const before = boardFolder(board);
    const next = emptyFolders.filter((name) => name !== folder);
    if (before && before !== folder && countIn(before) === 1) next.push(before);
    setEmptyFolders(next);
    writeEmptyFolders(next);
  }

  const shareUrl = (board: BoardData) => (origin && board.shareToken ? shareLink(origin, board.shareToken) : "");
  function copyLink(board: BoardData) {
    const url = shareUrl(board);
    if (!url) return;
    void navigator.clipboard.writeText(url);
    toast.success(`${board.title} 공유 링크를 복사했습니다.`);
  }

  const heading = currentFolder ?? "모든 보드";

  return (
    <div className={`home-layout${collapsed ? " is-collapsed" : ""}`}>
      <aside className="home-sidebar" aria-label="보드 탐색">
        <div className="side-brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <strong>Padlet-Lite</strong>
          <button type="button" className="side-toggle" onClick={toggleSidebar} aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"} title={collapsed ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={!collapsed}>{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button>
        </div>

        <nav className="side-nav" aria-label="폴더">
          <button type="button" className={`side-item${currentFolder === null ? " is-active" : ""}`} onClick={() => setActiveFolder(null)} aria-current={currentFolder === null ? "page" : undefined} title="모든 보드">
            <LayoutGrid aria-hidden="true" /><span>모든 보드</span><em>{boards.length}</em>
          </button>
          <div className="side-section"><span>폴더</span><button type="button" onClick={createFolder} aria-label="새 폴더" title="새 폴더"><FolderPlus aria-hidden="true" /></button></div>
          {folders.length === 0 && <p className="side-empty">폴더가 없습니다. 위의 <FolderPlus aria-hidden="true" /> 로 만드세요.</p>}
          {folders.map((folder) => (
            <div key={folder} className={`side-folder${currentFolder === folder ? " is-active" : ""}`}>
              <button type="button" className="side-item" onClick={() => setActiveFolder(folder)} aria-current={currentFolder === folder ? "page" : undefined} title={folder}>
                <Folder aria-hidden="true" /><span>{folder}</span><em>{countIn(folder)}</em>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button type="button" className="side-folder-menu" aria-label={`${folder} 폴더 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => onCreate(folder)}><Plus />이 폴더에 새 보드</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => renameFolder(folder)}><Pencil />이름 변경</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => deleteFolder(folder)}><Trash2 />폴더 없애기</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </nav>

        <div className="side-bottom">
          <UsageMini usage={usage} loading={usageLoading} demo={demo} onRefresh={onRefreshUsage} onSweep={onSweep} compact={collapsed} onExpandSidebar={toggleSidebar} />
          {showLogout && <button type="button" className="side-logout" onClick={onLogout} title="로그아웃"><LogOut aria-hidden="true" /><span>로그아웃</span></button>}
          {/* 지금 보고 있는 배포가 최신인지 확인하는 표시. Vercel 이 커밋 번호를 넣어 줍니다. */}
          {BUILD_ID && <span className="side-version" title={`배포 ${BUILD_ID}`}>v.{BUILD_ID}</span>}
        </div>
      </aside>

      <section className="home-main" aria-label="보드 목록">
        <header className="home-head">
          <div className="home-title"><span>{currentFolder ? "폴더" : "Padlet-Lite"}</span><strong>{heading}<em>{scoped.length}</em></strong></div>
          <div className="top-actions">
            <label className="search-box"><Search aria-hidden="true" /><span className="sr-only">보드 검색</span><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="보드 검색" />{queryText && <button onClick={() => setQueryText("")} aria-label="검색어 지우기"><X /></button>}</label>
            <button className="primary-button" onClick={() => onCreate(currentFolder ?? undefined)}><Plus aria-hidden="true" />새 보드</button>
          </div>
        </header>

        {demo && <aside className="demo-banner"><span>로컬 데모 모드 · Supabase 설정을 추가하면 계정과 클라우드 저장이 활성화됩니다.</span><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase 열기 <ExternalLink /></a></aside>}

        {sharedBoards.length > 0 && (
          <section className={`share-list${listOpen ? "" : " is-collapsed"}`} aria-label="공유 링크 목록">
            <button type="button" className="share-list-head" onClick={() => setListOpen((open) => !open)} aria-expanded={listOpen}>
              <Share2 aria-hidden="true" />
              <strong>공유 중인 보드</strong>
              <span>{sharedBoards.length}</span>
              {!listOpen && <small>{sharedBoards.slice(0, 3).map((board) => board.title).join(" · ")}{sharedBoards.length > 3 ? " …" : ""}</small>}
              <em>{listOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{listOpen ? "접기" : "펼치기"}</em>
            </button>
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
            {listOpen && demo && <p className="share-list-note">로컬 데모 링크는 이 브라우저에서만 열립니다.</p>}
          </section>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((board) => board.id)} strategy={rectSortingStrategy}>
        <div className="home-grid">
          {visible.map((board) => {
            const cardCount = board.columns.reduce((sum, column) => sum + column.cards.length, 0);
            const folder = boardFolder(board);
            const style = board.hue !== undefined ? ({ "--board-hue": board.hue } as CSSProperties) : undefined;
            return (
              <SortableBoardCard key={board.id} id={board.id} className={`home-card${board.hue !== undefined ? " has-hue" : ""}`} style={style}>
                <button className="home-open" onClick={() => onOpen(board.id)} aria-label={`${board.title} 열기`}>
                  <span className="home-card-head"><LayoutGrid aria-hidden="true" /><strong>{board.title}</strong></span>
                  <span className="home-chips">
                    {board.columns.slice(0, 3).map((column) => <span key={column.id} className="home-chip">{column.title}<b>{column.cards.length}</b></span>)}
                    {board.columns.length > 3 && <span className="home-chip more">+{board.columns.length - 3}</span>}
                    {board.columns.length === 0 && <span className="home-chip more">칼럼 없음</span>}
                  </span>
                  <span className="home-meta">
                    <span>칼럼 {board.columns.length} · 카드 {cardCount}</span>
                    {folder && currentFolder === null ? <span className="home-folder"><Folder aria-hidden="true" />{folder}</span> : <span><Clock3 aria-hidden="true" />{formatUpdated(board.updatedAt)}</span>}
                  </span>
                </button>
                <div className="home-card-controls">
                  {board.shareEnabled && <span className="home-badge"><Share2 aria-hidden="true" />공유 중</span>}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><button className="quiet-button" aria-label={`${board.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="home-card-menu">
                      <DropdownMenuItem onClick={() => onOpen(board.id)}><LayoutGrid />열기</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRename(board)}><Pencil />이름 변경</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCopy(board)}><Copy />보드 복사</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <div className="menu-swatches" role="group" aria-label="보드 색">
                        <span className="menu-swatches-label"><Palette aria-hidden="true" />색</span>
                        <div>
                          <button type="button" className={`hue-swatch is-none${board.hue === undefined ? " is-active" : ""}`} onClick={() => onRecolor(board, undefined)} aria-label="색 없음" aria-pressed={board.hue === undefined} title="색 없음" />
                          {COLUMN_HUES.map((option) => (
                            <button key={option.value} type="button" className={`hue-swatch${option.value === board.hue ? " is-active" : ""}`} style={{ "--swatch-hue": option.value } as CSSProperties} onClick={() => onRecolor(board, option.value)} aria-label={option.label} aria-pressed={option.value === board.hue} title={option.label} />
                          ))}
                        </div>
                      </div>
                      <DropdownMenuSeparator />
                      <div className="menu-folders" role="group" aria-label="폴더로 이동">
                        <span className="menu-swatches-label"><FolderInput aria-hidden="true" />폴더로 이동</span>
                        {folders.length === 0 && <small>폴더가 없습니다. 사이드바에서 만드세요.</small>}
                        {folders.map((name) => <DropdownMenuItem key={name} disabled={folder === name} onClick={() => moveBoard(board, name)}><Folder />{name}{folder === name && <span className="current-mark">현재</span>}</DropdownMenuItem>)}
                        {folder && <DropdownMenuItem onClick={() => moveBoard(board, undefined)}><X />폴더에서 꺼내기</DropdownMenuItem>}
                      </div>
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
              </SortableBoardCard>
            );
          })}
          <button className="home-new" onClick={() => onCreate(currentFolder ?? undefined)}><Plus aria-hidden="true" />{currentFolder ? `"${currentFolder}"에 새 보드` : "새 보드 만들기"}</button>
        </div>
        </SortableContext>
        </DndContext>
        {needle && visible.length === 0 && <p className="home-empty">일치하는 보드가 없습니다.</p>}
        {!needle && currentFolder && scoped.length === 0 && <p className="home-empty">이 폴더는 비어 있습니다. 보드 메뉴의 <b>폴더로 이동</b>으로 넣거나 위에서 새 보드를 만드세요.</p>}
      </section>
    </div>
  );
}
