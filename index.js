import "dotenv/config";

const CMC_URL = "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest";

/** Thousands with space, same idea as decenter-bot NicePrint + comma→space */
function nicePrint(number) {
  if (number === 0) return "0";
  const digits = number < 1 ? 4 : number >= 100 ? 0 : 2;
  const fixed = number.toFixed(digits);
  const [intRaw, frac] = fixed.split(".");
  const intPart = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac !== undefined ? `${intPart}.${frac}` : intPart;
}

/** BTC/ETH in original bot: integer USD, then NicePrint */
function formatPriceUsd(symbol, price) {
  const s = symbol.toUpperCase();
  if (s === "BTC" || s === "ETH") return nicePrint(Math.trunc(price));
  return nicePrint(price);
}

function loadChannels() {
  const channels = {};
  for (const [key, value] of Object.entries(process.env)) {
    const m = key.match(/^CHANNEL_([A-Z0-9]+)$/i);
    if (m && value && String(value).trim()) {
      channels[m[1].toUpperCase()] = String(value).trim();
    }
  }
  return channels;
}

function sendOrder(symbols) {
  const preferred = ["TON", "ETH", "BTC"];
  const rest = symbols
    .filter((s) => !preferred.includes(s))
    .sort();
  return [...preferred.filter((s) => symbols.includes(s)), ...rest];
}

async function fetchQuotes(symbols, apiKey) {
  const sym = [...symbols].sort().join(",");
  const res = await fetch(`${CMC_URL}?symbol=${encodeURIComponent(sym)}`, {
    headers: { "X-CMC_PRO_API_KEY": apiKey, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.status?.error_message || res.statusText;
    throw new Error(`CMC ${res.status}: ${msg}`);
  }
  return body.data || {};
}

async function telegramSendMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // decenter uses markdown; plain $ prices work without parsing
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(data.description || `Telegram HTTP ${res.status}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function tick({ cmcKey, botToken, channels }) {
  const symbols = Object.keys(channels);
  if (symbols.length === 0) {
    console.error("No CHANNEL_* entries in .env");
    return;
  }

  const data = await fetchQuotes(symbols, cmcKey);
  const ordered = sendOrder(symbols);

  for (let i = 0; i < ordered.length; i++) {
    const symbol = ordered[i];
    const chatId = channels[symbol];
    const row = data[symbol];
    const price = row?.quote?.USD?.price;
    if (price == null) {
      console.error(`Missing CMC price for ${symbol}`);
      continue;
    }
    const line = `$${formatPriceUsd(symbol, price)}`;
    try {
      await telegramSendMessage(botToken, chatId, line);
      console.log(new Date().toISOString(), symbol, "→", chatId, line);
    } catch (e) {
      console.error(symbol, "send failed:", e.message);
    }
    if (i < ordered.length - 1) await sleep(500);
  }
}

async function main() {
  const cmcKey = process.env.CMC_API_KEY || process.env.CMC_TOKEN;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const channels = loadChannels();

  if (!cmcKey) {
    console.error("Set CMC_API_KEY (or CMC_TOKEN) in .env");
    process.exit(1);
  }
  if (!botToken) {
    console.error("Set TELEGRAM_BOT_TOKEN in .env");
    process.exit(1);
  }

  const ctx = { cmcKey, botToken, channels };

  for (;;) {
    try {
      await tick(ctx);
    } catch (e) {
      console.error("tick error:", e.message);
    }
    await sleep(60_000);
  }
}

main();
