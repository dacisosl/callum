"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { AppUser } from "@/lib/supabase-client";
import {
  ExternalLink,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  LogOut,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  Palette,
  Play,
  Send,
  PanelTopClose,
  PanelTopOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  UploadCloud,
  X,
  Copy,
  ChevronsUpDown,
  LayoutGrid,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { BoardHome } from "./board-home";
import { cloneStarterBoard } from "@/lib/demo-data";
import { supabaseConfigured } from "@/lib/supabase-config";
import {
  CARD_TONES,
  COLUMN_HUES,
  type Attachment,
  type BoardCard,
  type BoardColumn,
  type BoardData,
  type CardComment,
  type CardDraft,
  type CardTone,
  type LinkPreviewData,
} from "@/lib/board-types";

const LOCAL_KEY = "pillar-boards-v3";
const LOCAL_COMMENTS_KEY = "pillar-comments-v1";
const COMMENT_NAME_KEY = "pillar-comment-name";
const MAX_CLOUD_FILE = 15 * 1024 * 1024;
const MAX_DEMO_FILE = 2 * 1024 * 1024;

type DeleteTarget =
  | { kind: "board"; id: string; title: string }
  | { kind: "column"; id: string; title: string }
  | { kind: "card"; id: string; columnId: string; title: string };

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeShareToken() {
  return crypto.randomUUID().replaceAll("-", "");
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function isVideoUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com"].some(
      (name) => host === name || host.endsWith(`.${name}`),
    );
  } catch {
    return false;
  }
}

type VideoEmbed = { provider: "youtube" | "vimeo"; embedUrl: string; thumbnail?: string };

// "1h2m3s", "90s", "90" 형태의 유튜브 시작 시각을 초로 바꿉니다.
function parseTimestamp(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

// 유튜브·비메오 링크면 카드 안에서 바로 재생할 수 있는 embed 주소와 썸네일을 만듭니다.
function getVideoEmbed(value: string | undefined): VideoEmbed | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    let id = "";
    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? "";
    else if (url.searchParams.get("v")) id = url.searchParams.get("v") ?? "";
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?]+)/)?.[1] ?? "";
    if (!/^[\w-]{11}$/.test(id)) return null;
    const params = new URLSearchParams({ rel: "0" });
    const start = parseTimestamp(url.searchParams.get("t") ?? url.searchParams.get("start") ?? "");
    if (start > 0) params.set("start", String(start));
    return { provider: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${params}`, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.match(/\/(\d{6,})(?:$|[/?])/)?.[1];
    return id ? { provider: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` } : null;
  }
  return null;
}

function linkLabel(link: LinkPreviewData) {
  if (getVideoEmbed(link.url)) return "동영상";
  if (isVideoUrl(link.url)) return "동영상 링크";
  return link.siteName || "링크";
}

function formatRelative(value: number) {
  try { return formatDistanceToNow(value, { addSuffix: true, locale: ko }); } catch { return ""; }
}

function formatDate(value: number) {
  return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

// 카드 타일에 쓰는 댓글 요약. first는 가장 먼저 달린 댓글입니다.
type CommentSummary = { count: number; first: CardComment };

// 칼럼 색을 따로 고르기 전까지는 모든 칼럼이 같은 기본색을 씁니다.
const DEFAULT_COLUMN_HUE = COLUMN_HUES[0].value;

function columnHue(column: BoardColumn) {
  return column.hue ?? DEFAULT_COLUMN_HUE;
}

function readLocalComments(): CardComment[] {
  try {
    const stored = localStorage.getItem(LOCAL_COMMENTS_KEY);
    return stored ? (JSON.parse(stored) as CardComment[]) : [];
  } catch {
    return [];
  }
}

function writeLocalComments(comments: CardComment[]) {
  localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(comments));
}

function typeIcon(card: BoardCard) {
  if (card.attachments.some((item) => item.kind === "pdf")) return <FileText />;
  if (card.attachments.some((item) => item.kind === "image")) return <ImageIcon />;
  if (getVideoEmbed(card.link?.url)) return <Play />;
  if (card.link) return <Link2 />;
  return <FileText />;
}

function findCard(board: BoardData, id: string) {
  for (const column of board.columns) {
    const index = column.cards.findIndex((card) => card.id === id);
    if (index >= 0) return { column, columnIndex: board.columns.indexOf(column), index };
  }
  return null;
}

function readLocalBoards(): BoardData[] {
  try {
    const stored = localStorage.getItem(LOCAL_KEY);
    if (!stored) return [cloneStarterBoard()];
    const boards = JSON.parse(stored) as BoardData[];
    return boards.length ? boards : [cloneStarterBoard()];
  } catch {
    return [cloneStarterBoard()];
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function AuthGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"login" | "register" | null>(null);

  async function submit(kind: "login" | "register") {
    if (!email.trim() || password.length < 6) {
      toast.error("이메일과 6자 이상의 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(kind);
    try {
      const backend = await import("@/lib/supabase-client");
      if (kind === "login") await backend.login(email.trim(), password);
      else { const result = await backend.register(email.trim(), password); if (result.needsEmailConfirm) toast.success("확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인해 주세요."); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "로그인하지 못했습니다.";
      toast.error(message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <span className="brand-mark" aria-hidden="true">P</span>
        <h1>Pillar</h1>
        <p>내 자료 보드에 로그인하세요.</p>
        <label>이메일<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submit("login")} /></label>
        <button className="primary-button auth-primary" onClick={() => void submit("login")}>
          {busy === "login" && <LoaderCircle className="spin" aria-hidden="true" />}로그인
        </button>
        <button className="secondary-button auth-secondary" onClick={() => void submit("register")}>
          {busy === "register" && <LoaderCircle className="spin" aria-hidden="true" />}새 계정 만들기
        </button>
        <p className="auth-note">Supabase 대시보드의 Authentication에서 이메일 로그인이 켜져 있어야 합니다.</p>
      </section>
      <Toaster position="bottom-center" />
    </main>
  );
}

// 카드 타일 위쪽 미리보기. 이미지 > PDF 첫 페이지 > 동영상 썸네일 > 링크 대표 이미지 순서로 하나만 보여줍니다.
function CardPreview({ card }: { card: BoardCard }) {
  const firstImage = card.attachments.find((item) => item.kind === "image");
  const firstPdf = card.attachments.find((item) => item.kind === "pdf");
  const video = getVideoEmbed(card.link?.url);
  if (firstImage) return <img className="card-image" src={firstImage.url} alt="" loading="lazy" />;
  if (firstPdf) {
    return (
      <div className="pdf-preview" aria-hidden="true">
        <iframe title="" src={`${firstPdf.url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`} loading="lazy" tabIndex={-1} />
        <span className="preview-badge"><FileText />PDF</span>
      </div>
    );
  }
  if (video) {
    const thumbnail = video.thumbnail ?? card.link?.image;
    return (
      <div className="video-preview" aria-hidden="true">
        {thumbnail ? <img className="card-image" src={thumbnail} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /> : <div className="card-image" />}
        <span className="play-badge"><Play /></span>
      </div>
    );
  }
  if (card.link?.image) return <img className="card-image link-image" src={card.link.image} alt="" loading="lazy" />;
  return null;
}

function SortableCard({ card, readOnly, commentSummary, onOpen, onEdit, onDuplicate, onDelete }: {
  card: BoardCard;
  readOnly: boolean;
  commentSummary?: CommentSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
    data: { type: "card" },
  });
  const tone = card.tone && card.tone !== "default" ? ` card-tone-${card.tone}` : "";

  return (
    <article ref={setNodeRef} className={`board-card${tone}${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <CardPreview card={card} />

      <button className="card-main" onClick={onOpen} aria-label={`${card.title} 크게 보기`}>
        <span className="card-heading"><span className="card-type" aria-hidden="true">{typeIcon(card)}</span><strong>{card.title}</strong></span>
        {card.body && <span className="card-body">{card.body}</span>}
        <span className="card-meta">
          {card.link && <span className="link-source">{linkLabel(card.link)}<ExternalLink aria-hidden="true" /></span>}
          {card.attachments.length > 0 && <span className="attachment-count">첨부 {card.attachments.length}개</span>}
          {commentSummary && <span className="comment-count"><MessageCircle aria-hidden="true" />{commentSummary.count}</span>}
        </span>
        {commentSummary && (
          <span className="comment-peek">
            <span className="comment-peek-head">
              <MessageCircle aria-hidden="true" />
              <b>{commentSummary.first.author || "익명"}</b>
              {commentSummary.first.byOwner && <em>작성자</em>}
              {commentSummary.count > 1 && <i>외 {commentSummary.count - 1}개</i>}
            </span>
            <span className="comment-peek-body">{commentSummary.first.body}</span>
          </span>
        )}
      </button>

      {!readOnly && (
        <div className="card-controls">
          <button className="drag-handle" aria-label={`${card.title} 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="card-menu-button" aria-label={`${card.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}><Maximize2 />크게 보기</DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}><Pencil />수정</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}><Copy />복제</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />삭제</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </article>
  );
}

function SortableColumn({ column, readOnly, queryText, commentSummaries, onAddCard, onOpenCard, onEditCard, onRename, onRecolor, onDelete, onToggle, onDuplicateCard, onDeleteCard }: {
  column: BoardColumn;
  readOnly: boolean;
  queryText: string;
  commentSummaries: Record<string, CommentSummary>;
  onAddCard: () => void;
  onOpenCard: (card: BoardCard) => void;
  onEditCard: (card: BoardCard) => void;
  onRename: () => void;
  onRecolor: (hue: number) => void;
  onDelete: () => void;
  onToggle: () => void;
  onDuplicateCard: (card: BoardCard) => void;
  onDeleteCard: (card: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: readOnly, data: { type: "column" } });
  const needle = queryText.trim().toLowerCase();
  const filteredCards = column.cards.filter((card) => !needle || `${card.title} ${card.body}`.toLowerCase().includes(needle));
  const hue = columnHue(column);
  const style = { transform: CSS.Transform.toString(transform), transition, "--column-hue": hue } as CSSProperties;

  return (
    <article ref={setNodeRef} className={`column${column.collapsed ? " is-collapsed" : ""}${isDragging ? " is-dragging" : ""}`} style={style}>
      <header className="column-header">
        {!readOnly && <button className="column-handle" aria-label={`${column.title} 칼럼 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>}
        <button className="column-title" onClick={onToggle} aria-expanded={!column.collapsed}><strong>{column.title}</strong><span>{column.cards.length}</span></button>
        <button className="quiet-button" onClick={onToggle} aria-label={column.collapsed ? "칼럼 펼치기" : "칼럼 접기"}>{column.collapsed ? <PanelTopOpen aria-hidden="true" /> : <PanelTopClose aria-hidden="true" />}</button>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="quiet-button" aria-label={`${column.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="column-menu">
              <DropdownMenuItem onClick={onRename}><Pencil />이름 변경</DropdownMenuItem>
              <div className="menu-swatches" role="group" aria-label="칼럼 색">
                <span className="menu-swatches-label"><Palette aria-hidden="true" />색</span>
                <div>
                  {COLUMN_HUES.map((option) => (
                    <button key={option.value} type="button" className={`hue-swatch${option.value === hue ? " is-active" : ""}`} style={{ "--swatch-hue": option.value } as CSSProperties} onClick={() => onRecolor(option.value)} aria-label={option.label} aria-pressed={option.value === hue} title={option.label} />
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}><Trash2 />칼럼 삭제</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {!column.collapsed && (
        <>
          {!readOnly && <button className="add-card-button" onClick={onAddCard} aria-label={`${column.title}에 카드 추가`} title="카드 추가"><Plus aria-hidden="true" /></button>}
          <SortableContext items={filteredCards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
            <div className="card-list">
              {filteredCards.map((card) => <SortableCard key={card.id} card={card} readOnly={readOnly} commentSummary={commentSummaries[card.id]} onOpen={() => onOpenCard(card)} onEdit={() => onEditCard(card)} onDuplicate={() => onDuplicateCard(card)} onDelete={() => onDeleteCard(card)} />)}
              {needle && filteredCards.length === 0 && <p className="column-empty">일치하는 카드가 없습니다.</p>}
              {!needle && filteredCards.length === 0 && <p className="column-empty">{readOnly ? "카드가 없습니다." : "위의 + 를 눌러 첫 카드를 추가하세요."}</p>}
            </div>
          </SortableContext>
        </>
      )}
    </article>
  );
}

// 카드 뷰어 아래쪽 댓글 목록과 입력란. 보드의 댓글 기능이 켜져 있을 때만 그려집니다.
function CommentsPanel({ comments, canDelete, askName, authorName, onAuthorNameChange, onSubmit, onDelete }: {
  comments: CardComment[];
  canDelete: boolean;
  askName: boolean;
  authorName: string;
  onAuthorNameChange: (value: string) => void;
  onSubmit: (body: string) => Promise<boolean>;
  onDelete: (comment: CardComment) => void;
}) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  async function submit() {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      if (await onSubmit(text)) setText("");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="comments" aria-label="댓글">
      <div className="section-label"><MessageCircle />댓글<span className="comments-count">{comments.length}</span></div>
      {comments.length === 0 ? <p className="comments-empty">아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.</p> : (
        <ul className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className={comment.byOwner ? "by-owner" : undefined}>
              <div className="comment-meta">
                <strong>{comment.author || "익명"}</strong>
                {comment.byOwner && <em>작성자</em>}
                <time dateTime={new Date(comment.createdAt).toISOString()}>{formatRelative(comment.createdAt)}</time>
                {canDelete && <button type="button" onClick={() => onDelete(comment)} aria-label="댓글 삭제"><Trash2 aria-hidden="true" /></button>}
              </div>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form className="comment-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {askName && <input value={authorName} onChange={(event) => onAuthorNameChange(event.target.value)} placeholder="이름 (비워 두면 익명)" maxLength={40} aria-label="이름" />}
        <div className="comment-input-row">
          <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="댓글을 입력하세요" maxLength={1000} rows={2} aria-label="댓글 내용" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(); } }} />
          <button className="primary-button comment-submit" type="submit" disabled={posting || !text.trim()} aria-label="댓글 등록">{posting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}</button>
        </div>
      </form>
    </section>
  );
}

export function BoardApp() {
  const [routeReady, setRouteReady] = useState(false);
  const [sharedToken, setSharedToken] = useState<string | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [loading, setLoading] = useState(true);
  const [boards, setBoards] = useState<BoardData[]>([cloneStarterBoard()]);
  const [activeBoardId, setActiveBoardId] = useState("starter-board");
  const [queryText, setQueryText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [dirtyBoardId, setDirtyBoardId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [view, setView] = useState<"home" | "board">("home");
  const [viewerCardId, setViewerCardId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [commentAuthor, setCommentAuthor] = useState("");
  const boardsRef = useRef(boards);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];
  const readOnly = Boolean(sharedToken);
  const commentsEnabled = Boolean(activeBoard?.commentsEnabled);
  // 뷰어에 띄운 카드는 ID로만 기억하고 매 렌더마다 보드에서 다시 찾습니다. 편집 뒤에도 최신 내용이 보입니다.
  const viewerTarget = viewerCardId && activeBoard ? findCard(activeBoard, viewerCardId) : null;
  const viewerCard = viewerTarget ? viewerTarget.column.cards[viewerTarget.index] : null;
  const viewerVideo = getVideoEmbed(viewerCard?.link?.url);
  const commentSummaries = useMemo(() => {
    const summaries: Record<string, CommentSummary> = {};
    for (const comment of comments) {
      const current = summaries[comment.cardId];
      if (!current) summaries[comment.cardId] = { count: 1, first: comment };
      else summaries[comment.cardId] = { count: current.count + 1, first: comment.createdAt < current.first.createdAt ? comment : current.first };
    }
    return summaries;
  }, [comments]);
  // 변경 표시와 저장 상태를 한 곳에서 바꿉니다. 저장 effect는 이 값만 보고 동작합니다.
  const markDirty = useCallback((boardId: string) => { setDirtyBoardId(boardId); setSaveStatus("saving"); }, []);

  useEffect(() => { boardsRef.current = boards; }, [boards]);
  useEffect(() => {
    // 주소의 ?share= 값은 브라우저에서만 읽을 수 있어 첫 렌더 뒤 한 번 동기화합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSharedToken(new URLSearchParams(window.location.search).get("share"));
    setCommentAuthor(localStorage.getItem(COMMENT_NAME_KEY) ?? "");
    setRouteReady(true);
  }, []);

  // 보드가 바뀌거나 댓글 기능을 켤 때 그 보드의 댓글을 한 번에 읽어 옵니다.
  const activeBoardIdForComments = activeBoard?.id;
  useEffect(() => {
    if (!routeReady || loading || !activeBoardIdForComments) return;
    let cancelled = false;
    async function load(): Promise<CardComment[]> {
      if (!commentsEnabled) return [];
      if (!supabaseConfigured) return readLocalComments().filter((comment) => comment.boardId === activeBoardIdForComments);
      const backend = await import("@/lib/supabase-client");
      if (sharedToken) return backend.loadSharedComments(sharedToken);
      if (user) return backend.loadComments(activeBoardIdForComments!);
      return [];
    }
    load()
      .then((list) => { if (!cancelled) setComments(list); })
      .catch(() => { if (!cancelled) toast.error("댓글을 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [activeBoardIdForComments, commentsEnabled, loading, routeReady, sharedToken, user]);

  useEffect(() => {
    if (!routeReady) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      setLoading(true);
      if (sharedToken) {
        const shared = supabaseConfigured
          ? await (await import("@/lib/supabase-client")).loadSharedBoard(sharedToken)
          : readLocalBoards().find((board) => board.shareEnabled && board.shareToken === sharedToken) ?? null;
        if (!cancelled) {
          setBoards(shared ? [shared] : []);
          if (shared) setActiveBoardId(shared.id);
          setView("board");
          setAuthReady(true);
          setLoading(false);
        }
        return;
      }
      if (!supabaseConfigured) {
        const localBoards = readLocalBoards();
        if (!cancelled) {
          setBoards(localBoards);
          setActiveBoardId(localBoards[0].id);
          setLoading(false);
        }
        return;
      }
      const backend = await import("@/lib/supabase-client");
      unsubscribe = backend.observeUser(async (nextUser) => {
        if (cancelled) return;
        setUser(nextUser);
        setAuthReady(true);
        setView("home");
        if (!nextUser) { setLoading(false); return; }
        try {
          const remoteBoards = await backend.loadOwnedBoards(nextUser.uid);
          const nextBoards = remoteBoards.length ? remoteBoards : [{ ...cloneStarterBoard(), id: makeId("board") }];
          if (cancelled) return;
          setBoards(nextBoards);
          setActiveBoardId(nextBoards[0].id);
          if (!remoteBoards.length) markDirty(nextBoards[0].id);
        } catch {
          toast.error("서버에서 보드를 불러오지 못했습니다.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      });
    }
    void initialize().catch(() => {
      if (!cancelled) { setLoading(false); setAuthReady(true); toast.error("앱을 시작하지 못했습니다. Supabase 설정을 확인해 주세요."); }
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [markDirty, routeReady, sharedToken]);

  useEffect(() => {
    if (!dirtyBoardId || readOnly) return;
    const board = boards.find((item) => item.id === dirtyBoardId);
    if (!board) return;
    const timer = window.setTimeout(async () => {
      try {
        if (supabaseConfigured && user) await (await import("@/lib/supabase-client")).saveBoard(board, user.uid);
        else localStorage.setItem(LOCAL_KEY, JSON.stringify(boards));
        setSaveStatus("saved");
        setDirtyBoardId(null);
      } catch {
        setSaveStatus("error");
        toast.error("저장하지 못했습니다. 변경 내용은 화면에 유지됩니다.");
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [boards, dirtyBoardId, readOnly, user]);

  const updateBoard = useCallback((boardId: string, updater: (board: BoardData) => BoardData) => {
    setBoards((current) => current.map((board) => board.id === boardId ? { ...updater(board), updatedAt: Date.now() } : board));
    markDirty(boardId);
  }, [markDirty]);
  const updateActiveBoard = useCallback((updater: (board: BoardData) => BoardData) => updateBoard(activeBoardId, updater), [activeBoardId, updateBoard]);

  const pushUndo = useCallback((previous: BoardData, message: string) => {
    toast(message, { action: { label: "실행 취소", onClick: () => {
      setBoards((current) => current.map((board) => board.id === previous.id ? previous : board));
      markDirty(previous.id);
    } } });
  }, [markDirty]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    if (!activeBoard || !event.over || event.active.id === event.over.id) return;
    const previous = structuredClone(activeBoard);
    if (event.active.data.current?.type === "column") {
      const oldIndex = activeBoard.columns.findIndex((column) => column.id === event.active.id);
      const newIndex = activeBoard.columns.findIndex((column) => column.id === event.over?.id);
      if (oldIndex < 0 || newIndex < 0) return;
      updateActiveBoard((board) => ({ ...board, columns: arrayMove(board.columns, oldIndex, newIndex) }));
      pushUndo(previous, "칼럼을 이동했습니다.");
      return;
    }
    const source = findCard(activeBoard, String(event.active.id));
    if (!source) return;
    const overCard = findCard(activeBoard, String(event.over.id));
    const targetColumnIndex = overCard ? overCard.columnIndex : activeBoard.columns.findIndex((column) => column.id === event.over?.id);
    if (targetColumnIndex < 0) return;
    updateActiveBoard((board) => {
      const columns = structuredClone(board.columns);
      const [moved] = columns[source.columnIndex].cards.splice(source.index, 1);
      let insertIndex = overCard ? overCard.index : columns[targetColumnIndex].cards.length;
      if (source.columnIndex === targetColumnIndex && source.index < insertIndex) insertIndex -= 1;
      columns[targetColumnIndex].cards.splice(Math.max(0, insertIndex), 0, moved);
      return { ...board, columns };
    });
    pushUndo(previous, "카드를 이동했습니다.");
  }

  function openNewCard(columnId?: string) {
    if (!columnId) return;
    setViewerCardId(null);
    setDraft({ columnId, title: "", body: "", attachments: [], tone: "default" });
    setLinkInput("");
    setEditorOpen(true);
  }
  // 카드를 크게 보는 뷰어. 공유받은 사람과 주인이 같은 화면을 보고, 주인에게만 편집 버튼이 붙습니다.
  function openViewer(card: BoardCard) {
    setViewerCardId(card.id);
  }
  // 편집 모달. 뷰어가 열린 상태에서 부르면 뷰어는 잠시 숨겨지고 편집을 마치면 다시 나타납니다.
  function openCard(columnId: string, card: BoardCard) {
    setDraft({ ...structuredClone(card), columnId });
    setLinkInput(card.link?.url ?? "");
    setEditorOpen(true);
  }
  function saveDraft() {
    if (!draft || !draft.title.trim()) { toast.error("카드 제목을 입력해 주세요."); return; }
    const now = Date.now();
    updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => {
      if (column.id !== draft.columnId) return column;
      const tone: CardTone | undefined = draft.tone && draft.tone !== "default" ? draft.tone : undefined;
      if (draft.id) return { ...column, cards: column.cards.map((card) => card.id === draft.id ? { ...card, title: draft.title.trim(), body: draft.body.trim(), attachments: draft.attachments, link: draft.link, tone, updatedAt: now } : card) };
      return { ...column, cards: [{ id: makeId("card"), title: draft.title.trim(), body: draft.body.trim(), attachments: draft.attachments, link: draft.link, tone, createdAt: now, updatedAt: now }, ...column.cards] };
    }) }));
    setEditorOpen(false);
    setDraft(null);
    toast.success(draft.id ? "카드를 저장했습니다." : "카드를 추가했습니다.");
  }

  async function addFiles(files: FileList | File[]) {
    if (!draft || !activeBoard) return;
    const accepted = Array.from(files).filter((file) => {
      const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
      if (!allowed || file.type.startsWith("video/")) { toast.error(`${file.name}: 이미지와 PDF만 첨부할 수 있습니다.`); return false; }
      const maxSize = supabaseConfigured ? MAX_CLOUD_FILE : MAX_DEMO_FILE;
      if (file.size > maxSize) { toast.error(`${file.name}: ${supabaseConfigured ? "15MB" : "2MB"} 이하 파일만 첨부할 수 있습니다.`); return false; }
      return true;
    });
    if (!accepted.length) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of accepted) {
        const id = makeId("file");
        if (supabaseConfigured && user) uploaded.push(await (await import("@/lib/supabase-client")).uploadAttachment(file, user.uid, activeBoard.id, id));
        else uploaded.push({ id, name: file.name, kind: file.type === "application/pdf" ? "pdf" : "image", mimeType: file.type, size: file.size, url: await fileToDataUrl(file) });
      }
      setDraft((current) => current ? { ...current, attachments: [...current.attachments, ...uploaded] } : current);
    } catch (error) { toast.error(error instanceof Error && error.message ? `업로드 실패: ${error.message}` : "파일을 업로드하지 못했습니다."); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  function deleteDraftAttachment(attachment: Attachment) {
    setDraft((current) => current ? { ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) } : current);
  }

  async function fetchLinkPreview() {
    if (!draft) return;
    let url = linkInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { new URL(url); } catch { toast.error("올바른 링크를 입력해 주세요."); return; }
    setLinkLoading(true);
    try {
      const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
      const data = (await response.json()) as LinkPreviewData & { error?: string };
      if (!response.ok) throw new Error(data.error);
      setDraft({ ...draft, link: data });
      setLinkInput(data.url);
    } catch (error) { toast.error(error instanceof Error && error.message ? error.message : "링크를 확인하지 못했습니다."); }
    finally { setLinkLoading(false); }
  }

  function duplicateCard(columnId: string, card: BoardCard) {
    updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => column.id === columnId ? { ...column, cards: [...column.cards, { ...structuredClone(card), id: makeId("card"), title: `${card.title} 복사본`, createdAt: Date.now(), updatedAt: Date.now() }] } : column) }));
    toast.success("카드를 복제했습니다.");
  }
  async function submitComment(cardId: string, body: string) {
    if (!activeBoard) return false;
    const text = body.trim();
    if (!text) return false;
    const author = readOnly ? commentAuthor.trim().slice(0, 40) || "익명" : (user?.email?.split("@")[0] || "보드 주인");
    const comment: CardComment = { id: makeId("comment"), boardId: activeBoard.id, cardId, author, body: text.slice(0, 1000), createdAt: Date.now(), byOwner: !readOnly };
    try {
      let saved = comment;
      if (supabaseConfigured) {
        const backend = await import("@/lib/supabase-client");
        if (sharedToken) saved = await backend.addSharedComment(sharedToken, comment);
        else if (user) saved = await backend.addComment(comment, user.uid);
        else throw new Error("로그인이 필요합니다.");
      } else {
        writeLocalComments([...readLocalComments(), comment]);
      }
      setComments((current) => [...current, saved]);
      if (readOnly) localStorage.setItem(COMMENT_NAME_KEY, commentAuthor.trim().slice(0, 40));
      return true;
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : "댓글을 저장하지 못했습니다.");
      return false;
    }
  }
  async function deleteComment(comment: CardComment) {
    try {
      if (supabaseConfigured) await (await import("@/lib/supabase-client")).removeComment(comment.id);
      else writeLocalComments(readLocalComments().filter((item) => item.id !== comment.id));
      setComments((current) => current.filter((item) => item.id !== comment.id));
    } catch {
      toast.error("댓글을 삭제하지 못했습니다.");
    }
  }
  function setCommentsEnabled(enabled: boolean) {
    updateActiveBoard((board) => ({ ...board, commentsEnabled: enabled }));
    toast.success(enabled ? "댓글 기능을 켰습니다." : "댓글 기능을 껐습니다.");
  }
  function addColumn() {
    if (!newColumnTitle.trim()) return;
    updateActiveBoard((board) => ({ ...board, columns: [...board.columns, { id: makeId("column"), title: newColumnTitle.trim(), collapsed: false, cards: [] }] }));
    setNewColumnTitle(""); setAddingColumn(false);
  }
  function createBoard() {
    const now = Date.now();
    const board: BoardData = { id: makeId("board"), title: "새 보드", shareEnabled: false, shareToken: "", createdAt: now, updatedAt: now, columns: [{ id: makeId("column"), title: "첫 번째 칼럼", collapsed: false, cards: [] }] };
    setBoards((current) => [board, ...current]); setActiveBoardId(board.id); markDirty(board.id); setView("board");
  }

  async function confirmDelete() {
    if (!deleteTarget || !activeBoard) return;
    const previous = structuredClone(activeBoard);
    if (deleteTarget.kind === "board") {
      const target = boards.find((board) => board.id === deleteTarget.id);
      if (!target) { setDeleteTarget(null); return; }
      if (supabaseConfigured && user) { try { await (await import("@/lib/supabase-client")).removeBoard(target, user.uid); } catch { toast.error("보드를 삭제하지 못했습니다."); return; } }
      const remaining = boards.filter((board) => board.id !== deleteTarget.id);
      const fallback = { ...cloneStarterBoard(), id: makeId("board"), title: "새 보드", createdAt: Date.now(), updatedAt: Date.now() };
      const next = remaining.length ? remaining : [fallback];
      setBoards(next); if (activeBoardId === deleteTarget.id) setActiveBoardId(next[0].id);
      if (!supabaseConfigured) localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      else if (!remaining.length) markDirty(fallback.id);
      toast.success("보드를 삭제했습니다.");
    } else if (deleteTarget.kind === "column") {
      updateActiveBoard((board) => ({ ...board, columns: board.columns.filter((column) => column.id !== deleteTarget.id) }));
      pushUndo(previous, "칼럼을 삭제했습니다.");
    } else {
      updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => column.id === deleteTarget.columnId ? { ...column, cards: column.cards.filter((card) => card.id !== deleteTarget.id) } : column) }));
      pushUndo(previous, "카드를 삭제했습니다.");
    }
    setDeleteTarget(null);
  }

  const shareUrl = useMemo(() => activeBoard?.shareToken && typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?share=${activeBoard.shareToken}` : "", [activeBoard?.shareToken]);
  function setSharing(enabled: boolean) {
    updateActiveBoard((board) => ({ ...board, shareEnabled: enabled, shareToken: enabled ? board.shareToken || makeShareToken() : board.shareToken }));
  }
  function regenerateShareLink() {
    updateActiveBoard((board) => ({ ...board, shareEnabled: true, shareToken: makeShareToken() }));
    toast.success("새 공유 링크를 만들었습니다.");
  }

  useEffect(() => {
    if (!routeReady || loading || readOnly || !activeBoard) return;
    const modelContext = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    const registerTools = async () => {
      await modelContext.registerTool({
        name: "list_board_cards", title: "보드 카드 목록", description: "현재 보드의 칼럼과 카드 제목을 읽습니다.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => ({ board: boardsRef.current.find((board) => board.id === activeBoardId)?.title, columns: boardsRef.current.find((board) => board.id === activeBoardId)?.columns.map((column) => ({ title: column.title, cards: column.cards.map((card) => ({ id: card.id, title: card.title })) })) ?? [] }),
      }, { signal: lifecycle.signal });
      await modelContext.registerTool({
        name: "create_board_card", title: "보드 카드 추가", description: "현재 보드의 지정한 칼럼에 새 텍스트 카드를 추가합니다.",
        inputSchema: { type: "object", properties: { columnId: { type: "string" }, title: { type: "string", minLength: 1 }, body: { type: "string" } }, required: ["columnId", "title"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => {
          const value = input as { columnId?: unknown; title?: unknown; body?: unknown };
          if (typeof value.columnId !== "string" || typeof value.title !== "string" || !value.title.trim()) throw new Error("columnId와 title이 필요합니다.");
          const board = boardsRef.current.find((item) => item.id === activeBoardId);
          if (!board?.columns.some((column) => column.id === value.columnId)) throw new Error("칼럼을 찾을 수 없습니다.");
          const card: BoardCard = { id: makeId("card"), title: value.title.trim(), body: typeof value.body === "string" ? value.body.trim() : "", attachments: [], createdAt: Date.now(), updatedAt: Date.now() };
          updateActiveBoard((current) => ({ ...current, columns: current.columns.map((column) => column.id === value.columnId ? { ...column, cards: [card, ...column.cards] } : column) }));
          return { id: card.id, title: card.title, columnId: value.columnId };
        },
      }, { signal: lifecycle.signal });
    };
    void registerTools().catch(() => undefined);
    return () => lifecycle.abort();
  }, [activeBoard, activeBoardId, loading, readOnly, routeReady, updateActiveBoard]);

  if (!routeReady || loading || !authReady) return <main className="loading-screen"><LoaderCircle className="spin" /><span>보드를 불러오는 중</span></main>;
  if (supabaseConfigured && !sharedToken && !user) return <AuthGate />;
  if (!activeBoard) return <main className="empty-share"><span className="brand-mark" aria-hidden="true">P</span><h1>공유 보드를 찾을 수 없습니다</h1><p>링크가 만료되었거나 공유가 해제되었습니다.</p></main>;

  return (
    <main className="app-shell">
      {view === "home" && !readOnly ? (
        <BoardHome
          boards={boards}
          demo={!supabaseConfigured}
          showLogout={supabaseConfigured}
          onOpen={(boardId) => { setActiveBoardId(boardId); setView("board"); }}
          onCreate={createBoard}
          onRename={(board) => { const title = window.prompt("새 보드 이름", board.title)?.trim(); if (title) updateBoard(board.id, (item) => ({ ...item, title })); }}
          onDelete={(board) => setDeleteTarget({ kind: "board", id: board.id, title: board.title })}
          onToggleShare={(board, enabled) => {
            updateBoard(board.id, (item) => ({ ...item, shareEnabled: enabled, shareToken: enabled ? item.shareToken || makeShareToken() : item.shareToken }));
            toast.success(enabled ? `${board.title} 공유 링크를 만들었습니다.` : `${board.title} 공유를 중지했습니다.`);
          }}
          onLogout={() => void import("@/lib/supabase-client").then((backend) => backend.logout())}
        />
      ) : (<>
      <header className="topbar">
        <div className="brand-row">
          {readOnly ? <span className="brand-mark" aria-hidden="true">P</span> : <button className="brand-mark brand-home" onClick={() => setView("home")} aria-label="모든 보드 보기">P</button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={readOnly}><button className="board-switcher"><span>{readOnly ? "공유 보드" : "내 보드"}</span><strong>{activeBoard.title}</strong>{!readOnly && <ChevronsUpDown aria-hidden="true" />}</button></DropdownMenuTrigger>
            {!readOnly && <DropdownMenuContent align="start" className="board-menu">
              <DropdownMenuItem onClick={() => setView("home")}><LayoutGrid />모든 보드 보기</DropdownMenuItem>
              <DropdownMenuSeparator />
              {boards.map((board) => <DropdownMenuItem key={board.id} onClick={() => setActiveBoardId(board.id)}>{board.title}{board.id === activeBoard.id && <span className="current-mark">현재</span>}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={createBoard}><Plus />새 보드</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { const title = window.prompt("새 보드 이름", activeBoard.title)?.trim(); if (title) updateActiveBoard((board) => ({ ...board, title })); }}><Pencil />이름 변경</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCommentsEnabled(!commentsEnabled)}><MessageCircle />{commentsEnabled ? "댓글 끄기" : "댓글 켜기"}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget({ kind: "board", id: activeBoard.id, title: activeBoard.title })}><Trash2 />보드 삭제</DropdownMenuItem>
            </DropdownMenuContent>}
          </DropdownMenu>
        </div>
        <div className="top-actions">
          <label className="search-box"><Search aria-hidden="true" /><span className="sr-only">카드 검색</span><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="카드 검색" />{queryText && <button onClick={() => setQueryText("")} aria-label="검색어 지우기"><X /></button>}</label>
          {!readOnly && <span className={`save-status ${saveStatus}`}>{saveStatus === "saving" ? "저장 중" : saveStatus === "error" ? "저장 실패" : "저장됨"}</span>}
          {!readOnly && <button className="icon-button" onClick={() => setShareOpen(true)} aria-label="보드 공유"><Share2 aria-hidden="true" /></button>}
          {!readOnly && supabaseConfigured && <button className="icon-button desktop-only" onClick={() => void import("@/lib/supabase-client").then((backend) => backend.logout())} aria-label="로그아웃"><LogOut aria-hidden="true" /></button>}
        </div>
      </header>

      {!supabaseConfigured && !readOnly && <aside className="demo-banner"><span>로컬 데모 모드 · Supabase 설정을 추가하면 계정과 클라우드 저장이 활성화됩니다.</span><a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Supabase 열기 <ExternalLink /></a></aside>}

      <div className="board-area">
      <div className="board-heading"><div><span className="board-kicker">{readOnly ? "공유 보드" : "내 보드"} · 칼럼 {activeBoard.columns.length} · 카드 {activeBoard.columns.reduce((sum, column) => sum + column.cards.length, 0)}</span><h1>{activeBoard.title}</h1></div></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={activeBoard.columns.map((column) => column.id)}>
          <section className="board" aria-label={`${activeBoard.title} 보드`}>
            {activeBoard.columns.map((column) => <SortableColumn key={column.id} column={column} readOnly={readOnly} queryText={queryText} commentSummaries={commentSummaries} onAddCard={() => openNewCard(column.id)} onOpenCard={openViewer} onEditCard={(card) => openCard(column.id, card)} onRename={() => {
              const title = window.prompt("새 칼럼 이름", column.title)?.trim();
              if (title) updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, title } : item) }));
            }} onRecolor={(hue) => updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, hue } : item) }))} onDelete={() => setDeleteTarget({ kind: "column", id: column.id, title: column.title })} onToggle={() => updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, collapsed: !item.collapsed } : item) }))} onDuplicateCard={(card) => duplicateCard(column.id, card)} onDeleteCard={(card) => setDeleteTarget({ kind: "card", id: card.id, columnId: column.id, title: card.title })} />)}
            {!readOnly && (addingColumn ? <form className="new-column-form" onSubmit={(event) => { event.preventDefault(); addColumn(); }}><input autoFocus value={newColumnTitle} onChange={(event) => setNewColumnTitle(event.target.value)} placeholder="칼럼 이름" /><div><button className="primary-button" type="submit">추가</button><button className="secondary-button" type="button" onClick={() => setAddingColumn(false)}>취소</button></div></form> : <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus aria-hidden="true" />칼럼 추가</button>)}
          </section>
        </SortableContext>
      </DndContext>
      </div>
      {!readOnly && <button className="primary-button fab" onClick={() => openNewCard(activeBoard.columns[0]?.id)} disabled={!activeBoard.columns.length}><Plus aria-hidden="true" />카드 추가</button>}
      </>)}

      <Dialog open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setDraft(null); }}>
        <DialogContent className="card-dialog" onPaste={(event) => {
          const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
          if (image) { event.preventDefault(); void addFiles([image]); return; }
          const text = event.clipboardData.getData("text").trim();
          if (/^https?:\/\//i.test(text) && !linkInput) setLinkInput(text);
        }}>
          <DialogHeader><DialogTitle>{draft?.id ? "카드 수정" : "새 카드"}</DialogTitle><DialogDescription>{readOnly ? "공유된 카드의 내용입니다." : "글, 링크, 이미지, PDF를 한 카드에 담을 수 있습니다."}</DialogDescription></DialogHeader>
          {draft && <div className="editor-body">
            <label>제목<input value={draft.title} readOnly={readOnly} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="무엇을 모아둘까요?" /></label>
            <label>내용<textarea value={draft.body} readOnly={readOnly} maxLength={3000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="메모를 입력하세요" /></label>
            {!readOnly && <section><div className="section-label"><Palette />카드 색</div><div className="tone-swatches" role="radiogroup" aria-label="카드 색">{CARD_TONES.map((tone) => <button key={tone.value} type="button" role="radio" aria-checked={(draft.tone ?? "default") === tone.value} className={`tone-swatch card-tone-${tone.value}${(draft.tone ?? "default") === tone.value ? " is-active" : ""}`} onClick={() => setDraft({ ...draft, tone: tone.value })} title={tone.label} aria-label={tone.label} />)}</div></section>}
            <section className="link-editor"><div className="section-label"><Link2 />링크</div>{!readOnly && <div className="link-input-row"><input value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="https://..." /><button className="secondary-button" onClick={() => void fetchLinkPreview()} disabled={linkLoading}>{linkLoading && <LoaderCircle className="spin" />}미리보기</button></div>}{draft.link && <a className="link-preview" href={draft.link.url} target="_blank" rel="noreferrer">{draft.link.image && <img src={draft.link.image} alt="" />}<span><small>{getVideoEmbed(draft.link.url) ? "동영상 · 카드에서 바로 재생" : linkLabel(draft.link)}</small><strong>{draft.link.title}</strong><em>{draft.link.description}</em></span><ExternalLink /></a>}</section>
            <section><div className="section-label"><UploadCloud />첨부</div>{!readOnly && <button className="drop-zone" type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>{uploading ? <LoaderCircle className="spin" /> : <UploadCloud />}<span>이미지 또는 PDF를 선택하거나 끌어 놓으세요.</span><small>{supabaseConfigured ? "파일당 최대 15MB" : "데모 모드 파일당 최대 2MB"} · 동영상 제외</small><input ref={fileInputRef} hidden type="file" multiple accept="image/*,application/pdf" onChange={(event) => event.target.files && void addFiles(event.target.files)} /></button>}
              {draft.attachments.length > 0 && <div className="attachment-grid">{draft.attachments.map((attachment) => <article className="attachment-item" key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.url} alt={attachment.name} /> : <iframe title={attachment.name} src={`${attachment.url}#page=1&toolbar=0&navpanes=0`} />}<div><strong>{attachment.name}</strong><span>{attachment.kind === "pdf" ? "PDF" : "이미지"} · {formatBytes(attachment.size)}</span></div><a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`${attachment.name} 열기`}><ExternalLink /></a>{!readOnly && <button onClick={() => deleteDraftAttachment(attachment)} aria-label={`${attachment.name} 삭제`}><X /></button>}</article>)}</div>}
            </section>
          </div>}
          <DialogFooter><button className="secondary-button" onClick={() => setEditorOpen(false)}>{readOnly ? "닫기" : "취소"}</button>{!readOnly && <button className="primary-button" onClick={saveDraft} disabled={uploading}>저장</button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewerCard) && !editorOpen} onOpenChange={(open) => { if (!open) setViewerCardId(null); }}>
        <DialogContent className={`viewer-dialog${viewerCard?.tone && viewerCard.tone !== "default" ? ` card-tone-${viewerCard.tone}` : ""}`}>
          {viewerCard && viewerTarget && <>
            <DialogHeader className="viewer-header">
              <span className="viewer-kicker"><span className="card-type" aria-hidden="true">{typeIcon(viewerCard)}</span>{viewerTarget.column.title} · {formatDate(viewerCard.updatedAt)}</span>
              <DialogTitle className="viewer-title">{viewerCard.title}</DialogTitle>
              <DialogDescription className="sr-only">카드 내용을 크게 봅니다.</DialogDescription>
              {!readOnly && <button className="secondary-button viewer-edit" onClick={() => openCard(viewerTarget.column.id, viewerCard)}><Pencil aria-hidden="true" />편집</button>}
            </DialogHeader>
            <div className="viewer-body">
              {viewerCard.body && <p className="viewer-text">{viewerCard.body}</p>}
              {viewerVideo && <div className="viewer-video"><iframe src={viewerVideo.embedUrl} title={viewerCard.link?.title || "동영상"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
              {viewerCard.link && <a className={`link-preview viewer-link${viewerVideo ? " is-compact" : ""}`} href={viewerCard.link.url} target="_blank" rel="noreferrer">{viewerCard.link.image && !viewerVideo && <img src={viewerCard.link.image} alt="" />}<span><small>{linkLabel(viewerCard.link)}</small><strong>{viewerCard.link.title}</strong>{viewerCard.link.description && <em>{viewerCard.link.description}</em>}</span><ExternalLink aria-hidden="true" /></a>}
              {viewerCard.attachments.map((attachment) => attachment.kind === "image" ? (
                <figure className="viewer-image" key={attachment.id}>
                  <button type="button" onClick={() => setLightboxUrl(attachment.url)} aria-label={`${attachment.name} 전체 화면으로 보기`}><img src={attachment.url} alt={attachment.name} /><span className="zoom-hint"><Maximize2 aria-hidden="true" /></span></button>
                  <figcaption><ImageIcon aria-hidden="true" /><span>{attachment.name}</span><small>{formatBytes(attachment.size)}</small><a href={attachment.url} target="_blank" rel="noreferrer">원본 열기<ExternalLink aria-hidden="true" /></a></figcaption>
                </figure>
              ) : (
                <figure className="viewer-pdf" key={attachment.id}>
                  <iframe src={`${attachment.url}#toolbar=1&navpanes=0&view=FitH`} title={attachment.name} />
                  <figcaption><FileText aria-hidden="true" /><span>{attachment.name}</span><small>PDF · {formatBytes(attachment.size)}</small><a href={attachment.url} target="_blank" rel="noreferrer">새 탭에서 열기<ExternalLink aria-hidden="true" /></a></figcaption>
                </figure>
              ))}
              {commentsEnabled && <CommentsPanel comments={comments.filter((comment) => comment.cardId === viewerCard.id)} canDelete={!readOnly} askName={readOnly} authorName={commentAuthor} onAuthorNameChange={setCommentAuthor} onSubmit={(body) => submitComment(viewerCard.id, body)} onDelete={(comment) => void deleteComment(comment)} />}
            </div>
          </>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(lightboxUrl)} onOpenChange={(open) => { if (!open) setLightboxUrl(null); }}>
        <DialogContent className="lightbox-dialog">
          <DialogTitle className="sr-only">이미지 전체 화면</DialogTitle>
          <DialogDescription className="sr-only">닫으려면 이미지를 누르거나 Esc 키를 누르세요.</DialogDescription>
          {lightboxUrl && <img src={lightboxUrl} alt="" onClick={() => setLightboxUrl(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="share-dialog"><DialogHeader><DialogTitle>보드 공유</DialogTitle><DialogDescription>링크를 가진 사람은 이 보드를 읽을 수 있습니다.</DialogDescription></DialogHeader><div className="share-switch-row"><div><strong>읽기 전용 링크</strong><span>{activeBoard.shareEnabled ? "공유 중" : "비공개"}</span></div><Switch checked={activeBoard.shareEnabled} onCheckedChange={setSharing} aria-label="읽기 전용 공유" /></div><div className="share-switch-row"><div><strong>댓글</strong><span>{commentsEnabled ? "카드마다 댓글을 남길 수 있습니다" : "꺼짐 · 카드 뷰어에 댓글란이 보이지 않습니다"}</span></div><Switch checked={commentsEnabled} onCheckedChange={setCommentsEnabled} aria-label="댓글 허용" /></div>{activeBoard.shareEnabled && <><div className="share-url"><input readOnly value={shareUrl} /><button onClick={() => { void navigator.clipboard.writeText(shareUrl); toast.success("공유 링크를 복사했습니다."); }}><Copy />복사</button></div><button className="text-button" onClick={regenerateShareLink}><RotateCcw />기존 링크를 끊고 새 링크 만들기</button>{!supabaseConfigured && <p className="share-warning">로컬 데모 링크는 이 브라우저에서만 확인할 수 있습니다.</p>}</>}</DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.title}을(를) 삭제할까요?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.kind === "column" ? "칼럼 안의 카드도 함께 삭제됩니다." : "삭제 직후에는 실행 취소할 수 있습니다."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <Toaster position="bottom-center" />
    </main>
  );
}
