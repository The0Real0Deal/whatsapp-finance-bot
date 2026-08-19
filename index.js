import express from "express";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // 0. תמיד להחזיר 200 למטא כדי שלא יחשבו שהשרת נפל
  res.sendStatus(200);

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== "text") return;

  const from = message.from;
  const text = message.text.body;
  const phoneId = process.env.WA_PHONE_ID?.trim() || "1215733358296085"; // שימוש אוטומטי במזהה שלך
  const waToken = process.env.WA_TOKEN?.trim();

  console.log(`\n--- 📩 הודעה חדשה מ-${from}: "${text}" ---`);

  // 1. בדיקת משתמש ב-Supabase
  let userId;
  try {
    console.log("[1] בודק משתמש ב-Supabase...");
    let { data: user } = await supabase.from("users").select("id").eq("phone_number", from).maybeSingle();
    if (!user) {
      const { data: newUser, error: insertErr } = await supabase.from("users").insert([{ phone_number: from }]).select().single();
      if (insertErr) throw insertErr;
      user = newUser;
    }
    userId = user.id;
  } catch (err) {
    console.error("❌ תקלה בשלב 1 (משתמש):", err.message || err);
    return;
  }

  // 2. פיענוח בעזרת Gemini
  let parsedData;
  try {
    console.log("[2] שולח טקסט לפיענוח ב-Gemini...");
    const geminiUrl = `
