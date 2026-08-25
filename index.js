import express from "express";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";

const app = express();
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration");
}

const supabase = createClient(supabaseUrl, supabaseKey);

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
  const phoneId = process.env.WA_PHONE_ID?.trim();
  const waToken = process.env.WA_TOKEN?.trim();
  const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

  console.log(`\n--- 📩 הודעה חדשה מ-${from}: "${text}" ---`);

  // 1. בדיקת / יצירת משתמש ב-Supabase
  let userId;
  try {
    let { data: user, error: selectErr } = await supabase
      .from("users")
      .select("id")
      .eq("phone_number", from)
      .maybeSingle();

    if (selectErr) throw selectErr;

    if (!user) {
      const { data: newUser, error: insertErr } = await supabase
        .from("users")
        .insert([{ phone_number: from }])
        .select("id")
        .single();
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
    if (!geminiKey) throw new Error("משתנה GEMINI_API_KEY חסר!");

    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const prompt = `חלץ פרטי תנועה כספית מהטקסט הבא. אם אין פרטי עסקה, החזר ערכים ריקים/null.\nקלט: ${text}`;

    const gRes = await axios.post(
      geminiUrl,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              amount: { type: "NUMBER" },
              category: { type: "STRING" },
              description: { type: "STRING" },
              type: { type: "STRING" },
              payment_method: { type: "STRING" },
              isValidTransaction: { type: "BOOLEAN" }
            },
            required: ["isValidTransaction"]
          }
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey
        }
      }
    );

    const rawResponse = gRes.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawResponse) throw new Error("לא התקבלה תשובה מ-Gemini");

    parsedData = JSON.parse(rawResponse.trim());
    if (!parsedData.isValidTransaction || !parsedData.amount) {
      throw new Error("ההודעה אינה מכילה פרטי עסקה תקינים");
    }
  } catch (err) {
    console.error("❌ תקלה בשלב 2 (Gemini):", err.response?.data || err.message);
    return;
  }

  // 3. שמירת התנועה ב-Supabase
  try {
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

  // 4. שליחת אישור לוואטסאפ
  try {
    const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    await axios.post(
      metaUrl,
      {
        messaging_product: "whatsapp",
        to: from,
        type: "text",
        text: { body: `✅ ${parsedData.type || "תנועה"} של ${parsedData.amount} ₪ (${parsedData.category || "ללא קטגוריה"}) נרשמה בהצלחה!` }
      },
      { headers: { Authorization: `Bearer ${waToken}` } }
    );
    console.log("✅ התשובה נשלחה בהצלחה.");
  } catch (err) {
    console.error("❌ תקלה בשלב 4 (שליחה לווצאפ):", err.response?.data || err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
