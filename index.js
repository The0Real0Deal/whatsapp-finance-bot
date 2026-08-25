// 2. פיענוח בעזרת Gemini
  let parsedData;
  try {
    console.log("[2] שולח טקסט לפיענוח ב-Gemini...");
    
    if (!geminiKey) {
      throw new Error("משתנה הסביבה GEMINI_API_KEY חסר או ריק ב-Render!");
    }

    // שימוש במודל 2.0 העדכני
    const geminiUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";
    const prompt = `חלץ פרטי תנועה כספית מהטקסט. החזר JSON בלבד ללא Markdown.
מבנה:
{
  "amount": מספר,
  "category": "טקסט",
  "description": "טקסט",
  "type": "הוצאה" או "הכנסה",
  "payment_method": "אשראי" או "מזומן" או "ביט"
}
קלט: ${text}`;

    const gRes = await axios.post(
      geminiUrl,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey
        }
      }
    );

    let rawResponse = gRes.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawResponse) throw new Error("לא התקבלה תשובה מ-Gemini");

    parsedData = JSON.parse(rawResponse.trim());
    console.log("   V פיענוח עבר בהצלחה:", parsedData);
  } catch (err) {
    console.error("❌ תקלה בשלב 2 (Gemini):", err.response?.data || err.message);
    return;
  }
