import { showAlert } from '@/utils/alert';
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from "react-native";

const fmtHrs = (v) => {
  if (!v) return "0h";
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// Convierte hora "HH:MM" a número decimal (ej: "14:30" → 14.5)
const horaADecimal = (str) => {
  if (!str) return 0;
  const [h, m] = str.split(":").map(Number);
  return h + (m || 0) / 60;
};

// Calcula horas diurnas y nocturnas a partir de entrada/salida
// Diurno: 06:00 - 21:00 / Nocturno: 21:00 - 06:00
const calcHorasDiaNoche = (entrada, salida) => {
  const ini = horaADecimal(entrada);
  const fin = horaADecimal(salida) || 24;
  if (ini >= fin) return { dayHours: 0, nightHours: 0 };

  const INICIO_DIA   = 6;
  const FIN_DIA      = 21;

  let dayHours   = 0;
  let nightHours = 0;

  // Tramo de inicio a fin
  const diaIni = Math.max(ini, INICIO_DIA);
  const diaFin = Math.min(fin, FIN_DIA);
  if (diaFin > diaIni) dayHours = diaFin - diaIni;

  nightHours = (fin - ini) - dayHours;

  return {
    dayHours:   Math.round(dayHours   * 10) / 10,
    nightHours: Math.round(nightHours * 10) / 10,
  };
};

export default function ScheduleScanner({ days, onApply, onClose }) {
  const [image,       setImage]       = useState(null);
  const [base64,      setBase64]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [resultado,   setResultado]   = useState(null);
  const [preview,     setPreview]     = useState(false);

  const pickImage = async (fromCamera) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      showAlert("Permiso requerido", "Necesitamos acceso a " + (fromCamera ? "la cámara" : "tu galería"));
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setImage(asset.uri);
      // Si no viene base64 en el asset, lo leemos del archivo
      if (asset.base64) {
        setBase64(asset.base64);
      } else {
        const b64 = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        setBase64(b64);
      }
      setResultado(null);
    }
  };

  const interpretarHorario = async () => {
    if (!base64) return;
    setLoading(true);

    // Construimos el contexto de días disponibles para que Claude sepa qué llenar
    const diasDisponibles = days.map((d) => ({
      index: days.indexOf(d),
      label: d.label,
      dayOfWeek: new Date(d.year, d.month, d.day).toLocaleDateString("es-CO", { weekday: "long" }),
    }));

    const prompt = `Eres un asistente que interpreta horarios de trabajo colombianos.

Analiza la imagen de este horario y extrae la información de cada día de trabajo.

Los días disponibles en el período son:
${diasDisponibles.map((d) => `- Index ${d.index}: ${d.label} (${d.dayOfWeek})`).join("\n")}

Para cada día que aparezca en el horario extrae:
- El índice del día (del listado anterior)
- Si trabaja ese día (true/false)
- Si es día de descanso (true/false)
- Hora de entrada (formato HH:MM, 24h)
- Hora de salida (formato HH:MM, 24h)

Responde ÚNICAMENTE con un JSON válido con esta estructura exacta, sin texto adicional ni backticks:
{
  "dias": [
    {
      "index": 0,
      "worked": true,
      "descanso": false,
      "entrada": "08:00",
      "salida": "16:00"
    }
  ],
  "notas": "cualquier observación relevante del horario"
}

Si no puedes leer claramente un dato, omite ese día del array.
Si el horario muestra turnos rotativos, interprétalos según los días del período.`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64,
                },
              },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });

      const data = await response.json();
      const texto = data.content?.[0]?.text || "";

      // Limpiar posibles backticks o texto extra
      const jsonStr = texto.replace(/```json|```/g, "").trim();
      const parsed  = JSON.parse(jsonStr);

      // Enriquecer con horas calculadas
      const diasEnriquecidos = parsed.dias.map((d) => {
        const { dayHours, nightHours } = calcHorasDiaNoche(d.entrada, d.salida);
        return { ...d, dayHours, nightHours };
      });

      setResultado({ ...parsed, dias: diasEnriquecidos });
      setPreview(true);
    } catch (e) {
      showAlert(
        "Error al interpretar",
        "No se pudo leer el horario. Intenta con una foto más clara o con mejor iluminación.\n\nDetalle: " + e.message
      );
    } finally {
      setLoading(false);
    }
  };

  const aplicarResultado = () => {
    if (!resultado) return;
    onApply(resultado.dias);
    setPreview(false);
    onClose();
  };

  return (
    <View style={st.container}>
      <View style={st.header}>
        <TouchableOpacity onPress={onClose} style={st.closeBtn}>
          <Text style={st.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>📷 Escanear horario</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll}>
        {/* Instrucciones */}
        <View style={st.infoBox}>
          <Text style={st.infoTitle}>¿Cómo funciona?</Text>
          <Text style={st.infoText}>
            1. Toma o sube una foto de tu horario{"\n"}
            2. Claude lo interpreta automáticamente{"\n"}
            3. Revisa los resultados y aplica al calendario
          </Text>
        </View>

        {/* Botones de captura */}
        <View style={st.pickRow}>
          <TouchableOpacity style={st.pickBtn} onPress={() => pickImage(true)}>
            <Text style={st.pickIcon}>📸</Text>
            <Text style={st.pickLabel}>Tomar foto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.pickBtn} onPress={() => pickImage(false)}>
            <Text style={st.pickIcon}>🖼️</Text>
            <Text style={st.pickLabel}>Galería</Text>
          </TouchableOpacity>
        </View>

        {/* Preview imagen */}
        {image && (
          <View style={st.imageBox}>
            <Image source={{ uri: image }} style={st.image} resizeMode="contain" />
            <TouchableOpacity
              style={[st.interpretBtn, loading && st.interpretBtnDisabled]}
              onPress={interpretarHorario}
              disabled={loading}
            >
              {loading ? (
                <View style={st.loadingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={st.interpretBtnText}>  Interpretando horario...</Text>
                </View>
              ) : (
                <Text style={st.interpretBtnText}>🤖 Interpretar con IA</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!image && (
          <View style={st.placeholder}>
            <Text style={st.placeholderIcon}>📋</Text>
            <Text style={st.placeholderText}>La foto aparecerá aquí</Text>
            <Text style={st.placeholderSub}>
              Funciona con horarios escritos a mano o capturas de pantalla
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Modal preview resultado */}
      <Modal visible={preview} transparent animationType="slide"
        onRequestClose={() => setPreview(false)}>
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <Text style={st.modalTitle}>✅ Horario interpretado</Text>
            {resultado?.notas ? (
              <View style={st.notasBox}>
                <Text style={st.notasText}>💬 {resultado.notas}</Text>
              </View>
            ) : null}

            <ScrollView style={{ maxHeight: 340 }}>
              {resultado?.dias?.map((d, i) => {
                const diaInfo = days[d.index];
                if (!diaInfo) return null;
                return (
                  <View key={i} style={[
                    st.diaRow,
                    d.descanso && st.diaRowDescanso,
                    !d.worked && st.diaRowOff,
                  ]}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.diaLabel}>{diaInfo.label}</Text>
                      {d.worked && !d.descanso && (
                        <Text style={st.diaHoras}>
                          {d.entrada} → {d.salida}{"  "}
                          ☀️{fmtHrs(d.dayHours)} 🌙{fmtHrs(d.nightHours)}
                        </Text>
                      )}
                      {d.descanso && <Text style={st.diaTag}>🛌 Descanso</Text>}
                      {!d.worked && <Text style={st.diaTagOff}>✕ No trabajado</Text>}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Text style={st.modalHint}>
              Revisa que todo esté correcto. Puedes editar los días manualmente después.
            </Text>

            <View style={st.modalActions}>
              <TouchableOpacity style={st.cancelBtn} onPress={() => setPreview(false)}>
                <Text style={st.cancelBtnText}>Corregir foto</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.applyBtn} onPress={aplicarResultado}>
                <Text style={st.applyBtnText}>✅ Aplicar al calendario</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F6FA" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#4F46E5", padding: 16, paddingTop: 50,
  },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  closeBtn:     { padding: 6 },
  closeBtnText: { color: "#C7D2FE", fontSize: 20, fontWeight: "700" },

  scroll: { padding: 16 },

  infoBox: { backgroundColor: "#EEF2FF", borderRadius: 12, padding: 14, marginBottom: 16 },
  infoTitle: { fontSize: 14, fontWeight: "700", color: "#4F46E5", marginBottom: 6 },
  infoText:  { fontSize: 13, color: "#374151", lineHeight: 20 },

  pickRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  pickBtn: {
    flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 20,
    alignItems: "center", elevation: 2, shadowColor: "#000",
    shadowOpacity: 0.06, shadowRadius: 8,
  },
  pickIcon:  { fontSize: 32, marginBottom: 8 },
  pickLabel: { fontSize: 14, fontWeight: "600", color: "#374151" },

  imageBox:    { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginBottom: 16 },
  image:       { width: "100%", height: 220, borderRadius: 10, marginBottom: 12 },
  interpretBtn: {
    backgroundColor: "#4F46E5", borderRadius: 12,
    padding: 14, alignItems: "center",
  },
  interpretBtnDisabled: { backgroundColor: "#818CF8" },
  interpretBtnText:     { color: "#fff", fontSize: 15, fontWeight: "700" },
  loadingRow:  { flexDirection: "row", alignItems: "center" },

  placeholder: {
    backgroundColor: "#fff", borderRadius: 14, padding: 40,
    alignItems: "center", borderWidth: 2, borderColor: "#E5E7EB",
    borderStyle: "dashed",
  },
  placeholderIcon: { fontSize: 48, marginBottom: 12 },
  placeholderText: { fontSize: 15, fontWeight: "600", color: "#374151", marginBottom: 6 },
  placeholderSub:  { fontSize: 12, color: "#9CA3AF", textAlign: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: {
    backgroundColor: "#fff", borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 20, maxHeight: "85%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#1E1B4B", marginBottom: 12 },

  notasBox: { backgroundColor: "#EEF2FF", borderRadius: 10, padding: 10, marginBottom: 12 },
  notasText: { fontSize: 12, color: "#4F46E5" },

  diaRow: {
    flexDirection: "row", paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
  },
  diaRowDescanso: { backgroundColor: "#EFF6FF" },
  diaRowOff:      { backgroundColor: "#F9FAFB", opacity: 0.6 },
  diaLabel: { fontSize: 14, fontWeight: "600", color: "#1E1B4B" },
  diaHoras: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  diaTag:   { fontSize: 11, color: "#1D4ED8", marginTop: 2 },
  diaTagOff:{ fontSize: 11, color: "#9CA3AF", marginTop: 2 },

  modalHint: { fontSize: 11, color: "#9CA3AF", textAlign: "center", marginVertical: 12 },

  modalActions: { flexDirection: "row", gap: 10 },
  cancelBtn: {
    flex: 1, backgroundColor: "#F3F4F6", borderRadius: 12,
    padding: 14, alignItems: "center",
  },
  cancelBtnText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  applyBtn: {
    flex: 2, backgroundColor: "#059669", borderRadius: 12,
    padding: 14, alignItems: "center",
  },
  applyBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});