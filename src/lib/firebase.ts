import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// Robust Firestore initialization
const db = (() => {
  try {
    const dbId = firebaseConfig.firestoreDatabaseId;
    if (dbId && dbId !== "(default)") {
      return initializeFirestore(app, { 
        ignoreUndefinedProperties: true 
      }, dbId);
    }
    return getFirestore(app);
  } catch (e) {
    console.error("Firestore initialization failed:", e);
    // Try one last time with default
    try {
      return getFirestore(app);
    } catch (finalErr) {
      console.error("Final Firestore fallback failed:", finalErr);
      throw finalErr;
    }
  }
})();

export { db };
export const auth = getAuth(app);

// Test connection silently
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified.");
  } catch (error) {
    console.warn("Firestore connection check (optional):", error);
  }
}
testConnection();
