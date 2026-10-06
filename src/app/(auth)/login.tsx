import { useAuth } from '@/firebase/AuthContext';
import { showAlert } from '@/utils/alert';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View
} from 'react-native';

const isWeb = Platform.OS === 'web';

export default function LoginScreen() {
  const { login, resetPassword } = useAuth();
  const router = useRouter();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  // Focus states (solo se usan visualmente en web)
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // Modal restablecer contraseña
  const [resetModal, setResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      return showAlert('Error', 'Completa todos los campos');
    }
    setLoading(true);
    try {
      await login(identifier.trim(), password);
    } catch (e: any) {
      // El detalle técnico va a la consola, no al usuario
      console.error('login error:', e?.code, e?.message);
      const msg =
        e.code === 'auth/invalid-email' ? 'Correo inválido' :
        e.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera unos minutos e intenta de nuevo' :
        e.code === 'auth/network-request-failed' ? 'Sin conexión. Revisa tu internet' :
        // user-not-found, wrong-password e invalid-credential: mensaje único
        // para no revelar si la cuenta existe
        'Usuario o contraseña incorrectos';
      showAlert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    const email = resetEmail.trim();
    if (!email) {
      return showAlert('Error', 'Ingresa tu correo electrónico');
    }
    if (!email.includes('@')) {
      return showAlert('Error', 'Ingresa un correo válido');
    }
    setResetLoading(true);
    try {
      await resetPassword(email);
    } catch (e: any) {
      console.error('reset error:', e?.code, e?.message);
      if (e.code === 'auth/invalid-email') {
        setResetLoading(false);
        return showAlert('Error', 'Correo inválido');
      }
      if (e.code !== 'auth/user-not-found') {
        setResetLoading(false);
        return showAlert('Error', 'No se pudo enviar el correo. Intenta de nuevo');
      }
      // user-not-found: se trata igual que éxito para no revelar si la cuenta existe
    }
    setResetLoading(false);
    setResetModal(false);
    setResetEmail('');
    showAlert(
      '✅ Solicitud enviada',
      'Si ese correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada.'
    );
  };

  return (
    <>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.bg }, isWeb && styles.containerWeb]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.inner,
            isWeb && [styles.innerWeb, { backgroundColor: colors.card }],
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.emoji}>💰</Text>
            <Text style={[styles.title, { color: colors.text }]}>Bienvenido</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Inicia sesión para continuar
            </Text>
          </View>

          <View style={styles.form}>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: colors.card, borderColor: colors.border },
                isWeb && focusedInput === 'identifier' && styles.inputWrapFocusedWeb,
              ]}
            >
              <Text style={styles.inputIcon}>👤</Text>
              <TextInput
                style={[styles.input, { color: colors.text }, isWeb && styles.inputWeb]}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="Usuario o correo electrónico"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                keyboardType={identifier.includes('@') ? 'email-address' : 'default'}
                onFocus={() => setFocusedInput('identifier')}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <View
              style={[
                styles.inputWrap,
                { backgroundColor: colors.card, borderColor: colors.border },
                isWeb && focusedInput === 'password' && styles.inputWrapFocusedWeb,
              ]}
            >
              <Text style={styles.inputIcon}>🔒</Text>
              <TextInput
                style={[styles.input, { color: colors.text }, isWeb && styles.inputWeb]}
                value={password}
                onChangeText={setPassword}
                placeholder="Contraseña"
                placeholderTextColor={colors.placeholder}
                secureTextEntry={!showPass}
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
              />
              <TouchableOpacity onPress={() => setShowPass(!showPass)}>
                <Text style={{ fontSize: 18 }}>{showPass ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            {/* Olvidé mi contraseña */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => setResetModal(true)}
            >
              <Text style={[styles.forgotText, { color: '#185FA5' }]}>
                ¿Olvidaste tu contraseña?
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, isWeb && styles.btnWeb, loading && { opacity: 0.7 }]}
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
              style={[styles.registerBtn, { borderColor: colors.border }, isWeb && styles.registerBtnWeb]}
              onPress={() => router.push('/register')}
            >
              <Text style={[styles.registerText, { color: colors.text }]}>
                ¿No tienes cuenta?{' '}
                <Text style={{ color: '#185FA5', fontWeight: '700' }}>Regístrate</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Modal restablecer contraseña */}
      <Modal visible={resetModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={[styles.modalOverlay, isWeb && styles.modalOverlayWeb]}>
            <View style={[styles.modalBox, { backgroundColor: colors.card }, isWeb && styles.modalBoxWeb]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Restablecer contraseña
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
                Ingresa tu correo registrado y te enviaremos un link para restablecer tu contraseña.
              </Text>
              <View style={[styles.inputWrap, { backgroundColor: colors.bg, borderColor: colors.border, marginBottom: 16 }]}>
                <Text style={styles.inputIcon}>✉️</Text>
                <TextInput
                  style={[styles.input, { color: colors.text }, isWeb && styles.inputWeb]}
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  placeholder="Correo electrónico"
                  placeholderTextColor={colors.placeholder}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoFocus
                />
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={[styles.modalBtn, { borderColor: colors.border }]}
                  onPress={() => { setResetModal(false); setResetEmail(''); }}
                >
                  <Text style={{ color: colors.muted }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnPrimary, resetLoading && { opacity: 0.7 }]}
                  onPress={handleReset}
                  disabled={resetLoading}
                >
                  {resetLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '600' }}>Enviar</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
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

// Las propiedades que solo existen en web (100vh, boxShadow en string, outline, cursor)
// llevan "as any" para que TypeScript no rompa el tipo de TODO el StyleSheet.
const styles = StyleSheet.create({
  container: { flex: 1 },
  // Web: fondo de página completo, contenido centrado vertical y horizontalmente
  containerWeb: {
    minHeight: '100vh' as any,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  // Web: convierte el formulario en tarjeta flotante centrada con sombra
  innerWeb: {
    flex: 0,
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    paddingVertical: 44,
    paddingHorizontal: 36,
    boxShadow: '0 8px 30px rgba(0,0,0,0.08)' as any,
  },
  header: { alignItems: 'center', marginBottom: 40 },
  emoji: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 15 },
  form: { gap: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 0.5, borderRadius: 14, paddingHorizontal: 16, height: 52,
  },
  // Web: resalta el input activo con borde azul, imitando focus moderno
  inputWrapFocusedWeb: {
    borderColor: '#185FA5',
    borderWidth: 1.5,
  },
  inputIcon: { fontSize: 18 },
  input: { flex: 1, fontSize: 15 },
  // Web: quita el contorno azul feo del navegador al hacer focus
  inputWeb: {
    outlineStyle: 'none' as any,
  },
  forgotBtn: { alignSelf: 'flex-end', marginTop: -4 },
  forgotText: { fontSize: 13, fontWeight: '500' },
  btn: {
    backgroundColor: '#185FA5', borderRadius: 14,
    height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 4,
  },
  // Web: cursor de mano al pasar sobre el botón
  btnWeb: {
    cursor: 'pointer' as any,
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flex: 1, height: 0.5 },
  dividerText: { fontSize: 13 },
  registerBtn: { borderWidth: 0.5, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center' },
  registerBtnWeb: {
    cursor: 'pointer' as any,
  },
  registerText: { fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Web: centra el modal en vez de pegarlo abajo
  modalOverlayWeb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalBoxWeb: {
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)' as any,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  modalSubtitle: { fontSize: 13, marginBottom: 16, lineHeight: 18 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderWidth: 0.5, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalBtnPrimary: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
});