/* eslint-disable */
import React, { useState, useEffect, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';

// ============================================
// SUPABASE CONFIG
// ============================================
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://rgolcprnbzrqleurebah.supabase.co";
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJnb2xjcHJuYnpycWxldXJlYmFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNjcwNDUsImV4cCI6MjA5ODk0MzA0NX0.PQfamuJYqcm1LWFSv_yhib8anMe4QUWzETwNJ35FBaA";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================
// CONSTANTS
// ============================================
const ADULT_CONTRIBUTION = 50;
const CHILD_CONTRIBUTION = 25;
const POT_PCT = 0.7;
const EF_PCT = 0.3;

// ============================================
// UTILITY FUNCTIONS
// ============================================
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

function getContributionAmount(memberType) {
  return memberType === 'child' ? CHILD_CONTRIBUTION : ADULT_CONTRIBUTION;
}

const emptyData = {
  members: [],
  contributions: [],
  payouts: [],
  efWithdrawals: [],
  efRepayments: [],
  transfers: [],
  nextOverrideId: null,
  removedLog: [],
  settings: {
    requirePassword: false,
    password: ''
  },
  updatedAt: null
};

// ============================================
// MAIN COMPONENT
// ============================================
export default function SusuTracker() {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("overview");
  const [notice, setNotice] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [recorderName, setRecorderName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [editingName, setEditingName] = useState(true);
  const nameInputRef = React.useRef(null);
  const lastKnownUpdatedAt = React.useRef(null);

  // ----- Password state -----
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  // ----- View-only mode -----
  const isViewOnly = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'view';
  }, []);

  // ----- Form states -----
  const [memberName, setMemberName] = useState("");
  const [memberType, setMemberType] = useState("adult");
  const [cMember, setCMember] = useState("");
  const [cMonth, setCMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pMember, setPMember] = useState("");
  const [pMonth, setPMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [pAmount, setPAmount] = useState("");
  const [eReason, setEReason] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eMember, setEMember] = useState("");

  // ----- Transfer state -----
  const [transferDirection, setTransferDirection] = useState("ef-to-pot");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [showTransferModal, setShowTransferModal] = useState(false);

  // ----- Transaction filters -----
  const [txType, setTxType] = useState("all");
  const [txSearch, setTxSearch] = useState("");
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");

  // ----- Repayment state -----
  const [repayLoanId, setRepayLoanId] = useState(null);
  const [repayAmount, setRepayAmount] = useState("");

  // ----- Password settings state -----
  const [newPassword, setNewPassword] = useState("");
  const [passwordToggle, setPasswordToggle] = useState(false);

  // ============================================
  // SUPABASE SYNC
  // ============================================
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
        // Ensure settings exist
        if (!parsed.settings) {
          parsed.settings = { requirePassword: false, password: '' };
        }
        if (!parsed.transfers) {
          parsed.transfers = [];
        }
        const remoteUpdatedAt = parsed.updatedAt || null;
        const isNewer = !lastKnownUpdatedAt.current || !remoteUpdatedAt || remoteUpdatedAt > lastKnownUpdatedAt.current;
        if (isNewer) {
          setData({ ...emptyData, ...parsed });
          lastKnownUpdatedAt.current = remoteUpdatedAt;
          // Update password toggle state
          setPasswordToggle(parsed.settings?.requirePassword || false);
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

  // ============================================
  // PASSWORD CHECK
  // ============================================
  function requiresPasswordCheck() {
    return data.settings?.requirePassword === true;
  }

  function checkPassword(input) {
    return input === (data.settings?.password || '');
  }

  function wrapWithPasswordCheck(action, actionName) {
    if (isViewOnly) {
      setNotice({ type: "error", text: "View-only mode — you cannot make changes." });
      return;
    }
    if (!recorderName) {
      setEditingName(true);
      setNotice({ type: "warning", text: "Enter your name at the top first." });
      return;
    }
    if (requiresPasswordCheck()) {
      setPendingAction({ action, actionName });
      setPasswordInput("");
      setShowPasswordModal(true);
    } else {
      action();
    }
  }

  function executePendingAction() {
    if (!checkPassword(passwordInput)) {
      setNotice({ type: "error", text: "Incorrect password. Action canceled." });
      setShowPasswordModal(false);
      setPendingAction(null);
      setPasswordInput("");
      return;
    }
    setShowPasswordModal(false);
    if (pendingAction) {
      pendingAction.action();
      setPendingAction(null);
    }
    setPasswordInput("");
  }

  function cancelPasswordModal() {
    setShowPasswordModal(false);
    setPendingAction(null);
    setPasswordInput("");
  }

  // ============================================
  // HELPERS
  // ============================================
  const memberById = useMemo(() => {
    const map = {};
    data.members.forEach((m) => (map[m.id] = m));
    return map;
  }, [data.members]);

  const totals = useMemo(() => {
    const totalCollected = data.contributions.reduce((s, c) => s + c.amount, 0);
    const potIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? 0 : (c.potShare || 0)), 0);
    const potOut = data.payouts.reduce((s, p) => s + p.amount, 0);
    const efIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? c.amount : (c.efShare || 0)), 0);
    const efOut = data.efWithdrawals.reduce((s, w) => s + w.amount, 0);
    const efRepaid = data.efRepayments ? data.efRepayments.reduce((s, r) => s + r.amount, 0) : 0;
    
    // Calculate transfers
    const transfers = data.transfers || [];
    let efToPotTotal = 0;
    let potToEfTotal = 0;
    transfers.forEach(t => {
      if (t.direction === 'ef-to-pot') efToPotTotal += t.amount;
      if (t.direction === 'pot-to-ef') potToEfTotal += t.amount;
    });

    const potBalance = potIn - potOut + efToPotTotal - potToEfTotal;
    const efBalance = efIn - efOut + efRepaid - efToPotTotal + potToEfTotal;

    return {
      totalCollected,
      potBalance,
      efBalance,
      efIn,
      efOut,
      efRepaid,
      transfers,
      efToPotTotal,
      potToEfTotal
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
      const efRepaid = data.efRepayments
        .filter((r) => r.memberId === m.id)
        .reduce((s, r) => s + r.amount, 0);
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

  const loansOutstanding = useMemo(() => {
    return data.efWithdrawals
      .filter(w => {
        const repaid = data.efRepayments.filter(r => r.loanId === w.id).reduce((s, r) => s + r.amount, 0);
        return (w.amount - repaid) > 0.01;
      })
      .map(w => {
        const repaid = data.efRepayments.filter(r => r.loanId === w.id).reduce((s, r) => s + r.amount, 0);
        const remaining = w.amount - repaid;
        return { ...w, repaid, remaining };
      })
      .sort((a, b) => a.remaining - b.remaining);
  }, [data.efWithdrawals, data.efRepayments]);

  // ============================================
  // ALL TRANSACTIONS
  // ============================================
  const allTransactions = useMemo(() => {
    const rows = [];

    // Contributions
    data.contributions.forEach((c) => {
      rows.push({
        id: `c-${c.id}`,
        type: 'contribution',
        typeLabel: 'Contribution',
        date: c.date,
        memberName: memberById[c.memberId]?.name || 'Removed member',
        amount: c.amount,
        recordedBy: c.recordedBy || '—',
        detail: `${c.memberType === 'child' ? 'Child' : 'Adult'} · ${fmt(c.potShare || 0)} to pot, ${fmt(c.efShare || 0)} to fund · ${monthLabel(c.month)}`,
        originalId: c.id,
        canRemove: true
      });
    });

    // Payouts
    data.payouts.forEach((p) => {
      rows.push({
        id: `p-${p.id}`,
        type: 'payout',
        typeLabel: 'Payout',
        date: p.date,
        memberName: memberById[p.memberId]?.name || 'Removed member',
        amount: p.amount,
        recordedBy: p.recordedBy || '—',
        detail: `Payout · ${monthLabel(p.month)}`,
        originalId: p.id,
        canRemove: true
      });
    });

    // EF Withdrawals
    data.efWithdrawals.forEach((w) => {
      const repaid = data.efRepayments.filter(r => r.loanId === w.id).reduce((s, r) => s + r.amount, 0);
      rows.push({
        id: `w-${w.id}`,
        type: 'withdrawal',
        typeLabel: 'Emergency Withdrawal',
        date: w.date,
        memberName: w.memberId ? (memberById[w.memberId]?.name || 'Removed member') : 'General fund',
        amount: w.amount,
        recordedBy: w.recordedBy || '—',
        detail: `${w.reason || 'No reason'} · Repaid: ${fmt(repaid)} · Remaining: ${fmt(w.amount - repaid)}`,
        originalId: w.id,
        canRemove: true
      });
    });

    // EF Repayments
    (data.efRepayments || []).forEach((r) => {
      rows.push({
        id: `r-${r.id}`,
        type: 'repayment',
        typeLabel: 'EF Repayment',
        date: r.date,
        memberName: memberById[r.memberId]?.name || 'Removed member',
        amount: r.amount,
        recordedBy: r.recordedBy || '—',
        detail: `Repayment toward loan`,
        originalId: r.id,
        canRemove: true
      });
    });

    // Transfers
    (data.transfers || []).forEach((t) => {
      rows.push({
        id: `t-${t.id}`,
        type: 'transfer',
        typeLabel: 'Transfer',
        date: t.date,
        memberName: '—',
        amount: t.amount,
        recordedBy: t.recordedBy || '—',
        detail: `${t.direction === 'ef-to-pot' ? 'EF → Pot' : 'Pot → EF'} · ${t.reason || 'No reason given'}`,
        originalId: t.id,
        canRemove: true
      });
    });

    // Removed entries (audit log)
    (data.removedLog || []).forEach((r) => {
      const e = r.removedEntry || {};
      rows.push({
        id: `rm-${r.id}`,
        type: 'removed',
        typeLabel: `Removed ${r.kind || 'entry'}`,
        date: r.removedAt || new Date().toISOString(),
        memberName: e.memberId ? (memberById[e.memberId]?.name || 'Removed member') : (e.memberName || '—'),
        amount: e.amount || 0,
        recordedBy: r.removedBy || '—',
        detail: `Originally recorded ${e.date ? new Date(e.date).toLocaleString() : '—'} by ${e.recordedBy || '—'}`,
        canRemove: false
      });
    });

    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [data, memberById]);

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((t) => {
      if (txType !== 'all' && t.type !== txType) return false;
      if (txSearch.trim() && !t.memberName.toLowerCase().includes(txSearch.trim().toLowerCase())) return false;
      if (txFrom && t.date.slice(0, 10) < txFrom) return false;
      if (txTo && t.date.slice(0, 10) > txTo) return false;
      return true;
    });
  }, [allTransactions, txType, txSearch, txFrom, txTo]);

  // ============================================
  // ACTIONS
  // ============================================
  function requireName() {
    setEditingName(true);
    setNotice({ type: "warning", text: "Enter your name at the top first." });
    if (nameInputRef.current) nameInputRef.current.focus();
  }

  function setNextOverride(id) {
    const action = () => {
      persist({ ...data, nextOverrideId: id || null });
    };
    wrapWithPasswordCheck(action, 'Set next payout');
  }

  // ----- Members -----
  function addMember() {
    const name = memberName.trim();
    if (!name) return;
    const action = () => {
      const next = {
        ...data,
        members: [...data.members, { id: uid(), name, type: memberType, order: data.members.length, recordedBy: recorderName }],
      };
      persist(next);
      setMemberName("");
      const logEntry = {
        id: uid(),
        kind: 'member_added',
        removedEntry: { memberName: name, memberType: memberType, recordedBy: recorderName },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      persist({ ...next, removedLog: [...next.removedLog, logEntry] });
    };
    wrapWithPasswordCheck(action, 'Add member');
  }

  function removeMember(id) {
    const action = () => {
      const member = data.members.find(m => m.id === id);
      const logEntry = {
        id: uid(),
        kind: 'member_removed',
        removedEntry: { memberName: member?.name || 'Unknown', memberId: id, recordedBy: recorderName },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      const next = {
        ...data,
        members: data.members.filter((m) => m.id !== id),
        removedLog: [...data.removedLog, logEntry]
      };
      persist(next);
    };
    wrapWithPasswordCheck(action, 'Remove member');
  }

  // ----- Contributions -----
  function addContribution() {
    const member = data.members.find(m => m.id === cMember);
    if (!member) return;
    const action = () => {
      const amount = getContributionAmount(member.type);
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
      setNotice(null);
    };
    wrapWithPasswordCheck(action, 'Record contribution');
  }

  function removeContribution(id) {
    const action = () => {
      const removed = data.contributions.find((c) => c.id === id);
      const logEntry = {
        id: uid(),
        kind: 'contribution',
        removedEntry: { ...removed, memberName: memberById[removed?.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      persist({
        ...data,
        contributions: data.contributions.filter((c) => c.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove contribution');
  }

  // ----- Payouts -----
  function addPayout() {
    const amount = parseFloat(pAmount);
    if (!pMember || !amount || amount <= 0) return;
    const action = () => {
      if (amount > totals.potBalance) {
        setNotice({ type: "warning", text: `Heads up: this payout of ${fmt(amount)} is more than the pot balance of ${fmt(totals.potBalance)}. Recorded anyway.` });
      } else { setNotice(null); }
      const entry = { id: uid(), memberId: pMember, month: pMonth, amount, date: new Date().toISOString(), recordedBy: recorderName };
      persist({ ...data, payouts: [...data.payouts, entry] });
      setPAmount("");
    };
    wrapWithPasswordCheck(action, 'Record payout');
  }

  function removePayout(id) {
    const action = () => {
      const removed = data.payouts.find((p) => p.id === id);
      const logEntry = {
        id: uid(),
        kind: 'payout',
        removedEntry: { ...removed, memberName: memberById[removed?.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      persist({
        ...data,
        payouts: data.payouts.filter((p) => p.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove payout');
  }

  // ----- EF Withdrawals -----
  function addWithdrawal() {
    const amount = parseFloat(eAmount);
    if (!amount || amount <= 0) return;
    const action = () => {
      if (amount > totals.efBalance) {
        setNotice({ type: "warning", text: `Heads up: this withdrawal of ${fmt(amount)} is more than the emergency fund balance of ${fmt(totals.efBalance)}. Recorded anyway.` });
      } else { setNotice(null); }
      const entry = {
        id: uid(),
        memberId: eMember || null,
        reason: eReason.trim() || "Emergency fund withdrawal",
        amount,
        date: new Date().toISOString(),
        recordedBy: recorderName,
      };
      persist({ ...data, efWithdrawals: [...data.efWithdrawals, entry] });
      setEAmount("");
      setEReason("");
      setEMember("");
    };
    wrapWithPasswordCheck(action, 'Record EF withdrawal');
  }

  function removeWithdrawal(id) {
    const action = () => {
      const removed = data.efWithdrawals.find((w) => w.id === id);
      const logEntry = {
        id: uid(),
        kind: 'withdrawal',
        removedEntry: { ...removed, memberName: removed?.memberId ? (memberById[removed.memberId]?.name || 'Unknown') : 'General fund' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      const remainingRepayments = (data.efRepayments || []).filter(r => r.loanId !== id);
      persist({
        ...data,
        efWithdrawals: data.efWithdrawals.filter((w) => w.id !== id),
        efRepayments: remainingRepayments,
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove EF withdrawal');
  }

  // ----- Repayments -----
  function addRepayment(loanId, memberId, amount) {
    if (!amount || amount <= 0) return;
    const action = () => {
      const loan = data.efWithdrawals.find(w => w.id === loanId);
      if (!loan) return;
      const alreadyRepaid = (data.efRepayments || []).filter(r => r.loanId === loanId).reduce((s, r) => s + r.amount, 0);
      const remaining = loan.amount - alreadyRepaid;
      if (amount > remaining) {
        setNotice({ type: "error", text: `Repayment amount exceeds remaining balance of ${fmt(remaining)}.` });
        return;
      }
      const repaymentEntry = {
        id: uid(),
        loanId,
        memberId,
        amount,
        date: new Date().toISOString(),
        recordedBy: recorderName
      };
      const repayments = [...(data.efRepayments || []), repaymentEntry];
      persist({ ...data, efRepayments: repayments });
      setRepayLoanId(null);
      setRepayAmount("");
      setNotice({ type: "warning", text: `Repayment of ${fmt(amount)} recorded. Remaining: ${fmt(remaining - amount)}` });
    };
    wrapWithPasswordCheck(action, 'Record repayment');
  }

  function removeRepayment(id) {
    const action = () => {
      const removed = (data.efRepayments || []).find(r => r.id === id);
      if (!removed) return;
      const logEntry = {
        id: uid(),
        kind: 'repayment',
        removedEntry: { ...removed, memberName: memberById[removed.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      persist({
        ...data,
        efRepayments: (data.efRepayments || []).filter(r => r.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove repayment');
  }

  // ----- Transfers -----
  function executeTransfer() {
    const amount = parseFloat(transferAmount);
    if (!amount || amount <= 0) {
      setNotice({ type: "error", text: "Please enter a valid amount." });
      return;
    }
    if (!transferReason.trim()) {
      setNotice({ type: "error", text: "Please enter a justification for this transfer." });
      return;
    }
    const action = () => {
      const direction = transferDirection;
      // Check if transfer would cause negative balance
      if (direction === 'ef-to-pot' && amount > totals.efBalance) {
        setNotice({ type: "error", text: `Insufficient funds in Emergency Fund. Available: ${fmt(totals.efBalance)}` });
        setShowTransferModal(false);
        return;
      }
      if (direction === 'pot-to-ef' && amount > totals.potBalance) {
        setNotice({ type: "error", text: `Insufficient funds in Pot. Available: ${fmt(totals.potBalance)}` });
        setShowTransferModal(false);
        return;
      }

      const transferEntry = {
        id: uid(),
        direction,
        amount,
        reason: transferReason.trim(),
        date: new Date().toISOString(),
        recordedBy: recorderName
      };

      const transfers = [...(data.transfers || []), transferEntry];
      persist({ ...data, transfers });
      setTransferAmount("");
      setTransferReason("");
      setShowTransferModal(false);
      setNotice({ type: "warning", text: `Transfer of ${fmt(amount)} ${direction === 'ef-to-pot' ? 'EF → Pot' : 'Pot → EF'} completed.` });
    };
    wrapWithPasswordCheck(action, 'Execute transfer');
  }

  function removeTransfer(id) {
    const action = () => {
      const removed = (data.transfers || []).find(t => t.id === id);
      if (!removed) return;
      const logEntry = {
        id: uid(),
        kind: 'transfer',
        removedEntry: { ...removed },
        removedAt: new Date().toISOString(),
        removedBy: recorderName
      };
      persist({
        ...data,
        transfers: (data.transfers || []).filter(t => t.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove transfer');
  }

  // ----- Settings -----
  function updatePasswordSetting() {
    const action = () => {
      const settings = {
        requirePassword: passwordToggle,
        password: passwordToggle ? newPassword : ''
      };
      persist({ ...data, settings });
      setNotice({ type: "warning", text: passwordToggle ? `Password protection enabled. Password is: "${newPassword}"` : "Password protection disabled." });
    };
    wrapWithPasswordCheck(action, 'Update password settings');
  }

  function removeTransaction(entry) {
    if (!entry.canRemove) {
      setNotice({ type: "error", text: "This transaction cannot be removed (audit log)." });
      return;
    }
    const type = entry.type;
    if (type === 'contribution') removeContribution(entry.originalId);
    else if (type === 'payout') removePayout(entry.originalId);
    else if (type === 'withdrawal') removeWithdrawal(entry.originalId);
    else if (type === 'repayment') removeRepayment(entry.originalId);
    else if (type === 'transfer') removeTransfer(entry.originalId);
    else setNotice({ type: "error", text: "Cannot remove this type of entry." });
  }

  // ============================================
  // RENDER
  // ============================================
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

      {isViewOnly && (
        <div style={{
          background: "#3A2A05",
          color: "#F3D48A",
          textAlign: "center",
          padding: "10px",
          fontWeight: 600,
          fontSize: 14,
          borderBottom: "2px solid #C9962B"
        }}>
          🔒 VIEW-ONLY MODE — You are viewing but cannot make changes
        </div>
      )}

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
            {data.settings?.requirePassword && (
              <span style={{ fontSize: 11, color: "#F3D48A", background: "#2F6B44", padding: "2px 10px", borderRadius: 999 }}>
                🔒 Password protected
              </span>
            )}
          </div>
        </div>
        <div style={styles.heroGrid}>
          <div style={styles.wheelCol}>
            <svg width={wheelSize} height={wheelSize} viewBox={`0 0 ${wheelSize} ${wheelSize}`} role="img" aria-label="Payout rotation wheel">
              <circle cx={center} cy={center} r={radius + 34} fill="none" stroke="#2F6B44" strokeWidth="1" />
              {n === 0 && <text x={center} y={center} textAnchor="middle" fill="#A9C9AE" fontSize="12" fontFamily="var(--body)">Add members to start</text>}
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
            {data.members.length > 0 && !isViewOnly && (
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
          ["fund", "Emergency Fund"],
          ["loans", "Loans"],
          ["transactions", "Transactions"],
          ["settings", "Settings"],
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
        {/* ===== MEMBERS ===== */}
        {tab === "overview" && (
          <section>
            {!isViewOnly && (
              <div style={styles.formRow}>
                <input
                  style={styles.input}
                  placeholder="Member name"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addMember(); }}
                />
                <select style={styles.input} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
                  <option value="adult">Adult ($50)</option>
                  <option value="child">Child ($25)</option>
                </select>
                <button style={styles.btnPrimary} type="button" onClick={addMember}>Add member</button>
              </div>
            )}
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
                    {!isViewOnly && <th style={styles.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {perMember.map((m) => (
                    <tr key={m.id}>
                      <td style={styles.td} data-label="Member">
                        {m.name}
                        {nextRecipient && nextRecipient.id === m.id && <span style={styles.nextTag}>next</span>}
                      </td>
                      <td style={styles.td} data-label="Type">{m.type === 'child' ? 'Child ($25)' : 'Adult ($50)'}</td>
                      <td style={styles.td} data-label="Contributed">{fmt(m.contributed)}</td>
                      <td style={styles.td} data-label="Received">{fmt(m.received)}</td>
                      <td style={styles.td} data-label="EF Balance">{fmt(m.efBalance)}</td>
                      <td style={styles.td} data-label="Recorded By">{m.recordedBy ? `Recorded By ${m.recordedBy}` : "—"}</td>
                      {!isViewOnly && (
                        <td style={styles.td}>
                          <button style={styles.btnGhostSmall} onClick={() => removeMember(m.id)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== CONTRIBUTIONS ===== */}
        {tab === "contributions" && (
          <section>
            {!isViewOnly && (
              <div style={styles.formGrid}>
                <select style={styles.input} value={cMember} onChange={(e) => setCMember(e.target.value)}>
                  <option value="">Select member</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.type === 'child' ? '$25' : '$50'})</option>
                  ))}
                </select>
                <input style={styles.input} type="month" value={cMonth} onChange={(e) => setCMonth(e.target.value)} />
                {cMember && (
                  <input style={styles.input} type="number" value={getContributionAmount(data.members.find(m => m.id === cMember)?.type || 'adult')} readOnly disabled placeholder="Amount" />
                )}
                <button style={styles.btnPrimary} type="button" onClick={addContribution}>Record contribution</button>
              </div>
            )}
            {cMember && data.members.find(m => m.id === cMember) && (
              <p style={styles.splitPreview}>
                {data.members.find(m => m.id === cMember).type === 'child'
                  ? `Child contribution: $${getContributionAmount('child')} goes 100% to Emergency Fund`
                  : `Adult contribution: $${getContributionAmount('adult')} splits into ${fmt(ADULT_CONTRIBUTION * POT_PCT)} to the pot and ${fmt(ADULT_CONTRIBUTION * EF_PCT)} to the emergency fund.`
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
                    {!isViewOnly && <th style={styles.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {[...data.contributions].sort((a, b) => (a.date < b.date ? 1 : -1)).map((c) => (
                    <tr key={c.id}>
                      <td style={styles.td} data-label="Month">{monthLabel(c.month)}</td>
                      <td style={styles.td} data-label="Member">{memberById[c.memberId]?.name || "Removed member"}</td>
                      <td style={styles.td} data-label="Type">{c.memberType === 'child' ? 'Child' : 'Adult'}</td>
                      <td style={styles.td} data-label="Amount">{fmt(c.amount)}</td>
                      <td style={styles.td} data-label="To pot">{fmt(c.potShare || 0)}</td>
                      <td style={styles.td} data-label="To fund">{fmt(c.efShare || 0)}</td>
                      <td style={styles.td} data-label="Recorded By">{c.recordedBy ? `Recorded By ${c.recordedBy}` : "—"}</td>
                      {!isViewOnly && (
                        <td style={styles.td}>
                          <button style={styles.btnGhostSmall} onClick={() => removeContribution(c.id)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== PAYOUTS ===== */}
        {tab === "payouts" && (
          <section>
            {!isViewOnly && (
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
            )}
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
                    {!isViewOnly && <th style={styles.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {[...data.payouts].sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => (
                    <tr key={p.id}>
                      <td style={styles.td} data-label="Month">{monthLabel(p.month)}</td>
                      <td style={styles.td} data-label="Member">{memberById[p.memberId]?.name || "Removed member"}</td>
                      <td style={styles.td} data-label="Amount">{fmt(p.amount)}</td>
                      <td style={styles.td} data-label="Recorded By">{p.recordedBy ? `Recorded By ${p.recordedBy}` : "—"}</td>
                      {!isViewOnly && (
                        <td style={styles.td}>
                          <button style={styles.btnGhostSmall} onClick={() => removePayout(p.id)}>Remove</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== EMERGENCY FUND ===== */}
        {tab === "fund" && (
          <section>
            <div style={styles.fundBalanceCard}>
              <p style={styles.statLabelAccent}>Emergency fund balance</p>
              <p style={styles.statValueAccent}>{fmt(totals.efBalance)}</p>
            </div>

            {!isViewOnly && (
              <>
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

                <h4 style={{ margin: "16px 0 8px" }}>Transfer Funds</h4>
                <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 12, borderRadius: 8 }}>
                  <select style={styles.input} value={transferDirection} onChange={(e) => setTransferDirection(e.target.value)}>
                    <option value="ef-to-pot">Emergency Fund → Pot</option>
                    <option value="pot-to-ef">Pot → Emergency Fund</option>
                  </select>
                  <input style={styles.input} type="number" min="0.01" step="0.01" placeholder="Amount" value={transferAmount} onChange={(e) => setTransferAmount(e.target.value)} />
                  <input style={styles.input} placeholder="Justification (required)" value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
                  <button style={styles.btnPrimary} type="button" onClick={() => {
                    if (!parseFloat(transferAmount) || parseFloat(transferAmount) <= 0) {
                      setNotice({ type: "error", text: "Please enter a valid amount." });
                      return;
                    }
                    if (!transferReason.trim()) {
                      setNotice({ type: "error", text: "Please enter a justification." });
                      return;
                    }
                    // Show confirmation modal with justification
                    setShowTransferModal(true);
                  }}>Execute Transfer</button>
                </div>

                {showTransferModal && (
                  <div style={styles.modalOverlay}>
                    <div style={styles.modal}>
                      <h3 style={{ marginTop: 0 }}>Confirm Transfer</h3>
                      <p><strong>Direction:</strong> {transferDirection === 'ef-to-pot' ? 'EF → Pot' : 'Pot → EF'}</p>
                      <p><strong>Amount:</strong> {fmt(parseFloat(transferAmount) || 0)}</p>
                      <p><strong>Justification:</strong> {transferReason}</p>
                      <p style={{ color: "#9C4A2E", fontSize: 13 }}>⚠️ This action will permanently move funds between accounts.</p>
                      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                        <button style={styles.btnPrimary} onClick={executeTransfer}>Confirm Transfer</button>
                        <button style={styles.btnGhostSmall} onClick={() => { setShowTransferModal(false); }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {data.efWithdrawals.length === 0 && (data.transfers || []).length === 0 ? (
              <p style={styles.empty}>No withdrawals or transfers recorded yet.</p>
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
                      {!isViewOnly && <th style={styles.th}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.efWithdrawals].sort((a, b) => (a.date < b.date ? 1 : -1)).map((w) => {
                      const repaid = (data.efRepayments || []).filter(r => r.loanId === w.id).reduce((s, r) => s + r.amount, 0);
                      const remaining = w.amount - repaid;
                      return (
                        <tr key={w.id}>
                          <td style={styles.td} data-label="Date">{new Date(w.date).toLocaleDateString()}</td>
                          <td style={styles.td} data-label="Member">{w.memberId ? (memberById[w.memberId]?.name || "Removed member") : "General fund"}</td>
                          <td style={styles.td} data-label="Reason">{w.reason}</td>
                          <td style={styles.td} data-label="Amount">{fmt(w.amount)}</td>
                          <td style={styles.td} data-label="Repaid">{fmt(repaid)}</td>
                          <td style={styles.td} data-label="Remaining">{fmt(remaining)}</td>
                          <td style={styles.td} data-label="Recorded By">{w.recordedBy ? `Recorded By ${w.recordedBy}` : "—"}</td>
                          {!isViewOnly && (
                            <td style={styles.td} data-label="Actions">
                              {remaining > 0.01 && (
                                <button style={styles.btnGhostSmall} onClick={() => { setRepayLoanId(w.id); setRepayAmount(""); }}>Repay</button>
                              )}
                              <button style={styles.btnGhostSmall} onClick={() => removeWithdrawal(w.id)}>Remove</button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {repayLoanId && !isViewOnly && (
                  <div style={{ ...styles.formGrid, marginTop: 12, background: "#f5f0e6", padding: 12, borderRadius: 8 }}>
                    <span style={{ fontWeight: 600, alignSelf: "center" }}>Repay loan for {memberById[data.efWithdrawals.find(w => w.id === repayLoanId)?.memberId]?.name || 'member'}</span>
                    <input style={styles.input} type="number" min="0.01" step="0.01" placeholder="Amount" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} />
                    <button style={styles.btnPrimary} onClick={() => addRepayment(repayLoanId, data.efWithdrawals.find(w => w.id === repayLoanId)?.memberId, parseFloat(repayAmount))}>Submit Repayment</button>
                    <button style={styles.btnGhostSmall} onClick={() => { setRepayLoanId(null); setRepayAmount(""); }}>Cancel</button>
                  </div>
                )}

                {(data.transfers || []).length > 0 && (
                  <>
                    <h4 style={{ margin: "16px 0 8px" }}>Transfer History</h4>
                    <table style={styles.table} className="rtable">
                      <thead>
                        <tr>
                          <th style={styles.th}>Date</th>
                          <th style={styles.th}>Direction</th>
                          <th style={styles.th}>Amount</th>
                          <th style={styles.th}>Justification</th>
                          <th style={styles.th}>Recorded By</th>
                          {!isViewOnly && <th style={styles.th}></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {[...(data.transfers || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => (
                          <tr key={t.id}>
                            <td style={styles.td} data-label="Date">{new Date(t.date).toLocaleDateString()}</td>
                            <td style={styles.td} data-label="Direction">{t.direction === 'ef-to-pot' ? 'EF → Pot' : 'Pot → EF'}</td>
                            <td style={styles.td} data-label="Amount">{fmt(t.amount)}</td>
                            <td style={styles.td} data-label="Justification">{t.reason}</td>
                            <td style={styles.td} data-label="Recorded By">{t.recordedBy || '—'}</td>
                            {!isViewOnly && (
                              <td style={styles.td}>
                                <button style={styles.btnGhostSmall} onClick={() => removeTransfer(t.id)}>Remove</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* ===== LOANS ===== */}
        {tab === "loans" && (
          <section>
            <h3 style={{ marginBottom: 12 }}>Outstanding Emergency Fund Loans</h3>
            {loansOutstanding.length === 0 ? (
              <p style={styles.empty}>No outstanding loans. All emergency fund withdrawals have been fully repaid.</p>
            ) : (
              <table style={styles.table} className="rtable">
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Reason</th>
                    <th style={styles.th}>Total</th>
                    <th style={styles.th}>Repaid</th>
                    <th style={styles.th}>Remaining</th>
                    <th style={styles.th}>Recorded By</th>
                  </tr>
                </thead>
                <tbody>
                  {loansOutstanding.map((w) => (
                    <tr key={w.id}>
                      <td style={styles.td} data-label="Date">{new Date(w.date).toLocaleDateString()}</td>
                      <td style={styles.td} data-label="Member">{w.memberId ? (memberById[w.memberId]?.name || "Removed member") : "General fund"}</td>
                      <td style={styles.td} data-label="Reason">{w.reason}</td>
                      <td style={styles.td} data-label="Total">{fmt(w.amount)}</td>
                      <td style={styles.td} data-label="Repaid">{fmt(w.repaid)}</td>
                      <td style={styles.td} data-label="Remaining" style={{ fontWeight: 600, color: "#9C4A2E" }}>{fmt(w.remaining)}</td>
                      <td style={styles.td} data-label="Recorded By">{w.recordedBy ? `Recorded By ${w.recordedBy}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== TRANSACTIONS ===== */}
        {tab === "transactions" && (
          <section>
            <p style={styles.hint}>Full audit log of every transaction. Items marked "removed" cannot be deleted — they are kept for audit purposes.</p>
            <div style={styles.formGrid}>
              <select style={styles.input} value={txType} onChange={(e) => setTxType(e.target.value)}>
                <option value="all">All types</option>
                <option value="contribution">Contributions</option>
                <option value="payout">Payouts</option>
                <option value="withdrawal">Emergency Withdrawals</option>
                <option value="repayment">EF Repayments</option>
                <option value="transfer">Transfers</option>
                <option value="removed">Removed entries</option>
              </select>
              <input style={styles.input} placeholder="Search by member name" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} />
              <input style={styles.input} type="date" value={txFrom} onChange={(e) => setTxFrom(e.target.value)} title="From date" />
              <input style={styles.input} type="date" value={txTo} onChange={(e) => setTxTo(e.target.value)} title="To date" />
              {(txType !== "all" || txSearch || txFrom || txTo) && (
                <button style={styles.btnGhostSmall} onClick={() => { setTxType("all"); setTxSearch(""); setTxFrom(""); setTxTo(""); }}>
                  Clear filters
                </button>
              )}
            </div>

            {filteredTransactions.length === 0 ? (
              <p style={styles.empty}>No transactions match these filters.</p>
            ) : (
              <table style={styles.table} className="rtable">
                <thead>
                  <tr>
                    <th style={styles.th}>Date &amp; time</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Member</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Recorded By</th>
                    <th style={styles.th}>Details</th>
                    {!isViewOnly && <th style={styles.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.id}>
                      <td style={styles.td} data-label="Date & time">{new Date(t.date).toLocaleString()}</td>
                      <td style={styles.td} data-label="Type">
                        {t.typeLabel}
                        {t.type === "removed" && <span style={styles.nextTag}>removed</span>}
                      </td>
                      <td style={styles.td} data-label="Member">{t.memberName}</td>
                      <td style={styles.td} data-label="Amount">{fmt(t.amount)}</td>
                      <td style={styles.td} data-label="Recorded By">{t.recordedBy}</td>
                      <td style={styles.td} data-label="Details">{t.detail}</td>
                      {!isViewOnly && (
                        <td style={styles.td} data-label="Actions">
                          {t.canRemove && (
                            <button style={styles.btnGhostSmall} onClick={() => removeTransaction(t)}>Remove</button>
                          )}
                          {!t.canRemove && <span style={{ fontSize: 11, color: "#8A8471" }}>Audit</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== SETTINGS ===== */}
        {tab === "settings" && (
          <section>
            <h3 style={{ marginBottom: 12 }}>App Settings</h3>

            {isViewOnly ? (
              <p style={styles.empty}>Settings are not available in view-only mode.</p>
            ) : (
              <>
                <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 16, borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <label style={{ fontWeight: 600 }}>Password Protection</label>
                    <p style={{ fontSize: 13, color: "#5F5E5A", margin: 0 }}>
                      When enabled, all write actions (add, remove, transfer, repay) will require a password.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={passwordToggle}
                        onChange={(e) => {
                          setPasswordToggle(e.target.checked);
                          if (!e.target.checked) {
                            // If turning off, clear password
                            const settings = { requirePassword: false, password: '' };
                            persist({ ...data, settings });
                            setNewPassword("");
                            setNotice({ type: "warning", text: "Password protection disabled." });
                          }
                        }}
                      />
                      Require password for changes
                    </label>
                  </div>
                </div>

                {passwordToggle && (
                  <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 16, borderRadius: 8 }}>
                    <input
                      style={styles.input}
                      type="text"
                      placeholder="Set new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <button style={styles.btnPrimary} onClick={() => {
                      if (!newPassword.trim()) {
                        setNotice({ type: "error", text: "Please enter a password." });
                        return;
                      }
                      const settings = { requirePassword: true, password: newPassword.trim() };
                      persist({ ...data, settings });
                      setPasswordToggle(true);
                      setNotice({ type: "warning", text: `Password set to: "${newPassword.trim()}"` });
                    }}>Set Password</button>
                    {data.settings?.password && (
                      <span style={{ alignSelf: "center", fontSize: 12, color: "#5F5E5A" }}>
                        Current password: <strong>{data.settings.password}</strong>
                      </span>
                    )}
                  </div>
                )}

                <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 16, borderRadius: 8, marginTop: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontWeight: 600 }}>View-Only Link</label>
                    <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0" }}>
                      Share this link with members who should only view data, not make changes:
                    </p>
                    <code style={{
                      display: "block",
                      background: "#123B22",
                      color: "#F3D48A",
                      padding: "10px",
                      borderRadius: 6,
                      fontSize: 13,
                      wordBreak: "break-all",
                      marginTop: 8
                    }}>
                      {window.location.origin}{window.location.pathname}?mode=view
                    </code>
                    <button style={{ ...styles.btnGhostSmall, marginTop: 8 }} onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?mode=view`);
                      setNotice({ type: "warning", text: "View-only link copied to clipboard!" });
                    }}>Copy Link</button>
                  </div>
                </div>

                <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 16, borderRadius: 8, marginTop: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontWeight: 600 }}>Edit Link (Treasurers Only)</label>
                    <p style={{ fontSize: 13, color: "#5F5E5A", margin: "4px 0" }}>
                      Share this link with treasurers who need to make changes:
                    </p>
                    <code style={{
                      display: "block",
                      background: "#123B22",
                      color: "#F3D48A",
                      padding: "10px",
                      borderRadius: 6,
                      fontSize: 13,
                      wordBreak: "break-all",
                      marginTop: 8
                    }}>
                      {window.location.origin}{window.location.pathname}
                    </code>
                    <button style={{ ...styles.btnGhostSmall, marginTop: 8 }} onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}`);
                      setNotice({ type: "warning", text: "Edit link copied to clipboard!" });
                    }}>Copy Link</button>
                  </div>
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* ===== PASSWORD MODAL ===== */}
      {showPasswordModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>🔒 Password Required</h3>
            <p>Enter the password to perform: <strong>{pendingAction?.actionName || 'this action'}</strong></p>
            <input
              style={{ ...styles.input, width: "100%", marginTop: 8 }}
              type="password"
              placeholder="Enter password..."
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") executePendingAction(); }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button style={styles.btnPrimary} onClick={executePendingAction}>Submit</button>
              <button style={styles.btnGhostSmall} onClick={cancelPasswordModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// STYLES
// ============================================
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
  loadingWrap: { background: "#123B22", padding: "3rem", borderRadius: 12, textAlign: "center" },
  app: { fontFamily: "var(--body)", background: "#FBF7EC", borderRadius: 12, overflow: "hidden", border: "1px solid #E4DBC4" },
  hero: {
    padding: "1.75rem 1.75rem 1.5rem",
    backgroundImage: "linear-gradient(180deg, rgba(12,46,26,0.82), rgba(15,58,32,0.88))",
    backgroundSize: "cover",
    backgroundPosition: "center 30%",
  },
  heroTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  eyebrow: { color: "#A9C9AE", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", margin: 0, fontWeight: 600 },
  h1: { color: "#FBF4E4", fontFamily: "var(--display)", fontSize: 30, fontWeight: 700, margin: "4px 0 0" },
  splitBadge: { background: "#1F5D3B", color: "#E7F1E9", fontSize: 12, padding: "6px 12px", borderRadius: 999, display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--mono)" },
  splitDot: { color: "#5FA476" },
  syncBadge: { background: "transparent", border: "1px solid #2F6B44", color: "#A9C9AE", fontSize: 11, padding: "4px 10px", borderRadius: 999, display: "flex", gap: 6, alignItems: "center", fontFamily: "var(--body)", cursor: "pointer" },
  syncDot: { width: 6, height: 6, borderRadius: "50%", background: "#5DCAA5", display: "inline-block" },
  recorderBadge: { background: "transparent", border: "1px solid #2F6B44", color: "#E7F1E9", fontSize: 11, padding: "4px 10px", borderRadius: 999, fontFamily: "var(--body)", cursor: "pointer" },
  nameForm: { display: "flex", gap: 6 },
  nameInput: { width: 130, padding: "5px 10px", borderRadius: 999, border: "1px solid #4C8C5D", fontSize: 12, fontFamily: "var(--body)", background: "#123B22", color: "#FBF4E4" },
  nameSaveBtn: { background: "#C9962B", color: "#3A2A05", border: "none", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  heroGrid: { display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", marginTop: 12 },
  wheelCol: { display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto" },
  wheelCaption: { color: "#C9E0CC", fontSize: 13, marginTop: 8, textAlign: "center" },
  manualTag: { marginLeft: 8, background: "#2F6B44", color: "#A9C9AE", fontSize: 10, padding: "2px 6px", borderRadius: 999, fontWeight: 600, textTransform: "uppercase" },
  overrideRow: { marginTop: 8, display: "flex", justifyContent: "center" },
  overrideSelect: { background: "#123B22", color: "#E7F1E9", border: "1px solid #4C8C5D", borderRadius: 8, padding: "5px 10px", fontSize: 12, fontFamily: "var(--body)" },
  statCol: { display: "flex", flexDirection: "column", gap: 10, flex: "1 1 220px", minWidth: 220 },
  statCard: { background: "rgba(20,58,36,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "12px 16px" },
  statCardAccent: { background: "rgba(58,42,5,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(201,150,43,0.55)", borderRadius: 10, padding: "12px 16px" },
  statLabel: { color: "#A9C9AE", fontSize: 12, margin: 0 },
  statLabelAccent: { color: "#E4B95C", fontSize: 12, margin: 0 },
  statValue: { color: "#FBF4E4", fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, margin: "4px 0 0" },
  statValueAccent: { color: "#F3D48A", fontFamily: "var(--mono)", fontSize: 22, fontWeight: 600, margin: "4px 0 0" },
  noticeWarning: { background: "#FAEEDA", color: "#633806", padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #E4DBC4" },
  noticeError: { background: "#FCEBEB", color: "#791F1F", padding: "10px 20px", fontSize: 13, borderBottom: "1px solid #E4DBC4" },
  tabs: { display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid #E4DBC4", flexWrap: "wrap" },
  tab: { background: "transparent", border: "none", padding: "8px 14px", fontSize: 13, color: "#7A7460", cursor: "pointer", borderBottom: "2px solid transparent", fontFamily: "var(--body)", fontWeight: 500 },
  tabActive: { background: "transparent", border: "none", padding: "8px 14px", fontSize: 13, color: "#1F5D3B", cursor: "pointer", borderBottom: "2px solid #C9962B", fontFamily: "var(--body)", fontWeight: 600 },
  main: { padding: "20px" },
  formRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  formGrid: { display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" },
  input: { flex: "1 1 160px", padding: "9px 12px", borderRadius: 8, border: "1px solid #D8CFB4", fontSize: 14, fontFamily: "var(--body)", background: "#FFFDF7", color: "#2C2C2A" },
  btnPrimary: { background: "#1F5D3B", color: "#FBF4E4", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  btnGhostSmall: { background: "transparent", border: "1px solid #D8CFB4", color: "#9C4A2E", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "var(--body)" },
  splitPreview: { fontSize: 13, color: "#5F5E5A", marginBottom: 16, fontFamily: "var(--mono)" },
  hint: { fontSize: 13, color: "#5F5E5A", marginBottom: 12 },
  empty: { color: "#8A8471", fontSize: 14, padding: "20px 0", textAlign: "center" },
  table: { fontSize: 13, color: "#2C2C2A" },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #E4DBC4", color: "#7A7460", fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.03em" },
  td: { padding: "8px 10px", borderBottom: "1px solid #EEE7D4" },
  nextTag: { marginLeft: 8, background: "#FAEEDA", color: "#633806", fontSize: 10, padding: "2px 6px", borderRadius: 999, fontWeight: 600, textTransform: "uppercase" },
  fundBalanceCard: { background: "#3A2A05", border: "1px solid #C9962B", borderRadius: 10, padding: "14px 18px", marginBottom: 16, display: "inline-block" },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999
  },
  modal: {
    background: "#FFFDF7",
    padding: "24px",
    borderRadius: 12,
    maxWidth: "420px",
    width: "90%",
    boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    border: "1px solid #E4DBC4"
  }
};
