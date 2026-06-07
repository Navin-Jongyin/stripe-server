import "dotenv/config";
import cors from "cors";
import express from "express";
import Stripe from "stripe";

const requiredEnv = ["STRIPE_SECRET_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const port = Number(process.env.PORT) || 4242;
const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return origin.replace(/\/$/, "") === clientUrl;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, clientUrl);
      }
    },
  }),
);

app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return res.status(500).send("STRIPE_WEBHOOK_SECRET is not configured");
    }

    const signature = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
      console.error("Webhook signature verification failed:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    switch (event.type) {
      case "checkout.session.completed":
        console.log("Checkout completed:", event.data.object.id);
        break;
      case "payment_intent.succeeded":
        console.log("Payment succeeded:", event.data.object.id);
        break;
      case "payment_intent.payment_failed":
        console.log("Payment failed:", event.data.object.id);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  },
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/config", (_req, res) => {
  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
  });
});

app.get("/products", async (_req, res) => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      currency: "thb",
      type: "one_time",
      limit: 100,
      expand: ["data.product"],
    });

    const products = prices.data
      .filter((price) => price.product?.active)
      .map((price) => ({
        priceId: price.id,
        productId: price.product.id,
        name: price.product.name,
        description: price.product.description,
        amount: price.unit_amount,
        currency: price.currency,
      }))
      .sort((a, b) => a.amount - b.amount);

    res.json({ products });
  } catch (error) {
    console.error("products error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { priceId, email, quantity = 1, successUrl, cancelUrl } = req.body ?? {};

    if (!priceId || typeof priceId !== "string") {
      return res.status(400).json({ error: "priceId is required" });
    }

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "email is required" });
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: "quantity must be at least 1" });
    }

    const price = await stripe.prices.retrieve(priceId, {
      expand: ["product"],
    });

    if (!price.active || !price.product.active) {
      return res.status(400).json({ error: "Product is not active" });
    }

    if (price.currency !== "thb" || price.type !== "one_time") {
      return res.status(400).json({
        error: "Only active one-time THB prices are supported",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity }],
      payment_method_types: ["promptpay"],
      success_url:
        successUrl ||
        `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${clientUrl}/payment/cancel`,
      metadata: {
        price_id: price.id,
        product_id: price.product.id,
        product_name: price.product.name,
      },
    });

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error("create-checkout-session error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get("/checkout-session/:id", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id, {
      expand: ["payment_intent"],
    });

    const paymentIntent = session.payment_intent;

    res.json({
      sessionId: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      paymentIntentStatus:
        typeof paymentIntent === "object" ? paymentIntent?.status : null,
      amountTotal: session.amount_total,
      currency: session.currency,
    });
  } catch (error) {
    console.error("checkout-session retrieve error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Stripe server listening on http://localhost:${port}`);
});
