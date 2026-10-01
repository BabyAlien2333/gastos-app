import { useApp } from '@/context/AppContext';
import React, { useState } from 'react';
import {
    KeyboardAvoidingView, Modal, Platform, StyleSheet, Text,
    TextInput, TouchableOpacity, useColorScheme, View
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

export default function ExpensesScreen() {
  const { categories, addExpense, renameCategory, addCategory } = useApp();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const colors = getColors(dark);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCat, setSelectedCat] = useState(categories[0]?.id || '');

  const [editModal, setEditModal] = useState(false);
  const [editingCat, setEditingCat] = useState<{ id: string; name: string; emoji: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('');

  const [addCatModal, setAddCatModal] = useState(false);
  const [catName, setCatName] = useState('');
  const [catEmoji, setCatEmoji] = useState('');
  const catColors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#FF8C42','#6C5CE7'];
  const [catColor, setCatColor] = useState(catColors[0]);

  const handleSave = () => {
    const num = parseFloat(amount.replace(',', '.'));
    if (!num || num <= 0) return showAlert('Error', 'Ingresa un monto válido');
    if (!description.trim()) return showAlert('Error', 'Ingresa una descripción');
    if (!selectedCat) return showAlert('Error', 'Selecciona una categoría');
    addExpense({ amount: num, description: description.trim(), categoryId: selectedCat });
    setAmount('');
    setDescription('');
    showAlert('✅ Guardado', 'Gasto registrado correctamente');
  };

  const openEdit = (cat: { id: string; name: string; emoji: string }) => {
    setEditingCat(cat);
    setNewName(cat.name);
    setNewEmoji(cat.emoji);
    setEditModal(true);
  };

  const saveEdit = () => {
    if (editingCat && newName.trim()) {
      renameCategory(editingCat.id, newName.trim(), newEmoji || editingCat.emoji);
    }
    setEditModal(false);
  };

  const saveNewCat = () => {
    if (!catName.trim()) return showAlert('Error', 'Ingresa un nombre');
    addCategory(catName.trim(), catEmoji || '📌', catColor);
    setCatName(''); setCatEmoji(''); setCatColor(catColors[0]);
    setAddCatModal(false);
  };

  return (
    <>
      <KeyboardAwareScrollView
        style={[styles.container, { backgroundColor: colors.bg }]}
        keyboardShouldPersistTaps="handled"
        enableOnAndroid
        extraScrollHeight={Platform.OS === 'ios' ? 100 : 20}
        enableAutomaticScroll
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.muted }]}>Monto</Text>
          <View style={styles.amountRow}>
            <Text style={[styles.currency, { color: colors.text }]}>$</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.placeholder}
            />
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.muted }]}>Descripción</Text>
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={description}
            onChangeText={setDescription}
            placeholder="¿En qué gastaste?"
            placeholderTextColor={colors.placeholder}
            returnKeyType="done"
          />
        </View>

        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.catHeader}>
            <Text style={[styles.label, { color: colors.muted }]}>Categoría</Text>
            <TouchableOpacity onPress={() => setAddCatModal(true)}>
              <Text style={{ fontSize: 12, color: '#378ADD' }}>+ Nueva</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>Mantén presionado para renombrar</Text>
          <KeyboardAwareScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.catRow}>
              {categories.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => setSelectedCat(cat.id)}
                  onLongPress={() => openEdit(cat)}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: selectedCat === cat.id ? cat.color + '30' : colors.chipBg,
                      borderColor: selectedCat === cat.id ? cat.color : colors.border,
                      borderWidth: selectedCat === cat.id ? 1.5 : 0.5,
                    },
                  ]}
                >
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.catName, { color: selectedCat === cat.id ? cat.color : colors.text }]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </KeyboardAwareScrollView>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
          <Text style={styles.saveBtnText}>Guardar gasto</Text>
        </TouchableOpacity>

        <View style={{ height: 80 }} />
      </KeyboardAwareScrollView>

      {/* Edit category modal */}
      <Modal visible={editModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Renombrar etiqueta</Text>
              <TextInput
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                value={newEmoji}
                onChangeText={setNewEmoji}
                placeholder="Emoji (ej: 🎮)"
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                value={newName}
                onChangeText={setNewName}
                placeholder="Nombre de categoría"
                placeholderTextColor={colors.placeholder}
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={[styles.modalBtn, { borderColor: colors.border }]}
                  onPress={() => setEditModal(false)}
                >
                  <Text style={{ color: colors.muted }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                  onPress={saveEdit}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Guardar</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add category modal */}
      <Modal visible={addCatModal} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Nueva categoría</Text>
              <TextInput
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                value={catEmoji}
                onChangeText={setCatEmoji}
                placeholder="Emoji (ej: 🎵)"
                placeholderTextColor={colors.placeholder}
              />
              <TextInput
                style={[styles.modalInput, { color: colors.text, borderColor: colors.border }]}
                value={catName}
                onChangeText={setCatName}
                placeholder="Nombre"
                placeholderTextColor={colors.placeholder}
              />
              <Text style={[styles.label, { color: colors.muted, marginBottom: 8 }]}>Color</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {catColors.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCatColor(c)}
                    style={[
                      styles.colorDot,
                      { backgroundColor: c, borderWidth: catColor === c ? 3 : 0, borderColor: '#fff' },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={[styles.modalBtn, { borderColor: colors.border }]}
                  onPress={() => setAddCatModal(false)}
                >
                  <Text style={{ color: colors.muted }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnPrimary]}
                  onPress={saveNewCat}
                >
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Crear</Text>
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
    chipBg: dark ? '#2C2C2E' : '#F2F2F7',
    placeholder: dark ? '#48484A' : '#C7C7CC',
  };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16 },
  label: { fontSize: 12, fontWeight: '500', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  hint: { fontSize: 11, marginTop: -4 },
  amountRow: { flexDirection: 'row', alignItems: 'center' },
  currency: { fontSize: 28, fontWeight: '700', marginRight: 4 },
  amountInput: { fontSize: 36, fontWeight: '700', flex: 1 },
  input: { fontSize: 16, paddingVertical: 4 },
  catHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  catEmoji: { fontSize: 16 },
  catName: { fontSize: 13, fontWeight: '500' },
  saveBtn: { marginHorizontal: 16, marginTop: 20, backgroundColor: '#185FA5', borderRadius: 14, padding: 16, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalInput: { borderWidth: 0.5, borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 12 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderWidth: 0.5, borderRadius: 10, padding: 14, alignItems: 'center' },
  modalBtnPrimary: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  colorDot: { width: 32, height: 32, borderRadius: 16 },
});