// GoldenChatAI Unified Backend — Free + Advanced AI + Golden Sync via API
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import fs from "fs";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.set("trust proxy", 1);

// ─────────────────────────────────────────────
// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "golden-secret",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));
app.use(passport.initialize());
app.use(passport.session());

// ─────────────────────────────────────────────
// Static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// ─────────────────────────────────────────────
// Google OAuth
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
        proxy: true,
      },
      (_a, _b, profile, done) => {
        const user = {
          id: profile.id,
          name: profile.displayName,
          email: profile.emails?.[0]?.value || "",
          photo: profile.photos?.[0]?.value || "",
          provider: "google",
        };
        done(null, user);
      }
    )
  );
  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login-signup.html" }),
    (_req, res) => res.redirect("/index.html")
  );
}

// GitHub OAuth
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: "/auth/github/callback",
        proxy: true,
      },
      (_a, _b, profile, done) => {
        const user = {
          id: profile.id,
          name: profile.displayName || profile.username,
          email: profile.emails?.[0]?.value || `${profile.username}@github.user`,
          photo: profile.photos?.[0]?.value || "",
          provider: "github",
        };
        done(null, user);
      }
    )
  );
  app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));
  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login-signup.html" }),
    (_req, res) => res.redirect("/index.html")
  );
}

// ─────────────────────────────────────────────
// Logout
app.post("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

// ─────────────────────────────────────────────
// /api/me → User info + balance
app.get("/api/me", async (req, res) => {
  if (!req.user) return res.json({ loggedIn: false, balance: 0 });
  try {
    const userEmail = req.user.email;
    const api = `https://www.goldenspaceai.space/api/user-balance?email=${encodeURIComponent(userEmail)}`;
    const r = await fetch(api);
    const d = await r.json();

    res.json({
      loggedIn: true,
      name: req.user.name,
      balance: d.balance || 0,
    });
  } catch (e) {
    console.error("Balance fetch failed:", e.message);
    res.json({ loggedIn: true, name: req.user.name, balance: 0 });
  }
});

// ─────────────────────────────────────────────
// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Free AI Chat
app.post("/chat-free-ai", async (req, res) => {
  const { q } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: q || "مرحباً" }],
      max_tokens: 800,
    });
    const reply = completion.choices[0]?.message?.content || "لا توجد إجابة.";
    res.json({ reply });
  } catch (e) {
    console.error("AI error:", e.message);
    res.status(500).json({ error: "فشل في الاتصال بالذكاء الاصطناعي." });
  }
});

// Advanced AI Chat
app.post("/chat-advanced-ai", async (req, res) => {
  const { q, model } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: model || "gpt-5",
      messages: [{ role: "user", content: q || "مرحباً أيها الذكاء المتقدم" }],
      max_tokens: 1200,
    });
    const reply = completion.choices[0]?.message?.content || "لا توجد إجابة.";
    res.json({ reply });
  } catch (e) {
    console.error("Advanced AI error:", e.message);
    res.status(500).json({ error: "فشل في الاتصال بالذكاء الاصطناعي المتقدم." });
  }
});

// ─────────────────────────────────────────────
// Serve all HTML pages (index, nplans, terms, etc.)
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:page.html", (req, res) => {
  const filePath = path.join(__dirname, `${req.params.page}.html`);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("الصفحة غير موجودة");
});

// ─────────────────────────────────────────────
// Health check
app.get("/health", (_req, res) => res.json({ status: "OK", time: new Date().toISOString() }));

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoldenChatAI running on port ${PORT}`);
});
