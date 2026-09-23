"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
  UserRound,
  GripVertical,
  Image as ImageIcon,
  Link2,
  LoaderCircle,
  LogOut,
  Maximize2,
  MessageCircle,
  MessageCircleQuestion,
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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
import { Checkbox } from "@/components/ui/checkbox";
import { BoardHome } from "./board-home";
import { cloneStarterBoard } from "@/lib/demo-data";
import { supabaseConfigured } from "@/lib/supabase-config";
import { publicSiteOrigin, shareLink } from "@/lib/site-url";
import { AUTO_SWEEP_AGE, MANUAL_SWEEP_AGE } from "@/lib/attachment-sweep";
import { missingGuestFeatures, sqlChoiceFor, type GuestFunctions } from "@/lib/rpc-errors";
import { attachmentWeight, planBoardCopy } from "@/lib/board-copy";
import {
  CARD_TONES,
  COLUMN_HUES,
  MAX_QUESTION_LENGTH,
  columnQuestion,
  type Attachment,
  type BoardCard,
  type BoardColumn,
  type BoardData,
  type CardComment,
  type CardDraft,
  type CardTone,
  type LinkPreviewData,
  type UsageSnapshot,
} from "@/lib/board-types";

const LOCAL_KEY = "pillar-boards-v3";
const LOCAL_COMMENTS_KEY = "pillar-comments-v1";
const COMMENT_NAME_KEY = "pillar-comment-name";
// 손님이 올린 글을 나중에 고칠 때 쓰는 비밀 열쇠. 글을 올린 브라우저에만 저장되고 서버에는
// 지문만 남습니다. 브라우저 데이터를 지우거나 다른 기기로 옮기면 수정할 수 없습니다.
const CARD_KEY_STORE = "pillar-card-keys-v1";

function readCardKeys(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CARD_KEY_STORE) ?? "{}") as Record<string, string>; } catch { return {}; }
}

function cardEditKey(cardId: string) {
  try { return readCardKeys()[cardId] ?? ""; } catch { return ""; }
}

function rememberCardEditKey(cardId: string, key: string) {
  try {
    const keys = readCardKeys();
    keys[cardId] = key;
    // 너무 쌓이지 않도록 최근 500개만 남깁니다.
    const entries = Object.entries(keys).slice(-500);
    localStorage.setItem(CARD_KEY_STORE, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* 저장 공간이 막혀 있으면 이번 글은 수정할 수 없습니다. */ }
}

function makeEditKey() {
  try { return crypto.randomUUID() + crypto.randomUUID(); } catch { return `${makeId("key")}-${Math.random().toString(36).slice(2)}`; }
}
// 파일당 상한. supabase/schema.sql 의 버킷 file_size_limit 과 같은 값이어야 합니다.
const MAX_CLOUD_FILE = 30 * 1024 * 1024;
const MAX_DEMO_FILE = 2 * 1024 * 1024;

type DeleteTarget =
  | { kind: "board"; id: string; title: string }
  | { kind: "column"; id: string; title: string }
  | { kind: "card"; id: string; columnId: string; title: string }
  // 손님이 자기가 올린 글을 지울 때. 서버가 열쇠를 확인하므로 남의 글은 지워지지 않습니다.
  | { kind: "guestCard"; id: string; columnId: string; title: string };

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

// 휴대폰(터치 기기, 좁은 화면)용 배치인지. styles.css 의 미디어 쿼리와 같은 조건이며,
// 스타일이 늦게 오는 순간에도 휴대폰용 요소가 데스크톱에 노출되지 않도록 코드에서도 같이 판단합니다.
const TOUCH_LAYOUT_QUERY = "(max-width: 760px) and (pointer: coarse)";
function subscribeTouchLayout(callback: () => void) {
  const media = window.matchMedia(TOUCH_LAYOUT_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function useTouchLayout() {
  return useSyncExternalStore(subscribeTouchLayout, () => window.matchMedia(TOUCH_LAYOUT_QUERY).matches, () => false);
}

// PDF 를 <iframe> 으로 바로 그릴 수 있는 브라우저인지. 안드로이드(카카오톡 인앱 포함)와 아이폰은
// PDF 를 화면에 그리지 못하고 파일 다운로드로 넘기므로, 거기서는 썸네일 이미지와 캔버스 렌더링을 씁니다.
const INLINE_PDF_QUERY = "(hover: hover) and (pointer: fine)";
function inlinePdfSupported() {
  return window.matchMedia(INLINE_PDF_QUERY).matches && !/Android|iPhone|iPad|iPod|KAKAOTALK/i.test(navigator.userAgent);
}
function subscribeInlinePdf(callback: () => void) {
  const media = window.matchMedia(INLINE_PDF_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function useInlinePdf() {
  return useSyncExternalStore(subscribeInlinePdf, inlinePdfSupported, () => false);
}

// 뷰어에서 한 번에 그리는 최대 PDF 쪽수(lib/pdf-render.ts 와 같은 값).
const PDF_PAGE_LIMIT = 30;

// PDF 쪽을 캔버스로 그려 보여줍니다. iframe 이 PDF 를 다운로드로 넘겨 버리는 휴대폰 브라우저용입니다.
function PdfPages({ url, name, poster }: { url: string; name: string; poster?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pageCount, setPageCount] = useState(0);
  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    let cancelled = false;
    (async () => {
      try {
        const { openPdf, renderPdfPage } = await import("@/lib/pdf-render");
        const doc = await openPdf(url);
        if (cancelled) { void doc.loadingTask.destroy(); return; }
        setPageCount(doc.numPages);
        const width = Math.max(240, host.clientWidth || 320);
        for (let number = 1; number <= Math.min(doc.numPages, PDF_PAGE_LIMIT); number += 1) {
          const canvas = await renderPdfPage(doc, number, width);
          if (cancelled) break;
          canvas.setAttribute("aria-label", `${number}쪽`);
          host.appendChild(canvas);
          if (number === 1) setState("ready");
        }
        void doc.loadingTask.destroy();
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; host.replaceChildren(); };
  }, [url]);
  return (
    <div className={`pdf-pages is-${state}`}>
      {state === "loading" && <div className="pdf-pages-status">{poster && <img src={poster} alt="" />}<span><LoaderCircle className="spin" aria-hidden="true" />PDF를 불러오는 중…</span></div>}
      {state === "error" && <div className="pdf-pages-status"><span><FileText aria-hidden="true" />이 기기에서 PDF를 그리지 못했습니다. 아래 &quot;새 탭에서 열기&quot;를 눌러 주세요.</span></div>}
      <div ref={holder} className="pdf-pages-canvas" role="img" aria-label={`${name} 미리보기`} />
      {pageCount > PDF_PAGE_LIMIT && <p className="pdf-pages-more">앞 {PDF_PAGE_LIMIT}쪽만 표시합니다. 전체는 새 탭에서 열어 보세요.</p>}
    </div>
  );
}

// 이벤트 핸들러에서 쓰는 현재 시각. 렌더 중에는 부르지 않습니다.
function nowMs() {
  return Date.now();
}

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

// 카드 타일용 본문. 줄바꿈은 살리고 연속된 빈 줄만 한 줄로 줄입니다.
function tileBody(text: string) {
  return text.replace(/[\t ]*\n[\t ]*(?:\n[\t ]*)+/g, "\n").trim();
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

// 보드 목록에서 카드 하나를 뺍니다.
function removeCardFrom(boards: BoardData[], boardId: string, cardId: string): BoardData[] {
  return boards.map((board) => board.id !== boardId ? board : {
    ...board,
    columns: board.columns.map((column) => ({ ...column, cards: column.cards.filter((card) => card.id !== cardId) })),
  });
}

// 손님이 올리거나 고친 카드를 보드 목록에 반영합니다. 새 글은 칼럼 맨 앞에, 수정은 제자리에 둡니다.
function applyGuestCard(boards: BoardData[], boardId: string, columnId: string, card: BoardCard, editing: boolean): BoardData[] {
  return boards.map((board) => board.id !== boardId ? board : {
    ...board,
    columns: board.columns.map((column) => editing
      ? { ...column, cards: column.cards.map((item) => item.id === card.id ? card : item) }
      : column.id === columnId ? { ...column, cards: [card, ...column.cards] } : column),
  });
}

// 카드를 다른 자리로 옮긴 새 보드를 만듭니다. 원래 객체는 건드리지 않고 바뀐 칼럼만 새로 만듭니다.
function moveCard(board: BoardData, cardId: string, toColumnId: string, toIndex: number): BoardData {
  const source = findCard(board, cardId);
  if (!source) return board;
  const card = source.column.cards[source.index];
  const columns = board.columns.map((column) => {
    let cards = column.cards;
    if (column.id === source.column.id) cards = cards.filter((item) => item.id !== cardId);
    if (column.id === toColumnId) {
      const next = [...cards];
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, card);
      cards = next;
    }
    return cards === column.cards ? column : { ...column, cards };
  });
  return { ...board, columns };
}

// 카드 배치가 바뀌었는지 비교할 때 쓰는 문자열
function orderSignature(board: BoardData) {
  return board.columns.map((column) => `${column.id}:${column.cards.map((card) => card.id).join(",")}`).join("|");
}

// 드롭 대상 판정. 칼럼과 카드가 한꺼번에 "가장 가까운 중심"을 다투면 칼럼 중심이 카드 사이에 끼어들어
// 아래로 내릴 때 자리를 잘못 잡습니다. 그래서 칼럼을 먼저 정하고, 그 칼럼 안에서 자리를 셉니다.
const boardCollision: CollisionDetection = (args) => {
  const { active, droppableContainers, pointerCoordinates, collisionRect } = args;
  const columns = droppableContainers.filter((container) => container.data.current?.type === "column");
  if (active.data.current?.type === "column") return closestCenter({ ...args, droppableContainers: columns });

  const x = pointerCoordinates?.x ?? collisionRect.left + collisionRect.width / 2;
  const y = pointerCoordinates?.y ?? collisionRect.top + collisionRect.height / 2;
  const inRange = (value: number, start: number, size: number) => value >= start && value <= start + size;

  // 1) 칼럼 고르기: 포인터가 든 칼럼 → 가로 위치만 맞는 칼럼(칼럼 아래 빈 곳에 놓아도 붙도록) → 복사본이 겹치는 칼럼
  let column = columns.find((container) => { const rect = container.rect.current; return rect && inRange(x, rect.left, rect.width) && inRange(y, rect.top, rect.height); })
    ?? columns.find((container) => { const rect = container.rect.current; return rect && inRange(x, rect.left, rect.width); });
  if (!column) {
    const hits = rectIntersection({ ...args, droppableContainers: columns });
    column = hits.length ? columns.find((container) => container.id === hits[0].id) : undefined;
  }
  if (!column) return [];
  const columnHit = [{ id: column.id, data: { droppableContainer: column, value: 0 } }];

  // 2) 그 칼럼의 카드를 위에서부터 늘어놓고, 포인터보다 중심이 위에 있는 카드 수를 셉니다. 그 수가 들어갈 자리입니다.
  //    끌고 있는 카드의 빈자리도 목록에 있으므로, 그 자리가 나오면 "제자리"로 판정되어 흔들리지 않습니다.
  const targetColumnId = column.id;
  const items = droppableContainers
    .filter((container) => container.data.current?.type === "card" && container.data.current?.columnId === targetColumnId && container.rect.current)
    .sort((a, b) => a.rect.current!.top - b.rect.current!.top);
  if (!items.length) return columnHit;
  const above = items.filter((container) => container.id !== active.id && container.rect.current!.top + container.rect.current!.height / 2 < y).length;
  const target = items[above];
  return target ? [{ id: target.id, data: { droppableContainer: target, value: 0 } }] : columnHit;
};

// 사이트 대표 이미지가 없거나 불러올 수 없을 때 쓰는 화면 캡처 주소(WordPress.com mShots)
function screenshotUrl(url: string) {
  return `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=640`;
}

// 로그인이 필요해 대표 이미지도 화면 캡처도 얻을 수 없는 서비스. 카카오톡처럼 서비스 표지로 보여 줍니다.
type KnownService = { label: string; short: string; color: string };
function knownService(url: string): KnownService | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.toLowerCase();
  if (host === "docs.google.com") {
    if (path.startsWith("/spreadsheets")) return { label: "Google 스프레드시트", short: "Sheets", color: "#188038" };
    if (path.startsWith("/document")) return { label: "Google 문서", short: "Docs", color: "#1a73e8" };
    if (path.startsWith("/presentation")) return { label: "Google 슬라이드", short: "Slides", color: "#e8a600" };
    if (path.startsWith("/forms")) return { label: "Google 설문지", short: "Forms", color: "#7248b9" };
    return { label: "Google 문서", short: "Docs", color: "#1a73e8" };
  }
  if (host === "forms.gle") return { label: "Google 설문지", short: "Forms", color: "#7248b9" };
  if (host === "drive.google.com") return { label: "Google 드라이브", short: "Drive", color: "#1a73e8" };
  if (host === "sites.google.com") return { label: "Google 사이트", short: "Sites", color: "#4285f4" };
  if (host === "classroom.google.com") return { label: "Google 클래스룸", short: "Class", color: "#188038" };
  if (host === "gemini.google.com") return { label: "Gemini", short: "Gemini", color: "#4e6fd8" };
  if (host === "notebooklm.google.com") return { label: "NotebookLM", short: "NLM", color: "#1a73e8" };
  if (host === "chatgpt.com" || host === "chat.openai.com") return { label: "ChatGPT", short: "GPT", color: "#0f766e" };
  if (host === "canva.com" && path.startsWith("/design")) return { label: "Canva", short: "Canva", color: "#00c4cc" };
  if (host === "padlet.com") return { label: "Padlet", short: "Padlet", color: "#e0457b" };
  return null;
}

// 주소가 두 번 붙어 버렸거나("...copyhttps://...") 뒤에 다른 글자가 따라오면 첫 주소만 남깁니다.
function firstUrl(value: string) {
  const text = value.trim().split(/\s+/)[0] ?? "";
  const second = text.slice(1).search(/https?:\/\//i);
  return second >= 0 ? text.slice(0, second + 1) : text;
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
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

// 붙여넣기한 클립보드에서 이미지·PDF 파일을 꺼냅니다. 브라우저와 복사 출처에 따라 files 나 items
// 중 한쪽에만 들어오므로 둘 다 살핍니다. 이름 없는 스크린샷에는 시각으로 이름을 붙입니다.
function filesFromClipboard(data: DataTransfer): File[] {
  const seen = new Set<File>();
  const list: File[] = [];
  const push = (file: File | null) => {
    if (!file || seen.has(file)) return;
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") return;
    seen.add(file);
    if (!file.name || file.name === "image.png" || file.name === "blob") {
      const ext = file.type === "application/pdf" ? "pdf" : (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
      list.push(new File([file], `붙여넣은-이미지-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${ext}`, { type: file.type }));
    } else {
      list.push(file);
    }
  };
  for (const item of Array.from(data.items ?? [])) if (item.kind === "file") push(item.getAsFile());
  for (const file of Array.from(data.files ?? [])) push(file);
  return list;
}

// 업로드 전에 큰 이미지를 줄입니다. 긴 쪽 2000px, JPEG 품질 0.85. 투명한 PNG 는 PNG 로 유지하고
// GIF·SVG 는 건드리지 않습니다. 줄인 결과가 더 크면 원본을 씁니다.
const SHRINK_MAX_EDGE = 2000;
const SHRINK_SKIP_BELOW = 300 * 1024;

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
  }
}

function hasTransparentPixels(context: CanvasRenderingContext2D, width: number, height: number) {
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (pixels[(y * width + x) * 4 + 3] < 250) return true;
    }
  }
  return false;
}

async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.type === "image/svg+xml") return file;
  const source = await decodeImage(file);
  if (!source) return file;
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, SHRINK_MAX_EDGE / Math.max(width, height));
  if (scale === 1 && file.size < SHRINK_SKIP_BELOW) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  const keepPng = file.type === "image/png" && hasTransparentPixels(context, canvas.width, canvas.height);
  const type = keepPng ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob || blob.size >= file.size) return file;
  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.${keepPng ? "png" : "jpg"}`, { type, lastModified: file.lastModified });
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
  const [busy, setBusy] = useState(false);

  // 가입 화면은 없습니다. 계정은 Supabase 대시보드의 Authentication에서 만듭니다.
  async function submit() {
    if (!email.trim() || password.length < 6) {
      toast.error("이메일과 6자 이상의 비밀번호를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await (await import("@/lib/supabase-client")).login(email.trim(), password);
    } catch (error) {
      const message = error instanceof Error ? error.message : "로그인하지 못했습니다.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <span className="brand-mark" aria-hidden="true">P</span>
        <h1>Padlet-Lite</h1>
        <p>내 자료 보드에 로그인하세요.</p>
        <label>이메일<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void submit()} /></label>
        <button className="primary-button auth-primary" onClick={() => void submit()} disabled={busy}>
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}로그인
        </button>
        <p className="auth-note">Supabase 대시보드의 Authentication에서 이메일 로그인이 켜져 있어야 합니다.</p>
      </section>
      <Toaster position="bottom-center" />
    </main>
  );
}

// 링크 이미지 후보를 차례로 시도합니다: 대표 이미지 → 화면 캡처 → 아이콘. 다른 사이트 이미지는
// referrer를 보내지 않아야 핫링크 차단에 걸리지 않습니다.
function useLinkImage(link: LinkPreviewData) {
  const chain = useMemo(() => {
    const list: { stage: "image" | "shot" | "icon"; src: string }[] = [];
    if (link.image) list.push({ stage: "image", src: link.image });
    // 로그인이 필요한 서비스는 캡처해도 로그인 화면만 나오므로 건너뜁니다.
    if (!knownService(link.url)) list.push({ stage: "shot", src: screenshotUrl(link.url) });
    if (link.icon) list.push({ stage: "icon", src: link.icon });
    return list;
  }, [link.image, link.url, link.icon]);
  const [index, setIndex] = useState(0);
  const current = chain.at(index);
  return { stage: current?.stage ?? ("none" as const), src: current?.src, next: () => setIndex((value) => value + 1) };
}

// 카드 타일의 링크 썸네일. 주소 배지를 얹고, 이미지가 없으면 아이콘 표지를 보여 줍니다.
function LinkThumb({ link }: { link: LinkPreviewData }) {
  const { stage, src, next } = useLinkImage(link);
  const host = hostOf(link.url);
  if (stage === "image" || stage === "shot") {
    return (
      <span className="card-preview">
        <img className="card-image link-image" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={next} />
        <span className="thumb-badge">{host}</span>
      </span>
    );
  }
  const service = knownService(link.url);
  if (service) {
    return (
      <span className="card-preview link-cover brand-cover" aria-hidden="true" style={{ "--brand": service.color } as CSSProperties}>
        <span className="brand-cover-mark">{service.short}</span>
        <span>{service.label}</span>
      </span>
    );
  }
  return (
    <span className="card-preview link-cover" aria-hidden="true">
      {stage === "icon" ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={next} /> : <Link2 />}
      <span>{host}</span>
    </span>
  );
}

// 편집창·뷰어의 링크 줄에 붙는 작은 이미지. 같은 순서로 시도하고 모두 실패하면 그리지 않습니다.
function LinkRowImage({ link }: { link: LinkPreviewData }) {
  const { stage, src, next } = useLinkImage(link);
  if (stage === "none" || !src) return null;
  return <img className={stage === "icon" ? "is-icon" : undefined} src={src} alt="" referrerPolicy="no-referrer" onError={next} />;
}

// 이 카드에 미리보기가 그려지는지. 미리보기 영역을 눌러 카드를 열 수 있게 버튼으로 감쌀 때 씁니다.
function hasPreview(card: BoardCard) {
  return card.attachments.some((item) => item.kind === "image" || item.kind === "pdf") || Boolean(card.link);
}

// 카드 타일 안의 미리보기. 이미지 > PDF 첫 페이지 > 동영상 썸네일 > 링크 썸네일 순서로 하나만 보여줍니다.
function CardPreview({ card }: { card: BoardCard }) {
  const inlinePdf = useInlinePdf();
  const firstImage = card.attachments.find((item) => item.kind === "image");
  const firstPdf = card.attachments.find((item) => item.kind === "pdf");
  const video = getVideoEmbed(card.link?.url);
  if (firstImage) return <span className="card-preview"><img className="card-image" src={firstImage.url} alt="" loading="lazy" /></span>;
  if (firstPdf) {
    // 썸네일 이미지가 있으면 어디서나 그것을 쓰고, 없는 옛 PDF 는 iframe 을 그릴 수 있는 데스크톱에서만 iframe 으로,
    // 휴대폰에서는 파일 다운로드가 뜨지 않도록 아이콘 자리표시로 보여줍니다.
    return (
      <span className="card-preview pdf-preview" aria-hidden="true">
        {firstPdf.thumbnailUrl ? <img className="card-image pdf-thumb" src={firstPdf.thumbnailUrl} alt="" loading="lazy" />
          : inlinePdf ? <iframe title="" src={`${firstPdf.url}#page=1&toolbar=0&navpanes=0&scrollbar=0&view=FitH`} loading="lazy" tabIndex={-1} />
          : <span className="pdf-placeholder"><FileText /><em>{firstPdf.name}</em></span>}
        <span className="preview-badge"><FileText />PDF</span>
      </span>
    );
  }
  if (video) {
    const thumbnail = video.thumbnail ?? card.link?.image;
    return (
      <span className="card-preview video-preview" aria-hidden="true">
        {thumbnail ? <img className="card-image" src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} /> : <span className="card-image" />}
        <span className="play-badge"><Play /></span>
      </span>
    );
  }
  if (card.link) return <LinkThumb key={`${card.link.url}|${card.link.image ?? ""}`} link={card.link} />;
  return null;
}

// 카드에 표시할 작성자 이름. 손님 카드는 손님 이름, 주인 카드는 저장 당시 이름, 없으면 "작성자"
function cardAuthor(card: BoardCard, ownerName?: string) {
  return card.guestAuthor || card.authorName || ownerName || "작성자";
}

// 카드 타일 안쪽 내용. 목록의 카드와 끌 때 따라다니는 복사본이 같은 모양을 쓰도록 분리했습니다.
// 미리보기는 카드 맨 위(이 컴포넌트 밖)에 2:1 높이로 들어가고, 여기는 제목 → 사이트·링크 제목 → 본문 → 작성자·댓글 줄 순서입니다.
function CardInner({ card, commentSummary, commentsEnabled, ownerName }: { card: BoardCard; commentSummary?: CommentSummary; commentsEnabled: boolean; ownerName?: string }) {
  const author = cardAuthor(card, ownerName);
  const link = card.link;
  const video = getVideoEmbed(link?.url);
  const host = link ? hostOf(link.url) : "";
  const service = link ? knownService(link.url) : null;
  const siteLabel = link ? (link.siteName && link.siteName !== host ? link.siteName : service?.label || host) : "";
  const linkTitle = link && link.title && link.title !== host && link.title !== link.siteName && link.title !== siteLabel ? link.title : "";
  const extraAttachments = card.attachments.length - (card.attachments.some((item) => item.kind === "image" || item.kind === "pdf") ? 1 : 0);
  return (
    <>
      <strong className="card-title">{card.title}</strong>
      {link && <span className="card-link-line">{video ? "동영상" : siteLabel}{linkTitle && <> · {linkTitle}</>}</span>}
      {card.body && <span className="card-body">{tileBody(card.body)}</span>}
      {extraAttachments > 0 && <span className="attachment-count">첨부 {card.attachments.length}개</span>}
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
      <span className="card-footer">
        <span className="card-author">
          <span className="card-avatar" aria-hidden="true">{author.trim().charAt(0).toUpperCase()}</span>
          <span className="card-author-name">{author}</span>
          {card.guestAuthor && <em className="card-guest">손님</em>}
          <time className="card-time" dateTime={new Date(card.createdAt).toISOString()}>{formatRelative(card.createdAt)}</time>
        </span>
        {commentsEnabled && <span className="comment-count" aria-label={`댓글 ${commentSummary?.count ?? 0}개`}><MessageCircle aria-hidden="true" />{commentSummary?.count ?? 0}</span>}
      </span>
    </>
  );
}

function cardToneClass(card: BoardCard) {
  return card.tone && card.tone !== "default" ? ` card-tone-${card.tone}` : "";
}

// 끌고 있는 동안 포인터를 따라다니는 복사본. 칼럼의 스크롤 영역 밖으로도 나갈 수 있습니다.
function CardOverlay({ card, commentSummary, commentsEnabled, ownerName }: { card: BoardCard; commentSummary?: CommentSummary; commentsEnabled: boolean; ownerName?: string }) {
  return (
    <article className={`board-card drag-overlay-card${cardToneClass(card)}`}>
      <CardPreview card={card} />
      <div className="card-row">
        <span className="drag-handle" aria-hidden="true"><GripVertical /></span>
        <div className="card-main"><CardInner card={card} commentSummary={commentSummary} commentsEnabled={commentsEnabled} ownerName={ownerName} /></div>
      </div>
    </article>
  );
}

function SortableCard({ card, columnId, readOnly, commentSummary, commentsEnabled, ownerName, onOpen, onEdit, onDuplicate, onDelete }: {
  card: BoardCard;
  columnId: string;
  readOnly: boolean;
  commentSummary?: CommentSummary;
  commentsEnabled: boolean;
  ownerName?: string;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
    data: { type: "card", columnId },
  });

  return (
    <article ref={setNodeRef} className={`board-card${cardToneClass(card)}${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {hasPreview(card) && (
        // 썸네일을 눌러도 카드가 열립니다. 제목 버튼이 따로 있어 스크린리더에는 숨깁니다.
        <button type="button" className="card-preview-button" onClick={onOpen} tabIndex={-1} aria-hidden="true">
          <CardPreview card={card} />
        </button>
      )}
      <div className="card-row">
      {!readOnly && <button className="drag-handle" aria-label={`${card.title} 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>}
      <button className="card-main" onClick={onOpen} aria-label={`${card.title} 크게 보기`}><CardInner card={card} commentSummary={commentSummary} commentsEnabled={commentsEnabled} ownerName={ownerName} /></button>
      </div>

      {!readOnly && (
        <div className="card-controls">
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

function SortableColumn({ column, readOnly, canAdd, queryText, commentSummaries, commentsEnabled, ownerName, onAddCard, onOpenCard, onEditCard, onRename, onRecolor, onDuplicate, onDelete, onToggle, onEditQuestion, onDuplicateCard, onDeleteCard }: {
  column: BoardColumn;
  readOnly: boolean;
  canAdd: boolean;
  queryText: string;
  commentSummaries: Record<string, CommentSummary>;
  commentsEnabled: boolean;
  ownerName?: string;
  onAddCard: () => void;
  onOpenCard: (card: BoardCard) => void;
  onEditCard: (card: BoardCard) => void;
  onRename: () => void;
  onRecolor: (hue: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onEditQuestion: () => void;
  onDuplicateCard: (card: BoardCard) => void;
  onDeleteCard: (card: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: readOnly, data: { type: "column" } });
  const needle = queryText.trim().toLowerCase();
  const filteredCards = column.cards.filter((card) => !needle || `${card.title} ${card.body}`.toLowerCase().includes(needle));
  const hue = columnHue(column);
  const style = { transform: CSS.Transform.toString(transform), transition, "--column-hue": hue } as CSSProperties;
  // 질문 섹션이면 질문이 칼럼 맨 위에 고정되고, 카드는 "답변"이라는 말로 안내합니다.
  const question = columnQuestion(column);
  const [questionOpen, setQuestionOpen] = useState(false);
  // "카드가" / "답변이" — 받침에 따라 조사가 달라 통째로 둡니다.
  const itemSubject = question ? "답변이" : "카드가";

  return (
    <article ref={setNodeRef} id={`column-${column.id}`} className={`column${question ? " is-question" : ""}${column.collapsed ? " is-collapsed" : ""}${isDragging ? " is-dragging" : ""}`} style={style}>
      <header className="column-header">
        {!readOnly && <button className="column-handle" aria-label={`${column.title} 칼럼 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>}
        <button className="column-title" onClick={onToggle} aria-expanded={!column.collapsed}>{question && <MessageCircleQuestion className="column-question-mark" aria-label="질문 섹션" />}<strong>{column.title}</strong><span>{column.cards.length}</span></button>
        <button className="quiet-button" onClick={onToggle} aria-label={column.collapsed ? "칼럼 펼치기" : "칼럼 접기"}>{column.collapsed ? <PanelTopOpen aria-hidden="true" /> : <PanelTopClose aria-hidden="true" />}</button>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="quiet-button" aria-label={`${column.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="column-menu">
              <DropdownMenuItem onClick={onRename}><Pencil />이름 변경</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}><Copy />칼럼 복제</DropdownMenuItem>
              <DropdownMenuItem onClick={onEditQuestion}><MessageCircleQuestion />{question ? "질문 편집" : "질문 섹션으로 만들기"}</DropdownMenuItem>
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
          {question && (
            <div className={`column-question${questionOpen ? " is-open" : ""}`}>
              <span className="column-question-label"><MessageCircleQuestion aria-hidden="true" />질문</span>
              <p>{question}</p>
              {(question.length > 90 || question.split("\n").length > 3) && <button type="button" className="column-question-toggle" onClick={() => setQuestionOpen((open) => !open)} aria-expanded={questionOpen}>{questionOpen ? "접기" : "더 보기"}</button>}
            </div>
          )}
          {canAdd && (question
            ? <button className="add-card-button is-answer" onClick={onAddCard} aria-label={`${column.title}에 답변 쓰기`}><Plus aria-hidden="true" />답변 쓰기</button>
            : <button className="add-card-button" onClick={onAddCard} aria-label={`${column.title}에 카드 추가`} title="카드 추가"><Plus aria-hidden="true" /></button>)}
          <SortableContext items={filteredCards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
            <div className="card-list">
              {filteredCards.map((card) => <SortableCard key={card.id} card={card} columnId={column.id} readOnly={readOnly} commentSummary={commentSummaries[card.id]} commentsEnabled={commentsEnabled} ownerName={ownerName} onOpen={() => onOpenCard(card)} onEdit={() => onEditCard(card)} onDuplicate={() => onDuplicateCard(card)} onDelete={() => onDeleteCard(card)} />)}
              {needle && filteredCards.length === 0 && <p className="column-empty">일치하는 {itemSubject} 없습니다.</p>}
              {!needle && filteredCards.length === 0 && <p className="column-empty">{!canAdd ? `${itemSubject} 없습니다.` : question ? "위의 답변 쓰기를 눌러 첫 답변을 남겨 보세요." : "위의 + 를 눌러 첫 카드를 추가하세요."}</p>}
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
  // 새로고침해도 보던 보드로 돌아오도록 주소의 ?board= 값을 씁니다.
  const [initialBoardId, setInitialBoardId] = useState<string | null>(null);
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
  // 다시 읽기 판단에 쓰는 최신 값들. 통로를 다시 연결하지 않으려고 참조로 들고 있습니다.
  const liveRef = useRef({ boardId: "", token: null as string | null, busy: false, editing: false, dirty: false, dragging: false, comments: false });

  // 이번 화면에서 주인이 지운 카드 ID. 저장할 때 손님 카드를 되살리면서 이 카드들이 다시 살아나지 않게 합니다.
  const removedCardIds = useRef(new Set<string>());
  // 손님 기능에 필요한 데이터베이스 함수가 갖춰졌는지. 공유 설정 창을 열 때 한 번만 확인합니다.
  const [guestFunctions, setGuestFunctions] = useState<GuestFunctions | null>(null);
  const [copyingSql, setCopyingSql] = useState(false);
  // 보드 복사 창. 어떤 칼럼을 가져올지 체크박스로 고릅니다.
  const [copyTarget, setCopyTarget] = useState<{ board: BoardData; title: string; columnIds: string[]; includeCards: boolean } | null>(null);
  const [copyProgress, setCopyProgress] = useState<number | null>(null);

  // 질문 설정·편집 대화상자. 질문은 여러 줄일 수 있어 이름 변경과 달리 별도 창을 씁니다.
  const [questionTarget, setQuestionTarget] = useState<{ columnId: string; columnTitle: string; text: string; answers: number } | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [newColumnQuestion, setNewColumnQuestion] = useState("");
  const [view, setView] = useState<"home" | "board">("home");
  const [viewerCardId, setViewerCardId] = useState<string | null>(null);
  // 끌고 있는 카드와, 끌기 시작할 때의 보드(취소·실행 취소용)
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  // 휴대폰에서 칼럼이 한 화면에 하나씩 보일 때, 지금 보고 있는 칼럼 번호 (칼럼 탭 표시용)
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const boardRef = useRef<HTMLElement>(null);
  const touchLayout = useTouchLayout();
  const inlinePdf = useInlinePdf();
  const dragSnapshot = useRef<BoardData | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<CardComment[]>([]);
  const [commentAuthor, setCommentAuthor] = useState("");
  // 홈 화면 사용량 대시보드
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const boardsRef = useRef(boards);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];
  const readOnly = Boolean(sharedToken);
  const commentsEnabled = Boolean(activeBoard?.commentsEnabled);
  // 공유 링크로 들어온 사람도 카드를 올릴 수 있는 보드인지. 보드마다 따로 켭니다.
  const guestPosting = readOnly && Boolean(activeBoard?.guestPostEnabled);
  // 카드와 댓글에 표시하는 주인 이름. 이메일 앞부분을 씁니다.
  const ownerName = user?.email?.split("@")[0] || undefined;
  // 뷰어에 띄운 카드는 ID로만 기억하고 매 렌더마다 보드에서 다시 찾습니다. 편집 뒤에도 최신 내용이 보입니다.
  const viewerTarget = viewerCardId && activeBoard ? findCard(activeBoard, viewerCardId) : null;
  const viewerCard = viewerTarget ? viewerTarget.column.cards[viewerTarget.index] : null;
  // 편집 중인 카드가 질문 섹션에 속하면 그 질문. 편집창 맨 위에 읽기 전용으로 띄웁니다.
  const draftQuestion = columnQuestion(activeBoard?.columns.find((column) => column.id === draft?.columnId));
  const viewerQuestion = columnQuestion(viewerTarget?.column);
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
  // 사용량을 다시 셉니다. Supabase 가 있으면 저장소 목록과 서버 함수로, 데모 모드면 로컬 데이터로 셉니다.
  const refreshUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const current = boardsRef.current;
      if (supabaseConfigured && user) {
        setUsage(await (await import("@/lib/supabase-client")).measureUsage(user.uid, current));
      } else {
        const attachments = current.flatMap((board) => board.columns.flatMap((column) => column.cards.flatMap((card) => card.attachments)));
        setUsage({
          storageBytes: attachments.reduce((sum, item) => sum + item.size, 0),
          storageFiles: attachments.length,
          dbBytes: new Blob([JSON.stringify(current)]).size,
          boardCount: current.length,
          cardCount: current.reduce((sum, board) => sum + board.columns.reduce((inner, column) => inner + column.cards.length, 0), 0),
          commentCount: readLocalComments().length,
          measuredAt: Date.now(),
        });
      }
    } catch {
      toast.error("사용량을 불러오지 못했습니다.");
    } finally {
      setUsageLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (view !== "home" || readOnly || loading) return;
    // 첫 측정은 다음 틱으로 넘기고(렌더 직후 상태 변경을 피함), 홈을 보는 동안 1분마다 다시 셉니다.
    const first = window.setTimeout(() => void refreshUsage(), 0);
    const timer = window.setInterval(() => void refreshUsage(), 60_000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [view, readOnly, loading, refreshUsage]);

  // 변경 표시와 저장 상태를 한 곳에서 바꿉니다. 저장 effect는 이 값만 보고 동작합니다.
  const markDirty = useCallback((boardId: string) => { setDirtyBoardId(boardId); setSaveStatus("saving"); }, []);

  useEffect(() => { boardsRef.current = boards; }, [boards]);
  useEffect(() => {
    // 주소의 ?share= 와 ?board= 값은 브라우저에서만 읽을 수 있어 첫 렌더 뒤 한 번 동기화합니다.
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSharedToken(params.get("share"));
    setInitialBoardId(params.get("board"));
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
          const wanted = initialBoardId ? localBoards.find((board) => board.id === initialBoardId) : undefined;
          setActiveBoardId(wanted ? wanted.id : localBoards[0].id);
          if (wanted) setView("board");
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
          // 주소에 보드가 적혀 있고 그 보드가 아직 있으면 그 보드를 바로 엽니다.
          const wanted = initialBoardId ? nextBoards.find((board) => board.id === initialBoardId) : undefined;
          setActiveBoardId(wanted ? wanted.id : nextBoards[0].id);
          if (wanted) setView("board");
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
  }, [initialBoardId, markDirty, routeReady, sharedToken]);

  // 공유 설정 창을 처음 열 때 데이터베이스 준비 상태를 확인합니다. 실패하면 아무것도 보여 주지
  // 않습니다. 틀린 경고는 맞는 정보보다 나쁩니다.
  useEffect(() => {
    if (!shareOpen || readOnly || !supabaseConfigured || guestFunctions) return;
    let live = true;
    void (async () => {
      try {
        const found = await (await import("@/lib/supabase-client")).checkGuestFunctions();
        if (live) setGuestFunctions(found);
      } catch { /* 확인에 실패하면 표시하지 않습니다. */ }
    })();
    return () => { live = false; };
  }, [guestFunctions, readOnly, shareOpen]);

  // 지금 보고 있는 보드를 주소에 남깁니다. 새로고침하면 그 보드가 다시 열리고, 뒤로가기로 홈에 갑니다.
  useEffect(() => {
    if (!routeReady || readOnly || loading) return;
    const search = view === "board" && activeBoardId ? `?board=${encodeURIComponent(activeBoardId)}` : "";
    const next = `${window.location.pathname}${search}`;
    if (`${window.location.pathname}${window.location.search}` === next) return;
    try { window.history.pushState({}, "", next); } catch { /* 주소를 못 바꿔도 화면은 그대로 동작합니다. */ }
  }, [activeBoardId, loading, readOnly, routeReady, view]);

  useEffect(() => {
    if (readOnly) return;
    function syncFromUrl() {
      const boardId = new URLSearchParams(window.location.search).get("board");
      if (boardId && boardsRef.current.some((board) => board.id === boardId)) { setActiveBoardId(boardId); setView("board"); }
      else setView("home");
    }
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [readOnly]);

  useEffect(() => {
    if (!dirtyBoardId || readOnly) return;
    const board = boards.find((item) => item.id === dirtyBoardId);
    if (!board) return;
    const timer = window.setTimeout(async () => {
      try {
        if (supabaseConfigured && user) {
          const saved = await (await import("@/lib/supabase-client")).saveBoard(board, user.uid, removedCardIds.current);
          // 저장하면서 내 화면에 없던 손님 카드를 되살렸으면 화면에도 반영합니다.
          if (saved.columns !== board.columns) setBoards((current) => current.map((item) => item.id === saved.id ? saved : item));
          // 같은 보드를 보고 있는 사람들에게 바뀐 것을 알립니다.
          boardChannel.current?.notify();
        }
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

  // 서버의 최신 내용을 다시 읽어 화면에 반영합니다. 내가 쓰는 중이거나 아직 저장되지 않은
  // 변경이 있으면 건너뜁니다. 그래야 남의 글이 내 작업을 덮어쓰지 않습니다.
  const refreshBoard = useCallback(async () => {
    const live = liveRef.current;
    if (!supabaseConfigured || !live.boardId || live.busy || live.editing || live.dirty || live.dragging) return;
    live.busy = true;
    try {
      const backend = await import("@/lib/supabase-client");
      const fresh = live.token ? await backend.loadSharedBoard(live.token) : await backend.loadBoardById(live.boardId);
      if (fresh) setBoards((current) => current.map((board) => board.id === fresh.id ? fresh : board));
      if (live.comments) {
        const fetched = live.token ? await backend.loadSharedComments(live.token) : await backend.loadComments(live.boardId);
        setComments(fetched);
      }
    } catch { /* 잠시 뒤 다시 확인합니다. */ }
    finally { live.busy = false; }
  }, []);

  // 위 판단에 쓰는 값들을 매 렌더마다 최신으로 맞춰 둡니다.
  useEffect(() => {
    liveRef.current.boardId = activeBoard?.id ?? "";
    liveRef.current.token = sharedToken;
    liveRef.current.editing = editorOpen;
    liveRef.current.dirty = Boolean(dirtyBoardId);
    liveRef.current.dragging = Boolean(dragCardId);
    liveRef.current.comments = commentsEnabled;
  });

  const refreshBoardRef = useRef(refreshBoard);
  useEffect(() => { refreshBoardRef.current = refreshBoard; }, [refreshBoard]);

  // 같은 보드를 보는 사람들이 서로 "바뀌었다"고 알리는 통로. 알림을 받으면 바로 다시 읽습니다.
  const boardChannel = useRef<{ notify: () => void; close: () => void } | null>(null);
  useEffect(() => {
    if (!supabaseConfigured || !routeReady || !activeBoardId) return;
    let open = true;
    let handle: { notify: () => void; close: () => void } | null = null;
    void (async () => {
      const backend = await import("@/lib/supabase-client");
      if (!open) return;
      handle = backend.connectBoardChannel(activeBoardId, () => { void refreshBoardRef.current(); });
      boardChannel.current = handle;
      // 보드를 열자마자 한 번 최신 내용을 맞춰 둡니다. 그 사이 올라온 글이 바로 보입니다.
      void refreshBoardRef.current();
    })();
    return () => { open = false; handle?.close(); boardChannel.current = null; };
  }, [activeBoardId, routeReady]);

  // 알림이 막혀 있는 환경을 위한 보조 수단: 탭으로 돌아왔을 때와 60초마다 한 번씩 확인합니다.
  useEffect(() => {
    if (!supabaseConfigured || !routeReady || !activeBoardId) return;
    function check() { if (document.visibilityState === "visible") void refreshBoardRef.current(); }
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [activeBoardId, routeReady]);

  // 어느 카드도 가리키지 않는 첨부 파일을 치웁니다. 보드마다 이 화면에서 한 번만 돌고,
  // 편집 중인 파일을 지우지 않도록 올라간 지 하루가 지난 것만 대상으로 삼습니다.
  const sweptBoards = useRef(new Set<string>());
  useEffect(() => {
    if (!supabaseConfigured || !user || readOnly || !activeBoard || loading) return;
    const boardId = activeBoard.id;
    if (sweptBoards.current.has(boardId)) return;
    sweptBoards.current.add(boardId);
    const ownerId = user.uid;
    const timer = window.setTimeout(() => void (async () => {
      try {
        const backend = await import("@/lib/supabase-client");
        // 판단 기준은 반드시 서버에서 막 읽어 온 보드여야 합니다. 화면의 보드는 손님이 방금 올린 글을 모를 수 있습니다.
        const fresh = await backend.loadBoardById(boardId);
        if (!fresh) return;
        const { removed, bytes } = await backend.sweepOrphanAttachments(ownerId, fresh, AUTO_SWEEP_AGE);
        if (!removed) return;
        toast.message(`쓰이지 않는 파일 ${removed}개(${formatBytes(bytes)})를 정리했습니다.`);
        void refreshUsage();
      } catch { /* 다음에 열 때 다시 시도합니다. */ }
    })(), 4000);
    return () => window.clearTimeout(timer);
  }, [activeBoard, loading, readOnly, refreshUsage, user]);

  // 홈 화면의 "지금 정리" 버튼. 사람이 직접 누르는 것이라 기준을 10분으로 짧게 잡습니다.
  const sweepAllBoards = useCallback(async () => {
    if (!supabaseConfigured || !user) { toast.message("로컬 데모 모드에서는 정리할 저장소가 없습니다."); return; }
    const backend = await import("@/lib/supabase-client");
    let removed = 0;
    let bytes = 0;
    for (const board of boardsRef.current) {
      try {
        const fresh = await backend.loadBoardById(board.id);
        if (!fresh) continue;
        const result = await backend.sweepOrphanAttachments(user.uid, fresh, MANUAL_SWEEP_AGE);
        removed += result.removed;
        bytes += result.bytes;
        sweptBoards.current.add(board.id);
      } catch { /* 이 보드는 건너뜁니다. */ }
    }
    toast.success(removed ? `쓰이지 않는 파일 ${removed}개(${formatBytes(bytes)})를 정리했습니다.` : "정리할 파일이 없습니다.");
    await refreshUsage();
  }, [refreshUsage, user]);

  // 썸네일 없이 올라간 옛 PDF 첨부에 첫 쪽 썸네일을 채워 넣습니다. 보드 주인이 보드를 열었을 때 하나씩 처리하며,
  // 한 번 시도한 첨부는 이 세션에서 다시 시도하지 않습니다.
  const thumbnailBackfill = useRef(new Set<string>());
  useEffect(() => {
    if (!activeBoard || readOnly || (supabaseConfigured && !user)) return;
    const boardId = activeBoard.id;
    const target = activeBoard.columns.flatMap((column) => column.cards.flatMap((card) => card.attachments))
      .find((attachment) => attachment.kind === "pdf" && !attachment.thumbnailUrl && !thumbnailBackfill.current.has(attachment.id));
    if (!target) return;
    thumbnailBackfill.current.add(target.id);
    (async () => {
      try {
        const response = await fetch(target.url);
        if (!response.ok) return;
        const thumbnail = await (await import("@/lib/pdf-render")).renderPdfThumbnail(new File([await response.blob()], target.name, { type: "application/pdf" }));
        if (!thumbnail) return;
        const stored = supabaseConfigured && user
          ? await (await import("@/lib/supabase-client")).uploadAttachment(thumbnail, user.uid, boardId, `${target.id}-thumb`)
          : { url: await fileToDataUrl(thumbnail), storagePath: undefined };
        updateBoard(boardId, (board) => ({
          ...board,
          columns: board.columns.map((column) => ({
            ...column,
            cards: column.cards.map((card) => ({
              ...card,
              attachments: card.attachments.map((attachment) => attachment.id === target.id ? { ...attachment, thumbnailUrl: stored.url, thumbnailPath: stored.storagePath } : attachment),
            })),
          })),
        }));
      } catch (error) { console.warn("PDF 썸네일 채우기 실패", error); }
    })();
  }, [activeBoard, readOnly, user, updateBoard]);

  const pushUndo = useCallback((previous: BoardData, message: string) => {
    toast(message, { action: { label: "실행 취소", onClick: () => {
      setBoards((current) => current.map((board) => board.id === previous.id ? previous : board));
      markDirty(previous.id);
    } } });
  }, [markDirty]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const dragCard = dragCardId && activeBoard ? findCard(activeBoard, dragCardId) : null;

  function handleDragStart(event: DragStartEvent) {
    const board = boardsRef.current.find((item) => item.id === activeBoardId) ?? null;
    dragSnapshot.current = board;
    if (event.active.data.current?.type === "card") setDragCardId(String(event.active.id));
  }

  // 끌고 있는 동안 다른 칼럼 위로 가면 그 자리에 미리 넣어 보여 줍니다. 저장은 놓을 때 한 번만 합니다.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type !== "card") return;
    setBoards((current) => current.map((board) => {
      if (board.id !== activeBoardId) return board;
      const source = findCard(board, String(active.id));
      if (!source) return board;
      const overCard = findCard(board, String(over.id));
      const targetColumn = overCard ? overCard.column : board.columns.find((column) => column.id === over.id);
      if (!targetColumn || targetColumn.id === source.column.id) return board;
      const toIndex = overCard ? overCard.index : targetColumn.cards.length;
      return moveCard(board, source.column.cards[source.index].id, targetColumn.id, toIndex);
    }));
  }

  function finishDrag(nextBoard: BoardData | null, message: string) {
    const previous = dragSnapshot.current;
    dragSnapshot.current = null;
    setDragCardId(null);
    if (!nextBoard || !previous) return;
    if (orderSignature(nextBoard) === orderSignature(previous)) {
      // 자리가 그대로면 끌기 전 상태로 되돌리기만 하고 저장하지 않습니다.
      setBoards((current) => current.map((board) => board.id === previous.id ? previous : board));
      return;
    }
    updateBoard(nextBoard.id, () => nextBoard);
    pushUndo(previous, message);
  }

  function handleDragCancel() {
    const previous = dragSnapshot.current;
    dragSnapshot.current = null;
    setDragCardId(null);
    if (previous) setBoards((current) => current.map((board) => board.id === previous.id ? previous : board));
  }

  function handleDragEnd(event: DragEndEvent) {
    const board = boardsRef.current.find((item) => item.id === activeBoardId);
    const previous = dragSnapshot.current;
    if (!board || !previous) { handleDragCancel(); return; }
    const { active, over } = event;

    if (active.data.current?.type === "column") {
      const oldIndex = board.columns.findIndex((column) => column.id === active.id);
      const newIndex = over ? board.columns.findIndex((column) => column.id === over.id) : -1;
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) { handleDragCancel(); return; }
      finishDrag({ ...board, columns: arrayMove(board.columns, oldIndex, newIndex) }, "칼럼을 이동했습니다.");
      return;
    }

    // 놓을 자리가 없으면(보드 바깥 등) 끌기 전 상태로 되돌립니다.
    if (!over) { handleDragCancel(); return; }
    const source = findCard(board, String(active.id));
    if (!source) { handleDragCancel(); return; }
    const overCard = findCard(board, String(over.id));
    const targetColumn = overCard ? overCard.column : board.columns.find((column) => column.id === over.id);
    if (!targetColumn) { handleDragCancel(); return; }

    let next = board;
    if (overCard && overCard.column.id === source.column.id) {
      if (overCard.index !== source.index) next = moveCard(board, String(active.id), targetColumn.id, overCard.index);
    } else if (overCard) {
      next = moveCard(board, String(active.id), targetColumn.id, overCard.index);
    } else if (targetColumn.id !== source.column.id || source.index !== targetColumn.cards.length - 1) {
      next = moveCard(board, String(active.id), targetColumn.id, targetColumn.cards.length);
    }
    finishDrag(next, "카드를 이동했습니다.");
  }

  // 보드가 가로로 스크롤될 때 왼쪽에 가장 가까운 칼럼을 현재 칼럼으로 잡습니다.
  function handleBoardScroll() {
    const board = boardRef.current;
    if (!board) return;
    const columns = Array.from(board.querySelectorAll<HTMLElement>(":scope > .column"));
    if (!columns.length) return;
    const left = board.scrollLeft + board.getBoundingClientRect().left;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    columns.forEach((element, index) => {
      const distance = Math.abs(element.getBoundingClientRect().left + board.scrollLeft - left);
      if (distance < best) { best = distance; nearest = index; }
    });
    setActiveColumnIndex((current) => current === nearest ? current : nearest);
  }
  function scrollToColumn(columnId: string) {
    document.getElementById(`column-${columnId}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function openNewCard(columnId?: string) {
    if (!columnId || (readOnly && !guestPosting)) return;
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
  // 손님은 자기가 올린 글만 열 수 있습니다.
  function openCard(columnId: string, card: BoardCard) {
    if (readOnly && !canEditGuestCard(card)) return;
    setDraft({ ...structuredClone(card), columnId });
    if (readOnly && card.guestAuthor) setCommentAuthor(card.guestAuthor);
    setLinkInput(card.link?.url ?? "");
    setEditorOpen(true);
  }
  // 손님이 자기가 올린 글을 고칠 수 있는지. 그 글을 올린 브라우저에만 열쇠가 있습니다.
  function canEditGuestCard(card: BoardCard) {
    return guestPosting && Boolean(card.guestAuthor) && Boolean(card.editKeyHash) && Boolean(cardEditKey(card.id));
  }

  // 공유 손님이 올리는 카드는 서버 함수가 보드 데이터에 직접 덧붙입니다.
  // 고칠 때를 대비해 비밀 열쇠를 함께 보내고, 그 열쇠는 이 브라우저에만 남깁니다.
  async function saveGuestCard(link: LinkPreviewData | undefined) {
    if (!draft || !activeBoard || !sharedToken) return;
    const author = commentAuthor.trim().slice(0, 40) || "익명";
    // 질문 섹션에서는 제목이 선택이라, 비워 두면 쓴 사람 이름이 카드 제목이 됩니다.
    const title = draft.title.trim() || author;
    const body = draft.body.trim();
    const editing = Boolean(draft.id);
    const cardId = draft.id ?? makeId("card");
    const editKey = editing ? cardEditKey(cardId) : makeEditKey();
    if (editing && !editKey) { toast.error("이 글을 수정할 권한이 없습니다. 글을 올린 브라우저에서만 고칠 수 있습니다."); return; }
    setUploading(true);
    try {
      let saved: BoardCard;
      if (supabaseConfigured) {
        const client = await import("@/lib/supabase-client");
        saved = editing
          ? await client.updateSharedCard(sharedToken, { id: cardId, title, body, link, attachments: draft.attachments, editKey })
          : await client.addSharedCard(sharedToken, { id: cardId, columnId: draft.columnId, title, body, link, author, attachments: draft.attachments, editKey });
      } else {
        // 데모 모드는 서버가 없어 열쇠를 그대로 지문 자리에 넣고 브라우저 안에서만 확인합니다.
        const now = nowMs();
        const before = editing ? findCard(activeBoard, cardId) : null;
        const previous = before ? before.column.cards[before.index] : null;
        saved = { ...(previous ?? {}), id: cardId, title, body, attachments: draft.attachments, link, guestAuthor: previous?.guestAuthor ?? author, editKeyHash: previous?.editKeyHash ?? editKey, createdAt: previous?.createdAt ?? now, updatedAt: now };
        localStorage.setItem(LOCAL_KEY, JSON.stringify(applyGuestCard(readLocalBoards(), activeBoard.id, draft.columnId, saved, editing)));
      }
      if (!editing) rememberCardEditKey(cardId, editKey);
      setBoards((current) => applyGuestCard(current, activeBoard.id, draft.columnId, saved, editing));
      localStorage.setItem(COMMENT_NAME_KEY, author === "익명" ? "" : author);
      setEditorOpen(false);
      setDraft(null);
      setViewerCardId(null);
      boardChannel.current?.notify();
      toast.success(editing ? "글을 수정했습니다." : "카드를 올렸습니다.");
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : editing ? "글을 수정하지 못했습니다." : "카드를 올리지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    // 질문 섹션에서는 제목 대신 답변 알맹이를 받습니다. 링크는 아직 미리보기를 안 받았을 수 있어
    // draft.link 가 아니라 입력칸을 봅니다.
    if (columnQuestion(activeBoard?.columns.find((column) => column.id === draft.columnId))) {
      if (!draft.title.trim() && !draft.body.trim() && !draft.attachments.length && !linkInput.trim()) { toast.error("답변 내용을 입력해 주세요."); return; }
    } else if (!draft.title.trim()) { toast.error("카드 제목을 입력해 주세요."); return; }
    let link: LinkPreviewData | undefined;
    setUploading(true);
    try { link = await resolveDraftLink(); } catch { setUploading(false); return; }
    setUploading(false);
    if (guestPosting) { void saveGuestCard(link); return; }
    const now = nowMs();
    updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => {
      if (column.id !== draft.columnId) return column;
      const tone: CardTone | undefined = draft.tone && draft.tone !== "default" ? draft.tone : undefined;
      // 제목을 비우면 쓴 사람 이름이 제목이 됩니다. 남의 답변을 고칠 때 작성자가 바뀌지 않도록
      // 기존 카드는 그 카드의 작성자를 그대로 씁니다.
      if (draft.id) return { ...column, cards: column.cards.map((card) => card.id === draft.id ? { ...card, title: draft.title.trim() || cardAuthor(card, ownerName), body: draft.body.trim(), attachments: draft.attachments, link, tone, updatedAt: now } : card) };
      return { ...column, cards: [{ id: makeId("card"), title: draft.title.trim() || ownerName || "작성자", body: draft.body.trim(), attachments: draft.attachments, link, tone, authorName: ownerName, createdAt: now, updatedAt: now }, ...column.cards] };
    }) }));
    setEditorOpen(false);
    setDraft(null);
    toast.success(draft.id ? "카드를 저장했습니다." : "카드를 추가했습니다.");
  }

  // 첨부에 실제로 추가된 파일 수를 돌려줍니다. 거부되거나 실패하면 0입니다.
  async function addFiles(files: FileList | File[]): Promise<number> {
    if (!draft || !activeBoard) return 0;
    const typed = Array.from(files).filter((file) => {
      const allowed = file.type.startsWith("image/") || file.type === "application/pdf";
      if (!allowed || file.type.startsWith("video/")) { toast.error(`${file.name}: 이미지와 PDF만 첨부할 수 있습니다.`); return false; }
      return true;
    });
    if (!typed.length) return 0;
    setUploading(true);
    // 큰 이미지는 먼저 줄인 뒤 크기를 검사합니다. 휴대폰 사진이 수 MB 에서 수백 KB 로 줄어듭니다.
    const shrunk = await Promise.all(typed.map((file) => shrinkImage(file)));
    const savedBytes = typed.reduce((sum, file, index) => sum + Math.max(0, file.size - shrunk[index].size), 0);
    const accepted = shrunk.filter((file) => {
      const maxSize = supabaseConfigured ? MAX_CLOUD_FILE : MAX_DEMO_FILE;
      if (file.size > maxSize) { toast.error(`${file.name}: ${supabaseConfigured ? "30MB" : "2MB"} 이하 파일만 첨부할 수 있습니다.`); return false; }
      return true;
    });
    if (!accepted.length) { setUploading(false); return 0; }
    if (savedBytes > 512 * 1024) toast.message(`이미지를 ${formatBytes(savedBytes)} 줄여서 올립니다.`);
    try {
      const uploaded: Attachment[] = [];
      for (const file of accepted) {
        const id = makeId("file");
        const stored = await storeFile(file, id);
        // PDF 는 첫 쪽 썸네일도 함께 올립니다. 휴대폰에서는 iframe 대신 이 이미지를 보여줍니다.
        if (stored.kind === "pdf") {
          const thumbnail = await (await import("@/lib/pdf-render")).renderPdfThumbnail(file);
          if (thumbnail) {
            try {
              const storedThumb = await storeFile(thumbnail, `${id}-thumb`);
              stored.thumbnailUrl = storedThumb.url;
              stored.thumbnailPath = storedThumb.storagePath;
            } catch { /* 썸네일이 없어도 첨부는 그대로 둡니다. */ }
          }
        }
        uploaded.push(stored);
      }
      setDraft((current) => current ? { ...current, attachments: [...current.attachments, ...uploaded] } : current);
      return uploaded.length;
    } catch (error) { toast.error(error instanceof Error && error.message ? `업로드 실패: ${error.message}` : "파일을 업로드하지 못했습니다."); return 0; }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  // 파일 하나를 저장소(또는 데모 모드의 데이터 URL)에 올리고 첨부 정보를 돌려줍니다.
  async function storeFile(file: File, id: string): Promise<Attachment> {
    if (!activeBoard) throw new Error("보드가 없습니다.");
    if (supabaseConfigured && guestPosting && sharedToken) return (await import("@/lib/supabase-client")).uploadGuestAttachment(file, activeBoard.id, id);
    if (supabaseConfigured && user) return (await import("@/lib/supabase-client")).uploadAttachment(file, user.uid, activeBoard.id, id);
    return { id, name: file.name, kind: file.type === "application/pdf" ? "pdf" : "image", mimeType: file.type, size: file.size, url: await fileToDataUrl(file) };
  }

  function deleteDraftAttachment(attachment: Attachment) {
    setDraft((current) => current ? { ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) } : current);
  }

  // 입력한 주소를 정리합니다. 스킴이 없으면 https를 붙이고, 주소가 아니면 null입니다.
  function normalizeLinkInput(value: string) {
    let url = firstUrl(value);
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try { return new URL(url).toString(); } catch { return null; }
  }

  async function requestLinkPreview(url: string): Promise<LinkPreviewData> {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
    const data = (await response.json()) as LinkPreviewData & { error?: string };
    if (!response.ok) throw new Error(data.error);
    return data;
  }

  async function fetchLinkPreview() {
    if (!draft) return;
    const url = normalizeLinkInput(linkInput);
    if (!url) { if (url === null) toast.error("올바른 링크를 입력해 주세요."); return; }
    setLinkLoading(true);
    try {
      const data = await requestLinkPreview(url);
      setDraft({ ...draft, link: data });
      setLinkInput(data.url);
    } catch (error) { toast.error(error instanceof Error && error.message ? error.message : "링크를 확인하지 못했습니다."); }
    finally { setLinkLoading(false); }
  }

  // 저장 직전에 링크 칸과 카드의 링크를 맞춥니다. 칸을 비웠으면 링크를 지우고,
  // 미리보기를 누르지 않고 주소만 바꿨으면 그 주소로 미리보기를 받아 옵니다.
  async function resolveDraftLink(): Promise<LinkPreviewData | undefined> {
    if (!draft) return undefined;
    const url = normalizeLinkInput(linkInput);
    if (url === "") return undefined;
    if (url === null) { toast.error("올바른 링크를 입력해 주세요."); throw new Error("invalid link"); }
    if (draft.link && (draft.link.url === url || draft.link.url === linkInput.trim())) return draft.link;
    try {
      return await requestLinkPreview(url);
    } catch {
      const host = hostOf(url);
      return { url, title: host, description: "", siteName: host };
    }
  }

  function removeDraftLink() {
    setLinkInput("");
    setDraft((current) => current ? { ...current, link: undefined } : current);
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
      boardChannel.current?.notify();
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
  // 칼럼을 카드까지 통째로 복제해 바로 오른쪽에 넣습니다. ID는 모두 새로 만듭니다.
  function duplicateColumn(columnId: string) {
    const now = nowMs();
    updateActiveBoard((board) => {
      const index = board.columns.findIndex((column) => column.id === columnId);
      if (index < 0) return board;
      const source = board.columns[index];
      const copy: BoardColumn = {
        ...source,
        id: makeId("column"),
        title: `${source.title} 복사본`,
        cards: source.cards.map((card) => ({ ...structuredClone(card), id: makeId("card"), createdAt: now, updatedAt: now })),
      };
      const columns = [...board.columns];
      columns.splice(index + 1, 0, copy);
      return { ...board, columns };
    });
    toast.success("칼럼을 복제했습니다.");
  }
  // 칼럼 메뉴에서 질문을 설정하거나 고칩니다. 접힌 칼럼은 질문과 답변 버튼이 가려지므로 함께 펼칩니다.
  function openQuestionEditor(column: BoardColumn) {
    setQuestionTarget({ columnId: column.id, columnTitle: column.title, text: columnQuestion(column), answers: column.cards.length });
  }

  function applyQuestion(text: string) {
    if (!questionTarget) return;
    const question = text.trim().slice(0, MAX_QUESTION_LENGTH);
    const previous = activeBoard ? structuredClone(activeBoard) : null;
    const had = Boolean(activeBoard?.columns.find((column) => column.id === questionTarget.columnId)?.question?.trim());
    updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => column.id === questionTarget.columnId
      ? { ...column, question: question || undefined, collapsed: question ? false : column.collapsed }
      : column) }));
    setQuestionTarget(null);
    if (!question && had) {
      const note = questionTarget.answers > 0 ? `질문을 해제했습니다. 답변 ${questionTarget.answers}개는 그대로 남습니다.` : "질문을 해제했습니다.";
      if (previous) pushUndo(previous, note); else toast.success(note);
      return;
    }
    if (question) toast.success(had ? "질문을 바꿨습니다." : "질문 섹션으로 만들었습니다.");
  }

  function addColumn() {
    if (!newColumnTitle.trim()) return;
    // 질문을 채워 넣으면 질문 섹션으로 만들어집니다. 비워 두면 보통 칼럼입니다.
    const question = newColumnQuestion.trim().slice(0, MAX_QUESTION_LENGTH);
    updateActiveBoard((board) => ({ ...board, columns: [...board.columns, { id: makeId("column"), title: newColumnTitle.trim(), collapsed: false, question: question || undefined, cards: [] }] }));
    setNewColumnTitle(""); setNewColumnQuestion(""); setAddingColumn(false);
    if (question) toast.success("질문 섹션을 만들었습니다.");
  }
  function openCopyDialog(board: BoardData) {
    setCopyTarget({ board, title: `${board.title} 복사본`, columnIds: board.columns.map((column) => column.id), includeCards: true });
  }

  async function runBoardCopy() {
    if (!copyTarget || copyProgress !== null) return;
    const { board: source, columnIds, includeCards } = copyTarget;
    const title = copyTarget.title.trim() || `${source.title} 복사본`;
    if (!columnIds.length) return;
    const { board: copy, files } = planBoardCopy(source, {
      title, columnIds, includeCards,
      newBoardId: makeId("board"),
      // 데모 모드에는 저장소가 없어 첨부가 데이터 URL 입니다. 주인 폴더를 비워 파일 복사를 건너뜁니다.
      ownerId: supabaseConfigured && user ? user.uid : undefined,
      makeId, now: nowMs(),
    });
    setCopyProgress(0);
    let note = "";
    if (files.length) {
      try {
        const { failed } = await (await import("@/lib/supabase-client")).copyAttachmentFiles(files, (done) => setCopyProgress(done));
        if (failed.length) {
          // 옮기지 못한 파일은 원래 경로를 그대로 두어 지금 당장 첨부를 잃지 않게 합니다.
          const stuck = new Set(failed);
          const original = new Map(files.map((file) => [file.to, file.from]));
          for (const column of copy.columns) {
            for (const card of column.cards) {
              for (const attachment of card.attachments) {
                if (attachment.storagePath && stuck.has(attachment.storagePath)) attachment.storagePath = original.get(attachment.storagePath);
                if (attachment.thumbnailPath && stuck.has(attachment.thumbnailPath)) attachment.thumbnailPath = original.get(attachment.thumbnailPath);
              }
            }
          }
          note = ` 파일 ${failed.length}개는 원본과 함께 씁니다.`;
        }
      } catch {
        note = " 첨부 파일은 원본과 함께 씁니다.";
      }
    }
    setBoards((current) => [copy, ...current]);
    markDirty(copy.id);
    setCopyProgress(null);
    setCopyTarget(null);
    const cards = copy.columns.reduce((sum, column) => sum + column.cards.length, 0);
    toast.success(`${title}을(를) 만들었습니다. 칼럼 ${copy.columns.length}개${includeCards ? `, 카드 ${cards}개` : ""}.${note}`);
  }

  function createBoard() {
    const now = Date.now();
    const board: BoardData = { id: makeId("board"), title: "새 보드", shareEnabled: false, shareToken: "", createdAt: now, updatedAt: now, columns: [{ id: makeId("column"), title: "첫 번째 칼럼", collapsed: false, cards: [] }] };
    setBoards((current) => [board, ...current]); setActiveBoardId(board.id); markDirty(board.id); setView("board");
  }

  async function confirmDelete() {
    if (!deleteTarget || !activeBoard) return;
    if (deleteTarget.kind === "guestCard") {
      const editKey = cardEditKey(deleteTarget.id);
      if (!editKey) { toast.error("이 글을 지울 권한이 없습니다. 글을 올린 브라우저에서만 지울 수 있습니다."); setDeleteTarget(null); return; }
      try {
        if (supabaseConfigured && sharedToken) await (await import("@/lib/supabase-client")).deleteSharedCard(sharedToken, deleteTarget.id, editKey);
        else localStorage.setItem(LOCAL_KEY, JSON.stringify(removeCardFrom(readLocalBoards(), activeBoard.id, deleteTarget.id)));
        setBoards((current) => removeCardFrom(current, activeBoard.id, deleteTarget.id));
        setViewerCardId(null);
        setDeleteTarget(null);
        boardChannel.current?.notify();
        toast.success("글을 지웠습니다.");
      } catch (error) {
        toast.error(error instanceof Error && error.message ? error.message : "글을 지우지 못했습니다.");
        setDeleteTarget(null);
      }
      return;
    }
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
      previous.columns.find((column) => column.id === deleteTarget.id)?.cards.forEach((card) => removedCardIds.current.add(card.id));
      updateActiveBoard((board) => ({ ...board, columns: board.columns.filter((column) => column.id !== deleteTarget.id) }));
      pushUndo(previous, "칼럼을 삭제했습니다.");
    } else {
      removedCardIds.current.add(deleteTarget.id);
      updateActiveBoard((board) => ({ ...board, columns: board.columns.map((column) => column.id === deleteTarget.columnId ? { ...column, cards: column.cards.filter((card) => card.id !== deleteTarget.id) } : column) }));
      pushUndo(previous, "카드를 삭제했습니다.");
    }
    setDeleteTarget(null);
  }

  // 데이터베이스에 아직 없는 손님 기능. 주인에게만 보여 줍니다.
  const missingFeatures = missingGuestFeatures(guestFunctions);

  // 빠진 것을 메우는 SQL 을 클립보드에 넣습니다. 문자열은 누를 때만 불러옵니다.
  async function copyGuestSql() {
    const choice = sqlChoiceFor(guestFunctions);
    if (choice === "none") return;
    setCopyingSql(true);
    try {
      const sql = await import("@/lib/generated-sql");
      const text = choice === "uploads" ? sql.GUEST_UPLOADS_SQL
        : choice === "delete" ? sql.GUEST_CARD_DELETE_SQL
        : choice === "cards" ? sql.GUEST_CARDS_SQL
        : `${sql.GUEST_UPLOADS_SQL}\n\n${sql.GUEST_CARDS_SQL}`;
      await navigator.clipboard.writeText(text);
      toast.success("SQL을 복사했습니다. Supabase SQL Editor를 비우고 붙여 넣은 뒤 Run 하세요.");
    } catch {
      // 클립보드가 막힌 환경에서는 파일 이름이라도 알려 줍니다.
      toast.error("복사하지 못했습니다. 저장소의 supabase/guest-cards.sql 을 열어 실행해 주세요.");
    } finally {
      setCopyingSql(false);
    }
  }

  // 공유 링크는 현재 열려 있는 주소가 아니라 항상 고정 도메인으로 만듭니다.
  const shareUrl = activeBoard?.shareToken ? shareLink(publicSiteOrigin(), activeBoard.shareToken) : "";
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
          usage={usage}
          usageLoading={usageLoading}
          onRefreshUsage={() => void refreshUsage()}
          onSweep={sweepAllBoards}
          onCopy={openCopyDialog}
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
      {touchLayout && activeBoard.columns.length > 1 && (
        <nav className="column-tabs" aria-label="칼럼 이동">
          {activeBoard.columns.map((column, index) => (
            <button key={column.id} type="button" className={`column-tab${index === activeColumnIndex ? " is-active" : ""}`} style={{ "--column-hue": columnHue(column) } as CSSProperties} onClick={() => scrollToColumn(column.id)} aria-current={index === activeColumnIndex ? "true" : undefined}>
              {column.title}<span>{column.cards.length}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="board-heading"><div><span className="board-kicker">{readOnly ? "공유 보드" : "내 보드"} · 칼럼 {activeBoard.columns.length} · 카드 {activeBoard.columns.reduce((sum, column) => sum + column.cards.length, 0)}</span><h1>{activeBoard.title}</h1></div></div>
      <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <SortableContext items={activeBoard.columns.map((column) => column.id)}>
          <section ref={boardRef} className="board" aria-label={`${activeBoard.title} 보드`} onScroll={handleBoardScroll}>
            {activeBoard.columns.map((column) => <SortableColumn key={column.id} column={column} readOnly={readOnly} canAdd={!readOnly || guestPosting} queryText={queryText} commentSummaries={commentSummaries} commentsEnabled={commentsEnabled} ownerName={ownerName} onAddCard={() => openNewCard(column.id)} onOpenCard={openViewer} onEditCard={(card) => openCard(column.id, card)} onRename={() => {
              const title = window.prompt("새 칼럼 이름", column.title)?.trim();
              if (title) updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, title } : item) }));
            }} onRecolor={(hue) => updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, hue } : item) }))} onDuplicate={() => duplicateColumn(column.id)} onDelete={() => setDeleteTarget({ kind: "column", id: column.id, title: column.title })} onToggle={() => updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, collapsed: !item.collapsed } : item) }))} onEditQuestion={() => openQuestionEditor(column)} onDuplicateCard={(card) => duplicateCard(column.id, card)} onDeleteCard={(card) => setDeleteTarget({ kind: "card", id: card.id, columnId: column.id, title: card.title })} />)}
            {!readOnly && (addingColumn ? <form className="new-column-form" onSubmit={(event) => { event.preventDefault(); addColumn(); }}><input autoFocus value={newColumnTitle} onChange={(event) => setNewColumnTitle(event.target.value)} placeholder="칼럼 이름" /><label className="new-column-question">질문 (선택)<textarea value={newColumnQuestion} maxLength={MAX_QUESTION_LENGTH} onChange={(event) => setNewColumnQuestion(event.target.value)} placeholder="채우면 질문 섹션이 됩니다" /></label><div><button className="primary-button" type="submit">추가</button><button className="secondary-button" type="button" onClick={() => { setAddingColumn(false); setNewColumnQuestion(""); }}>취소</button></div></form> : <button className="add-column-button" onClick={() => setAddingColumn(true)}><Plus aria-hidden="true" />칼럼 추가</button>)}
          </section>
        </SortableContext>
        {createPortal(
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2, .8, .2, 1)" }} zIndex={80}>
            {dragCard && <CardOverlay card={dragCard.column.cards[dragCard.index]} commentSummary={commentSummaries[dragCard.column.cards[dragCard.index].id]} commentsEnabled={commentsEnabled} ownerName={ownerName} />}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      </div>
      </>)}

      <Dialog open={editorOpen} onOpenChange={(open) => { setEditorOpen(open); if (!open) setDraft(null); }}>
        <DialogContent className="card-dialog" onPaste={(event) => {
          // 편집창 어디서든 Ctrl+V / Cmd+V 로 붙여넣은 이미지·PDF는 첨부로 들어갑니다.
          const pasted = filesFromClipboard(event.clipboardData);
          if (pasted.length) {
            event.preventDefault();
            if (readOnly && !guestPosting) { toast.error("읽기 전용 보드입니다."); return; }
            void addFiles(pasted).then((count) => { if (count > 0) toast.success(count === 1 ? "클립보드의 이미지를 첨부했습니다." : `클립보드의 파일 ${count}개를 첨부했습니다.`); });
            return;
          }
          // 글자 칸에 붙여넣을 때는 브라우저가 알아서 넣습니다. 여기서도 채우면 같은 주소가 두 번 들어갑니다.
          const target = event.target as HTMLElement;
          if (target.closest("input, textarea")) return;
          const text = event.clipboardData.getData("text").trim();
          if (/^https?:\/\//i.test(text) && !linkInput) setLinkInput(firstUrl(text));
        }}>
          <DialogHeader><DialogTitle>{draft?.id ? (guestPosting ? "내 글 수정" : draftQuestion ? "답변 수정" : "카드 수정") : (draftQuestion ? "답변 쓰기" : "새 카드")}</DialogTitle><DialogDescription>{draftQuestion ? "아래 질문을 읽고 답을 적어 주세요. 글, 링크, 이미지, PDF를 담을 수 있습니다." : guestPosting ? "이 보드에 카드를 올립니다. 글, 링크, 이미지, PDF를 담을 수 있습니다." : "글, 링크, 이미지, PDF를 한 카드에 담을 수 있습니다."}</DialogDescription></DialogHeader>
          {draft && <div className="editor-body">
            {draftQuestion && <section className="editor-question"><div className="section-label"><MessageCircleQuestion aria-hidden="true" />질문</div><p>{draftQuestion}</p></section>}
            {guestPosting && <label>이름<input value={commentAuthor} maxLength={40} readOnly={Boolean(draft?.id)} onChange={(event) => setCommentAuthor(event.target.value)} placeholder="비워 두면 익명" /></label>}
            {guestPosting && draft?.id && <p className="editor-note">이 글을 올린 브라우저에서만 수정할 수 있습니다. 이름과 올린 시각은 그대로 유지됩니다.</p>}
            <label>{draftQuestion ? "제목 (선택)" : "제목"}<input value={draft.title} readOnly={readOnly && !guestPosting} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={draftQuestion ? "비워 두면 이름이 제목이 됩니다" : "무엇을 모아둘까요?"} /></label>
            <label>{draftQuestion ? "답변" : "내용"}<textarea value={draft.body} readOnly={readOnly && !guestPosting} maxLength={3000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder={draftQuestion ? "질문에 대한 답을 적어 주세요" : "메모를 입력하세요"} /></label>
            {!readOnly && <section><div className="section-label"><Palette />카드 색</div><div className="tone-swatches" role="radiogroup" aria-label="카드 색">{CARD_TONES.map((tone) => <button key={tone.value} type="button" role="radio" aria-checked={(draft.tone ?? "default") === tone.value} className={`tone-swatch card-tone-${tone.value}${(draft.tone ?? "default") === tone.value ? " is-active" : ""}`} onClick={() => setDraft({ ...draft, tone: tone.value })} title={tone.label} aria-label={tone.label} />)}</div></section>}
            <section className="link-editor"><div className="section-label"><Link2 />링크</div>{(!readOnly || guestPosting) && <div className="link-input-row"><input value={linkInput} onChange={(event) => { const value = event.target.value; setLinkInput(value); if (!value.trim()) setDraft((current) => current ? { ...current, link: undefined } : current); }} placeholder="https://..." /><button className="secondary-button" onClick={() => void fetchLinkPreview()} disabled={linkLoading}>{linkLoading && <LoaderCircle className="spin" />}미리보기</button></div>}{draft.link && <a className="link-preview" href={draft.link.url} target="_blank" rel="noreferrer"><LinkRowImage key={`${draft.link.url}|${draft.link.image ?? ""}`} link={draft.link} /><span><small>{getVideoEmbed(draft.link.url) ? "동영상 · 카드에서 바로 재생" : linkLabel(draft.link)}</small><strong>{draft.link.title}</strong><em>{draft.link.description}</em></span><ExternalLink /></a>}{draft.link && (!readOnly || guestPosting) && <button type="button" className="text-button link-remove" onClick={removeDraftLink}><X />링크 제거</button>}</section>
            <section><div className="section-label"><UploadCloud />첨부</div>{(!readOnly || guestPosting) && <button className="drop-zone" type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>{uploading ? <LoaderCircle className="spin" /> : <UploadCloud />}<span>이미지 또는 PDF를 선택하거나 끌어 놓으세요. 복사한 이미지는 Ctrl+V로 붙여넣어도 됩니다.</span><small>{supabaseConfigured ? "파일당 최대 30MB" : "데모 모드 파일당 최대 2MB"} · 동영상 제외</small><input ref={fileInputRef} hidden type="file" multiple accept="image/*,application/pdf" onChange={(event) => event.target.files && void addFiles(event.target.files)} /></button>}
              {draft.attachments.length > 0 && <div className="attachment-grid">{draft.attachments.map((attachment) => <article className="attachment-item" key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.url} alt={attachment.name} /> : attachment.thumbnailUrl ? <img src={attachment.thumbnailUrl} alt={attachment.name} /> : <span className="attachment-icon" aria-hidden="true"><FileText /></span>}<div><strong>{attachment.name}</strong><span>{attachment.kind === "pdf" ? "PDF" : "이미지"} · {formatBytes(attachment.size)}</span></div><a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`${attachment.name} 열기`}><ExternalLink /></a>{(!readOnly || guestPosting) && <button onClick={() => deleteDraftAttachment(attachment)} aria-label={`${attachment.name} 삭제`}><X /></button>}</article>)}</div>}
            </section>
          </div>}
          <DialogFooter><button className="secondary-button" onClick={() => setEditorOpen(false)}>{readOnly && !guestPosting ? "닫기" : "취소"}</button>{(!readOnly || guestPosting) && <button className="primary-button" onClick={() => void saveDraft()} disabled={uploading}>{uploading && <LoaderCircle className="spin" aria-hidden="true" />}{guestPosting && draft?.id ? "수정 저장" : draftQuestion && !draft?.id ? "답변 올리기" : guestPosting ? "올리기" : "저장"}</button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(viewerCard) && !editorOpen} onOpenChange={(open) => { if (!open) setViewerCardId(null); }}>
        <DialogContent className={`viewer-dialog${viewerCard?.tone && viewerCard.tone !== "default" ? ` card-tone-${viewerCard.tone}` : ""}`}>
          {viewerCard && viewerTarget && <>
            <DialogHeader className="viewer-header">
              <span className="viewer-kicker"><span className="card-type" aria-hidden="true">{typeIcon(viewerCard)}</span>{cardAuthor(viewerCard, ownerName)} · {viewerTarget.column.title} · {formatDate(viewerCard.createdAt)}{viewerCard.guestAuthor && <em className="guest-tag"><UserRound aria-hidden="true" />손님</em>}</span>
              <DialogTitle className="viewer-title">{viewerCard.title}</DialogTitle>
              <DialogDescription className="sr-only">카드 내용을 크게 봅니다.</DialogDescription>
              {!readOnly && <button className="secondary-button viewer-edit" onClick={() => openCard(viewerTarget.column.id, viewerCard)}><Pencil aria-hidden="true" />편집</button>}
              {readOnly && canEditGuestCard(viewerCard) && <span className="viewer-edit viewer-own-actions">
                <button className="secondary-button" onClick={() => openCard(viewerTarget.column.id, viewerCard)}><Pencil aria-hidden="true" />내 글 수정</button>
                <button className="text-button viewer-own-delete" onClick={() => setDeleteTarget({ kind: "guestCard", id: viewerCard.id, columnId: viewerTarget.column.id, title: viewerCard.title })}><Trash2 aria-hidden="true" />삭제</button>
              </span>}
            </DialogHeader>
            <div className="viewer-body">
              {viewerQuestion && <section className="viewer-question"><span className="section-label"><MessageCircleQuestion aria-hidden="true" />{viewerTarget.column.title} 칼럼의 질문</span><p>{viewerQuestion}</p></section>}
              {viewerCard.body && <p className="viewer-text">{viewerCard.body}</p>}
              {viewerVideo && <div className="viewer-video"><iframe src={viewerVideo.embedUrl} title={viewerCard.link?.title || "동영상"} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>}
              {viewerCard.link && <a className={`link-preview viewer-link${viewerVideo ? " is-compact" : ""}`} href={viewerCard.link.url} target="_blank" rel="noreferrer">{!viewerVideo && <LinkRowImage key={`${viewerCard.link.url}|${viewerCard.link.image ?? ""}`} link={viewerCard.link} />}<span><small>{linkLabel(viewerCard.link)}</small><strong>{viewerCard.link.title}</strong>{viewerCard.link.description && <em>{viewerCard.link.description}</em>}</span><ExternalLink aria-hidden="true" /></a>}
              {viewerCard.attachments.map((attachment) => attachment.kind === "image" ? (
                <figure className="viewer-image" key={attachment.id}>
                  <button type="button" onClick={() => setLightboxUrl(attachment.url)} aria-label={`${attachment.name} 전체 화면으로 보기`}><img src={attachment.url} alt={attachment.name} /><span className="zoom-hint"><Maximize2 aria-hidden="true" /></span></button>
                  <figcaption><ImageIcon aria-hidden="true" /><span>{attachment.name}</span><small>{formatBytes(attachment.size)}</small><a href={attachment.url} target="_blank" rel="noreferrer">원본 열기<ExternalLink aria-hidden="true" /></a></figcaption>
                </figure>
              ) : (
                <figure className="viewer-pdf" key={attachment.id}>
                  {inlinePdf ? <iframe src={`${attachment.url}#toolbar=1&navpanes=0&view=FitH`} title={attachment.name} /> : <PdfPages url={attachment.url} name={attachment.name} poster={attachment.thumbnailUrl} />}
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

      <Dialog open={Boolean(copyTarget)} onOpenChange={(open) => { if (!open && copyProgress === null) setCopyTarget(null); }}>
        <DialogContent className="copy-dialog">
          <DialogHeader>
            <DialogTitle>보드 복사</DialogTitle>
            <DialogDescription>가져올 칼럼을 고르세요. 복사본은 공유가 꺼진 채로 만들어지고 댓글은 따라가지 않습니다.</DialogDescription>
          </DialogHeader>
          {copyTarget && <div className="copy-body">
            <label>새 보드 이름<input value={copyTarget.title} maxLength={80} onChange={(event) => setCopyTarget({ ...copyTarget, title: event.target.value })} /></label>
            <div className="copy-list-head">
              <span>칼럼 {copyTarget.columnIds.length} / {copyTarget.board.columns.length} 선택</span>
              <button type="button" className="text-button" onClick={() => setCopyTarget({ ...copyTarget, columnIds: copyTarget.columnIds.length === copyTarget.board.columns.length ? [] : copyTarget.board.columns.map((column) => column.id) })}>
                {copyTarget.columnIds.length === copyTarget.board.columns.length ? "전체 해제" : "전체 선택"}
              </button>
            </div>
            <ul className="copy-list">
              {copyTarget.board.columns.map((column) => {
                const picked = copyTarget.columnIds.includes(column.id);
                return (
                  <li key={column.id}>
                    <label>
                      <Checkbox checked={picked} onCheckedChange={(next) => setCopyTarget({ ...copyTarget, columnIds: next ? [...copyTarget.columnIds, column.id] : copyTarget.columnIds.filter((id) => id !== column.id) })} aria-label={`${column.title} 복사`} />
                      <span className="copy-list-title">{columnQuestion(column) && <MessageCircleQuestion aria-label="질문 섹션" />}<strong>{column.title}</strong></span>
                      <em>카드 {column.cards.length}</em>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label className="copy-cards-row">
              <Checkbox checked={copyTarget.includeCards} onCheckedChange={(next) => setCopyTarget({ ...copyTarget, includeCards: Boolean(next) })} aria-label="카드도 함께 복사" />
              <span><strong>카드도 함께 복사</strong><small>{copyTarget.includeCards ? "끄면 칼럼 구성과 질문만 가져오고 카드는 비웁니다" : "칼럼 구성과 질문만 가져옵니다"}</small></span>
            </label>
            {(() => {
              const weight = attachmentWeight(copyTarget.board, copyTarget.columnIds, copyTarget.includeCards);
              return weight.count > 0 ? <p className="copy-note">첨부 {weight.count}개({formatBytes(weight.bytes)})도 새 보드 몫으로 복사되어 저장 공간을 그만큼 더 씁니다.</p> : null;
            })()}
            {copyProgress !== null && <p className="copy-note">복사하는 중… 파일 {copyProgress}개 완료</p>}
          </div>}
          <DialogFooter>
            <button className="secondary-button" onClick={() => setCopyTarget(null)} disabled={copyProgress !== null}>취소</button>
            <button className="primary-button" onClick={() => void runBoardCopy()} disabled={!copyTarget?.columnIds.length || copyProgress !== null}>
              {copyProgress !== null && <LoaderCircle className="spin" aria-hidden="true" />}복사
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(questionTarget)} onOpenChange={(open) => { if (!open) setQuestionTarget(null); }}>
        <DialogContent className="question-dialog">
          <DialogHeader>
            <DialogTitle>질문 섹션</DialogTitle>
            <DialogDescription>{questionTarget?.columnTitle} 칼럼 맨 위에 질문이 고정되고, 이 칼럼에서 쓰는 카드는 그 질문에 대한 답이 됩니다.</DialogDescription>
          </DialogHeader>
          {questionTarget && <div className="question-body">
            <label>질문<textarea autoFocus value={questionTarget.text} maxLength={MAX_QUESTION_LENGTH} onChange={(event) => setQuestionTarget({ ...questionTarget, text: event.target.value })} placeholder="예) 오늘 연수에서 가장 기억에 남는 내용은 무엇인가요?" /></label>
            <span className="question-count">{questionTarget.text.length} / {MAX_QUESTION_LENGTH}자</span>
            {questionTarget.answers > 0 && <p className="question-note">이 칼럼에는 이미 카드가 {questionTarget.answers}개 있습니다. 질문을 바꾸거나 해제해도 카드는 지워지지 않습니다.</p>}
            {activeBoard && !(activeBoard.shareEnabled && activeBoard.guestPostEnabled) && (
              <p className="question-warning">
                <MessageCircleQuestion aria-hidden="true" />
                지금은 공유받은 사람이 답변을 올릴 수 없습니다. 공유 설정에서 읽기 전용 링크와 글쓰기를 켜 주세요.
                <button type="button" className="text-button" onClick={() => { setQuestionTarget(null); setShareOpen(true); }}>공유 설정 열기</button>
              </p>
            )}
          </div>}
          <DialogFooter>
            {questionTarget && columnQuestion(activeBoard?.columns.find((column) => column.id === questionTarget.columnId)) && <button className="text-button question-clear" onClick={() => applyQuestion("")}><X aria-hidden="true" />질문 해제</button>}
            <button className="secondary-button" onClick={() => setQuestionTarget(null)}>취소</button>
            <button className="primary-button" onClick={() => questionTarget && applyQuestion(questionTarget.text)} disabled={!questionTarget?.text.trim()}>저장</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="share-dialog"><DialogHeader><DialogTitle>보드 공유</DialogTitle><DialogDescription>링크를 가진 사람은 이 보드를 읽을 수 있습니다.</DialogDescription></DialogHeader><div className="share-switch-row"><div><strong>읽기 전용 링크</strong><span>{activeBoard.shareEnabled ? "공유 중" : "비공개"}</span></div><Switch checked={activeBoard.shareEnabled} onCheckedChange={setSharing} aria-label="읽기 전용 공유" /></div><div className="share-switch-row"><div><strong>공유받은 사람의 글쓰기</strong><span>{activeBoard.guestPostEnabled ? "링크를 가진 사람도 카드를 올릴 수 있습니다" : "꺼짐 · 읽기만 할 수 있습니다"}</span></div><Switch checked={Boolean(activeBoard.guestPostEnabled)} onCheckedChange={(enabled) => { updateActiveBoard((board) => ({ ...board, guestPostEnabled: enabled })); toast.success(enabled ? "공유받은 사람도 카드를 올릴 수 있습니다." : "공유받은 사람의 글쓰기를 껐습니다."); }} aria-label="공유받은 사람의 글쓰기 허용" /></div>{guestFunctions && (missingFeatures.length
          ? <div className="share-warning"><p>데이터베이스에 아직 없는 기능: <b>{missingFeatures.join(", ")}</b>. 아래 버튼으로 SQL을 복사한 뒤, Supabase SQL Editor를 <b>비우고</b> 붙여 넣어 Run 하세요.</p><button type="button" className="text-button" onClick={() => void copyGuestSql()} disabled={copyingSql}><Copy aria-hidden="true" />SQL 복사</button></div>
          : <p className="share-ready">손님의 글쓰기·수정·삭제·파일 업로드가 모두 준비되었습니다.</p>)}<div className="share-switch-row"><div><strong>댓글</strong><span>{commentsEnabled ? "카드마다 댓글을 남길 수 있습니다" : "꺼짐 · 카드 뷰어에 댓글란이 보이지 않습니다"}</span></div><Switch checked={commentsEnabled} onCheckedChange={setCommentsEnabled} aria-label="댓글 허용" /></div>{activeBoard.shareEnabled && <><div className="share-url"><input readOnly value={shareUrl} /><button onClick={() => { void navigator.clipboard.writeText(shareUrl); toast.success("공유 링크를 복사했습니다."); }}><Copy />복사</button></div><button className="text-button" onClick={regenerateShareLink}><RotateCcw />기존 링크를 끊고 새 링크 만들기</button>{!supabaseConfigured && <p className="share-warning">로컬 데모 링크는 이 브라우저에서만 확인할 수 있습니다.</p>}</>}</DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.kind === "guestCard" ? "내가 올린 글을 삭제할까요?" : `${deleteTarget?.title}을(를) 삭제할까요?`}</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.kind === "column" ? "칼럼 안의 카드도 함께 삭제됩니다." : deleteTarget?.kind === "guestCard" ? "지우면 되돌릴 수 없습니다. 첨부한 파일도 카드와 함께 화면에서 사라집니다." : "삭제 직후에는 실행 취소할 수 있습니다."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <Toaster position="bottom-center" />
    </main>
  );
}
