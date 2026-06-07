# stripe_server

API-only Express server for **PromptPay** payments via **Stripe Checkout** (THB).

## Setup

```bash
npm install
cp .env.example .env
```

Set `CLIENT_URL` to your frontend origin (e.g. `http://localhost:3000`).

## Run

```bash
npm run dev
```

Server runs at `http://localhost:4242`.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/config` | Returns publishable key |
| GET | `/products` | Lists active one-time THB products and prices |
| POST | `/create-checkout-session` | Creates a Checkout Session |
| GET | `/session-status?session_id=cs_xxx` | Get checkout session status (query param) |
| GET | `/checkout-session/:id` | Get checkout session status (path param) |
| POST | `/webhook` | Stripe webhook endpoint |

### Create checkout session

```bash
curl -X POST http://localhost:4242/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_...",
    "email": "customer@example.com",
    "successUrl": "http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}",
    "cancelUrl": "http://localhost:3000/payment/cancel"
  }'
```

- `priceId` — required, active one-time THB price
- `email` — required
- `successUrl` / `cancelUrl` — optional; defaults to `CLIENT_URL/payment/success` and `CLIENT_URL/payment/cancel`

Returns `{ "sessionId", "url", "product" }` — redirect the customer to `url`.

### Check payment status

```bash
curl http://localhost:4242/checkout-session/cs_xxx
```

Includes `product` with `priceId`, `productId`, `name`, `quantity`, `amount`, `currency`. Poll until `paymentStatus` is `"paid"` (PromptPay is async).

## Webhooks

```bash
stripe listen --forward-to localhost:4242/webhook
```

Listen for `checkout.session.completed` to fulfill orders.

## Deploy to Render

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/stripe_server.git
git push -u origin main
```

Do **not** commit `.env` — it is gitignored.

### 2. Create a Web Service on Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo
3. Render auto-detects settings from `render.yaml`, or set manually:

| Setting | Value |
|---------|-------|
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |

Or use **New** → **Blueprint** and point at the repo (uses `render.yaml`).

### 3. Environment variables

In Render → your service → **Environment**, add:

| Key | Value |
|-----|-------|
| `STRIPE_SECRET_KEY` | `sk_live_...` or `sk_test_...` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_...` or `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Stripe Dashboard |
| `CLIENT_URL` | Your frontend URL, e.g. `https://your-app.vercel.app` |

Render sets `PORT` automatically — no need to configure it.

### 4. Stripe webhook (production)

1. Deploy the service — URL will be like `https://stripe-server-xxxx.onrender.com`
2. In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), add endpoint:
   ```
   https://stripe-server-xxxx.onrender.com/webhook
   ```
3. Select events: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET` on Render → **Redeploy**

### 5. Point your frontend at Render

```bash
# Example
curl https://stripe-server-xxxx.onrender.com/health
curl https://stripe-server-xxxx.onrender.com/products
```

Update your frontend API base URL to the Render URL.

### Notes

- **Free tier** spins down after inactivity — first request may take ~30s (cold start)
- Use **test keys** until you are ready for production
- `successUrl` / `cancelUrl` in API calls should use your **frontend** domain, not Render

