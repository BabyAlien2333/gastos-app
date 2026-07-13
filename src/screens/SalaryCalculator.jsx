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
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text, TextInput, TouchableOpacity,
  View,
} from "react-native";
import { auth, db } from "../firebase/firebaseConfig";
import ScheduleScanner from "./ScheduleScanner";

// ─── Constantes 2026 ─────────────────────────────────────────────────────────
const SMMLV_2026        = 1423500;   // Salario mínimo 2026 (estimado)
const AUX_TRANSPORTE    = 200000;    // Auxilio de transporte 2026
const SALUD_PCT         = 0.04;      // 4% empleado
const PENSION_PCT       = 0.04;      // 4% empleado
const HORAS_SEMANA_2026 = 42;        // Ley 2101 — 42hrs en 2025 y 2026

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
    desc: "Independiente. Sin prestaciones sociales ni auxilio de transporte. El contratista asume salud y pensión.",
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

const STORAGE_KEY = "salary_balances_2026_v2";
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

// Genera días entre dos fechas (puede cruzar mes)
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
      day: d,
      month: m,
      year: y,
      label: `${d} ${MESES[m]?.label || ""}`,
      worked: true,
      descanso: domingo,
      festivo,
      domingo,
      especial: festivo || domingo,
      dayHours: 0,
      nightHours: 0,
      extraDayH: 0,
      extraNightH: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return resultado;
};

// ─── Stepper ─────────────────────────────────────────────────────────────────
const Stepper = ({ label, value, onChange, small }) => (
  <View style={small ? ss.stepperWrapSm : ss.stepperWrap}>
    <Text style={ss.stepperLabel}>{label}</Text>
    <View style={ss.stepperRow}>
      <TouchableOpacity style={ss.stepBtn}
        onPress={() => onChange(Math.max(0, Math.round((value-0.5)*10)/10))}>
        <Text style={ss.stepBtnText}>−</Text>
      </TouchableOpacity>
      <Text style={ss.stepperVal}>{fmtHrs(value)}</Text>
      <TouchableOpacity style={ss.stepBtn}
        onPress={() => onChange(Math.min(24, Math.round((value+0.5)*10)/10))}>
        <Text style={ss.stepBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

// ─── Componente principal ─────────────────────────────────────────────────────
export default function SalaryCalculator() {
  // Configuración
  const [tipoContrato,    setTipoContrato]    = useState(TIPOS_CONTRATO[0]);
  const [salarioBase,     setSalarioBase]     = useState("");
  const [valorHoraManual, setValorHoraManual] = useState("");
  const [modoHora,        setModoHora]        = useState(false);
  const [inclAuxTransp,   setInclAuxTransp]   = useState(true);
  const [inclDeducciones, setInclDeducciones] = useState(true);

  // Recargos personalizables (% como string para el input)
  const [showRecargos,   setShowRecargos]   = useState(false);
  const [pctNocturno,    setPctNocturno]    = useState("35");
  const [pctExtDia,      setPctExtDia]      = useState("25");
  const [pctExtNoche,    setPctExtNoche]    = useState("75");
  const [pctDomOrd,      setPctDomOrd]      = useState("75");

  // Configuración D1 Part Time
  const [domPct,          setDomPct]          = useState("80");
  const [diasXDescanso,   setDiasXDescanso]   = useState("6");
  const [inclPrima,       setInclPrima]       = useState(false);
  const [horasTotalesPT,  setHorasTotalesPT]  = useState(0);

  // Corte
  const [diaInicio,  setDiaInicio]  = useState("1");
  const [mesInicio,  setMesInicio]  = useState(0);
  const [diaFin,     setDiaFin]     = useState("31");
  const [mesFin,     setMesFin]     = useState(0);
  const [corteCargado, setCorteCargado] = useState(false);

  // Horas extras (mes vencido)
  const [extrasPeriodoAnterior, setExtrasPeriodoAnterior] = useState({
    extDayH: 0, extNightH: 0, extDomDayH: 0, extDomNightH: 0,
  });

  // Días
  const [days,         setDays]         = useState([]);
  const [expandedDay,  setExpandedDay]  = useState(null);

  // Modales
  const [modalContrato,   setModalContrato]   = useState(false);
  const [modalMesInicio,  setModalMesInicio]  = useState(false);
  const [modalMesFin,     setModalMesFin]     = useState(false);
  const [balanceModal,    setBalanceModal]    = useState(false);
  const [scannerVisible,  setScannerVisible]  = useState(false);

  // Balances
  const [savedBalances, setSavedBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);

  // Escuchar balances del usuario en tiempo real (sincroniza PC y celular)
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) { setLoadingBalances(false); return; }

    const q = query(
      collection(db, "salary_balances"),
      where("uid", "==", user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = {};
      snap.forEach((d) => { data[d.id] = d.data(); });
      setSavedBalances(data);
      setLoadingBalances(false);
    }, () => setLoadingBalances(false));

    return () => unsub();
  }, []);

  // Guardar / actualizar un balance en Firestore
  const saveBalance = async (key, entry) => {
    const user = auth.currentUser;
    if (!user) return Alert.alert("Error", "Debes iniciar sesión para guardar.");
    const docId = `${user.uid}_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    await setDoc(doc(db, "salary_balances", docId), { ...entry, uid: user.uid });
  };

  // Eliminar un balance de Firestore
  const deleteBalance = async (key) => {
    const user = auth.currentUser;
    if (!user) return;
    const docId = `${user.uid}_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    await deleteDoc(doc(db, "salary_balances", docId));
  };

  // ── Aplicar resultado del scanner ────────────────────────────────────────
  const aplicarEscaneo = (diasEscaneados) => {
    setDays((prev) => {
      const nuevo = [...prev];
      diasEscaneados.forEach((d) => {
        if (d.index >= 0 && d.index < nuevo.length) {
          nuevo[d.index] = {
            ...nuevo[d.index],
            worked:     d.worked !== false,
            descanso:   d.descanso || false,
            dayHours:   d.dayHours   || 0,
            nightHours: d.nightHours || 0,
          };
        }
      });
      return nuevo;
    });
  };

  // ── Cargar corte ─────────────────────────────────────────────────────────
  const cargarCorte = () => {
    const di = parseInt(diaInicio) || 1;
    const df = parseInt(diaFin) || 31;
    const generados = generarDiasCorte(di, mesInicio, df, mesFin);
    setDays(generados);
    setCorteCargado(true);
    setExpandedDay(null);
  };

  // ── Cálculos base ─────────────────────────────────────────────────────────
  const salario    = parseFloat(salarioBase.replace(/\./g,"").replace(",",".")) || 0;
  const contrato   = tipoContrato;
  const isPartTime = contrato.porHoras;

  // Valor hora:
  // - Part Time: siempre por hora manual
  // - Otros: si modoHora=true usa valorHoraManual, si no calcula desde salario mensual
  const horasDiarias  = HORAS_SEMANA_2026 / 6;
  const valorHoraCalc = salario > 0 ? salario / (30 * horasDiarias) : 0;
  const valorHoraIngresado = parseFloat(valorHoraManual.replace(/\./g,"").replace(",",".")) || 0;
  const valorHora = isPartTime
    ? valorHoraIngresado
    : (modoHora ? valorHoraIngresado : valorHoraCalc);

  // Recargos — usa personalizados si el usuario los editó
  const domPctNum     = Math.max(0, parseFloat(domPct)     || 80) / 100;
  const pctNocNum     = Math.max(0, parseFloat(pctNocturno) || 35) / 100;
  const pctExtDiaNum  = Math.max(0, parseFloat(pctExtDia)   || 25) / 100;
  const pctExtNocNum  = Math.max(0, parseFloat(pctExtNoche)  || 75) / 100;
  const pctDomOrdNum  = isPartTime
    ? domPctNum
    : Math.max(0, parseFloat(pctDomOrd) || 75) / 100;

  const R = {
    ordDia:        1.00,
    ordNoche:      1 + pctNocNum,                        // def +35%
    extDia:        1 + pctExtDiaNum,                     // def +25%
    extNoche:      1 + pctExtNocNum,                     // def +75%
    domFestOrdDia: 1 + pctDomOrdNum,                     // def +75% (D1: configurable)
    domFestOrdNoc: 1 + pctDomOrdNum + pctNocNum,         // dom + nocturno
    domFestExtDia: 1 + pctDomOrdNum + pctExtDiaNum,      // dom + extra dia
    domFestExtNoc: 1 + pctDomOrdNum + pctExtNocNum,      // dom + extra noche
  };

  const calcDay = (d) => {
    if (!d.worked || d.descanso) return { total:0, detail:{} };
    const e = d.especial;
    const ordDia   = d.dayHours   * valorHora * (e ? R.domFestOrdDia : R.ordDia);
    const ordNoche = d.nightHours * valorHora * (e ? R.domFestOrdNoc : R.ordNoche);
    return { total: ordDia + ordNoche, detail: { ordDia, ordNoche } };
  };

  // Extras del período anterior (mes vencido)
  const calcExtrasVencidas = () => {
    if (!contrato.mesVencido) return 0;
    const { extDayH, extNightH, extDomDayH, extDomNightH } = extrasPeriodoAnterior;
    return (
      extDayH      * valorHora * R.extDia        +
      extNightH    * valorHora * R.extNoche      +
      extDomDayH   * valorHora * R.domFestExtDia +
      extDomNightH * valorHora * R.domFestExtNoc
    );
  };

  const diasTrabajados = days.filter((d) => d.worked && !d.descanso);
  const diasDescanso   = days.filter((d) => d.descanso).length;
  const diasEspeciales = diasTrabajados.filter((d) => d.especial).length;

  // Total horas del período (solo Part Time)
  const totalHorasPT = diasTrabajados.reduce((s,d) => s + (d.dayHours||0) + (d.nightHours||0), 0);

  const subtotalOrd = diasTrabajados.reduce((s, d) => s + calcDay(d).total, 0);
  const subtotalExt = calcExtrasVencidas();

  // Descanso remunerado Part Time
  const diasXDescansoNum  = Math.max(1, parseInt(diasXDescanso) || 6);
  const diasDescansoRem   = isPartTime ? Math.floor(diasTrabajados.length / diasXDescansoNum) : 0;
  const horasPorDescanso  = isPartTime && diasTrabajados.length > 0
    ? (totalHorasPT / diasTrabajados.length) : 0;
  const descRemunerado    = isPartTime ? diasDescansoRem * horasPorDescanso * valorHora : 0;

  // Prima legal proporcional Part Time = subtotalOrd * diasPeriodo / 360 / 2 (semestral)
  const diasPeriodo = days.length;
  const primaLegal  = (isPartTime && inclPrima)
    ? (subtotalOrd * diasPeriodo / 360 / 2)
    : 0;

  // Auxilio de transporte
  // Para Part Time se calcula proporcional a horas trabajadas vs jornada completa (173.33h/mes)
  const horasJornadaCompleta = 30 * horasDiarias;
  const auxTranspBase = (contrato.auxTransporte && inclAuxTransp) ? AUX_TRANSPORTE : 0;
  const auxTransp = isPartTime
    ? (totalHorasPT / horasJornadaCompleta) * auxTranspBase
    : (salario <= 2 * SMMLV_2026 ? auxTranspBase : 0);

  const totalBruto = subtotalOrd + subtotalExt + auxTransp + descRemunerado + primaLegal;

  // Deducciones — para Part Time sobre el total devengado
  const baseDeduccion = isPartTime ? subtotalOrd : salario;
  const deducSalud   = (contrato.prestaciones && inclDeducciones) ? baseDeduccion * SALUD_PCT : 0;
  const deducPension = (contrato.prestaciones && inclDeducciones) ? baseDeduccion * PENSION_PCT : 0;
  const totalDeduc   = deducSalud + deducPension;
  const totalNeto    = totalBruto - totalDeduc;

  const labelCorte = `${diaInicio}/${pad(mesInicio+1)} → ${diaFin}/${pad(mesFin+1)}`;

  // ── Guardar balance ───────────────────────────────────────────────────────
  const isEditing = corteCargado && !!savedBalances[
    Object.keys(savedBalances).find(k => savedBalances[k].corte === labelCorte)
  ];

  const handleSave = async () => {
    if (!corteCargado) return Alert.alert("Carga el período primero");
    try {
      const entry = {
        key: labelCorte,
        corte: labelCorte,
        contrato: contrato.id,
        salario,
        valorHoraManual,
        modoHora,
        domPct,
        diasXDescanso,
        inclPrima,
        pctNocturno, pctExtDia, pctExtNoche, pctDomOrd,
        dias: diasTrabajados.length,
        especiales: diasEspeciales,
        totalBruto,
        totalNeto,
        auxTransp,
        deducSalud,
        deducPension,
        extrasPeriodoAnterior,
        fecha: new Date().toLocaleDateString("es-CO"),
        daysSnapshot: days,
        salarioBase,
      };
      await saveBalance(labelCorte, entry);
      Alert.alert(
        isEditing ? "✅ Actualizado" : "✅ Guardado",
        `Balance ${labelCorte} guardado y sincronizado en todos tus dispositivos.`
      );
    } catch (e) {
      Alert.alert("Error", "No se pudo guardar: " + e.message);
    }
  };

  const handleDelete = (key) => {
    Alert.alert("Eliminar", `¿Eliminar balance ${key}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: async () => {
        try {
          await deleteBalance(key);
        } catch (e) {
          Alert.alert("Error", "No se pudo eliminar: " + e.message);
        }
      }},
    ]);
  };

  const handleEdit = (b) => {
    if (!b.daysSnapshot) {
      Alert.alert("Balance antiguo", "Este balance no tiene datos para editar.");
      return;
    }
    setBalanceModal(false);
    const tc = TIPOS_CONTRATO.find((t) => t.id === b.contrato) || TIPOS_CONTRATO[0];
    setTipoContrato(tc);
    setSalarioBase(b.salarioBase || String(b.salario || ""));
    if (b.valorHoraManual) setValorHoraManual(b.valorHoraManual);
    if (b.modoHora !== undefined)  setModoHora(b.modoHora);
    if (b.domPct)                  setDomPct(b.domPct);
    if (b.diasXDescanso)           setDiasXDescanso(b.diasXDescanso);
    if (b.inclPrima !== undefined)  setInclPrima(b.inclPrima);
    if (b.pctNocturno)             setPctNocturno(b.pctNocturno);
    if (b.pctExtDia)               setPctExtDia(b.pctExtDia);
    if (b.pctExtNoche)             setPctExtNoche(b.pctExtNoche);
    if (b.pctDomOrd)               setPctDomOrd(b.pctDomOrd);
    setExtrasPeriodoAnterior(b.extrasPeriodoAnterior || { extDayH:0, extNightH:0, extDomDayH:0, extDomNightH:0 });
    setDays(b.daysSnapshot);
    setCorteCargado(true);
    setExpandedDay(null);
  };

  // ── Exportar PDF ──────────────────────────────────────────────────────────
  const exportPDF = async () => {
    const filas = days.map((d) => {
      const c = calcDay(d);
      const tipo = d.descanso ? "Descanso" : !d.worked ? "No trabajado"
        : d.festivo ? "Festivo" : d.domingo ? "Domingo" : "Normal";
      const bg = d.descanso ? "#dbeafe" : !d.worked ? "#f3f4f6"
        : d.festivo ? "#fde68a" : d.domingo ? "#fef9c3" : "#fff";
      return `<tr style="background:${bg}">
        <td>${d.label}</td><td>${tipo}</td>
        <td>${(d.worked&&!d.descanso)?fmtHrs(d.dayHours):"-"}</td>
        <td>${(d.worked&&!d.descanso)?fmtHrs(d.nightHours):"-"}</td>
        <td style="font-weight:600">${(d.worked&&!d.descanso)?formatCOP(c.total):"-"}</td>
      </tr>`;
    }).join("");

    const balRows = Object.values(savedBalances).map((b) => `
      <tr><td>${b.corte}</td><td>${b.contrato}</td><td>${b.dias}</td>
      <td>${formatCOP(b.totalBruto)}</td><td>${formatCOP(b.totalNeto)}</td></tr>`).join("");

    const acum = Object.values(savedBalances).reduce((s,b)=>s+b.totalNeto,0);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#1a1a1a;font-size:12px}
      h1{color:#4F46E5;font-size:18px}h2{color:#6B7280;font-size:12px;font-weight:normal}
      h3{color:#1E1B4B;font-size:13px;margin:16px 0 6px}
      table{width:100%;border-collapse:collapse;margin-bottom:16px}
      th{background:#4F46E5;color:#fff;padding:6px 4px;text-align:left;font-size:11px}
      td{padding:5px 4px;border-bottom:1px solid #E5E7EB}
      .box{background:#1E1B4B;color:#fff;border-radius:8px;padding:14px;margin-top:10px}
      .row{display:flex;justify-content:space-between;margin-bottom:4px}
      .lbl{color:#A5B4FC;font-size:11px}.val{color:#E0E7FF;font-weight:600;font-size:11px}
      .grand{font-size:20px;font-weight:800;color:#fff;text-align:right;margin-top:8px}
      .neto{background:#059669;border-radius:8px;padding:12px;margin-top:8px;text-align:center}
      .neto-lbl{font-size:10px;color:rgba(255,255,255,.8);letter-spacing:1px}
      .neto-val{font-size:22px;font-weight:800;color:#fff}
      .tag{display:inline-block;background:#EEF2FF;color:#4F46E5;border-radius:4px;padding:2px 6px;font-size:10px}
    </style></head><body>
    <h1>💰 Liquidación de Nómina</h1>
    <h2>Período: ${labelCorte} · Contrato: ${contrato.label} · Tarifa hora: ${formatCOP(valorHora)}</h2>
    <span class="tag">Jornada Ley 2101: ${HORAS_SEMANA_2026}h/semana · ${horasDiarias.toFixed(2)}h/día</span>
    <h3>Detalle de días</h3>
    <table><thead><tr><th>Día</th><th>Tipo</th><th>Hrs ord. día</th><th>Hrs ord. noche</th><th>Subtotal</th></tr></thead>
    <tbody>${filas}</tbody></table>
    <div class="box">
      <div class="row"><span class="lbl">Días trabajados</span><span class="val">${diasTrabajados.length}</span></div>
      <div class="row"><span class="lbl">Días de descanso</span><span class="val">${diasDescanso}</span></div>
      <div class="row"><span class="lbl">Días especiales (dom/fest)</span><span class="val">${diasEspeciales}</span></div>
      <div class="row"><span class="lbl">Subtotal ordinario</span><span class="val">${formatCOP(subtotalOrd)}</span></div>
      ${subtotalExt>0?`<div class="row"><span class="lbl">⚡ Extras mes vencido</span><span class="val">${formatCOP(subtotalExt)}</span></div>`:""}
      ${auxTransp>0?`<div class="row"><span class="lbl">Aux. transporte</span><span class="val">${formatCOP(auxTransp)}</span></div>`:""}
      <div class="grand">Bruto: ${formatCOP(totalBruto)}</div>
      ${totalDeduc>0?`<div class="row" style="margin-top:8px"><span class="lbl">(-) Salud 4%</span><span class="val">-${formatCOP(deducSalud)}</span></div>
      <div class="row"><span class="lbl">(-) Pensión 4%</span><span class="val">-${formatCOP(deducPension)}</span></div>`:""}
    </div>
    <div class="neto"><div class="neto-lbl">NETO A PAGAR</div><div class="neto-val">${formatCOP(totalNeto)}</div></div>
    ${Object.keys(savedBalances).length>0?`
    <h3>Balance acumulado 2026</h3>
    <table><thead><tr><th>Período</th><th>Contrato</th><th>Días</th><th>Bruto</th><th>Neto</th></tr></thead>
    <tbody>${balRows}</tbody></table>
    <div class="neto"><div class="neto-lbl">ACUMULADO NETO 2026</div><div class="neto-val">${formatCOP(acum)}</div></div>`:""}
    <p style="font-size:9px;color:#9CA3AF;margin-top:16px">
      Recargos CST Colombia · Ley 2101/2021 (${HORAS_SEMANA_2026}h/sem 2025-2026) · Extras pagadas mes vencido
    </p></body></html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType:"application/pdf", dialogTitle:"Exportar nómina", UTI:"com.adobe.pdf" });
      } else Alert.alert("PDF", uri);
    } catch (e) { Alert.alert("Error", e.message); }
  };

  // ── Render día ────────────────────────────────────────────────────────────
  const toggleWorked   = (i) => setDays((p) => p.map((d,idx) => idx===i ? {...d, worked:!d.worked} : d));
  const toggleDescanso = (i) => setDays((p) => p.map((d,idx) => idx===i ? {...d, descanso:!d.descanso, worked:true} : d));
  const updateHours    = (i, field, val) => setDays((p) => p.map((d,idx) => idx===i ? {...d,[field]:val} : d));

  const renderDay = (item, index) => {
    const isExp = expandedDay === index;
    const cost  = calcDay(item);
    const isEsp = item.especial && !item.descanso;

    if (item.descanso) {
      return (
        <View key={index} style={ss.dayRowDescanso}>
          <View style={{flex:1}}>
            <Text style={ss.dayNumDescanso}>🛌 {item.label}</Text>
            <Text style={ss.dayStatusOff}>Día de descanso</Text>
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

    return (
      <View key={index} style={[ss.dayRow, isEsp && ss.dayRowEsp]}>
        <TouchableOpacity style={ss.dayRowHeader}
          onPress={() => setExpandedDay(isExp ? null : index)}>
          <View style={{flex:1}}>
            <View style={{flexDirection:"row", alignItems:"center", gap:6}}>
              <Text style={ss.dayNum}>{item.label}</Text>
              {item.festivo && <View style={ss.badge}><Text style={ss.badgeText}>🎉 Festivo</Text></View>}
              {item.domingo && !item.festivo && <View style={ss.badge}><Text style={ss.badgeText}>🛐 Domingo</Text></View>}
            </View>
            {isEsp && <Text style={ss.recargoBadge}>Recargo dominical/festivo aplicado</Text>}
            <Text style={ss.hoursCompact}>
              {item.dayHours>0   ? `☀️${fmtHrs(item.dayHours)} ` :""}
              {item.nightHours>0 ? `🌙${fmtHrs(item.nightHours)}` :""}
            </Text>
          </View>
          <Text style={[ss.dayCost, isEsp && ss.dayCostEsp]}>{formatCOP(cost.total)}</Text>
          <Text style={ss.expandIcon}>{isExp?"▲":"▼"}</Text>
          <View style={{flexDirection:"row", gap:4}}>
            <TouchableOpacity onPress={() => toggleDescanso(index)} style={ss.descansoBtn}>
              <Text style={ss.descansoBtnText}>🛌</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => toggleWorked(index)} style={ss.removeBtn}>
              <Text style={ss.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>

        {isExp && (
          <View style={ss.expandedContent}>
            <Text style={ss.groupLabel}>Horas ordinarias del día</Text>
            <View style={ss.stepperGrid}>
              <Stepper label={`☀️ Diurnas${isEsp?" (+75%)":""}`}
                value={item.dayHours} onChange={(v) => updateHours(index,"dayHours",v)} />
              <Stepper label={`🌙 Nocturnas${isEsp?" (+150%)":" (+35%)"}`}
                value={item.nightHours} onChange={(v) => updateHours(index,"nightHours",v)} />
            </View>
            <View style={ss.desglose}>
              {[["Ord. diurno",cost.detail.ordDia],["Ord. nocturno",cost.detail.ordNoche]]
                .map(([l,v]) => v>0 ? (
                  <View key={l} style={ss.desgloseRow}>
                    <Text style={ss.desgloseLabel}>{l}</Text>
                    <Text style={ss.desgloseValue}>{formatCOP(v)}</Text>
                  </View>
                ) : null)}
            </View>
          </View>
        )}
      </View>
    );
  };

  const balanceList = Object.values(savedBalances);
  const acumNeto    = balanceList.reduce((s,b) => s+b.totalNeto, 0);

  return (
    <KeyboardAvoidingView style={{flex:1}}
      behavior={Platform.OS==="ios"?"padding":"height"}
      keyboardVerticalOffset={Platform.OS==="ios"?90:0}>
    <View style={ss.container}>
      <ScrollView contentContainerStyle={ss.scroll}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">

        {/* Header */}
        <View style={ss.header}>
          <Text style={ss.headerTitle}>💰 Nómina Colombia 2026</Text>
          <Text style={ss.headerSub}>Ley 2101 · {HORAS_SEMANA_2026}h/sem · CST actualizado</Text>
          {loadingBalances ? (
            <ActivityIndicator color="#C7D2FE" style={{ marginTop: 10 }} />
          ) : balanceList.length > 0 && (
            <TouchableOpacity style={ss.headerBalanceBtn} onPress={() => setBalanceModal(true)}>
              <Text style={ss.headerBalanceBtnText}>
                📊 Balance ({balanceList.length} período{balanceList.length>1?"s":""}) · ☁️ sincronizado
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tipo de contrato */}
        <View style={ss.card}>
          <Text style={ss.sectionTitle}>Tipo de contrato</Text>
          <TouchableOpacity style={ss.selectBtn} onPress={() => setModalContrato(true)}>
            <Text style={ss.selectBtnText}>{contrato.icon} {contrato.label}</Text>
          </TouchableOpacity>
          <Text style={ss.contractDesc}>{contrato.desc}</Text>
          {contrato.id === "servicios" && (
            <View style={ss.alertBox}>
              <Text style={ss.alertText}>⚠️ Prestación de servicios: sin auxilio de transporte, sin deducciones de empleado. El contratista paga salud y pensión como independiente (aprox. 12.5% + 16%).</Text>
            </View>
          )}
        </View>

        {/* Salario / Valor hora */}
        <View style={ss.card}>
          {isPartTime ? (
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
                  <Text style={ss.infoVal}>{formatCOP(valorHora)}/hora</Text>
                </View>
              )}
            </>
          ) : (
            <>
              {/* Toggle modo salario / modo hora */}
              <View style={ss.modoRow}>
                <TouchableOpacity
                  style={[ss.modoBtn, !modoHora && ss.modoBtnActive]}
                  onPress={() => setModoHora(false)}>
                  <Text style={[ss.modoBtnText, !modoHora && ss.modoBtnTextActive]}>
                    💼 Salario mensual
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[ss.modoBtn, modoHora && ss.modoBtnActive]}
                  onPress={() => setModoHora(true)}>
                  <Text style={[ss.modoBtnText, modoHora && ss.modoBtnTextActive]}>
                    ⏱ Valor por hora
                  </Text>
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
                      <Text style={ss.infoVal}>{formatCOP(valorHoraCalc)}/hora</Text>
                    </View>
                  )}
                  {salario > 0 && salario < SMMLV_2026 && (
                    <View style={ss.alertBox}>
                      <Text style={ss.alertText}>⚠️ Por debajo del SMMLV 2026 ({formatCOP(SMMLV_2026)})</Text>
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
                      <Text style={ss.infoVal}>{formatCOP(valorHoraIngresado)}/hora</Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {/* Toggles comunes */}
          {contrato.auxTransporte && (
            <View style={ss.toggleRow}>
              <View style={{flex:1}}>
                <Text style={ss.toggleLabel}>Auxilio de transporte</Text>
                <Text style={ss.toggleSub}>
                  {isPartTime ? `Proporcional a horas · base ${formatCOP(AUX_TRANSPORTE)}` : `${formatCOP(AUX_TRANSPORTE)}/mes · solo si salario ≤ 2 SMMLV`}
                </Text>
              </View>
              <Switch value={inclAuxTransp} onValueChange={setInclAuxTransp}
                trackColor={{true:"#4F46E5"}} />
            </View>
          )}
          {contrato.prestaciones && (
            <View style={ss.toggleRow}>
              <View style={{flex:1}}>
                <Text style={ss.toggleLabel}>Deducciones de ley</Text>
                <Text style={ss.toggleSub}>Salud 4% + Pensión 4% sobre devengado</Text>
              </View>
              <Switch value={inclDeducciones} onValueChange={setInclDeducciones}
                trackColor={{true:"#4F46E5"}} />
            </View>
          )}
        </View>

        {/* Recargos personalizables */}
        <View style={ss.card}>
          <TouchableOpacity
            style={ss.recargoToggleRow}
            onPress={() => setShowRecargos(!showRecargos)}>
            <View style={{flex:1}}>
              <Text style={ss.sectionTitle}>⚙️ Recargos personalizados</Text>
              <Text style={ss.cutDesc}>
                {showRecargos ? "Toca para ocultar" :
                  `Noc ${pctNocturno}% · Ext día ${pctExtDia}% · Ext noche ${pctExtNoche}% · Dom/fest ${isPartTime ? domPct : pctDomOrd}%`}
              </Text>
            </View>
            <Text style={ss.expandIcon}>{showRecargos ? "▲" : "▼"}</Text>
          </TouchableOpacity>

          {showRecargos && (
            <View style={{marginTop:12}}>
              <View style={ss.recargoInputGrid}>
                {[
                  ["🌙 Nocturno ord.", pctNocturno,  setPctNocturno,  "35"],
                  ["⚡☀️ Extra diurno", pctExtDia,    setPctExtDia,    "25"],
                  ["⚡🌙 Extra nocturno", pctExtNoche, setPctExtNoche,  "75"],
                  [isPartTime ? "🟡 Dom/fest (D1)" : "🟡 Dom/fest ord.",
                   isPartTime ? domPct : pctDomOrd,
                   isPartTime ? setDomPct : setPctDomOrd,
                   isPartTime ? "80" : "75"],
                ].map(([label, val, setter, def]) => (
                  <View key={label} style={ss.recargoInputItem}>
                    <Text style={ss.recargoInputLabel}>{label}</Text>
                    <View style={ss.recargoInputRow}>
                      <TextInput
                        style={ss.recargoInput}
                        keyboardType="numeric"
                        returnKeyType="done"
                        blurOnSubmit
                        value={val}
                        onChangeText={setter}
                      />
                      <Text style={ss.recargoInputSuffix}>%</Text>
                    </View>
                    <Text style={ss.recargoMult}>
                      ×{(1 + (parseFloat(val)||parseFloat(def))/100).toFixed(2)}
                    </Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={ss.resetBtn}
                onPress={() => {
                  setPctNocturno("35");
                  setPctExtDia("25");
                  setPctExtNoche("75");
                  setPctDomOrd("75");
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
              <TextInput
                style={[ss.cutInput, {flex:1}]}
                keyboardType="numeric"
                returnKeyType="done"
                blurOnSubmit
                value={domPct}
                onChangeText={setDomPct}
              />
              <View style={ss.domInfo}>
                <Text style={ss.domInfoText}>
                  Multiplicador: ×{(1 + (parseFloat(domPct)||80)/100).toFixed(2)}
                </Text>
                <Text style={ss.domInfoSub}>Tu liquidación muestra 80%</Text>
              </View>
            </View>

            <View style={ss.dividerLight}/>

            <Text style={[ss.cutLabel,{marginTop:10}]}>Descanso remunerado</Text>
            <Text style={ss.toggleSub}>1 día de descanso remunerado por cada N días trabajados</Text>
            <View style={ss.domRow}>
              <TextInput
                style={[ss.cutInput, {flex:1}]}
                keyboardType="numeric"
                returnKeyType="done"
                blurOnSubmit
                value={diasXDescanso}
                onChangeText={setDiasXDescanso}
              />
              <View style={ss.domInfo}>
                {diasTrabajados.length > 0 && (
                  <Text style={ss.domInfoText}>
                    {diasDescansoRem} día{diasDescansoRem!==1?"s":""} de descanso rem.
                  </Text>
                )}
                <Text style={ss.domInfoSub}>= {formatCOP(descRemunerado)}</Text>
              </View>
            </View>

            <View style={ss.dividerLight}/>

            <View style={[ss.toggleRow,{marginTop:10}]}>
              <View style={{flex:1}}>
                <Text style={ss.toggleLabel}>Prima legal proporcional</Text>
                <Text style={ss.toggleSub}>
                  {inclPrima ? `≈ ${formatCOP(primaLegal)} (${days.length} días / 360 / 2)` : "Activar para incluir en este período"}
                </Text>
              </View>
              <Switch value={inclPrima} onValueChange={setInclPrima}
                trackColor={{true:"#4F46E5"}} />
            </View>

            {valorHora > 0 && totalHorasPT > 0 && (
              <View style={[ss.infoRow,{marginTop:10}]}>
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
            <View style={{flex:1}}>
              <Text style={ss.cutLabel}>Desde — día</Text>
              <TextInput style={ss.cutInput} keyboardType="numeric"
                returnKeyType="done" blurOnSubmit
                value={diaInicio} onChangeText={setDiaInicio} />
            </View>
            <View style={{flex:1}}>
              <Text style={ss.cutLabel}>Mes</Text>
              <TouchableOpacity style={ss.cutMesBtn} onPress={() => setModalMesInicio(true)}>
                <Text style={ss.cutMesBtnText}>{MESES[mesInicio].label}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={ss.cutRow}>
            <View style={{flex:1}}>
              <Text style={ss.cutLabel}>Hasta — día</Text>
              <TextInput style={ss.cutInput} keyboardType="numeric"
                returnKeyType="done" blurOnSubmit
                value={diaFin} onChangeText={setDiaFin} />
            </View>
            <View style={{flex:1}}>
              <Text style={ss.cutLabel}>Mes</Text>
              <TouchableOpacity style={ss.cutMesBtn} onPress={() => setModalMesFin(true)}>
                <Text style={ss.cutMesBtnText}>{MESES[mesFin].label}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={ss.applyBtn} onPress={cargarCorte}>
            <Text style={ss.applyBtnText}>📅 Cargar período {diaInicio}/{pad(mesInicio+1)} → {diaFin}/{pad(mesFin+1)}</Text>
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
                onChange={(v) => setExtrasPeriodoAnterior(p=>({...p,extDayH:v}))} />
              <Stepper label="⚡🌙 Extra nocturna (+75%)"
                value={extrasPeriodoAnterior.extNightH}
                onChange={(v) => setExtrasPeriodoAnterior(p=>({...p,extNightH:v}))} />
            </View>
            <View style={[ss.stepperGrid,{marginTop:10}]}>
              <Stepper label="🟡⚡☀️ Dom/Fest extra día (+100%)"
                value={extrasPeriodoAnterior.extDomDayH}
                onChange={(v) => setExtrasPeriodoAnterior(p=>({...p,extDomDayH:v}))} />
              <Stepper label="🟡⚡🌙 Dom/Fest extra noche (+150%)"
                value={extrasPeriodoAnterior.extDomNightH}
                onChange={(v) => setExtrasPeriodoAnterior(p=>({...p,extDomNightH:v}))} />
            </View>
            {subtotalExt > 0 && (
              <View style={ss.infoRow}>
                <Text style={ss.infoText}>Total extras vencidas</Text>
                <Text style={[ss.infoVal,{color:"#059669"}]}>{formatCOP(subtotalExt)}</Text>
              </View>
            )}
          </View>
        )}

        {/* Leyenda */}
        {corteCargado && (
          <View style={ss.legendRow}>
            {[["Normal","#fff","#E5E7EB"],["Domingo","#FEF08A",null],
              ["Festivo","#FDE68A","#F59E0B"],["Descanso","#DBEAFE","#93C5FD"],
              ["No trabajado","#F3F4F6","#E5E7EB"]].map(([l,bg,border])=>(
              <View key={l} style={ss.legendItem}>
                <View style={[ss.legendDot,{backgroundColor:bg,
                  borderColor:border||bg,borderWidth:border?1:0}]}/>
                <Text style={ss.legendText}>{l}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Calendario */}
        {corteCargado && days.length > 0 && (
          <View style={ss.card}>
            <View style={{ flexDirection:"row", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <Text style={ss.sectionTitle}>
                Días · {diasTrabajados.length} trabajados · {diasDescanso} descanso
              </Text>
              <TouchableOpacity style={ss.scanBtn} onPress={() => setScannerVisible(true)}>
                <Text style={ss.scanBtnText}>📷 Escanear</Text>
              </TouchableOpacity>
            </View>
            <Text style={ss.cutDesc}>Toca 🛌 para marcar descanso · ✕ para no trabajado</Text>
            {days.map((item, index) => renderDay(item, index))}
          </View>
        )}

        {/* Resumen */}
        {corteCargado && (
          <View style={ss.totalsCard}>
            <Text style={ss.totalsTitle}>📊 Liquidación del período</Text>
            <Text style={ss.totalsSubtitle}>{contrato.icon} {contrato.label} · {labelCorte}</Text>

            {isPartTime && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días trabajados</Text>
                <Text style={ss.totalValue}>{diasTrabajados.length} · {fmtHrs(totalHorasPT)} total</Text>
              </View>
            )}
            {!isPartTime && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>Días trabajados</Text>
                <Text style={ss.totalValue}>{diasTrabajados.length} días</Text>
              </View>
            )}
            <View style={ss.totalRow}>
              <Text style={ss.totalLabel}>Días de descanso</Text>
              <Text style={ss.totalValue}>{diasDescanso} días</Text>
            </View>
            <View style={ss.totalRow}>
              <Text style={ss.totalLabel}>Días especiales</Text>
              <Text style={ss.totalValue}>{diasEspeciales} días</Text>
            </View>

            <View style={ss.divider}/>

            <View style={ss.totalRow}>
              <Text style={ss.totalLabel}>Subtotal ordinario</Text>
              <Text style={ss.totalValue}>{formatCOP(subtotalOrd)}</Text>
            </View>
            {subtotalExt > 0 && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>⚡ Extras mes vencido</Text>
                <Text style={ss.totalValue}>{formatCOP(subtotalExt)}</Text>
              </View>
            )}
            {descRemunerado > 0 && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>🛌 Descanso remunerado ({diasDescansoRem} días)</Text>
                <Text style={ss.totalValue}>{formatCOP(descRemunerado)}</Text>
              </View>
            )}
            {primaLegal > 0 && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>🎁 Prima legal proporcional</Text>
                <Text style={ss.totalValue}>{formatCOP(primaLegal)}</Text>
              </View>
            )}
            {auxTransp > 0 && (
              <View style={ss.totalRow}>
                <Text style={ss.totalLabel}>🚌 Aux. transporte{isPartTime ? " (proporcional)" : ""}</Text>
                <Text style={ss.totalValue}>{formatCOP(auxTransp)}</Text>
              </View>
            )}

            <View style={ss.grandTotalBox}>
              <Text style={ss.grandTotalLabel}>TOTAL BRUTO</Text>
              <Text style={ss.grandTotalValue}>{formatCOP(totalBruto)}</Text>
            </View>

            {totalDeduc > 0 && (
              <>
                <View style={ss.divider}/>
                {[
                  [`(-) Salud 4%`,    deducSalud],
                  [`(-) Pensión 4%`,  deducPension],
                ].map(([l,v])=>(
                  <View key={l} style={ss.totalRow}>
                    <Text style={ss.totalLabel}>{l}</Text>
                    <Text style={[ss.totalValue,{color:"#FCA5A5"}]}>-{formatCOP(v)}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={ss.netoBox}>
              <Text style={ss.netoLabel}>NETO A PAGAR</Text>
              <Text style={ss.netoValue}>{formatCOP(totalNeto)}</Text>
            </View>

            <View style={ss.actionRow}>
              <TouchableOpacity style={ss.saveBtn} onPress={handleSave}>
                <Text style={ss.saveBtnText}>{isEditing?"✏️ Actualizar":"💾 Guardar"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ss.pdfBtn} onPress={exportPDF}>
                <Text style={ss.pdfBtnText}>📄 PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={{height:40}}/>
      </ScrollView>

      {/* Modal scanner */}
      <Modal visible={scannerVisible} animationType="slide"
        onRequestClose={() => setScannerVisible(false)}>
        <ScheduleScanner
          days={days}
          onApply={aplicarEscaneo}
          onClose={() => setScannerVisible(false)}
        />
      </Modal>

      {/* Modal tipo contrato */}
      <Modal visible={modalContrato} transparent animationType="slide"
        onRequestClose={()=>setModalContrato(false)}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1}
          onPress={()=>setModalContrato(false)}>
          <View style={ss.modalBox}>
            <Text style={ss.modalTitle}>Tipo de contrato</Text>
            <FlatList
              data={TIPOS_CONTRATO}
              keyExtractor={(t) => t.id}
              renderItem={({ item: t }) => (
                <TouchableOpacity
                  style={[ss.contractItem, contrato.id===t.id && ss.contractItemActive]}
                  onPress={() => { setTipoContrato(t); setModalContrato(false); }}>
                  <Text style={ss.contractItemIcon}>{t.icon}</Text>
                  <View style={{flex:1}}>
                    <Text style={[ss.contractItemLabel, contrato.id===t.id && {color:"#4F46E5"}]}>
                      {t.label}
                    </Text>
                    <Text style={ss.contractItemDesc}>{t.desc}</Text>
                  </View>
                  {contrato.id===t.id && <Text style={{color:"#4F46E5", fontWeight:"700"}}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal mes inicio */}
      <Modal visible={modalMesInicio} transparent animationType="slide"
        onRequestClose={()=>setModalMesInicio(false)}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1}
          onPress={()=>setModalMesInicio(false)}>
          <View style={ss.modalBox}>
            <Text style={ss.modalTitle}>Mes de inicio</Text>
            <FlatList data={MESES} keyExtractor={(m)=>m.label}
              renderItem={({item})=>(
                <TouchableOpacity style={ss.monthItem}
                  onPress={()=>{setMesInicio(item.month);setModalMesInicio(false);}}>
                  <Text style={[ss.monthItemText,mesInicio===item.month&&{color:"#4F46E5",fontWeight:"700"}]}>
                    {item.label}
                  </Text>
                  {mesInicio===item.month && <Text style={{color:"#4F46E5"}}>✓</Text>}
                </TouchableOpacity>
              )}/>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal mes fin */}
      <Modal visible={modalMesFin} transparent animationType="slide"
        onRequestClose={()=>setModalMesFin(false)}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1}
          onPress={()=>setModalMesFin(false)}>
          <View style={ss.modalBox}>
            <Text style={ss.modalTitle}>Mes de fin</Text>
            <FlatList data={MESES} keyExtractor={(m)=>m.label}
              renderItem={({item})=>(
                <TouchableOpacity style={ss.monthItem}
                  onPress={()=>{setMesFin(item.month);setModalMesFin(false);}}>
                  <Text style={[ss.monthItemText,mesFin===item.month&&{color:"#4F46E5",fontWeight:"700"}]}>
                    {item.label}
                  </Text>
                  {mesFin===item.month && <Text style={{color:"#4F46E5"}}>✓</Text>}
                </TouchableOpacity>
              )}/>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal balance */}
      <Modal visible={balanceModal} transparent animationType="slide"
        onRequestClose={()=>setBalanceModal(false)}>
        <TouchableOpacity style={ss.modalOverlay} activeOpacity={1}
          onPress={()=>setBalanceModal(false)}>
          <View style={ss.modalBox}>
            <Text style={ss.modalTitle}>📊 Balances guardados 2026</Text>
            {balanceList.length===0 ? (
              <Text style={{color:"#9CA3AF",textAlign:"center",marginTop:20}}>
                Aún no hay períodos guardados
              </Text>
            ) : (
              <>
                <FlatList data={balanceList} keyExtractor={(b)=>b.key||b.corte}
                  renderItem={({item:b})=>(
                    <View style={ss.balanceItem}>
                      <View style={{flex:1}}>
                        <Text style={ss.balanceMes}>{b.corte}</Text>
                        <Text style={ss.balanceDetail}>
                          {TIPOS_CONTRATO.find(t=>t.id===b.contrato)?.label||b.contrato}
                          {" · "}{b.dias} días · guardado {b.fecha}
                        </Text>
                        <Text style={ss.balanceDetail}>
                          Bruto: {formatCOP(b.totalBruto)}
                        </Text>
                      </View>
                      <View style={{alignItems:"flex-end"}}>
                        <Text style={ss.balanceTotal}>{formatCOP(b.totalNeto)}</Text>
                        <Text style={ss.balanceNeto}>neto</Text>
                        <View style={{flexDirection:"row",gap:10,marginTop:4}}>
                          <TouchableOpacity onPress={()=>handleEdit(b)}>
                            <Text style={ss.balanceEdit}>✏️ Editar</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={()=>handleDelete(b.corte||b.key)}>
                            <Text style={ss.balanceDelete}>🗑 Borrar</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  )}/>
                <View style={ss.acumBox}>
                  <Text style={ss.acumLabel}>ACUMULADO NETO 2026</Text>
                  <Text style={ss.acumValue}>{formatCOP(acumNeto)}</Text>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  container: { flex:1, backgroundColor:"#F4F6FA" },
  scroll:    { padding:16 },

  header: { backgroundColor:"#4F46E5", borderRadius:16, padding:20,
    marginBottom:16, alignItems:"center" },
  headerTitle: { color:"#fff", fontSize:20, fontWeight:"700" },
  headerSub:   { color:"#C7D2FE", fontSize:12, marginTop:4 },
  headerBalanceBtn: { backgroundColor:"rgba(255,255,255,0.15)", borderRadius:8,
    paddingHorizontal:14, paddingVertical:6, marginTop:10 },
  headerBalanceBtnText: { color:"#fff", fontSize:13, fontWeight:"600" },

  card: { backgroundColor:"#fff", borderRadius:14, padding:16,
    marginBottom:14, elevation:2, shadowColor:"#000", shadowOpacity:0.06, shadowRadius:8 },
  sectionTitle: { fontSize:15, fontWeight:"600", color:"#1E1B4B", marginBottom:8 },

  contractDesc: { fontSize:12, color:"#6B7280", marginTop:6, lineHeight:17 },
  alertBox:  { backgroundColor:"#FEF2F2", borderRadius:8, padding:10, marginTop:8 },
  alertText: { fontSize:11, color:"#B91C1C", lineHeight:16 },

  selectBtn:     { backgroundColor:"#EEF2FF", borderRadius:10, padding:14, alignItems:"center" },
  selectBtnText: { color:"#4F46E5", fontWeight:"600", fontSize:15 },

  rateInputBig: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:14,
    fontSize:22, fontWeight:"700", color:"#111", backgroundColor:"#FAFAFA", textAlign:"center" },

  infoRow: { flexDirection:"row", justifyContent:"space-between",
    marginTop:10, paddingTop:8, borderTopWidth:1, borderTopColor:"#F3F4F6" },
  infoText: { fontSize:13, color:"#6B7280" },
  infoVal:  { fontSize:13, fontWeight:"700", color:"#4F46E5" },

  toggleRow: { flexDirection:"row", alignItems:"center", marginTop:12,
    paddingTop:10, borderTopWidth:1, borderTopColor:"#F3F4F6" },
  toggleLabel: { fontSize:13, fontWeight:"600", color:"#374151" },
  toggleSub:   { fontSize:11, color:"#9CA3AF", marginTop:2 },

  cutDesc:  { fontSize:12, color:"#9CA3AF", marginBottom:10 },
  cutRow:   { flexDirection:"row", gap:10, marginBottom:10 },
  cutLabel: { fontSize:12, color:"#6B7280", marginBottom:4 },
  cutInput: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    padding:10, fontSize:16, fontWeight:"600", color:"#111", backgroundColor:"#FAFAFA" },
  cutMesBtn:     { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    padding:10, backgroundColor:"#FAFAFA" },
  cutMesBtnText: { fontSize:14, color:"#374151", fontWeight:"600" },
  applyBtn:     { backgroundColor:"#4F46E5", borderRadius:10, padding:14, alignItems:"center", marginTop:4 },
  applyBtnText: { color:"#fff", fontWeight:"700", fontSize:14 },

  recargoToggleRow:  { flexDirection:"row", alignItems:"center" },
  recargoInputGrid:  { flexDirection:"row", flexWrap:"wrap", gap:10 },
  recargoInputItem:  { width:"47%" },
  recargoInputLabel: { fontSize:11, color:"#6B7280", marginBottom:4 },
  recargoInputRow:   { flexDirection:"row", alignItems:"center",
    borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    backgroundColor:"#FAFAFA", paddingHorizontal:10 },
  recargoInput:      { flex:1, fontSize:16, fontWeight:"600", color:"#111",
    paddingVertical:8 },
  recargoInputSuffix:{ fontSize:14, color:"#6B7280", fontWeight:"600" },
  recargoMult:       { fontSize:11, color:"#4F46E5", marginTop:3, fontWeight:"600" },
  resetBtn:          { marginTop:14, alignItems:"center", padding:10,
    backgroundColor:"#F3F4F6", borderRadius:10 },
  resetBtnText:      { fontSize:12, color:"#6B7280", fontWeight:"600" },

  modoRow:          { flexDirection:"row", gap:8, marginBottom:12 },
  modoBtn:          { flex:1, borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    padding:10, alignItems:"center", backgroundColor:"#FAFAFA" },
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
  stepperRow:   { flexDirection:"row", alignItems:"center",
    borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    backgroundColor:"#FAFAFA", overflow:"hidden" },
  stepBtn:     { width:36, height:36, alignItems:"center", justifyContent:"center",
    backgroundColor:"#EEF2FF" },
  stepBtnText: { fontSize:20, fontWeight:"700", color:"#4F46E5", lineHeight:22 },
  stepperVal:  { flex:1, textAlign:"center", fontSize:13, fontWeight:"600", color:"#111" },

  legendRow:  { flexDirection:"row", flexWrap:"wrap", gap:8, marginBottom:10, paddingHorizontal:2 },
  legendItem: { flexDirection:"row", alignItems:"center", gap:4 },
  legendDot:  { width:12, height:12, borderRadius:6 },
  legendText: { fontSize:10, color:"#6B7280" },

  dayRow:        { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10,
    marginBottom:6, backgroundColor:"#FAFAFA", overflow:"hidden" },
  dayRowEsp:     { borderColor:"#F59E0B", backgroundColor:"#FFFBEB", borderWidth:1.5 },
  dayRowOff:     { borderWidth:1, borderColor:"#F3F4F6", borderRadius:10,
    padding:10, marginBottom:6, backgroundColor:"#F9FAFB",
    flexDirection:"row", alignItems:"center", justifyContent:"space-between" },
  dayRowDescanso:{ borderWidth:1, borderColor:"#93C5FD", borderRadius:10,
    padding:10, marginBottom:6, backgroundColor:"#EFF6FF",
    flexDirection:"row", alignItems:"center" },
  dayRowHeader:  { flexDirection:"row", alignItems:"center", padding:10 },
  dayNum:        { fontSize:13, fontWeight:"600", color:"#374151" },
  dayNumOff:     { fontSize:13, color:"#9CA3AF" },
  dayNumDescanso:{ fontSize:13, fontWeight:"600", color:"#1D4ED8" },
  dayStatusOff:  { fontSize:11, color:"#D1D5DB" },
  badge:         { backgroundColor:"#FEF08A", borderRadius:6, paddingHorizontal:5, paddingVertical:1 },
  badgeText:     { fontSize:9, color:"#92400E", fontWeight:"600" },
  recargoBadge:  { fontSize:10, color:"#B45309", marginTop:1 },
  hoursCompact:  { fontSize:10, color:"#6B7280", marginTop:2 },
  dayCost:       { fontSize:13, fontWeight:"700", color:"#4F46E5", marginRight:4 },
  dayCostEsp:    { color:"#D97706" },
  expandIcon:    { fontSize:10, color:"#9CA3AF", marginRight:6 },
  descansoBtn:   { padding:4, backgroundColor:"#EFF6FF", borderRadius:6 },
  descansoBtnText:{ fontSize:12 },
  removeBtn:     { padding:4 },
  removeBtnText: { color:"#EF4444", fontSize:14, fontWeight:"700" },
  toggleBtn:     { backgroundColor:"#DBEAFE", borderRadius:8, paddingHorizontal:10, paddingVertical:6 },
  toggleBtnText: { fontSize:11, color:"#1D4ED8", fontWeight:"600" },

  expandedContent: { padding:10, borderTopWidth:1, borderTopColor:"#F3F4F6", backgroundColor:"#fff" },
  groupLabel:    { fontSize:12, fontWeight:"600", color:"#6B7280", marginBottom:6 },
  desglose:      { backgroundColor:"#F8F9FF", borderRadius:8, padding:10, marginTop:10 },
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

  grandTotalBox: { backgroundColor:"#4F46E5", borderRadius:12, padding:14,
    marginTop:10, alignItems:"center" },
  grandTotalLabel:{ color:"#C7D2FE", fontSize:11, fontWeight:"600", letterSpacing:1 },
  grandTotalValue:{ color:"#fff", fontSize:24, fontWeight:"800", marginTop:2 },

  netoBox:   { backgroundColor:"#059669", borderRadius:12, padding:14,
    marginTop:10, alignItems:"center" },
  netoLabel: { color:"rgba(255,255,255,.8)", fontSize:11, fontWeight:"600", letterSpacing:1 },
  netoValue: { color:"#fff", fontSize:28, fontWeight:"800", marginTop:2 },

  actionRow: { flexDirection:"row", gap:10, marginTop:14 },
  saveBtn:   { flex:1, backgroundColor:"#0EA5E9", borderRadius:12, padding:14, alignItems:"center" },
  saveBtnText:{ color:"#fff", fontSize:14, fontWeight:"700" },
  pdfBtn:    { flex:1, backgroundColor:"#059669", borderRadius:12, padding:14, alignItems:"center" },
  pdfBtnText:{ color:"#fff", fontSize:14, fontWeight:"700" },

  modalOverlay: { flex:1, backgroundColor:"rgba(0,0,0,0.4)", justifyContent:"flex-end" },
  modalBox:     { backgroundColor:"#fff", borderTopLeftRadius:20,
    borderTopRightRadius:20, padding:20, maxHeight:"80%" },
  modalTitle:   { fontSize:17, fontWeight:"700", color:"#1E1B4B", marginBottom:16 },

  contractItem:       { flexDirection:"row", alignItems:"flex-start", paddingVertical:12,
    borderBottomWidth:1, borderBottomColor:"#F3F4F6", gap:10 },
  contractItemActive: { backgroundColor:"#EEF2FF", borderRadius:10, paddingHorizontal:8, marginHorizontal:-8 },
  contractItemIcon:   { fontSize:20, marginTop:2 },
  contractItemLabel:  { fontSize:14, fontWeight:"600", color:"#374151" },
  contractItemDesc:   { fontSize:11, color:"#9CA3AF", marginTop:2, lineHeight:16 },

  monthItem:     { flexDirection:"row", justifyContent:"space-between",
    paddingVertical:14, borderBottomWidth:1, borderBottomColor:"#F3F4F6" },
  monthItemText: { fontSize:15, color:"#374151" },

  balanceItem:   { flexDirection:"row", paddingVertical:12,
    borderBottomWidth:1, borderBottomColor:"#F3F4F6" },
  balanceMes:    { fontSize:14, fontWeight:"600", color:"#1E1B4B" },
  balanceDetail: { fontSize:11, color:"#6B7280", marginTop:2 },
  balanceTotal:  { fontSize:15, fontWeight:"700", color:"#4F46E5" },
  balanceNeto:   { fontSize:10, color:"#059669" },
  balanceEdit:   { fontSize:11, color:"#4F46E5" },
  balanceDelete: { fontSize:11, color:"#EF4444" },

  acumBox:   { backgroundColor:"#059669", borderRadius:12,
    padding:14, marginTop:14, alignItems:"center" },
  acumLabel: { color:"rgba(255,255,255,.8)", fontSize:11, fontWeight:"600", letterSpacing:1 },
  acumValue: { color:"#fff", fontSize:24, fontWeight:"800", marginTop:4 },
});