// 첨부 파일의 종류 판정과 다루는 규칙. 저장소·화면과 무관한 순수 함수라 따로 시험합니다.
// 서버의 clean_guest_attachments(supabase/schema.sql)도 같은 막는 확장자 목록을 씁니다.
import type { Attachment, AttachmentKind } from "./board-types";

// 내려받아 두 번 누르면 바로 실행되는 형식. 공유 링크로 아무나 올릴 수 있어 막습니다.
export const BLOCKED_EXTENSIONS = [
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "hta", "jar", "lnk", "reg",
  "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "apk", "app", "dmg", "pkg", "deb", "rpm", "sh",
];

// 뷰어 안에서 글로 보여 줄 수 있는 형식.
const TEXT_EXTENSIONS = ["txt", "csv", "tsv", "md", "json", "js", "ts", "css", "py", "java", "c", "cpp", "h", "xml", "yml", "yaml", "log", "sql", "ini"];

export function fileExtension(name: string): string {
  const match = name.trim().toLowerCase().match(/\.([a-z0-9]{1,10})$/);
  return match ? match[1] : "";
}

export function isBlockedFile(name: string): boolean {
  return BLOCKED_EXTENSIONS.includes(fileExtension(name));
}

// 이미지·PDF 는 지금처럼 미리보기를 그리고, 그 밖은 모두 "파일" 입니다.
// SVG 는 그림이지만 안에 스크립트를 담을 수 있어 파일로 다룹니다(내려받기 전용으로 저장).
export function attachmentKindOf(file: { type: string; name: string }): AttachmentKind {
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || (!type && fileExtension(file.name) === "pdf")) return "pdf";
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  return "file";
}

// 저장소에 올릴 때의 Content-Type. 파일은 모두 내려받기 전용(octet-stream)으로 저장해서, 누가 HTML 을 올려도
// 공개 주소에서 웹 페이지로 열리지 않게 합니다. 원래 형식은 첨부 정보의 mimeType 에 남습니다.
export function uploadContentType(file: { type: string; name: string }): string {
  return attachmentKindOf(file) === "file" ? "application/octet-stream" : file.type;
}

// 카드와 목록에 붙일 짧은 형식 표시. 확장자가 없으면 "파일".
export function fileBadge(name: string): string {
  const ext = fileExtension(name);
  return ext ? ext.toUpperCase().slice(0, 5) : "파일";
}

export function attachmentLabel(attachment: Pick<Attachment, "kind" | "name">): string {
  if (attachment.kind === "image") return "이미지";
  if (attachment.kind === "pdf") return "PDF";
  const badge = fileBadge(attachment.name);
  return badge === "파일" ? "파일" : `${badge} 파일`;
}

// 뷰어에서 어떻게 미리 볼지. html 은 격리된 칸에 웹 페이지로, text 는 글 그대로, null 은 내려받기만.
export function previewKindOf(attachment: Pick<Attachment, "kind" | "name">): "html" | "text" | null {
  if (attachment.kind !== "file") return null;
  const ext = fileExtension(attachment.name);
  if (ext === "html" || ext === "htm") return "html";
  if (TEXT_EXTENSIONS.includes(ext)) return "text";
  return null;
}

// 내려받기 주소. Supabase 공개 주소에 download 를 붙이면 원래 이름으로 저장되고, 데모의 데이터 URL 은 그대로 씁니다.
export function downloadUrl(attachment: Pick<Attachment, "url" | "name">): string {
  if (!/^https?:\/\//i.test(attachment.url) || !attachment.url.includes("/storage/v1/object/public/")) return attachment.url;
  const separator = attachment.url.includes("?") ? "&" : "?";
  return `${attachment.url}${separator}download=${encodeURIComponent(attachment.name)}`;
}
