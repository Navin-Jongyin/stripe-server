function parsePlanDurationDays(planName = "") {
  const trimmed = String(planName).trim();
  const name = trimmed.toLowerCase();

  const monthMatch = name.match(/(\d+)\s*month/);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  const yearMatch = name.match(/(\d+)\s*year/);
  if (yearMatch) return Number(yearMatch[1]) * 365;

  if (/\b1\s*month\b|\bmonthly\b/.test(name)) return 30;
  if (/\b3\s*month/.test(name)) return 90;
  if (/\b6\s*month/.test(name)) return 180;
  if (/\b1\s*year\b|\b12\s*month|\bannual\b/.test(name)) return 365;

  // Short access for test products without a year/month plan in the name
  if (/^test(\s+product)?$/i.test(trimmed) || /\btest\b/.test(name)) {
    return 5;
  }

  return 365;
}

function getFirebaseAdmin() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return null;
  }

  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(
          JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
        ),
      });
    }
    return admin;
  } catch (error) {
    console.error("Firebase Admin init failed:", error.message);
    return null;
  }
}

async function activateSubscriptionInFirestore({
  userId,
  authUid,
  planName,
  checkoutSessionId,
}) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return {
      ok: false,
      fallbackClient: true,
      error: "Firebase Admin is not configured on the server.",
    };
  }

  const db = admin.firestore();
  const durationDays = parsePlanDurationDays(planName);
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + durationDays * 86400000,
  );

  const candidates = [...new Set([userId, authUid].filter(Boolean))];
  let userRef = null;
  let existing = null;

  for (const id of candidates) {
    const ref = db.collection("users").doc(id);
    const snap = await ref.get();
    if (snap.exists) {
      userRef = ref;
      existing = snap.data() || {};
      break;
    }
  }

  if (!userRef) {
    return { ok: false, error: "User profile not found." };
  }

  const update = {
    paid: true,
    activatedAt: now,
    expiresAt,
    planName: planName || "Subscription",
  };

  if (checkoutSessionId) {
    update.lastCheckoutSessionId = checkoutSessionId;
  }

  if (!existing.authUid && authUid) {
    update.authUid = authUid;
  }

  await userRef.set(update, { merge: true });

  return {
    ok: true,
    userId: userRef.id,
    planName: update.planName,
    activatedAt: now,
    expiresAt,
    durationDays,
  };
}

module.exports = {
  parsePlanDurationDays,
  activateSubscriptionInFirestore,
};
