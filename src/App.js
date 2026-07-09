/* eslint-disable */
import React, { useState, useEffect, useMemo, useRef } from 'react';
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

function getTodayEastern() {
  const now = new Date();
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
  const [month, day, year] = eastern.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function getCurrentMonthEastern() {
  const now = new Date();
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit'
  }).format(now);
  const [month, year] = eastern.split('/');
  return `${year}-${month.padStart(2, '0')}`;
}

function formatEasternDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(d);
  return eastern;
}

function formatEasternDateShort(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(d);
  return eastern;
}

function getUTCDateRange(localDateStr) {
  const parts = localDateStr.split('-');
  const year = parseInt(parts[0]);
  const month = parseInt(parts[1]) - 1;
  const day = parseInt(parts[2]);
  const startLocal = new Date(year, month, day, 0, 0, 0);
  const endLocal = new Date(year, month, day, 23, 59, 59);
  return {
    startUTC: startLocal.toISOString(),
    endUTC: endLocal.toISOString()
  };
}

function maskName(fullName) {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${firstName} ${lastInitial}.`;
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
  version: 0,
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
  const lastKnownVersion = React.useRef(0);

  // ----- Password state -----
  const [passwordInput, setPasswordInput] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [sessionAuthorized, setSessionAuthorized] = useState(() => {
    return sessionStorage.getItem('susu_password_authorized') === 'true';
  });
  
  // ----- Settings password lock -----
  const [settingsPasswordInput, setSettingsPasswordInput] = useState("");
  const [showSettingsPasswordModal, setShowSettingsPasswordModal] = useState(false);
  const [settingsAccessGranted, setSettingsAccessGranted] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [showPasswordText, setShowPasswordText] = useState(false);

  // ----- Confirmation / Justification modal -----
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmJustification, setConfirmJustification] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");

  // ----- View-only mode -----
  const isViewOnly = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'view';
  }, []);

  // ----- Chat state -----
  const [chatMessages, setChatMessages] = useState([]);
  const [chatMessage, setChatMessage] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const chatContainerRef = useRef(null);
  const chatInputRef = useRef(null);
  const chatSubscriptionRef = useRef(null);

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
  // CHAT LOGIC
  // ============================================
  useEffect(() => {
    if (!isViewOnly) {
      loadChatMessages();
      subscribeToChat();
    }
    return () => {
      if (chatSubscriptionRef.current) {
        chatSubscriptionRef.current.unsubscribe();
      }
    };
  }, [isViewOnly]);

  async function loadChatMessages() {
    try {
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      if (messages) {
        setChatMessages(messages.reverse());
        setTimeout(scrollChatToBottom, 100);
      }
    } catch (e) {
      console.log('Chat load error:', e);
    }
  }

  function subscribeToChat() {
    if (chatSubscriptionRef.current) {
      chatSubscriptionRef.current.unsubscribe();
    }
    chatSubscriptionRef.current = supabase
      .channel('chat_messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const newMsg = payload.new;
        setChatMessages(prev => [...prev, newMsg]);
        setTimeout(scrollChatToBottom, 100);
      })
      .subscribe();
  }

  async function sendChatMessage() {
    const msg = chatMessage.trim();
    if (!msg) return;
    if (!recorderName) {
      setNotice({ type: "warning", text: "Please set your name at the top first." });
      return;
    }
    try {
      const { error } = await supabase
        .from('chat_messages')
        .insert({ sender: recorderName, message: msg });
      if (error) throw error;
      setChatMessage("");
      if (chatInputRef.current) chatInputRef.current.focus();
    } catch (e) {
      console.log('Chat send error:', e);
      setNotice({ type: "error", text: "Could not send message." });
    }
  }

  function scrollChatToBottom() {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }

  function toggleChat() {
    setChatOpen(!chatOpen);
    if (!chatOpen) {
      setTimeout(scrollChatToBottom, 300);
      setTimeout(() => chatInputRef.current?.focus(), 400);
    }
  }

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
        if (!parsed.settings) {
          parsed.settings = { requirePassword: false, password: '' };
        }
        if (!parsed.transfers) {
          parsed.transfers = [];
        }
        if (parsed.version === undefined) {
          parsed.version = 0;
        }
        const remoteUpdatedAt = parsed.updatedAt || null;
        const isNewer = !lastKnownUpdatedAt.current || !remoteUpdatedAt || remoteUpdatedAt > lastKnownUpdatedAt.current;
        if (isNewer) {
          setData({ ...emptyData, ...parsed });
          lastKnownUpdatedAt.current = remoteUpdatedAt;
          lastKnownVersion.current = parsed.version || 0;
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
    const currentVersion = lastKnownVersion.current;
    const nextVersion = (nextRaw.version || 0) + 1;
    const next = { ...nextRaw, version: nextVersion, updatedAt: new Date().toISOString() };
    
    try {
      const { data: current, error: fetchError } = await supabase
        .from('app_state')
        .select('value')
        .eq('key', 'susu_data')
        .single();
      
      if (fetchError) throw fetchError;
      
      if (current && current.value) {
        const currentParsed = current.value;
        const dbVersion = currentParsed.version || 0;
        
        if (dbVersion !== currentVersion) {
          setNotice({ 
            type: "error", 
            text: `⚠️ Conflict detected! Someone else saved changes while you were editing. Please refresh the page to get the latest data, then try again.` 
          });
          await loadShared();
          return;
        }
      }
      
      const { error } = await supabase
        .from('app_state')
        .upsert({ key: 'susu_data', value: next }, { onConflict: 'key' });
      
      if (error) throw error;
      
      lastKnownUpdatedAt.current = next.updatedAt;
      lastKnownVersion.current = nextVersion;
      setData(next);
      setSyncedAt(new Date());
      
    } catch (e) {
      console.log('Save error:', e);
      setNotice({ type: "error", text: "Could not save. Please try again." });
    }
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

  function checkSettingsPassword(input) {
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
    if (sessionAuthorized) {
      action();
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
    setSessionAuthorized(true);
    sessionStorage.setItem('susu_password_authorized', 'true');
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

  function tryUnlockSettings() {
    if (!requiresPasswordCheck()) {
      setSettingsAccessGranted(true);
      setShowSettingsPasswordModal(false);
      return;
    }
    if (checkSettingsPassword(settingsPasswordInput)) {
      setSettingsAccessGranted(true);
      setShowSettingsPasswordModal(false);
      setSettingsPasswordInput("");
      setNotice({ type: "warning", text: "Settings unlocked." });
    } else {
      setNotice({ type: "error", text: "Incorrect password." });
      setSettingsPasswordInput("");
    }
  }

  function handleSettingsTabClick() {
    if (isViewOnly) {
      setNotice({ type: "error", text: "Settings are not available in view-only mode." });
      return;
    }
    if (!requiresPasswordCheck()) {
      setTab("settings");
      return;
    }
    if (settingsAccessGranted) {
      setTab("settings");
      return;
    }
    setShowSettingsPasswordModal(true);
    setSettingsPasswordInput("");
  }

  // ============================================
  // CONFIRMATION / JUSTIFICATION MODAL
  // ============================================
  function confirmRemove(actionFn, itemName, actionLabel) {
    setConfirmMessage(`Are you sure you want to ${actionLabel} "${itemName}"?`);
    setConfirmAction({ actionFn, actionLabel });
    setConfirmJustification("");
    setShowConfirmModal(true);
  }

  function executeConfirmedAction() {
    if (!confirmJustification.trim()) {
      setNotice({ type: "error", text: "Please provide a justification." });
      return;
    }
    setShowConfirmModal(false);
    const wrappedAction = () => {
      if (confirmAction) {
        confirmAction.actionFn(confirmJustification.trim());
      }
    };
    wrapWithPasswordCheck(wrappedAction, confirmAction?.actionLabel || 'Remove item');
  }

  function cancelConfirmModal() {
    setShowConfirmModal(false);
    setConfirmAction(null);
    setConfirmJustification("");
    setConfirmMessage("");
  }

  // ============================================
  // HELPERS
  // ============================================
  const memberById = useMemo(() => {
    const map = {};
    data.members.forEach((m) => (map[m.id] = m));
    return map;
  }, [data.members]);

  const memberCount = data.members.length;

  const totals = useMemo(() => {
    const totalCollected = data.contributions.reduce((s, c) => s + c.amount, 0);
    const potIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? 0 : (c.potShare || 0)), 0);
    const potOut = data.payouts.reduce((s, p) => s + p.amount, 0);
    const efIn = data.contributions.reduce((s, c) => s + (c.memberType === 'child' ? c.amount : (c.efShare || 0)), 0);
    const efOut = data.efWithdrawals.reduce((s, w) => s + w.amount, 0);
    const efRepaid = data.efRepayments ? data.efRepayments.reduce((s, r) => s + r.amount, 0) : 0;
    
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
    const now = new Date();
    const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', day: 'numeric' }).format(now);
    const todayDay = parseInt(eastern);

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
      
      const currentMonth = getCurrentMonthEastern();
      const contributionsThisMonth = data.contributions.filter(c => c.memberId === m.id && c.month === currentMonth);
      const paidThisMonth = contributionsThisMonth.length > 0;
      
      const allMonths = data.contributions
        .filter(c => c.memberId === m.id)
        .map(c => c.month)
        .filter(m => m && m.length === 7);
      const uniqueMonths = [...new Set(allMonths)].sort();
      const currentMonthIndex = uniqueMonths.indexOf(currentMonth);
      let prepaidCount = 0;
      if (currentMonthIndex !== -1) {
        for (let i = currentMonthIndex + 1; i < uniqueMonths.length; i++) {
          prepaidCount++;
        }
      }
      
      let status = 'red';
      let statusLabel = 'Late';
      
      if (paidThisMonth) {
        status = 'green';
        statusLabel = 'Current';
      } else {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthStr = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth()+1).padStart(2, '0');
        const paidLastMonth = data.contributions.some(c => c.memberId === m.id && c.month === lastMonthStr);
        
        if (todayDay > 5) {
          if (paidLastMonth) {
            status = 'yellow';
            statusLabel = 'Not Current (Paid Last Month)';
          } else {
            status = 'red';
            statusLabel = 'Late';
          }
        } else {
          if (paidLastMonth) {
            status = 'yellow';
            statusLabel = 'Not Current (Paid Last Month)';
          } else {
            status = 'yellow';
            statusLabel = 'Pending (Due by 5th)';
          }
        }
      }
      
      return { 
        ...m, 
        contributed, 
        received, 
        lastPayoutDate: lastPayout ? lastPayout.date : null, 
        efReceived, 
        efRepaid, 
        efBalance: efReceived - efRepaid,
        status,
        statusLabel,
        prepaidCount
      };
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
  // ALL TRANSACTIONS (with justification)
  // ============================================
  const allTransactions = useMemo(() => {
    const rows = [];

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
        canRemove: true,
        justification: null
      });
    });

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
        canRemove: true,
        justification: null
      });
    });

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
        canRemove: true,
        justification: null
      });
    });

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
        canRemove: true,
        justification: null
      });
    });

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
        canRemove: true,
        justification: null
      });
    });

    (data.removedLog || []).forEach((r) => {
      const e = r.removedEntry || {};
      let typeLabel = '';
      let memberNameDisplay = '';
      let detailText = '';
      let amountDisplay = e.amount || 0;

      if (r.kind === 'member_added') {
        typeLabel = 'Member Added';
        memberNameDisplay = e.memberName || 'Unknown';
        detailText = `Added as ${e.memberType || 'member'}`;
        amountDisplay = 0;
      } else if (r.kind === 'member_removed') {
        typeLabel = 'Member Removed';
        memberNameDisplay = e.memberName || 'Unknown';
        detailText = `Removed from group`;
        amountDisplay = 0;
      } else {
        typeLabel = `Removed ${r.kind || 'entry'}`;
        memberNameDisplay = e.memberId ? (memberById[e.memberId]?.name || 'Removed member') : (e.memberName || '—');
        detailText = `Originally recorded ${e.date ? new Date(e.date).toLocaleString() : '—'} by ${e.recordedBy || '—'}`;
        amountDisplay = e.amount || 0;
      }

      rows.push({
        id: `rm-${r.id}`,
        type: 'removed',
        typeLabel: typeLabel,
        date: r.removedAt || new Date().toISOString(),
        memberName: memberNameDisplay,
        amount: amountDisplay,
        recordedBy: r.removedBy || '—',
        detail: detailText,
        canRemove: false,
        justification: r.justification || '—'
      });
    });

    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [data, memberById]);

  const filteredTransactions = useMemo(() => {
    return allTransactions.filter((t) => {
      if (txType !== 'all' && t.type !== txType) return false;
      if (txSearch.trim() && !t.memberName.toLowerCase().includes(txSearch.trim().toLowerCase())) return false;
      
      if (txFrom) {
        const { startUTC } = getUTCDateRange(txFrom);
        if (t.date < startUTC) return false;
      }
      if (txTo) {
        const { endUTC } = getUTCDateRange(txTo);
        if (t.date > endUTC) return false;
      }
      
      return true;
    });
  }, [allTransactions, txType, txSearch, txFrom, txTo]);

  // ============================================
  // ACTIONS (with justification support)
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
        removedBy: recorderName,
        justification: `Member added`
      };
      persist({ ...next, removedLog: [...next.removedLog, logEntry] });
    };
    wrapWithPasswordCheck(action, 'Add member');
  }

  function removeMember(id, justification) {
    const action = () => {
      const member = data.members.find(m => m.id === id);
      const logEntry = {
        id: uid(),
        kind: 'member_removed',
        removedEntry: { memberName: member?.name || 'Unknown', memberId: id, recordedBy: recorderName },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'Member removed'
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

  function removeContribution(id, justification) {
    const action = () => {
      const removed = data.contributions.find((c) => c.id === id);
      const logEntry = {
        id: uid(),
        kind: 'contribution',
        removedEntry: { ...removed, memberName: memberById[removed?.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'Contribution removed'
      };
      persist({
        ...data,
        contributions: data.contributions.filter((c) => c.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove contribution');
  }

  function removePayout(id, justification) {
    const action = () => {
      const removed = data.payouts.find((p) => p.id === id);
      const logEntry = {
        id: uid(),
        kind: 'payout',
        removedEntry: { ...removed, memberName: memberById[removed?.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'Payout removed'
      };
      persist({
        ...data,
        payouts: data.payouts.filter((p) => p.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove payout');
  }

  function removeWithdrawal(id, justification) {
    const action = () => {
      const removed = data.efWithdrawals.find((w) => w.id === id);
      const logEntry = {
        id: uid(),
        kind: 'withdrawal',
        removedEntry: { ...removed, memberName: removed?.memberId ? (memberById[removed.memberId]?.name || 'Unknown') : 'General fund' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'EF withdrawal removed'
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

  function removeRepayment(id, justification) {
    const action = () => {
      const removed = (data.efRepayments || []).find(r => r.id === id);
      if (!removed) return;
      const logEntry = {
        id: uid(),
        kind: 'repayment',
        removedEntry: { ...removed, memberName: memberById[removed.memberId]?.name || 'Unknown' },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'Repayment removed'
      };
      persist({
        ...data,
        efRepayments: (data.efRepayments || []).filter(r => r.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove repayment');
  }

  function removeTransfer(id, justification) {
    const action = () => {
      const removed = (data.transfers || []).find(t => t.id === id);
      if (!removed) return;
      const logEntry = {
        id: uid(),
        kind: 'transfer',
        removedEntry: { ...removed },
        removedAt: new Date().toISOString(),
        removedBy: recorderName,
        justification: justification || 'Transfer removed'
      };
      persist({
        ...data,
        transfers: (data.transfers || []).filter(t => t.id !== id),
        removedLog: [...data.removedLog, logEntry],
      });
    };
    wrapWithPasswordCheck(action, 'Remove transfer');
  }

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

  function updatePasswordSetting() {
    const action = () => {
      const settings = {
        requirePassword: passwordToggle,
        password: passwordToggle ? newPassword : ''
      };
      persist({ ...data, settings });
      setNotice({ type: "warning", text: passwordToggle ? `Password protection enabled.` : "Password protection disabled." });
      sessionStorage.removeItem('susu_password_authorized');
      setSessionAuthorized(false);
      if (!passwordToggle) {
        setSettingsAccessGranted(false);
      }
    };
    wrapWithPasswordCheck(action, 'Update password settings');
  }

  function removeTransaction(entry) {
    if (!entry.canRemove) {
      setNotice({ type: "error", text: "This transaction cannot be removed (audit log)." });
      return;
    }
    const type = entry.type;
    const memberName = entry.memberName || 'item';
    let actionLabel = '';
    let actionFn = null;
    
    if (type === 'contribution') {
      actionLabel = `remove contribution for ${memberName}`;
      actionFn = (justification) => removeContribution(entry.originalId, justification);
    } else if (type === 'payout') {
      actionLabel = `remove payout for ${memberName}`;
      actionFn = (justification) => removePayout(entry.originalId, justification);
    } else if (type === 'withdrawal') {
      actionLabel = `remove EF withdrawal for ${memberName}`;
      actionFn = (justification) => removeWithdrawal(entry.originalId, justification);
    } else if (type === 'repayment') {
      actionLabel = `remove EF repayment for ${memberName}`;
      actionFn = (justification) => removeRepayment(entry.originalId, justification);
    } else if (type === 'transfer') {
      actionLabel = `remove transfer`;
      actionFn = (justification) => removeTransfer(entry.originalId, justification);
    } else {
      setNotice({ type: "error", text: "Cannot remove this type of entry." });
      return;
    }
    
    confirmRemove(actionFn, memberName, actionLabel);
  }

  // ============================================
  // FORGOT PASSWORD MESSAGE
  // ============================================
  const forgotPasswordMessage = `--- FORWARD THIS MESSAGE TO THE COMPLIANCE OFFICER & TECHNOLOGY OFFICER ---

Subject: Family Susu App — Password Reset Required

Dear Compliance Officer & Technology Officer,

A password reset has been requested for the Family Susu App.

To reset the password, please follow these steps:

1. Log in to Supabase at: https://supabase.com/dashboard
2. Select the "family-susu" project
3. Click on "Table Editor" in the left sidebar
4. Click on the "app_state" table
5. Find the row with key = "susu_data"
6. Click the pencil icon (Edit) on that row
7. In the "value" field, locate the "settings" object
8. Change "requirePassword" from true to false
9. Click "Save"
10. The password protection is now disabled

The user can then re-enable password protection with a new password.

--- END OF MESSAGE ---`;

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

  const allTabs = [
    ["overview", "Members"],
    ["contributions", "Contributions"],
    ["payouts", "Payouts"],
    ["fund", "Emergency Fund"],
    ["loans", "Loans"],
    ["transactions", "Transactions"],
    ["settings", "Settings"],
  ];
  const visibleTabs = isViewOnly ? allTabs.filter(([key]) => key === "overview") : allTabs;

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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div>
              <p style={styles.eyebrow}>Ledger</p>
              <h1 style={styles.h1}>Brundige Family Trust</h1>
            </div>
            <div style={{
              background: "rgba(201,150,43,0.15)",
              border: "1px solid #C9962B",
              borderRadius: "8px",
              padding: "6px 12px",
              color: "#F3D48A",
              fontSize: "12px",
              textAlign: "center",
              lineHeight: "1.3",
              whiteSpace: "nowrap",
              marginLeft: "auto"
            }}>
              <div style={{ fontWeight: 700 }}>Est. 2026</div>
              <div style={{ fontSize: "10px", opacity: 0.8 }}>{memberCount} members • And growing</div>
            </div>
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
            {!isViewOnly && (
              editingName ? (
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
              )
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
                    <title>{m.name}</title>
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
        {visibleTabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              if (key === "settings") {
                handleSettingsTabClick();
              } else {
                setTab(key);
              }
            }}
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

            {/* Legend - only visible to treasurers */}
            {!isViewOnly && (
              <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap", fontSize: 13, background: "#f5f0e6", padding: "8px 14px", borderRadius: 8 }}>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: "#2E7D32", marginRight: 4 }}></span> Current (paid this month)</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: "#F9A825", marginRight: 4 }}></span> Not Current (paid last month)</span>
                <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 4, background: "#C62828", marginRight: 4 }}></span> Late (unpaid after 5th)</span>
                <span style={{ color: "#5F5E5A" }}>| Prepaid: <strong>N</strong> months ahead</span>
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
                    {/* Status and Prepaid only for treasurers */}
                    {!isViewOnly && <th style={styles.th}>Status</th>}
                    {!isViewOnly && <th style={styles.th}>Prepaid</th>}
                    {!isViewOnly && <th style={styles.th}>Recorded By</th>}
                    {!isViewOnly && <th style={styles.th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {perMember.map((m) => {
                    const displayName = isViewOnly ? maskName(m.name) : m.name;
                    const isAdult = m.type === 'adult';
                    return (
                      <tr key={m.id}>
                        <td style={styles.td} data-label="Member">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {/* Show status dot only for adults and only for treasurers */}
                            {!isViewOnly && isAdult && (
                              <span style={{ 
                                display: 'inline-block', 
                                width: 10, 
                                height: 10, 
                                borderRadius: '50%', 
                                background: m.status === 'green' ? '#2E7D32' : (m.status === 'yellow' ? '#F9A825' : '#C62828'), 
                                flexShrink: 0 
                              }}></span>
                            )}
                            {displayName}
                            {nextRecipient && nextRecipient.id === m.id && <span style={styles.nextTag}>next</span>}
                          </span>
                        </td>
                        <td style={styles.td} data-label="Type">{m.type === 'child' ? 'Child ($25)' : 'Adult ($50)'}</td>
                        <td style={styles.td} data-label="Contributed">{fmt(m.contributed)}</td>
                        <td style={styles.td} data-label="Received">{fmt(m.received)}</td>
                        <td style={styles.td} data-label="EF Balance">{fmt(m.efBalance)}</td>
                        
                        {!isViewOnly && (
                          <>
                            <td style={styles.td} data-label="Status">
                              {isAdult ? (
                                <span style={{ color: m.status === 'green' ? '#2E7D32' : (m.status === 'yellow' ? '#F9A825' : '#C62828'), fontWeight: 600 }}>
                                  {m.statusLabel}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={styles.td} data-label="Prepaid">
                              {isAdult && m.prepaidCount > 0 ? `${m.prepaidCount} month${m.prepaidCount > 1 ? 's' : ''}` : '—'}
                            </td>
                            <td style={styles.td} data-label="Recorded By">{m.recordedBy ? `Recorded By ${m.recordedBy}` : "—"}</td>
                            <td style={styles.td}>
                              <button style={styles.btnGhostSmall} onClick={() => confirmRemove(removeMember, m.name, 'remove member')}>Remove</button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== CONTRIBUTIONS ===== */}
        {!isViewOnly && tab === "contributions" && (
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
                <input style={styles.input} type="number" value={getContributionAmount(data.members.find(m => m.id === cMember)?.type || 'adult')} readOnly disabled placeholder="Amount" />
              )}
              <button style={styles.btnPrimary} type="button" onClick={addContribution}>Record contribution</button>
            </div>
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
                    <th style={styles.th}></th>
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
                      <td style={styles.td}>
                        <button style={styles.btnGhostSmall} onClick={() => {
                          const memberName = memberById[c.memberId]?.name || 'this contribution';
                          confirmRemove(removeContribution, memberName, 'remove contribution');
                        }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== PAYOUTS ===== */}
        {!isViewOnly && tab === "payouts" && (
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
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.payouts].sort((a, b) => (a.date < b.date ? 1 : -1)).map((p) => (
                    <tr key={p.id}>
                      <td style={styles.td} data-label="Month">{monthLabel(p.month)}</td>
                      <td style={styles.td} data-label="Member">{memberById[p.memberId]?.name || "Removed member"}</td>
                      <td style={styles.td} data-label="Amount">{fmt(p.amount)}</td>
                      <td style={styles.td} data-label="Recorded By">{p.recordedBy ? `Recorded By ${p.recordedBy}` : "—"}</td>
                      <td style={styles.td}>
                        <button style={styles.btnGhostSmall} onClick={() => {
                          const memberName = memberById[p.memberId]?.name || 'this payout';
                          confirmRemove(removePayout, memberName, 'remove payout');
                        }}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== EMERGENCY FUND ===== */}
        {!isViewOnly && tab === "fund" && (
          <section>
            <div style={styles.fundBalanceCard}>
              <p style={styles.statLabelAccent}>Emergency fund balance</p>
              <p style={styles.statValueAccent}>{fmt(totals.efBalance)}</p>
            </div>

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
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.efWithdrawals].sort((a, b) => (a.date < b.date ? 1 : -1)).map((w) => {
                      const repaid = (data.efRepayments || []).filter(r => r.loanId === w.id).reduce((s, r) => s + r.amount, 0);
                      const remaining = w.amount - repaid;
                      return (
                        <tr key={w.id}>
                          <td style={styles.td} data-label="Date">{formatEasternDateShort(w.date)}</td>
                          <td style={styles.td} data-label="Member">{w.memberId ? (memberById[w.memberId]?.name || "Removed member") : "General fund"}</td>
                          <td style={styles.td} data-label="Reason">{w.reason}</td>
                          <td style={styles.td} data-label="Amount">{fmt(w.amount)}</td>
                          <td style={styles.td} data-label="Repaid">{fmt(repaid)}</td>
                          <td style={styles.td} data-label="Remaining">{fmt(remaining)}</td>
                          <td style={styles.td} data-label="Recorded By">{w.recordedBy ? `Recorded By ${w.recordedBy}` : "—"}</td>
                          <td style={styles.td} data-label="Actions">
                            {remaining > 0.01 && (
                              <button style={styles.btnGhostSmall} onClick={() => { setRepayLoanId(w.id); setRepayAmount(""); }}>Repay</button>
                            )}
                            <button style={styles.btnGhostSmall} onClick={() => {
                              const memberName = w.memberId ? (memberById[w.memberId]?.name || 'this EF withdrawal') : 'this general fund withdrawal';
                              confirmRemove(removeWithdrawal, memberName, 'remove EF withdrawal');
                            }}>Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {repayLoanId && (
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
                          <th style={styles.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(data.transfers || [])].sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => (
                          <tr key={t.id}>
                            <td style={styles.td} data-label="Date">{formatEasternDateShort(t.date)}</td>
                            <td style={styles.td} data-label="Direction">{t.direction === 'ef-to-pot' ? 'EF → Pot' : 'Pot → EF'}</td>
                            <td style={styles.td} data-label="Amount">{fmt(t.amount)}</td>
                            <td style={styles.td} data-label="Justification">{t.reason}</td>
                            <td style={styles.td} data-label="Recorded By">{t.recordedBy || '—'}</td>
                            <td style={styles.td}>
                              <button style={styles.btnGhostSmall} onClick={() => confirmRemove(removeTransfer, 'transfer', 'remove transfer')}>Remove</button>
                            </td>
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
        {!isViewOnly && tab === "loans" && (
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
                      <td style={styles.td} data-label="Date">{formatEasternDateShort(w.date)}</td>
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
        {!isViewOnly && tab === "transactions" && (
          <section>
            <p style={styles.hint}>Full audit log of every transaction. Items marked with "Audit" cannot be deleted.</p>
            <div style={styles.formGrid}>
              <select style={styles.input} value={txType} onChange={(e) => setTxType(e.target.value)}>
                <option value="all">All types</option>
                <option value="contribution">Contributions</option>
                <option value="payout">Payouts</option>
                <option value="withdrawal">Emergency Withdrawals</option>
                <option value="repayment">EF Repayments</option>
                <option value="transfer">Transfers</option>
                <option value="removed">Audit Log</option>
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
                    <th style={styles.th}>Justification</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((t) => (
                    <tr key={t.id}>
                      <td style={styles.td} data-label="Date & time">{formatEasternDate(t.date)}</td>
                      <td style={styles.td} data-label="Type">
                        {t.typeLabel}
                        {t.type === "removed" && <span style={styles.nextTag}>Audit</span>}
                      </td>
                      <td style={styles.td} data-label="Member">{t.memberName}</td>
                      <td style={styles.td} data-label="Amount">{fmt(t.amount)}</td>
                      <td style={styles.td} data-label="Recorded By">{t.recordedBy}</td>
                      <td style={styles.td} data-label="Details">{t.detail}</td>
                      <td style={styles.td} data-label="Justification">{t.justification || '—'}</td>
                      <td style={styles.td} data-label="Actions">
                        {t.canRemove && (
                          <button style={styles.btnGhostSmall} onClick={() => removeTransaction(t)}>Remove</button>
                        )}
                        {!t.canRemove && <span style={{ fontSize: 11, color: "#8A8471" }}>Audit</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {/* ===== SETTINGS ===== */}
        {!isViewOnly && tab === "settings" && (
          <section>
            <h3 style={{ marginBottom: 12 }}>App Settings</h3>

            <>
              <div style={{ ...styles.formGrid, background: "#f5f0e6", padding: 16, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <label style={{ fontWeight: 600 }}>Password Protection</label>
                  <p style={{ fontSize: 13, color: "#5F5E5A", margin: 0 }}>
                    When enabled, all write actions (add, remove, transfer, repay) will require a password.
                    You only need to enter it once per browser session.
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
                          const settings = { requirePassword: false, password: '' };
                          persist({ ...data, settings });
                          setNewPassword("");
                          setNotice({ type: "warning", text: "Password protection disabled." });
                          sessionStorage.removeItem('susu_password_authorized');
                          setSessionAuthorized(false);
                          setSettingsAccessGranted(false);
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
                    type={showPasswordText ? "text" : "password"}
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
                    setNotice({ type: "warning", text: `Password protection enabled.` });
                  }}>Set Password</button>
                  {data.settings?.password && (
                    <span style={{ alignSelf: "center", fontSize: 12, color: "#5F5E5A", display: "flex", alignItems: "center", gap: 6 }}>
                      Current password:
                      <span style={{ fontFamily: "monospace", background: "#f0ebe0", padding: "2px 8px", borderRadius: 4 }}>
                        {showPasswordText ? data.settings.password : '•'.repeat(data.settings.password.length)}
                      </span>
                      <button
                        style={{ ...styles.btnGhostSmall, padding: "2px 8px", fontSize: 11 }}
                        onClick={() => setShowPasswordText(!showPasswordText)}
                      >
                        {showPasswordText ? 'Hide' : 'Show'}
                      </button>
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

              {sessionAuthorized && (
                <div style={{ ...styles.formGrid, background: "#e8f0e8", padding: 12, borderRadius: 8, marginTop: 16 }}>
                  <span style={{ fontSize: 13 }}>✅ Password authorized for this session. You won't be prompted again until you refresh the page or clear your browser data.</span>
                </div>
              )}
            </>
          </section>
        )}
      </main>

      {/* ===== SETTINGS PASSWORD MODAL ===== */}
      {showSettingsPasswordModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>🔒 Settings Locked</h3>
            <p>Enter the password to access Settings.</p>
            <input
              style={{ ...styles.input, width: "100%", marginTop: 8 }}
              type="password"
              placeholder="Enter password..."
              value={settingsPasswordInput}
              onChange={(e) => setSettingsPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") tryUnlockSettings(); }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button style={styles.btnPrimary} onClick={tryUnlockSettings}>Unlock Settings</button>
              <button style={styles.btnGhostSmall} onClick={() => { setShowSettingsPasswordModal(false); setSettingsPasswordInput(""); }}>Cancel</button>
              <button style={{ ...styles.btnGhostSmall, color: "#9C4A2E" }} onClick={() => setShowForgotPasswordModal(true)}>Forgot Password?</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FORGOT PASSWORD MODAL ===== */}
      {showForgotPasswordModal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modal, maxWidth: "600px" }}>
            <h3 style={{ marginTop: 0 }}>🔑 Forgot Password?</h3>
            <p style={{ fontSize: 14, color: "#5F5E5A", marginBottom: 12 }}>
              Forward this message to the <strong>Compliance Officer &amp; Technology Officer</strong> to reset via Supabase:
            </p>
            <div style={{
              background: "#f5f0e6",
              padding: "14px",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: "300px",
              overflow: "auto",
              border: "1px solid #E4DBC4"
            }}>
              {forgotPasswordMessage}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button style={styles.btnPrimary} onClick={() => {
                navigator.clipboard.writeText(forgotPasswordMessage);
                setNotice({ type: "warning", text: "Message copied to clipboard!" });
              }}>📋 Copy Message</button>
              <button style={styles.btnGhostSmall} onClick={() => { setShowForgotPasswordModal(false); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ACTION PASSWORD MODAL ===== */}
      {showPasswordModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>🔒 Password Required</h3>
            <p>Enter the password to perform: <strong>{pendingAction?.actionName || 'this action'}</strong></p>
            <p style={{ fontSize: 12, color: "#5F5E5A" }}>You only need to enter this once per session.</p>
            <input
              style={{ ...styles.input, width: "100%", marginTop: 8 }}
              type="password"
              placeholder="Enter password..."
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") executePendingAction(); }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button style={styles.btnPrimary} onClick={executePendingAction}>Submit</button>
              <button style={styles.btnGhostSmall} onClick={cancelPasswordModal}>Cancel</button>
              <button style={{ ...styles.btnGhostSmall, color: "#9C4A2E" }} onClick={() => { setShowPasswordModal(false); setShowForgotPasswordModal(true); }}>Forgot Password?</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CONFIRMATION / JUSTIFICATION MODAL ===== */}
      {showConfirmModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={{ marginTop: 0 }}>⚠️ Confirm Action</h3>
            <p style={{ fontSize: 14 }}>{confirmMessage}</p>
            <p style={{ fontSize: 12, color: "#5F5E5A", marginTop: 4 }}>Please provide a justification for this action:</p>
            <textarea
              style={{
                ...styles.input,
                width: "100%",
                minHeight: "60px",
                resize: "vertical",
                marginTop: 8,
                fontFamily: "var(--body)",
                padding: "8px 12px"
              }}
              placeholder="Enter justification (required)..."
              value={confirmJustification}
              onChange={(e) => setConfirmJustification(e.target.value)}
              autoFocus
            />
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button style={styles.btnPrimary} onClick={executeConfirmedAction}>Confirm</button>
              <button style={styles.btnGhostSmall} onClick={cancelConfirmModal}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== CHAT PANEL ===== */}
      {!isViewOnly && (
        <div style={styles.chatWrapper}>
          <button style={styles.chatToggle} onClick={toggleChat}>
            💬 {chatOpen ? '✕' : 'Chat'}
          </button>
          {chatOpen && (
            <div style={styles.chatWindow}>
              <div style={styles.chatHeader}>
                <span style={{ fontWeight: 600 }}>📨 Treasurer Chat</span>
                <span style={{ fontSize: 11, color: "#7A7460" }}>Real-time</span>
              </div>
              <div ref={chatContainerRef} style={styles.chatMessages}>
                {chatMessages.length === 0 && (
                  <p style={{ color: "#8A8471", textAlign: "center", padding: 20 }}>No messages yet. Start the conversation!</p>
                )}
                {chatMessages.map((msg) => (
                  <div key={msg.id} style={styles.chatBubble}>
                    <strong style={styles.chatSender}>{msg.sender}</strong>
                    <span style={styles.chatText}>{msg.message}</span>
                    <span style={styles.chatTime}>
                      {formatEasternDate(msg.created_at)}
                    </span>
                  </div>
                ))}
              </div>
              <div style={styles.chatInputRow}>
                <input
                  ref={chatInputRef}
                  style={{ ...styles.input, flex: 1 }}
                  placeholder="Type a message..."
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") sendChatMessage(); }}
                />
                <button style={styles.btnPrimary} onClick={sendChatMessage}>Send</button>
              </div>
            </div>
          )}
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
  },
  chatWrapper: {
    position: "fixed",
    bottom: 20,
    right: 20,
    zIndex: 998,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end"
  },
  chatToggle: {
    background: "#1F5D3B",
    color: "#FBF4E4",
    border: "none",
    borderRadius: 50,
    width: 56,
    height: 56,
    fontSize: 22,
    cursor: "pointer",
    boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s"
  },
  chatWindow: {
    background: "#FFFDF7",
    border: "1px solid #E4DBC4",
    borderRadius: 12,
    width: 340,
    maxWidth: "90vw",
    height: 420,
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
    marginBottom: 10,
    overflow: "hidden",
    animation: "slideUp 0.25s ease"
  },
  chatHeader: {
    padding: "10px 14px",
    background: "#F5F0E6",
    borderBottom: "1px solid #E4DBC4",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0
  },
  chatMessages: {
    flex: 1,
    padding: "10px 12px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0
  },
  chatBubble: {
    background: "#F5F0E6",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    wordBreak: "break-word"
  },
  chatSender: {
    fontSize: 11,
    color: "#1F5D3B",
    fontWeight: 600
  },
  chatText: {
    fontSize: 13,
    color: "#2C2C2A"
  },
  chatTime: {
    fontSize: 10,
    color: "#8A8471",
    alignSelf: "flex-end"
  },
  chatInputRow: {
    padding: "8px 12px",
    borderTop: "1px solid #E4DBC4",
    display: "flex",
    gap: 8,
    flexShrink: 0
  }
};

// Inject keyframe animation for chat
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(styleSheet);
