# Pillar

링크, 이미지, PDF를 칼럼으로 정리하는 개인용 보드입니다. Firebase 설정이 없으면 브라우저의 로컬 데모 모드로 실행되고, 설정을 추가하면 Firebase Authentication, Cloud Firestore, Cloud Storage를 사용합니다.

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

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. Firebase 설정이 없는 상태에서는 로컬 데모 모드로 바로 사용할 수 있습니다. 데모 데이터는 현재 브라우저에만 저장됩니다.

## Firebase 연결

### 1. Firebase 프로젝트 준비

Firebase Console에서 프로젝트를 만든 뒤 아래 기능을 활성화합니다.

1. Authentication → Sign-in method → 이메일/비밀번호
2. Firestore Database → Standard 에디션
3. Storage

Cloud Storage for Firebase는 Blaze 종량제와 결제 계정 연결이 필요합니다. 무료 사용 구간을 적용하려면 지원되는 미국 리전을 선택하고 현재 Firebase 요금 조건을 다시 확인하세요.

### 2. 환경 변수 입력

`.env.example`을 `.env.local`로 복사하고 Firebase 웹 앱 설정값을 입력합니다.

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

환경 변수를 변경한 뒤 개발 서버를 다시 시작합니다.

### 3. 보안 규칙 배포

프로젝트에 포함된 `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `firebase.json`을 사용합니다.

```bash
npx firebase-tools login
npx firebase-tools use YOUR_PROJECT_ID
npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage
```

브라우저에서 Firebase에 직접 접근하므로 보안 규칙을 배포하기 전에 실제 자료를 올리지 마세요.

## 파일 제한

- Firebase 모드: 파일당 최대 15MB
- 로컬 데모 모드: 파일당 최대 2MB
- 허용 형식: 이미지, PDF
- 동영상 파일은 선택 단계와 업로드 처리 단계에서 거부됩니다.

## 공유 방식

공유를 켜면 Firestore의 `shareEnabled`와 무작위 `shareToken`으로 읽기 전용 보드를 찾습니다. 공유를 끄거나 링크를 재발급하면 기존 보드 링크는 더 이상 조회되지 않습니다.

현재 구현은 Firebase Storage의 다운로드 URL을 첨부 미리보기에 사용합니다. 공유 링크를 받은 사람이 이미 알아낸 개별 파일 URL까지 즉시 폐기해야 한다면, 다음 단계에서 Cloud Functions 프록시 또는 파일 토큰 폐기 작업을 추가해야 합니다.

## 검증 명령

```bash
npx tsc --noEmit
npm run build
```

## 프로젝트 구조

- `app/board-app.tsx`: 보드 UI와 상호작용
- `app/api/link-preview/route.ts`: 링크 메타데이터 수집
- `lib/firebase-client.ts`: Firebase 인증·DB·파일 저장 연결
- `lib/board-types.ts`: 데이터 형식
- `firestore.rules`: 보드 읽기·쓰기 규칙
- `storage.rules`: 첨부파일 접근 규칙
