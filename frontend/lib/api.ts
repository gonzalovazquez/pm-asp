export interface ExecutionPlan {
  skill: string | null;
  context_sources: string[];
  requires_approval: boolean;
  status: "matched" | "no_match" | "ambiguous";
  candidates: string[];
  _router_note?: string;
}

export interface Artifact {
  id: string;
  title: string | null;
  status: string;
  version: number;
}

export interface ChatResponse {
  conversation_id: string;
  plan: ExecutionPlan;
  reply: string;
  artifact: Artifact | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export async function sendChat(
  message: string,
  conversationId: string | null,
  userId: string,
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      user_id: userId,
    }),
  });
  if (!res.ok) {
    throw new Error(`Backend error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
