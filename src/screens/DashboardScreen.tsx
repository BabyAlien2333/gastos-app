import { useApp } from '@/context/AppContext';
import { showAlert } from '@/utils/alert';
import React, { useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useColorScheme,
  View
} from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

const PIE_SIZE = 200;
const PIE_CENTER = PIE_SIZE / 2;
const PIE_RADIUS = 80;
const PIE_INNER = 48;

function polarToXY(cx: number, cy: number, r: number, angle: number) {
  const rad = (angle - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildArc(cx: number, cy: number, r: number, inner: number, startAngle: number, endAngle: number) {
  const diff = endAngle - startAngle;
  if (diff >= 360) {
    const mid = startAngle + 180;
    const p1 = buildArc(cx, cy, r, inner, startAngle, mid);
    const p2 = buildArc(cx, cy, r, inner, mid, endAngle - 0.01);
    return p1 + ' ' + p2;
  }
  const large = diff > 180 ? 1 : 0;
  const s = polarToXY(cx, cy, r, startAngle);
  const e = polarToXY(cx, cy, r, endAngle);
  const si = polarToXY(cx, cy, inner, startAngle);
  const ei = polarToXY(cx, cy, inner, endAngle);
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} L ${ei.x} ${ei.y} A ${inner} ${inner} 0 ${large} 0 ${si.x} ${si.y} Z`;
}

export default function DashboardScreen() {
  const {
    expenses, goals, categories, userProfile,
    availableBalance, totalExpensesMonth, totalIncomesMonth,
    updateProfile, logout, addIncome,
  } = useApp();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [incomeModal, setIncomeModal] = useState(false);
  const [incomeInput, setIncomeInput] = useState('');
  const [userModal, setUserModal] = useState(false);

  // ── NUEVO: estado para el modal de aporte diario ──
  const [aportModal, setAportModal] = useState(false);
  const [aportAmount, setAportAmount] = useState('');
  const [aportDesc, setAportDesc] = useState('');
  // ──────────────────────────────────────────────────

  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  const monthExpenses = useMemo(() =>
    expenses.filter(e => {
      const d = new Date(e.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }), [expenses]);

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    monthExpenses.forEach(e => { map[e.categoryId] = (map[e.categoryId] || 0) + e.amount; });
    return Object.entries(map)
      .map(([id, amount]) => ({
        id, amount,
        cat: categories.find(c => c.id === id),
        pct: totalExpensesMonth > 0 ? (amount / totalExpensesMonth) * 100 : 0,
      }))
      .filter(x => x.cat)
      .sort((a, b) => b.amount - a.amount);
  }, [monthExpenses, categories, totalExpensesMonth]);

  const slices = useMemo(() => {
    let angle = 0;
    return byCategory.map(item => {
      const sweep = (item.pct / 100) * 360;
      const slice = { ...item, startAngle: angle, endAngle: angle + sweep };
      angle += sweep;
      return slice;
    });
  }, [byCategory]);

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

  // Balance total = ingreso base + aportes - gastos
  const totalBase = userProfile.monthlyIncome + totalIncomesMonth;
  const balancePct = totalBase > 0
    ? Math.round((availableBalance / totalBase) * 100)
    : 0;

  const handleSaveIncome = async () => {
    const num = parseFloat(incomeInput.replace(/\./g, '').replace(',', '.'));
    if (!num || num <= 0) return showAlert('Error', 'Ingresa un monto válido');
    await updateProfile({ ...userProfile, monthlyIncome: num });
    setIncomeInput('');
    setIncomeModal(false);
  };

  // NUEVO: guardar aporte diario
  const handleSaveAport = async () => {
    const num = parseFloat(aportAmount.replace(/\./g, '').replace(',', '.'));
    if (!num || num <= 0) return showAlert('Error', 'Ingresa un monto válido');
    if (!aportDesc.trim()) return showAlert('Error', 'Agrega una descripción');
    await addIncome(num, aportDesc.trim());
    setAportAmount('');
    setAportDesc('');
    setAportModal(false);
    showAlert('✅ Aporte registrado', `Se sumaron ${fmt(num)} a tu balance mensual`);
  };

  const handleLogout = () => {
    setUserModal(false);
    showAlert('Cerrar sesión', '¿Seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]} showsVerticalScrollIndicator={false}>

      {/* Balance header */}
      <View style={[styles.balanceCard, { backgroundColor: '#0C447C' }]}>
        <View style={styles.balanceTop}>
          <View>
            <Text style={styles.balanceLabel}>Saldo disponible</Text>
            <Text style={styles.balanceAmount}>{fmt(availableBalance)}</Text>
            {totalBase > 0 && (
              <Text style={styles.balanceSub}>
                {balancePct}% de tu ingreso total del mes
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={() => setUserModal(true)} style={styles.userBtn}>
            <Text style={{ fontSize: 22 }}>👤</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.balanceRow}>
          <View style={styles.balanceStat}>
            <Text style={styles.balanceStatLabel}>Base mensual</Text>
            <Text style={styles.balanceStatValue}>{fmt(userProfile.monthlyIncome)}</Text>
          </View>
          <View style={styles.balanceDivider} />
          {/* NUEVO: mostrar aportes del mes si hay */}
          {totalIncomesMonth > 0 && (
            <>
              <View style={styles.balanceStat}>
                <Text style={styles.balanceStatLabel}>Aportes</Text>
                <Text style={[styles.balanceStatValue, { color: '#4ECDC4' }]}>
                  +{fmt(totalIncomesMonth)}
                </Text>
              </View>
              <View style={styles.balanceDivider} />
            </>
          )}
          <View style={styles.balanceStat}>
            <Text style={styles.balanceStatLabel}>Gastado</Text>
            <Text style={styles.balanceStatValue}>{fmt(totalExpensesMonth)}</Text>
          </View>
          <TouchableOpacity
            style={styles.editIncomeBtn}
            onPress={() => { setIncomeInput(String(userProfile.monthlyIncome)); setIncomeModal(true); }}
          >
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>✏️ Editar</Text>
          </TouchableOpacity>
        </View>

        {totalBase > 0 && (
          <View style={styles.progressWrap}>
            <View style={styles.progressBg}>
              <View style={[
                styles.progressFill,
                {
                  width: `${Math.min((totalExpensesMonth / totalBase) * 100, 100)}%`,
                  backgroundColor: totalExpensesMonth > totalBase ? '#FF6B6B' : '#4ECDC4',
                }
              ]} />
            </View>
            {totalExpensesMonth > totalBase && (
              <Text style={styles.overBudget}>⚠️ Superaste tu presupuesto</Text>
            )}
          </View>
        )}

        {/* NUEVO: botón + Ingreso dentro del header */}
        <TouchableOpacity
          style={styles.aportBtn}
          onPress={() => setAportModal(true)}
        >
          <Text style={styles.aportBtnText}>＋ Registrar ingreso del día</Text>
        </TouchableOpacity>
      </View>

      {/* No income set */}
      {userProfile.monthlyIncome === 0 && (
        <TouchableOpacity
          style={[styles.setupCard, { backgroundColor: colors.card }]}
          onPress={() => setIncomeModal(true)}
        >
          <Text style={{ fontSize: 24 }}>💵</Text>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
              Configura tu ingreso mensual base
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
              Toca aquí para ingresar cuánto ganas de base
            </Text>
          </View>
          <Text style={{ color: '#185FA5', fontSize: 20 }}>→</Text>
        </TouchableOpacity>
      )}

      {/* Pie chart */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Gastos por categoría</Text>
        {byCategory.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.muted }]}>Aún no hay gastos este mes</Text>
        ) : (
          <>
            <View style={{ alignItems: 'center' }}>
              <Svg width={PIE_SIZE} height={PIE_SIZE}>
                <G>
                  {slices.map((s, i) => (
                    <Path
                      key={i}
                      d={buildArc(PIE_CENTER, PIE_CENTER, PIE_RADIUS, PIE_INNER, s.startAngle, s.endAngle)}
                      fill={s.cat?.color || '#ccc'}
                    />
                  ))}
                  <Circle cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_INNER} fill={colors.card} />
                  <SvgText x={PIE_CENTER} y={PIE_CENTER - 6} textAnchor="middle" fontSize="11" fill={colors.muted}>
                    Total
                  </SvgText>
                  <SvgText x={PIE_CENTER} y={PIE_CENTER + 12} textAnchor="middle" fontSize="13" fontWeight="600" fill={colors.text}>
                    {fmt(totalExpensesMonth)}
                  </SvgText>
                </G>
              </Svg>
            </View>
            {byCategory.map(item => (
              <View key={item.id} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: item.cat?.color }]} />
                <Text>{item.cat?.emoji}</Text>
                <Text style={[styles.legendName, { color: colors.text }]}>{item.cat?.name}</Text>
                <View style={styles.legendBar}>
                  <View style={[styles.legendFill, { width: `${item.pct}%`, backgroundColor: item.cat?.color }]} />
                </View>
                <Text style={[styles.legendPct, { color: colors.muted }]}>{Math.round(item.pct)}%</Text>
                <Text style={[styles.legendAmt, { color: colors.text }]}>{fmt(item.amount)}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Active goals */}
      {goals.length > 0 && (
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Metas activas</Text>
          {goals.slice(0, 3).map(g => {
            const pct = g.target > 0 ? (g.saved / g.target) * 100 : 0;
            return (
              <View key={g.id} style={styles.goalRow}>
                <Text style={styles.goalEmoji}>{g.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <View style={styles.goalHeader}>
                    <Text style={[styles.goalName, { color: colors.text }]}>{g.name}</Text>
                    <Text style={[styles.goalPct, { color: g.color }]}>{Math.round(pct)}%</Text>
                  </View>
                  <View style={[styles.progressBg2, { backgroundColor: colors.border }]}>
                    <View style={[styles.progressFill2, { width: `${pct}%`, backgroundColor: g.color }]} />
                  </View>
                  <Text style={[styles.goalSub, { color: colors.muted }]}>{fmt(g.saved)} de {fmt(g.target)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Modal: editar ingreso base mensual */}
      <Modal visible={incomeModal} transparent animationType="slide" onRequestClose={() => setIncomeModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.overlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>💵 Ingreso mensual base</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>
                    ¿Cuánto ganas de base al mes? Los aportes diarios se suman aparte.
                  </Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                    value={incomeInput}
                    onChangeText={setIncomeInput}
                    placeholder="Ej: 3000000"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handleSaveIncome}
                    autoFocus
                  />
                  <View style={styles.modalBtns}>
                    <TouchableOpacity
                      style={[styles.modalBtn, { borderColor: colors.border }]}
                      onPress={() => { Keyboard.dismiss(); setIncomeModal(false); }}
                    >
                      <Text style={{ color: colors.muted }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: '#185FA5', borderColor: '#185FA5' }]}
                      onPress={handleSaveIncome}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Guardar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* NUEVO: Modal de aporte diario */}
      <Modal visible={aportModal} transparent animationType="slide" onRequestClose={() => setAportModal(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.overlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>💰 Registrar ingreso</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>
                    Ingresa lo que ganaste hoy. Se sumará a tu saldo mensual y quedará registrado en el historial.
                  </Text>
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                    value={aportAmount}
                    onChangeText={setAportAmount}
                    placeholder="Monto ($)"
                    placeholderTextColor={colors.placeholder}
                    keyboardType="numeric"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    autoFocus
                  />
                  <TextInput
                    style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                    value={aportDesc}
                    onChangeText={setAportDesc}
                    placeholder="Descripción (ej: trabajo del día, venta, etc.)"
                    placeholderTextColor={colors.placeholder}
                    returnKeyType="done"
                    onSubmitEditing={handleSaveAport}
                  />
                  <View style={styles.modalBtns}>
                    <TouchableOpacity
                      style={[styles.modalBtn, { borderColor: colors.border }]}
                      onPress={() => { Keyboard.dismiss(); setAportModal(false); setAportAmount(''); setAportDesc(''); }}
                    >
                      <Text style={{ color: colors.muted }}>Cancelar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modalBtn, { backgroundColor: '#22c55e', borderColor: '#22c55e' }]}
                      onPress={handleSaveAport}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Confirmar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* User modal */}
      <Modal visible={userModal} transparent animationType="fade">
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => setUserModal(false)}
        >
          <View style={[styles.userModal, { backgroundColor: colors.card }]}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>👤</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 2 }}>
              {userProfile.name || 'Mi cuenta'}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 20 }}>
              Configuración de cuenta
            </Text>

            <TouchableOpacity
              style={[styles.userModalBtn, { borderColor: colors.border }]}
              onPress={() => {
                setUserModal(false);
                setIncomeInput(String(userProfile.monthlyIncome));
                setIncomeModal(true);
              }}
            >
              <Text style={{ fontSize: 18 }}>💵</Text>
              <Text style={{ fontSize: 14, color: colors.text }}>Editar ingreso mensual base</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.userModalBtn, { borderColor: '#22c55e' }]}
              onPress={() => { setUserModal(false); setAportModal(true); }}
            >
              <Text style={{ fontSize: 18 }}>💰</Text>
              <Text style={{ fontSize: 14, color: '#22c55e', fontWeight: '600' }}>Registrar ingreso del día</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.userModalBtn, { borderColor: '#FF3B30' }]}
              onPress={handleLogout}
            >
              <Text style={{ fontSize: 18 }}>🚪</Text>
              <Text style={{ fontSize: 14, color: '#FF3B30', fontWeight: '600' }}>Cerrar sesión</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function getColors(dark: boolean) {
  return {
    bg: dark ? '#0F0F0F' : '#F5F5F5',
    card: dark ? '#1C1C1E' : '#FFFFFF',
    text: dark ? '#FFFFFF' : '#1A1A1A',
    muted: dark ? '#8E8E93' : '#6B6B6B',
    border: dark ? '#2C2C2E' : '#E5E5EA',
    placeholder: dark ? '#48484A' : '#C7C7CC',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  balanceCard: { padding: 24, paddingTop: 20, marginBottom: 12 },
  balanceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  balanceLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  balanceAmount: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  balanceSub: { fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  userBtn: { padding: 8, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  balanceStat: {},
  balanceStatLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  balanceStatValue: { fontSize: 15, fontWeight: '700', color: '#fff' },
  balanceDivider: { width: 0.5, height: 30, backgroundColor: 'rgba(255,255,255,0.3)' },
  editIncomeBtn: { marginLeft: 'auto' as any, padding: 6, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)', borderRadius: 8 },
  progressWrap: { marginTop: 16 },
  progressBg: { height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  overBudget: { fontSize: 12, color: '#FF6B6B', marginTop: 6 },
  // NUEVO
  aportBtn: {
    marginTop: 16,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  aportBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  setupCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center' },
  section: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 14 },
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { fontSize: 12, width: 68 },
  legendBar: { flex: 1, height: 6, backgroundColor: '#E5E5EA', borderRadius: 3, overflow: 'hidden' },
  legendFill: { height: 6, borderRadius: 3 },
  legendPct: { fontSize: 11, width: 30, textAlign: 'right' },
  legendAmt: { fontSize: 12, fontWeight: '600', width: 72, textAlign: 'right' },
  goalRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 10 },
  goalEmoji: { fontSize: 22, marginTop: 2 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  goalName: { fontSize: 13, fontWeight: '500' },
  goalPct: { fontSize: 13, fontWeight: '600' },
  progressBg2: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
  progressFill2: { height: 6, borderRadius: 3 },
  goalSub: { fontSize: 11 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8 },
  modalInput: { borderWidth: 0.5, borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderWidth: 0.5, borderRadius: 10, padding: 14, alignItems: 'center' },
  userModal: {
    position: 'absolute', top: 90, right: 16,
    borderRadius: 20, padding: 20, width: 280,
    shadowColor: '#000', shadowOpacity: 0.25,
    shadowRadius: 12, elevation: 12,
    alignItems: 'center',
  },
  userModalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderWidth: 0.5, borderRadius: 12,
    marginBottom: 10, width: '100%',
  },
});