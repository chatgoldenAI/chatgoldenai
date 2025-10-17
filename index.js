// index.js — GoldenChatAI (Arabic AI System by GoldenSpaceAI)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cookieParser from "cookie-parser";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import multer from "multer";

dotenv.config();
const app = express();
app.set("trust proxy", 1);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "golden-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

// ===== Database =====
const GOLDEN_DB_FILE = "./golden_database.json";
function loadDB() {
  if (!fs.existsSync(GOLDEN_DB_FILE))
    fs.writeFileSync(GOLDEN_DB_FILE, JSON.stringify({ users: {} }, null, 2));
  const raw = fs.readFileSync(GOLDEN_DB_FILE, "utf8");
  return raw.trim() ? JSON.parse(raw) : { users: {} };
}
function saveDB(db) {
  fs.writeFileSync(GOLDEN_DB_FILE, JSON.stringify(db, null, 2));
}
function getUserID(req) {
  return req.user ? `${req.user.id}@${req.user.provider}` : null;
}

// ===== Passport (Google) =====
passport.serializeUser((u, d) => d(null, u));
passport.deserializeUser((o, d) => d(null, o));
app.use(passport.initialize());
app.use(passport.session());

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      (_a, _b, profile, done) => {
        const db = loadDB();
        const id = `${profile.id}@google`;
        if (!db.users[id]) {
          db.users[id] = {
            id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value || "",
            golden_balance: 0,
            subscriptions: {},
            created_at: new Date().toISOString()
          };
          saveDB(db);
        }
        done(null, {
          id: profile.id,
          name: profile.displayName,
          email: profile.emails?.[0]?.value || "",
          provider: "google",
        });
      }
    )
  );

  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/" }),
    (_req, res) => res.redirect("/index.html")
  );
}

// ====== AI Setup ======
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const upload = multer({ storage: multer.memoryStorage() });

function getProfile(req) {
  const db = loadDB();
  const id = getUserID(req);
  if (!id || !db.users[id]) return { golden_balance: 0, premium: false };
  const u = db.users[id];
  const subs = u.subscriptions || {};
  const premium = !!(subs["goldenchatai_premium"] || subs["chat_advancedai"]);
  return { golden_balance: u.golden_balance || 0, premium };
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: "Login required" });
}

function requirePremium(plan, isPremium) {
  if (plan === "premium" && !isPremium) throw new Error("PREMIUM_REQUIRED");
}

// ====== API Routes ======
app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ loggedIn: false, balance: 0 });
  const db = loadDB();
  const id = getUserID(req);
  const u = db.users[id];
  res.json({
    loggedIn: true,
    name: u?.name || "مستخدم",
    balance: u?.golden_balance || 0,
    subscriptions: u?.subscriptions || {}
  });
});

// Unlock feature (for 40G advanced AI)
app.post("/api/unlock-feature", requireLogin, (req, res) => {
  const { feature, cost } = req.body;
  const db = loadDB();
  const id = getUserID(req);
  const user = db.users[id];
  if (!user) return res.status(404).json({ error: "User not found" });
  if ((user.golden_balance || 0) < cost) return res.status(400).json({ error: "رصيد غير كافٍ" });

  user.golden_balance -= cost;
  user.subscriptions = user.subscriptions || {};
  const exp = new Date();
  exp.setDate(exp.getDate() + 30);
  user.subscriptions[feature] = exp.toISOString();
  saveDB(db);
  res.json({ success: true, newBalance: user.golden_balance });
});

// Chat endpoint
app.post("/api/goldenchatai/chat", requireLogin, express.json(), async (req, res) => {
  try {
    const { messages = [], model = "openai:gpt-4o-mini", plan = "free" } = req.body;
    const { premium } = getProfile(req);
    requirePremium(plan, premium);

    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 800,
    });
    const reply = completion.choices?.[0]?.message?.content || "لا يوجد رد.";
    res.json({ reply });
  } catch (e) {
    if (e.message === "PREMIUM_REQUIRED")
      return res.status(402).json({ error: "الخطة المميزة مطلوبة." });
    res.status(500).json({ error: e.message });
  }
});

// Image endpoint
app.post("/api/goldenchatai/image", requireLogin, upload.single("image"), async (req, res) => {
  try {
    const { prompt = "", plan = "free" } = req.body;
    const { premium } = getProfile(req);
    requirePremium(plan, premium);
    const result = await openai.images.generate({
      model: "gpt-image-1",
      prompt: prompt || "golden arabic ai wallpaper",
      size: "512x512",
    });
    const b64 = result.data?.[0]?.b64_json;
    res.json({ url: `data:image/png;base64,${b64}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve HTMLs
app.get("/", (_req, res) => res.sendFile(process.cwd() + "/index.html"));
app.get("/:page.html", (req, res) => res.sendFile(process.cwd() + "/" + req.params.page + ".html"));

// ====== Start ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 GoldenChatAI running on port ${PORT}`));
