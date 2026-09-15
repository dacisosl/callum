"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";
import type { Attachment, BoardData } from "./board-types";
import { firebaseConfig, firebaseConfigured } from "./firebase-config";

function services() {
  if (!firebaseConfigured) throw new Error("Firebase 설정값이 없습니다.");
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return {
    auth: getAuth(app),
    db: getFirestore(app),
    storage: getStorage(app),
  };
}

export function observeUser(callback: (user: User | null) => void) {
  return onAuthStateChanged(services().auth, callback);
}

export async function login(email: string, password: string) {
  return signInWithEmailAndPassword(services().auth, email, password);
}

export async function register(email: string, password: string) {
  return createUserWithEmailAndPassword(services().auth, email, password);
}

export async function logout() {
  return signOut(services().auth);
}

export async function loadOwnedBoards(ownerId: string): Promise<BoardData[]> {
  const boardsQuery = query(
    collection(services().db, "boards"),
    where("ownerId", "==", ownerId),
  );
  const snapshot = await getDocs(boardsQuery);
  return snapshot.docs
    .map((item) => item.data() as BoardData)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSharedBoard(token: string): Promise<BoardData | null> {
  const boardsQuery = query(
    collection(services().db, "boards"),
    where("shareToken", "==", token),
    where("shareEnabled", "==", true),
    limit(1),
  );
  const snapshot = await getDocs(boardsQuery);
  return snapshot.empty ? null : (snapshot.docs[0].data() as BoardData);
}

export async function saveBoard(board: BoardData, ownerId: string) {
  const payload: BoardData = {
    ...board,
    ownerId,
    updatedAt: Date.now(),
  };
  await setDoc(doc(services().db, "boards", board.id), payload);
  return payload;
}

export async function removeBoard(board: BoardData, ownerId: string) {
  if (board.ownerId && board.ownerId !== ownerId) {
    throw new Error("이 보드를 삭제할 권한이 없습니다.");
  }
  const storage = services().storage;
  const paths = board.columns.flatMap((column) =>
    column.cards.flatMap((card) =>
      card.attachments.map((attachment) => attachment.storagePath).filter(Boolean),
    ),
  ) as string[];
  await Promise.allSettled(paths.map((path) => deleteObject(ref(storage, path))));
  await deleteDoc(doc(services().db, "boards", board.id));
}

export async function uploadAttachment(
  file: File,
  ownerId: string,
  boardId: string,
  attachmentId: string,
): Promise<Attachment> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._가-힣-]/g, "-");
  const storagePath = `users/${ownerId}/boards/${boardId}/${attachmentId}-${safeName}`;
  const objectRef = ref(services().storage, storagePath);
  await uploadBytes(objectRef, file, {
    contentType: file.type,
    customMetadata: { boardId, ownerId },
  });
  const url = await getDownloadURL(objectRef);
  return {
    id: attachmentId,
    name: file.name,
    kind: file.type === "application/pdf" ? "pdf" : "image",
    mimeType: file.type,
    size: file.size,
    url,
    storagePath,
  };
}

export async function removeAttachment(path?: string) {
  if (!path) return;
  await deleteObject(ref(services().storage, path));
}
