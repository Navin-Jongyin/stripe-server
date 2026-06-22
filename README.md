This is stripe server for Sully-Test
# Practice Games — Stripe PromptPay Server

API-only Node.js server for **Practice Games** (cognitive training hub). Deployed on Render; frontend calls it by URL.

Live: `https://stripe-server-3dqx.onrender.com`

## Setup

```bash
npm install
cp .env.example .env
```

## Run

```bash
npm run dev
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | No | Returned by `GET /config` |
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend origins, or `*` for dev |
| `FRONTEND_URL` | No | Fallback for success/cancel redirect URLs |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Recommended | Firebase service account JSON (one line) |
| `PORT` | Auto | Set by Render |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/config` | Publishable key |
| GET | `/products` | Active THB Stripe prices |
| POST | `/create-checkout-session` | Create Checkout session (card + PromptPay) |
| GET | `/session-status?session_id=cs_xxx` | Payment + product status |
| POST | `/activate-subscription` | Activate Firestore subscription (Admin SDK) |

### Create checkout session

```bash
curl -X POST http://localhost:4242/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{
    "priceId": "price_xxx",
    "email": "user@example.com",
    "userId": "firestore-doc-id",
    "authUid": "firebase-auth-uid",
    "successUrl": "http://127.0.0.1:5500/index.html?payment=success&session_id={CHECKOUT_SESSION_ID}#paymentSuccess",
    "cancelUrl": "http://127.0.0.1:5500/index.html?payment=cancel#paymentCancel"
  }'
```

### Activate subscription

```bash
curl -X POST http://localhost:4242/activate-subscription \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "cs_xxx",
    "userId": "firestore-doc-id",
    "authUid": "firebase-auth-uid"
  }'
```

Returns `501` with `{ "fallbackClient": true }` if Firebase Admin is not configured.

## Deploy to Render

1. Push repo to GitHub
2. **New → Web Service** → connect repo
3. Build: `npm install` · Start: `npm start` · Health: `/health`
4. Set env vars (especially `FIREBASE_SERVICE_ACCOUNT_JSON` and `ALLOWED_ORIGINS`)
5. Add Stripe webhook endpoint if needed separately

## Checklist

- [ ] All 6 routes respond correctly
- [ ] `GET /session-status` returns `product` object
- [ ] `FIREBASE_SERVICE_ACCOUNT_JSON` set on Render
- [ ] `ALLOWED_ORIGINS` includes dev + production URLs
- [ ] Card and PromptPay enabled in Stripe Dashboard (THB)
- [ ] Test: checkout → success → Firestore `users/{id}` has `paid: true`
