import { useAuth } from '@/firebase/AuthContext';
import { auth, db } from '@/firebase/firebaseConfig';
import { signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Category = {
  id: string;
  name: string;
  emoji: string;
  color: string;
};

export type Expense = {
  id: string;
  amount: number;
  description: string;
  categoryId: string;
  date: string;
};

// ── NUEVO ──────────────────────────────────────────────
export type Income = {
  id: string;
  amount: number;
  description: string;
  date: string;
  type: 'income';
};
// ───────────────────────────────────────────────────────

export type SavingGoal = {
  id: string;
  name: string;
  emoji: string;
  target: number;
  saved: number;
  color: string;
};

export type UserProfile = {
  monthlyIncome: number;
  name: string;
};

type AppContextType = {
  categories: Category[];
  expenses: Expense[];
  incomes: Income[];                                          // NUEVO
  goals: SavingGoal[];
  userProfile: UserProfile;
  availableBalance: number;
  totalExpensesMonth: number;
  totalIncomesMonth: number;                                  // NUEVO
  addExpense: (e: Omit<Expense, 'id' | 'date'>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addIncome: (amount: number, description: string) => Promise<void>; // NUEVO
  deleteIncome: (id: string) => Promise<void>;               // NUEVO
  addGoal: (g: Omit<SavingGoal, 'id'>) => Promise<void>;
  updateGoal: (id: string, amount: number) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  renameCategory: (id: string, name: string, emoji: string) => Promise<void>;
  addCategory: (name: string, emoji: string, color: string) => Promise<void>;
  updateProfile: (profile: UserProfile) => Promise<void>;
  logout: () => Promise<void>;
};

const defaultCategories: Category[] = [
  { id: '1', name: 'Comida', emoji: '🍔', color: '#FF6B6B' },
  { id: '2', name: 'Transporte', emoji: '🚌', color: '#4ECDC4' },
  { id: '3', name: 'Hogar', emoji: '🏠', color: '#45B7D1' },
  { id: '4', name: 'Salud', emoji: '💊', color: '#96CEB4' },
  { id: '5', name: 'Ocio', emoji: '🎮', color: '#FFEAA7' },
  { id: '6', name: 'Ropa', emoji: '👕', color: '#DDA0DD' },
];

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>(defaultCategories);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);       // NUEVO
  const [goals, setGoals] = useState<SavingGoal[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ monthlyIncome: 0, name: '' });

  const totalExpensesMonth = useMemo(() => {
    const now = new Date();
    return expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses]);

  // NUEVO: suma de aportes del mes actual
  const totalIncomesMonth = useMemo(() => {
    const now = new Date();
    return incomes
      .filter(i => {
        const d = new Date(i.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, i) => sum + i.amount, 0);
  }, [incomes]);

  // NUEVO: el balance base (monthlyIncome) + aportes del mes - gastos
  const availableBalance = useMemo(() => {
    return Math.max(0, userProfile.monthlyIncome + totalIncomesMonth - totalExpensesMonth);
  }, [userProfile.monthlyIncome, totalIncomesMonth, totalExpensesMonth]);

  useEffect(() => {
    if (!user) {
      setExpenses([]);
      setIncomes([]);
      setGoals([]);
      setCategories(defaultCategories);
      setUserProfile({ monthlyIncome: 0, name: '' });
      return;
    }

    getDoc(doc(db, 'users', user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setUserProfile({
          monthlyIncome: data.monthlyIncome || 0,
          name: data.name || user.displayName || '',
        });
      }
    });

    const expQ = query(
      collection(db, 'users', user.uid, 'expenses'),
      orderBy('date', 'desc')
    );
    const unsubExp = onSnapshot(expQ, snap => {
      setExpenses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense)));
    });

    // NUEVO: listener en tiempo real para la colección incomes
    const incQ = query(
      collection(db, 'users', user.uid, 'incomes'),
      orderBy('date', 'desc')
    );
    const unsubInc = onSnapshot(incQ, snap => {
      setIncomes(snap.docs.map(d => ({ id: d.id, ...d.data() } as Income)));
    });

    const unsubGoal = onSnapshot(
      collection(db, 'users', user.uid, 'goals'),
      snap => setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as SavingGoal)))
    );

    const unsubCat = onSnapshot(
      collection(db, 'users', user.uid, 'categories'),
      snap => {
        if (snap.docs.length === 0) {
          defaultCategories.forEach(cat =>
            setDoc(doc(db, 'users', user.uid, 'categories', cat.id), cat)
          );
        } else {
          setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category)));
        }
      }
    );

    return () => { unsubExp(); unsubInc(); unsubGoal(); unsubCat(); };
  }, [user]);

  const addExpense = async (data: Omit<Expense, 'id' | 'date'>) => {
    if (!user) return;
    const id = Date.now().toString();
    await setDoc(doc(db, 'users', user.uid, 'expenses', id), {
      ...data, date: new Date().toISOString(),
    });
  };

  const deleteExpense = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'expenses', id));
  };

  // NUEVO: guarda el aporte en la colección incomes (el balance se recalcula automáticamente)
  const addIncome = async (amount: number, description: string) => {
    if (!user) return;
    const id = Date.now().toString();
    await setDoc(doc(db, 'users', user.uid, 'incomes', id), {
      amount,
      description,
      date: new Date().toISOString(),
      type: 'income',
    });
  };

  // NUEVO: elimina un aporte del historial
  const deleteIncome = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'incomes', id));
  };

  const addGoal = async (data: Omit<SavingGoal, 'id'>) => {
    if (!user) return;
    const id = Date.now().toString();
    await setDoc(doc(db, 'users', user.uid, 'goals', id), data);
  };

  const updateGoal = async (id: string, amount: number) => {
    if (!user) return;
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    const newSaved = Math.min(goal.saved + amount, goal.target);
    await updateDoc(doc(db, 'users', user.uid, 'goals', id), { saved: newSaved });
  };

  const deleteGoal = async (id: string) => {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'goals', id));
  };

  const renameCategory = async (id: string, name: string, emoji: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'categories', id), { name, emoji });
  };

  const addCategory = async (name: string, emoji: string, color: string) => {
    if (!user) return;
    const id = Date.now().toString();
    await setDoc(doc(db, 'users', user.uid, 'categories', id), { id, name, emoji, color });
  };

  const updateProfile = async (profile: UserProfile) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { monthlyIncome: profile.monthlyIncome });
    setUserProfile(profile);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AppContext.Provider value={{
      categories, expenses, incomes, goals, userProfile,
      availableBalance, totalExpensesMonth, totalIncomesMonth,
      addExpense, deleteExpense, addIncome, deleteIncome,
      addGoal, updateGoal, deleteGoal,
      renameCategory, addCategory, updateProfile, logout,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}