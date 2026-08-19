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
  
  // מדפיס כל מידע גולמי שמגיע ממטא כדי לוודא חיבור
  console.log("📥 Raw webhook event:", JSON.stringify(req.body));

  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message || message.type !== "text") return;

  const from = message.from;
  const text = message.text.body;

  try {
    console.log(`📩 הודעה התקבלה מ-${from}: "${text}"`);

    let { data: user } = await supabase.from("users").select("id").eq("phone_number", from).maybeSingle();
    if (!user) {
      const { data: newUser, error: insertErr } = await supabase.from("users").insert([{ phone_number: from }]).select().single();
      if (insertErr) throw insertErr;
      user = newUser;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `חלץ פרטי תנועה כספית והחזר JSON בלבד ללא markdown: {"amount": מספר, "category": "אוכל וסופר / מסעדות / תחבורה / חשבונות / קניות / שונות", "description": "תיאור קצר", "type": "הוצאה או הכנסה", "payment_method": "אשראי/מזומן/ביט"}\nקלט: ${text}`;

    const gRes = await axios.post(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(gRes.data.candidates[0].content.parts[0].text);
    console.log("🤖 פענוח Gemini:", parsed);

    if (parsed?.amount) {
      await supabase.from("transactions").insert([{
        user_id: user.id,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
        type: parsed.type,
        payment_method: parsed.payment_method
      }]);

const phoneId = "1215733358296085"; 
const metaUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
console.log("🔗 URL being requested:", metaUrl);

      await axios.post(
        metaUrl,
        {
          messaging_product: "whatsapp",
          to: from,
          type: "text",
          text: { body: `✅ ${parsed.type} של ${parsed.amount} ₪ (${parsed.category}) נרשמה בהצלחה!` }
        },
        { headers: { Authorization: `Bearer ${process.env.WA_TOKEN?.trim()}` } }
      );

      console.log("🚀 תגובה נשלחה בהצלחה לוואטסאפ!");
    }
  } catch (err) {
    console.error("Webhook Error:", err.response?.data || err.message || err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
