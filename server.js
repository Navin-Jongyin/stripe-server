require("dotenv").config();

const express = require("express");
const Stripe = require("stripe");
const { activateSubscriptionInFirestore } = require("./firebase-admin");

const app = express();
const port = process.env.PORT || 4242;

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return allowedOrigins.includes("*");
  if (allowedOrigins.includes("*")) return true;
  return allowedOrigins.includes(origin);
}

function isAllowedRedirectUrl(url) {
  try {
    const parsed = new URL(url);
    if (allowedOrigins.includes("*")) return true;

    return allowedOrigins.some((origin) => {
      const allowed = new URL(origin);
      return parsed.origin === allowed.origin;
    });
  } catch {
    return false;
  }
}

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}


app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/config", (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
  });
});

const LISTED_PRODUCT_ID =
  process.env.STRIPE_PRODUCT_ID || "prod_Utz2L5XoRI7JDT";
const PAYMENT_METHOD_CONFIGURATION =
  process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION ||
  "pmc_1To559G8qWAkDmi6Ruol9iqd";

app.get("/products", async (_req, res) => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
      limit: 100,
    });

    const products = prices.data
      .filter(
        (price) =>
          price.currency === "thb" &&
          typeof price.product === "object" &&
          price.product.active &&
          price.product.id === LISTED_PRODUCT_ID,
      )
      .map((price) => ({
        priceId: price.id,
        productId: price.product.id,
        name: price.product.name,
        description: price.product.description || null,
        amount: price.unit_amount,
        currency: price.currency,
      }))
      .sort((a, b) => a.amount - b.amount);

    res.json({ products });
  } catch (error) {
    console.error("Products error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, quantity = 1, email, successUrl, cancelUrl, userId, authUid } =
      req.body;

    if (!priceId) {
      return res.status(400).json({ error: "priceId is required" });
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "A valid email is required" });
    }

    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, "");
    const resolvedSuccessUrl =
      successUrl ||
      `${frontendUrl}/index.html?payment=success&session_id={CHECKOUT_SESSION_ID}#paymentSuccess`;
    const resolvedCancelUrl =
      cancelUrl || `${frontendUrl}/index.html?payment=cancel#paymentCancel`;

    if (
      !isAllowedRedirectUrl(resolvedSuccessUrl) ||
      !isAllowedRedirectUrl(resolvedCancelUrl)
    ) {
      return res.status(400).json({ error: "Redirect URL not allowed" });
    }

    const price = await stripe.prices.retrieve(priceId);
    if (price.currency !== "thb") {
      return res.status(400).json({ error: "Only THB prices are supported" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "th",
      payment_method_configuration: PAYMENT_METHOD_CONFIGURATION,
      wallet_options: {
        link: { display: "never" },
      },
      adaptive_pricing: { enabled: false },
      customer_email: email.trim().toLowerCase(),
      client_reference_id: userId || authUid || undefined,
      metadata: {
        userId: userId || "",
        authUid: authUid || "",
      },
      line_items: [
        {
          price: priceId,
          quantity: Math.max(1, Number(quantity) || 1),
        },
      ],
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
    });

    res.json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Checkout error:", error.message);
    res.status(500).json({ error: error.message });
  }
});


app.get("/session-status", async (req, res) => {
  try {
    const sessionId = req.query.session_id || req.query.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: "session_id is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(String(sessionId), {
      expand: ["line_items.data.price.product", "payment_intent"],
    });

    const lineItem = session.line_items?.data?.[0];
    const price = lineItem?.price;
    const product =
      price && typeof price.product === "object" ? price.product : null;

    let paymentIntentStatus = null;
    if (session.payment_intent && typeof session.payment_intent === "object") {
      paymentIntentStatus = session.payment_intent.status;
    } else if (typeof session.payment_intent === "string") {
      const paymentIntent = await stripe.paymentIntents.retrieve(
        session.payment_intent,
      );
      paymentIntentStatus = paymentIntent.status;
    }

    res.json({
      sessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      paymentIntentStatus,
      amountTotal: session.amount_total,
      currency: session.currency,
      email: session.customer_details?.email || session.customer_email || null,
      product: price
        ? {
            priceId: price.id,
            productId: product?.id || price.product,
            name: product?.name || "",
            description: product?.description ?? null,
            quantity: lineItem?.quantity || 1,
            amount: price.unit_amount,
            currency: price.currency,
          }
        : null,
    });
  } catch (error) {
    console.error("Session status error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/activate-subscription", async (req, res) => {
  try {
    const { sessionId, userId, authUid } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(String(sessionId), {
      expand: ["line_items.data.price.product"],
    });

    if (session.status !== "complete" || session.payment_status !== "paid") {
      return res.status(400).json({ error: "Payment is not complete yet." });
    }

    const lineItem = session.line_items?.data?.[0];
    const price = lineItem?.price;
    const product =
      price && typeof price.product === "object" ? price.product : null;
    const planName = product?.name || "Subscription";
    const resolvedUserId =
      userId || session.metadata?.userId || session.client_reference_id || null;
    const resolvedAuthUid = authUid || session.metadata?.authUid || null;

    const result = await activateSubscriptionInFirestore({
      userId: resolvedUserId,
      authUid: resolvedAuthUid,
      planName,
      checkoutSessionId: session.id,
    });

    if (!result.ok && result.fallbackClient) {
      return res.status(501).json(result);
    }

    if (!result.ok) {
      return res.status(400).json(result);
    }

    res.json({
      ok: true,
      planName: result.planName,
      activatedAt: timestampToIso(result.activatedAt),
      expiresAt: timestampToIso(result.expiresAt),
      durationDays: result.durationDays,
      amountTotal: session.amount_total,
      userId: result.userId,
    });
  } catch (error) {
    console.error("Activate subscription error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Stripe PromptPay server running on port ${port}`);
});
