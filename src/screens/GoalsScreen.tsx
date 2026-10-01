import { useApp } from '@/context/AppContext';
import React, { useState } from 'react';
import {
    Modal,
    ScrollView, StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useColorScheme,
    View
} from 'react-native';

export default function GoalsScreen() {
  const { goals, addGoal, updateGoal, deleteGoal } = useApp();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [addModal, setAddModal] = useState(false);
  const [depositModal, setDepositModal] = useState(false);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [target, setTarget] = useState('');
  const [depositAmt, setDepositAmt] = useState('');

  const goalColors = ['#185FA5','#639922','#BA7517','#993556','#0F6E56','#533AB7'];
  const [goalColor, setGoalColor] = useState(goalColors[0]);

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

  const handleAdd = () => {
    const tgt = parseFloat(target.replace(',', '.'));
    if (!name.trim()) return showAlert('Error', 'Ingresa un nombre');
    if (!tgt || tgt <= 0) return showAlert('Error', 'Ingresa una meta válida');
    addGoal({ name: name.trim(), emoji: emoji || '🎯', target: tgt, saved: 0, color: goalColor });
    setName(''); setEmoji(''); setTarget(''); setGoalColor(goalColors[0]);
    setAddModal(false);
  };

  const handleDeposit = () => {
    const amt = parseFloat(depositAmt.replace(',', '.'));
    if (!amt || amt <= 0) return showAlert('Error', 'Ingresa un monto válido');
    if (selectedGoal) updateGoal(selectedGoal, amt);
    setDepositAmt('');
    setDepositModal(false);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]}>
      <TouchableOpacity style={styles.addBtn} onPress={() => setAddModal(true)} activeOpacity={0.85}>
        <Text style={styles.addBtnText}>+ Nueva meta</Text>
      </TouchableOpacity>

      {goals.length === 0 && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>🎯</Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>
            No tienes metas aún.{'\n'}¡Crea tu primera meta de ahorro!
          </Text>
        </View>
      )}

      {goals.map(g => {
        const pct = g.target > 0 ? Math.min((g.saved / g.target) * 100, 100) : 0;
        const done = pct >= 100;
        return (
          <View key={g.id} style={[styles.card, { backgroundColor: colors.card }]}>
            <View style={styles.cardTop}>
              <Text style={styles.goalEmoji}>{g.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.goalName, { color: colors.text }]}>{g.name}</Text>
                <Text style={[styles.goalTarget, { color: colors.muted }]}>Meta: {fmt(g.target)}</Text>
              </View>
              {done
                ? <View style={styles.doneBadge}><Text style={styles.doneBadgeText}>✅ Logrado</Text></View>
                : <Text style={[styles.pctText, { color: g.color }]}>{Math.round(pct)}%</Text>
              }
            </View>

            <View style={[styles.progressBg, { backgroundColor: colors.border }]}>
              <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: g.color }]} />
            </View>

            <View style={styles.amtRow}>
              <Text style={[styles.savedAmt, { color: colors.text }]}>{fmt(g.saved)}</Text>
              <Text style={[styles.remainAmt, { color: colors.muted }]}>
                {done ? 'Meta alcanzada 🎉' : `faltan ${fmt(g.target - g.saved)}`}
              </Text>
            </View>

            <View style={styles.cardActions}>
              {!done && (
                <TouchableOpacity
                  style={[styles.depositBtn, { backgroundColor: g.color + '20', borderColor: g.color }]}
                  onPress={() => { setSelectedGoal(g.id); setDepositModal(true); }}
                >
                  <Text style={[styles.depositBtnText, { color: g.color }]}>+ Abonar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.deleteBtn, { borderColor: colors.border }]}
                onPress={() => showAlert('Eliminar', `¿Eliminar "${g.name}"?`, [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Eliminar', style: 'destructive', onPress: () => deleteGoal(g.id) },
                ])}
              >
                <Text style={{ color: colors.muted, fontSize: 13 }}>Eliminar</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Add goal modal */}
      <Modal visible={addModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Nueva meta de ahorro</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
              value={emoji} onChangeText={setEmoji}
              placeholder="Emoji (ej: ✈️)" placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
              value={name} onChangeText={setName}
              placeholder="Nombre de la meta" placeholderTextColor={colors.placeholder}
            />
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
              value={target} onChangeText={setTarget}
              placeholder="¿Cuánto quieres ahorrar?" placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
            <Text style={[styles.label, { color: colors.muted }]}>Color</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {goalColors.map(c => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setGoalColor(c)}
                  style={[styles.colorDot, { backgroundColor: c, borderWidth: goalColor === c ? 3 : 0, borderColor: '#fff' }]}
                />
              ))}
            </View>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.border }]} onPress={() => setAddModal(false)}>
                <Text style={{ color: colors.muted }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#185FA5', borderColor: '#185FA5' }]} onPress={handleAdd}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Crear meta</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Deposit modal */}
      <Modal visible={depositModal} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Abonar a meta</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
              value={depositAmt} onChangeText={setDepositAmt}
              placeholder="Monto a abonar" placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtn, { borderColor: colors.border }]} onPress={() => setDepositModal(false)}>
                <Text style={{ color: colors.muted }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#185FA5', borderColor: '#185FA5' }]} onPress={handleDeposit}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>Abonar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={{ height: 40 }} />
    </ScrollView>
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
  addBtn: { margin: 16, backgroundColor: '#185FA5', borderRadius: 14, padding: 14, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { fontSize: 15, textAlign: 'center', lineHeight: 22 },
  card: { marginHorizontal: 16, marginBottom: 12, borderRadius: 16, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  goalEmoji: { fontSize: 28 },
  goalName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  goalTarget: { fontSize: 12 },
  pctText: { fontSize: 20, fontWeight: '700' },
  doneBadge: { backgroundColor: '#EAF3DE', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  doneBadgeText: { fontSize: 12, color: '#3B6D11', fontWeight: '600' },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: 8, borderRadius: 4 },
  amtRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  savedAmt: { fontSize: 17, fontWeight: '700' },
  remainAmt: { fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 10 },
  depositBtn: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  depositBtnText: { fontSize: 14, fontWeight: '600' },
  deleteBtn: { borderWidth: 0.5, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: { borderWidth: 0.5, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '500', marginBottom: 8 },
  colorDot: { width: 30, height: 30, borderRadius: 15 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderWidth: 0.5, borderRadius: 10, padding: 14, alignItems: 'center' },
});
