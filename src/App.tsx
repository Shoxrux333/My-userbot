import React, { useState, useEffect, useRef } from "react";
import { 
  Terminal, 
  Settings, 
  Activity, 
  Database, 
  RefreshCw, 
  UserCheck, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  MessageSquare, 
  Cpu, 
  FileText,
  Eye,
  EyeOff,
  Play,
  Square,
  Save,
  Check,
  Trash2,
  Search,
  User,
  Plus,
  ShieldAlert,
  UserX,
  Users,
  Brain,
  Sparkles,
  Send
} from "lucide-react";

interface LogLine {
  text: string;
}

interface BotConfig {
  BOT_TOKEN: string;
  AI_API_KEY: string;
  OWNER_ID: string;
  AI_BASE_URL: string;
  AI_MODEL: string;
  isTokenSet: boolean;
  isAiKeySet: boolean;
  isOwnerSet: boolean;
}

interface BotStatus {
  status: string;
  shouldBeRunning: boolean;
  config: BotConfig;
}

interface BotStats {
  users: number;
  messages: number;
  memory: number;
  ai: number;
}

export default function App() {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [stats, setStats] = useState<BotStats>({ users: 0, messages: 0, memory: 0, ai: 0 });
  const [isRestarting, setIsRestarting] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Filter settings state
  const [blacklistEnabled, setBlacklistEnabled] = useState(false);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [newBlockedId, setNewBlockedId] = useState("");
  const [groupFilterEnabled, setGroupFilterEnabled] = useState(false);
  const [allowedGroupIds, setAllowedGroupIds] = useState<string[]>([]);
  const [newAllowedGroupId, setNewAllowedGroupId] = useState("");
  const [isSavingFilter, setIsSavingFilter] = useState(false);
  const [filterMessage, setFilterMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // AI-based ID filtering states
  const [rawFilterText, setRawFilterText] = useState("");
  const [isParsingIds, setIsParsingIds] = useState(false);
  const [parsedIdsResult, setParsedIdsResult] = useState<{
    blacklisted_ids: string[];
    whitelisted_group_ids: string[];
    unspecified_ids: string[];
  } | null>(null);
  const [aiFilterMessage, setAiFilterMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [unspecifiedDestination, setUnspecifiedDestination] = useState<Record<string, "blacklist" | "whitelist" | "ignore">>({});

  // Form inputs state
  const [botToken, setBotToken] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [showTokens, setShowTokens] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Userbot State Variables
  const [userbotStatus, setUserbotStatus] = useState<any>(null);
  const [userbotPhone, setUserbotPhone] = useState("");
  const [userbotApiId, setUserbotApiId] = useState("");
  const [userbotApiHash, setUserbotApiHash] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [userbotLoading, setUserbotLoading] = useState(false);
  const [userbotMessage, setUserbotMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchUserbotStatus = async () => {
    try {
      const res = await fetch("/api/userbot/status");
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        setUserbotStatus(data);
      }
    } catch (e) {
      console.error("Failed to fetch userbot status:", e);
    }
  };

  const fetchFilterSettings = async () => {
    try {
      const res = await fetch("/api/filter-settings");
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        setBlacklistEnabled(data.blacklist_enabled ?? false);
        setBlockedIds(data.blocked_ids ?? []);
        setGroupFilterEnabled(data.group_filter_enabled ?? false);
        setAllowedGroupIds(data.allowed_group_ids ?? []);
      }
    } catch (e) {
      console.error("Failed to fetch filter settings:", e);
    }
  };

  const saveFilterSettings = async (
    blEnabled: boolean,
    blIds: string[],
    grpEnabled: boolean,
    grpIds: string[]
  ) => {
    setIsSavingFilter(true);
    setFilterMessage(null);
    try {
      const res = await fetch("/api/filter-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blacklist_enabled: blEnabled,
          blocked_ids: blIds,
          group_filter_enabled: grpEnabled,
          allowed_group_ids: grpIds
        })
      });
      if (res.ok) {
        setFilterMessage({ type: "success", text: "Filtr sozlamalari muvaffaqiyatli saqlandi!" });
        setTimeout(() => setFilterMessage(null), 3000);
      } else {
        const data = await res.json();
        setFilterMessage({ type: "error", text: data.error || "Xatolik yuz berdi." });
      }
    } catch (err) {
      setFilterMessage({ type: "error", text: "Server bilan aloqa xatosi." });
    } finally {
      setIsSavingFilter(false);
    }
  };

  const handleAddBlockedId = (e: React.FormEvent) => {
    e.preventDefault();
    const idToAdd = newBlockedId.trim();
    if (!idToAdd) return;
    if (blockedIds.includes(idToAdd)) {
      setFilterMessage({ type: "error", text: "Ushbu ID allaqachon taqiqlanganlar ro'yxatida bor." });
      return;
    }
    if (!/^-?\d+$/.test(idToAdd)) {
      setFilterMessage({ type: "error", text: "Telegram ID faqat raqamlardan iborat bo'lishi kerak." });
      return;
    }
    const updatedIds = [...blockedIds, idToAdd];
    setBlockedIds(updatedIds);
    setNewBlockedId("");
    saveFilterSettings(blacklistEnabled, updatedIds, groupFilterEnabled, allowedGroupIds);
  };

  const handleDeleteBlockedId = (idToRemove: string) => {
    const updatedIds = blockedIds.filter(id => id !== idToRemove);
    setBlockedIds(updatedIds);
    saveFilterSettings(blacklistEnabled, updatedIds, groupFilterEnabled, allowedGroupIds);
  };

  const handleAddAllowedGroupId = (e: React.FormEvent) => {
    e.preventDefault();
    const idToAdd = newAllowedGroupId.trim();
    if (!idToAdd) return;
    if (allowedGroupIds.includes(idToAdd)) {
      setFilterMessage({ type: "error", text: "Ushbu guruh IDsi allaqachon ro'yxatda bor." });
      return;
    }
    if (!/^-?\d+$/.test(idToAdd)) {
      setFilterMessage({ type: "error", text: "Guruh ID raqami faqat raqamlardan iborat bo'ladi." });
      return;
    }
    const updatedIds = [...allowedGroupIds, idToAdd];
    setAllowedGroupIds(updatedIds);
    setNewAllowedGroupId("");
    saveFilterSettings(blacklistEnabled, blockedIds, groupFilterEnabled, updatedIds);
  };

  const handleDeleteAllowedGroupId = (idToRemove: string) => {
    const updatedIds = allowedGroupIds.filter(id => id !== idToRemove);
    setAllowedGroupIds(updatedIds);
    saveFilterSettings(blacklistEnabled, blockedIds, groupFilterEnabled, updatedIds);
  };

  const handleToggleBlacklist = (checked: boolean) => {
    setBlacklistEnabled(checked);
    saveFilterSettings(checked, blockedIds, groupFilterEnabled, allowedGroupIds);
  };

  const handleToggleGroupFilter = (checked: boolean) => {
    setGroupFilterEnabled(checked);
    saveFilterSettings(blacklistEnabled, blockedIds, checked, allowedGroupIds);
  };

  const handleAiParseIds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawFilterText.trim()) return;

    setIsParsingIds(true);
    setAiFilterMessage(null);
    setParsedIdsResult(null);
    setUnspecifiedDestination({});
    try {
      const res = await fetch("/api/gemini/parse-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: rawFilterText })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const total = data.blacklisted_ids.length + data.whitelisted_group_ids.length + data.unspecified_ids.length;
        if (total === 0) {
          setAiFilterMessage({ type: "error", text: "AI matndan hech qanday Telegram ID topa olmadi." });
        } else {
          setParsedIdsResult(data);
          // Pre-populate unspecified destination
          const initialDest: Record<string, "blacklist" | "whitelist" | "ignore"> = {};
          data.unspecified_ids.forEach((id: string) => {
            initialDest[id] = "blacklist"; // default to blacklist
          });
          setUnspecifiedDestination(initialDest);
          setAiFilterMessage({ type: "success", text: `AI jami ${total} ta ID topdi!` });
        }
      } else {
        setAiFilterMessage({ type: "error", text: data.error || "AI IDlarni ajratishda xatolik yuz berdi." });
      }
    } catch (err) {
      setAiFilterMessage({ type: "error", text: "Server bilan bog'lanishda xatolik." });
    } finally {
      setIsParsingIds(false);
    }
  };

  const handleApplyAiIds = () => {
    if (!parsedIdsResult) return;

    // Build lists of IDs to add
    const blacklistToAdd = [...parsedIdsResult.blacklisted_ids];
    const whitelistToAdd = [...parsedIdsResult.whitelisted_group_ids];

    // Distribute unspecified IDs based on user selection
    Object.entries(unspecifiedDestination).forEach(([id, dest]) => {
      if (dest === "blacklist") {
        blacklistToAdd.push(id);
      } else if (dest === "whitelist") {
        whitelistToAdd.push(id);
      }
    });

    // Merge with existing IDs, avoiding duplicates
    const uniqueBlacklist = Array.from(new Set([...blockedIds, ...blacklistToAdd]));
    const uniqueWhitelist = Array.from(new Set([...allowedGroupIds, ...whitelistToAdd]));

    setBlockedIds(uniqueBlacklist);
    setAllowedGroupIds(uniqueWhitelist);
    
    // Save to server
    saveFilterSettings(blacklistEnabled, uniqueBlacklist, groupFilterEnabled, uniqueWhitelist);
    
    // Clear and success message
    setParsedIdsResult(null);
    setRawFilterText("");
    setAiFilterMessage({ type: "success", text: "AI tomonidan ajratilgan IDlar muvaffaqiyatli qo'shildi va saqlandi!" });
    setTimeout(() => setAiFilterMessage(null), 5000);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userbotPhone || !userbotApiId || !userbotApiHash) {
      setUserbotMessage({ type: "error", text: "API ID, API Hash va Telefon raqami majburiy!" });
      return;
    }
    setUserbotLoading(true);
    setUserbotMessage(null);
    try {
      const res = await fetch("/api/userbot/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_id: userbotApiId,
          api_hash: userbotApiHash,
          phone: userbotPhone
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCodeSent(true);
        setUserbotMessage({ type: "success", text: data.message });
      } else {
        setUserbotMessage({ type: "error", text: data.error || "Kodni yuborishda xatolik yuz berdi." });
      }
    } catch (err) {
      setUserbotMessage({ type: "error", text: "Serverga ulanishda xatolik yuz berdi." });
    } finally {
      setUserbotLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode) {
      setUserbotMessage({ type: "error", text: "Tasdiqlash kodi kiritilishi shart!" });
      return;
    }
    setUserbotLoading(true);
    setUserbotMessage(null);
    try {
      const res = await fetch("/api/userbot/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: verificationCode,
          password: twoFactorPassword
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCodeSent(false);
        setVerificationCode("");
        setTwoFactorPassword("");
        setUserbotMessage({ type: "success", text: data.message });
        fetchUserbotStatus();
        fetchBotData();
      } else {
        setUserbotMessage({ type: "error", text: data.error || "Kodni tasdiqlashda xatolik yuz berdi." });
      }
    } catch (err) {
      setUserbotMessage({ type: "error", text: "Serverga ulanishda xatolik." });
    } finally {
      setUserbotLoading(false);
    }
  };

  const handleUserbotLogout = async () => {
    if (!confirm("Haqiqatan ham userbot hisobidan chiqmoqchimisiz?")) return;
    setUserbotLoading(true);
    setUserbotMessage(null);
    try {
      const res = await fetch("/api/userbot/logout", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setUserbotStatus(null);
        setUserbotMessage({ type: "success", text: data.message });
        fetchUserbotStatus();
        fetchBotData();
      } else {
        setUserbotMessage({ type: "error", text: data.error || "Hisobdan chiqishda xatolik." });
      }
    } catch (err) {
      setUserbotMessage({ type: "error", text: "Serverga ulanishda xatolik." });
    } finally {
      setUserbotLoading(false);
    }
  };

  // System Prompt State
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);

  // SQLite Database States
  const [dbUsers, setDbUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [dbMessages, setDbMessages] = useState<any[]>([]);
  const [dbMemories, setDbMemories] = useState<any[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMemories, setIsLoadingMemories] = useState(false);
  
  // Memory Form States
  const [memorySearch, setMemorySearch] = useState("");
  const [newMemory, setNewMemory] = useState({ category: "", key: "", value: "" });
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Aqlli Xotira (Smart Memory) states
  const [memoryMode, setMemoryMode] = useState<"quick" | "chat">("quick"); // 'quick' or 'chat'
  const [quickInputType, setQuickInputType] = useState<"ai" | "manual">("ai"); // 'ai' or 'manual'
  const [rawQuickText, setRawQuickText] = useState("");
  const [isOptimizingMemory, setIsOptimizingMemory] = useState(false);
  
  // Memory AI Chat states
  const [memoryChatInput, setMemoryChatInput] = useState("");
  const [memoryChatHistory, setMemoryChatHistory] = useState<Array<{ role: "user" | "assistant"; content: string; newMemory?: any }>>([
    { role: "assistant", content: "Salom! Men sizning shaxsiy xotira yordamchingizman. Menga o'zingiz haqizda biror ma'lumot ayting (masalan: 'Men ingliz tilini o'rganyapman' yoki 'Dushanba kunlari soat 10da darsim bor'), men uni avtomatik tahrirlab bot xotirasiga yozib qo'yaman." }
  ]);
  const [isSendingMemoryChat, setIsSendingMemoryChat] = useState(false);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const hasPrefilled = useRef(false);

  const hasConflict = logs.some(log => log.includes("Conflict") || log.includes("TelegramConflictError"));

  // Fetch bot status, logs, and database stats
  const fetchBotData = async () => {
    // Fetch status
    try {
      const statusRes = await fetch("/api/bot-status");
      if (statusRes.ok && statusRes.headers.get("content-type")?.includes("application/json")) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }
    } catch (e) {
      console.error("Failed to fetch bot status:", e);
    }

    // Fetch logs
    try {
      const logsRes = await fetch("/api/bot-logs");
      if (logsRes.ok && logsRes.headers.get("content-type")?.includes("application/json")) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
      }
    } catch (e) {
      console.error("Failed to fetch bot logs:", e);
    }

    // Fetch stats
    try {
      const statsRes = await fetch("/api/bot-stats");
      if (statsRes.ok && statsRes.headers.get("content-type")?.includes("application/json")) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (e) {
      console.error("Failed to fetch bot stats:", e);
    }
  };

  const fetchSystemPrompt = async () => {
    if (isEditingPrompt) return;
    try {
      const res = await fetch("/api/system-prompt");
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (!isEditingPrompt) {
          setSystemPrompt(data.prompt || "");
        }
      }
    } catch (e) {
      console.error("Failed to fetch system prompt:", e);
    }
  };

  const fetchDbUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await fetch("/api/db/users");
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (data.success) {
          setDbUsers(data.users || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch database users:", e);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const fetchDbMessages = async (userId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/db/messages/${userId}`);
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (data.success) {
          setDbMessages(data.messages || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch messages for user:", e);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const fetchDbMemories = async () => {
    setIsLoadingMemories(true);
    try {
      const res = await fetch("/api/db/memories");
      if (res.ok && res.headers.get("content-type")?.includes("application/json")) {
        const data = await res.json();
        if (data.success) {
          setDbMemories(data.memories || []);
        }
      }
    } catch (e) {
      console.error("Failed to fetch database memories:", e);
    } finally {
      setIsLoadingMemories(false);
    }
  };

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemory.category || !newMemory.key || !newMemory.value) return;
    setIsAddingMemory(true);
    setMemoryMessage(null);
    try {
      const res = await fetch("/api/db/memories/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMemory)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMemoryMessage({ type: "success", text: "Yangi xotira muvaffaqiyatli qo'shildi!" });
          setNewMemory({ category: "", key: "", value: "" });
          fetchDbMemories();
          fetchBotData(); // refresh counts
          setTimeout(() => setMemoryMessage(null), 4000);
        } else {
          setMemoryMessage({ type: "error", text: data.error || "Xatolik yuz berdi." });
        }
      }
    } catch (err) {
      setMemoryMessage({ type: "error", text: "Server bilan aloqa bog'lab bo'lmadi." });
    } finally {
      setIsAddingMemory(false);
    }
  };

  const handleQuickAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawQuickText.trim()) return;

    setIsOptimizingMemory(true);
    setMemoryMessage(null);
    try {
      const res = await fetch("/api/gemini/memory-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: rawQuickText })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMemoryMessage({
          type: "success",
          text: `AI ma'lumotni saqladi: [${data.category.toUpperCase()}] ${data.key} -> ${data.value}`
        });
        setRawQuickText("");
        fetchDbMemories();
        fetchBotData();
        setTimeout(() => setMemoryMessage(null), 5000);
      } else {
        setMemoryMessage({ type: "error", text: data.error || "AI optimizatsiyasida xatolik yuz berdi. API Key to'g'ri ekanligini tekshiring." });
      }
    } catch (err) {
      setMemoryMessage({ type: "error", text: "Server bilan bog'lanishda xatolik." });
    } finally {
      setIsOptimizingMemory(false);
    }
  };

  const handleMemoryChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memoryChatInput.trim() || isSendingMemoryChat) return;

    const userMsg = memoryChatInput.trim();
    setMemoryChatInput("");

    const updatedHistory = [...memoryChatHistory, { role: "user" as const, content: userMsg }];
    setMemoryChatHistory(updatedHistory);
    setIsSendingMemoryChat(true);

    try {
      const res = await fetch("/api/gemini/memory-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: updatedHistory.slice(-6)
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMemoryChatHistory(prev => [
          ...prev,
          {
            role: "assistant" as const,
            content: data.reply,
            newMemory: data.newMemory
          }
        ]);
        if (data.newMemory) {
          fetchDbMemories();
          fetchBotData();
        }
      } else {
        setMemoryChatHistory(prev => [
          ...prev,
          { role: "assistant" as const, content: `Xatolik: ${data.error || "AI javob bera olmadi. API kalitini tekshiring."}` }
        ]);
      }
    } catch (err) {
      setMemoryChatHistory(prev => [
        ...prev,
        { role: "assistant" as const, content: "Server bilan bog'lanishda xatolik." }
      ]);
    } finally {
      setIsSendingMemoryChat(false);
    }
  };

  const handleDeleteMemory = async (id: number) => {
    if (!confirm("Ushbu ma'lumotni xotiradan butunlay o'chirmoqchimisiz?")) return;
    try {
      const res = await fetch(`/api/db/memories/delete/${id}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          fetchDbMemories();
          fetchBotData(); // refresh counts
        }
      }
    } catch (e) {
      console.error("Failed to delete memory:", e);
    }
  };

  useEffect(() => {
    fetchBotData();
    fetchUserbotStatus();
    fetchSystemPrompt();
    fetchDbUsers();
    fetchDbMemories();
    fetchFilterSettings();
    const interval = setInterval(() => {
      fetchBotData();
      fetchUserbotStatus();
    }, 2500);

    // Also poll prompt occasionally in case the AI modifies it in the background!
    const promptInterval = setInterval(fetchSystemPrompt, 6000);

    // Also poll database state less frequently
    const dbInterval = setInterval(() => {
      fetchDbUsers();
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(promptInterval);
      clearInterval(dbInterval);
    };
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchDbMessages(selectedUserId);
    }
  }, [selectedUserId]);


  // Prefill configuration inputs once when status is loaded
  useEffect(() => {
    if (status && status.config && !hasPrefilled.current) {
      setBotToken(status.config.BOT_TOKEN || "");
      setAiApiKey(status.config.AI_API_KEY || "");
      setOwnerId(status.config.OWNER_ID || "");
      setAiBaseUrl(status.config.AI_BASE_URL || "https://api.openai.com/v1");
      setAiModel(status.config.AI_MODEL || "gpt-4o-mini");
      setUserbotApiId(status.config.TELEGRAM_API_ID || "");
      setUserbotApiHash(status.config.TELEGRAM_API_HASH || "");
      setUserbotPhone(status.config.TELEGRAM_PHONE || "");
      hasPrefilled.current = true;
    }
  }, [status]);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      const res = await fetch("/api/bot-restart", { method: "POST" });
      if (res.ok) {
        setTimeout(() => {
          setIsRestarting(false);
          fetchBotData();
        }, 1500);
      }
    } catch (e) {
      console.error("Failed to restart bot:", e);
      setIsRestarting(false);
    }
  };

  const handleStartBot = async () => {
    try {
      const res = await fetch("/api/bot-start", { method: "POST" });
      if (res.ok) {
        fetchBotData();
      }
    } catch (e) {
      console.error("Failed to start bot:", e);
    }
  };

  const handleStopBot = async () => {
    try {
      const res = await fetch("/api/bot-stop", { method: "POST" });
      if (res.ok) {
        fetchBotData();
      }
    } catch (e) {
      console.error("Failed to stop bot:", e);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/bot-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BOT_TOKEN: botToken,
          AI_API_KEY: aiApiKey,
          OWNER_ID: ownerId,
          AI_BASE_URL: aiBaseUrl,
          AI_MODEL: aiModel
        })
      });
      if (res.ok) {
        setSaveMessage({ type: "success", text: "Sozlamalar muvaffaqiyatli saqlandi va bot qayta yuklandi!" });
        fetchBotData();
        // Hide success message after 4 seconds
        setTimeout(() => setSaveMessage(null), 4000);
      } else {
        const data = await res.json();
        setSaveMessage({ type: "error", text: data.error || "Saqlashda xatolik yuz berdi." });
      }
    } catch (err: any) {
      setSaveMessage({ type: "error", text: "Server bilan aloqa bog'lab bo'lmadi." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingPrompt(true);
    setPromptMessage(null);
    try {
      const res = await fetch("/api/system-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: systemPrompt })
      });
      if (res.ok) {
        setPromptMessage({ type: "success", text: "Tizim ko'rsatmalari (System Prompt) muvaffaqiyatli saqlandi!" });
        setIsEditingPrompt(false);
        setTimeout(() => setPromptMessage(null), 4000);
      } else {
        const data = await res.json();
        setPromptMessage({ type: "error", text: data.error || "Saqlashda xatolik yuz berdi." });
      }
    } catch (err: any) {
      setPromptMessage({ type: "error", text: "Server bilan aloqa bog'lab bo'lmadi." });
    } finally {
      setIsSavingPrompt(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#333333] font-sans antialiased">
      {/* Top Banner & Header */}
      <header className="border-b border-[#EBEAE6] bg-[#FCFBF9] sticky top-0 z-10 px-6 py-4 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-[#4B5E53] rounded-md text-white">
                <Cpu className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-semibold tracking-tight text-[#222222]">Shoxrux's Personal AI representative</h1>
            </div>
            <p className="text-sm text-[#777777] mt-1">Telegram bot developer console and activity log stream</p>
          </div>

          <div className="flex items-center gap-3">
            {userbotStatus?.logged_in ? (
              <>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Userbot Faol (Ulandi)
                </span>
                <button
                  onClick={handleUserbotLogout}
                  disabled={userbotLoading}
                  className="inline-flex items-center gap-1 py-1.5 px-3 rounded-md text-xs font-semibold uppercase tracking-wider bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 transition cursor-pointer"
                >
                  Hisobdan Chiqish
                </button>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  Userbot Faol Emas
                </span>
              </>
            )}

            <button
              onClick={handleRestart}
              disabled={isRestarting}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                isRestarting 
                  ? "bg-stone-100 text-stone-400 cursor-not-allowed" 
                  : "bg-white border border-[#D0CFC9] hover:bg-[#FAF9F6] hover:border-[#B5B4AE] text-[#333333]"
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isRestarting ? "animate-spin" : ""}`} />
              Botni Qayta Yuklash
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        
        {/* Environment Alert if Token Missing */}
        {status && !status.config.isUserbotSet && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-amber-900">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm text-amber-950">Telegram Userbot Sozlanmagan!</h3>
              <p className="text-xs text-amber-800 mt-1">
                Loyiha Userbot (shaxsiy Telegram akkaunt) rejimiga o'tkazildi. Uning ishlashi uchun **Telegram API ID**, **API Hash** va o'zingizning **Telefon raqamingiz** kerak bo'ladi.
                Iltimos, quyidagi panelda ushbu ma'lumotlarni kiriting va tasdiqlang.
              </p>
            </div>
          </div>
        )}

        {/* Telegram Conflict Warning */}
        {hasConflict && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex gap-3 text-rose-900">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-sm text-rose-950">Diqqat! Telegram Bot Konflikti aniqlandi (TelegramConflictError)</h3>
              <p className="text-xs text-rose-800 mt-1">
                Ushbu bot xuddi shu token bilan boshqa joyda ham faol ishlayapti (masalan, Shared URL, localhost yoki boshqa hosting/serverda). 
                Telegram bir vaqtning o'zida faqat bitta faol "Polling" ulanishni qo'llab-quvvatlaydi. 
              </p>
              <p className="text-xs text-rose-800 mt-2 font-medium">
                Muammoni bartaraf etish uchun:
              </p>
              <ul className="list-disc pl-5 text-xs text-rose-800 mt-1 space-y-1">
                <li>Boshqa joyda ochiq bo'lgan ushbu botning barcha oynalari yoki dasturlarini to'liq yoping.</li>
                <li>Agar Shared URL (Production) ishlayotgan bo'lsa, ushbu Dev oynasidagi yoki Shared oynasidagi botlardan birini yuqoridagi <strong>"Botni To'xtatish"</strong> tugmasi orqali vaqtincha to'xtatib turing.</li>
                <li>Hamma joyni tozalagach, yuqoridagi <strong>"Botni Qayta Yuklash"</strong> tugmasini bosing.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Database Statistics Cards */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-[#EBEAE6] p-4 rounded-xl flex items-center gap-4">
            <div className="p-3 bg-stone-50 rounded-lg text-stone-600">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-[#777777] font-medium uppercase tracking-wider">A'zolar</p>
              <h4 className="text-2xl font-bold tracking-tight mt-0.5">{stats.users}</h4>
            </div>
          </div>

          <div className="bg-white border border-[#EBEAE6] p-4 rounded-xl flex items-center gap-4">
            <div className="p-3 bg-stone-50 rounded-lg text-stone-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-[#777777] font-medium uppercase tracking-wider">Jami Xabarlar</p>
              <h4 className="text-2xl font-bold tracking-tight mt-0.5">{stats.messages}</h4>
            </div>
          </div>

          <div className="bg-white border border-[#EBEAE6] p-4 rounded-xl flex items-center gap-4">
            <div className="p-3 bg-stone-50 rounded-lg text-stone-600">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-[#777777] font-medium uppercase tracking-wider">Xotiralar (Memory)</p>
              <h4 className="text-2xl font-bold tracking-tight mt-0.5">{stats.memory}</h4>
            </div>
          </div>

          <div className="bg-white border border-[#EBEAE6] p-4 rounded-xl flex items-center gap-4">
            <div className="p-3 bg-stone-50 rounded-lg text-stone-600">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs text-[#777777] font-medium uppercase tracking-wider">AI Javoblar</p>
              <h4 className="text-2xl font-bold tracking-tight mt-0.5">{stats.ai}</h4>
            </div>
          </div>
        </section>

        {/* Main Work Space */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left panel - Configurations and guide */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Status & Config Form Panel */}
            <div className="bg-white border border-[#EBEAE6] rounded-xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-[#EBEAE6] flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2 text-[#222222]">
                  <Settings className="w-4 h-4 text-[#4B5E53]" />
                  Userbot Sozlash va Ulanish
                </h3>
                <span className="text-[10px] bg-[#4B5E53] px-2 py-0.5 rounded-full text-white font-mono font-medium">TELETHON</span>
              </div>
              
              <div className="p-5 space-y-5">
                
                {/* Userbot status notification */}
                {userbotMessage && (
                  <div className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
                    userbotMessage.type === "success" 
                      ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                      : "bg-rose-50 text-rose-800 border-rose-100"
                  }`}>
                    {userbotMessage.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
                    <span>{userbotMessage.text}</span>
                  </div>
                )}

                {userbotStatus?.logged_in ? (
                  /* Authorised state details */
                  <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#4B5E53] text-white flex items-center justify-center font-bold text-sm shrink-0">
                        {userbotStatus.me?.first_name ? userbotStatus.me.first_name[0].toUpperCase() : "U"}
                      </div>
                      <div className="truncate">
                        <h4 className="text-sm font-semibold text-stone-900 truncate">
                          {userbotStatus.me?.first_name} {userbotStatus.me?.last_name || ""}
                        </h4>
                        <p className="text-xs text-stone-500 truncate">
                          {userbotStatus.me?.username ? `@${userbotStatus.me.username}` : `ID: ${userbotStatus.me?.id}`}
                        </p>
                      </div>
                    </div>
                    
                    <div className="pt-2 border-t border-stone-200 text-xs text-stone-600 space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-stone-400">Telefon:</span>
                        <span className="font-medium">{userbotStatus.me?.phone || userbotStatus.phone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-400">Telegram API ID:</span>
                        <span className="font-mono">{userbotStatus.api_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-400">Holat:</span>
                        <span className="text-emerald-600 font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Faol va Ulanilgan
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleUserbotLogout}
                      disabled={userbotLoading}
                      className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-rose-200 hover:bg-rose-50 text-rose-700 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Tizimdan Chiqish (Logout)
                    </button>
                  </div>
                ) : (
                  /* Interactive connection forms */
                  <div className="space-y-4">
                    {!codeSent ? (
                      /* Step 1: Request code */
                      <form onSubmit={handleSendCode} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                            Telegram API ID <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={userbotApiId}
                            onChange={(e) => setUserbotApiId(e.target.value)}
                            placeholder="Masalan: 1234567"
                            className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                            Telegram API Hash <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={userbotApiHash}
                            onChange={(e) => setUserbotApiHash(e.target.value)}
                            placeholder="Masalan: abc123def456..."
                            className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                            Telefon Raqamingiz <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={userbotPhone}
                            onChange={(e) => setUserbotPhone(e.target.value)}
                            placeholder="Masalan: +998901234567"
                            className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                            required
                          />
                          <p className="text-[10px] text-stone-500">Xalqaro formatda kiriting, boshida '+' belgisi bilan</p>
                        </div>

                        <button
                          type="submit"
                          disabled={userbotLoading}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-xs font-semibold uppercase tracking-wider text-white transition-all bg-[#4B5E53] hover:bg-[#3d4d44] shadow-xs cursor-pointer"
                        >
                          {userbotLoading ? "Ulanmoqda..." : "Kodni Yuborish (Send Code)"}
                        </button>
                      </form>
                    ) : (
                      /* Step 2: Verify code & 2FA */
                      <form onSubmit={handleVerifyCode} className="space-y-4 bg-stone-50 border border-stone-200 rounded-lg p-4">
                        <div className="text-xs font-semibold text-stone-700 uppercase tracking-wider">Kodni tasdiqlash</div>
                        <p className="text-[11px] text-stone-500 leading-normal">
                          {userbotPhone} raqamiga Telegram orqali yuborilgan 5 xonali tasdiqlash kodini kiriting.
                        </p>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                            Tasdiqlash Kodi <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value)}
                            placeholder="Masalan: 12345"
                            className="w-full text-center tracking-widest text-sm font-bold font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                            maxLength={5}
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                            2FA Parol (agar o'rnatilgan bo'lsa)
                          </label>
                          <input
                            type="password"
                            value={twoFactorPassword}
                            onChange={(e) => setTwoFactorPassword(e.target.value)}
                            placeholder="Ikki bosqichli parol"
                            className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                          />
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setCodeSent(false)}
                            className="flex-1 py-2 px-3 border border-stone-300 hover:bg-stone-100 rounded text-stone-700 text-xs font-medium transition cursor-pointer"
                          >
                            Orqaga
                          </button>
                          <button
                            type="submit"
                            disabled={userbotLoading}
                            className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 rounded text-white text-xs font-semibold uppercase tracking-wider transition cursor-pointer"
                          >
                            {userbotLoading ? "Tasdiqlanmoqda..." : "Tasdiqlash"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* AI Configuration Section */}
                <form onSubmit={handleSaveConfig} className="space-y-4 pt-4 border-t border-stone-200">
                  <div className="text-xs font-bold text-stone-800 uppercase tracking-wider">AI Sozlamalari</div>
                  
                  {/* Save message notification */}
                  {saveMessage && (
                    <div className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
                      saveMessage.type === "success" 
                        ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                        : "bg-rose-50 text-rose-800 border-rose-100"
                    }`}>
                      {saveMessage.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
                      <span>{saveMessage.text}</span>
                    </div>
                  )}

                  {/* AI_API_KEY Input */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                      AI API Key (DeepSeek, OpenAI, etc.) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showTokens ? "text" : "password"}
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="Masalan: sk-..."
                        className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] pr-10 bg-white"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowTokens(!showTokens)}
                        className="absolute right-3 top-2 text-[#777777] hover:text-[#333333]"
                      >
                        {showTokens ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* AI_BASE_URL Input */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                      AI Base URL
                    </label>
                    <input
                      type="text"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                    />
                  </div>

                  {/* AI_MODEL Input */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[#555555] uppercase tracking-wider">
                      AI Model Nomi
                    </label>
                    <input
                      type="text"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all bg-[#4B5E53] hover:bg-[#3d4d44] text-white shadow-xs cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? "Saqlanmoqda..." : "AI Sozlamalarini Saqlash"}
                  </button>
                </form>

              </div>
            </div>

            {/* Muloqot Filtrllari (Access & Chat Filters) */}
            <div className="bg-white border border-[#EBEAE6] rounded-xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-[#EBEAE6] flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2 text-[#222222]">
                  <ShieldAlert className="w-4 h-4 text-[#4B5E53]" />
                  Muloqot Filtrllari (Chat Filters)
                </h3>
                <span className="text-[10px] bg-stone-100 px-2 py-0.5 rounded-full text-stone-600 font-mono font-medium">SECURITY</span>
              </div>
              
              <div className="p-5 space-y-6">
                <p className="text-xs text-[#555555] leading-relaxed">
                  Ushbu sozlamalar orqali botingiz kimlar bilan muloqot qilishi va qaysi guruhlarda ishlashini to'liq nazorat qila olasiz.
                </p>

                {filterMessage && (
                  <div className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
                    filterMessage.type === "success" 
                      ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                      : "bg-rose-50 text-rose-800 border-rose-100"
                  }`}>
                    {filterMessage.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
                    <span>{filterMessage.text}</span>
                  </div>
                )}

                {/* FILTR 1: TAQIQLANGAN ID-LAR (BLACKLIST) */}
                <div className="border border-stone-200 rounded-lg p-4 space-y-3.5 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                        <UserX className="w-3.5 h-3.5 text-rose-600" />
                        Taqiqlangan ID-lar (Blacklist)
                      </h4>
                      <p className="text-[10px] text-stone-500">Ushbu ro'yxatdagi foydalanuvchi yoki guruhlarga bot mutlaqo javob bermaydi.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={blacklistEnabled}
                        onChange={(e) => handleToggleBlacklist(e.target.checked)}
                      />
                      <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600"></div>
                    </label>
                  </div>

                  {blacklistEnabled && (
                    <div className="space-y-3 pt-2 border-t border-stone-100">
                      {/* Form to add a blocked ID */}
                      <form onSubmit={handleAddBlockedId} className="flex gap-2">
                        <input
                          type="text"
                          value={newBlockedId}
                          onChange={(e) => setNewBlockedId(e.target.value)}
                          placeholder="Foydalanuvchi yoki Guruh ID (masalan: 1234567)"
                          className="flex-1 text-xs font-mono px-3 py-1.5 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 bg-white"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-all cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Bloklash
                        </button>
                      </form>

                      {/* List of blacklisted IDs */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                          Taqiqlangan ID raqamlar ({blockedIds.length})
                        </div>
                        {blockedIds.length === 0 ? (
                          <div className="p-2.5 text-center text-xs text-stone-400 italic border border-dashed border-stone-200 rounded-lg">
                            Hozircha taqiqlangan IDlar yo'q.
                          </div>
                        ) : (
                          <div className="border border-stone-200 rounded-lg max-h-32 overflow-y-auto divide-y divide-stone-100 bg-white">
                            {blockedIds.map((id) => (
                              <div key={id} className="p-2 text-xs flex items-center justify-between font-mono text-stone-700 hover:bg-stone-50">
                                <span className="flex items-center gap-1.5 text-rose-700">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
                                  {id}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteBlockedId(id)}
                                  className="text-stone-400 hover:text-rose-600 p-1 rounded hover:bg-stone-100 transition cursor-pointer"
                                  title="O'chirish"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* FILTR 2: RUXSAT ETILGAN GURUHLAR (GROUP WHITELIST) */}
                <div className="border border-stone-200 rounded-lg p-4 space-y-3.5 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-[#4B5E53]" />
                        Guruhlar uchun Filtr (Group Whitelist)
                      </h4>
                      <p className="text-[10px] text-stone-500">Bot faqat shu ro'yxatdagi ruxsat etilgan guruhlarda javob beradi.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={groupFilterEnabled}
                        onChange={(e) => handleToggleGroupFilter(e.target.checked)}
                      />
                      <div className="w-9 h-5 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4B5E53]"></div>
                    </label>
                  </div>

                  <div className="p-2.5 bg-stone-100/80 border border-stone-200 rounded-md text-[10px] text-stone-600 leading-normal">
                    {groupFilterEnabled 
                      ? "⚠️ Guruhlar filtri yoniq. Bot faqat quyida ko'rsatilgan guruhlarda ishlaydi (Shaxsiy suhbatlarga daxli yo'q)." 
                      : "ℹ️ Guruhlar filtri o'chiq. Bot hech qaysi guruhda muloqotga kirishmaydi (Faqat shaxsiy suhbatlarda ishlaydi)."}
                  </div>

                  {groupFilterEnabled && (
                    <div className="space-y-3 pt-2 border-t border-stone-100">
                      {/* Form to add an allowed group ID */}
                      <form onSubmit={handleAddAllowedGroupId} className="flex gap-2">
                        <input
                          type="text"
                          value={newAllowedGroupId}
                          onChange={(e) => setNewAllowedGroupId(e.target.value)}
                          placeholder="Guruh ID raqami (masalan: -1001234567)"
                          className="flex-1 text-xs font-mono px-3 py-1.5 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#4B5E53] hover:bg-[#3d4d44] text-white transition-all cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Ruxsat berish
                        </button>
                      </form>

                      {/* List of allowed Group IDs */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                          Ruxsat etilgan guruhlar ({allowedGroupIds.length})
                        </div>
                        {allowedGroupIds.length === 0 ? (
                          <div className="p-2.5 text-center text-xs text-stone-400 italic border border-dashed border-stone-200 rounded-lg">
                            Ruxsat berilgan guruhlar ro'yxati bo'sh.
                          </div>
                        ) : (
                          <div className="border border-stone-200 rounded-lg max-h-32 overflow-y-auto divide-y divide-stone-100 bg-white">
                            {allowedGroupIds.map((id) => (
                              <div key={id} className="p-2 text-xs flex items-center justify-between font-mono text-stone-700 hover:bg-stone-50">
                                <span className="flex items-center gap-1.5 text-emerald-800">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                                  {id}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteAllowedGroupId(id)}
                                  className="text-stone-400 hover:text-rose-600 p-1 rounded hover:bg-stone-100 transition cursor-pointer"
                                  title="O'chirish"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* FILTR 3: AI ORQALI ID-LARNI KIRITISH */}
                <div className="border border-stone-200 rounded-lg p-4 space-y-4 bg-stone-50/50">
                  <div>
                    <h4 className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#4B5E53]" />
                      AI Orqali ID-larni Oson Kiritish (AI ID Filter)
                    </h4>
                    <p className="text-[10px] text-stone-500 mt-0.5">
                      Matndan (masalan, guruh ro'yxatlari yoki xabarlardan) Telegram ID raqamlarini avtomatik ajratib olish va ro'yxatga qo'shish.
                    </p>
                  </div>

                  <form onSubmit={handleAiParseIds} className="space-y-3 pt-2 border-t border-stone-100">
                    <textarea
                      value={rawFilterText}
                      onChange={(e) => setRawFilterText(e.target.value)}
                      placeholder="Bu yerga matnni yoki ID ro'yxatini joylashtiring (masalan: 'Blokla -10012345 yozganlarni va 987654 ruxsat ber')"
                      rows={3}
                      className="w-full text-xs px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-white"
                    />

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isParsingIds || !rawFilterText.trim()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#4B5E53] hover:bg-[#3d4d44] text-white transition-all cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {isParsingIds ? "AI tahlil qilmoqda..." : "AI orqali ID-larni ajratish"}
                      </button>
                    </div>
                  </form>

                  {aiFilterMessage && (
                    <div className={`p-2.5 rounded-md text-xs flex items-center gap-2 border ${
                      aiFilterMessage.type === "success" 
                        ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                        : "bg-rose-50 text-rose-800 border-rose-100"
                    }`}>
                      {aiFilterMessage.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                      <span className="text-[11px]">{aiFilterMessage.text}</span>
                    </div>
                  )}

                  {/* Show parsed results and allow customization before applying */}
                  {parsedIdsResult && (
                    <div className="p-3 bg-white border border-stone-200 rounded-lg space-y-3.5">
                      <h5 className="text-[11px] font-bold text-stone-700 border-b border-stone-100 pb-1">AI tahlili natijalari:</h5>
                      
                      {/* Blacklist IDs parsed */}
                      {parsedIdsResult.blacklisted_ids.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-rose-700 uppercase tracking-wider block">Bloklanganlar ro'yxati uchun ({parsedIdsResult.blacklisted_ids.length}):</span>
                          <div className="flex flex-wrap gap-1">
                            {parsedIdsResult.blacklisted_ids.map(id => (
                              <span key={id} className="text-[10px] font-mono px-2 py-0.5 bg-rose-50 text-rose-700 rounded border border-rose-100">{id}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Whitelist Group IDs parsed */}
                      {parsedIdsResult.whitelisted_group_ids.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Ruxsat etilgan guruhlar uchun ({parsedIdsResult.whitelisted_group_ids.length}):</span>
                          <div className="flex flex-wrap gap-1">
                            {parsedIdsResult.whitelisted_group_ids.map(id => (
                              <span key={id} className="text-[10px] font-mono px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">{id}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Unspecified IDs parsed (User chooses destination) */}
                      {parsedIdsResult.unspecified_ids.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">Vazifasi aniqlanmagan ID-lar ({parsedIdsResult.unspecified_ids.length}):</span>
                          <div className="divide-y divide-stone-100 border border-stone-100 rounded bg-stone-50 max-h-36 overflow-y-auto">
                            {parsedIdsResult.unspecified_ids.map(id => (
                              <div key={id} className="p-1.5 flex items-center justify-between text-[11px] font-mono">
                                <span className="text-stone-700 font-medium">{id}</span>
                                <div className="flex gap-1.5">
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`dest-${id}`}
                                      checked={unspecifiedDestination[id] === "blacklist"}
                                      onChange={() => setUnspecifiedDestination(prev => ({ ...prev, [id]: "blacklist" }))}
                                      className="accent-rose-600 scale-90"
                                    />
                                    <span className="text-[10px] text-rose-700">Bloklash</span>
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`dest-${id}`}
                                      checked={unspecifiedDestination[id] === "whitelist"}
                                      onChange={() => setUnspecifiedDestination(prev => ({ ...prev, [id]: "whitelist" }))}
                                      className="accent-emerald-700 scale-90"
                                    />
                                    <span className="text-[10px] text-emerald-700">Ruxsat</span>
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="radio"
                                      name={`dest-${id}`}
                                      checked={unspecifiedDestination[id] === "ignore"}
                                      onChange={() => setUnspecifiedDestination(prev => ({ ...prev, [id]: "ignore" }))}
                                      className="accent-stone-500 scale-90"
                                    />
                                    <span className="text-[10px] text-stone-500">Tashlab ketish</span>
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="pt-2.5 border-t border-stone-100 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setParsedIdsResult(null)}
                          className="px-3 py-1.5 rounded-md text-xs font-semibold border border-stone-200 text-stone-600 hover:bg-stone-50 transition-all cursor-pointer"
                        >
                          Bekor qilish
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyAiIds}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-[#4B5E53] hover:bg-[#3d4d44] text-white transition-all cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          ID-larni Ro'yxatga Qo'shish
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-2.5 bg-stone-50 border border-stone-200 rounded-lg text-[10px] text-stone-500 leading-normal">
                  💡 <strong>Maslahat:</strong> Guruh ID raqamlari odatda <code>-100</code> bilan boshlanadigan 13 xonali sonlar bo'ladi (masalan: <code>-1002048921832</code>). Ushbu IDlarni bilish uchun botingiz guruhdan olgan xabarlari jurnali (Logs) dagi guruh ID raqamlaridan foydalanishingiz mumkin. Botingiz egasi har doim filtr cheklovlaridan ozod hisoblanadi.
                </div>
              </div>
            </div>

            {/* System Prompt Panel */}
            <div className="bg-white border border-[#EBEAE6] rounded-xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-[#EBEAE6] flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-2 text-[#222222]">
                  <Cpu className="w-4 h-4 text-[#4B5E53]" />
                  Tizim Ko'rsatmalari (System Prompt)
                </h3>
                <span className="text-[10px] bg-emerald-50 px-2 py-0.5 rounded-full text-emerald-700 font-medium">AUTO-UPDATE ACTIVE</span>
              </div>
              
              <form onSubmit={handleSavePrompt} className="p-5 space-y-4">
                <p className="text-xs text-[#555555] leading-relaxed">
                  Botning xulq-atvori, tili, gapirish qoidalari va unga berilgan asosiy vazifalar shu yerda tahrirlanadi.
                </p>

                {promptMessage && (
                  <div className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
                    promptMessage.type === "success" 
                      ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                      : "bg-rose-50 text-rose-800 border-rose-100"
                  }`}>
                    {promptMessage.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />}
                    <span>{promptMessage.text}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => {
                      setSystemPrompt(e.target.value);
                      setIsEditingPrompt(true);
                    }}
                    placeholder="Tizim ko'rsatmalari yuklanmoqda..."
                    rows={12}
                    className="w-full text-xs font-mono px-3 py-2 border border-[#D0CFC9] rounded-md focus:outline-none focus:ring-1 focus:ring-[#4B5E53] focus:border-[#4B5E53] bg-stone-50 leading-relaxed"
                    required
                  />
                  <div className="flex justify-between items-center text-[10px] text-[#777777]">
                    <span>
                      {isEditingPrompt ? (
                        <span className="text-amber-600 font-semibold animate-pulse">● Tahrirlanmoqda (Saqlashni unutmang)</span>
                      ) : (
                        "Mustaqil yoki dinamik tarzda tahrirlash mumkin"
                      )}
                    </span>
                    <span className="font-semibold text-[#4B5E53]">{'{memories_text}'} tegi qolishi kerak</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {isEditingPrompt && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingPrompt(false);
                        // Force retrieve latest prompt from server to discard local edits
                        fetch("/api/system-prompt")
                          .then(res => res.json())
                          .then(data => setSystemPrompt(data.prompt || ""))
                          .catch(() => {});
                      }}
                      className="flex-1 py-2 px-3 border border-stone-300 hover:bg-stone-100 rounded text-[#333333] text-xs font-semibold uppercase tracking-wider transition cursor-pointer"
                    >
                      Bekor qilish
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isSavingPrompt || !systemPrompt}
                    className={`${isEditingPrompt ? "flex-1" : "w-full"} inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold uppercase tracking-wider transition-all text-white ${
                      isSavingPrompt || !systemPrompt
                        ? "bg-[#4B5E53]/60 cursor-not-allowed" 
                        : "bg-[#4B5E53] hover:bg-[#3d4d44] shadow-xs cursor-pointer"
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    {isSavingPrompt ? "Saqlanmoqda..." : "Yo'riqnomani Saqlash"}
                  </button>
                </div>

                <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-lg text-[11px] text-amber-800 leading-normal">
                  💡 <strong>Aqlli AI Funksiyasi:</strong> Telegram'da botga o'zbek tilida bevosita taklif yoki xohishingizni yozsangiz ham AI ushbu yo'riqnomani o'zi mustaqil tushunib, avtomatik ravishda shu yerda o'zgartira oladi! (Masalan: <em>"Menga faqat inglizcha javob ber"</em> yoki <em>"Gapingni doim tabassum bilan tugat"</em> deb yozib ko'ring).
                </div>
              </form>
            </div>

            {/* Guide Info */}
            <div className="bg-white border border-[#EBEAE6] rounded-xl p-5 shadow-xs">
              <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-stone-500" />
                Userbotni ishga tushirish yo'riqnomasi
              </h3>
              <div className="space-y-3 text-xs text-[#555555] leading-relaxed">
                <p>
                  1. Telegram hisobingizdan **API ID** va **API Hash** kalitlarini oling:
                  <br />
                  - **[my.telegram.org](https://my.telegram.org)** saytiga kiring.
                  <br />
                  - Telefon raqamingizni kiriting va Telegram'ga kelgan tasdiqlash kodi orqali kiring.
                  <br />
                  - **API development tools** bo'limiga o'tib, yangi ilova (App) yarating.
                  <br />
                  - Sizga berilgan `App api_id` va `App api_hash` kalitlarini nusxalab oling.
                </p>
                <p>
                  2. Yuqoridagi formaga ushbu qiymatlarni va shaxsiy telefon raqamingizni kiriting va **Kodni Yuborish** tugmasini bosing.
                </p>
                <p>
                  3. Telegram ilovangizga kelgan 5 xonali kodni kiriting va tasdiqlang. Shundan so'ng ulanish muvaffaqiyatli saqlanadi.
                </p>
                <p className="text-[11px] text-[#777777] italic">
                  *Eslatma: Userbot sizga yozgan barcha shaxsiy xabarlarni kuzatib boradi va sening nomingdan (AI yordamida) shaxsiy vakil sifatida avtomatik javob bera boshlaydi.
                </p>
              </div>
            </div>

          </div>

          {/* Right panel - Real-time terminal log stream */}
          <div className="lg:col-span-7 flex flex-col h-[550px] bg-stone-950 border border-stone-800 rounded-xl overflow-hidden shadow-lg">
            
            <div className="px-4 py-3 bg-stone-900 border-b border-stone-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-stone-400" />
                <span className="font-mono text-xs font-semibold text-stone-300">bot.py Console Output Logs</span>
              </div>
              
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer select-none">
                  <input 
                    type="checkbox" 
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded border-stone-700 bg-stone-800 text-stone-500 focus:ring-0 w-3 h-3"
                  />
                  Auto-scroll
                </label>
                <button 
                  onClick={() => setLogs([])}
                  className="text-[10px] text-stone-400 hover:text-stone-200 border border-stone-700 px-2 py-0.5 rounded hover:bg-stone-800 transition"
                >
                  Clear console
                </button>
              </div>
            </div>

            <div ref={logsContainerRef} className="flex-1 p-4 font-mono text-xs text-stone-300 overflow-y-auto space-y-1.5 scrollbar-thin scrollbar-thumb-stone-800">
              {logs.length === 0 ? (
                <div className="text-stone-600 italic py-4 text-center">Konsolda hali hech qanday xabarlar yo'q. Bot ishga tushishini kutmoqda...</div>
              ) : (
                logs.map((log, index) => {
                  const isError = log.includes("ERROR:") || log.toLowerCase().includes("fail") || log.toLowerCase().includes("err");
                  const isInfo = log.includes("INFO -") || log.includes("Starting") || log.includes("Botni ishga tushirish");
                  return (
                    <div 
                      key={index} 
                      className={`whitespace-pre-wrap leading-relaxed ${
                        isError ? "text-rose-400" : isInfo ? "text-sky-300" : "text-stone-300"
                      }`}
                    >
                      {log}
                    </div>
                  );
                })
              )}
            </div>

          </div>

        </div>

        {/* Row 3 - SQLite Database Administration Panel (Foydalanuvchilar, Suhbatlar, Xotiralar) */}
        <section className="bg-white border border-[#EBEAE6] rounded-xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-[#EBEAE6] bg-[#FCFBF9] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h2 className="font-semibold text-base flex items-center gap-2 text-[#222222]">
                <Database className="w-5 h-5 text-[#4B5E53]" />
                SQLite Ma'lumotlar Bazasi va Suhbatlar tarixi (Web Konsol)
              </h2>
              <p className="text-xs text-[#777777] mt-0.5">
                Telegram boti orqali yozilgan barcha xabarlar, foydalanuvchilar va shaxsiy xotiralar shu yerda boshqariladi.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { fetchDbUsers(); fetchDbMemories(); if (selectedUserId) fetchDbMessages(selectedUserId); }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-[#D0CFC9] bg-white hover:bg-[#FAF9F6] text-[#333333] transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Ma'lumotlarni Yangilash
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#EBEAE6]">
            
            {/* Column 1 - Users & Chats (col-span-7) */}
            <div className="lg:col-span-7 p-6 flex flex-col gap-6">
              <h3 className="font-semibold text-sm flex items-center gap-1.5 text-[#222222]">
                <MessageSquare className="w-4 h-4 text-[#4B5E53]" />
                Foydalanuvchilar va Suhbatlar
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[400px]">
                {/* Users List (col-span-4) */}
                <div className="md:col-span-5 border border-[#EBEAE6] rounded-lg overflow-hidden flex flex-col bg-[#FCFBF9]">
                  <div className="p-3 border-b border-[#EBEAE6] bg-white text-xs font-semibold text-[#555555]">
                    Yozgan Foydalanuvchilar ({dbUsers.length})
                  </div>
                  <div className="flex-1 overflow-y-auto max-h-[350px] divide-y divide-[#EBEAE6]">
                    {isLoadingUsers ? (
                      <div className="p-4 text-center text-xs text-stone-400">Yuklanmoqda...</div>
                    ) : dbUsers.length === 0 ? (
                      <div className="p-4 text-center text-xs text-stone-400 italic">Hali hech kim yozmagan</div>
                    ) : (
                      dbUsers.map((user) => {
                        const isSelected = selectedUserId === user.telegram_user_id.toString();
                        return (
                          <button
                            type="button"
                            key={user.id}
                            onClick={() => setSelectedUserId(user.telegram_user_id.toString())}
                            className={`w-full text-left p-3 text-xs transition-all flex flex-col gap-1 cursor-pointer ${
                              isSelected 
                                ? "bg-[#4B5E53]/10 border-l-2 border-[#4B5E53]" 
                                : "hover:bg-stone-50"
                            }`}
                          >
                            <div className="font-semibold text-[#222222] truncate flex items-center justify-between">
                              <span>{user.first_name || "Ismsiz"} {user.last_name || ""}</span>
                              {user.telegram_user_id.toString() === ownerId && (
                                <span className="text-[9px] bg-stone-100 text-[#4B5E53] px-1 py-0.2 rounded font-medium">Siz (Owner)</span>
                              )}
                            </div>
                            <div className="text-[10px] text-stone-500 truncate">
                              {user.username ? `@${user.username}` : `ID: ${user.telegram_user_id}`}
                            </div>
                            <div className="text-[9px] text-stone-400 text-right mt-1">
                              {new Date(user.updated_at).toLocaleString()}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Chat History View (col-span-8) */}
                <div className="md:col-span-7 border border-[#EBEAE6] rounded-lg overflow-hidden flex flex-col bg-stone-100">
                  {selectedUserId ? (
                    <>
                      <div className="p-3 border-b border-[#EBEAE6] bg-white text-xs font-semibold text-[#555555] flex justify-between items-center shrink-0">
                        <span>Suhbat tarixi (ID: {selectedUserId})</span>
                        <button 
                          type="button"
                          onClick={() => fetchDbMessages(selectedUserId)}
                          className="p-1 hover:bg-stone-100 rounded text-[#4B5E53] cursor-pointer"
                          title="Suhbatni yangilash"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex-1 p-4 overflow-y-auto max-h-[300px] min-h-[250px] space-y-3 flex flex-col">
                        {isLoadingMessages ? (
                          <div className="m-auto text-center text-xs text-stone-400">Yuklanmoqda...</div>
                        ) : dbMessages.length === 0 ? (
                          <div className="m-auto text-center text-xs text-stone-400 italic">Bu foydalanuvchi bilan yozishmalar mavjud emas</div>
                        ) : (
                          dbMessages.map((msg) => {
                            const isAssistant = msg.role === "assistant";
                            return (
                              <div
                                key={msg.id}
                                className={`flex flex-col max-w-[85%] ${
                                  isAssistant ? "self-start" : "self-end items-end"
                                }`}
                              >
                                <div className={`px-3 py-2 rounded-lg text-xs leading-relaxed ${
                                  isAssistant 
                                    ? "bg-white text-[#333333] border border-[#EBEAE6] rounded-tl-none" 
                                    : "bg-[#4B5E53] text-white rounded-tr-none"
                                }`}>
                                  {msg.content}
                                </div>
                                <span className="text-[9px] text-stone-400 mt-1 px-1">
                                  {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-stone-400 text-center">
                      <MessageSquare className="w-10 h-10 mb-2 opacity-30" />
                      <p className="text-xs font-medium">Suhbatni ko'rish uchun chap tomondan biror foydalanuvchini tanlang</p>
                      <p className="text-[10px] text-stone-400 mt-1">Bot orqali yozilgan barcha muloqotlar shu yerda real-time saqlanib boradi.</p>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Column 2 - Personal Memory CRUD (col-span-5) */}
            <div className="lg:col-span-5 p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm flex items-center gap-1.5 text-[#222222]">
                  <Brain className="w-4 h-4 text-[#4B5E53]" />
                  Claude-like Aqlli Xotira
                </h3>
                <div className="flex bg-stone-100 p-0.5 rounded-lg border border-stone-200">
                  <button
                    type="button"
                    onClick={() => setMemoryMode("quick")}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                      memoryMode === "quick" 
                        ? "bg-white text-[#4B5E53] shadow-xs" 
                        : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    Tezkor Kiritish
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoryMode("chat")}
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
                      memoryMode === "chat" 
                        ? "bg-white text-[#4B5E53] shadow-xs" 
                        : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    AI Chat
                  </button>
                </div>
              </div>

              {/* SUCCESS / ERROR ALERTS FOR MEMORY ACTIONS */}
              {memoryMessage && (
                <div className={`p-2.5 rounded-lg text-[11px] flex items-center gap-1.5 border leading-relaxed transition ${
                  memoryMessage.type === "success" 
                    ? "bg-emerald-50 text-emerald-800 border-emerald-100" 
                    : "bg-rose-50 text-rose-800 border-rose-100"
                }`}>
                  {memoryMessage.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />}
                  <span>{memoryMessage.text}</span>
                </div>
              )}

              {/* TAB 1: QUICK INPUT (SMART / MANUAL) */}
              {memoryMode === "quick" && (
                <div className="border border-stone-200 rounded-xl p-4 bg-[#FCFBF9] space-y-4 shadow-2xs">
                  {/* Select Mode within Quick Input */}
                  <div className="flex justify-between items-center border-b border-stone-100 pb-2">
                    <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Kiritish turi:</span>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="quick_type"
                          checked={quickInputType === "ai"}
                          onChange={() => setQuickInputType("ai")}
                          className="text-[#4B5E53] focus:ring-0 w-3 h-3 cursor-pointer"
                        />
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        AI Optimizatsiya
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-stone-700 cursor-pointer select-none">
                        <input
                          type="radio"
                          name="quick_type"
                          checked={quickInputType === "manual"}
                          onChange={() => setQuickInputType("manual")}
                          className="text-[#4B5E53] focus:ring-0 w-3 h-3 cursor-pointer"
                        />
                        <Database className="w-3 h-3 text-stone-500" />
                        Qo'lda kiritish
                      </label>
                    </div>
                  </div>

                  {quickInputType === "ai" ? (
                    /* AI Optimize Form */
                    <form onSubmit={handleQuickAiSubmit} className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Erkin matn yoki xotira</label>
                        <textarea
                          placeholder="Masalan: Men har kuni soat 23:00 da uxlayman. Shuni eslab qolgin..."
                          value={rawQuickText}
                          onChange={(e) => setRawQuickText(e.target.value)}
                          rows={3}
                          className="w-full text-xs px-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4B5E53] bg-white leading-relaxed"
                          required
                        />
                      </div>
                      <p className="text-[10px] text-stone-400">AI avtomatik ravishda toifa, kalit so'z va fakt qiymatini aniqlab ma'lumotlar bazasiga joylaydi.</p>
                      <button
                        type="submit"
                        disabled={isOptimizingMemory || !rawQuickText.trim()}
                        className={`w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition shadow-sm ${
                          isOptimizingMemory || !rawQuickText.trim()
                            ? "bg-[#4B5E53]/60 cursor-not-allowed"
                            : "bg-[#4B5E53] hover:bg-[#3d4d44] cursor-pointer"
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {isOptimizingMemory ? "AI tahlil qilmoqda..." : "AI orqali saqlash"}
                      </button>
                    </form>
                  ) : (
                    /* Manual Entry Form */
                    <form onSubmit={handleAddMemory} className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Kategoriya</label>
                          <input
                            type="text"
                            placeholder="Masalan: shaxsiy"
                            value={newMemory.category}
                            onChange={(e) => setNewMemory({...newMemory, category: e.target.value.toLowerCase()})}
                            className="w-full text-xs px-2.5 py-1.5 border border-stone-300 rounded-md bg-white"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Kalit so'z</label>
                          <input
                            type="text"
                            placeholder="Masalan: hobbi"
                            value={newMemory.key}
                            onChange={(e) => setNewMemory({...newMemory, key: e.target.value.toLowerCase()})}
                            className="w-full text-xs px-2.5 py-1.5 border border-stone-300 rounded-md bg-white"
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Fakt qiymati (3-shaxsda)</label>
                        <input
                          type="text"
                          placeholder="Masalan: Shoxrux bo'sh vaqtida kitob o'qiydi."
                          value={newMemory.value}
                          onChange={(e) => setNewMemory({...newMemory, value: e.target.value})}
                          className="w-full text-xs px-2.5 py-1.5 border border-stone-300 rounded-md bg-white"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isAddingMemory}
                        className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-lg text-xs font-semibold bg-[#4B5E53] hover:bg-[#3d4d44] text-white transition shadow-sm cursor-pointer"
                      >
                        {isAddingMemory ? "Qo'shilmoqda..." : "Xotiraga Qo'shish"}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 2: AI CONVERSATIONAL CHAT */}
              {memoryMode === "chat" && (
                <div className="border border-stone-200 rounded-xl bg-white flex flex-col h-[280px] overflow-hidden shadow-2xs">
                  {/* Chat logs */}
                  <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-stone-50/50">
                    {memoryChatHistory.map((msg, i) => {
                      const isUser = msg.role === "user";
                      return (
                        <div key={i} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                          <div className={`px-3 py-1.5 rounded-lg text-xs leading-relaxed max-w-[90%] ${
                            isUser 
                              ? "bg-[#4B5E53] text-white rounded-tr-none" 
                              : "bg-white text-stone-800 border border-stone-200 rounded-tl-none shadow-3xs"
                          }`}>
                            {msg.content}
                            
                            {/* Saved memory tag indicator */}
                            {!isUser && msg.newMemory && (
                              <div className="mt-1.5 pt-1.5 border-t border-stone-100 flex items-center gap-1 text-[9px] text-emerald-700 font-bold font-mono uppercase tracking-wider">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                                ✨ Xotiraga saqlandi: [{msg.newMemory.category}] {msg.newMemory.key}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Chat input form */}
                  <form onSubmit={handleMemoryChatSubmit} className="p-2 border-t border-stone-200 bg-white flex gap-1.5 items-center">
                    <input
                      type="text"
                      placeholder={isSendingMemoryChat ? "AI javobini kuting..." : "Yangi xotira yoki fakt ayting..."}
                      value={memoryChatInput}
                      onChange={(e) => setMemoryChatInput(e.target.value)}
                      disabled={isSendingMemoryChat}
                      className="flex-1 text-xs px-3 py-1.5 border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4B5E53]"
                      required
                    />
                    <button
                      type="submit"
                      disabled={isSendingMemoryChat || !memoryChatInput.trim()}
                      className={`p-1.5 rounded-lg text-white transition ${
                        isSendingMemoryChat || !memoryChatInput.trim()
                          ? "bg-[#4B5E53]/50 cursor-not-allowed"
                          : "bg-[#4B5E53] hover:bg-[#3d4d44] cursor-pointer"
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
              )}

              {/* Memory List & Filter */}
              <div className="space-y-3 flex-1 flex flex-col pt-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Xotiralardan qidirish..."
                    value={memorySearch}
                    onChange={(e) => setMemorySearch(e.target.value)}
                    className="w-full text-xs pl-8 pr-3 py-2 border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4B5E53] bg-white shadow-3xs"
                  />
                </div>

                <div className="border border-stone-200 rounded-xl overflow-hidden flex-1 max-h-[300px] overflow-y-auto divide-y divide-stone-150 bg-[#FCFBF9] shadow-3xs">
                  {isLoadingMemories ? (
                    <div className="p-4 text-center text-xs text-stone-400">Yuklanmoqda...</div>
                  ) : dbMemories.length === 0 ? (
                    <div className="p-4 text-center text-xs text-stone-400 italic">Hozircha hech qanday shaxsiy xotira mavjud emas.</div>
                  ) : (
                    dbMemories
                      .filter(m => 
                        m.key.toLowerCase().includes(memorySearch.toLowerCase()) || 
                        m.category.toLowerCase().includes(memorySearch.toLowerCase()) || 
                        m.value.toLowerCase().includes(memorySearch.toLowerCase())
                      )
                      .map((memory) => (
                        <div key={memory.id} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-stone-50/80 transition-colors">
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[9px] bg-stone-200/60 text-[#4B5E53] px-1.5 py-0.5 rounded-md font-semibold font-mono tracking-wider uppercase">
                                {memory.category}
                              </span>
                              <span className="text-[10px] font-bold text-stone-600 font-mono">
                                {memory.key}
                              </span>
                            </div>
                            <p className="text-stone-700 leading-normal font-medium">{memory.value}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleDeleteMemory(memory.id)}
                            className="text-stone-400 hover:text-rose-600 p-1.5 transition rounded-md hover:bg-stone-100 cursor-pointer"
                            title="Xotirani o'chirish"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

            </div>

          </div>
        </section>

      </main>
    </div>
  );
}
