"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { sendChat, type ExecutionPlan } from "../lib/api";

interface UiMessage {
  role: "user" | "assistant";
  content: string;
  plan?: ExecutionPlan;
  approval?: boolean;
}

// Two demo identities so both journeys are visible in one browser:
// the Author creates a PRD; the Consumer later asks for its requirements.
const USERS = [
  { id: "author", label: "👩‍💻 Author" },
  { id: "consumer", label: "🧑‍💼 Consumer" },
];

const SUGGESTIONS: Record<string, string> = {
  author: "create a PRD for project Atlas",
  consumer: "what are the requirements for project Atlas",
};

export default function Home() {
  const [userId, setUserId] = useState("author");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchUser(id: string) {
    setUserId(id);
    setConversationId(null); // a different user starts a fresh conversation
    setMessages([]);
    setError(null);
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await sendChat(text, conversationId, userId);
      setConversationId(res.conversation_id);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.reply,
          plan: res.plan,
          approval: res.plan.requires_approval,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Agentic Skills Platform</h1>
        <p>Chat → LLM intent router → skill → n8n workflow → PRD artifact (Postgres)</p>
      </header>

      <div className="userbar">
        <span className="label">Acting as:</span>
        {USERS.map((u) => (
          <button
            key={u.id}
            className={u.id === userId ? "active" : ""}
            onClick={() => switchUser(u.id)}
          >
            {u.label}
          </button>
        ))}
        <span className="label">
          (switching starts a new session; artifacts persist across users)
        </span>
      </div>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            Try: <code>{SUGGESTIONS[userId]}</code>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role === "user" ? "You" : "Assistant"}</span>
            {m.plan && (
              <div className="chips">
                <span className={`chip ${m.plan.skill ? "skill" : ""}`}>
                  {m.plan.skill ? `skill: ${m.plan.skill}` : `router: ${m.plan.status}`}
                </span>
                {m.approval && <span className="chip warn">⚠️ pending approval (n8n · M5)</span>}
                {m.plan._router_note && <span className="chip">fallback</span>}
              </div>
            )}
            <div className="bubble">
              {m.role === "assistant" ? (
                <ReactMarkdown>{m.content}</ReactMarkdown>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {busy && <div className="empty">Working…</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="composer">
        <div className="inner">
          <textarea
            value={input}
            placeholder={`Message as ${userId}…`}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button onClick={submit} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
        <div className="hint">Enter to send · Shift+Enter for newline</div>
      </div>
    </div>
  );
}
