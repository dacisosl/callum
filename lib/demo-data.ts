import type { BoardData } from "./board-types";

const now = Date.now();

export const starterBoard: BoardData = {
  id: "starter-board",
  title: "자료 정리",
  shareEnabled: false,
  shareToken: "",
  createdAt: now,
  updatedAt: now,
  columns: [
    {
      id: "inbox",
      title: "수집함",
      collapsed: false,
      cards: [
        {
          id: "welcome-link",
          title: "먼저 모으고, 나중에 정리하세요",
          body: "링크를 붙여넣거나 이미지와 PDF를 끌어 놓을 수 있습니다.",
          attachments: [],
          link: {
            url: "https://supabase.com/docs",
            title: "Supabase 문서",
            description: "Postgres 기반 백엔드 서비스 안내",
            siteName: "Supabase",
          },
          createdAt: now - 4000,
          updatedAt: now - 4000,
        },
        {
          id: "welcome-image",
          title: "레퍼런스 이미지",
          body: "카드를 열어 이미지를 첨부해 보세요.",
          attachments: [],
          createdAt: now - 3000,
          updatedAt: now - 3000,
        },
      ],
    },
    {
      id: "working",
      title: "정리 중",
      collapsed: false,
      cards: [
        {
          id: "welcome-structure",
          title: "프로젝트 구조 초안",
          body: "보드 → 칼럼 → 카드 순서로 자료를 분류합니다. 카드와 칼럼은 손잡이를 잡고 옮길 수 있습니다.",
          attachments: [],
          createdAt: now - 2000,
          updatedAt: now - 2000,
        },
      ],
    },
    {
      id: "done",
      title: "완료",
      collapsed: false,
      cards: [
        {
          id: "welcome-backend",
          title: "Supabase 선택",
          body: "Postgres와 Storage를 사용하는 프로젝트 구조가 준비되었습니다.",
          attachments: [],
          createdAt: now - 1000,
          updatedAt: now - 1000,
        },
      ],
    },
  ],
};

export const cloneStarterBoard = (): BoardData =>
  JSON.parse(JSON.stringify(starterBoard)) as BoardData;
