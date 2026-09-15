# Callum Board

링크, 이미지, PDF를 칼럼으로 정리하는 개인용 보드입니다. Next.js로 만들었고 Firebase Authentication, Cloud Firestore, Cloud Storage를 사용합니다. 배포는 Firebase App Hosting으로 합니다.

- Firebase 프로젝트: `callum-board`
- 저장소: https://github.com/dacisosl/callum

## 주요 기능

- 여러 보드와 칼럼 생성·이름 변경·삭제
- 카드 작성·수정·복제·삭제
- 카드의 칼럼 내부 정렬, 칼럼 간 이동, 칼럼 순서 변경
- 이미지와 PDF 첨부 및 미리보기
- 링크 제목·설명·대표 이미지 미리보기
- 카드 검색, 칼럼 접기, 자동 저장, 이동·삭제 실행 취소
- 보드별 읽기 전용 공유 링크
- 모바일 터치와 키보드 드래그 조작
- 동영상 파일 업로드 차단, 동영상 URL은 일반 링크로 표시

## 로컬 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

Firebase 설정값은 `lib/firebase-config.ts`에 들어 있어 별도 준비 없이 바로 연결됩니다. 웹 API 키는 비밀이 아니며 접근 제어는 `firestore.rules`와 `storage.rules`가 담당합니다. 다른 Firebase 프로젝트를 쓰려면 `.env.local`에 `NEXT_PUBLIC_FIREBASE_*` 값을 넣으면 그 값이 우선합니다.

## Firebase 콘솔 준비

아래 항목은 콘솔에서 한 번만 설정하면 됩니다.

1. **요금제**: Blaze 종량제로 업그레이드합니다. Cloud Storage와 App Hosting에 필요합니다.
2. **Authentication**: Sign-in method에서 이메일/비밀번호를 사용 설정합니다.
3. **Firestore Database**: 데이터베이스를 만듭니다. 위치는 `asia-northeast3`(서울)를 권장합니다.
4. **Storage**: 시작하기를 눌러 기본 버킷을 만듭니다.

## 보안 규칙 배포

Firestore와 Storage를 만든 뒤 실행합니다.

```bash
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

규칙을 배포하기 전에는 실제 자료를 올리지 마세요.

## 배포

Firebase App Hosting이 GitHub `main` 브랜치를 지켜보다가 push가 들어오면 자동으로 빌드하고 배포합니다. 콘솔의 App Hosting에서 `dacisosl/callum` 저장소를 연결하면 됩니다. 실행 설정은 `apphosting.yaml`에 있습니다.

GitHub 웹에서 코드를 고쳐 커밋하면 그대로 배포까지 이어집니다.

## 파일 제한

- 파일당 최대 15MB
- 허용 형식: 이미지, PDF
- 동영상 파일은 선택 단계와 업로드 처리 단계에서 거부됩니다

## 공유 방식

공유를 켜면 Firestore의 `shareEnabled`와 무작위 `shareToken`으로 읽기 전용 보드를 찾습니다. 공유를 끄거나 링크를 재발급하면 기존 보드 링크는 더 이상 조회되지 않습니다.

첨부 미리보기는 Cloud Storage의 다운로드 URL을 사용합니다. 이 URL은 자체 토큰으로 열리므로, 공유 링크를 받은 사람이 이미 알아낸 개별 파일 주소까지 즉시 막아야 한다면 Cloud Functions 프록시나 파일 토큰 폐기를 따로 붙여야 합니다.

## 검증 명령

```bash
npx tsc --noEmit
npm run build
```

## 프로젝트 구조

- `app/board-app.tsx`: 보드 UI와 상호작용 전체
- `app/api/link-preview/route.ts`: 링크 메타데이터 수집
- `lib/firebase-client.ts`: Firebase 인증·DB·파일 저장 연결
- `lib/firebase-config.ts`: Firebase 웹 설정값
- `lib/board-types.ts`: 데이터 형식
- `firestore.rules`: 보드 읽기·쓰기 규칙
- `storage.rules`: 첨부파일 접근 규칙
- `apphosting.yaml`: App Hosting 실행 설정
