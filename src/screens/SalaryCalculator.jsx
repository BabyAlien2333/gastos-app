import { showAlert } from '@/utils/alert';
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot, query,
  setDoc,
  where,
} from "firebase/firestore";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text, TextInput, TouchableOpacity,
  View
} from "react-native";
import { auth, db } from "../firebase/firebaseConfig";
import ScheduleScanner from "./ScheduleScanner";

// ─── Constantes 2026 ─────────────────────────────────────────────────────────
const SMMLV_2026        = 1423500;
const AUX_TRANSPORTE_DEFAULT    = 200000;
const SALUD_PCT         = 0.04;
const PENSION_PCT       = 0.04;
const HORAS_SEMANA_2026 = 42;

// Festivos Colombia 2026
const FESTIVOS_2026 = new Set([
  "2026-01-01","2026-01-12","2026-03-23","2026-04-02","2026-04-03",
  "2026-05-01","2026-05-18","2026-06-08","2026-06-15","2026-06-29",
  "2026-07-20","2026-08-07","2026-08-17","2026-10-12","2026-11-02",
  "2026-11-16","2026-12-08","2026-12-25",
]);

const MESES = [
  { label:"Enero",      month:0,  days:31 },
  { label:"Febrero",    month:1,  days:28 },
  { label:"Marzo",      month:2,  days:31 },
  { label:"Abril",      month:3,  days:30 },
  { label:"Mayo",       month:4,  days:31 },
  { label:"Junio",      month:5,  days:30 },
  { label:"Julio",      month:6,  days:31 },
  { label:"Agosto",     month:7,  days:31 },
  { label:"Septiembre", month:8,  days:30 },
  { label:"Octubre",    month:9,  days:31 },
  { label:"Noviembre",  month:10, days:30 },
  { label:"Diciembre",  month:11, days:31 },
];

const NOMBRES_DIA = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

const TIPOS_CONTRATO = [
  {
    id: "indefinido",
    label: "Término indefinido",
    icon: "📋",
    desc: "Sin fecha de terminación. Incluye todas las prestaciones de ley.",
    prestaciones: true, horasExtra: true, auxTransporte: true,
    mesVencido: true, porHoras: false, partTime: false,
  },
  {
    id: "fijo",
    label: "Término fijo",
    icon: "📅",
    desc: "Con fecha de terminación pactada. Mismas prestaciones que indefinido.",
    prestaciones: true, horasExtra: true, auxTransporte: true,
    mesVencido: true, porHoras: false, partTime: false,
  },
  {
    id: "obra",
    label: "Obra o labor",
    icon: "🏗️",
    desc: "Termina al finalizar la obra. Prestaciones proporcionales.",
    prestaciones: true, horasExtra: true, auxTransporte: true,
    mesVencido: true, porHoras: false, partTime: false,
  },
  {
    id: "servicios",
    label: "Prestación de servicios",
    icon: "🤝",
    desc: "Independiente. Sin prestaciones sociales ni auxilio de transporte.",
    prestaciones: false, horasExtra: false, auxTransporte: false,
    mesVencido: false, porHoras: false, partTime: false,
  },
  {
    id: "d1parttime",
    label: "D1 Part Time",
    icon: "🏪",
    desc: "Contrato por horas. Incluye recargo nocturno 35%, dominical configurable, descanso remunerado, prima legal y deducciones de ley.",
    prestaciones: true, horasExtra: true, auxTransporte: true,
    mesVencido: true, porHoras: true, partTime: true,
  },
];

const pad = (n) => String(n).padStart(2, "0");
const getDayKey = (y, m, d) => `${y}-${pad(m+1)}-${pad(d)}`;
const isDomingo = (y, m, d) => new Date(y, m, d).getDay() === 0;
const isFestivoCol = (y, m, d) => FESTIVOS_2026.has(getDayKey(y, m, d));

const formatCOP = (v) =>
  new Intl.NumberFormat("es-CO", {
    style:"currency", currency:"COP",
    minimumFractionDigits:0, maximumFractionDigits:0,
  }).format(v || 0);

const fmtHrs = (v) => {
  if (!v) return "0h";
  const h = Math.floor(v);
  const m = Math.round((v - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// ─── Horario de entrada / salida (formato 24 h) con varios turnos por día ────
const NOC_INI = 19 * 60; // 19:00 (Ley 2466/2025)
const NOC_FIN = 6 * 60;  // 06:00

// "08:00" → 480 · devuelve null si no es una hora válida
const aMin = (s) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s || "");
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
};

// "0800" → "08:00" (agrega los dos puntos mientras se escribe)
const formatHora = (txt) => {
  const d = (txt || "").replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

const turnoVacio = (desc = 30) => ({ entrada: "", salida: "", descansoMin: desc });

// Devuelve los turnos de un día. Compatible con días guardados antes de que
// existieran los turnos múltiples (campos entrada / salida / descansoMin).
const getTurnos = (d) => {
  if (Array.isArray(d.turnos) && d.turnos.length > 0) return d.turnos;
  if (d.entrada || d.salida) {
    return [{ entrada: d.entrada || "", salida: d.salida || "", descansoMin: d.descansoMin ?? 30 }];
  }
  return [turnoVacio()];
};

// Un turno: horas diurnas/nocturnas entre entrada y salida, menos el descanso.
// Devuelve null si el turno no es válido.
const calcularTurno = (t) => {
  const ini = aMin(t.entrada);
  let fin = aMin(t.salida);
  if (ini === null || fin === null || ini === fin) return null;
  if (fin < ini) fin += 24 * 60; // el turno cruza la medianoche

  let dia = 0, noche = 0;
  for (let x = ini; x < fin; x++) {
    const m = x % (24 * 60);
    (m >= NOC_INI || m < NOC_FIN) ? noche++ : dia++;
  }

  // El descanso se descuenta primero del tramo diurno
  let desc = Math.max(0, t.descansoMin || 0);
  const qd = Math.min(desc, dia); dia -= qd; desc -= qd;
  noche = Math.max(0, noche - desc);

  return { ini, fin, dayHours: dia / 60, nightHours: noche / 60, total: (dia + noche) / 60 };
};

// Suma todos los turnos del día. NO calcula extras (son manuales) y NO aplica
// ningún tope diario ni semanal. Devuelve null si ningún turno es válido.
const calcularJornada = (turnos) => {
  const detalle = turnos.map(calcularTurno);
  const validos = detalle.filter(Boolean);
  if (validos.length === 0) return null;

  const dayHours   = validos.reduce((s, v) => s + v.dayHours, 0);
  const nightHours = validos.reduce((s, v) => s + v.nightHours, 0);

  // ¿Hay turnos que se cruzan entre sí?
  const rangos = validos.map((v) => [v.ini, v.fin]).sort((a, b) => a[0] - b[0]);
  let solapa = false;
  for (let i = 1; i < rangos.length; i++) {
    if (rangos[i][0] < rangos[i - 1][1]) solapa = true;
  }
  return { dayHours, nightHours, total: dayHours + nightHours, detalle, solapa };
};

// Etiquetas para las semanas (ej: "12–18 oct")
const MES_CORTO = (m) => MESES[m].label.slice(0, 3).toLowerCase();
const labelSemana = (a, b) =>
  a.month === b.month
    ? `${a.day}–${b.day} ${MES_CORTO(a.month)}`
    : `${a.day} ${MES_CORTO(a.month)} – ${b.day} ${MES_CORTO(b.month)}`;

// Días de la semana para elegir con cuál empieza (v = valor de Date.getDay())
const DIAS_SEMANA = [
  { l: "Lun", v: 1 }, { l: "Mar", v: 2 }, { l: "Mié", v: 3 },
  { l: "Jue", v: 4 }, { l: "Vie", v: 5 }, { l: "Sáb", v: 6 }, { l: "Dom", v: 0 },
];

// Semana dentro del mes. La semana 1 puede ser parcial (desde el día 1 hasta
// el día anterior al primer "inicioSemana"). Nunca cruza de un mes a otro.
const getSemanaMes = (y, m, d, inicioSemana = 1) => {
  const firstDow = new Date(y, m, 1).getDay();
  const parcial = (inicioSemana - firstDow + 7) % 7; // días de la semana 1 parcial
  const numero = parcial === 0
    ? 1 + Math.floor((d - 1) / 7)
    : (d <= parcial ? 1 : 2 + Math.floor((d - parcial - 1) / 7));
  return { key: `${y}-${pad(m + 1)}-S${numero}`, numero };
};

const generarDiasCorte = (diaInicio, mesInicio, diaFin, mesFin, año = 2026) => {
  const resultado = [];
  let cursor = new Date(año, mesInicio, diaInicio);
  let añoFin = año;
  if (mesFin < mesInicio) añoFin = año + 1;
  const fin = new Date(añoFin, mesFin, diaFin);

  while (cursor <= fin) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const d = cursor.getDate();
    const festivo = isFestivoCol(y, m, d);
    const domingo = isDomingo(y, m, d);
    resultado.push({
      day: d, month: m, year: y,
      label: `${d} ${MESES[m]?.label || ""}`,
      worked: true,
      descanso: domingo,
      compensatorio: false,
      compensatorioPor: null,
      compensatorioOtorgado: false,
      compensatorioTipo: null, // null=pendiente · "dia"=día libre otorgado · "dinero"=pagado en dinero
      noProgramado: false,     // true = no trabaja y no se remunera
      festivo, domingo,
      especial: festivo || domingo,
      dayHours: 0, nightHours: 0,
      extraDayH: 0, extraNightH: 0,
      turnos: [turnoVacio()],  // horario 24 h (puede tener varios turnos)
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return resultado;
};

// ─── Compensatorios (CST art. 179-180, Ley 789/2002) ─────────────────────────
const sugerirCompensatorios = (arr) => {
  const nuevo = arr.map((d) => ({ ...d }));
  for (let i = 0; i < nuevo.length; i++) {
    const d = nuevo[i];
    if (d.especial && d.worked && !d.descanso && !d.noProgramado && !d.compensatorioTipo) {
      let asignado = false;
      for (let j = i + 1; j < nuevo.length; j++) {
        const cand = nuevo[j];
        if (cand.worked && !cand.especial && !cand.descanso && !cand.compensatorio && !cand.noProgramado) {
          cand.compensatorio = true;
          cand.compensatorioPor = d.label;
          d.compensatorioTipo = "dia";
          d.compensatorioOtorgado = true;
          asignado = true;
          break;
        }
      }
      if (!asignado) d.compensatorioTipo = "dinero";
    }
  }
  return nuevo;
};

const liberarCompensatorioDe = (arr, label) => {
  const idx = arr.findIndex((d) => d.compensatorioPor === label);
  if (idx >= 0) arr[idx] = { ...arr[idx], compensatorio: false, compensatorioPor: null };
};

// ─── Stepper ─────────────────────────────────────────────────────────────────
const Stepper = ({ label, value, onChange, small }) => (
  <View style={small ? ss.stepperWrapSm : ss.stepperWrap}>
    <Text style={ss.stepperLabel}>{label}</Text>
    <View style={ss.stepperRow}>
      <TouchableOpacity style={ss.stepBtn}
        onPress={() => onChange(Math.max(0, Math.round((value - 0.5) * 10) / 10))}>
        <Text style={ss.stepBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={ss.stepperVal}>{fmtHrs(value)}</Text>
      <TouchableOpacity style={ss.stepBtn}
        onPress={() => onChange(Math.min(24, Math.round((value + 0.5) * 10) / 10))}>
        <Text style={ss.stepBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Campo de hora 24 h (HH:MM) ──────────────────────────────────────────────
const HoraInput = ({ label, value, onChange }) => (
  <View style={ss.stepperWrap}>
    <Text style={ss.stepperLabel}>{label}</Text>
    <TextInput
      style={[ss.cutInput, { textAlign: "center" }]}
      keyboardType="numeric" returnKeyType="done" blurOnSubmit
      placeholder="HH:MM" placeholderTextColor="#aaa" maxLength={5}
      value={value || ""} onChangeText={(t) => onChange(formatHora(t))}
    />
  </View>
);

// ─── Filas de resumen (semana / mes) ─────────────────────────────────────────
const Fila = ({ l, v, color }) => (
  <View style={ss.desgloseRow}>
    <Text style={[ss.desgloseLabel, color && { color }]}>{l}</Text>
    <Text style={[ss.desgloseValue, color && { color }]}>{v}</Text>
  </View>
);

const FilasAgg = ({ a }) => (
  <>
    <Fila l="☀️ Ordinarias" v={fmtHrs(a.ordDia + a.ordNoche)} />
    {a.ordNoche > 0 && <Fila l={`🌙 Nocturnas (${fmtHrs(a.ordNoche)}) · recargo`} v={formatCOP(a.recNoche)} />}
    {a.recDom > 0 && <Fila l="🟡 Recargo dom/fest" v={formatCOP(a.recDom)} />}
    {(a.extDia + a.extNoche) > 0 && (
      <Fila color="#F59E0B"
        l={`⚡ Extras (${fmtHrs(a.extDia)} día · ${fmtHrs(a.extNoche)} noche) · recargo`}
        v={formatCOP(a.recExt)} />
    )}
  </>
);

// ─── Componente principal ─────────────────────────────────────────────────────
export default function SalaryCalculator() {
  const [tipoContrato,    setTipoContrato]    = useState(TIPOS_CONTRATO[0]);
  const [salarioBase,     setSalarioBase]     = useState("");
  const [valorHoraManual, setValorHoraManual] = useState("");
  const [modoHora,        setModoHora]        = useState(false);
  const [inclAuxTransp,   setInclAuxTransp]   = useState(true);
  const [inclDeducciones, setInclDeducciones] = useState(true);
  const [auxTransporteInput, setAuxTransporteInput] = useState(String(AUX_TRANSPORTE_DEFAULT));
  const auxTransporteValor = parseFloat(auxTransporteInput.replace(/\./g, "").replace(",", ".")) || AUX_TRANSPORTE_DEFAULT;

  // ── D1 Part Time: modo de ingreso del pago base ──────────────────────────
  const [modoSueldoPT,   setModoSueldoPT]   = useState(false);
  const [salarioBasePT,  setSalarioBasePT]  = useState("");
  const [auxCompletoPT,  setAuxCompletoPT]  = useState(false);

  const [showRecargos, setShowRecargos] = useState(false);
  const [pctNocturno,  setPctNocturno]  = useState("35");
  const [pctExtDia,    setPctExtDia]    = useState("25");
  const [pctExtNoche,  setPctExtNoche]  = useState("75");
  const [pctDomOrd,    setPctDomOrd]    = useState("75");

  const [domPct,         setDomPct]         = useState("80");
  const [diasXDescanso,  setDiasXDescanso]  = useState("6");
  const [inclPrima,      setInclPrima]      = useState(false);

  const [diaInicio,  setDiaInicio]  = useState("1");
  const [mesInicio,  setMesInicio]  = useState(0);
  const [diaFin,     setDiaFin]     = useState("31");
  const [mesFin,     setMesFin]     = useState(0);
  const [corteCargado, setCorteCargado] = useState(false);

  const [extrasPeriodoAnterior, setExtrasPeriodoAnterior] = useState({
    extDayH: 0, extNightH: 0, extDomDayH: 0, extDomNightH: 0,
  });

  const [days,        setDays]        = useState([]);
  const [expandedDay, setExpandedDay] = useState(null);
  const [semanaSel,   setSemanaSel]   = useState(null); // null = todo el período
  const [inicioSemana, setInicioSemana] = useState(1);  // 1 = lunes

  const [modalContrato,  setModalContrato]  = useState(false);
  const [modalMesInicio, setModalMesInicio] = useState(false);
  const [modalMesFin,    setModalMesFin]    = useState(false);
  const [balanceModal,   setBalanceModal]   = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);

  const [savedBalances,   setSavedBalances]   = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { setLoadingBalances(false); return; }
    const q = query(collection(db, "salary_balances"), where("uid", "==", user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const data = {};
      snap.forEach((d) => { data[d.id] = d.data(); });
      setSavedBalances(data);
      setLoadingBalances(false);
    }, () => setLoadingBalances(false));
    return () => unsub();
  }, []);

  const saveBalance = async (key, entry) => {
    const user = auth.currentUser;
    if (!user) return showAlert("Error", "Debes iniciar sesión para guardar.");
    const docId = `${user.uid}_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    await setDoc(doc(db, "salary_balances", docId), { ...entry, uid: user.uid });
  };

  const deleteBalance = async (key) => {
    const user = auth.currentUser;
    if (!user) return;
    const docId = `${user.uid}_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    await deleteDoc(doc(db, "salary_balances", docId));
  };

  const aplicarEscaneo = (diasEscaneados) => {
    setDays((prev) => {
      const nuevo = [...prev];
      diasEscaneados.forEach((d) => {
        if (d.index >= 0 && d.index < nuevo.length) {
          nuevo[d.index] = {
            ...nuevo[d.index],
            worked:     d.worked !== false,
            descanso:   d.descanso || false,
            noProgramado: false,
            dayHours:   d.dayHours   || 0,
            nightHours: d.nightHours || 0,
            turnos: [turnoVacio()], // las horas escaneadas reemplazan el horario
          };
        }
      });
      return sugerirCompensatorios(nuevo);
    });
  };

  const cargarCorte = useCallback(() => {
    const di = parseInt(diaInicio) || 1;
    const df = parseInt(diaFin)    || 31;
    const generados = sugerirCompensatorios(generarDiasCorte(di, mesInicio, df, mesFin));

    setDays(generados);
    setCorteCargado(true);
    setExpandedDay(null);
    setSemanaSel(null);

    setTimeout(() => {
      const balances = Object.values(savedBalances);
      if (balances.length === 0) return;

      const ultimo = balances
        .filter((b) => b.extrasPendientes)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];

      if (!ultimo?.extrasPendientes) return;

      const ext = ultimo.extrasPendientes;
      const total = ultimo.totalExtrasPendientes || 0;
      const tieneRecargos = Object.values(ext).some((v) => v > 0);
      if (!tieneRecargos) return;

      showAlert(
        "⚡ Recargos pendientes del período anterior",
        `Del corte ${ultimo.corte} tienes recargos por pagar:\n\n` +
        (ext.recNoche  > 0 ? `• Nocturno: ${formatCOP(ext.recNoche)}\n`      : "") +
        (ext.recDomDia > 0 ? `• Dom/fest día: ${formatCOP(ext.recDomDia)}\n` : "") +
        (ext.recDomNoc > 0 ? `• Dom/fest noche: ${formatCOP(ext.recDomNoc)}\n` : "") +
        (ext.recExtDia > 0 ? `• Extra diurna: ${formatCOP(ext.recExtDia)}\n`  : "") +
        (ext.recExtNoc > 0 ? `• Extra nocturna: ${formatCOP(ext.recExtNoc)}\n` : "") +
        `\nTotal: ${formatCOP(total)}\n\n¿Los cargo en este período?`,
        [
          { text: "No", style: "cancel" },
          {
            text: "Sí, cargar",
            onPress: () => setExtrasPeriodoAnterior(ext),
          },
        ]
      );
    }, 100);
  }, [diaInicio, diaFin, mesInicio, mesFin, savedBalances]);

  // ── Cálculos base ─────────────────────────────────────────────────────────
  const salario  = parseFloat(salarioBase.replace(/\./g, "").replace(",", ".")) || 0;
  const contrato = tipoContrato;
  const isPartTime = contrato.porHoras;

  const horasDiarias   = HORAS_SEMANA_2026 / 6;
  const valorHoraCalc  = salario > 0 ? salario / (30 * horasDiarias) : 0;
  const valorHoraIngresado = parseFloat(valorHoraManual.replace(/\./g, "").replace(",", ".")) || 0;

  const salarioBasePTNum = parseFloat(salarioBasePT.replace(/\./g, "").replace(",", ".")) || 0;
  const valorHoraPTCalc  = salarioBasePTNum > 0 ? salarioBasePTNum / (30 * horasDiarias) : 0;

  const valorHora = isPartTime
    ? (modoSueldoPT ? valorHoraPTCalc : valorHoraIngresado)
    : (modoHora ? valorHoraIngresado : valorHoraCalc);

  const domPctNum    = Math.max(0, parseFloat(domPct)      || 80) / 100;
  const pctNocNum    = Math.max(0, parseFloat(pctNocturno) || 35) / 100;
  const pctExtDiaNum = Math.max(0, parseFloat(pctExtDia)   || 25) / 100;
  const pctExtNocNum = Math.max(0, parseFloat(pctExtNoche) || 75) / 100;
  const pctDomOrdNum = isPartTime
    ? domPctNum
    : Math.max(0, parseFloat(pctDomOrd) || 75) / 100;

  const calcDay = useCallback((d) => {
    if (!d.worked || d.descanso || d.noProgramado) return { total: 0, detail: {} };

    if (d.compensatorio) {
      const valorDiaComp = horasDiarias * valorHora;
      return { total: valorDiaComp, detail: { compensatorioDia: valorDiaComp } };
    }

    const e = d.especial;

    const baseDia    = d.dayHours           * valorHora;
    const baseNoche  = d.nightHours         * valorHora;
    const baseExtDia = (d.extraDayH   || 0) * valorHora;
    const baseExtNoc = (d.extraNightH || 0) * valorHora;
    const basePuro   = baseDia + baseNoche + baseExtDia + baseExtNoc;

    const recNoche  = d.nightHours         * valorHora * pctNocNum;
    const recDomDia = e ? d.dayHours       * valorHora * pctDomOrdNum : 0;
    const recDomNoc = e ? d.nightHours     * valorHora * pctDomOrdNum : 0;
    const recExtDia = (d.extraDayH   || 0) * valorHora * (e ? (pctDomOrdNum + pctExtDiaNum) : pctExtDiaNum);
    const recExtNoc = (d.extraNightH || 0) * valorHora * (e ? (pctDomOrdNum + pctExtNocNum) : pctExtNocNum);

    const compensatorioDinero = (e && d.compensatorioTipo === "dinero") ? (horasDiarias * valorHora) : 0;

    return {
      total: basePuro + compensatorioDinero,
      detail: {
        baseDia, baseNoche, baseExtDia, baseExtNoc,
        recNoche, recDomDia, recDomNoc, recExtDia, recExtNoc,
        compensatorioDinero,
        totalRecargos: recNoche + recDomDia + recDomNoc + recExtDia + recExtNoc,
      },
    };
  }, [valorHora, pctNocNum, pctDomOrdNum, pctExtDiaNum, pctExtNocNum, horasDiarias]);

  const calcExtrasVencidas = useCallback(() => {
    if (!contrato.mesVencido) return 0;
    const p = extrasPeriodoAnterior;
    const nuevoFormato = (p.recNoche || 0) + (p.recDomDia || 0) + (p.recDomNoc || 0) +
                         (p.recExtDia || 0) + (p.recExtNoc || 0);
    const formatoAnterior =
      (p.extDayH     || 0) * valorHora * (1 + pctExtDiaNum) +
      (p.extNightH   || 0) * valorHora * (1 + pctExtNocNum) +
      (p.extDomDayH  || 0) * valorHora * (1 + pctDomOrdNum + pctExtDiaNum) +
      (p.extDomNightH|| 0) * valorHora * (1 + pctDomOrdNum + pctExtNocNum);
    return nuevoFormato > 0 ? nuevoFormato : formatoAnterior;
  }, [contrato.mesVencido, extrasPeriodoAnterior, valorHora, pctExtDiaNum, pctExtNocNum, pctDomOrdNum]);

  const {
    diasTrabajados, diasDescanso, diasCompensatorios, diasEspeciales, diasNoProgramados,
    totalHorasPT, subtotalOrd, subtotalComp, subtotalCompDinero, subtotalExt,
    recargosEstePeriodo, totalRecargosEstePeriodo,
    horasDescansoRem, descRemunerado, diasPeriodo, primaLegal,
    auxTransp, devengadoBase, deducSalud, deducPension, totalDeduc,
    totalBruto, totalNeto,
  } = useMemo(() => {
    const trabajados  = days.filter((d) => d.worked && !d.descanso && !d.compensatorio && !d.noProgramado);
    const descanso    = days.filter((d) => d.descanso).length;
    const noProg      = days.filter((d) => d.noProgramado).length;
    const compDiasArr = days.filter((d) => d.compensatorio);
    const compensatorios = compDiasArr.length;
    const especiales  = trabajados.filter((d) => d.especial).length;
    const horasPT     = trabajados.reduce((s, d) => s + (d.dayHours || 0) + (d.nightHours || 0), 0);
    const subOrd      = trabajados.reduce((s, d) => s + calcDay(d).total, 0);
    const subComp     = compDiasArr.reduce((s, d) => s + calcDay(d).total, 0);
    const subCompDinero = trabajados
      .filter((d) => d.especial && d.compensatorioTipo === "dinero")
      .reduce((s, d) => s + (calcDay(d).detail.compensatorioDinero || 0), 0);
    const subExt      = calcExtrasVencidas();

    const recargos = trabajados.reduce((acc, d) => {
      const det = calcDay(d).detail;
      return {
        recNoche:  acc.recNoche  + (det.recNoche  || 0),
        recDomDia: acc.recDomDia + (det.recDomDia || 0),
        recDomNoc: acc.recDomNoc + (det.recDomNoc || 0),
        recExtDia: acc.recExtDia + (det.recExtDia || 0),
        recExtNoc: acc.recExtNoc + (det.recExtNoc || 0),
      };
    }, { recNoche: 0, recDomDia: 0, recDomNoc: 0, recExtDia: 0, recExtNoc: 0 });

    const totalRec = Object.values(recargos).reduce((s, v) => s + v, 0);

    const DIVISOR_DESCANSO = 6.5;
    const hrsDescanso  = isPartTime ? horasPT / DIVISOR_DESCANSO : 0;
    const descRem      = isPartTime ? hrsDescanso * valorHora : 0;
    const diasPer      = days.length;
    const baseParaPrima = subOrd + subComp + descRem;
    const prima = (isPartTime && inclPrima) ? (baseParaPrima * diasPer / 360 / 2) : 0;

    const HORAS_MES_COMPLETO = 30 * horasDiarias;
    const auxBase = (contrato.auxTransporte && inclAuxTransp) ? auxTransporteValor : 0;
    const aux = isPartTime
      ? (auxCompletoPT
          ? auxBase
          : Math.round(auxBase * (horasPT / HORAS_MES_COMPLETO)))
      : (salario <= 2 * SMMLV_2026 ? auxBase : 0);

    const devBase  = subOrd + subComp + descRem + prima + aux;
    const baseDeduc = isPartTime ? devBase : salario;
    const dSalud   = (contrato.prestaciones && inclDeducciones) ? Math.round(baseDeduc * SALUD_PCT)   : 0;
    const dPension = (contrato.prestaciones && inclDeducciones) ? Math.round(baseDeduc * PENSION_PCT) : 0;
    const totalDed = dSalud + dPension;

    const bruto = subOrd + subComp + subExt + aux + descRem + prima;
    const neto  = bruto - totalDed;

    return {
      diasTrabajados: trabajados,
      diasDescanso: descanso,
      diasCompensatorios: compensatorios,
      diasEspeciales: especiales,
      diasNoProgramados: noProg,
      totalHorasPT: horasPT,
      subtotalOrd: subOrd,
      subtotalComp: subComp,
      subtotalCompDinero: subCompDinero,
      subtotalExt: subExt,
      recargosEstePeriodo: recargos,
      totalRecargosEstePeriodo: totalRec,
      horasDescansoRem: hrsDescanso,
      descRemunerado: descRem,
      diasPeriodo: diasPer,
      primaLegal: prima,
      auxTransp: aux,
      devengadoBase: devBase,
      deducSalud: dSalud,
      deducPension: dPension,
      totalDeduc: totalDed,
      totalBruto: bruto,
      totalNeto: neto,
    };
  }, [days, calcDay, calcExtrasVencidas, isPartTime, valorHora, inclPrima,
    horasDiarias, contrato, inclAuxTransp, inclDeducciones, salario, auxCompletoPT, auxTransporteValor]);

  // ── Resumen de horas y recargos por semana (dentro del mes) y por mes ──────
  const resumenHoras = useMemo(() => {
    const semanas = {};
    const meses = {};
    const vacio = () => ({
      horas: 0, ordDia: 0, ordNoche: 0, extDia: 0, extNoche: 0,
      recNoche: 0, recDom: 0, recExt: 0,
    });
    const sumar = (a, x) => { Object.keys(x).forEach((k) => { a[k] += x[k]; }); };

    days.forEach((d) => {
      if (!d.worked || d.descanso || d.compensatorio || d.noProgramado) return;
      const det = calcDay(d).detail;
      const x = {
        ordDia: d.dayHours || 0, ordNoche: d.nightHours || 0,
        extDia: d.extraDayH || 0, extNoche: d.extraNightH || 0,
        recNoche: det.recNoche || 0,
        recDom: (det.recDomDia || 0) + (det.recDomNoc || 0),
        recExt: (det.recExtDia || 0) + (det.recExtNoc || 0),
      };
      x.horas = x.ordDia + x.ordNoche + x.extDia + x.extNoche;
      if (x.horas <= 0) return;

      const w = getSemanaMes(d.year, d.month, d.day, inicioSemana);
      if (!semanas[w.key]) {
        semanas[w.key] = { key: w.key, numero: w.numero, mesLabel: MESES[d.month].label, ...vacio() };
      }
      sumar(semanas[w.key], x);

      const mKey = `${d.year}-${pad(d.month + 1)}`;
      if (!meses[mKey]) {
        meses[mKey] = { key: mKey, label: `${MESES[d.month].label} ${d.year}`, ...vacio() };
      }
      sumar(meses[mKey], x);
    });

    const ordenar = (o) => Object.values(o).sort((a, b) => a.key.localeCompare(b.key));
    return { semanas: ordenar(semanas), meses: ordenar(meses) };
  }, [days, calcDay, inicioSemana]);

  // ── Semanas del período (numeradas dentro de cada mes) ─────────────────────
  const semanasPeriodo = useMemo(() => {
    const map = {};
    days.forEach((d) => {
      const w = getSemanaMes(d.year, d.month, d.day, inicioSemana);
      if (!map[w.key]) map[w.key] = { key: w.key, numero: w.numero, first: d, last: d };
      map[w.key].last = d;
    });
    return Object.values(map);
  }, [days, inicioSemana]);

  const resumenSemana = useMemo(() => {
    if (!semanaSel) return null;
    let horas = 0, total = 0, trabajados = 0;
    days.forEach((d) => {
      if (getSemanaMes(d.year, d.month, d.day, inicioSemana).key !== semanaSel) return;
      if (!d.worked || d.descanso || d.compensatorio || d.noProgramado) return;
      horas += (d.dayHours || 0) + (d.nightHours || 0) + (d.extraDayH || 0) + (d.extraNightH || 0);
      total += calcDay(d).total;
      trabajados++;
    });
    return { horas, total, trabajados };
  }, [days, semanaSel, calcDay, inicioSemana]);

  const labelCorte = `${diaInicio}/${pad(mesInicio + 1)} → ${diaFin}/${pad(mesFin + 1)}`;

  const isEditing = corteCargado && !!savedBalances[
    Object.keys(savedBalances).find(k => savedBalances[k].corte === labelCorte)
  ];

  const handleSave = async () => {
    if (!corteCargado) return showAlert("Carga el período primero");
    try {
      const entry = {
        key: labelCorte,
        corte: labelCorte,
        contrato: contrato.id,
        salario,
        valorHoraManual,
        modoHora,
        modoSueldoPT,
        salarioBasePT,
        auxCompletoPT,
        domPct,
        diasXDescanso,
        inclPrima,
        pctNocturno, pctExtDia, pctExtNoche, pctDomOrd,
        dias: diasTrabajados.length,
        especiales: diasEspeciales,
        compensatorios: diasCompensatorios,
        noProgramados: diasNoProgramados,
        totalBruto,
        totalNeto,
        auxTransp,
        deducSalud,
        deducPension,
        extrasPeriodoAnterior,
        extrasPendientes: recargosEstePeriodo,
        totalExtrasPendientes: totalRecargosEstePeriodo,
        fecha: new Date().toLocaleDateString("es-CO"),
        daysSnapshot: days,
        salarioBase,
        inicioSemana,
      };
      await saveBalance(labelCorte, entry);
      showAlert(
        isEditing ? "✅ Actualizado" : "✅ Guardado",
        `Balance ${labelCorte} guardado y sincronizado.`
      );
    } catch (e) {
      showAlert("Error", "No se pudo guardar: " + e.message);
    }
  };

  const handleDelete = (key) => {
    showAlert("Eliminar", `¿Eliminar balance ${key}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        try { await deleteBalance(key); }
        catch (e) { showAlert("Error", "No se pudo eliminar: " + e.message); }
      }},
    ]);
  };

  const handleEdit = (b) => {
    if (!b.daysSnapshot) {
      showAlert("Balance antiguo", "Este balance no tiene datos para editar.");
      return;
    }
    setBalanceModal(false);
    setTimeout(() => {
      const tc = TIPOS_CONTRATO.find((t) => t.id === b.contrato) || TIPOS_CONTRATO[0];
      setTipoContrato(tc);
      setSalarioBase(b.salarioBase || String(b.salario || ""));
      if (b.valorHoraManual)         setValorHoraManual(b.valorHoraManual);
      if (b.modoHora !== undefined)  setModoHora(b.modoHora);
      if (b.modoSueldoPT !== undefined) setModoSueldoPT(b.modoSueldoPT);
      if (b.salarioBasePT)           setSalarioBasePT(b.salarioBasePT);
      if (b.auxCompletoPT !== undefined) setAuxCompletoPT(b.auxCompletoPT);
      if (b.domPct)                  setDomPct(b.domPct);
      if (b.diasXDescanso)           setDiasXDescanso(b.diasXDescanso);
      if (b.inclPrima !== undefined) setInclPrima(b.inclPrima);
      if (b.pctNocturno)             setPctNocturno(b.pctNocturno);
      if (b.pctExtDia)               setPctExtDia(b.pctExtDia);
      if (b.pctExtNoche)             setPctExtNoche(b.pctExtNoche);
      if (b.pctDomOrd)                setPctDomOrd(b.pctDomOrd);
      if (b.inicioSemana !== undefined) setInicioSemana(b.inicioSemana);
      setExtrasPeriodoAnterior(b.extrasPeriodoAnterior || { extDayH:0, extNightH:0, extDomDayH:0, extDomNightH:0 });
      const snapshot = (b.daysSnapshot || []).map((d) => ({
        compensatorio: false, compensatorioPor: null, compensatorioOtorgado: false, compensatorioTipo: null,
        noProgramado: false,
        ...d,
        turnos: getTurnos(d), // migra balances viejos (entrada/salida) a turnos
      }));
      setDays(snapshot);
      setCorteCargado(true);
      setExpandedDay(null);
      setSemanaSel(null);
    }, 300);
  };

  // ── Exportar PDF (por semanas, día a día) ─────────────────────────────────
  const exportPDF = async () => {
    const pctNocTxt = Math.round(pctNocNum * 100);
    const pctDomTxt = Math.round(pctDomOrdNum * 100);
    const pctExtDiaTxt = Math.round(pctExtDiaNum * 100);
    const pctExtNocTxt = Math.round(pctExtNocNum * 100);

    const aggVacio = () => ({
      dias: 0, horas: 0, ordDia: 0, ordNoche: 0, extDia: 0, extNoche: 0,
      recNoche: 0, recDom: 0, recExt: 0, pago: 0,
    });
    const sumarAgg = (a, x) => { Object.keys(x).forEach((k) => { a[k] += x[k]; }); };

    // Horario del día: cada turno con sus horas y recargos
    const horarioHTML = (d) => {
      const ts = getTurnos(d);
      const partes = ts.map((t, i) => {
        const r = calcularTurno(t);
        if (!r) return null;
        const num = ts.length > 1 ? `<b>Turno ${i + 1}:</b> ` : "";
        const noc = r.nightHours > 0
          ? ` · <span class="noc">Nocturnas ${fmtHrs(r.nightHours)} (+${pctNocTxt}%)</span>`
          : "";
        return `<div class="turno">${num}<b>${t.entrada} a ${t.salida}</b>` +
          ` · descanso ${t.descansoMin || 0} min` +
          ` → trabajó ${fmtHrs(r.total)} (Diurnas ${fmtHrs(r.dayHours)}${noc})</div>`;
      }).filter(Boolean);
      if (partes.length) return partes.join("");
      if ((d.dayHours || 0) + (d.nightHours || 0) > 0) {
        return `<div class="turno">Horas ingresadas sin horario</div>`;
      }
      return "-";
    };

    let seccionesSemanas = "";
    const semanasResumen = []; // { label, mesKey, mesLabel, agg }

    semanasPeriodo.forEach((s) => {
      const diasSem = days.filter(
        (d) => getSemanaMes(d.year, d.month, d.day, inicioSemana).key === s.key
      );
      const aggS = aggVacio();

      const filasSem = diasSem.map((d) => {
        const c = calcDay(d);
        const det = c.detail || {};
        const trabajado = d.worked && !d.descanso && !d.compensatorio && !d.noProgramado;

        const tipo = d.noProgramado ? "No programado (sin pago)"
          : d.compensatorio ? `Compensatorio (día libre${d.compensatorioPor ? ` · por ${d.compensatorioPor}` : ""})`
          : d.descanso ? "Descanso"
          : !d.worked ? "No trabajado"
          : d.festivo ? `Festivo${d.compensatorioTipo === "dinero" ? " · comp. en dinero" : d.compensatorioTipo === "dia" ? ` · comp. ${d.compensatorioPor || ""}` : ""}`
          : d.domingo ? `Domingo${d.compensatorioTipo === "dinero" ? " · comp. en dinero" : ""}`
          : "Normal";
        const bg = d.noProgramado ? "#e5e7eb"
          : d.compensatorio ? "#ede9fe" : d.descanso ? "#dbeafe" : !d.worked ? "#f3f4f6"
          : d.festivo ? "#fde68a" : d.domingo ? "#fef9c3" : "#fff";

        if (trabajado) {
          const x = {
            dias: 1,
            ordDia: d.dayHours || 0, ordNoche: d.nightHours || 0,
            extDia: d.extraDayH || 0, extNoche: d.extraNightH || 0,
            recNoche: det.recNoche || 0,
            recDom: (det.recDomDia || 0) + (det.recDomNoc || 0),
            recExt: (det.recExtDia || 0) + (det.recExtNoc || 0),
            pago: c.total,
          };
          x.horas = x.ordDia + x.ordNoche + x.extDia + x.extNoche;
          sumarAgg(aggS, x);
        } else if (d.compensatorio) {
          aggS.pago += c.total;
        }

        // Recargos del día, explicados
        const rec = [];
        if (trabajado) {
          if (det.recNoche > 0)
            rec.push(`Nocturno ${pctNocTxt}% sobre ${fmtHrs(d.nightHours)}: ${formatCOP(det.recNoche)}`);
          const rd = (det.recDomDia || 0) + (det.recDomNoc || 0);
          if (rd > 0)
            rec.push(`${d.festivo ? "Festivo" : "Dominical"} ${pctDomTxt}%: ${formatCOP(rd)}`);
          if (det.recExtDia > 0)
            rec.push(`Extra diurna ${fmtHrs(d.extraDayH)}: ${formatCOP(det.recExtDia)}`);
          if (det.recExtNoc > 0)
            rec.push(`Extra nocturna ${fmtHrs(d.extraNightH)}: ${formatCOP(det.recExtNoc)}`);
        }

        const etiquetaDia = `${NOMBRES_DIA[new Date(d.year, d.month, d.day).getDay()]} ${d.day} ${MES_CORTO(d.month)}`;
        const extrasH = (d.extraDayH || 0) + (d.extraNightH || 0);
        const pagaDia = (d.worked && !d.descanso && !d.noProgramado);

        return `<tr style="background:${bg}">
          <td><b>${etiquetaDia}</b></td>
          <td>${tipo}</td>
          <td>${trabajado ? horarioHTML(d) : "-"}</td>
          <td class="n">${trabajado ? fmtHrs(d.dayHours) : "-"}</td>
          <td class="n">${trabajado ? fmtHrs(d.nightHours) : "-"}</td>
          <td class="n">${trabajado ? fmtHrs(extrasH) : "-"}</td>
          <td>${rec.length ? rec.join("<br/>") : "-"}</td>
          <td class="n"><b>${pagaDia ? formatCOP(c.total) : "-"}</b></td>
        </tr>`;
      }).join("");

      const mesLabelSem = `${MESES[s.first.month].label} ${s.first.year}`;
      const mesKeySem = `${s.first.year}-${pad(s.first.month + 1)}`;
      const rangoSem = labelSemana(s.first, s.last);
      semanasResumen.push({ label: `Semana ${s.numero} (${rangoSem})`, mesKey: mesKeySem, mesLabel: mesLabelSem, agg: aggS });

      seccionesSemanas += `
      <div class="sem">
        <h3>📅 Semana ${s.numero} · del ${rangoSem} · ${mesLabelSem}</h3>
        <table>
          <thead><tr>
            <th style="width:11%">Día</th><th style="width:11%">Tipo</th><th style="width:30%">Horario (entrada → salida)</th>
            <th style="width:7%">H. diurnas</th><th style="width:7%">H. nocturnas</th><th style="width:7%">H. extras</th>
            <th style="width:16%">Recargos</th><th style="width:11%">Pago del día</th>
          </tr></thead>
          <tbody>
            ${filasSem}
            <tr class="tot">
              <td colspan="3">TOTAL SEMANA ${s.numero} · ${aggS.dias} día${aggS.dias === 1 ? "" : "s"} trabajado${aggS.dias === 1 ? "" : "s"}</td>
              <td class="n">${fmtHrs(aggS.ordDia)}</td>
              <td class="n">${fmtHrs(aggS.ordNoche)}</td>
              <td class="n">${fmtHrs(aggS.extDia + aggS.extNoche)}</td>
              <td>${formatCOP(aggS.recNoche + aggS.recDom + aggS.recExt)}</td>
              <td class="n">${formatCOP(aggS.pago)}</td>
            </tr>
          </tbody>
        </table>
        <div class="sumsem">
          <b>⏱️ Horas de la semana ${s.numero}: ${fmtHrs(aggS.horas)}</b>
          (ordinarias ${fmtHrs(aggS.ordDia + aggS.ordNoche)} = diurnas ${fmtHrs(aggS.ordDia)} + nocturnas ${fmtHrs(aggS.ordNoche)}
          · extras ${fmtHrs(aggS.extDia + aggS.extNoche)})
        </div>
      </div>`;
    });

    // ── Resumen: semanas y total de cada mes ────────────────────────────────
    const mesesOrden = [];
    semanasResumen.forEach((r) => {
      if (!mesesOrden.find((m) => m.key === r.mesKey)) mesesOrden.push({ key: r.mesKey, label: r.mesLabel });
    });
    const totalPeriodo = aggVacio();
    let filasResumen = "";
    const filaAgg = (nombre, a, clase = "") =>
      `<tr class="${clase}">
        <td>${nombre}</td><td class="n">${a.dias}</td>
        <td class="n"><b>${fmtHrs(a.horas)}</b></td>
        <td class="n">${fmtHrs(a.ordDia)}</td><td class="n">${fmtHrs(a.ordNoche)}</td>
        <td class="n">${fmtHrs(a.extDia + a.extNoche)}</td>
        <td class="n">${formatCOP(a.recNoche)}</td><td class="n">${formatCOP(a.recDom)}</td><td class="n">${formatCOP(a.recExt)}</td>
        <td class="n">${formatCOP(a.pago)}</td>
      </tr>`;

    mesesOrden.forEach((m) => {
      const aggM = aggVacio();
      semanasResumen.filter((r) => r.mesKey === m.key).forEach((r) => {
        filasResumen += filaAgg(r.label, r.agg);
        sumarAgg(aggM, r.agg);
      });
      filasResumen += filaAgg(`TOTAL ${m.label.toUpperCase()}`, aggM, "tot");
      sumarAgg(totalPeriodo, aggM);
    });
    if (mesesOrden.length > 1) filasResumen += filaAgg("TOTAL DEL PERÍODO", totalPeriodo, "tot");

    const balRows = Object.values(savedBalances).map((b) => `
      <tr><td>${b.corte}</td><td>${b.contrato}</td><td>${b.dias}</td>
      <td>${formatCOP(b.totalBruto)}</td><td>${formatCOP(b.totalNeto)}</td></tr>`).join("");

    const acum = Object.values(savedBalances).reduce((s, b) => s + b.totalNeto, 0);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      body{font-family:Arial,sans-serif;padding:20px;color:#1a1a1a;font-size:11px}
      h1{color:#4F46E5;font-size:18px;margin-bottom:4px}h2{color:#6B7280;font-size:12px;font-weight:normal;margin-top:0}
      h3{color:#1E1B4B;font-size:13px;margin:18px 0 6px;background:#EEF2FF;padding:6px 8px;border-radius:6px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th{background:#4F46E5;color:#fff;padding:5px 4px;text-align:left;font-size:10px}
      td{padding:5px 4px;border-bottom:1px solid #E5E7EB;vertical-align:top;font-size:10px}
      td.n{text-align:right;white-space:nowrap}
      tr.tot td{background:#E0E7FF;font-weight:700;color:#1E1B4B;border-top:2px solid #4F46E5}
      .sem{page-break-inside:avoid;margin-bottom:10px}
      .sumsem{background:#F5F3FF;border-left:4px solid #7C3AED;padding:6px 8px;font-size:11px;margin-bottom:6px}
      .turno{margin-bottom:3px;line-height:1.35}
      .noc{color:#4338CA;font-weight:700}
      .guia{background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;padding:8px 10px;font-size:10px;line-height:1.5;margin:10px 0}
      .box{background:#1E1B4B;color:#fff;border-radius:8px;padding:14px;margin-top:10px;page-break-inside:avoid}
      .row{display:flex;justify-content:space-between;margin-bottom:4px}
      .lbl{color:#A5B4FC;font-size:11px}.val{color:#E0E7FF;font-weight:600;font-size:11px}
      .grand{font-size:20px;font-weight:800;color:#fff;text-align:right;margin-top:8px}
      .neto{background:#059669;border-radius:8px;padding:12px;margin-top:8px;text-align:center;page-break-inside:avoid}
      .neto-lbl{font-size:10px;color:rgba(255,255,255,.8);letter-spacing:1px}
      .neto-val{font-size:22px;font-weight:800;color:#fff}
      .tag{display:inline-block;background:#EEF2FF;color:#4F46E5;border-radius:4px;padding:2px 6px;font-size:10px}
    </style></head><body>
    <h1>💰 Liquidación de Nómina</h1>
    <h2>Período: ${labelCorte} · Contrato: ${contrato.label} · Tarifa hora: ${formatCOP(valorHora)}</h2>
    <span class="tag">Ley 2101: ${HORAS_SEMANA_2026}h/semana</span>

    <div class="guia">
      <b>Cómo leer este documento:</b> cada semana muestra, día por día, el horario trabajado (entrada → salida, 24 h),
      el descanso descontado y cuántas horas fueron <b>diurnas</b> (06:00–19:00) o <b>nocturnas</b> (19:00–06:00).<br/>
      Recargos aplicados: nocturno <b>+${pctNocTxt}%</b> · dominical/festivo <b>+${pctDomTxt}%</b> ·
      extra diurna <b>+${pctExtDiaTxt}%</b> · extra nocturna <b>+${pctExtNocTxt}%</b>.
      Al final de cada semana está la suma de horas, y al final del documento el total del mes.
    </div>

    <h3>🗓️ Detalle por semanas</h3>
    ${seccionesSemanas}

    <h3>⏱️ Resumen: horas por semana y total del mes</h3>
    <table>
      <thead><tr>
        <th>Semana / Mes</th><th>Días</th><th>Horas totales</th><th>H. diurnas</th><th>H. nocturnas</th><th>H. extras</th>
        <th>Rec. nocturno</th><th>Rec. dom/fest</th><th>Rec. extras</th><th>Pago días</th>
      </tr></thead>
      <tbody>${filasResumen || '<tr><td colspan="10">Sin datos</td></tr>'}</tbody>
    </table>
    <p style="font-size:9px;color:#6B7280">
      «Pago días» suma lo ganado por las horas de cada día (incluye los compensatorios). El descanso remunerado,
      prima, auxilio de transporte y deducciones se detallan en la liquidación de abajo.
    </p>

    <div class="box">
      <div class="row"><span class="lbl">Días trabajados</span><span class="val">${diasTrabajados.length}</span></div>
      <div class="row"><span class="lbl">Días de descanso</span><span class="val">${diasDescanso}</span></div>
      <div class="row"><span class="lbl">Días compensatorios (día libre)</span><span class="val">${diasCompensatorios}</span></div>
      <div class="row"><span class="lbl">Días especiales</span><span class="val">${diasEspeciales}</span></div>
      <div class="row"><span class="lbl">Días no programados (sin pago)</span><span class="val">${diasNoProgramados}</span></div>
      <div class="row"><span class="lbl">Subtotal ordinario</span><span class="val">${formatCOP(subtotalOrd)}</span></div>
      ${subtotalCompDinero > 0 ? `<div class="row"><span class="lbl">💰 Compensatorio pagado en dinero (incluido arriba)</span><span class="val">${formatCOP(subtotalCompDinero)}</span></div>` : ""}
      ${subtotalComp > 0 ? `<div class="row"><span class="lbl">🔄 Compensatorio · día libre otorgado</span><span class="val">${formatCOP(subtotalComp)}</span></div>` : ""}
      ${subtotalExt > 0 ? `<div class="row"><span class="lbl">⚡ Extras mes vencido</span><span class="val">${formatCOP(subtotalExt)}</span></div>` : ""}
      ${descRemunerado > 0 ? `<div class="row"><span class="lbl">Descanso remunerado (${fmtHrs(horasDescansoRem)})</span><span class="val">${formatCOP(descRemunerado)}</span></div>` : ""}
      ${primaLegal > 0 ? `<div class="row"><span class="lbl">Prima legal</span><span class="val">${formatCOP(primaLegal)}</span></div>` : ""}
      ${auxTransp > 0   ? `<div class="row"><span class="lbl">Aux. transporte</span><span class="val">${formatCOP(auxTransp)}</span></div>` : ""}
      <div class="grand">Bruto: ${formatCOP(totalBruto)}</div>
      ${totalDeduc > 0 ? `
      <div class="row" style="margin-top:8px"><span class="lbl">(-) Salud 4%</span><span class="val">-${formatCOP(deducSalud)}</span></div>
      <div class="row"><span class="lbl">(-) Pensión 4%</span><span class="val">-${formatCOP(deducPension)}</span></div>` : ""}
    </div>
    <div class="neto"><div class="neto-lbl">NETO A PAGAR</div><div class="neto-val">${formatCOP(totalNeto)}</div></div>
    ${Object.keys(savedBalances).length > 0 ? `
    <h3>Balance acumulado 2026</h3>
    <table><thead><tr><th>Período</th><th>Contrato</th><th>Días</th><th>Bruto</th><th>Neto</th></tr></thead>
    <tbody>${balRows}</tbody></table>
    <div class="neto"><div class="neto-lbl">ACUMULADO NETO 2026</div><div class="neto-val">${formatCOP(acum)}</div></div>` : ""}
    <p style="font-size:9px;color:#9CA3AF;margin-top:16px">
      Recargos CST Colombia · Ley 2101/2021 · Compensatorios CST art. 179-180 · Extras pagadas mes vencido
    </p></body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Exportar nómina", UTI: "com.adobe.pdf" });
      } else showAlert("PDF", uri);
    } catch (e) { showAlert("Error", e.message); }
  };

  // ── Acciones por día ──────────────────────────────────────────────────────
  const toggleWorked = useCallback((i) => setDays((prev) => {
    const nuevo = prev.map((d) => ({ ...d }));
    const item = nuevo[i];
    item.worked = !item.worked;
    if (!item.worked && item.especial && item.compensatorioTipo) {
      liberarCompensatorioDe(nuevo, item.label);
      item.compensatorioTipo = null;
      item.compensatorioOtorgado = false;
    }
    return nuevo;
  }), []);

  const toggleDescanso = useCallback((i) => setDays((prev) => {
    const nuevo = prev.map((d) => ({ ...d }));
    const item = nuevo[i];
    item.descanso = !item.descanso;
    item.compensatorio = false;
    item.noProgramado = false;
    item.worked = true;
    return nuevo;
  }), []);

  const toggleNoProgramado = useCallback((i) => setDays((prev) => {
    const nuevo = prev.map((d) => ({ ...d }));
    const item = nuevo[i];

    // Volver a programar el día
    if (item.noProgramado) {
      item.noProgramado = false;
      item.worked = true;
      return nuevo;
    }

    // Si era día libre compensatorio, liberar el festivo/domingo que lo originó
    if (item.compensatorio && item.compensatorioPor) {
      const origen = nuevo.find((d) => d.label === item.compensatorioPor);
      if (origen) { origen.compensatorioTipo = null; origen.compensatorioOtorgado = false; }
    }
    // Si era festivo/domingo con compensatorio asignado, liberarlo
    if (item.especial && item.compensatorioTipo) liberarCompensatorioDe(nuevo, item.label);

    item.compensatorio = false;
    item.compensatorioPor = null;
    item.compensatorioTipo = null;
    item.compensatorioOtorgado = false;
    item.descanso = false;
    item.worked = true;
    item.noProgramado = true;
    return nuevo;
  }), []);

  const toggleCompensatorio = useCallback((i) => setDays((prev) => {
    const nuevo = prev.map((d) => ({ ...d }));
    const item = nuevo[i];

    if (item.compensatorio) {
      const origenLabel = item.compensatorioPor;
      item.compensatorio = false;
      item.compensatorioPor = null;
      if (origenLabel) {
        const origen = nuevo.find((d) => d.label === origenLabel);
        if (origen) { origen.compensatorioTipo = null; origen.compensatorioOtorgado = false; }
      }
    } else {
      item.compensatorio = true;
      item.descanso = false;
      item.noProgramado = false;
      item.worked = true;
      const origen = nuevo.find((d) => d.especial && d.worked && !d.descanso && !d.noProgramado && !d.compensatorioTipo);
      if (origen) {
        origen.compensatorioTipo = "dia";
        origen.compensatorioOtorgado = true;
        item.compensatorioPor = origen.label;
      }
    }
    return nuevo;
  }), []);

  const toggleCompensatorioTipo = useCallback((i) => setDays((prev) => {
    const nuevo = prev.map((d) => ({ ...d }));
    const origen = nuevo[i];
    if (!origen.especial || !origen.worked || origen.descanso || origen.noProgramado) return prev;

    if (origen.compensatorioTipo === "dinero") {
      let asignado = false;
      for (let j = 0; j < nuevo.length; j++) {
        if (j === i) continue;
        const cand = nuevo[j];
        if (cand.worked && !cand.especial && !cand.descanso && !cand.compensatorio && !cand.noProgramado) {
          cand.compensatorio = true;
          cand.compensatorioPor = origen.label;
          origen.compensatorioTipo = "dia";
          origen.compensatorioOtorgado = true;
          asignado = true;
          break;
        }
      }
      if (!asignado) {
        showAlert(
          "Sin días disponibles",
          "No hay otro día ordinario libre en este período para otorgar como compensatorio. Se mantiene el pago en dinero."
        );
        return prev;
      }
    } else {
      liberarCompensatorioDe(nuevo, origen.label);
      origen.compensatorioTipo = "dinero";
      origen.compensatorioOtorgado = false;
    }
    return nuevo;
  }), []);

  const updateHours = useCallback((i, field, val) => setDays((p) => p.map((d, idx) => idx === i ? { ...d, [field]: val } : d)), []);

  // Reemplaza los turnos del día y recalcula SOLO las horas ordinarias
  // (diurnas y nocturnas = suma de todos los turnos). Las extras no se tocan.
  const setTurnosDia = useCallback((i, nuevosTurnos) => setDays((prev) => prev.map((d, idx) => {
    if (idx !== i) return d;
    const n = { ...d, turnos: nuevosTurnos };
    const r = calcularJornada(nuevosTurnos);
    return r ? { ...n, dayHours: r.dayHours, nightHours: r.nightHours } : n;
  })), []);

  const updateTurno = useCallback((i, t, patch) => setDays((prev) => prev.map((d, idx) => {
    if (idx !== i) return d;
    const nuevos = getTurnos(d).map((x, k) => (k === t ? { ...x, ...patch } : x));
    const n = { ...d, turnos: nuevos };
    const r = calcularJornada(nuevos);
    return r ? { ...n, dayHours: r.dayHours, nightHours: r.nightHours } : n;
  })), []);

  const agregarTurno = useCallback((i) => setDays((prev) => prev.map((d, idx) => {
    if (idx !== i) return d;
    return { ...d, turnos: [...getTurnos(d), turnoVacio(0)] };
  })), []);

  const quitarTurno = useCallback((i, t) => setDays((prev) => prev.map((d, idx) => {
    if (idx !== i) return d;
    const actuales = getTurnos(d);
    if (actuales.length <= 1) return d;
    const nuevos = actuales.filter((_, k) => k !== t);
    const n = { ...d, turnos: nuevos };
    const r = calcularJornada(nuevos);
    return r ? { ...n, dayHours: r.dayHours, nightHours: r.nightHours } : n;
  })), []);

  // ── Render día ────────────────────────────────────────────────────────────
  const renderDay = (item, index) => {
    const isExp = expandedDay === index;
    const cost  = calcDay(item);
    const isEsp = item.especial && !item.descanso && !item.compensatorio;

    if (item.noProgramado) {
      return (
        <View key={index} style={ss.dayRowNoProg}>
          <View style={{ flex: 1 }}>
            <Text style={ss.dayNumNoProg}>{`⛔ ${item.label}`}</Text>
            <Text style={ss.dayStatusOff}>No programado (sin remuneración)</Text>
          </View>
          <TouchableOpacity onPress={() => toggleNoProgramado(index)} style={ss.toggleBtn}>
            <Text style={ss.toggleBtnText}>Programar</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (item.compensatorio) {
      return (
        <View key={index} style={ss.dayRowCompensatorio}>
          <View style={{ flex: 1 }}>
            <Text style={ss.dayNumCompensatorio}>{`🔄 ${item.label}`}</Text>
            <Text style={ss.dayStatusOff}>
              {`Día libre compensatorio (remunerado)${item.compensatorioPor ? ` · por ${item.compensatorioPor}` : ""}`}
            </Text>
          </View>
          <Text style={ss.dayCostComp}>{formatCOP(cost.total)}</Text>
          <TouchableOpacity onPress={() => toggleCompensatorio(index)} style={ss.toggleBtn}>
            <Text style={ss.toggleBtnText}>Trabajé</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (item.descanso) {
      return (
        <View key={index} style={ss.dayRowDescanso}>
          <View style={{ flex: 1 }}>
            <Text style={ss.dayNumDescanso}>{`🛌 ${item.label}`}</Text>
            <Text style={ss.dayStatusOff}>Día de descanso (remunerado)</Text>
          </View>
          <TouchableOpacity onPress={() => toggleDescanso(index)} style={ss.toggleBtn}>
            <Text style={ss.toggleBtnText}>Trabajé</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!item.worked) {
      return (
        <TouchableOpacity key={index} style={ss.dayRowOff} onPress={() => toggleWorked(index)}>
          <Text style={ss.dayNumOff}>{item.label}</Text>
          <Text style={ss.dayStatusOff}>No trabajado — toca para activar</Text>
        </TouchableOpacity>
      );
    }

    const turnos = getTurnos(item);
    const turnosValidos = turnos.filter((t) => calcularTurno(t));
    const textoHorario = turnosValidos.map((t) => `${t.entrada}–${t.salida}`).join(" · ");
    const horasCompactas =
      `${textoHorario ? '🕐' + textoHorario + ' · ' : ''}` +
      `${item.dayHours > 0 ? '☀️' + fmtHrs(item.dayHours) + ' ' : ''}${item.nightHours > 0 ? '🌙' + fmtHrs(item.nightHours) : ''}`;

    const jornada = calcularJornada(turnos);

    return (
      <View key={index} style={[ss.dayRow, isEsp && ss.dayRowEsp]}>
        <TouchableOpacity style={ss.dayRowHeader}
          onPress={() => setExpandedDay(isExp ? null : index)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={ss.dayNum}>{item.label}</Text>
              {item.festivo && <View style={ss.badge}><Text style={ss.badgeText}>🎉 Festivo</Text></View>}
              {item.domingo && !item.festivo && <View style={ss.badge}><Text style={ss.badgeText}>🛐 Domingo</Text></View>}
            </View>
            {isEsp && <Text style={ss.recargoBadge}>Recargo dominical/festivo aplicado</Text>}
            {isEsp && item.compensatorioTipo === "dia" && (
              <Text style={ss.recargoBadgeComp}>{`🔄 Compensa con: ${item.compensatorioPor}`}</Text>
            )}
            {isEsp && item.compensatorioTipo === "dinero" && (
              <Text style={ss.recargoBadgeMoney}>💰 Compensatorio pagado en dinero</Text>
            )}
            {isEsp && !item.compensatorioTipo && (
              <Text style={ss.recargoBadgeWarn}>⚠️ Compensatorio pendiente</Text>
            )}
            <Text style={ss.hoursCompact}>{horasCompactas}</Text>
          </View>
          <Text style={[ss.dayCost, isEsp && ss.dayCostEsp]}>{formatCOP(cost.total)}</Text>
          <Text style={ss.expandIcon}>{isExp ? "▲" : "▼"}</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {isEsp ? (
              <TouchableOpacity onPress={() => toggleCompensatorioTipo(index)} style={ss.compBtn}>
                <Text style={ss.compBtnText}>{item.compensatorioTipo === "dinero" ? "🔄" : "💰"}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => toggleCompensatorio(index)} style={ss.compBtn}>
                <Text style={ss.compBtnText}>🔄</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => toggleDescanso(index)} style={ss.descansoBtn}>
              <Text style={ss.descansoBtnText}>🛌</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleNoProgramado(index)} style={ss.noProgBtn}>
              <Text style={ss.descansoBtnText}>⛔</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleWorked(index)} style={ss.removeBtn}>
              <Text style={ss.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {isExp && (
          <View style={ss.expandedContent}>
            {/* Turnos de entrada / salida (24 h) */}
            <Text style={ss.groupLabel}>🕐 Horario (formato 24 h)</Text>

            {turnos.map((t, k) => {
              const r = jornada ? jornada.detalle[k] : calcularTurno(t);
              return (
                <View key={k} style={ss.turnoBox}>
                  <View style={ss.turnoHeader}>
                    <Text style={ss.turnoTitle}>{`Turno ${k + 1}`}</Text>
                    {turnos.length > 1 && (
                      <TouchableOpacity onPress={() => quitarTurno(index, k)}>
                        <Text style={ss.turnoQuitar}>🗑 Quitar</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={ss.stepperGrid}>
                    <HoraInput label="Entrada" value={t.entrada}
                      onChange={(v) => updateTurno(index, k, { entrada: v })} />
                    <HoraInput label="Salida" value={t.salida}
                      onChange={(v) => updateTurno(index, k, { salida: v })} />
                  </View>
                  <Text style={[ss.stepperLabel, { marginTop: 8 }]}>Descanso (no se paga)</Text>
                  <View style={{ flexDirection: "row", gap: 6, marginBottom: 4 }}>
                    {[0, 30, 45, 60].map((m) => (
                      <TouchableOpacity key={m}
                        style={[ss.weekChip, (t.descansoMin ?? 0) === m && ss.weekChipActive]}
                        onPress={() => updateTurno(index, k, { descansoMin: m })}>
                        <Text style={[ss.weekChipText, (t.descansoMin ?? 0) === m && ss.weekChipTextActive]}>
                          {m === 0 ? "Sin" : `${m} min`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {r && (
                    <Text style={ss.cutDesc}>
                      {`Trabajó ${fmtHrs(r.total)} · ☀️ ${fmtHrs(r.dayHours)} · 🌙 ${fmtHrs(r.nightHours)}`}
                    </Text>
                  )}
                </View>
              );
            })}

            <TouchableOpacity style={ss.addTurnoBtn} onPress={() => agregarTurno(index)}>
              <Text style={ss.addTurnoText}>➕ Agregar otro turno en este día</Text>
            </TouchableOpacity>

            {jornada && (
              <Text style={[ss.cutDesc, { marginTop: 8, fontWeight: "700", color: "#4F46E5" }]}>
                {`Total del día: ${fmtHrs(jornada.total)} (☀️ ${fmtHrs(jornada.dayHours)} · 🌙 ${fmtHrs(jornada.nightHours)})`}
              </Text>
            )}
            {jornada && jornada.solapa && (
              <Text style={ss.alertText}>⚠️ Hay turnos que se cruzan entre sí. Revisa las horas de entrada y salida.</Text>
            )}

            <Text style={[ss.groupLabel, { marginTop: 10 }]}>Horas ordinarias</Text>
            <View style={ss.stepperGrid}>
              <Stepper label={`☀️ Diurnas${isEsp ? " (+75%)" : ""}`}
                value={item.dayHours} onChange={(v) => updateHours(index, "dayHours", v)} />
              <Stepper label={`🌙 Nocturnas${isEsp ? " (+150%)" : " (+35%)"}`}
                value={item.nightHours} onChange={(v) => updateHours(index, "nightHours", v)} />
            </View>
            <Text style={[ss.groupLabel, { marginTop: 10, color: "#F59E0B" }]}>
              ⚡ Horas extras (manuales · se pagan el siguiente corte)
            </Text>
            <View style={ss.stepperGrid}>
              <Stepper label={`⚡☀️ Extra diurna${isEsp ? " (+100%)" : " (+25%)"}`}
                value={item.extraDayH || 0} onChange={(v) => updateHours(index, "extraDayH", v)} />
              <Stepper label={`⚡🌙 Extra nocturna${isEsp ? " (+150%)" : " (+75%)"}`}
                value={item.extraNightH || 0} onChange={(v) => updateHours(index, "extraNightH", v)} />
            </View>
            <View style={ss.desglose}>
              <Text style={ss.desgloseTitle}>Desglose del día</Text>
              {[
                ["☀️ Base diurno",  cost.detail.baseDia],
                ["🌙 Base nocturno", cost.detail.baseNoche],
              ].map(([l, v]) => v > 0 ? (
                <View key={l} style={ss.desgloseRow}>
                  <Text style={ss.desgloseLabel}>{l}</Text>
                  <Text style={ss.desgloseValue}>{formatCOP(v)}</Text>
                </View>
              ) : null)}
              {((item.extraDayH > 0) || (item.extraNightH > 0)) && (<>
                <View style={[ss.desgloseRow, { marginTop: 6 }]}>
                  <Text style={[ss.desgloseLabel, { color: "#F59E0B" }]}>⚡ Extras (mes vencido)</Text>
                </View>
                {cost.detail.recExtDia > 0 && (
                  <View style={ss.desgloseRow}>
                    <Text style={ss.desgloseLabel}>Extra diurna</Text>
                    <Text style={[ss.desgloseValue, { color: "#F59E0B" }]}>{formatCOP(cost.detail.recExtDia)}</Text>
                  </View>
                )}
                {cost.detail.recExtNoc > 0 && (
                  <View style={ss.desgloseRow}>
                    <Text style={ss.desgloseLabel}>Extra nocturna</Text>
                    <Text style={[ss.desgloseValue, { color: "#F59E0B" }]}>{formatCOP(cost.detail.recExtNoc)}</Text>
                  </View>
                )}
              </>)}
            </View>
          </View>
        )}
      </View>
    );
  };

  const balanceList = Object.values(savedBalances);
  const acumNeto    = balanceList.reduce((s, b) => s + b.totalNeto, 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <View style={ss.container}>
        <ScrollView contentContainerStyle={ss.scroll}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

          {/* Header */}
          <View style={ss.header}>
            <Text style={ss.headerTitle}>💰 Nómina Colombia 2026</Text>
            <Text style={ss.headerSub}>{`Ley 2101 · ${HORAS_SEMANA_2026}h/sem · CST actualizado`}</Text>
            {loadingBalances ? (
              <ActivityIndicator color="#C7D2FE" style={{ marginTop: 10 }} />
            ) : balanceList.length > 0 && (
              <TouchableOpacity style={ss.headerBalanceBtn} onPress={() => setBalanceModal(true)}>
                <Text style={ss.headerBalanceBtnText}>
                  {`📊 Balance (${balanceList.length} período${balanceList.length > 1 ? "s" : ""}) · ☁️ sincronizado`}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Tipo de contrato */}
          <View style={ss.card}>
            <Text style={ss.sectionTitle}>Tipo de contrato</Text>
            <TouchableOpacity style={ss.selectBtn} onPress={() => setModalContrato(true)}>
              <Text style={ss.selectBtnText}>{`${contrato.icon} ${contrato.label}`}</Text>
            </TouchableOpacity>
            <Text style={ss.contractDesc}>{contrato.desc}</Text>
            {contrato.id === "servicios" && (
              <View style={ss.alertBox}>
                <Text style={ss.alertText}>⚠️ Sin auxilio de transporte ni deducciones de empleado. El contratista paga salud y pensión como independiente.</Text>
              </View>
            )}
          </View>

          {/* Salario / Valor hora */}
          <View style={ss.card}>
            {isPartTime ? (
              <>
                <View style={ss.modoRow}>
                  <TouchableOpacity style={[ss.modoBtn, !modoSueldoPT && ss.modoBtnActive]} onPress={() => setModoSueldoPT(false)}>
                    <Text style={[ss.modoBtnText, !modoSueldoPT && ss.modoBtnTextActive]}>⏱ Valor por hora</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[ss.modoBtn, modoSueldoPT && ss.modoBtnActive]} onPress={() => setModoSueldoPT(true)}>
                    <Text style={[ss.modoBtnText, modoSueldoPT && ss.modoBtnTextActive]}>💼 Sueldo base mensual</Text>
                  </TouchableOpacity>
                </View>

                {!modoSueldoPT ? (
                  <>
                    <Text style={ss.sectionTitle}>💵 Valor hora (COP)</Text>
                    <TextInput
                      style={ss.rateInputBig}
                      placeholder="Ej: 8500"
                      placeholderTextColor="#aaa"
                      keyboardType="numeric"
                      returnKeyType="done"
                      blurOnSubmit
                      value={valorHoraManual}
                      onChangeText={setValorHoraManual}
                    />
                    {valorHora > 0 && (
                      <View style={ss.infoRow}>
                        <Text style={ss.infoText}>Valor hora ingresado</Text>
                        <Text style={ss.infoVal}>{`${formatCOP(valorHora)}/hora`}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={ss.sectionTitle}>💼 Sueldo/Salario básico (COP)</Text>
                    <Text style={ss.cutDesc}>
                      El valor que aparece explícito en tu desprendible de pago. La app calcula el
                      valor hora dividiendo entre las horas del mes, igual que en un contrato full time.
                    </Text>
                    <TextInput
                      style={ss.rateInputBig}
                      placeholder="Ej: 1.857.000"
                      placeholderTextColor="#aaa"
                      keyboardType="numeric"
                      returnKeyType="done"
                      blurOnSubmit
                      value={salarioBasePT}
                      onChangeText={setSalarioBasePT}
                    />
                    {salarioBasePTNum > 0 && (
                      <View style={ss.infoRow}>
                        <Text style={ss.infoText}>Valor hora calculado</Text>
                        <Text style={ss.infoVal}>{`${formatCOP(valorHoraPTCalc)}/hora`}</Text>
                      </View>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <View style={ss.modoRow}>
                  <TouchableOpacity style={[ss.modoBtn, !modoHora && ss.modoBtnActive]} onPress={() => setModoHora(false)}>
                    <Text style={[ss.modoBtnText, !modoHora && ss.modoBtnTextActive]}>💼 Salario mensual</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[ss.modoBtn, modoHora && ss.modoBtnActive]} onPress={() => setModoHora(true)}>
                    <Text style={[ss.modoBtnText, modoHora && ss.modoBtnTextActive]}>⏱ Valor por hora</Text>
                  </TouchableOpacity>
                </View>
                {!modoHora ? (
                  <>
                    <TextInput
                      style={ss.rateInputBig}
                      placeholder={`Mín: ${formatCOP(SMMLV_2026)}`}
                      placeholderTextColor="#aaa"
                      keyboardType="numeric"
                      returnKeyType="done"
                      blurOnSubmit
                      value={salarioBase}
                      onChangeText={setSalarioBase}
                    />
                    {salario > 0 && (
                      <View style={ss.infoRow}>
                        <Text style={ss.infoText}>Valor hora calculado</Text>
                        <Text style={ss.infoVal}>{`${formatCOP(valorHoraCalc)}/hora`}</Text>
                      </View>
                    )}
                    {salario > 0 && salario < SMMLV_2026 && (
                      <View style={ss.alertBox}>
                        <Text style={ss.alertText}>{`⚠️ Por debajo del SMMLV 2026 (${formatCOP(SMMLV_2026)})`}</Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <TextInput
                      style={ss.rateInputBig}
                      placeholder="Ej: 9.500"
                      placeholderTextColor="#aaa"
                      keyboardType="numeric"
                      returnKeyType="done"
                      blurOnSubmit
                      value={valorHoraManual}
                      onChangeText={setValorHoraManual}
                    />
                    {valorHoraIngresado > 0 && (
                      <View style={ss.infoRow}>
                        <Text style={ss.infoText}>Valor hora ingresado</Text>
                        <Text style={ss.infoVal}>{`${formatCOP(valorHoraIngresado)}/hora`}</Text>
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            {contrato.auxTransporte && (
              <View style={ss.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ss.toggleLabel}>Auxilio de transporte</Text>
                  <Text style={ss.toggleSub}>
                    {isPartTime
                      ? (auxCompletoPT
                          ? `${formatCOP(auxTransporteValor)}/mes completo · full time`
                          : `Proporcional a horas · base ${formatCOP(auxTransporteValor)}`)
                      : `${formatCOP(auxTransporteValor)}/mes · solo si salario ≤ 2 SMMLV`}
                  </Text>
                </View>
                <Switch value={inclAuxTransp} onValueChange={setInclAuxTransp} trackColor={{ true: "#4F46E5" }} />
              </View>
            )}
            {contrato.auxTransporte && inclAuxTransp && (
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: "#F3F4F6" }}>
                <Text style={ss.cutLabel}>Valor del auxilio (COP)</Text>
                <TextInput
                  style={ss.cutInput}
                  keyboardType="numeric"
                  returnKeyType="done"
                  blurOnSubmit
                  value={auxTransporteInput}
                  onChangeText={setAuxTransporteInput}
                  placeholder={String(AUX_TRANSPORTE_DEFAULT)}
                />
              </View>
            )}
            {isPartTime && contrato.auxTransporte && (
              <View style={ss.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ss.toggleLabel}>Aux. transporte completo (full time)</Text>
                  <Text style={ss.toggleSub}>Desactivado = proporcional a las horas trabajadas del mes</Text>
                </View>
                <Switch value={auxCompletoPT} onValueChange={setAuxCompletoPT} trackColor={{ true: "#4F46E5" }} />
              </View>
            )}
            {contrato.prestaciones && (
              <View style={ss.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={ss.toggleLabel}>Deducciones de ley</Text>
                  <Text style={ss.toggleSub}>Salud 4% + Pensión 4% sobre devengado</Text>
                </View>
                <Switch value={inclDeducciones} onValueChange={setInclDeducciones} trackColor={{ true: "#4F46E5" }} />
              </View>
            )}
          </View>

          {/* Recargos personalizables */}
          <View style={ss.card}>
            <TouchableOpacity style={ss.recargoToggleRow} onPress={() => setShowRecargos(!showRecargos)}>
              <View style={{ flex: 1 }}>
                <Text style={ss.sectionTitle}>⚙️ Recargos personalizados</Text>
                <Text style={ss.cutDesc}>
                  {showRecargos ? "Toca para ocultar" :
                    `Noc ${pctNocturno}% · Ext día ${pctExtDia}% · Ext noche ${pctExtNoche}% · Dom/fest ${isPartTime ? domPct : pctDomOrd}%`}
                </Text>
              </View>
              <Text style={ss.expandIcon}>{showRecargos ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {showRecargos && (
              <View style={{ marginTop: 12 }}>
                <View style={ss.recargoInputGrid}>
                  {[
                    ["🌙 Nocturno ord.",     pctNocturno, setPctNocturno, "35"],
                    ["⚡☀️ Extra diurno",    pctExtDia,   setPctExtDia,   "25"],
                    ["⚡🌙 Extra nocturno",  pctExtNoche, setPctExtNoche, "75"],
                    [isPartTime ? "🟡 Dom/fest (D1)" : "🟡 Dom/fest ord.",
                     isPartTime ? domPct : pctDomOrd,
                     isPartTime ? setDomPct : setPctDomOrd,
                     isPartTime ? "80" : "75"],
                  ].map(([label, val, setter, def]) => (
                    <View key={label} style={ss.recargoInputItem}>
                      <Text style={ss.recargoInputLabel}>{label}</Text>
                      <View style={ss.recargoInputRow}>
                        <TextInput style={ss.recargoInput} keyboardType="numeric"
                          returnKeyType="done" blurOnSubmit value={val} onChangeText={setter} />
                        <Text style={ss.recargoInputSuffix}>%</Text>
                      </View>
                      <Text style={ss.recargoMult}>{`×${(1 + (parseFloat(val) || parseFloat(def)) / 100).toFixed(2)}`}</Text>
                    </View>
                  ))}
                </View>
                <TouchableOpacity style={ss.resetBtn} onPress={() => {
                  setPctNocturno("35"); setPctExtDia("25"); setPctExtNoche("75"); setPctDomOrd("75");
                  if (isPartTime) setDomPct("80");
                }}>
                  <Text style={ss.resetBtnText}>↺ Restaurar valores legales</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Config D1 Part Time */}
          {isPartTime && (
            <View style={ss.card}>
              <Text style={ss.sectionTitle}>🏪 Configuración D1 Part Time</Text>
              <Text style={ss.cutLabel}>% Recargo dominical / festivo</Text>
              <View style={ss.domRow}>
                <TextInput style={[ss.cutInput, { flex: 1 }]} keyboardType="numeric"
                  returnKeyType="done" blurOnSubmit value={domPct} onChangeText={setDomPct} />
                <View style={ss.domInfo}>
                  <Text style={ss.domInfoText}>{`×${(1 + (parseFloat(domPct) || 80) / 100).toFixed(2)}`}</Text>
                  <Text style={ss.domInfoSub}>Tu liquidación muestra 80%</Text>
                </View>
              </View>
              <View style={ss.dividerLight} />
              <Text style={[ss.cutLabel, { marginTop: 10 }]}>Descanso remunerado</Text>
              <Text style={ss.toggleSub}>1 día por cada N días trabajados</Text>
              <View style={ss.domRow}>
                <TextInput style={[ss.cutInput, { flex: 1 }]} keyboardType="numeric"
                  returnKeyType="done" blurOnSubmit value={diasXDescanso} onChangeText={setDiasXDescanso} />
                <View style={ss.domInfo}>
                  {diasTrabajados.length > 0 && (
                    <Text style={ss.domInfoText}>{`${fmtHrs(horasDescansoRem)} de descanso rem.`}</Text>
                  )}
                  <Text style={ss.domInfoSub}>{`= ${formatCOP(descRemunerado)}`}</Text>
                </View>
              </View>
              <View style={ss.dividerLight} />
              <View style={[ss.toggleRow, { marginTop: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={ss.toggleLabel}>Prima legal proporcional</Text>
                  <Text style={ss.toggleSub}>
                    {inclPrima ? `≈ ${formatCOP(primaLegal)} (${days.length} días / 360 / 2)` : "Activar para incluir en este período"}
                  </Text>
                </View>
                <Switch value={inclPrima} onValueChange={setInclPrima} trackColor={{ true: "#4F46E5" }} />
              </View>
              {valorHora > 0 && totalHorasPT > 0 && (
                <View style={[ss.infoRow, { marginTop: 10 }]}>
                  <Text style={ss.infoText}>Total horas período</Text>
                  <Text style={ss.infoVal}>{fmtHrs(totalHorasPT)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Fecha de corte */}
          <View style={ss.card}>
            <Text style={ss.sectionTitle}>📆 Fecha de corte</Text>
            <Text style={ss.cutDesc}>Define el período de nómina. Puede cruzar meses.</Text>
            <View style={ss.cutRow}>
              <View style={{ flex: 1 }}>
                <Text style={ss.cutLabel}>Desde — día</Text>
                <TextInput style={ss.cutInput} keyboardType="numeric"
                  returnKeyType="done" blurOnSubmit value={diaInicio} onChangeText={setDiaInicio} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.cutLabel}>Mes</Text>
                <TouchableOpacity style={ss.cutMesBtn} onPress={() => setModalMesInicio(true)}>
                  <Text style={ss.cutMesBtnText}>{MESES[mesInicio].label}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={ss.cutRow}>
              <View style={{ flex: 1 }}>
                <Text style={ss.cutLabel}>Hasta — día</Text>
                <TextInput style={ss.cutInput} keyboardType="numeric"
                  returnKeyType="done" blurOnSubmit value={diaFin} onChangeText={setDiaFin} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.cutLabel}>Mes</Text>
                <TouchableOpacity style={ss.cutMesBtn} onPress={() => setModalMesFin(true)}>
                  <Text style={ss.cutMesBtnText}>{MESES[mesFin].label}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={ss.applyBtn} onPress={cargarCorte}>
              <Text style={ss.applyBtnText}>{`📅 Cargar período ${diaInicio}/${pad(mesInicio + 1)} → ${diaFin}/${pad(mesFin + 1)}`}</Text>
            </TouchableOpacity>
          </View>

          {/* Extras mes vencido */}
          {contrato.mesVencido && (
            <View style={ss.card}>
              <Text style={ss.sectionTitle}>⚡ Horas extras (mes vencido)</Text>
              <Text style={ss.cutDesc}>Extras del período anterior que se pagan en este corte.</Text>
              <View style={ss.stepperGrid}>
                <Stepper label="⚡☀️ Extra diurna (+25%)"
                  value={extrasPeriodoAnterior.extDayH}
                  onChange={(v) => setExtrasPeriodoAnterior(p => ({ ...p, extDayH: v }))} />
                <Stepper label="⚡🌙 Extra nocturna (+75%)"
                  value={extrasPeriodoAnterior.extNightH}
                  onChange={(v) => setExtrasPeriodoAnterior(p => ({ ...p, extNightH: v }))} />
              </View>
              <View style={[ss.stepperGrid, { marginTop: 10 }]}>
                <Stepper label="🟡⚡☀️ Dom/Fest extra día"
                  value={extrasPeriodoAnterior.extDomDayH}
                  onChange={(v) => setExtrasPeriodoAnterior(p => ({ ...p, extDomDayH: v }))} />
                <Stepper label="🟡⚡🌙 Dom/Fest extra noche"
                  value={extrasPeriodoAnterior.extDomNightH}
                  onChange={(v) => setExtrasPeriodoAnterior(p => ({ ...p, extDomNightH: v }))} />
              </View>
              {subtotalExt > 0 && (
                <View style={ss.infoRow}>
                  <Text style={ss.infoText}>Total extras vencidas</Text>
                  <Text style={[ss.infoVal, { color: "#059669" }]}>{formatCOP(subtotalExt)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Leyenda */}
          {corteCargado && (
            <View style={ss.legendRow}>
              {[["Normal","#fff","#E5E7EB"],["Domingo","#FEF08A",null],
                ["Festivo","#FDE68A","#F59E0B"],["Descanso","#DBEAFE","#93C5FD"],
                ["Compensatorio","#DDD6FE","#8B5CF6"],
                ["No programado","#E5E7EB","#9CA3AF"],
                ["No trabajado","#F3F4F6","#E5E7EB"]].map(([l,bg,border])=>(
                <View key={l} style={ss.legendItem}>
                  <View style={[ss.legendDot,{backgroundColor:bg,borderColor:border||bg,borderWidth:border?1:0}]}/>
                  <Text style={ss.legendText}>{l}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Resumen de horas y recargos por semana / mensual (sin tope semanal) */}
          {corteCargado && resumenHoras.semanas.length > 0 && (
            <View style={ss.card}>
              <Text style={ss.sectionTitle}>⏱️ Total de horas</Text>

              <Text style={ss.groupLabel}>Por semana</Text>
              {resumenHoras.semanas.map((s) => (
                <View key={s.key} style={[ss.desglose, { marginBottom: 8 }]}>
                  <View style={ss.desgloseRow}>
                    <Text style={[ss.desgloseLabel, { fontWeight: "700" }]}>
                      {`${s.mesLabel} · Semana ${s.numero}`}
                    </Text>
                    <Text style={ss.desgloseValue}>{fmtHrs(s.horas)}</Text>
                  </View>
                  <FilasAgg a={s} />
                </View>
              ))}

              <Text style={[ss.groupLabel, { marginTop: 10 }]}>Total del mes</Text>
              {resumenHoras.meses.map((m) => (
                <View key={m.key} style={[ss.desglose, { marginBottom: 8 }]}>
                  <View style={ss.desgloseRow}>
                    <Text style={[ss.desgloseLabel, { fontWeight: "700" }]}>{m.label}</Text>
                    <Text style={ss.desgloseValue}>{fmtHrs(m.horas)}</Text>
                  </View>
                  <FilasAgg a={m} />
                </View>
              ))}
            </View>
          )}

          {/* Calendario */}
          {corteCargado && days.length > 0 && (
            <View style={ss.card}>
              <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                <Text style={[ss.sectionTitle, { flex: 1 }]}>
                  {`Días · ${diasTrabajados.length} trabajados · ${diasDescanso} descanso · ${diasCompensatorios} comp. · ${diasNoProgramados} no prog.`}
                </Text>
                <TouchableOpacity style={ss.scanBtn} onPress={() => setScannerVisible(true)}>
                  <Text style={ss.scanBtnText}>📷 Escanear</Text>
                </TouchableOpacity>
              </View>
              <Text style={ss.cutDesc}>
                Toca 🛌 descanso · ⛔ no programado (no trabaja y no se paga) · ✕ no trabajado · en domingo/festivo trabajado, 💰/🔄 alterna entre
                pagarlo en dinero u otorgar día libre · en un día ordinario, 🔄 lo marca como ese día libre
              </Text>

              {/* Día en que empieza la semana */}
              <Text style={ss.cutLabel}>La semana empieza el:</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {DIAS_SEMANA.map((x) => (
                  <TouchableOpacity key={x.v}
                    style={[ss.weekChip, inicioSemana === x.v && ss.weekChipActive]}
                    onPress={() => { setInicioSemana(x.v); setSemanaSel(null); }}>
                    <Text style={[ss.weekChipText, inicioSemana === x.v && ss.weekChipTextActive]}>{x.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Selector de semanas */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    style={[ss.weekChip, !semanaSel && ss.weekChipActive]}
                    onPress={() => setSemanaSel(null)}>
                    <Text style={[ss.weekChipText, !semanaSel && ss.weekChipTextActive]}>Todo</Text>
                  </TouchableOpacity>
                  {semanasPeriodo.map((s) => (
                    <TouchableOpacity key={s.key}
                      style={[ss.weekChip, semanaSel === s.key && ss.weekChipActive]}
                      onPress={() => setSemanaSel(s.key)}>
                      <Text style={[ss.weekChipText, semanaSel === s.key && ss.weekChipTextActive]}>
                        {`Sem ${s.numero}`}
                      </Text>
                      <Text style={[ss.weekChipSub, semanaSel === s.key && ss.weekChipTextActive]}>
                        {labelSemana(s.first, s.last)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {resumenSemana && (
                <View style={[ss.infoRow, { marginBottom: 10 }]}>
                  <Text style={ss.infoText}>
                    {`${resumenSemana.trabajados} días · ${fmtHrs(resumenSemana.horas)}`}
                  </Text>
                  <Text style={ss.infoVal}>{formatCOP(resumenSemana.total)}</Text>
                </View>
              )}

              {days.map((item, index) => {
                const wk = getSemanaMes(item.year, item.month, item.day, inicioSemana);
                if (semanaSel && wk.key !== semanaSel) return null;
                const prev = days[index - 1];
                const nueva = !prev || getSemanaMes(prev.year, prev.month, prev.day, inicioSemana).key !== wk.key;
                return (
                  <React.Fragment key={index}>
                    {nueva && !semanaSel && (
                      <Text style={ss.weekHeader}>{`${MESES[item.month].label} · Semana ${wk.numero}`}</Text>
                    )}
                    {renderDay(item, index)}
                  </React.Fragment>
                );
              })}
            </View>
          )}

          {/* Resumen */}
          {corteCargado && (
            <View style={ss.totalsCard}>
              <Text style={ss.totalsTitle}>📊 Liquidación del período</Text>
              <Text style={ss.totalsSubtitle}>{`${contrato.icon} ${contrato.label} · ${labelCorte}`}</Text>

              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días trabajados</Text>
                <Text style={ss.totalValue}>
                  {`${diasTrabajados.length}${isPartTime ? ` · ${fmtHrs(totalHorasPT)} total` : " días"}`}
                </Text>
              </View>
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días de descanso</Text>
                <Text style={ss.totalValue}>{`${diasDescanso} días`}</Text>
              </View>
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días compensatorios</Text>
                <Text style={ss.totalValue}>{`${diasCompensatorios} días`}</Text>
              </View>
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días especiales</Text>
                <Text style={ss.totalValue}>{`${diasEspeciales} días`}</Text>
              </View>
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días no programados</Text>
                <Text style={ss.totalValue}>{`${diasNoProgramados} días`}</Text>
              </View>

              <View style={ss.divider} />

              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>{`1088 · Salario horas (${fmtHrs(totalHorasPT)})`}</Text>
                <Text style={ss.totalValue}>{formatCOP(subtotalOrd)}</Text>
              </View>
              {subtotalExt > 0 && (
                <View style={ss.totalRow}>
                  <Text style={ss.totalLabel}>⚡ Recargos mes vencido</Text>
                  <Text style={ss.totalValue}>{formatCOP(subtotalExt)}</Text>
                </View>
              )}
              {subtotalCompDinero > 0 && (
                <View style={ss.totalRow}>
                  <Text style={[ss.totalLabel, { color: "#FCD34D" }]}>💰 Compensatorio pagado en dinero</Text>
                  <Text style={[ss.totalValue, { color: "#FCD34D" }]}>{formatCOP(subtotalCompDinero)}</Text>
                </View>
              )}
              {subtotalComp > 0 && (
                <View style={ss.totalRow}>
                  <Text style={ss.totalLabel}>🔄 Compensatorio (día libre otorgado)</Text>
                  <Text style={ss.totalValue}>{formatCOP(subtotalComp)}</Text>
                </View>
              )}
              {descRemunerado > 0 && (
                <View style={ss.totalRow}>
                  <Text style={ss.totalLabel}>{`1414 · Descanso remunerado PT (${fmtHrs(horasDescansoRem)})`}</Text>
                  <Text style={ss.totalValue}>{formatCOP(descRemunerado)}</Text>
                </View>
              )}
              {primaLegal > 0 && (
                <View style={ss.totalRow}>
                  <Text style={ss.totalLabel}>{`1230 · Prima legal (${diasPeriodo} días)`}</Text>
                  <Text style={ss.totalValue}>{formatCOP(primaLegal)}</Text>
                </View>
              )}
              {auxTransp > 0 && (
                <View style={ss.totalRow}>
                  <Text style={ss.totalLabel}>1035 · Aux. transporte PT</Text>
                  <Text style={ss.totalValue}>{formatCOP(auxTransp)}</Text>
                </View>
              )}

              <View style={ss.grandTotalBox}>
                <Text style={ss.grandTotalLabel}>TOTAL BRUTO</Text>
                <Text style={ss.grandTotalValue}>{formatCOP(totalBruto)}</Text>
              </View>

              {totalDeduc > 0 && (<>
                <View style={ss.divider} />
                {[["(-) Salud 4%", deducSalud], ["(-) Pensión 4%", deducPension]].map(([l, v]) => (
                  <View key={l} style={ss.totalRow}>
                    <Text style={ss.totalLabel}>{l}</Text>
                    <Text style={[ss.totalValue, { color: "#FCA5A5" }]}>{`-${formatCOP(v)}`}</Text>
                  </View>
                ))}
              </>)}

              <View style={ss.netoBox}>
                <Text style={ss.netoLabel}>NETO A PAGAR ESTE PERÍODO</Text>
                <Text style={ss.netoValue}>{formatCOP(totalNeto)}</Text>
              </View>

              {totalRecargosEstePeriodo > 0 && (
                <View style={ss.extrasBox}>
                  <Text style={ss.extrasTitle}>⚡ Recargos de este período (mes vencido)</Text>
                  <Text style={ss.extrasSub}>Se pagarán en el siguiente corte</Text>
                  {[
                    ["🌙 Recargo nocturno",   recargosEstePeriodo.recNoche],
                    ["🟡 Dom/fest diurno",    recargosEstePeriodo.recDomDia],
                    ["🟡🌙 Dom/fest nocturno",recargosEstePeriodo.recDomNoc],
                    ["⚡☀️ Extra diurna",     recargosEstePeriodo.recExtDia],
                    ["⚡🌙 Extra nocturna",   recargosEstePeriodo.recExtNoc],
                  ].map(([l, v]) => v > 0 ? (
                    <View key={l} style={ss.totalRow}>
                      <Text style={[ss.totalLabel, { color: "#FCD34D" }]}>{l}</Text>
                      <Text style={[ss.totalValue, { color: "#FCD34D" }]}>{formatCOP(v)}</Text>
                    </View>
                  ) : null)}
                  <View style={ss.extrasTotalRow}>
                    <Text style={ss.extrasTotalLabel}>Total pendiente próximo pago</Text>
                    <Text style={ss.extrasTotalValue}>{formatCOP(totalRecargosEstePeriodo)}</Text>
                  </View>
                </View>
              )}

              <View style={ss.actionRow}>
                <TouchableOpacity style={ss.saveBtn} onPress={handleSave}>
                  <Text style={ss.saveBtnText}>{isEditing ? "✏️ Actualizar" : "💾 Guardar"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ss.pdfBtn} onPress={exportPDF}>
                  <Text style={ss.pdfBtnText}>📄 PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Modales */}
        <Modal visible={scannerVisible} animationType="slide" onRequestClose={() => setScannerVisible(false)}>
          <ScheduleScanner days={days} onApply={aplicarEscaneo} onClose={() => setScannerVisible(false)} />
        </Modal>

        <Modal visible={modalContrato} transparent animationType="slide" onRequestClose={() => setModalContrato(false)}>
          <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={() => setModalContrato(false)}>
            <View style={ss.modalBox}>
              <Text style={ss.modalTitle}>Tipo de contrato</Text>
              <FlatList data={TIPOS_CONTRATO} keyExtractor={(t) => t.id}
                renderItem={({ item: t }) => (
                  <TouchableOpacity style={[ss.contractItem, contrato.id === t.id && ss.contractItemActive]}
                    onPress={() => { setTipoContrato(t); setModalContrato(false); }}>
                    <Text style={ss.contractItemIcon}>{t.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[ss.contractItemLabel, contrato.id === t.id && { color: "#4F46E5" }]}>{t.label}</Text>
                      <Text style={ss.contractItemDesc}>{t.desc}</Text>
                    </View>
                    {contrato.id === t.id && <Text style={{ color: "#4F46E5", fontWeight: "700" }}>✓</Text>}
                  </TouchableOpacity>
                )} />
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={modalMesInicio} transparent animationType="slide" onRequestClose={() => setModalMesInicio(false)}>
          <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={() => setModalMesInicio(false)}>
            <View style={ss.modalBox}>
              <Text style={ss.modalTitle}>Mes de inicio</Text>
              <FlatList data={MESES} keyExtractor={(m) => m.label}
                renderItem={({ item }) => (
                  <TouchableOpacity style={ss.monthItem} onPress={() => { setMesInicio(item.month); setModalMesInicio(false); }}>
                    <Text style={[ss.monthItemText, mesInicio === item.month && { color: "#4F46E5", fontWeight: "700" }]}>{item.label}</Text>
                    {mesInicio === item.month && <Text style={{ color: "#4F46E5" }}>✓</Text>}
                  </TouchableOpacity>
                )} />
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={modalMesFin} transparent animationType="slide" onRequestClose={() => setModalMesFin(false)}>
          <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={() => setModalMesFin(false)}>
            <View style={ss.modalBox}>
              <Text style={ss.modalTitle}>Mes de fin</Text>
              <FlatList data={MESES} keyExtractor={(m) => m.label}
                renderItem={({ item }) => (
                  <TouchableOpacity style={ss.monthItem} onPress={() => { setMesFin(item.month); setModalMesFin(false); }}>
                    <Text style={[ss.monthItemText, mesFin === item.month && { color: "#4F46E5", fontWeight: "700" }]}>{item.label}</Text>
                    {mesFin === item.month && <Text style={{ color: "#4F46E5" }}>✓</Text>}
                  </TouchableOpacity>
                )} />
            </View>
          </TouchableOpacity>
        </Modal>

        <Modal visible={balanceModal} transparent animationType="slide" onRequestClose={() => setBalanceModal(false)}>
          <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={() => setBalanceModal(false)}>
            <View style={ss.modalBox}>
              <Text style={ss.modalTitle}>📊 Balances guardados 2026</Text>
              {balanceList.length === 0 ? (
                <Text style={{ color: "#9CA3AF", textAlign: "center", marginTop: 20 }}>Aún no hay períodos guardados</Text>
              ) : (<>
                <FlatList data={balanceList} keyExtractor={(b) => b.key || b.corte}
                  renderItem={({ item: b }) => (
                    <View style={ss.balanceItem}>
                      <View style={{ flex: 1 }}>
                        <Text style={ss.balanceMes}>{b.corte}</Text>
                        <Text style={ss.balanceDetail}>
                          {`${TIPOS_CONTRATO.find(t => t.id === b.contrato)?.label || b.contrato} · ${b.dias} días · ${b.fecha}`}
                        </Text>
                        <Text style={ss.balanceDetail}>{`Bruto: ${formatCOP(b.totalBruto)}`}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={ss.balanceTotal}>{formatCOP(b.totalNeto)}</Text>
                        <Text style={ss.balanceNeto}>neto</Text>
                        <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                          <TouchableOpacity onPress={() => handleEdit(b)}>
                            <Text style={ss.balanceEdit}>✏️ Editar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => handleDelete(b.corte || b.key)}>
                            <Text style={ss.balanceDelete}>🗑 Borrar</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )} />
                <View style={ss.acumBox}>
                  <Text style={ss.acumLabel}>ACUMULADO NETO 2026</Text>
                  <Text style={ss.acumValue}>{formatCOP(acumNeto)}</Text>
                </View>
              </>)}
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Estilos ───────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  container: { flex:1, backgroundColor:"#F4F6FA" },
  scroll:    { padding:16 },
  header: { backgroundColor:"#4F46E5", borderRadius:16, padding:20, marginBottom:16, alignItems:"center" },
  headerTitle: { color:"#fff", fontSize:20, fontWeight:"700" },
  headerSub:   { color:"#C7D2FE", fontSize:12, marginTop:4 },
  headerBalanceBtn: { backgroundColor:"rgba(255,255,255,0.15)", borderRadius:8, paddingHorizontal:14, paddingVertical:6, marginTop:10 },
  headerBalanceBtnText: { color:"#fff", fontSize:13, fontWeight:"600" },
  card: { backgroundColor:"#fff", borderRadius:14, padding:16, marginBottom:14, elevation:2, shadowColor:"#000", shadowOpacity:0.06, shadowRadius:8 },
  sectionTitle: { fontSize:15, fontWeight:"600", color:"#1E1B4B", marginBottom:8 },
  contractDesc: { fontSize:12, color:"#6B7280", marginTop:6, lineHeight:17 },
  alertBox:  { backgroundColor:"#FEF2F2", borderRadius:8, padding:10, marginTop:8 },
  alertText: { fontSize:11, color:"#B91C1C", lineHeight:16 },
  selectBtn:     { backgroundColor:"#EEF2FF", borderRadius:10, padding:14, alignItems:"center" },
  selectBtnText: { color:"#4F46E5", fontWeight:"600", fontSize:15 },
  rateInputBig: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:14, fontSize:22, fontWeight:"700", color:"#111", backgroundColor:"#FAFAFA", textAlign:"center" },
  infoRow: { flexDirection:"row", justifyContent:"space-between", marginTop:10, paddingTop:8, borderTopWidth:1, borderTopColor:"#F3F4F6" },
  infoText: { fontSize:13, color:"#6B7280" },
  infoVal:  { fontSize:13, fontWeight:"700", color:"#4F46E5" },
  toggleRow: { flexDirection:"row", alignItems:"center", marginTop:12, paddingTop:10, borderTopWidth:1, borderTopColor:"#F3F4F6" },
  toggleLabel: { fontSize:13, fontWeight:"600", color:"#374151" },
  toggleSub:   { fontSize:11, color:"#9CA3AF", marginTop:2 },
  cutDesc:  { fontSize:12, color:"#9CA3AF", marginBottom:10 },
  cutRow:   { flexDirection:"row", gap:10, marginBottom:10 },
  cutLabel: { fontSize:12, color:"#6B7280", marginBottom:4 },
  cutInput: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:10, fontSize:16, fontWeight:"600", color:"#111", backgroundColor:"#FAFAFA" },
  cutMesBtn:     { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:10, backgroundColor:"#FAFAFA" },
  cutMesBtnText: { fontSize:14, color:"#374151", fontWeight:"600" },
  applyBtn:     { backgroundColor:"#4F46E5", borderRadius:10, padding:14, alignItems:"center", marginTop:4 },
  applyBtnText: { color:"#fff", fontWeight:"700", fontSize:14 },
  extrasBox:       { backgroundColor:"#78350F", borderRadius:12, padding:14, marginTop:10 },
  extrasTitle:     { color:"#FCD34D", fontSize:14, fontWeight:"700", marginBottom:2 },
  extrasSub:       { color:"#FDE68A", fontSize:11, marginBottom:10 },
  extrasTotalRow:  { flexDirection:"row", justifyContent:"space-between", marginTop:8, paddingTop:8, borderTopWidth:1, borderTopColor:"#92400E" },
  extrasTotalLabel:{ color:"#FCD34D", fontSize:13, fontWeight:"600" },
  extrasTotalValue:{ color:"#FCD34D", fontSize:15, fontWeight:"800" },
  recargoToggleRow:  { flexDirection:"row", alignItems:"center" },
  recargoInputGrid:  { flexDirection:"row", flexWrap:"wrap", gap:10 },
  recargoInputItem:  { width:"47%" },
  recargoInputLabel: { fontSize:11, color:"#6B7280", marginBottom:4 },
  recargoInputRow:   { flexDirection:"row", alignItems:"center", borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, backgroundColor:"#FAFAFA", paddingHorizontal:10 },
  recargoInput:      { flex:1, fontSize:16, fontWeight:"600", color:"#111", paddingVertical:8 },
  recargoInputSuffix:{ fontSize:14, color:"#6B7280", fontWeight:"600" },
  recargoMult:       { fontSize:11, color:"#4F46E5", marginTop:3, fontWeight:"600" },
  resetBtn:          { marginTop:14, alignItems:"center", padding:10, backgroundColor:"#F3F4F6", borderRadius:10 },
  resetBtnText:      { fontSize:12, color:"#6B7280", fontWeight:"600" },
  modoRow:          { flexDirection:"row", gap:8, marginBottom:12 },
  modoBtn:          { flex:1, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:10, alignItems:"center", backgroundColor:"#FAFAFA" },
  modoBtnActive:    { backgroundColor:"#4F46E5", borderColor:"#4F46E5" },
  modoBtnText:      { fontSize:13, fontWeight:"600", color:"#6B7280" },
  modoBtnTextActive:{ color:"#fff" },
  scanBtn:     { backgroundColor:"#EEF2FF", borderRadius:8, paddingHorizontal:10, paddingVertical:6 },
  scanBtnText: { fontSize:12, color:"#4F46E5", fontWeight:"600" },
  domRow:     { flexDirection:"row", gap:10, alignItems:"center", marginTop:6 },
  domInfo:    { flex:1, justifyContent:"center" },
  domInfoText:{ fontSize:13, fontWeight:"600", color:"#4F46E5" },
  domInfoSub: { fontSize:11, color:"#9CA3AF", marginTop:2 },
  dividerLight:{ height:1, backgroundColor:"#F3F4F6", marginVertical:12 },
  stepperGrid:  { flexDirection:"row", gap:10 },
  stepperWrap:  { flex:1 },
  stepperWrapSm:{ flex:1 },
  stepperLabel: { fontSize:11, color:"#6B7280", marginBottom:5 },
  stepperRow:   { flexDirection:"row", alignItems:"center", borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, backgroundColor:"#FAFAFA", overflow:"hidden" },
  stepBtn:     { width:36, height:36, alignItems:"center", justifyContent:"center", backgroundColor:"#EEF2FF" },
  stepBtnText: { fontSize:20, fontWeight:"700", color:"#4F46E5", lineHeight:22 },
  stepperVal:  { flex:1, textAlign:"center", fontSize:13, fontWeight:"600", color:"#111" },
  turnoBox:      { borderWidth:1, borderColor:"#E0E7FF", backgroundColor:"#F8F9FF", borderRadius:10, padding:10, marginBottom:8 },
  turnoHeader:   { flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:6 },
  turnoTitle:    { fontSize:12, fontWeight:"700", color:"#4F46E5" },
  turnoQuitar:   { fontSize:11, color:"#EF4444", fontWeight:"600" },
  addTurnoBtn:   { borderWidth:1, borderColor:"#4F46E5", borderStyle:"dashed", borderRadius:10, padding:10, alignItems:"center", marginTop:2 },
  addTurnoText:  { fontSize:12, color:"#4F46E5", fontWeight:"700" },
  legendRow:  { flexDirection:"row", flexWrap:"wrap", gap:8, marginBottom:10, paddingHorizontal:2 },
  legendItem: { flexDirection:"row", alignItems:"center", gap:4 },
  legendDot:  { width:12, height:12, borderRadius:6 },
  legendText: { fontSize:10, color:"#6B7280" },
  dayRow:        { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, marginBottom:6, backgroundColor:"#FAFAFA", overflow:"hidden" },
  dayRowEsp:     { borderColor:"#F59E0B", backgroundColor:"#FFFBEB", borderWidth:1.5 },
  dayRowOff:     { borderWidth:1, borderColor:"#F3F4F6", borderRadius:10, padding:10, marginBottom:6, backgroundColor:"#F9FAFB", flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  dayRowDescanso:{ borderWidth:1, borderColor:"#93C5FD", borderRadius:10, padding:10, marginBottom:6, backgroundColor:"#EFF6FF", flexDirection:"row", alignItems:"center" },
  dayRowCompensatorio:{ borderWidth:1, borderColor:"#A78BFA", borderRadius:10, padding:10, marginBottom:6, backgroundColor:"#F5F3FF", flexDirection:"row", alignItems:"center" },
  dayRowNoProg: { borderWidth:1, borderColor:"#9CA3AF", borderRadius:10, padding:10, marginBottom:6, backgroundColor:"#E5E7EB", flexDirection:"row", alignItems:"center" },
  dayRowHeader:  { flexDirection:"row", alignItems:"center", padding:10 },
  dayNum:        { fontSize:13, fontWeight:"600", color:"#374151" },
  dayNumOff:     { fontSize:13, color:"#9CA3AF" },
  dayNumDescanso:{ fontSize:13, fontWeight:"600", color:"#1D4ED8" },
  dayNumCompensatorio:{ fontSize:13, fontWeight:"600", color:"#7C3AED" },
  dayNumNoProg:  { fontSize:13, fontWeight:"600", color:"#4B5563" },
  dayStatusOff:  { fontSize:11, color:"#9CA3AF" },
  badge:         { backgroundColor:"#FEF08A", borderRadius:6, paddingHorizontal:5, paddingVertical:1 },
  badgeText:     { fontSize:9, color:"#92400E", fontWeight:"600" },
  recargoBadge:  { fontSize:10, color:"#B45309", marginTop:1 },
  recargoBadgeComp: { fontSize:10, color:"#7C3AED", marginTop:1 },
  recargoBadgeMoney:{ fontSize:10, color:"#B45309", marginTop:1, fontWeight:"600" },
  recargoBadgeWarn: { fontSize:10, color:"#DC2626", marginTop:1, fontWeight:"600" },
  dayCostComp:      { fontSize:13, fontWeight:"700", color:"#7C3AED", marginRight:10 },
  hoursCompact:  { fontSize:10, color:"#6B7280", marginTop:2 },
  dayCost:       { fontSize:13, fontWeight:"700", color:"#4F46E5", marginRight:4 },
  dayCostEsp:    { color:"#D97706" },
  expandIcon:    { fontSize:10, color:"#9CA3AF", marginRight:6 },
  descansoBtn:   { padding:4, backgroundColor:"#EFF6FF", borderRadius:6 },
  descansoBtnText:{ fontSize:12 },
  compBtn:       { padding:4, backgroundColor:"#F5F3FF", borderRadius:6 },
  compBtnText:   { fontSize:12 },
  noProgBtn:     { padding:4, backgroundColor:"#F3F4F6", borderRadius:6 },
  removeBtn:     { padding:4 },
  removeBtnText: { color:"#EF4444", fontSize:14, fontWeight:"700" },
  toggleBtn:     { backgroundColor:"#DBEAFE", borderRadius:8, paddingHorizontal:10, paddingVertical:6 },
  toggleBtnText: { fontSize:11, color:"#1D4ED8", fontWeight:"600" },
  weekChip:      { paddingHorizontal:14, paddingVertical:8, borderRadius:12, borderWidth:1, borderColor:"#E5E7EB", backgroundColor:"#FAFAFA", alignItems:"center", justifyContent:"center" },
  weekChipActive:{ backgroundColor:"#4F46E5", borderColor:"#4F46E5" },
  weekChipText:  { fontSize:13, fontWeight:"700", color:"#374151" },
  weekChipSub:   { fontSize:10, color:"#6B7280", marginTop:1 },
  weekChipTextActive: { color:"#fff" },
  weekHeader:    { fontSize:12, fontWeight:"700", color:"#4F46E5", marginTop:10, marginBottom:6 },
  expandedContent: { padding:10, borderTopWidth:1, borderTopColor:"#F3F4F6", backgroundColor:"#fff" },
  groupLabel:    { fontSize:12, fontWeight:"600", color:"#6B7280", marginBottom:6 },
  desglose:      { backgroundColor:"#F8F9FF", borderRadius:8, padding:10, marginTop:10 },
  desgloseTitle: { fontSize:11, fontWeight:"600", color:"#6B7280", marginBottom:6 },
  desgloseRow:   { flexDirection:"row", justifyContent:"space-between", marginBottom:4 },
  desgloseLabel: { fontSize:12, color:"#374151" },
  desgloseValue: { fontSize:12, fontWeight:"600", color:"#4F46E5" },
  totalsCard:    { backgroundColor:"#1E1B4B", borderRadius:16, padding:20, marginBottom:14 },
  totalsTitle:   { color:"#C7D2FE", fontSize:15, fontWeight:"600", marginBottom:2 },
  totalsSubtitle:{ color:"#818CF8", fontSize:11, marginBottom:14 },
  totalRow:      { flexDirection:"row", justifyContent:"space-between", marginBottom:8 },
  totalLabel:    { color:"#A5B4FC", fontSize:13 },
  totalValue:    { color:"#E0E7FF", fontSize:13, fontWeight:"600" },
  divider:       { height:1, backgroundColor:"#312E81", marginVertical:10 },
  grandTotalBox: { backgroundColor:"#4F46E5", borderRadius:12, padding:14, marginTop:10, alignItems:"center" },
  grandTotalLabel:{ color:"#C7D2FE", fontSize:11, fontWeight:"600", letterSpacing:1 },
  grandTotalValue:{ color:"#fff", fontSize:24, fontWeight:"800", marginTop:2 },
  netoBox:   { backgroundColor:"#059669", borderRadius:12, padding:14, marginTop:10, alignItems:"center" },
  netoLabel: { color:"rgba(255,255,255,.8)", fontSize:11, fontWeight:"600", letterSpacing:1 },
  netoValue: { color:"#fff", fontSize:28, fontWeight:"800", marginTop:2 },
  actionRow: { flexDirection:"row", gap:10, marginTop:14 },
  saveBtn:   { flex:1, backgroundColor:"#0EA5E9", borderRadius:12, padding:14, alignItems:"center" },
  saveBtnText:{ color:"#fff", fontSize:14, fontWeight:"700" },
  pdfBtn:    { flex:1, backgroundColor:"#059669", borderRadius:12, padding:14, alignItems:"center" },
  pdfBtnText:{ color:"#fff", fontSize:14, fontWeight:"700" },
  modalOverlay: { flex:1, backgroundColor:"rgba(0,0,0,0.4)", justifyContent:"flex-end" },
  modalBox:     { backgroundColor:"#fff", borderTopLeftRadius:20, borderTopRightRadius:20, padding:20, maxHeight:"80%" },
  modalTitle:   { fontSize:17, fontWeight:"700", color:"#1E1B4B", marginBottom:16 },
  contractItem:       { flexDirection:"row", alignItems:"flex-start", paddingVertical:12, borderBottomWidth:1, borderBottomColor:"#F3F4F6", gap:10 },
  contractItemActive: { backgroundColor:"#EEF2FF", borderRadius:10, paddingHorizontal:8, marginHorizontal:-8 },
  contractItemIcon:   { fontSize:20, marginTop:2 },
  contractItemLabel:  { fontSize:14, fontWeight:"600", color:"#374151" },
  contractItemDesc:   { fontSize:11, color:"#9CA3AF", marginTop:2, lineHeight:16 },
  monthItem:     { flexDirection:"row", justifyContent:"space-between", paddingVertical:14, borderBottomWidth:1, borderBottomColor:"#F3F4F6" },
  monthItemText: { fontSize:15, color:"#374151" },
  balanceItem:   { flexDirection:"row", paddingVertical:12, borderBottomWidth:1, borderBottomColor:"#F3F4F6" },
  balanceMes:    { fontSize:14, fontWeight:"600", color:"#1E1B4B" },
  balanceDetail: { fontSize:11, color:"#6B7280", marginTop:2 },
  balanceTotal:  { fontSize:15, fontWeight:"700", color:"#4F46E5" },
  balanceNeto:   { fontSize:10, color:"#059669" },
  balanceEdit:   { fontSize:11, color:"#4F46E5" },
  balanceDelete: { fontSize:11, color:"#EF4444" },
  acumBox:   { backgroundColor:"#059669", borderRadius:12, padding:14, marginTop:14, alignItems:"center" },
  acumLabel: { color:"rgba(255,255,255,.8)", fontSize:11, fontWeight:"600", letterSpacing:1 },
  acumValue: { color:"#fff", fontSize:24, fontWeight:"800", marginTop:4 },
});