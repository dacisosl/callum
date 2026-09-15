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
  MoreHorizontal,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type {
  Attachment,
  BoardCard,
  BoardColumn,
  BoardData,
  CardDraft,
  LinkPreviewData,
} from "@/lib/board-types";

const LOCAL_KEY = "pillar-boards-v3";
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

function typeIcon(card: BoardCard) {
  if (card.attachments.some((item) => item.kind === "pdf")) return <FileText />;
  if (card.attachments.some((item) => item.kind === "image")) return <ImageIcon />;
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

function SortableCard({ card, readOnly, onOpen, onDuplicate, onDelete }: {
  card: BoardCard;
  readOnly: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: readOnly,
    data: { type: "card" },
  });
  const firstImage = card.attachments.find((item) => item.kind === "image");
  const firstPdf = card.attachments.find((item) => item.kind === "pdf");

  return (
    <article ref={setNodeRef} className={`board-card${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {firstImage && <img className="card-image" src={firstImage.url} alt="" />}
      {firstPdf && !firstImage && <div className="pdf-cover" aria-hidden="true"><FileText /><span>PDF</span></div>}
      {card.link?.image && !firstImage && !firstPdf && <img className="card-image link-image" src={card.link.image} alt="" />}

      <button className="card-main" onClick={onOpen} aria-label={`${card.title} 열기`}>
        <span className="card-heading"><span className="card-type" aria-hidden="true">{typeIcon(card)}</span><strong>{card.title}</strong></span>
        {card.body && <span className="card-body">{card.body}</span>}
        {card.link && <span className="link-source">{isVideoUrl(card.link.url) ? "동영상 링크" : card.link.siteName || "링크"}<ExternalLink aria-hidden="true" /></span>}
        {card.attachments.length > 0 && <span className="attachment-count">첨부 {card.attachments.length}개</span>}
      </button>

      {!readOnly && (
        <div className="card-controls">
          <button className="drag-handle" aria-label={`${card.title} 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="card-menu-button" aria-label={`${card.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}><Pencil />수정</DropdownMenuItem>
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

function SortableColumn({ column, readOnly, queryText, onAddCard, onOpenCard, onRename, onDelete, onToggle, onDuplicateCard, onDeleteCard }: {
  column: BoardColumn;
  readOnly: boolean;
  queryText: string;
  onAddCard: () => void;
  onOpenCard: (card: BoardCard) => void;
  onRename: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDuplicateCard: (card: BoardCard) => void;
  onDeleteCard: (card: BoardCard) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: readOnly, data: { type: "column" } });
  const needle = queryText.trim().toLowerCase();
  const filteredCards = column.cards.filter((card) => !needle || `${card.title} ${card.body}`.toLowerCase().includes(needle));

  return (
    <article ref={setNodeRef} className={`column${column.collapsed ? " is-collapsed" : ""}${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <header className="column-header">
        {!readOnly && <button className="column-handle" aria-label={`${column.title} 칼럼 이동`} {...attributes} {...listeners}><GripVertical aria-hidden="true" /></button>}
        <button className="column-title" onClick={onToggle} aria-expanded={!column.collapsed}><strong>{column.title}</strong><span>{column.cards.length}</span></button>
        <button className="quiet-button" onClick={onToggle} aria-label={column.collapsed ? "칼럼 펼치기" : "칼럼 접기"}>{column.collapsed ? <PanelTopOpen aria-hidden="true" /> : <PanelTopClose aria-hidden="true" />}</button>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="quiet-button" aria-label={`${column.title} 메뉴`}><MoreHorizontal aria-hidden="true" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}><Pencil />이름 변경</DropdownMenuItem>
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
              {filteredCards.map((card) => <SortableCard key={card.id} card={card} readOnly={readOnly} onOpen={() => onOpenCard(card)} onDuplicate={() => onDuplicateCard(card)} onDelete={() => onDeleteCard(card)} />)}
              {needle && filteredCards.length === 0 && <p className="column-empty">일치하는 카드가 없습니다.</p>}
              {!needle && filteredCards.length === 0 && <p className="column-empty">{readOnly ? "카드가 없습니다." : "위의 + 를 눌러 첫 카드를 추가하세요."}</p>}
            </div>
          </SortableContext>
        </>
      )}
    </article>
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
  const boardsRef = useRef(boards);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? boards[0];
  const readOnly = Boolean(sharedToken);
  // 변경 표시와 저장 상태를 한 곳에서 바꿉니다. 저장 effect는 이 값만 보고 동작합니다.
  const markDirty = useCallback((boardId: string) => { setDirtyBoardId(boardId); setSaveStatus("saving"); }, []);

  useEffect(() => { boardsRef.current = boards; }, [boards]);
  useEffect(() => {
    // 주소의 ?share= 값은 브라우저에서만 읽을 수 있어 첫 렌더 뒤 한 번 동기화합니다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSharedToken(new URLSearchParams(window.location.search).get("share"));
    setRouteReady(true);
  }, []);

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
    setDraft({ columnId, title: "", body: "", attachments: [] });
    setLinkInput("");
    setEditorOpen(true);
  }
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
      if (draft.id) return { ...column, cards: column.cards.map((card) => card.id === draft.id ? { ...card, title: draft.title.trim(), body: draft.body.trim(), attachments: draft.attachments, link: draft.link, updatedAt: now } : card) };
      return { ...column, cards: [{ id: makeId("card"), title: draft.title.trim(), body: draft.body.trim(), attachments: draft.attachments, link: draft.link, createdAt: now, updatedAt: now }, ...column.cards] };
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
  function setSharing(enabled: boolean) { updateActiveBoard((board) => ({ ...board, shareEnabled: enabled, shareToken: enabled ? board.shareToken || makeShareToken() : board.shareToken })); }
  function regenerateShareLink() { updateActiveBoard((board) => ({ ...board, shareEnabled: true, shareToken: makeShareToken() })); toast.success("새 공유 링크를 만들었습니다."); }

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
            {activeBoard.columns.map((column) => <SortableColumn key={column.id} column={column} readOnly={readOnly} queryText={queryText} onAddCard={() => openNewCard(column.id)} onOpenCard={(card) => openCard(column.id, card)} onRename={() => {
              const title = window.prompt("새 칼럼 이름", column.title)?.trim();
              if (title) updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, title } : item) }));
            }} onDelete={() => setDeleteTarget({ kind: "column", id: column.id, title: column.title })} onToggle={() => updateActiveBoard((board) => ({ ...board, columns: board.columns.map((item) => item.id === column.id ? { ...item, collapsed: !item.collapsed } : item) }))} onDuplicateCard={(card) => duplicateCard(column.id, card)} onDeleteCard={(card) => setDeleteTarget({ kind: "card", id: card.id, columnId: column.id, title: card.title })} />)}
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
          <DialogHeader><DialogTitle>{draft?.id ? (readOnly ? "카드 보기" : "카드 수정") : "새 카드"}</DialogTitle><DialogDescription>{readOnly ? "공유된 카드의 내용입니다." : "글, 링크, 이미지, PDF를 한 카드에 담을 수 있습니다."}</DialogDescription></DialogHeader>
          {draft && <div className="editor-body">
            <label>제목<input value={draft.title} readOnly={readOnly} maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="무엇을 모아둘까요?" /></label>
            <label>내용<textarea value={draft.body} readOnly={readOnly} maxLength={3000} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="메모를 입력하세요" /></label>
            <section className="link-editor"><div className="section-label"><Link2 />링크</div>{!readOnly && <div className="link-input-row"><input value={linkInput} onChange={(event) => setLinkInput(event.target.value)} placeholder="https://..." /><button className="secondary-button" onClick={() => void fetchLinkPreview()} disabled={linkLoading}>{linkLoading && <LoaderCircle className="spin" />}미리보기</button></div>}{draft.link && <a className="link-preview" href={draft.link.url} target="_blank" rel="noreferrer">{draft.link.image && <img src={draft.link.image} alt="" />}<span><small>{isVideoUrl(draft.link.url) ? "동영상 링크 · 재생 없음" : draft.link.siteName}</small><strong>{draft.link.title}</strong><em>{draft.link.description}</em></span><ExternalLink /></a>}</section>
            <section><div className="section-label"><UploadCloud />첨부</div>{!readOnly && <button className="drop-zone" type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}>{uploading ? <LoaderCircle className="spin" /> : <UploadCloud />}<span>이미지 또는 PDF를 선택하거나 끌어 놓으세요.</span><small>{supabaseConfigured ? "파일당 최대 15MB" : "데모 모드 파일당 최대 2MB"} · 동영상 제외</small><input ref={fileInputRef} hidden type="file" multiple accept="image/*,application/pdf" onChange={(event) => event.target.files && void addFiles(event.target.files)} /></button>}
              {draft.attachments.length > 0 && <div className="attachment-grid">{draft.attachments.map((attachment) => <article className="attachment-item" key={attachment.id}>{attachment.kind === "image" ? <img src={attachment.url} alt={attachment.name} /> : <iframe title={attachment.name} src={`${attachment.url}#page=1&toolbar=0&navpanes=0`} />}<div><strong>{attachment.name}</strong><span>{attachment.kind === "pdf" ? "PDF" : "이미지"} · {formatBytes(attachment.size)}</span></div><a href={attachment.url} target="_blank" rel="noreferrer" aria-label={`${attachment.name} 열기`}><ExternalLink /></a>{!readOnly && <button onClick={() => deleteDraftAttachment(attachment)} aria-label={`${attachment.name} 삭제`}><X /></button>}</article>)}</div>}
            </section>
          </div>}
          <DialogFooter><button className="secondary-button" onClick={() => setEditorOpen(false)}>{readOnly ? "닫기" : "취소"}</button>{!readOnly && <button className="primary-button" onClick={saveDraft} disabled={uploading}>저장</button>}</DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="share-dialog"><DialogHeader><DialogTitle>보드 공유</DialogTitle><DialogDescription>링크를 가진 사람은 이 보드를 읽을 수 있습니다.</DialogDescription></DialogHeader><div className="share-switch-row"><div><strong>읽기 전용 링크</strong><span>{activeBoard.shareEnabled ? "공유 중" : "비공개"}</span></div><Switch checked={activeBoard.shareEnabled} onCheckedChange={setSharing} aria-label="읽기 전용 공유" /></div>{activeBoard.shareEnabled && <><div className="share-url"><input readOnly value={shareUrl} /><button onClick={() => { void navigator.clipboard.writeText(shareUrl); toast.success("공유 링크를 복사했습니다."); }}><Copy />복사</button></div><button className="text-button" onClick={regenerateShareLink}><RotateCcw />기존 링크를 끊고 새 링크 만들기</button>{!supabaseConfigured && <p className="share-warning">로컬 데모 링크는 이 브라우저에서만 확인할 수 있습니다.</p>}</>}</DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{deleteTarget?.title}을(를) 삭제할까요?</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.kind === "column" ? "칼럼 안의 카드도 함께 삭제됩니다." : "삭제 직후에는 실행 취소할 수 있습니다."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>취소</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>삭제</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>

      <Toaster position="bottom-center" />
    </main>
  );
}
