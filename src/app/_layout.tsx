import { AppProvider } from '@/context/AppContext';
import { AuthProvider, useAuth } from '@/firebase/AuthContext';
import { db } from '@/firebase/firebaseConfig';
import { Stack, useRouter, useSegments } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';

function RootLayoutNav() {
  const { user, loading, registeringRef } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [hasUsername, setHasUsername] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);

  useEffect(() => {
    if (!user) {
      setHasUsername(null);
      return;
    }

    // Si está registrando, ya tiene username — no consultar Firestore
    if (registeringRef.current) {
      registeringRef.current = false;
      setHasUsername(true);
      return;
    }

    setCheckingUsername(true);
    getDoc(doc(db, 'users', user.uid))
      .then(snap => {
        const data = snap.data();
        setHasUsername(!!(data?.username));
      })
      .catch(() => setHasUsername(true))
      .finally(() => setCheckingUsername(false));

  }, [user]);

  useEffect(() => {
    if (loading || checkingUsername) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inSetup = segments[0] === 'setup-username';

    if (!user && !inAuthGroup) {
      router.replace('/(auth)/login');
      return;
    }

    if (user && hasUsername === null) return;

    if (user && hasUsername === false && !inSetup) {
      router.replace('/setup-username');
      return;
    }

    if (user && hasUsername === true && (inAuthGroup || inSetup)) {
      router.replace('/(tabs)');
      return;
    }

  }, [user, loading, hasUsername, checkingUsername, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="setup-username" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <AppProvider>
        <RootLayoutNav />
      </AppProvider>
    </AuthProvider>
  );
}