import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://rgolcprnbzrqleurebah.supabase.co";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnb2xjcHJuYnpycWxldXJlYmFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjcwNDUsImV4cCI6MjA5ODk0MzA0NX0.PQfamuJYqcm1LWFSv_yhib8anMe4QUWzETwNJ35FBaA";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ADULT_CONTRIBUTION = 50;
const CHILD_CONTRIBUTION = 25;
const POT_PCT = 0.7;
const EF_PCT = 0.3;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Math.round((n + Number.EPSILON) * 100) / 100
  );
}

function monthLabel(m) {
  if (!m) return "";
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const emptyData = {
  members: [],
  contributions: [],
  payouts: [],
  efWithdrawals: [],
  efRepayments: [],
  nextOverrideId: null,
  removedLog: []
};

export default function SusuTracker() {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("overview");
  const [memberName, setMemberName] = useState("");
  const [cMember, setCMember] = useState("");
  const [cMonth, setCMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [cAmount, setCAmount] = useState("");
  const [pMember, setPMember] = useState("");
  const [pMonth, setPMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pAmount, setPAmount] = useState("");
  const [eReason, setEReason] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eMember, setEMember] = useState("");
  const [notice, setNotice] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [recorderName, setRecorderName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(true);
  const nameInputRef = React.useRef(null);
  const lastKnownUpdatedAt = React.useRef(null);

  useEffect(() => {
    loadShared();
    const interval = setInterval(loadShared, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadShared() {
    try {
      const { data: result, error } = await supabase
        .from('app_state')
        .select('value')
        .eq('key', 'susu_data')
        .single();
      
      if (error) throw error;
      if (result && result.value) {
        const parsed = result.value;
        const remoteUpdatedAt = parsed.updatedAt || null;
        const isNewer = !lastKnownUpdatedAt.current || !remoteUpdatedAt || remoteUpdatedAt > lastKnownUpdatedAt.current;
        if (isNewer) {
          setData({ ...emptyData, ...parsed });
          lastKnownUpdatedAt.current = remoteUpdatedAt;
        }
      }
      setSyncedAt(new Date());
    } catch (e) {
      console.log('Loading error:', e);
    } finally {
      setLoaded(true);
    }
  }

  async function persist(nextRaw) {
    const next = { ...nextRaw, updatedAt: new Date().toISOString() };
    lastKnownUpdatedAt.current = next.updatedAt;
    setData(next);
    try {
      const { error } = await supabase
        .from('app_state')
        .upsert({ key: 'susu_data', value: next }, { onConflict: 'key' });
      if (error) throw error;
    } catch (e) {
      setNotice({ type: "error", text: "Could not save. Your last change may not persist." });
    }
    setSyncedAt(new Date());
  }

  const memberById = useMemo(() => {
    const map = {};
    data.members.forEach((m) => (map[m.id] = m));
    return map;
  }, [data.members]);

  const totals = useMemo(() => {
    const totalCollected = data.contributions.reduce((s, c) => s + c.amount, 0);
    const potIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? 0 : c.potShare || 0), 0);
    const potOut = data.payouts.reduce((s, p) => s + p.amount, 0);
    const efIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? c.amount : c.efShare || 0), 0);
    const efOut = data.efWithdrawals.reduce((s, w) => s + w.amount, 0);
    const efRepaid = data.efRepayments ? data.efRepayments.reduce((s, r) => s + r.amount, 0) : 0;
    return {
      totalCollected,
      potBalance: potIn - potOut,
      efBalance: efIn - efOut + efRepaid,
    };
  }, [data]);

  const perMember = useMemo(() => {
    return data.members.map((m) => {
      const contributed = data.contributions
        .filter((c) => c.memberId === m.id)
        .reduce((s, c) => s + c.amount, 0);
      const received = data.payouts
        .filter((p) => p.memberId === m.id)
        .reduce((s, p) => s + p.amount, 0);
      const lastPayout = data.payouts
        .filter((p) => p.memberId === m.id)
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const efReceived = data.efWithdrawals
        .filter((w) => w.memberId === m.id)
        .reduce((s, w) => s + w.amount, 0);
      const efRepaid = data.efRepayments ? data.efRepayments
        .filter((r) => r.memberId === m.id)
        .reduce((s, r) => s + r.amount, 0) : 0;
      return { ...m, contributed, received, lastPayoutDate: lastPayout ? lastPayout.date : null, efReceived, efRepaid, efBalance: efReceived - efRepaid };
    });
  }, [data.members, data.contributions, data.payouts, data.efWithdrawals, data.efRepayments]);

  const autoNextRecipient = useMemo(() => {
    if (perMember.length === 0) return null;
    const sorted = [...perMember].sort((a, b) => {
      if (!a.lastPayoutDate && !b.lastPayoutDate) return a.order - b.order;
      if (!a.lastPayoutDate) return -1;
      if (!b.lastPayoutDate) return 1;
      return a.lastPayoutDate < b.lastPayoutDate ? -1 : 1;
    });
    return sorted[0];
  }, [perMember]);

  const isManualNext = !!(data.nextOverrideId && perMember.some((m) => m.id === data.nextOverrideId));
  const nextRecipient = isManualNext
    ? perMember.find((m) => m.id === data.nextOverrideId)
    : autoNextRecipient;

  function setNextOverride(id) {
    persist({ ...data, nextOverrideId: id || null });
  }

  function addMember() {
    const name = memberName.trim();
    if (!name) return;
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    const next = {
      ...data,
      members: [...data.members, { id: uid(), name, type: 'adult', order: data.members.length, recordedBy: recorderName }],
    };
    persist(next);
    setMemberName("");
  }

  function removeMember(id) {
    const next = { ...data, members: data.members.filter((m) => m.id !== id) };
    persist(next);
  }

  function getMemberType(memberId) {
    const member = data.members.find(m => m.id === memberId);
    return member ? member.type : 'adult';
  }

  function getContributionAmount(memberId) {
    const member = data.members.find(m => m.id === memberId);
    if (!member) return 0;
    return member.type === 'child' ? CHILD_CONTRIBUTION : ADULT_CONTRIBUTION;
  }

  function addContribution() {
    const member = data.members.find(m => m.id === cMember);
    if (!member) return;
    const amount = getContributionAmount(cMember);
    if (!cMember || amount <= 0) return;
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    const isChild = member.type === 'child';
    const potShare = isChild ? 0 : Math.round(amount * POT_PCT * 100) / 100;
    const efShare = isChild ? amount : Math.round((amount - potShare) * 100) / 100;
    const entry = {
      id: uid(),
      memberId: cMember,
      memberType: member.type,
      month: cMonth,
      amount,
      potShare,
      efShare,
      date: new Date().toISOString(),
      recordedBy: recorderName,
    };
    persist({ ...data, contributions: [...data.contributions, entry] });
    setCAmount("");
    setNotice(null);
  }

  function addPayout() {
    const amount = parseFloat(pAmount);
    if (!pMember || !amount || amount <= 0) return;
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    if (amount > totals.potBalance) {
      setNotice({
        type: "warning",
        text: `Heads up: this payout of ${fmt(amount)} is more than the pot balance of ${fmt(totals.potBalance)}. Recorded anyway.`,
      });
    } else {
      setNotice(null);
    }
    const entry = { id: uid(), memberId: pMember, month: pMonth, amount, date: new Date().toISOString(), recordedBy: recorderName };
    persist({ ...data, payouts: [...data.payouts, entry] });
    setPAmount("");
  }

  function addWithdrawal() {
    const amount = parseFloat(eAmount);
    if (!amount || amount <= 0) return;
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    if (amount > totals.efBalance) {
      setNotice({
        type: "warning",
        text: `Heads up: this withdrawal of ${fmt(amount)} is more than the emergency fund balance of ${fmt(totals.efBalance)}. Recorded anyway.`,
      });
    } else {
      setNotice(null);
    }
    const entry = {
      id: uid(),
      memberId: eMember || null,
      reason: eReason.trim() || "Emergency fund withdrawal",
      amount,
      date: new Date().toISOString(),
      recordedBy: recorderName,
      repaid: 0,
      remaining: amount
    };
    persist({ ...data, efWithdrawals: [...data.efWithdrawals, entry] });
    setEAmount("");
    setEReason("");
    setEMember("");
  }

  function addRepayment(loanId, memberId, amount) {
    if (!amount || amount <= 0) return;
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    const loan = data.efWithdrawals.find(w => w.id === loanId);
    if (!loan) return;
    const newRepaid = (loan.repaid || 0) + amount;
    const newRemaining = loan.amount - newRepaid;
    const updatedLoans = data.efWithdrawals.map(w => {
      if (w.id === loanId) {
        return { ...w, repaid: newRepaid, remaining: newRemaining };
      }
      return w;
    });
    const repaymentEntry = {
      id: uid(),
      loanId,
      memberId,
      amount,
      date: new Date().toISOString(),
      recordedBy: recorderName
    };
    const repayments = [...(data.efRepayments || []), repaymentEntry];
    persist({ ...data, efWithdrawals: updatedLoans, efRepayments: repayments });
  }

  if (!loaded) {
    return (
      <div style={styles.loadingWrap}>
        <style>{globalCss}</style>
        <p style={{ fontFamily: "var(--body)", color: "#EDE6D3" }}>Loading your susu circle...</p>
      </div>
    );
  }

  const wheelSize = 280;
  const center = wheelSize / 2;
  const radius = 96;
  const n = perMember.length;

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <header style={styles.hero}>
        <div style={styles.heroTop}>
          <div>
            <p style={styles.eyebrow}>Ledger</p>
            <h1 style={styles.h1}>Brundige Family Trust</h1>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={styles.splitBadge}>
              <span>70% pot</span>
              <span style={styles.splitDot}>&middot;</span>
              <span>30% emergency fund</span>
            </div>
            <button onClick={loadShared} style={styles.syncBadge} type="button">
              <span style={styles.syncDot} />
              Shared with group{syncedAt ? ` · synced ${syncedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </button>
            {editingName ? (
              <div style={styles.nameForm}>
                <input
                  ref={nameInputRef}
                  autoFocus
                  style={styles.nameInput}
                  placeholder="Your name"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setRecorderName(nameDraft); setEditingName(false); setNotice(null); } }}
                />
                <button style={styles.nameSaveBtn} type="button" onClick={() => { setRecorderName(nameDraft); setEditingName(false); setNotice(null); }}>Set</button>
              </div>
            ) : (
              <button onClick={() => setEditingName(true)} style={styles.recorderBadge} type="button">
                Recording as <strong>{recorderName}</strong> · change
              </button>
            )}
          </div>
        </div>
        <div style={styles.heroGrid}>
          <div style={styles.wheelCol}>
            <svg width={wheelSize} height={wheelSize} viewBox={`0 0 ${wheelSize} ${wheelSize}`} role="img" aria-label="Payout rotation wheel">
              <circle cx={center} cy={center} r={radius + 34} fill="none" stroke="#2F6B44" strokeWidth="1" />
              {n === 0 && (
                <text x={center} y={center} textAnchor="middle" fill="#A9C9AE" fontSize="12" fontFamily="var(--body)">Add members to</text>
              )}
              {n === 0 && (
                <text x={center} y={center + 16} textAnchor="middle" fill="#A9C9AE" fontSize="12" fontFamily="var(--body)">start the circle</text>
              )}
              {perMember.map((m, i) => {
                const angle = (2 * Math.PI * i) / n - Math.PI / 2;
                const x = center + radius * Math.cos(angle);
                const y = center + radius * Math.sin(angle);
                const isNext = nextRecipient && nextRecipient.id === m.id;
                return (
                  <g key={m.id}>
                    <line x1={center} y1={center} x2={x} y2={y} stroke={isNext ? "#C9962B" : "#2F6B44"} strokeWidth={isNext ? 1.5 : 1} />
                    <circle cx={x} cy={y} r={isNext ? 22 : 18} fill={isNext ? "#C9962B" : "#1F5D3B"} stroke={isNext ? "#F3D48A" : "#4C8C5D"} strokeWidth="1.5" />
                    <text x={x} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fontFamily="var(--body)" fill={isNext ? "#3A2A05" : "#E7F1E9"}>
                      {m.name.slice(0, 2).toUpperCase()}
                    </text>
                  </g>
                );
              })}
              <circle cx={center} cy={center} r={40} fill="#123B22" stroke="#C9962B" strokeWidth="1" />
              <text x={center} y={center - 6} textAnchor="middle" fontSize="9" fontFamily="var(--body)" fill="#A9C9AE">pot</text>
              <text x={center} y={center + 10} textAnchor="middle" fontSize="12" fontWeight="700" fontFamily="var(--mono)" fill="#F3D48A">
                {fmt(totals.potBalance).replace(/\.00$/, "")}
              </text>
            </svg>
            <p style={styles.wheelCaption}>
              {nextRecipient ? (
                <>Next in line for payout: <strong style={{ color: "#F3D48A" }}>{nextRecipient.name}</strong>{isManualNext && <span style={styles.manualTag}>manually set</span>}</>
              ) : (
                "Add members to see who's next"
              )}
            </p>
            {data.members.length > 0 && (
              <div style={styles.overrideRow}>
                <select
                  style={styles.overrideSelect}
                  value={isManualNext ? data.nextOverrideId : ""}
                  onChange={(e) => setNextOverride(e.target.value)}
                >
                  <option value="">Auto ({autoNextRecipient ? autoNextRecipient.name : "—"})</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>Set next: {m.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={styles.statCol}>
            <div style={styles.statCard}>
              <p style={styles.statLabel}>Total collected</p>
              <p style={styles.statValue}>{fmt(totals.totalCollected)}</p>
            </div>
            <div style={styles.statCard}>
              <p style={styles.statLabel}>Pot balance (payouts)</p>
              <p style={styles.statValue}>{fmt(totals.potBalance)}</p>
            </div>
            <div style={styles.statCardAccent}>
              <p style={styles.statLabelAccent}>Emergency fund balance</p>
              <p style={styles.statValueAccent}>{fmt(totals.efBalance)}</p>
            </div>
          </div>
        </div>
      </header>
      {notice && (
        <div style={notice.type === "warning" ? styles.noticeWarning : styles.noticeError}>
          {notice.text}
        </div>
      )}
      <nav style={styles.tabs}>
        {[
          ["overview", "Members"],
          ["contributions", "Contributions"],
          ["payouts", "Payouts"],
          ["fund", "Emergency fund"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={tab === key ? styles.tabActive : styles.tab}
          >
            {label}
          </button>
        ))}
      </nav>
      <main style={styles.main}>
        {tab === "overview" && (
          <section>
            <div style={styles.formRow}>
              <input
                style={styles.input}
                placeholder="Member name"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addMember(); }}
              />
              <select style={styles.input} value="adult" onChange={() => {}}>
                <option value="adult">Adult ($50)</option>
                <option value="child">Child ($25)</option>
              </select>
              <button style={styles.btnPrimary} type="button" onClick={addMember}>Add member</button>
            </div>
            {perMember.length === 0 ? (
              <p style={styles.empty}>No members yet. Add the first person in your susu circle above.</p>
            ) : (
              <table style={styles.table} className="rtable">
                <thead>
                  <tr>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Contributed</th>
                    <th style={styles.th}>Received</th>
                    <th style={styles.th}>EF Balance</th>
                    <th style={styles.th}>Recorded By</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {perMember.map((m) => (
                    <tr key={m.id}>
                      <td style={styles.td} data-label="Member">
                        {m.name}
                        {nextRecipient && nextRecipient.id === m.id && (
                          <span style={styles.nextTag}>next</span>
                        )}
                      </td>
                      <td style={styles.td} data-label="Type">{m.type === 'child' ? 'Child ($25)' : 'Adult ($50)'}</td>
                      <td style={styles.td} data-label="Contributed">{fmt(m.contributed)}</td>
                      <td style={styles.td} data-label="Received">{fmt(m.received)}</td>
                      <td style={styles.td} data-label="EF Balance">{fmt(m.efBalance)}</td>
                      <td style={styles.td} data-label="Recorded By">{m.recordedBy ? `Recorded By ${m.recordedBy}` : "—"}</td>
                      <td style={styles.td}>
                        <button style={styles.btnGhostSmall} onClick={() => removeMember(m.id)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {tab === "contributions" && (
          <section>
            <div style={styles.formGrid}>
              <select style={styles.input} value={cMember} onChange={(e) => setCMember(e.target.value)}>
                <option value="">Select member</option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.type === 'child' ? '$25' : '$50'})</option>
                ))}
              </select>
              <input style={styles.input} type="month" value={cMonth} onChange={(e) => setCMonth(e.target.value)} />
              {cMember && (
                <input style={styles.input} type="number" value={getContributionAmount(cMember)} readOnly disabled placeholder="Amount" />
              )}
              <button style={styles.btnPrimary} type="button" onClick={addContribution}>Record contribution</button>
            </div>
            {cMember && data.members.find(m => m.id === cMember) && (
              <p style={styles.splitPreview}>
                {data.members.find(m => m.id === cMember).type === 'child' 
                  ? `Child contribution: $${getContributionAmount(cMember)} goes 100% to Emergency Fund`
                  : `Adult contribution: $${getContributionAmount(cMember)} splits into ${fmt(ADULT_CONTRIBUTION * POT_PCT)} to the pot and ${fmt(ADULT_CONTRIBUTION * EF_PCT)} to the emergency fund.`
                }
              </p>
            )}
            {data.contributions.length === 0 ? (
              <p style={styles.empty}>No contributions recorded yet.</p>
            ) : (
              <table style={styles.table} className="rtable">
                <thead>
                  <tr>
                    <th style={styles.th}>Month</th>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>To pot</th>
                    <th style={styles.th}>To fund</th>
                    <th style={styles.th}>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.contributions]
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .map((c) => (
                      <tr key={c.id}>
                        <td style={styles.td} data-label="Month">{monthLabel(c.month)}</td>
                        <td style={styles.td} data-label="Member">{memberById[c.memberId]?.name || "Removed member"}</td>
                        <td style={styles.td} data-label="Type">{c.memberType === 'child' ? 'Child' : 'Adult'}</td>
                        <td style={styles.td} data-label="Amount">{fmt(c.amount)}</td>
                        <td style={styles.td} data-label="To pot">{fmt(c.potShare)}</td>
                        <td style={styles.td} data-label="To fund">{fmt(c.efShare)}</td>
                        <td style={styles.td} data-label="Recorded By">{c.recordedBy ? `Recorded By ${c.recordedBy}` : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {tab === "payouts" && (
          <section>
            <div style={styles.formGrid}>
              <select style={styles.input} value={pMember} onChange={(e) => setPMember(e.target.value)}>
                <option value="">Select member</option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input style={styles.input} type="month" value={pMonth} onChange={(e) => setPMonth(e.target.value)} />
              <input style={styles.input} type="number" min="0.01" step="0.01" placeholder="Amount" value={pAmount} onChange={(e) => setPAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addPayout(); }} />
              <button style={styles.btnPrimary} type="button" onClick={addPayout}>Record payout</button>
            </div>
            <p style={styles.hint}>Pot balance available: {fmt(totals.potBalance)}</p>
            {data.payouts.length === 0 ? (
              <p style={styles.empty}>No payouts recorded yet.</p>
            ) : (
              <table style={styles.table} className="rtable">
                <thead>
                  <tr>
                    <th style={styles.th}>Month</th>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.payouts]
                    .sort((a, b) => (a.date < b.date ? 1 : -1))
                    .map((p) => (
                      <tr key={p.id}>
                        <td style={styles.td} data-label="Month">{monthLabel(p.month)}</td>
                        <td style={styles.td} data-label="Member">{memberById[p.memberId]?.name || "Removed member"}</td>
                        <td style={styles.td} data-label="Amount">{fmt(p.amount)}</td>
                        <td style={styles.td} data-label="Recorded By">{p.recordedBy ? `Recorded By ${p.recordedBy}` : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        {tab === "fund" && (
          <section>
            <div style={styles.fundBalanceCard}>
              <p style={styles.statLabelAccent}>Emergency fund balance</p>
              <p style={styles.statValueAccent}>{fmt(totals.efBalance)}</p>
            </div>
            <h4 style={{ margin: "16px 0 8px" }}>Record Withdrawal</h4>
            <div style={styles.formGrid}>
              <select style={styles.input} value={eMember} onChange={(e) => setEMember(e.target.value)}>
                <option value="">Select member</option>
                {data.members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input style={styles.input} placeholder="Reason (e.g. medical, funeral)" value={eReason} onChange={(e) => setEReason(e.target.value)} />
              <input style={styles.input} type="number" min="0.01" step="0.01" placeholder="Amount" value={eAmount} onChange={(e) => setEAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addWithdrawal(); }} />
              <button style={styles.btnPrimary} type="button" onClick={addWithdrawal}>Record withdrawal</button>
            </div>
            {data.efWithdrawals.length === 0 ? (
              <p style={styles.empty}>No withdrawals recorded yet.</p>
            ) : (
              <div>
                <h4 style={{ margin: "16px 0 8px" }}>Withdrawals & Repayments</h4>
                <table style={styles.table} className="rtable">
                  <thead>
                    <tr>
                      <th style={styles.th}>Date</th>
                      <th style={styles.th}>Member</th>
                      <th style={styles.th}>Reason</th>
                      <th style={styles.th}>Amount</th>
                      <th style={styles.th}>Repaid</th>
                      <th style={styles.th}>Remaining</th>
                      <th style={styles.th}>Recorded By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.efWithdrawals]
                      .sort((a, b) => (a.date < b.date ? 1 : -1))
                      .map((w) => (
                        <tr key={w.id}>
                          <td style={styles.td} data-label="Date">{new Date(w.date).toLocaleDateString()}</td>
                          <td style={styles.td} data-label="Member">{w.memberId ? (memberById[w.memberId]?.name || "Removed member") : "General fund"}</td>
                          <td style={styles.td} data-label="Reason">{w.reason}</td>
                          <td style={styles.td} data-label="Amount">{fmt(w.amount)}</td>
                          <td style={styles.td} data-label="Repaid">{fmt(w.repaid || 0)}</td>
                          <td style={styles.td} data-label="Remaining">{fmt(w.remaining || w.amount)}</td>
                          <td style={styles.td} data-label="Recorded By">{w.recordedBy ? `Recorded By ${w.recordedBy}` : "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

const globalCss = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
:root {
  --display: 'Fraunces', serif;
  --body: 'Inter', sans-serif;
  --mono: 'JetBrains Mono', monospace;
}
table { border-collapse: collapse; width: 100%; }
@media (max-width: 640px) {
  .rtable thead { position: absolute; left: -9999px; }
  .rtable, .rtable tbody, .rtable tr, .rtable td { display: block; width: 100%; }
  .rtable tr { border: 1px solid #E4DBC4; border-radius: 8px; margin-bottom: 10px; padding: 4px 12px; background: #FFFDF7; }
  .rtable td { border: none !important; padding: 7px 0 !important; display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: right; }
  .rtable td::before { content: attr(data-label); font-weight: 600; color: #7A7460; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; text-align: left; flex-shrink: 0; }
  .rtable td:empty::before { content: none; }
  .rtable td:last-child { justify-content: flex-end; }
}
`;

const styles = {
  loadingWrap: { background:
