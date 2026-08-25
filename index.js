require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');

// אתחול שרת HTTP לשמירה על פעילות ב-Render
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active and running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// אתחול Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-1.5-flash',
  generationConfig: { responseMimeType: 'application/json' }
});

// אתחול Google Sheets API
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// אתחול בוט טלגרם
const bot = new Telegraf(process.env.BOT_TOKEN);

const SYSTEM_PROMPT = `
חלץ מהודעת הטקסט את פרטי ההוצאה והחזר JSON בלבד במבנה הבא:
{
  "isExpense": boolean, // true אם הטקסט אכן מתאר הוצאה כספית, false אחרת
  "date": "YYYY-MM-DD", // השתמש בתאריך היום אם לא צוין אחרת
  "category": "string", // סופר, מסעדות, דלק, בילויים, חשבונות, שונות וכו'
  "item": "string", // תיאור קצר של מה שנקנה
  "amount": number, // סכום בלבד כמספר
  "paymentMethod": "string" // אשראי, מזומן, ביט, העברה וכו' (ברירת מחדל: אשראי)
}
`;

bot.start((ctx) => {
  ctx.reply('שלום! שלח לי הודעה עם פרטי ההוצאה שלך (לדוגמה: "קניתי פיצה ב-60 שקל באשראי") ואוסיף אותה ישירות לטבלה.');
});

bot.on('text', async (ctx) => {
  const userText = ctx.message.text;
  const today = new Date().toISOString().split('T')[0];

  try {
    await ctx.sendChatAction('typing');

    // 1. פענוח הטקסט בעזרת Gemini
    const prompt = `${SYSTEM_PROMPT}\nתאריך היום: ${today}\nהטקסט לניתוח: "${userText}"`;
    const result = await model.generateContent(prompt);
    const parsedData = JSON.parse(result.response.text());

    if (!parsedData.isExpense || !parsedData.amount) {
      return ctx.reply('לא הצלחתי לזהות הוצאה בהודעה. נסה לנסח מחדש (למשל: "דלק 200 ש״ח במזומן").');
    }

    // 2. שמירה ב-Google Sheets
    const rowData = [
      parsedData.date,
      parsedData.category,
      parsedData.item,
      parsedData.amount,
      parsedData.paymentMethod
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: 'Sheet1!A:E',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowData] }
    });

    // 3. אישור למשתמש
    ctx.reply(
      ` נרשם בהצלחה בטבלה!\n` +
      ` תאריך: ${parsedData.date}\n` +
      ` סכום: ₪${parsedData.amount}\n` +
      ` קטגוריה: ${parsedData.category}\n` +
      ` פירוט: ${parsedData.item}\n` +
      ` תשלום: ${parsedData.paymentMethod}`
    );

  } catch (error) {
    console.error('Error processing expense:', error);
    ctx.reply('אירעה שגיאה בעיבוד ההוצאה. אנא נסה שוב מאוחר יותר.');
  }
});

// הפעלת הבוט
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
