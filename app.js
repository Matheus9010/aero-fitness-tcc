/* PRÓ · Personal Trainer IA — lógica do chat (JS puro) */

/* Endpoint que fala com a IA. Em produção use o endereço do seu app:
   ex.: "https://seu-app.lovable.app/api/chat" */
const API_URL = "/api/chat";
const STORAGE_KEY = "pro-personal-ai-chat";

const QUICK_ACTIONS = [
  { label: "Criar planilha de treino", prompt: "Quero uma planilha de treino. Me pergunte o que precisar." },
  { label: "Montar dieta", prompt: "Quero montar um plano alimentar. Me pergunte o que precisar." },
  { label: "Definir meta", prompt: "Quero definir uma meta de treino. Pode me ajudar?" },
  { label: "Dicas de treino", prompt: "Me dá dicas de treino para evoluir com segurança." },
];

const el = {
  transcript: document.getElementById("transcript"),
  empty: document.getElementById("empty"),
  quick: document.getElementById("quick"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  note: document.getElementById("note"),
  newChat: document.getElementById("new-chat"),
};

let messages = load();
let busy = false;

/* ---------- persistência ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {}
}

/* ---------- markdown mínimo ---------- */
function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
}
function markdown(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  let html = "";
  let list = null;
  let table = null;

  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const closeTable = () => { if (table) { html += "</tbody></table>"; table = null; } };

  for (const line of lines) {
    const t = line.trim();

    // tabela
    if (/^\|.*\|$/.test(t)) {
      const cells = t.slice(1, -1).split("|").map((c) => c.trim());
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // separador
      closeList();
      if (!table) {
        html += "<table><thead><tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>";
        table = true;
      } else {
        html += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
      }
      continue;
    }
    closeTable();

    if (!t) { closeList(); continue; }

    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }

    const ul = t.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(ul[1])}</li>`;
      continue;
    }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(ol[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inline(t)}</p>`;
  }
  closeList();
  closeTable();
  return html;
}

/* ---------- render ---------- */
function scrollDown() {
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function render() {
  el.transcript.innerHTML = "";
  if (!messages.length) {
    el.transcript.appendChild(el.empty);
    return;
  }
  for (const m of messages) {
    const row = document.createElement("div");
    row.className = "msg " + m.role;
    if (m.role === "user") {
      const b = document.createElement("div");
      b.className = "bubble-user";
      b.textContent = m.content;
      row.appendChild(b);
    } else {
      row.innerHTML = `<div class="avatar">PR</div><div class="bubble-ai">${markdown(m.content)}</div>`;
    }
    el.transcript.appendChild(row);
  }
  scrollDown();
}

function showTyping() {
  const row = document.createElement("div");
  row.className = "msg assistant";
  row.id = "typing";
  row.innerHTML =
    '<div class="avatar">PR</div><div class="typing"><span class="dots"><i></i><i></i><i></i></span>preparando resposta</div>';
  el.transcript.appendChild(row);
  scrollDown();
}
function hideTyping() {
  document.getElementById("typing")?.remove();
}

function setBusy(v) {
  busy = v;
  el.send.disabled = v;
  el.quick.querySelectorAll("button").forEach((b) => (b.disabled = v));
  if (!v) el.input.focus();
}

/* ---------- envio + streaming ---------- */
async function send(text) {
  const content = text.trim();
  if (!content || busy) return;

  messages.push({ role: "user", content });
  render();
  save();
  setBusy(true);
  showTyping();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m, i) => ({
          id: String(i),
          role: m.role,
          parts: [{ type: "text", text: m.content }],
        })),
      }),
    });
    if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

    hideTyping();
    const reply = { role: "assistant", content: "" };
    messages.push(reply);
    render();
    const bubble = el.transcript.querySelector(".msg:last-child .bubble-ai");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let evt;
        try { evt = JSON.parse(payload); } catch { continue; }
        const chunk =
          evt.type === "text-delta" ? (evt.delta ?? evt.textDelta ?? "") : "";
        if (chunk) {
          reply.content += chunk;
          bubble.innerHTML = markdown(reply.content);
          scrollDown();
        }
      }
    }

    if (!reply.content) reply.content = "_Sem resposta agora. Tente enviar de novo._";
    render();
    save();
  } catch (err) {
    hideTyping();
    el.note.textContent =
      "Não consegui falar com o PRÓ agora (" + err.message + ") · envie de novo";
  } finally {
    setBusy(false);
  }
}

/* ---------- eventos ---------- */
QUICK_ACTIONS.forEach((a) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = a.label;
  b.onclick = () => send(a.prompt);
  el.quick.appendChild(b);
});

el.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const v = el.input.value;
  el.input.value = "";
  el.input.style.height = "auto";
  send(v);
});

el.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el.form.requestSubmit();
  }
});

el.input.addEventListener("input", () => {
  el.input.style.height = "auto";
  el.input.style.height = Math.min(el.input.scrollHeight, 180) + "px";
});

el.newChat.addEventListener("click", () => {
  messages = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  el.note.textContent =
    "PRÓ treina com você 24/7 · salvamos sua conversa neste navegador";
  render();
  el.input.focus();
});

render();
