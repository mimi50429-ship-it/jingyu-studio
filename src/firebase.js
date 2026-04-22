// ╔══════════════════════════════════════════════════════╗
// ║  請將下方替換成你自己的 Firebase 專案設定            ║
// ║  Firebase Console → 專案設定 → 你的應用程式         ║
// ╚══════════════════════════════════════════════════════╝
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            "AIzaSyAv8lQ72gj1_fhxkNe-qKvIvknAaKYhv3Q",
  authDomain:        "jingyu-studio.firebaseapp.com",
  databaseURL:       "https://jingyu-studio-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "jingyu-studio",
  storageBucket:     "jingyu-studio.firebasestorage.app",
  messagingSenderId: "554891928969",
  appId:             "1:554891928969:web:3fda6d85789badca49ed58",
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
