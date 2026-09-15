// Firebase 웹 설정값은 비밀이 아닙니다. 접근 제어는 firestore.rules와
// storage.rules가 담당합니다. 값을 저장소에 두면 GitHub에서 코드를 고쳐도
// 별도 설정 없이 바로 빌드·배포됩니다. 환경 변수가 있으면 그 값이 우선합니다.
const defaults = {
  apiKey: "AIzaSyBjMMw5lUWc2W5VNiqnx09W81w_Zlvid7w",
  authDomain: "callum-board.firebaseapp.com",
  projectId: "callum-board",
  storageBucket: "callum-board.firebasestorage.app",
  messagingSenderId: "1093926288671",
  appId: "1:1093926288671:web:a24c148aa695d8cfc5c42a",
};

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || defaults.apiKey,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || defaults.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || defaults.projectId,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || defaults.storageBucket,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || defaults.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || defaults.appId,
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
