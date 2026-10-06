import { USERNAME_RE } from '@/firebase/AuthContext';
import { auth, db } from '@/firebase/firebaseConfig';
import { showAlert } from '@/utils/alert';
import { useRouter } from 'expo-router';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View
} from 'react-native';

export default function SetupUsernameScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const uname = username.trim().toLowerCase();

    if (!uname) {
      return showAlert('Error', 'Ingresa un nombre de usuario');
    }
    if (!USERNAME_RE.test(uname)) {
      return showAlert('Error', 'Usa de 3 a 30 caracteres: solo letras, números y guión bajo (_)');
    }

    setLoading(true);
    try {
      const current = auth.currentUser;
      if (!current || !current.email) throw new Error('No hay usuario autenticado');

      // ¿Está libre? (lectura puntual del documento)
      const taken = await getDoc(doc(db, 'usernames', uname));
      if (taken.exists()) {
        return showAlert('Error', 'Ese nombre de usuario ya está en uso');
      }

      // Guardar perfil + reservar username de forma atómica
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', current.uid), { username: uname });
      batch.set(doc(db, 'usernames', uname), {
        uid: current.uid,
        email: current.email.toLowerCase(),
      });
      await batch.commit();

      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('setup-username:', e);
      if (e?.code === 'permission-denied') {
        showAlert('Error', 'Ese nombre de usuario ya está en uso');
      } else {
        showAlert('Error', 'No se pudo guardar el usuario. Intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.emoji}>✨</Text>
          <Text style={[styles.title, { color: colors.text }]}>Elige tu usuario</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Elige un nombre de usuario único para identificarte. Podrás usarlo para iniciar sesión.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>@</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={username}
              onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
              placeholder="tunombredeusuario"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
              autoFocus
            />
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            Solo letras, números y _ · De 3 a 30 caracteres
          </Text>

          {username.length >= 3 && (
            <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.previewText, { color: colors.muted }]}>
                Tu usuario será:{' '}
                <Text style={{ color: '#185FA5', fontWeight: '700' }}>
                  @{username.toLowerCase()}
                </Text>
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleSave}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Confirmar usuario</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function getColors(dark: boolean) {
  return {
    bg: dark ? '#0F0F0F' : '#F5F5F5',
    card: dark ? '#1C1C1E' : '#FFFFFF',
    text: dark ? '#FFFFFF' : '#1A1A1A',
    muted: dark ? '#8E8E93' : '#6B6B6B',
    border: dark ? '#3A3A3C' : '#E5E5EA',
    placeholder: dark ? '#48484A' : '#C7C7CC',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  header: { alignItems: 'center', marginBottom: 40 },
  emoji: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 12 },
  subtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  form: { gap: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderRadius: 14, paddingHorizontal: 16, height: 52,
  },
  inputIcon: { fontSize: 18, fontWeight: '700' },
  input: { flex: 1, fontSize: 15 },
  hint: { fontSize: 11, marginTop: -6, paddingHorizontal: 4 },
  preview: {
    borderWidth: 0.5, borderRadius: 12, padding: 14, alignItems: 'center',
  },
  previewText: { fontSize: 14 },
  btn: {
    backgroundColor: '#185FA5', borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});