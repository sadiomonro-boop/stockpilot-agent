// StockPilot dashboard. No build step, no external scripts: reads the
// state.json snapshot written by `npm run agent:once` in the same folder.
// Serve with any static server, e.g. `python3 -m http.server` in dashboard/.

const EXPLORER = "https://sepolia.basescan.org";

function usd(x) {
  return "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(x) {
  return (x * 100).toFixed(2) + "%";
}
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function main() {
  let state;
  try {
    const res = await fetch("state.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    state = await res.json();
  } catch (err) {
    el("updated").textContent = "Could not load state.json — run `npm run agent:once` in agent/ first. (" + err.message + ")";
    return;
  }

  el("updated").textContent = "Last updated: " + state.updatedAt + " (UTC)";

  // Portfolio value + PnL from the latest decision (or start capital).
  const last = state.lastDecision;
  const value = last ? last.portfolioValueUsd : state.startCapitalUsd;
  const pnl = value - state.startCapitalUsd;
  el("value").textContent = usd(value);
  el("cash").textContent = usd(state.cashUsd);
  const pnlEl = el("pnl");
  pnlEl.textContent = (pnl >= 0 ? "+" : "") + usd(pnl) + " (" + pct(pnl / state.startCapitalUsd) + ")";
  pnlEl.classList.toggle("neg", pnl < 0);
  el("cycles").textContent = String(state.cyclesRun);

  // Positions.
  const quotes = {};
  for (const q of state.quotes || []) quotes[q.symbol] = q.price;
  const posBody = document.querySelector("#positions tbody");
  const symbols = Object.keys(state.positions || {});
  if (symbols.length === 0) {
    posBody.innerHTML = '<tr><td colspan="7">No positions yet — run the first cycle.</td></tr>';
  } else {
    posBody.innerHTML = symbols.map((sym) => {
      const pos = state.positions[sym];
      const price = quotes[sym] || 0;
      const v = pos.tokens * price;
      const upnl = v - pos.tokens * pos.avgPrice;
      return "<tr><td><strong>" + esc(sym) + "</strong></td><td>" + pos.tokens.toFixed(6) + "</td><td>" + usd(price) + "</td><td>" + usd(v) + "</td><td>" + pct(value > 0 ? v / value : 0) + "</td><td>" + usd(pos.avgPrice) + "</td><td class=\"" + (upnl < 0 ? "neg" : "pos") + "\">" + (upnl >= 0 ? "+" : "") + usd(upnl) + "</td></tr>";
    }).join("");
  }

  // Latest decision + reasoning.
  const dEl = el("decision");
  if (!last) {
    dEl.innerHTML = '<p class="muted">No decisions yet.</p>';
  } else {
    let html = "<p><strong>Cycle " + last.cycle + "</strong> — " + esc(last.at) + " · portfolio " + usd(last.portfolioValueUsd) + " · " + last.trades.length + " trade(s)</p>";
    html += "<table><thead><tr><th>Symbol</th><th>Price</th><th>Source</th><th>Momentum</th><th>Score</th><th>Target</th><th>Reason</th></tr></thead><tbody>";
    for (const s of last.signals) {
      const t = last.targets.find((x) => x.symbol === s.symbol);
      html += "<tr><td><strong>" + esc(s.symbol) + "</strong></td><td>" + usd(s.price) + "</td><td>" + esc(s.source) + "</td><td>" + (s.momentum === null ? "n/a" : pct(s.momentum)) + "</td><td>" + s.score.toFixed(3) + "</td><td>" + (t ? pct(t.targetWeight) : "—") + "</td><td>" + esc(s.reason) + "</td></tr>";
    }
    html += "</tbody></table>";
    if (last.notes && last.notes.length) {
      html += "<ul>" + last.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>";
    }
    dEl.innerHTML = html;
  }

  // Trade history.
  const trBody = document.querySelector("#trades tbody");
  const trades = state.recentTrades || [];
  if (trades.length === 0) {
    trBody.innerHTML = '<tr><td colspan="8">No trades yet.</td></tr>';
  } else {
    trBody.innerHTML = trades.map((t, i) => {
      const journal = t.journalTx
        ? '<a href="' + EXPLORER + "/tx/" + t.journalTx + '" target="_blank" rel="noopener">recorded ↗</a>'
        : esc(t.journalStatus);
      return "<tr><td>" + (trades.length - i) + "</td><td>" + esc(t.at) + "</td><td>" + esc(t.side) + "</td><td><strong>" + esc(t.symbol) + "</strong></td><td>" + Number(t.tokens).toFixed(6) + "</td><td>" + usd(t.price) + "</td><td>" + usd(t.valueUsd) + "</td><td>" + journal + "</td></tr>";
    }).join("");
  }

  // Journal contract link.
  const jl = el("journal-link");
  if (state.journalAddress) {
    jl.href = EXPLORER + "/address/" + state.journalAddress;
    jl.textContent = state.journalAddress;
  }
}

main();
