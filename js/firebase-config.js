// Firebase Configuration
// Replace these values with your actual Firebase config
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAhKe7HjrDVQPOrKT8XsTOKs1k3uBI5kEg",
  authDomain: "wows-inventory.firebaseapp.com",
  projectId: "wows-inventory",
  storageBucket: "wows-inventory.firebasestorage.app",
  messagingSenderId: "359501571165",
  appId: "1:359501571165:web:09e08736f1edd363cb59b4",
  measurementId: "G-QXHVBLET0H"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
