require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ===== SETUP =====
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// ===== GEMINI SMART REPLY =====
async function getSmartReply(userMessage, leadName, projectName, conversationHistory) {
  try {
    const prompt = `
    Tu ek real estate sales executive hai jiska naam "VASU" hai.
    Tu WhatsApp pe buyers se personally baat kar raha hai.

    Lead ka naam: ${leadName}
    Project: ${projectName || 'Green Valley Apartments'}

    Pichli conversation:
    ${conversationHistory}

    Buyer ka naya message: "${userMessage}"

    Strict rules — inn rules ko kabhi mat todna:
    - Khud ko AI ya bot mat bolna — tu ek insaan hai
    - Naam "Rahul" use karna agar zaroorat ho
    - Hinglish mein baat kar — jaise real sales executive karta hai
    - Maximum 3-4 lines ka reply — chota aur natural
    - Brackets ya placeholders bilkul mat likhna jaise [mention this]
    - Emojis zyada mat use karna — sirf 1 maximum per message
    - Seedha helpful bano — bakwaas nahi
    - Agar project details nahi pata toh bol "main abhi check karke batata hoon"
    - Buyer ko feel hona chahiye ki ek real insaan se baat ho rahi hai

    Sirf reply likh — koi heading, explanation nahi.
    `;

    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    console.error('Gemini error:', err.message);
    return `Shukriya! 😊 Main abhi thoda busy hoon, kya aap thodi der baad try kar sakte hain? Ya seedha call karein! 📞`;
  }
}

// ===== NEW LEAD AAYA =====
app.post('/new-lead', async (req, res) => {
  try {
    const { name, phone, source, project } = req.body;
    const cleanPhone = phone.replace(/\D/g, '').slice(-10);
    const toNumber = `whatsapp:+91${cleanPhone}`;

    // Supabase mein lead save karo
    const { error: dbError } = await supabase
      .from('leads')
      .upsert({
        name,
        phone: cleanPhone,
        source: source || 'Website',
        project: project || 'NestAgent Project',
        status: 'contacted'
      }, { onConflict: 'phone' });

    if (dbError) console.error('DB Error:', dbError.message);

    // Pehla WhatsApp message
    const firstMessage = `Namaste ${name} ji! 🙏

Main *NestAgent AI* hoon — aapke liye hamesha available! 😊

Aapne *${project || 'hamare project'}* mein interest dikhaya — bahut shukriya!

Aap mujhse seedha pooch sakte hain:
💬 Project ki details
📅 Site visit booking  
💰 Price aur offers
❓ Koi bhi sawaal

Batao, main kaise help kar sakta hoon? 👇`;

    await twilioClient.messages.create({
      from: FROM_NUMBER,
      to: toNumber,
      body: firstMessage
    });

    // Message save karo
    await supabase.from('messages').insert({
      lead_phone: cleanPhone,
      direction: 'outgoing',
      message_text: firstMessage
    });

    console.log(`✅ Lead contacted: ${name} (${cleanPhone})`);
    res.json({ success: true, message: `WhatsApp sent to ${name}` });

  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== BUYER NE REPLY KIYA =====
app.post('/whatsapp-reply', async (req, res) => {
  try {
    const body = req.body || {};
    const incomingMessage = (body.Body || '').trim();
    const fromNumber = (body.From || '').replace('whatsapp:+91', '').replace('whatsapp:+', '');
    const cleanPhone = fromNumber.slice(-10);

    console.log(`📩 Reply from ${cleanPhone}: ${incomingMessage}`);

    // Lead dhundho database mein
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    const leadName = lead?.name || 'Aap';
    const projectName = lead?.project || 'hamare project';

    // Incoming message save karo
    await supabase.from('messages').insert({
      lead_phone: cleanPhone,
      direction: 'incoming',
      message_text: incomingMessage
    });

    // Pichli conversation history lo
    const { data: history } = await supabase
      .from('messages')
      .select('direction, message_text, created_at')
      .eq('lead_phone', cleanPhone)
      .order('created_at', { ascending: true })
      .limit(10);

    const conversationHistory = (history || [])
      .map(m => `${m.direction === 'incoming' ? 'Buyer' : 'Agent'}: ${m.message_text}`)
      .join('\n');

    // Gemini se smart reply lo
    const smartReply = await getSmartReply(
      incomingMessage,
      leadName,
      projectName,
      conversationHistory
    );

    // Lead status update karo
    await supabase
      .from('leads')
      .update({ status: 'in_conversation' })
      .eq('phone', cleanPhone);

    // Reply save karo
    await supabase.from('messages').insert({
      lead_phone: cleanPhone,
      direction: 'outgoing',
      message_text: smartReply
    });

    // TwiML format mein reply bhejo
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${smartReply}</Message>
</Response>`;

    res.type('text/xml');
    res.send(twiml);

  } catch (err) {
    console.error('❌ Reply error:', err.message);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Shukriya! Hum jald hi aapse contact karenge. 🙏</Message>
</Response>`;
    res.type('text/xml');
    res.send(twiml);
  }
});

// ===== LEADS DASHBOARD API =====
app.get('/leads', async (req, res) => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, leads: data });
});

// ===== CONVERSATION HISTORY =====
app.get('/conversation/:phone', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('lead_phone', req.params.phone)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, messages: data });
});

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    status: '🟢 NestAgent Backend Running',
    version: '2.0.0',
    agent: 'LeadWake Agent — Powered by Gemini AI',
    database: '✅ Supabase Connected',
    time: new Date().toLocaleString('en-IN')
  });
});

// ===== SERVER START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
🚀 NestAgent Backend v2.0 Started!
🌐 Port: ${PORT}
🤖 LeadWake Agent: Ready
🧠 Gemini AI: Connected
🗄️  Supabase: Connected
📱 WhatsApp: Connected
  `);
});