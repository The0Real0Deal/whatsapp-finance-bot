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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `חלץ פרטי תנועה כספית. החזר רק JSON תקין ללא markdown. פורמט: {"amount": מספר, "category": "טקסט", "description": "טקסט", "type": "הוצאה/הכנסה", "payment_method": "אשראי/מזומן/ביט"}\nקלט: ${text}`;

    const gRes = await axios.post(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    let rawResponse = gRes.data.candidates[0].content.parts[0].text;
    rawResponse = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim(); // ניקוי אוטומטי של markdown
    parsedData = JSON.parse(rawResponse);
    console.log("   V פיענוח עבר בהצלחה:", parsedData);
  } catch (err) {
    console.error("❌ תקלה בשלב 2 (Gemini):", err.response?.data || err.message);
    return;
  }

  // 3. שמירת התנועה ב-Supabase
  try {
    console.log("[3] שומר תנועה בטבלת transactions...");
    const { error: txErr } = await supabase.from("transactions").insert([{
      user_id: userId,
      amount: parsedData.amount,
      category: parsedData.category,
      description: parsedData.description,
      type: parsedData.type,
      payment_method: parsedData.payment_method
    }]);
    if (txErr) throw txErr;
  } catch (err) {
    console.error("❌ תקלה בשלב 3 (שמירת תנועה):", err.message || err);
    return;
  }

  // 4. שליחת התשובה לוואטסאפ
  try {
    console.log("[4] שולח תשובה חזרה לוואטסאפ...");
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    await axios.post(
      metaUrl,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: `✅ ${parsedData.type} של ${parsedData.amount} ₪ (${parsedData.category}) נרשמה בהצלחה!` }
      },
      { headers: { Authorization: `Bearer ${waToken}` } }
    );
    console.log("✅ הכל עבד! התשובה נשלחה.");
  } catch (err) {
    console.error("❌ תקלה בשלב 4 (שליחה לווצאפ):", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
