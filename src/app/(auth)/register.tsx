import { useAuth } from '@/firebase/AuthContext';
import { showAlert } from '@/utils/alert';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import {
  ActivityIndicator,
  KeyboardAvoidingView, Platform,
  ScrollView,
  StyleSheet,
  Text, TextInput, TouchableOpacity,
  useColorScheme,
  View
} from 'react-native';

export default function RegisterScreen() {
  const { register } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handleRegister = async () => {
    if (!name.trim() || !username.trim() || !email.trim() || !password || !confirm) {
      return showAlert('Error', 'Completa todos los campos');
    }
    if (username.trim().length < 3) {
      return showAlert('Error', 'El usuario debe tener al menos 3 caracteres');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return showAlert('Error', 'El usuario solo puede tener letras, números y guión bajo (_)');
    }
    if (password !== confirm) {
      return showAlert('Error', 'Las contraseñas no coinciden');
    }
    if (password.length < 6) {
      return showAlert('Error', 'La contraseña debe tener al menos 6 caracteres');
    }
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim(), username.trim());
    } catch (e: any) {
      const msg =
        e.code === 'auth/username-taken' ? 'Ese nombre de usuario ya está en uso' :
        e.code === 'auth/email-already-in-use' ? 'Este correo ya está registrado' :
        e.code === 'auth/invalid-email' ? 'Correo inválido' :
        e.code === 'auth/weak-password' ? 'Contraseña muy débil' :
        'Error al crear la cuenta: ' + (e.message || e.code || JSON.stringify(e));
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
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.emoji}>🚀</Text>
          <Text style={[styles.title, { color: colors.text }]}>Crear cuenta</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Empieza a controlar tus finanzas
          </Text>
        </View>

        <View style={styles.form}>
          {/* Nombre completo */}
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>👤</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={name}
              onChangeText={setName}
              placeholder="Nombre completo"
              placeholderTextColor={colors.placeholder}
            />
          </View>

          {/* Nombre de usuario */}
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>@</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={username}
              onChangeText={(t) => setUsername(t.replace(/\s/g, '').toLowerCase())}
              placeholder="Nombre de usuario (ej: juanperez)"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            Solo letras, números y _ · Mínimo 3 caracteres
          </Text>

          {/* Correo */}
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

          {/* Contraseña */}
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={password}
              onChangeText={setPassword}
              placeholder="Contraseña (mín. 6 caracteres)"
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showPass}
            />
            <TouchableOpacity onPress={() => setShowPass(!showPass)}>
              <Text style={{ fontSize: 18 }}>{showPass ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {/* Confirmar contraseña */}
          <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={styles.inputIcon}>🔒</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Confirmar contraseña"
              placeholderTextColor={colors.placeholder}
              secureTextEntry={!showPass}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, loading && { opacity: 0.7 }]}
            onPress={handleRegister}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Crear cuenta</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.loginBtn, { borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.loginText, { color: colors.text }]}>
              ¿Ya tienes cuenta?{' '}
              <Text style={{ color: '#185FA5', fontWeight: '700' }}>Inicia sesión</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
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
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { alignItems: 'center', marginBottom: 36 },
  emoji: { fontSize: 52, marginBottom: 14 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 15 },
  form: { gap: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderRadius: 14, paddingHorizontal: 16, height: 52,
  },
  inputIcon: { fontSize: 18 },
  input: { flex: 1, fontSize: 15 },
  hint: { fontSize: 11, marginTop: -6, paddingHorizontal: 4 },
  btn: {
    backgroundColor: '#185FA5', borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  loginBtn: { borderWidth: 0.5, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  loginText: { fontSize: 14 },
});