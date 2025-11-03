// GoldenArabicAI Unified Backend — Enhanced with Real AI Responses
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

// ─────────────────────────────────────────────
// Static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(__dirname));

// ─────────────────────────────────────────────
// OAuth Configuration
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
          plan: "free" // Always set to free
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
          plan: "free" // Always set to free
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
// User info + profile
app.get("/api/me", async (req, res) => {
  if (!req.user) return res.json({ loggedIn: false, plan: "free", balance: 0 });
  
  try {
    const userEmail = req.user.email;
    
    res.json({
      loggedIn: true,
      name: req.user.name,
      email: req.user.email,
      photo: req.user.photo || "/default-avatar.png",
      plan: "free", // Always free plan
      balance: 0, // Free plan has 0 balance
      joinDate: new Date().toISOString().split('T')[0]
    });
  } catch (e) {
    console.error("Profile fetch failed:", e.message);
    res.json({ 
      loggedIn: true, 
      name: req.user.name, 
      email: req.user.email,
      photo: req.user.photo || "/default-avatar.png",
      plan: "free",
      balance: 0,
      joinDate: new Date().toISOString().split('T')[0]
    });
  }
});

// ─────────────────────────────────────────────
// OpenAI setup
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

// Arabic Response Templates for different contexts
const arabicPrompts = {
  chat: `أنت مساعد ذكي عربي متعدد الاستخدامات اسمك "GoldenArabicAI". 
  قدم إجابات مفيدة ودقيقة باللغة العربية الفصحى أو العامية حسب سياق السؤال.
  كن مهذباً ومفيداً وواضحاً في جميع ردودك.
  لا تذكر أنك ذكاء اصطناعي إلا إذا طُلب منك ذلك.
  أجب بشكل طبيعي كما لو كنت شخصاً حقيقياً يتحدث مع المستخدم.`,

  image: `أنت مساعد متخصص في وصف الصور للذكاء الاصطناعي. 
  قم بتحسين طلبات الصور لجعلها أكثر وضوحاً وجاذبية لـ DALL-E 3.
  أضف تفاصيل حول الألوان والتركيب والجو العام.
  قدم الرد باللغة العربية بطريقة طبيعية.`,

  code: `أنت مساعد برمجي خبير. قم بإنشاء كود نظيف وفعال بناءً على طلب المستخدم.
  قدم الكود مع التنسيق المناسب واشرح باللغة العربية إذا لزم الأمر.
  تأكد من أن الكود يعمل بشكل صحيح وسهل الفهم.`,

  translate: `أنت مترجم محترف. قم بترجمة النص بدقة مع الحفاظ على السياق والمعنى.
  قدم الترجمة بلغة واضحة وطبيعية.
  إذا كان النص يحتوي على مصطلحات تقنية، فقم بشرحها بشكل مناسب.`
};

// Unified Chat Endpoint - Real AI Responses
app.post("/api/chat", async (req, res) => {
  const { message, actionType, model = "gpt-4o-mini" } = req.body;
  
  // Check if user is authenticated
  if (!req.user) {
    return res.status(401).json({ 
      error: "يجب تسجيل الدخول أولاً",
      arabicError: "يرجى تسجيل الدخول لاستخدام الذكاء الاصطناعي"
    });
  }

  try {
    let result;

    switch (actionType) {
      case "chat":
        result = await handleChatCompletion(message, model);
        break;
      
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

    // Save to chat history
    saveChatMessage(req.user.email, message, result, actionType);
    
    res.json(result);
  } catch (error) {
    console.error("API Error:", error.message);
    
    const errorMessages = {
      "image": "عذراً، حدث خطأ أثناء إنشاء الصورة. يرجى المحاولة مرة أخرى.",
      "code": "عذراً، حدث خطأ أثناء إنشاء الكود. يرجى المحاولة مرة أخرى.", 
      "translate": "عذراً، حدث خطأ أثناء الترجمة. يرجى المحاولة مرة أخرى.",
      "default": "عذراً، حدث خطأ في الاتصال بالذكاء الاصطناعي. يرجى المحاولة مرة أخرى."
    };

    res.status(500).json({
      error: error.message,
      arabicError: errorMessages[actionType] || errorMessages.default
    });
  }
});

// Real Chat Completion Handler - No more "thank you for your message"
async function handleChatCompletion(message, model = "gpt-4o-mini") {
  const completion = await openai.chat.completions.create({
    model: model,
    messages: [
      {
        role: "system",
        content: arabicPrompts.chat
      },
      { role: "user", content: message }
    ],
    max_tokens: 1200,
    temperature: 0.8,
  });

  const reply = completion.choices[0]?.message?.content || "عذراً، لم أستطع توليد رد. يرجى المحاولة مرة أخرى.";
  
  return {
    type: "text",
    content: reply,
    timestamp: new Date().toISOString()
  };
}

// Real Image Generation Handler with DALL-E 3
async function handleImageGeneration(prompt) {
  // First, enhance the prompt for better image generation
  const enhancementPrompt = `
    قم بتحسين وصف الصورة التالية لجعلها أكثر وضوحاً وجاذبية لـ DALL-E 3:
    "${prompt}"
    
    أضف تفاصيل حول:
    - الألوان والإنارة
    - التركيب والتكوين
    - الجو والمشاعر
    - التفاصيل البصرية
    
    قدم الوصف المحسن باللغة الإنجليزية مع الحفاظ على الفكرة الأصلية.
  `;

  const enhancedCompletion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a prompt enhancer for DALL-E 3. Improve image descriptions while keeping the original intent."
      },
      { role: "user", content: enhancementPrompt }
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  const enhancedPrompt = enhancedCompletion.choices[0]?.message?.content || prompt;

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: enhancedPrompt,
    size: "1024x1024",
    quality: "standard",
    n: 1,
  });

  const imageUrl = response.data[0]?.url;
  
  if (!imageUrl) {
    throw new Error("Failed to generate image");
  }

  return {
    type: "image",
    content: imageUrl,
    prompt: prompt,
    enhancedPrompt: enhancedPrompt,
    timestamp: new Date().toISOString(),
    message: `تم إنشاء الصورة بنجاح بناءً على طلبك: "${prompt}"`
  };
}

// Real Code Generation Handler
async function handleCodeGeneration(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: arabicPrompts.code
      },
      { role: "user", content: `Generate code for: ${message}` }
    ],
    max_tokens: 1500,
    temperature: 0.3,
  });

  const code = completion.choices[0]?.message?.content || "// Unable to generate code";
  
  return {
    type: "code",
    content: code,
    timestamp: new Date().toISOString(),
    message: `تم إنشاء الكود بنجاح لـ: "${message}"`
  };
}

// Real Translation Handler
async function handleTranslation(message) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: arabicPrompts.translate
      },
      { role: "user", content: `Translate this text accurately: ${message}` }
    ],
    max_tokens: 1000,
    temperature: 0.2,
  });

  const translation = completion.choices[0]?.message?.content || "Translation unavailable";
  
  return {
    type: "translation", 
    content: translation,
    timestamp: new Date().toISOString(),
    message: `تمت الترجمة بنجاح للنص المطلوب`
  };
}

// Get Available Models
app.get("/api/models", async (req, res) => {
  try {
    const models = await openai.models.list();
    const availableModels = models.data
      .filter(model => 
        model.id.includes('gpt') || 
        model.id.includes('dall-e')
      )
      .map(model => ({
        id: model.id,
        name: model.id
      }));

    res.json({ models: availableModels });
  } catch (error) {
    console.error("Models fetch error:", error);
    res.json({ 
      models: [
        { id: "gpt-4o-mini", name: "GPT-4o Mini" },
        { id: "gpt-4", name: "GPT-4" },
        { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" }
      ] 
    });
  }
});

// Chat History Management
const chatHistory = new Map();

app.get("/api/chat/history", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  const userHistory = chatHistory.get(req.user.email) || [];
  res.json({ history: userHistory });
});

app.delete("/api/chat/history", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  chatHistory.set(req.user.email, []);
  res.json({ success: true });
});

// Utility function to save chat message
function saveChatMessage(email, message, response, actionType) {
  if (!chatHistory.has(email)) {
    chatHistory.set(email, []);
  }

  const history = chatHistory.get(email);
  history.push({
    timestamp: new Date().toISOString(),
    userMessage: message,
    aiResponse: response,
    actionType: actionType
  });

  // Keep only last 50 messages per user
  if (history.length > 50) {
    chatHistory.set(email, history.slice(-50));
  }
}

// User Profile Update Endpoint
app.post("/api/profile/update", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  const { name } = req.body;
  if (name) {
    req.user.name = name;
  }

  res.json({
    success: true,
    message: "تم تحديث الملف الشخصي بنجاح",
    user: {
      name: req.user.name,
      email: req.user.email,
      photo: req.user.photo,
      plan: "free"
    }
  });
});

// Plan Information Endpoint
app.get("/api/plan", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "غير مصرح" });
  }

  res.json({
    plan: "free",
    features: [
      "محادثات ذكاء اصطناعي غير محدودة",
      "إنشاء الصور مع DALL-E 3",
      "كتابة ومراجعة الكود",
      "خدمات الترجمة",
      "دعم اللغة العربية الكامل"
    ],
    limits: {
      dailyChats: 100,
      dailyImages: 20,
      maxTokens: 4000
    },
    upgradeUrl: "/nplans.html"
  });
});

// ─────────────────────────────────────────────
// Serve HTML pages
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:page.html", (req, res) => {
  const filePath = path.join(__dirname, `${req.params.page}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("الصفحة غير موجودة");
  }
});

// Serve specific pages without .html extension
app.get("/:page", (req, res) => {
  const page = req.params.page;
  const allowedPages = ["login-signup", "nplans", "terms", "privacy", "refund"];
  
  if (allowedPages.includes(page)) {
    const filePath = path.join(__dirname, `${page}.html`);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).send("الصفحة غير موجودة");
    }
  } else {
    res.status(404).send("الصفحة غير موجودة");
  }
});

// ─────────────────────────────────────────────
// Health check
app.get("/health", (_req, res) => 
  res.json({ 
    status: "OK", 
    time: new Date().toISOString(),
    service: "GoldenArabicAI",
    features: ["real-ai-chat", "dalle-3", "code-generation", "translation"]
  })
);

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 GoldenArabicAI running on port ${PORT}`);
  console.log(`📝 Real AI chat enabled - No more 'thank you for your message'`);
  console.log(`🖼️ DALL-E 3 image generation with prompt enhancement`);
  console.log(`💼 All users on FREE plan with full features`);
  console.log(`👤 User profiles with photos and plan info`);
});
