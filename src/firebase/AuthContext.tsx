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
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
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

// Mismas reglas que firestore.rules (3 a 30 caracteres: minúsculas, números y _)
export const USERNAME_RE = /^[a-z0-9_]{3,30}$/;
const normalizeUsername = (u: string) => u.trim().toLowerCase();

const codedError = (code: string, message: string) => {
  const err: any = new Error(message);
  err.code = code;
  return err;
};

/**
 * Para usuarios creados antes del cambio: si tienen username en users/{uid}
 * pero no existe usernames/{username}, lo crea. Así pueden entrar por usuario.
 */
const ensureUsernameIndex = async (u: User) => {
  try {
    if (!u.email) return;
    const snap = await getDoc(doc(db, 'users', u.uid));
    const username = snap.data()?.username;
    if (!username) return;
    const idxRef = doc(db, 'usernames', username);
    const idx = await getDoc(idxRef);
    if (!idx.exists()) {
      await setDoc(idxRef, { uid: u.uid, email: u.email.toLowerCase() });
    }
  } catch (e) {
    console.warn('ensureUsernameIndex:', e);
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const registeringRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) void ensureUsernameIndex(u);
    });
    return unsub;
  }, []);

  const register = async (email: string, password: string, name: string, username: string) => {
    const uname = normalizeUsername(username);
    if (!USERNAME_RE.test(uname)) {
      throw codedError(
        'auth/invalid-username',
        'Usuario inválido: 3 a 30 caracteres, solo letras, números y _'
      );
    }

    // 1) ¿Está libre? (lectura puntual de un documento, no listado)
    const taken = await getDoc(doc(db, 'usernames', uname));
    if (taken.exists()) {
      throw codedError('auth/username-taken', 'El nombre de usuario ya está en uso');
    }

    registeringRef.current = true;
    try {
      // 2) Crear la cuenta
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name });
      const emailNorm = (cred.user.email ?? email).trim().toLowerCase();

      // 3) Guardar perfil + reservar el username de forma atómica
      const batch = writeBatch(db);
      batch.set(doc(db, 'users', cred.user.uid), {
        name,
        username: uname,
        email: emailNorm,
        monthlyIncome: 0,
        createdAt: new Date().toISOString(),
      });
      batch.set(doc(db, 'usernames', uname), { uid: cred.user.uid, email: emailNorm });

      try {
        await batch.commit();
      } catch (e: any) {
        // Alguien reservó el username justo ahora: deshacer la cuenta recién creada
        await cred.user.delete().catch(() => {});
        if (e?.code === 'permission-denied' || e?.code === 'already-exists') {
          throw codedError('auth/username-taken', 'El nombre de usuario ya está en uso');
        }
        throw e;
      }
    } catch (e) {
      registeringRef.current = false;
      throw e;
    }
  };

  const login = async (emailOrUsername: string, password: string) => {
    const value = emailOrUsername.trim();

    if (value.includes('@')) {
      await signInWithEmailAndPassword(auth, value, password);
      return;
    }

    // Login por usuario: se resuelve el correo desde usernames/{username}
    const uname = normalizeUsername(value);
    const snap = USERNAME_RE.test(uname) ? await getDoc(doc(db, 'usernames', uname)) : null;

    if (!snap || !snap.exists()) {
      // Mensaje neutro: no revelamos si el usuario existe o no
      throw codedError('auth/invalid-credential', 'Credenciales incorrectas');
    }
    await signInWithEmailAndPassword(auth, snap.data().email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const resetPassword = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
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