import { initializeApp } from 'firebase/app';
import { getAuth, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: "AIzaSyAteR20fcn0s5Q2PIqmC5Dc6IcDDYzbh7k",
  authDomain: "gastos-app-c5d78.firebaseapp.com",
  projectId: "gastos-app-c5d78",
  storageBucket: "gastos-app-c5d78.firebasestorage.app",
  messagingSenderId: "853947915967",
  appId: "1:853947915967:web:7d145c36a2c846766a300a",
  measurementId: "G-RGN2BTX5DJ"
};

const app = initializeApp(firebaseConfig);

let auth: ReturnType<typeof getAuth>;

if (Platform.OS === 'web') {
  auth = initializeAuth(app, {
    persistence: indexedDBLocalPersistence,
  });
} else {
  const AsyncStorage = require('@react-native-async-storage/async-storage').default;
  const { getReactNativePersistence } = require('firebase/auth');
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
}

export { auth };
export const db = getFirestore(app);