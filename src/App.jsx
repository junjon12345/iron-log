import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, TrendingUp, ChevronUp, ChevronDown, Minus, Star,
  CalendarDays, Trash2, ArrowLeft, Dumbbell, Check, Download, Settings as SettingsIcon,
  SlidersHorizontal, Database, Bell, LogIn, LogOut, Cloud
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const KEY_LOG = 'training-log';
const KEY_CATALOG = 'exercise-catalog';
const KEY_SETTINGS = 'app-settings';
const DEFAULT_SETTINGS = { autoFillLastWeight: true };

// Firebase設定（公開して問題ない識別情報。実際のアクセス制御はFirestoreのセキュリティルール側で行う）
const firebaseConfig = {
  apiKey: "AIzaSyD2H4xwEg3YJTPk_YSJduSKILrrawHooYI",
  authDomain: "iron-log-9328e.firebaseapp.com",
  projectId: "iron-log-9328e",
  storageBucket: "iron-log-9328e.firebasestorage.app",
  messagingSenderId: "148505972312",
  appId: "1:148505972312:web:c1302f9d6c25cabe4e042d",
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();

const PLATE = {
  red: '#C8433A',
  blue: '#3B7DC4',
  yellow: '#E0B23C',
  green: '#4C9A5D',
  chalk: '#D8D6CE',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const WEIGHT_OPTIONS = Array.from({ length: 60 }, (_, i) => (i + 1) * 5); // 5kg〜300kg (5kg刻み)

function nearestWeightOption(rawValue) {
  const n = parseFloat(rawValue);
  if (isNaN(n) || n < 0) return '';
  // 5kg単位で切り捨てる（例: 145→145, 82→80, 89→85）。5kg未満は最小値の5kgに揃える
  const target = Math.max(5, Math.floor(n / 5) * 5);
  return WEIGHT_OPTIONS.includes(target) ? String(target) : '';
}

function estOneRM(weight, reps) {
  if (!weight || !reps) return 0;
  // O'Connor式: 1RM = 重量 × (1 + 0.025 × 回数)
  return weight * (1 + 0.025 * reps);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

function buildCalendarCells(monthCursor) {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function getExerciseHistory(log, exerciseName) {
  const entries = [];
  Object.keys(log)
    .sort()
    .forEach((date) => {
      (log[date] || []).forEach((item) => {
        if (item.exercise === exerciseName && item.sets && item.sets.length) {
          entries.push({ date, sets: item.sets });
        }
      });
    });
  return entries;
}

function bestSet(sets) {
  if (!sets || !sets.length) return null;
  let best = sets[0];
  sets.forEach((s) => {
    if (estOneRM(s.weight, s.reps) > estOneRM(best.weight, best.reps)) best = s;
  });
  return best;
}

// 日付ごとに「その日、何かの種目で自己ベスト（1RM）を更新したか」を判定する
function computePRDates(log) {
  const perExerciseBest = {};
  const prDates = new Set();
  Object.keys(log)
    .sort()
    .forEach((date) => {
      (log[date] || []).forEach((entry) => {
        const best = bestSet(entry.sets);
        if (!best || !best.weight || !best.reps) return;
        const e1rm = estOneRM(best.weight, best.reps);
        const prevBest = perExerciseBest[entry.exercise] || 0;
        if (e1rm > prevBest) {
          perExerciseBest[entry.exercise] = e1rm;
          prDates.add(date);
        }
      });
    });
  return prDates;
}

function hasEntries(entries) {
  return !!(entries && entries.length && entries.some((e) => e.sets && e.sets.length));
}

function exportCSV(log) {
  const rows = [['日付', '種目', 'セット', '重量kg', '回数', '推定1RM(kg)']];
  Object.keys(log)
    .sort()
    .forEach((date) => {
      (log[date] || []).forEach((entry) => {
        (entry.sets || []).forEach((s, i) => {
          rows.push([
            date,
            entry.exercise,
            String(i + 1),
            String(s.weight),
            String(s.reps),
            String(round1(estOneRM(s.weight, s.reps))),
          ]);
        });
      });
    });
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iron-log_${fmtDate(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [log, setLog] = useState({});
  const [catalog, setCatalog] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [view, setView] = useState('calendar');
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [setDraft, setSetDraft] = useState({});
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let logData = {};
    let catData = [];
    try {
      const raw = window.localStorage.getItem(KEY_LOG);
      if (raw) logData = JSON.parse(raw);
    } catch (e) {
      /* no data yet */
    }
    try {
      const raw2 = window.localStorage.getItem(KEY_CATALOG);
      if (raw2) catData = JSON.parse(raw2);
    } catch (e) {
      /* no data yet */
    }
    let settingsData = DEFAULT_SETTINGS;
    try {
      const raw3 = window.localStorage.getItem(KEY_SETTINGS);
      if (raw3) settingsData = { ...DEFAULT_SETTINGS, ...JSON.parse(raw3) };
    } catch (e) {
      /* no data yet */
    }
    setLog(logData);
    setCatalog(catData);
    setSettings(settingsData);
    setLoading(false);
  }, []);

  // Googleログイン状態を監視し、ログインしていればクラウドのデータを読み込む
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthLoading(false);
      if (firebaseUser) {
        setSyncing(true);
        try {
          const ref = doc(db, 'users', firebaseUser.uid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data();
            if (data.log) {
              setLog(data.log);
              window.localStorage.setItem(KEY_LOG, JSON.stringify(data.log));
            }
            if (data.catalog) {
              setCatalog(data.catalog);
              window.localStorage.setItem(KEY_CATALOG, JSON.stringify(data.catalog));
            }
            if (data.settings) {
              const merged = { ...DEFAULT_SETTINGS, ...data.settings };
              setSettings(merged);
              window.localStorage.setItem(KEY_SETTINGS, JSON.stringify(merged));
            }
          } else {
            // 初回ログイン: 今この端末にあるデータをクラウドの初期データとしてアップロード
            await setDoc(ref, { log, catalog, settings });
          }
          setSaveError(null);
        } catch (e) {
          setSaveError('クラウド同期に失敗しました');
        } finally {
          setSyncing(false);
        }
      }
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setSaveError('ログインに失敗しました');
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (e) {
      setSaveError('ログアウトに失敗しました');
    }
  }

  function syncToCloud(partialData) {
    if (!user) return;
    setDoc(doc(db, 'users', user.uid), partialData, { merge: true }).catch(() => {
      setSaveError('クラウド同期に失敗しました');
    });
  }

  function persistLog(newLog) {
    setLog(newLog);
    try {
      window.localStorage.setItem(KEY_LOG, JSON.stringify(newLog));
      setSaveError(null);
    } catch (e) {
      setSaveError('保存に失敗しました');
    }
    syncToCloud({ log: newLog });
  }

  function persistCatalog(newCatalog) {
    setCatalog(newCatalog);
    try {
      window.localStorage.setItem(KEY_CATALOG, JSON.stringify(newCatalog));
    } catch (e) {
      setSaveError('保存に失敗しました');
    }
    syncToCloud({ catalog: newCatalog });
  }

  function toggleSetting(key) {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try {
      window.localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
    } catch (e) {
      setSaveError('保存に失敗しました');
    }
    syncToCloud({ settings: next });
  }

  const todayStr = fmtDate(new Date());
  const cells = useMemo(() => buildCalendarCells(monthCursor), [monthCursor]);
  const dayEntries = selectedDate ? log[selectedDate] || [] : [];

  const allExerciseNames = useMemo(() => {
    const set = new Set(catalog);
    Object.values(log).forEach((entries) =>
      (entries || []).forEach((e) => set.add(e.exercise))
    );
    return Array.from(set);
  }, [catalog, log]);

  function openDay(date) {
    setSelectedDate(fmtDate(date));
    setAddingExercise(false);
    setNewExerciseName('');
    setView('day');
  }

  function goToday() {
    setMonthCursor(new Date());
    openDay(new Date());
  }

  function addExerciseToDay(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const newLog = { ...log };
    const list = newLog[selectedDate] ? [...newLog[selectedDate]] : [];
    list.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, exercise: trimmed, sets: [] });
    newLog[selectedDate] = list;
    persistLog(newLog);
    if (!catalog.includes(trimmed)) {
      persistCatalog([...catalog, trimmed]);
    }
    setNewExerciseName('');
    setAddingExercise(false);
  }

  function removeExercise(entryId) {
    const newLog = { ...log };
    newLog[selectedDate] = (newLog[selectedDate] || []).filter((e) => e.id !== entryId);
    if (newLog[selectedDate].length === 0) delete newLog[selectedDate];
    persistLog(newLog);
  }

  function addSet(entryId, weight, reps) {
    if (!weight || !reps) return;
    const newLog = { ...log };
    newLog[selectedDate] = (newLog[selectedDate] || []).map((e) =>
      e.id === entryId
        ? { ...e, sets: [...e.sets, { weight: Number(weight), reps: Number(reps) }] }
        : e
    );
    persistLog(newLog);
    // 設定がオンの場合のみ、同じ種目の2セット目以降に前回の重量を初期値として残す
    setSetDraft((d) => ({
      ...d,
      [entryId]: { weight: settings.autoFillLastWeight ? String(weight) : '', reps: '' },
    }));
  }


  function removeSet(entryId, setIdx) {
    const newLog = { ...log };
    newLog[selectedDate] = (newLog[selectedDate] || []).map((e) =>
      e.id === entryId ? { ...e, sets: e.sets.filter((_, i) => i !== setIdx) } : e
    );
    persistLog(newLog);
  }

  return (
    <div style={styles.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+JP:wght@400;500;600;700&family=Roboto+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        .wt-scroll::-webkit-scrollbar { width: 0; height: 0; }
        button { font-family: inherit; cursor: pointer; }
        input { font-family: inherit; }
      `}</style>

      <div style={styles.phoneFrame}>
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dumbbell size={20} color={PLATE.red} strokeWidth={2.5} />
            <span style={styles.headerTitle}>IRON LOG</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button style={styles.exportBtn} onClick={() => exportCSV(log)} title="CSV出力">
              <Download size={17} color="#9A9A9E" />
            </button>
            <button style={styles.exportBtn} onClick={() => setView('settings')} title="設定">
              <SettingsIcon size={17} color="#9A9A9E" />
            </button>
          </div>
        </div>

        <div style={styles.content} className="wt-scroll">
          {loading ? (
            <div style={styles.loadingBox}>読み込み中...</div>
          ) : view === 'calendar' ? (
            <CalendarView
              monthCursor={monthCursor}
              setMonthCursor={setMonthCursor}
              cells={cells}
              log={log}
              todayStr={todayStr}
              openDay={openDay}
            />
          ) : view === 'day' ? (
            <DayView
              selectedDate={selectedDate}
              dayEntries={dayEntries}
              log={log}
              catalog={catalog}
              onBack={() => setView('calendar')}
              addingExercise={addingExercise}
              setAddingExercise={setAddingExercise}
              newExerciseName={newExerciseName}
              setNewExerciseName={setNewExerciseName}
              addExerciseToDay={addExerciseToDay}
              removeExercise={removeExercise}
              addSet={addSet}
              removeSet={removeSet}
              setDraft={setDraft}
              setSetDraft={setSetDraft}
              autoFillLastWeight={settings.autoFillLastWeight}
            />
          ) : view === 'progress' ? (
            <ProgressView
              log={log}
              allExerciseNames={allExerciseNames}
              selectedExercise={selectedExercise}
              setSelectedExercise={setSelectedExercise}
            />
          ) : (
            <SettingsView
              onBack={() => setView('calendar')}
              settings={settings}
              onToggleSetting={toggleSetting}
              user={user}
              authLoading={authLoading}
              syncing={syncing}
              onLogin={handleLogin}
              onLogout={handleLogout}
            />
          )}
          {saveError && <div style={styles.errorBanner}>{saveError}</div>}
        </div>

        <div style={styles.bottomNav}>
          <NavButton
            icon={<CalendarDays size={20} />}
            label="カレンダー"
            active={view === 'calendar'}
            onClick={() => setView('calendar')}
          />
          <NavButton
            icon={<Plus size={22} />}
            label="今日を記録"
            active={false}
            accent
            onClick={goToday}
          />
          <NavButton
            icon={<TrendingUp size={20} />}
            label="種目"
            active={view === 'progress'}
            onClick={() => setView('progress')}
          />
        </div>
      </div>
    </div>
  );
}

function NavButton({ icon, label, active, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.navBtn,
        color: accent ? '#fff' : active ? PLATE.red : '#9A9A9E',
      }}
    >
      <div
        style={
          accent
            ? { ...styles.navAccentCircle }
            : {}
        }
      >
        {icon}
      </div>
      <span style={{ fontSize: 11, marginTop: 4, fontFamily: "'Noto Sans JP', sans-serif" }}>{label}</span>
    </button>
  );
}

function CalendarView({ monthCursor, setMonthCursor, cells, log, todayStr, openDay }) {
  const monthLabel = `${monthCursor.getFullYear()}年 ${monthCursor.getMonth() + 1}月`;
  const prDates = useMemo(() => computePRDates(log), [log]);

  function shiftMonth(delta) {
    setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1));
  }

  return (
    <div style={{ padding: '16px' }}>
      <div style={styles.monthNav}>
        <button style={styles.iconBtn} onClick={() => shiftMonth(-1)}>
          <ChevronLeft size={20} color="#F2EFE9" />
        </button>
        <span style={styles.monthLabel}>{monthLabel}</span>
        <button style={styles.iconBtn} onClick={() => shiftMonth(1)}>
          <ChevronRight size={20} color="#F2EFE9" />
        </button>
      </div>

      <div style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            style={{
              ...styles.weekCell,
              color: i === 0 ? '#D9736A' : i === 6 ? '#6FA8DC' : '#8E8E93',
            }}
          >
            {w}
          </div>
        ))}
      </div>

      <div style={styles.grid}>
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} style={styles.dayCell} />;
          const dateStr = fmtDate(date);
          const entries = log[dateStr];
          const trained = hasEntries(entries);
          const isPR = prDates.has(dateStr);
          const isToday = dateStr === todayStr;
          return (
            <button
              key={dateStr}
              onClick={() => openDay(date)}
              style={{
                ...styles.dayCell,
                ...styles.dayCellBtn,
                border: isToday ? `1.5px solid ${PLATE.red}` : '1.5px solid transparent',
              }}
            >
              <span style={{ fontSize: 13, color: isToday ? '#F2EFE9' : '#C7C6C9' }}>
                {date.getDate()}
              </span>
              <div style={{ height: 12, marginTop: 2, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {isPR ? (
                  <Star size={11} color={PLATE.yellow} fill={PLATE.yellow} />
                ) : trained ? (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: PLATE.chalk,
                      opacity: 0.6,
                    }}
                  />
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div style={styles.legend}>
        <LegendDot color={PLATE.chalk} label="トレーニングした日" dim />
        <LegendDot color={PLATE.yellow} label="自己ベスト更新" star />
      </div>
    </div>
  );
}

function LegendDot({ color, label, star, dim }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      {star ? (
        <Star size={10} color={color} fill={color} />
      ) : (
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, opacity: dim ? 0.6 : 1 }} />
      )}
      <span style={{ fontSize: 11, color: '#8E8E93', fontFamily: "'Noto Sans JP', sans-serif" }}>{label}</span>
    </div>
  );
}

function SplitSwipeZone({ weight, reps, onWeightChange, onRepsChange }) {
  const dragRef = useRef(null); // { side, startY, startValue, lastSteps }
  const [activeSide, setActiveSide] = useState(null);

  function vibrate() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(8);
      } catch (e) {
        /* 非対応端末は無視 */
      }
    }
  }

  function start(side, clientY) {
    const startValue = side === 'weight' ? parseFloat(weight) || 0 : parseInt(reps, 10) || 0;
    dragRef.current = { side, startY: clientY, startValue, lastSteps: 0 };
    setActiveSide(side);
  }

  function move(clientY) {
    if (!dragRef.current) return;
    const { side, startY, startValue } = dragRef.current;
    const pxPerStep = side === 'weight' ? 22 : 16;
    const stepSize = side === 'weight' ? 5 : 1;
    const deltaY = startY - clientY; // 上方向が正
    const steps = Math.round(deltaY / pxPerStep);
    if (steps !== dragRef.current.lastSteps) {
      dragRef.current.lastSteps = steps;
      const next = Math.max(0, startValue + steps * stepSize);
      if (side === 'weight') onWeightChange(String(next));
      else onRepsChange(String(next));
      vibrate();
    }
  }

  function end() {
    dragRef.current = null;
    setActiveSide(null);
  }

  return (
    <div style={styles.splitSwipeContainer}>
      <div
        style={{ ...styles.splitSwipeHalf, ...(activeSide === 'weight' ? styles.splitSwipeHalfActive : {}) }}
        onTouchStart={(e) => start('weight', e.touches[0].clientY)}
        onTouchMove={(e) => {
          e.preventDefault();
          move(e.touches[0].clientY);
        }}
        onTouchEnd={end}
        onMouseDown={(e) => start('weight', e.clientY)}
        onMouseMove={(e) => {
          if (dragRef.current && dragRef.current.side === 'weight') move(e.clientY);
        }}
        onMouseUp={end}
        onMouseLeave={end}
      >
        <ChevronUp size={16} color="#6B6B6F" />
        <div style={styles.swipeValue}>
          {weight || '0'}
          <span style={styles.swipeUnit}>kg</span>
        </div>
        <ChevronDown size={16} color="#6B6B6F" />
        <div style={styles.swipeHint}>重量</div>
      </div>

      <div style={styles.splitDivider} />

      <div
        style={{ ...styles.splitSwipeHalf, ...(activeSide === 'reps' ? styles.splitSwipeHalfActive : {}) }}
        onTouchStart={(e) => start('reps', e.touches[0].clientY)}
        onTouchMove={(e) => {
          e.preventDefault();
          move(e.touches[0].clientY);
        }}
        onTouchEnd={end}
        onMouseDown={(e) => start('reps', e.clientY)}
        onMouseMove={(e) => {
          if (dragRef.current && dragRef.current.side === 'reps') move(e.clientY);
        }}
        onMouseUp={end}
        onMouseLeave={end}
      >
        <ChevronUp size={16} color="#6B6B6F" />
        <div style={styles.swipeValue}>
          {reps || '0'}
          <span style={styles.swipeUnit}>回</span>
        </div>
        <ChevronDown size={16} color="#6B6B6F" />
        <div style={styles.swipeHint}>回数</div>
      </div>
    </div>
  );
}

function DayView({
  selectedDate, dayEntries, log, catalog, onBack,
  addingExercise, setAddingExercise, newExerciseName, setNewExerciseName,
  addExerciseToDay, removeExercise, addSet, removeSet, setDraft, setSetDraft,
  autoFillLastWeight,
}) {
  return (
    <div style={{ padding: '16px' }}>
      <div style={styles.dayHeader}>
        <button style={styles.iconBtn} onClick={onBack}>
          <ArrowLeft size={20} color="#F2EFE9" />
        </button>
        <span style={styles.dayHeaderLabel}>{selectedDate && fmtDateLabel(selectedDate)}</span>
        <div style={{ width: 36 }} />
      </div>

      {dayEntries.length === 0 && !addingExercise && (
        <div style={styles.emptyState}>この日の記録はまだありません</div>
      )}

      {dayEntries.map((entry) => {
        const lastSetWeight =
          autoFillLastWeight && entry.sets.length
            ? String(entry.sets[entry.sets.length - 1].weight)
            : '';
        const draft = setDraft[entry.id] || { weight: lastSetWeight, reps: '' };
        return (
          <div key={entry.id} style={styles.exerciseCard}>
            <div style={styles.exerciseCardHeader}>
              <span style={styles.exerciseName}>{entry.exercise}</span>
              <button style={styles.trashBtn} onClick={() => removeExercise(entry.id)}>
                <Trash2 size={16} color="#8E8E93" />
              </button>
            </div>

            {entry.sets.length > 0 && (
              <div style={styles.setsTable}>
                {entry.sets.map((s, i) => (
                  <div key={i} style={styles.setRow}>
                    <span style={styles.setIdx}>{i + 1}</span>
                    <span style={styles.setVal}>
                      <span style={styles.setValNum}>{s.weight}</span>kg
                      <span style={styles.setValX}>×</span>
                      <span style={styles.setValNum}>{s.reps}</span>
                    </span>
                    <span style={styles.setE1rm}>1RM {round1(estOneRM(s.weight, s.reps))}kg</span>
                    <button style={styles.trashBtnSm} onClick={() => removeSet(entry.id, i)}>
                      <X size={13} color="#6B6B6F" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.setInputPanel}>
              <SplitSwipeZone
                weight={draft.weight}
                reps={draft.reps}
                onWeightChange={(v) =>
                  setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, weight: v } }))
                }
                onRepsChange={(v) =>
                  setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, reps: v } }))
                }
              />
              <div style={styles.manualInputRow}>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="重量を手入力"
                  value={draft.weight}
                  onChange={(e) =>
                    setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, weight: e.target.value } }))
                  }
                  style={styles.manualInputHalf}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="回数を手入力"
                  value={draft.reps}
                  onChange={(e) =>
                    setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, reps: e.target.value } }))
                  }
                  style={styles.manualInputHalf}
                />
              </div>
              <button
                style={styles.bigConfirmBtn}
                onClick={() => addSet(entry.id, draft.weight, draft.reps)}
              >
                <Check size={20} color="#fff" />
                <span>このセットを記録</span>
              </button>
            </div>
          </div>
        );
      })}

      {addingExercise ? (
        <div style={styles.exerciseCard}>
          <input
            autoFocus
            list="exercise-catalog-list"
            placeholder="種目名（例: ベンチプレス）"
            value={newExerciseName}
            onChange={(e) => setNewExerciseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addExerciseToDay(newExerciseName);
            }}
            style={{ ...styles.numInput, width: '100%' }}
          />
          <datalist id="exercise-catalog-list">
            {catalog.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button style={styles.primaryBtn} onClick={() => addExerciseToDay(newExerciseName)}>
              追加する
            </button>
            <button
              style={styles.secondaryBtn}
              onClick={() => {
                setAddingExercise(false);
                setNewExerciseName('');
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <button style={styles.addExerciseBtn} onClick={() => setAddingExercise(true)}>
          <Plus size={16} color={PLATE.red} />
          <span>種目を追加</span>
        </button>
      )}
    </div>
  );
}

function ProgressView({ log, allExerciseNames, selectedExercise, setSelectedExercise }) {
  const exercise = selectedExercise || allExerciseNames[0] || null;
  const history = exercise ? getExerciseHistory(log, exercise) : [];
  const chartData = history.map((h) => {
    const b = bestSet(h.sets);
    return { date: h.date.slice(5), e1rm: b ? round1(estOneRM(b.weight, b.reps)) : 0 };
  });
  const latestBest = history.length ? bestSet(history[history.length - 1].sets) : null;
  const currentE1rm = latestBest ? round1(estOneRM(latestBest.weight, latestBest.reps)) : 0;

  const allTimeBest = history.reduce((acc, h) => {
    const b = bestSet(h.sets);
    const e = b ? estOneRM(b.weight, b.reps) : 0;
    return e > acc.val ? { val: e, weight: b.weight, reps: b.reps } : acc;
  }, { val: 0, weight: 0, reps: 0 });

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: 14 }}>
        <select
          value={exercise || ''}
          onChange={(e) => setSelectedExercise(e.target.value)}
          style={styles.select}
        >
          {allExerciseNames.length === 0 && <option value="">種目がまだありません</option>}
          {allExerciseNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      {!exercise || history.length === 0 ? (
        <div style={styles.emptyState}>この種目の記録はまだありません</div>
      ) : (
        <>
          <div style={styles.statsCard}>
            <div>
              <div style={styles.statsLabel}>1RM</div>
              <div style={styles.bigNumber}>{currentE1rm}<span style={styles.bigNumberUnit}>kg</span></div>
              <div style={styles.statsSub}>自己ベスト {round1(allTimeBest.val)}kg（{allTimeBest.weight}kg×{allTimeBest.reps}）</div>
            </div>
          </div>

          <div style={styles.chartCard}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3A3A3E" />
                <XAxis dataKey="date" tick={{ fill: '#8E8E93', fontSize: 10 }} axisLine={{ stroke: '#3A3A3E' }} tickLine={false} />
                <YAxis tick={{ fill: '#8E8E93', fontSize: 10 }} axisLine={{ stroke: '#3A3A3E' }} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#242427', border: '1px solid #3A3A3E', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#F2EFE9' }}
                  formatter={(v) => [`${v}kg`, '1RM']}
                />
                <Line type="monotone" dataKey="e1rm" stroke={PLATE.red} strokeWidth={2.5} dot={{ fill: PLATE.red, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

        </>
      )}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      style={{ ...styles.toggleTrack, background: checked ? PLATE.red : '#3A3A3E' }}
    >
      <span style={{ ...styles.toggleKnob, left: checked ? 21 : 3 }} />
    </button>
  );
}

function SettingsView({
  onBack, settings, onToggleSetting,
  user, authLoading, syncing, onLogin, onLogout,
}) {
  const comingSoonSections = [
    {
      icon: <Bell size={18} color="#9A9A9E" />,
      title: '通知',
      desc: 'トレーニングリマインダーなど（準備中）',
    },
  ];

  return (
    <div style={{ padding: '16px' }}>
      <div style={styles.dayHeader}>
        <button style={styles.iconBtn} onClick={onBack}>
          <ArrowLeft size={20} color="#F2EFE9" />
        </button>
        <span style={styles.dayHeaderLabel}>設定</span>
        <div style={{ width: 36 }} />
      </div>

      <div style={styles.settingsGroupLabel}>アカウント</div>
      <div style={styles.settingsRowActive}>
        <div style={styles.settingsRowIcon}>
          {user ? <Cloud size={18} color={PLATE.green} /> : <Database size={18} color="#9A9A9E" />}
        </div>
        <div style={{ flex: 1 }}>
          {authLoading ? (
            <div style={styles.settingsRowTitle}>確認中...</div>
          ) : user ? (
            <>
              <div style={styles.settingsRowTitle}>{user.displayName || user.email}</div>
              <div style={styles.settingsRowDesc}>
                {syncing ? '同期中...' : 'このGoogleアカウントにデータを同期しています'}
              </div>
            </>
          ) : (
            <>
              <div style={styles.settingsRowTitle}>ログインしていません</div>
              <div style={styles.settingsRowDesc}>
                Googleでログインすると、機種変更してもデータを引き継げます
              </div>
            </>
          )}
        </div>
        {!authLoading && (
          user ? (
            <button style={styles.authBtn} onClick={onLogout}>
              <LogOut size={15} color="#9A9A9E" />
            </button>
          ) : (
            <button style={styles.authBtnPrimary} onClick={onLogin}>
              <LogIn size={15} color="#fff" />
            </button>
          )
        )}
      </div>

      <div style={styles.settingsGroupLabel}>入力の挙動</div>
      <div style={styles.settingsRowActive}>
        <div style={styles.settingsRowIcon}>
          <SlidersHorizontal size={18} color="#9A9A9E" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={styles.settingsRowTitle}>前回の重量を自動入力</div>
          <div style={styles.settingsRowDesc}>
            同じ種目の2セット目以降、前回の重量を最初から入力しておきます
          </div>
        </div>
        <Toggle
          checked={settings.autoFillLastWeight}
          onChange={() => onToggleSetting('autoFillLastWeight')}
        />
      </div>

      <div style={styles.settingsGroupLabel}>準備中</div>
      {comingSoonSections.map((s) => (
        <div key={s.title} style={styles.settingsRow}>
          <div style={styles.settingsRowIcon}>{s.icon}</div>
          <div style={{ flex: 1 }}>
            <div style={styles.settingsRowTitle}>{s.title}</div>
            <div style={styles.settingsRowDesc}>{s.desc}</div>
          </div>
          <ChevronRight size={16} color="#4A4A4E" />
        </div>
      ))}

      <div style={styles.settingsFooterNote}>
        設定できる項目は今後追加していきます
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#141416',
    display: 'flex',
    justifyContent: 'center',
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  phoneFrame: {
    width: '100%',
    maxWidth: 420,
    minHeight: '100vh',
    background: '#1B1B1D',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px 16px 12px',
    borderBottom: '1px solid #2A2A2D',
  },
  exportBtn: {
    background: '#242427',
    border: 'none',
    borderRadius: 8,
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 22,
    letterSpacing: 2,
    color: '#F2EFE9',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
  },
  loadingBox: {
    padding: 40,
    textAlign: 'center',
    color: '#8E8E93',
    fontSize: 14,
  },
  monthNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  monthLabel: {
    fontFamily: "'Noto Sans JP', sans-serif",
    fontWeight: 700,
    fontSize: 18,
    letterSpacing: 0.5,
    color: '#F2EFE9',
  },
  iconBtn: {
    background: '#242427',
    border: 'none',
    borderRadius: 8,
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    marginBottom: 4,
  },
  weekCell: {
    textAlign: 'center',
    fontSize: 11,
    padding: '4px 0',
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: 4,
  },
  dayCell: {
    aspectRatio: '1',
    minHeight: 40,
  },
  dayCellBtn: {
    background: '#212124',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: {
    display: 'flex',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
  },
  dayHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dayHeaderLabel: {
    fontFamily: "'Noto Sans JP', sans-serif",
    fontWeight: 700,
    fontSize: 19,
    letterSpacing: 0.3,
    color: '#F2EFE9',
  },
  emptyState: {
    textAlign: 'center',
    color: '#6B6B6F',
    fontSize: 13,
    padding: '30px 0',
  },
  exerciseCard: {
    background: '#212124',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  exerciseCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: 600,
    color: '#F2EFE9',
  },
  trashBtn: {
    background: 'transparent',
    border: 'none',
    padding: 4,
  },
  trashBtnSm: {
    background: 'transparent',
    border: 'none',
    marginLeft: 'auto',
    padding: 2,
  },
  setsTable: {
    marginBottom: 8,
  },
  setRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '5px 0',
    borderBottom: '1px solid #2A2A2D',
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 12.5,
  },
  setIdx: {
    color: '#6B6B6F',
    width: 14,
  },
  setVal: {
    color: '#F2EFE9',
    flex: 1,
  },
  setValNum: {
    display: 'inline-block',
    minWidth: 30,
    textAlign: 'right',
  },
  setValX: {
    display: 'inline-block',
    minWidth: 20,
    textAlign: 'center',
  },
  setE1rm: {
    color: '#8E8E93',
    fontSize: 11,
  },
  setInputPanel: {
    background: '#1B1B1D',
    border: '1px solid #2E2E32',
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  splitSwipeContainer: {
    display: 'flex',
    alignItems: 'stretch',
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 12,
    overflow: 'hidden',
  },
  splitSwipeHalf: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 4px 14px',
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'ns-resize',
  },
  splitSwipeHalfActive: {
    background: 'rgba(200,67,58,0.12)',
  },
  splitDivider: {
    width: 1,
    background: '#333336',
  },
  swipeValue: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 38,
    color: '#F2EFE9',
    lineHeight: 1.1,
    margin: '4px 0',
    whiteSpace: 'nowrap',
  },
  swipeUnit: {
    fontSize: 14,
    color: '#8E8E93',
    marginLeft: 4,
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  swipeHint: {
    fontSize: 11,
    color: '#6B6B6F',
    marginTop: 6,
  },
  manualInputRow: {
    display: 'flex',
    gap: 8,
    marginTop: 10,
  },
  manualInputHalf: {
    flex: 1,
    minWidth: 0,
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 10,
    padding: '12px 8px',
    color: '#F2EFE9',
    fontSize: 16,
    fontFamily: "'Roboto Mono', monospace",
    textAlign: 'center',
  },
  bigConfirmBtn: {
    width: '100%',
    marginTop: 16,
    background: PLATE.red,
    border: 'none',
    borderRadius: 12,
    padding: '16px 0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    color: '#fff',
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  addSetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  numInput: {
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 8,
    padding: '8px 10px',
    color: '#F2EFE9',
    fontSize: 13,
    width: 90,
    fontFamily: "'Roboto Mono', monospace",
  },
  numInputWeight: {
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 8,
    padding: '8px 6px',
    color: '#F2EFE9',
    fontSize: 13,
    width: 58,
    textAlign: 'center',
    fontFamily: "'Roboto Mono', monospace",
  },
  numInputSm: {
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 8,
    padding: '8px 10px',
    color: '#F2EFE9',
    fontSize: 13,
    width: 60,
    fontFamily: "'Roboto Mono', monospace",
  },
  weightSelect: {
    background: '#242427',
    border: '1px solid #333336',
    borderRadius: 8,
    padding: '8px 6px',
    color: '#9A9A9E',
    fontSize: 12,
    fontFamily: "'Noto Sans JP', sans-serif",
    flexShrink: 0,
  },
  xLabel: {
    color: '#6B6B6F',
    fontSize: 13,
  },
  addSetBtn: {
    background: PLATE.red,
    border: 'none',
    borderRadius: 8,
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  addExerciseBtn: {
    width: '100%',
    background: 'transparent',
    border: '1.5px dashed #3A3A3E',
    borderRadius: 12,
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: PLATE.red,
    fontSize: 13.5,
    fontWeight: 600,
  },
  primaryBtn: {
    flex: 1,
    background: PLATE.red,
    border: 'none',
    borderRadius: 8,
    padding: '10px 0',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
  },
  secondaryBtn: {
    flex: 1,
    background: 'transparent',
    border: '1px solid #3A3A3E',
    borderRadius: 8,
    padding: '10px 0',
    color: '#9A9A9E',
    fontSize: 13,
  },
  select: {
    width: '100%',
    background: '#212124',
    border: '1px solid #333336',
    borderRadius: 10,
    padding: '10px 12px',
    color: '#F2EFE9',
    fontSize: 14,
    fontFamily: "'Noto Sans JP', sans-serif",
  },
  statsCard: {
    background: '#212124',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  statsLabel: {
    fontSize: 11,
    color: '#8E8E93',
    marginBottom: 2,
  },
  bigNumber: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 40,
    color: '#F2EFE9',
    letterSpacing: 1,
    lineHeight: 1,
  },
  bigNumberUnit: {
    fontSize: 16,
    color: '#8E8E93',
    marginLeft: 4,
  },
  statsSub: {
    fontSize: 11,
    color: '#6B6B6F',
    marginTop: 6,
  },
  chartCard: {
    background: '#212124',
    borderRadius: 12,
    padding: '12px 4px 4px 4px',
    marginBottom: 14,
  },
  settingsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#212124',
    borderRadius: 12,
    padding: '14px 14px',
    marginBottom: 10,
    opacity: 0.7,
  },
  settingsRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: '#2A2A2D',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  settingsRowTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#F2EFE9',
  },
  settingsRowDesc: {
    fontSize: 11.5,
    color: '#6B6B6F',
    marginTop: 2,
  },
  settingsFooterNote: {
    textAlign: 'center',
    fontSize: 11.5,
    color: '#6B6B6F',
    marginTop: 20,
  },
  settingsRowActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#212124',
    borderRadius: 12,
    padding: '14px 14px',
    marginBottom: 10,
  },
  settingsGroupLabel: {
    fontSize: 11.5,
    color: '#6B6B6F',
    margin: '4px 2px 8px',
  },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    border: 'none',
    position: 'relative',
    flexShrink: 0,
    padding: 0,
  },
  toggleKnob: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#F2EFE9',
    transition: 'left 0.15s',
  },
  authBtn: {
    background: '#2A2A2D',
    border: '1px solid #3A3A3E',
    borderRadius: 8,
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  authBtnPrimary: {
    background: PLATE.red,
    border: 'none',
    borderRadius: 8,
    width: 34,
    height: 34,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bottomNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: '10px 8px calc(10px + env(safe-area-inset-bottom))',
    borderTop: '1px solid #2A2A2D',
    background: '#1B1B1D',
  },
  navBtn: {
    background: 'transparent',
    border: 'none',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: 1,
    padding: '4px 0',
  },
  navAccentCircle: {
    background: PLATE.red,
    borderRadius: '50%',
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    boxShadow: '0 4px 10px rgba(200,67,58,0.4)',
  },
  errorBanner: {
    margin: '0 16px 16px',
    padding: '8px 12px',
    background: 'rgba(200,67,58,0.15)',
    border: '1px solid rgba(200,67,58,0.4)',
    borderRadius: 8,
    color: '#E9A6A1',
    fontSize: 12,
  },
};
