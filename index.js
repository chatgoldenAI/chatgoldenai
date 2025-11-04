// GoldenArabicAI Unified Backend — Full Integration & Stable DALL·E 3
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

// =============== Core Middleware ===============
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "golden-arabic-secret",
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

// =============== Static Setup ===============
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve current folder as root (includes index.html). maxAge:0 = no CDN/browser cache.
app.use(express.static(__dirname, { maxAge: 0 }));

// =============== OAuth Config (optional) ===============
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
          plan: "free",
        };
        done(null, user);
      }
    )
  );

  app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
  app.get(
    "/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login-signup.html" }),
    (_req, res) => res.redirect("/")
  );
}

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
          plan: "free",
        };
        done(null, user);
      }
    )
  );

  app.get("/auth/github", passport.authenticate("github", { scope: ["user:email"] }));
  app.get(
    "/auth/github/callback",
    passport.authenticate("github", { failureRedirect: "/login-signup.html" }),
    (_req, res) => res.redirect("/")
  );
}

// =============== Logout ===============
app.post("/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

// =============== User Info (optional) ===============
app.get("/api/me", async (req, res) => {
  if (!req.user) {
    return res.json({ loggedIn: false, plan: "free", balance: 0 });
  }

  res.json({
    loggedIn: true,
    name: req.user.name,
    email: req.user.email,
    photo: req.user.photo || "/default-avatar.png",
    plan: "free",
    balance: 0,
    joinDate: new Date().toISOString().split("T")[0],
  });
});

// =============== OpenAI Setup ===============
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY is not set. /api/chat will fail for AI calls.");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const arabicPrompts = {
  chat: `أنت مساعد ذكي عربي متعدد الاستخدامات اسمه "GoldenArabicAI".
  أجب باحترافية ووضوح باللغة العربية.`,
  image: `أنت مساعد لتحسين وصف الصور لـ DALL·E 3.`,
  code: `أنت خبير في البرمجة، أنشئ أكواد نظيفة وفعالة.`,
  translate: `أنت مترجم محترف، ترجم النص بدقة مع الحفاظ على المعنى.`,
};

// =============== Helpers ===============
function sendError(res, status, msgAr, debug = null) {
  if (debug) console.error("[API ERROR]", debug);
  return res.status(status).json({ error: msgAr, arabicError: msgAr });
}

// =============== Core AI Endpoint ===============
app.post("/api/chat", async (req, res) => {
  const { message, actionType, model = "gpt-4o-mini" } = req.body;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return sendError(res, 400, "الرسالة فارغة");
  }
  if (!process.env.OPENAI_API_KEY) {
    return sendError(res, 500, "مفتاح OpenAI غير مضبوط على الخادم.");
  }

  try {
    let result;
    switch ((actionType || "chat").toLowerCase()) {
      case "image":
        result = await handleImageGeneration(message);
        break;
      case "code":
        result = await handleCodeGeneration(message);
        break;
      case "translate":
        result = await handleTranslation(message);
        break;
      default:
        result = await handleChatCompletion(message, model);
    }
    res.json(result);
  } catch (error) {
    // Try to surface the real cause if available
    const msg =
      error?.response?.data?.error?.message ||
      error?.message ||
      "حدث خطأ أثناء المعالجة";
    return sendError(res, 500, msg, error);
  }
});

// =============== AI Handlers ===============
async function handleChatCompletion(message, model) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: arabicPrompts.chat },
      { role: "user", content: message },
    ],
    max_tokens: 1200,
    temperature: 0.8,
  });

  const reply = completion.choices?.[0]?.message?.content || "عذراً، لم أستطع توليد رد.";
  return { type: "text", content: reply, timestamp: new Date().toISOString() };
}

async function handleImageGeneration(prompt) {
  // Light enhancement for DALL·E 3 in English
  const enhanced = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a DALL·E 3 prompt improver. Rewrite prompts in clear, concise English. No markdown.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 180,
    temperature: 0.6,
  });

  const enhancedPrompt = enhanced.choices?.[0]?.message?.content?.trim() || prompt;

  // ✅ DALL·E 3 generation
  const img = await openai.images.generate({
    model: "dall-e-3",
    prompt: enhancedPrompt,
    size: "1024x1024", // valid sizes: "1024x1024", "1792x1024", "1024x1792"
    quality: "standard", // or "hd"
    n: 1,
  });

  const url = img.data?.[0]?.url;
  if (!url) throw new Error("لم يتم إرجاع رابط الصورة من DALL·E 3");

  return {
    type: "image",
    content: url,
    prompt,
    enhancedPrompt,
    timestamp: new Date().toISOString(),
    message: `تم إنشاء الصورة بنجاح بناءً على طلبك: "${prompt}"`,
  };
}

async function handleCodeGeneration(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: arabicPrompts.code },
      { role: "user", content: message },
    ],
    temperature: 0.3,
  });

  const code = completion.choices?.[0]?.message?.content || "// لم يتم توليد كود";
  return { type: "code", content: code, message: "تم إنشاء الكود بنجاح" };
}

async function handleTranslation(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: arabicPrompts.translate },
      { role: "user", content: message },
    ],
    temperature: 0.2,
  });

  const translation = completion.choices?.[0]?.message?.content || "لم يتم الترجمة";
  return { type: "translation", content: translation };
}

// =============== Routes ===============
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Direct access for other pages like /plans.html, /login-signup.html, etc.
app.get("/:page", (req, res) => {
  const safePage = (req.params.page || "").replace(/[^a-zA-Z0-9-_]/g, "");
  const filePathHtml = path.join(__dirname, `${safePage}.html`);
  if (fs.existsSync(filePathHtml)) return res.sendFile(filePathHtml);
  return res.status(404).send("الصفحة غير موجودة");
});

// Health check
app.get("/health", (_req, res) =>
  res.json({
    status: "OK",
    service: "GoldenArabicAI",
    time: new Date().toISOString(),
  })
);

// =============== Start Server ===============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoldenArabicAI running on port ${PORT}`);
  console.log(`✅ Serving static files & AI endpoints (public access enabled)`);
  console.log(`🖼️ DALL·E 3 image generation active`);
});
