import { useAuth } from '@/firebase/AuthContext';
import { showAlert } from '@/utils/alert';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView, Platform,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  useColorScheme,
  View
} from 'react-native';

export default function LoginScreen() {
  const { login } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      return showAlert('Error', 'Completa todos los campos');
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      const msg =
        e.code === 'auth/user-not-found' ? 'Usuario no encontrado' :
        e.code === 'auth/wrong-password' ? 'Contraseña incorrecta' :
        e.code === 'auth/invalid-email' ? 'Email inválido' :
        e.code === 'auth/invalid-credential' ? 'Credenciales incorrectas' :
        'Error al iniciar sesión';
      showAlert('Error', msg);
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
          <Text style={styles.emoji}>💰</Text>
          <Text style={[styles.title, { color: colors.text }]}>Bienvenido</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Inicia sesión para continuar
          </Text>
        </View>

        <View style={styles.form}>
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>✉️</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={email}
              onChangeText={setEmail}
              placeholder="Correo electrónico"
              placeholderTextColor={colors.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Contraseña"
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showPass}
            />
            <TouchableOpacity onPress={() => setShowPass(!showPass)}>
              <Text style={{ fontSize: 18 }}>{showPass ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Iniciar sesión</Text>
            }
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.muted }]}>o</Text>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[styles.registerBtn, { borderColor: colors.border }]}
            onPress={() => router.push('/register')}
          >
            <Text style={[styles.registerText, { color: colors.text }]}>
              ¿No tienes cuenta? <Text style={{ color: '#185FA5', fontWeight: '700' }}>Regístrate</Text>
            </Text>
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
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 15 },
  form: { gap: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderRadius: 14, paddingHorizontal: 16, height: 52,
  },
  inputIcon: { fontSize: 18 },
  input: { flex: 1, fontSize: 15 },
  btn: {
    backgroundColor: '#185FA5', borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 0.5 },
  dividerText: { fontSize: 13 },
  registerBtn: { borderWidth: 0.5, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  registerText: { fontSize: 14 },
});