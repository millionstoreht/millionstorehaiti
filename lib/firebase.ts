import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBrlB7fK-KOAJPt-tRlPNEwT95a-feGEFo",
  authDomain: "millionstorev2.firebaseapp.com",
  projectId: "millionstorev2",
  storageBucket: "millionstorev2.firebasestorage.app",
  messagingSenderId: "198386149357",
  appId: "1:198386149357:web:78f648c82bc68813f9e9e4"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
export const auth = getAuth(app);