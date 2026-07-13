import { auth, db } from '@/firebase/firebaseConfig';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import React, { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';

type AuthContextType = {
  user: User | null;
  loading: boolean;
  registeringRef: React.MutableRefObject<boolean>;
  register: (email: string, password: string, name: string, username: string) => Promise<void>;
  login: (emailOrUsername: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const registeringRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const register = async (email: string, password: string, name: string, username: string) => {
    registeringRef.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });

      const q = query(
        collection(db, 'users'),
        where('username', '==', username.toLowerCase().trim())
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        await cred.user.delete();
        registeringRef.current = false;
        const err: any = new Error('El nombre de usuario ya está en uso');
        err.code = 'auth/username-taken';
        throw err;
      }

      await setDoc(doc(db, 'users', cred.user.uid), {
        name,
        username: username.toLowerCase().trim(),
        email,
        monthlyIncome: 0,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      registeringRef.current = false;
      throw e;
    }
  };

  const login = async (emailOrUsername: string, password: string) => {
    const isEmail = emailOrUsername.includes('@');
    if (isEmail) {
      await signInWithEmailAndPassword(auth, emailOrUsername.trim(), password);
    } else {
      const q = query(
        collection(db, 'users'),
        where('username', '==', emailOrUsername.toLowerCase().trim())
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        const err: any = new Error('Usuario no encontrado');
        err.code = 'auth/user-not-found';
        throw err;
      }
      const userDoc = snap.docs[0].data();
      await signInWithEmailAndPassword(auth, userDoc.email, password);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  return (
    <AuthContext.Provider value={{ user, loading, registeringRef, register, login, logout, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}