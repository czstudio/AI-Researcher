// Persistence and contract helpers for the account/billing/notification surface.
import crypto from 'node:crypto';
import * as db from '../store/db.mjs';
import * as U from './util.mjs';

export function dateTime(ms = Date.now()) {
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

export function defaultOnboarding() {
  return {
    firstTaskAcked: false, thirdTaskAcked: false,
    activePromoCode: null, activePromoStripeId: null,
    promoExpiresAt: null, discountPercent: null, pendingPopups: [],
  };
}

export function onboardingOf(user) {
  const rec = db.get("onboarding", String(user.id));
  return { ...defaultOnboarding(), ...(user.onboardingState || {}), ...(rec?.state || {}) };
}

export function saveOnboarding(user, state) {
  const next = { ...defaultOnboarding(), ...onboardingOf(user), ...state };
  db.put("onboarding", String(user.id), { userId: String(user.id), state: next, updatedAt: U.nowMs() });
  user.onboardingState = next;
  db.put("users", user.id, user);
  return next;
}

export function ensureDefaultNotifications(userId) {
  const key = String(userId);
  let rec = db.get("notifications", key);
  if (rec == null) rec = { userId: key, items: [] };
  if (rec.items.length === 0) {
    const created = "2026-09-01 17:49:42";
    rec.items.push({ id: 2, type: "UPDATE", name: "Model update", content: "<p><strong>A New Version Is Available</strong></p><p>We released a new version of Novix with the latest improvements and fixes.</p>", version: null, releaseDate: null, showPopup: true, status: 1, sortOrder: 1, read: false, createdAt: created, updatedAt: created, at: Date.parse("2026-09-01T17:49:42") });
    db.put("notifications", key, rec);
  }
  return rec;
}

export function notificationRecord(n, index = 0) {
  const created = n.createdAt || dateTime(n.at || U.nowMs());
  return {
    id: n.id, type: n.type || "UPDATE", name: n.name || n.title || "Notification",
    content: n.content || n.body || "", version: n.version ?? null,
    releaseDate: n.releaseDate ?? null, showPopup: n.showPopup !== false,
    status: n.status ?? 1, sortOrder: n.sortOrder ?? index + 1,
    createdAt: created, updatedAt: n.updatedAt || created,
  };
}

export function billingRows(userId) {
  const rec = db.get("billing", String(userId));
  return Array.isArray(rec?.items) ? rec.items : [];
}

export function addBillingStatement(userId, statement, idempotencyKey = null) {
  const key = String(userId);
  const rec = db.get("billing", key) || { userId: key, items: [] };
  if (idempotencyKey) {
    const existing = rec.items.find((x) => x.idempotencyKey === idempotencyKey);
    if (existing) return existing;
  }
  const row = {
    id: crypto.randomUUID(), provider: statement.provider || "stripe",
    statementType: statement.statementType || "subscription", sku: statement.sku || null,
    amount: Number(statement.amount || 0), currency: statement.currency || "usd",
    periodStart: statement.periodStart ?? null, periodEnd: statement.periodEnd ?? null,
    paidAt: statement.paidAt ?? U.nowMs(), invoiceAccessMode: statement.invoiceAccessMode || "hosted_invoice",
    hostedInvoiceUrl: statement.hostedInvoiceUrl ?? null,
  };
  if (idempotencyKey) row.idempotencyKey = idempotencyKey;
  rec.items.unshift(row);
  db.put("billing", key, rec);
  return row;
}

export function planForLevelOrSku(plans, value) {
  const v = String(value || "").toLowerCase();
  let plan = plans.find((p) => p.level === v);
  if (plan) return plan;
  const upper = String(value || "").toUpperCase();
  if (upper.startsWith("LITE")) plan = plans.find((p) => p.level === "lite");
  else if (upper.startsWith("PRO")) plan = plans.find((p) => p.level === "pro");
  else if (upper.startsWith("LAB") || upper.startsWith("ULTRA")) plan = plans.find((p) => p.level === "lab");
  else if (upper.startsWith("FREE")) plan = plans.find((p) => p.level === "free");
  return plan || null;
}

export function applyUpgrade(user, options, plans) {
  const plan = planForLevelOrSku(plans, options.level || options.sku || "pro") || plans.find((p) => p.level === "pro");
  const key = options.idempotencyKey || null;
  const existing = key ? billingRows(user.id).find((s) => s.idempotencyKey === key) : null;
  if (existing) return { plan, credits: user.credits, subscriptionStatus: user.subscriptionStatus, statement: existing, idempotent: true };
  user.level = plan.level;
  user.credits = plan.monthlyCredits;
  user.subscriptionStatus = "active";
  user.subscriptionProvider = options.provider || "stripe";
  user.sku = plan.sku || (plan.level === "free" ? "FREE_MONTHLY" : plan.level.toUpperCase() + "_SUB_MONTHLY");
  user.entitlementEndsAt = U.nowMs() + 30 * 24 * 3600 * 1000;
  db.put("users", user.id, user);
  db.appendLedger({ userId: user.id, kind: "upgrade", delta: plan.monthlyCredits, balance: user.credits, plan: plan.level, idempotencyKey: key || undefined });
  let statement = null;
  if (Number(plan.monthlyPriceUsd || 0) > 0) {
    statement = addBillingStatement(user.id, { provider: options.provider || "stripe", statementType: "subscription", sku: user.sku, amount: plan.monthlyPriceUsd, periodStart: U.nowMs(), periodEnd: user.entitlementEndsAt }, key);
  }
  return { plan, credits: user.credits, subscriptionStatus: user.subscriptionStatus, statement, idempotent: false };
}

export function verifyInternalSignature(req, body) {
  const secret = process.env.NOVIX_INTERNAL_TASK_SECRET || process.env.INTERNAL_TASK_SECRET || process.env.NOVIX_INTERNAL_SECRET || "";
  if (secret === "") return false;
  const rawSig = req.headers["x-novix-signature"] || req.headers["x-internal-signature"] || req.headers["x-signature"] || body.signature || body.sig || "";
  const sig = String(rawSig).replace(/^sha256=/i, "");
  if (sig === "") return false;
  const timestamp = req.headers["x-novix-timestamp"] || req.headers["x-timestamp"] || body.timestamp || body.ts || "";
  const raw = req.__rawBody || "";
  const canonicalBody = JSON.stringify(body);
  const candidates = new Set([raw, canonicalBody]);
  if (timestamp) {
    candidates.add(String(timestamp) + "." + raw);
    candidates.add(String(timestamp) + "." + canonicalBody);
  }
  for (const payload of candidates) {
    const expected = crypto.createHmac("sha256", secret).update(payload).digest();
    const variants = [Buffer.from(sig, "hex"), Buffer.from(sig, "base64"), Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64")];
    for (const got of variants) {
      if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return true;
    }
  }
  return false;
}
