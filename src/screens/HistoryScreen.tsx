import { useApp } from '@/context/AppContext';
import React, { useMemo, useState } from 'react';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useColorScheme,
    View
} from 'react-native';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// Tipo unificado para el historial
type HistoryItem =
  | { kind: 'expense'; id: string; amount: number; description: string; categoryId: string; date: string }
  | { kind: 'income';  id: string; amount: number; description: string; date: string };

export default function HistoryScreen() {
  const { expenses, incomes, categories, deleteExpense, deleteIncome } = useApp();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear] = useState(now.getFullYear());

  // Unir gastos e ingresos del mes seleccionado en una lista ordenada por fecha
  const filtered = useMemo<HistoryItem[]>(() => {
    const exp: HistoryItem[] = expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
      })
      .map(e => ({ kind: 'expense', ...e }));

    const inc: HistoryItem[] = incomes
      .filter(i => {
        const d = new Date(i.date);
        return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
      })
      .map(i => ({ kind: 'income', id: i.id, amount: i.amount, description: i.description, date: i.date }));

    return [...exp, ...inc].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [expenses, incomes, selectedMonth, selectedYear]);

  // Totales del mes: gastos netos e ingresos acumulados
  const totalExpenses = useMemo(
    () => filtered.filter(i => i.kind === 'expense').reduce((s, i) => s + i.amount, 0),
    [filtered]
  );
  const totalIncomes = useMemo(
    () => filtered.filter(i => i.kind === 'income').reduce((s, i) => s + i.amount, 0),
    [filtered]
  );

  // Agrupar por día
  const grouped = useMemo(() => {
    const map: Record<string, HistoryItem[]> = {};
    filtered.forEach(item => {
      const key = new Date(item.date).toDateString();
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    return Object.entries(map).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [filtered]);

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');
  const fmtDate = (d: string) => {
    const date = new Date(d);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hoy';
    if (date.toDateString() === yesterday.toDateString()) return 'Ayer';
    return `${date.getDate()} de ${MONTHS[date.getMonth()]}`;
  };
  const fmtTime = (d: string) => {
    const date = new Date(d);
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  const handleLongPress = (item: HistoryItem) => {
    if (item.kind === 'expense') {
      showAlert('Eliminar gasto', `¿Eliminar "${item.description}"?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteExpense(item.id) },
      ]);
    } else {
      showAlert('Eliminar aporte', `¿Eliminar el aporte "${item.description}" de ${fmt(item.amount)}?\nEsto restará el monto de tu balance.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Eliminar', style: 'destructive', onPress: () => deleteIncome(item.id) },
      ]);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Month selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthScroll}>
        <View style={styles.monthRow}>
          {Array.from({ length: 6 }, (_, i) => {
            const m = (now.getMonth() - (5 - i) + 12) % 12;
            return (
              <TouchableOpacity
                key={m}
                onPress={() => setSelectedMonth(m)}
                style={[
                  styles.monthChip,
                  { backgroundColor: selectedMonth === m ? '#185FA5' : colors.chipBg, borderColor: selectedMonth === m ? '#185FA5' : colors.border },
                ]}
              >
                <Text style={[styles.monthChipText, { color: selectedMonth === m ? '#fff' : colors.muted }]}>
                  {MONTHS[m].slice(0, 3)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Summary: ahora muestra gastos e ingresos por separado */}
      <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
        <View>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>{MONTHS[selectedMonth]}</Text>
          <Text style={[styles.summaryTotal, { color: '#E24B4A' }]}>-{fmt(totalExpenses)}</Text>
          <Text style={[styles.summarySubLabel, { color: colors.muted }]}>en gastos</Text>
        </View>
        {totalIncomes > 0 && (
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.summaryLabel, { color: colors.muted }]}>Aportes</Text>
            <Text style={[styles.summaryTotal, { color: '#22c55e' }]}>+{fmt(totalIncomes)}</Text>
          </View>
        )}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Movimientos</Text>
          <Text style={[styles.summaryCount, { color: colors.text }]}>{filtered.length}</Text>
        </View>
      </View>

      {filtered.length === 0 && (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={[styles.emptyText, { color: colors.muted }]}>Sin movimientos este mes</Text>
        </View>
      )}

      {grouped.map(([dateKey, items]) => {
        const dayExpenses = items.filter(i => i.kind === 'expense').reduce((s, i) => s + i.amount, 0);
        const dayIncomes  = items.filter(i => i.kind === 'income').reduce((s, i) => s + i.amount, 0);
        return (
          <View key={dateKey}>
            <View style={styles.dateHeader}>
              <Text style={[styles.dateText, { color: colors.muted }]}>{fmtDate(items[0].date)}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {dayIncomes > 0 && (
                  <Text style={[styles.dateTotalText, { color: '#22c55e' }]}>+{fmt(dayIncomes)}</Text>
                )}
                {dayExpenses > 0 && (
                  <Text style={[styles.dateTotalText, { color: colors.muted }]}>-{fmt(dayExpenses)}</Text>
                )}
              </View>
            </View>
            <View style={[styles.groupCard, { backgroundColor: colors.card }]}>
              {items.map((item, idx) => {
                const isIncome = item.kind === 'income';
                const cat = !isIncome && item.kind === 'expense'
                  ? categories.find(c => c.id === item.categoryId)
                  : null;

                return (
                  <TouchableOpacity
                    key={item.id}
                    onLongPress={() => handleLongPress(item)}
                    activeOpacity={0.7}
                    style={[
                      styles.expenseRow,
                      idx < items.length - 1 && { borderBottomWidth: 0.5, borderBottomColor: colors.border },
                    ]}
                  >
                    {/* Ícono: verde con 💰 para aportes, categoría para gastos */}
                    <View style={[
                      styles.catCircle,
                      { backgroundColor: isIncome ? '#22c55e25' : ((cat?.color || '#ccc') + '25') },
                    ]}>
                      <Text style={styles.catEmoji}>
                        {isIncome ? '💰' : (cat?.emoji || '📌')}
                      </Text>
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={[styles.expDesc, { color: colors.text }]} numberOfLines={1}>
                        {item.description}
                      </Text>
                      <Text style={[styles.expMeta, { color: colors.muted }]}>
                        {isIncome ? 'Ingreso del día' : (cat?.name || 'Sin categoría')} · {fmtTime(item.date)}
                      </Text>
                    </View>

                    {/* Monto: verde con + para aportes, rojo con - para gastos */}
                    <Text style={[styles.expAmt, { color: isIncome ? '#22c55e' : '#E24B4A' }]}>
                      {isIncome ? '+' : '-'}{fmt(item.amount)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      <Text style={[styles.hint, { color: colors.muted }]}>Mantén presionado para eliminar un movimiento</Text>
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
    chipBg: dark ? '#2C2C2E' : '#F2F2F7',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  monthScroll: { paddingVertical: 12 },
  monthRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  monthChip: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 0.5 },
  monthChipText: { fontSize: 13, fontWeight: '500' },
  summaryCard: {
    marginHorizontal: 16, marginBottom: 12, borderRadius: 16,
    padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  summaryLabel: { fontSize: 12, marginBottom: 4 },
  summarySubLabel: { fontSize: 11, marginTop: 2 },
  summaryTotal: { fontSize: 22, fontWeight: '700' },
  summaryCount: { fontSize: 24, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 10 },
  emptyText: { fontSize: 15 },
  dateHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 6,
  },
  dateText: { fontSize: 12, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  dateTotalText: { fontSize: 12, fontWeight: '600' },
  groupCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 16, overflow: 'hidden' },
  expenseRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  catCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  catEmoji: { fontSize: 18 },
  expDesc: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  expMeta: { fontSize: 12 },
  expAmt: { fontSize: 15, fontWeight: '700' },
  hint: { textAlign: 'center', fontSize: 11, marginTop: 8, marginBottom: 4 },
});