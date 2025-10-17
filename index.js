// GoldenChatAI Unified Backend — Free + Advanced AI + Golden Sync
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

dotenv.config();
const app = express();
app.set("trust proxy", 1);

// ─────────────────────────────────────────────
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
// Static files (no folders needed)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// ─────────────────────────────────────────────
// Helper: Load GoldenSpaceAI DB if available
function loadGoldenDB() {
  const pathDB = "/data/golden_database.json";
  try {
    if (fs.existsSync(pathDB)) {
      const raw = fs.readFileSync(pathDB, "utf8");
      return raw.trim() ? JSON.parse(raw) : { users: {} };
    }
  } catch (e) {
    console.error("Golden DB read error:", e);
  }
  return { users: {} };
}
function getUserId(req) {
  return req.user ? `${req.user.id}@${req.user.provider}` : null;
}

// ─────────────────────────────────────────────
// Passport Google
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

// Passport GitHub
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
// API: /api/me → Returns name & Golden balance
app.get("/api/me", (req, res) => {
  if (!req.user) return res.json({ loggedIn: false, balance: 0 });
  const db = loadGoldenDB();
  const id = getUserId(req);
  const userDB = db.users[id];
  const bal = userDB?.golden_balance || 0;
  res.json({ loggedIn: true, name: req.user.name, balance: bal });
});

// ─────────────────────────────────────────────
// Chat endpoints
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Free AI chat
app.post("/chat-advanced-ai", async (req, res) => {
  const { q, model } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: q || "Hello" }],
      max_tokens: 800,
    });
    const reply = completion.choices[0]?.message?.content || "لا توجد إجابة.";
    res.json({ reply });
  } catch (e) {
    console.error("AI error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Placeholder for paid advanced AI (40 G)
app.post("/chat-advanced-pro", async (req, res) => {
  const { q, model } = req.body;
  try {
    const completion = await openai.chat.completions.create({
      model: model || "gpt-5", // upgrade later
      messages: [{ role: "user", content: q || "مرحبا" }],
      max_tokens: 1200,
    });
    const reply = completion.choices[0]?.message?.content || "لا توجد إجابة.";
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// Default routes
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:page.html", (req, res) => res.sendFile(path.join(__dirname, req.params.page + ".html")));

app.get("/health", (_req, res) => res.json({ status: "OK", time: new Date().toISOString() }));

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoldenChatAI running on port ${PORT}`);
});
