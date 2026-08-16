import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, TrendingUp,
  CalendarDays, Trash2, ArrowLeft, Dumbbell, Check, Download
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

const KEY_LOG = 'training-log';
const KEY_CATALOG = 'exercise-catalog';

// カラーパレット
const PLATE = {
  red: '#C8433A',
  blue: '#3B7DC4',
  yellow: '#E0B23C',
  green: '#4C9A5D',
  chalk: '#D8D6CE',
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function estOneRM(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
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

function volumeTier(total) {
  if (total >= 7000) return 'red';
  if (total >= 4000) return 'blue';
  if (total >= 2000) return 'yellow';
  if (total > 0) return 'green';
  return null;
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

function dayVolume(entries) {
  if (!entries) return 0;
  let total = 0;
  entries.forEach((ex) => {
    (ex.sets || []).forEach((s) => {
      total += (s.weight || 0) * (s.reps || 0);
    });
  });
  return total;
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

function suggestNext(history) {
  if (!history.length) return null;
  const last = history[history.length - 1];
  const best = bestSet(last.sets);
  if (!best || !best.weight || !best.reps) return null;
  if (best.reps >= 10) {
    return {
      weight: round1(best.weight + 2.5),
      reps: Math.max(best.reps - 4, 5),
      note: `前回 ${best.weight}kg×${best.reps}回。そろそろ重量アップの目安です`,
    };
  }
  return {
    weight: best.weight,
    reps: best.reps + 1,
    note: `前回 ${best.weight}kg×${best.reps}回。回数を1つ増やしてみましょう`,
  };
}

function PlateStack({ tier }) {
  const order = ['green', 'yellow', 'blue', 'red'];
  const idx = order.indexOf(tier);
  const count = idx >= 0 ? idx + 1 : 0;
  return (
    <svg width="72" height="40" viewBox="0 0 72 40">
      <line x1="4" y1="20" x2="68" y2="20" stroke="#5A5A5E" strokeWidth="4" strokeLinecap="round" />
      {order.slice(0, count).map((c, i) => (
        <rect
          key={c}
          x={10 + i * 14}
          y={6}
          width="10"
          height="28"
          rx="2"
          fill={PLATE[c]}
        />
      ))}
      {count === 0 && (
        <rect x="10" y="6" width="10" height="28" rx="2" fill={PLATE.chalk} opacity="0.4" />
      )}
    </svg>
  );
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
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(null);
  const [view, setView] = useState('calendar');
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [newExerciseName, setNewExerciseName] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [setDraft, setSetDraft] = useState({});

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
    setLog(logData);
    setCatalog(catData);
    setLoading(false);
  }, []);

  function persistLog(newLog) {
    setLog(newLog);
    try {
      window.localStorage.setItem(KEY_LOG, JSON.stringify(newLog));
      setSaveError(null);
    } catch (e) {
      setSaveError('保存に失敗しました');
    }
  }

  function persistCatalog(newCatalog) {
    setCatalog(newCatalog);
    try {
      window.localStorage.setItem(KEY_CATALOG, JSON.stringify(newCatalog));
    } catch (e) {
      setSaveError('保存に失敗しました');
    }
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
    setSetDraft((d) => ({ ...d, [entryId]: { weight: '', reps: '' } }));
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
          <button style={styles.exportBtn} onClick={() => exportCSV(log)} title="CSV出力">
            <Download size={17} color="#9A9A9E" />
          </button>
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
            />
          ) : (
            <ProgressView
              log={log}
              allExerciseNames={allExerciseNames}
              selectedExercise={selectedExercise}
              setSelectedExercise={setSelectedExercise}
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
          const total = dayVolume(entries);
          const tier = volumeTier(total);
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
              <div style={{ height: 6, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
                {tier && (
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: PLATE[tier],
                    }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div style={styles.legend}>
        <LegendDot color={PLATE.green} label="軽め" />
        <LegendDot color={PLATE.yellow} label="普通" />
        <LegendDot color={PLATE.blue} label="高負荷" />
        <LegendDot color={PLATE.red} label="最大級" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, color: '#8E8E93', fontFamily: "'Noto Sans JP', sans-serif" }}>{label}</span>
    </div>
  );
}

function DayView({
  selectedDate, dayEntries, log, catalog, onBack,
  addingExercise, setAddingExercise, newExerciseName, setNewExerciseName,
  addExerciseToDay, removeExercise, addSet, removeSet, setDraft, setSetDraft,
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
        const history = getExerciseHistory(log, entry.exercise).filter((h) => h.date < selectedDate);
        const suggestion = suggestNext(history);
        const draft = setDraft[entry.id] || { weight: '', reps: '' };
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
                    <span style={styles.setVal}>{s.weight}kg × {s.reps}</span>
                    <span style={styles.setE1rm}>e1RM {round1(estOneRM(s.weight, s.reps))}kg</span>
                    <button style={styles.trashBtnSm} onClick={() => removeSet(entry.id, i)}>
                      <X size={13} color="#6B6B6F" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {suggestion && (
              <button
                style={styles.suggestionBanner}
                onClick={() =>
                  setSetDraft((d) => ({
                    ...d,
                    [entry.id]: { weight: String(suggestion.weight), reps: String(suggestion.reps) },
                  }))
                }
              >
                <span style={styles.suggestionText}>
                  次回目安 <b>{suggestion.weight}kg × {suggestion.reps}</b>
                </span>
                <span style={styles.suggestionNote}>{suggestion.note}</span>
              </button>
            )}

            <div style={styles.addSetRow}>
              <input
                type="number"
                inputMode="decimal"
                placeholder="重量kg"
                value={draft.weight}
                onChange={(e) =>
                  setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, weight: e.target.value } }))
                }
                style={styles.numInput}
              />
              <span style={styles.xLabel}>×</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="回数"
                value={draft.reps}
                onChange={(e) =>
                  setSetDraft((d) => ({ ...d, [entry.id]: { ...draft, reps: e.target.value } }))
                }
                style={styles.numInputSm}
              />
              <button
                style={styles.addSetBtn}
                onClick={() => addSet(entry.id, draft.weight, draft.reps)}
              >
                <Check size={16} color="#fff" />
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
  const tier = volumeTier(currentE1rm * 40);
  const suggestion = suggestNext(history);

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
              <div style={styles.statsLabel}>推定1RM</div>
              <div style={styles.bigNumber}>{currentE1rm}<span style={styles.bigNumberUnit}>kg</span></div>
              <div style={styles.statsSub}>自己ベスト {round1(allTimeBest.val)}kg（{allTimeBest.weight}kg×{allTimeBest.reps}）</div>
            </div>
            <PlateStack tier={tier} />
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
                  formatter={(v) => [`${v}kg`, '推定1RM']}
                />
                <Line type="monotone" dataKey="e1rm" stroke={PLATE.red} strokeWidth={2.5} dot={{ fill: PLATE.red, r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {suggestion && (
            <div style={styles.suggestionCardBig}>
              <div style={styles.statsLabel}>次回の目安</div>
              <div style={{ ...styles.bigNumber, fontSize: 30 }}>
                {suggestion.weight}kg × {suggestion.reps}
              </div>
              <div style={styles.statsSub}>{suggestion.note}</div>
            </div>
          )}
        </>
      )}
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
  setE1rm: {
    color: '#8E8E93',
    fontSize: 11,
  },
  suggestionBanner: {
    width: '100%',
    background: 'rgba(200,67,58,0.12)',
    border: `1px solid rgba(200,67,58,0.35)`,
    borderRadius: 8,
    padding: '8px 10px',
    marginBottom: 10,
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  suggestionText: {
    fontSize: 12.5,
    color: '#F2EFE9',
  },
  suggestionNote: {
    fontSize: 10.5,
    color: '#B98F8B',
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
  numInputSm: {
    background: '#141416',
    border: '1px solid #333336',
    borderRadius: 8,
    padding: '8px 10px',
    color: '#F2EFE9',
    fontSize: 13,
    width: 70,
    fontFamily: "'Roboto Mono', monospace",
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
  suggestionCardBig: {
    background: 'rgba(200,67,58,0.10)',
    border: '1px solid rgba(200,67,58,0.3)',
    borderRadius: 12,
    padding: 16,
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
