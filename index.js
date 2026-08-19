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

  try {
    let { data: user } = await supabase.from("users").select("id").eq("phone_number", from).single();
    if (!user) {
      const { data: newUser } = await supabase.from("users").insert([{ phone_number: from }]).select().single();
      user = newUser;
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const prompt = `חלץ פרטי תנועה כספית והחזר JSON בלבד ללא markdown: {"amount": מספר, "category": "אוכל וסופר / מסעדות / תחבורה / חשבונות / קניות / שונות", "description": "תיאור קצר", "type": "הוצאה או הכנסה", "payment_method": "אשראי/מזומן/ביט"}\nקלט: ${text}`;

    const gRes = await axios.post(geminiUrl, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    });

    const parsed = JSON.parse(gRes.data.candidates[0].content.parts[0].text);

    if (parsed?.amount) {
      await supabase.from("transactions").insert([{
        user_id: user.id,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
        type: parsed.type,
        payment_method: parsed.payment_method
      }]);

      await axios.post(
        `https://graph.facebook.com/v20.0/${process.env.WA_PHONE_ID}/messages`,
        { messaging_product: "whatsapp", to: from, type: "text", text: { body: `✅ ${parsed.type} של ${parsed.amount} ₪ (${parsed.category}) נרשמה בהצלחה!` } },
        { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } }
      );
    }
  } catch (err) {
    console.error(err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
