const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
let Pool;
try { ({ Pool } = require('pg')); } catch (_) { Pool = null; }

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATABASE_URL = process.env.DATABASE_URL || '';
const SESSION_DAYS = Math.max(1, Math.min(90, Number(process.env.SESSION_DAYS || 30)));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.7-flash';
const GEMINI_VIDEO_MODEL = process.env.GEMINI_VIDEO_MODEL || GEMINI_MODEL;
const pool = DATABASE_URL && Pool ? new Pool({ connectionString: DATABASE_URL, max: 5, idleTimeoutMillis: 30000 }) : null;
const cache = { at: 0, data: [] };
const authBuckets = new Map();
const RSS_URLS = [
  'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=13&Regid=22',
  'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1'
];

// Public sources used only to learn recurring topic/pattern tendencies. The AI is instructed not to reproduce paper text verbatim.
const EXAM_SOURCE_PAGES = [
  'https://www.marugujarat.in/old-question-papers-paper-solutions/',
  'https://www.sahebbharti.com/2024/05/gsssb-cce-exam-all-shift-paper-download.html',
  'https://www.adda247.com/exams/gujarat/gsssb-group-a-group-b-previous-year-question-papers/'
];
const EXAM_SOURCE_VIDEOS = [
  'https://www.youtube.com/watch?v=fXPZLobBEaU',
  'https://www.youtube.com/watch?v=N1MvwriKM5c',
  'https://www.youtube.com/watch?v=1J2h_1z2tO0'
];

const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon'
};

function securityHeaders(req, extra={}) {
  return {
    'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...extra
  };
}
function send(req,res,status,body,type='application/json; charset=utf-8',extra={}) {
  res.writeHead(status,securityHeaders(req,{'Content-Type':type,'Cache-Control':'no-store',...extra})); res.end(body);
}
function json(req,res,status,obj,extra={}) { send(req,res,status,JSON.stringify(obj),'application/json; charset=utf-8',extra); }

function decodeXml(s='') { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); }
function tag(block,name){ const m=block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i')); return m?decodeXml(m[1]):''; }
function parseRss(xml){ return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(m=>m[0]).map(block=>({title:tag(block,'title'),link:tag(block,'link'),pubDate:tag(block,'pubDate')})).filter(x=>x.title&&x.link); }
async function fetchText(url){ const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),10000); try{ const r=await fetch(url,{signal:ctrl.signal,headers:{'User-Agent':'CCE-Adaptive100/3.0'}}); if(!r.ok)throw new Error(`HTTP ${r.status}`); return await r.text(); } finally { clearTimeout(t); } }
function formatDate(d){ const x=new Date(d); return Number.isNaN(x.getTime())?d:x.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function buildMcqs(items){ const unique=[],seen=new Set(); for(const it of items){const k=it.title.toLowerCase();if(!seen.has(k)){seen.add(k);unique.push(it);}} return unique.slice(0,40).map((it,idx)=>{const distractors=[];for(let j=1;distractors.length<3&&j<unique.length;j++){const cand=unique[(idx+j*3)%unique.length];if(cand.title!==it.title)distractors.push(cand.title);}const options=[it.title,...distractors].sort(()=>Math.random()-0.5);return{subject:'ga',topic:'Current Affairs • PIB',text:`PIB મુજબ ${formatDate(it.pubDate)} ના દિવસે પ્રકાશિત થયેલ headline કયું છે?`,options,answer:options.indexOf(it.title),explanation:`Official PIB feedમાં ${formatDate(it.pubDate)} ના દિવસે આ headline પ્રકાશિત થઈ હતી.`,source:'Press Information Bureau (PIB)',sourceUrl:it.link,pyqPattern:false,difficulty:'easy'};}); }
async function getCurrentAffairs(){ if(Date.now()-cache.at<30*60*1000&&cache.data.length)return cache.data;let items=[];for(const url of RSS_URLS){try{items=parseRss(await fetchText(url));if(items.length>=8)break;}catch(_){}}const data=buildMcqs(items);if(data.length){cache.at=Date.now();cache.data=data;}return data; }

async function readJson(req,limit=1024*1024){ return await new Promise((resolve,reject)=>{const chunks=[];let size=0;req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('BODY_TOO_LARGE'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{});}catch(_){reject(new Error('INVALID_JSON'));}});req.on('error',reject);}); }
function clientIp(req){return String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();}
function rateLimited(req,key,max=12,windowMs=15*60*1000){const k=`${clientIp(req)}|${key}`,now=Date.now(),arr=(authBuckets.get(k)||[]).filter(t=>now-t<windowMs);arr.push(now);authBuckets.set(k,arr);return arr.length>max;}
function parseCookies(req){const out={};(req.headers.cookie||'').split(';').forEach(part=>{const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());});return out;}
function sessionHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
function hashPassword(password,saltHex){return crypto.scryptSync(password,Buffer.from(saltHex,'hex'),64).toString('hex');}
function safeEqualHex(a,b){try{const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb);}catch(_){return false;}}
function isSecure(req){return String(req.headers['x-forwarded-proto']||'').toLowerCase()==='https'||process.env.NODE_ENV==='production';}
function sessionCookie(req,token,clear=false){const maxAge=clear?0:SESSION_DAYS*86400;return `cce_session=${clear?'':encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isSecure(req)?'; Secure':''}`;}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').toLowerCase())&&String(v).length<=180;}
function sanitizeName(v){return String(v||'').trim().replace(/\s+/g,' ').slice(0,80);}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch(_){return false;}}
function validSimple(v,max=100){return typeof v==='string'&&v.trim().length>0&&v.length<=max;}
function todayIndia(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}

async function initDb(){
  if(!pool)return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cce_users (id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,display_name TEXT NOT NULL DEFAULT '',password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS cce_sessions (token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES cce_users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS cce_sessions_user_idx ON cce_sessions(user_id);
    CREATE TABLE IF NOT EXISTS cce_progress (user_id BIGINT PRIMARY KEY REFERENCES cce_users(id) ON DELETE CASCADE,data JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS cce_topic_sets (
      id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES cce_users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,topic TEXT NOT NULL,set_no INTEGER NOT NULL,date_key TEXT NOT NULL,
      questions JSONB NOT NULL,source_mix JSONB NOT NULL DEFAULT '{}'::jsonb,status TEXT NOT NULL DEFAULT 'active',
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ,
      UNIQUE(user_id,subject,topic,set_no)
    );
    CREATE INDEX IF NOT EXISTS cce_topic_sets_lookup_idx ON cce_topic_sets(user_id,subject,topic,set_no DESC);
    CREATE TABLE IF NOT EXISTS cce_source_analysis (analysis_key TEXT PRIMARY KEY,data JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await pool.query('DELETE FROM cce_sessions WHERE expires_at<NOW()');
}
async function getAuth(req){if(!pool)return null;const token=parseCookies(req).cce_session;if(!token)return null;const {rows}=await pool.query(`SELECT u.id,u.email,u.display_name FROM cce_sessions s JOIN cce_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1`,[sessionHash(token)]);return rows[0]||null;}
async function createSession(req,user){const token=crypto.randomBytes(32).toString('base64url');await pool.query("INSERT INTO cce_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3::int*INTERVAL '1 day'))",[sessionHash(token),user.id,String(SESSION_DAYS)]);return sessionCookie(req,token,false);}

async function geminiClient(){ if(!GEMINI_API_KEY)throw new Error('GEMINI_NOT_CONFIGURED'); const mod=await import('@google/genai'); return new mod.GoogleGenAI({apiKey:GEMINI_API_KEY}); }
function parseJsonText(text){
  let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch(_){const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));throw new Error('AI returned invalid JSON');}
}
const FALLBACK_ANALYSIS={
  summary:'CCE 2024 papers repeatedly test fast arithmetic, direct reasoning patterns, grammar rules, Gujarat/India factual GK, and short conceptual questions. Build new questions from these recurring patterns rather than copying paper wording.',
  highFrequency:{reasoning:['Series','Coding-Decoding','Direction','Blood Relation','Rank/Analogy'],quant:['Percentage','Ratio','Profit-Loss','Average','Time-Work/Speed'],gujarati:['જોડણી','સમાનાર્થી/વિરુદ્ધાર્થી','રૂઢિપ્રયોગ/કહેવત'],english:['Tense','Article/Preposition','Vocabulary','Sentence correction'],ga:['Polity','Gujarat GK','Science','History/Geography']},
  sourcePages:EXAM_SOURCE_PAGES,sourceVideos:EXAM_SOURCE_VIDEOS
};
async function getSourceAnalysis(force=false){
  if(pool&&!force){const {rows}=await pool.query("SELECT data,updated_at FROM cce_source_analysis WHERE analysis_key='gsssb-cce-pyq-v1' LIMIT 1");if(rows[0])return rows[0].data;}
  // Keep normal question generation fast: online paper/video analysis is refreshed explicitly from the Sources tab,
  // then cached and reused. Until the first refresh, use the curated fallback pattern map.
  if(!force||!GEMINI_API_KEY)return FALLBACK_ANALYSIS;
  try{
    const ai=await geminiClient();
    const pageText=EXAM_SOURCE_PAGES.join('\n');
    const input=[
      {type:'text',text:`Analyze GSSSB CCE previous-paper patterns for study planning. Read these public pages with URL context:\n${pageText}\nAlso analyze the attached public YouTube paper-solution videos. Do NOT reproduce long/exact copyrighted question text. Extract only recurring topic types, common traps, difficulty, and question patterns. Return STRICT JSON only: {"summary":"...","highFrequency":{"reasoning":[],"quant":[],"gujarati":[],"english":[],"ga":[]},"recurringPatterns":[{"subject":"","topic":"","pattern":"","priority":1}],"videoInsights":[{"url":"","insight":""}]}`},
      ...EXAM_SOURCE_VIDEOS.slice(0,3).map(uri=>({type:'video',uri}))
    ];
    const interaction=await ai.interactions.create({model:GEMINI_VIDEO_MODEL,input,tools:[{type:'url_context'}]});
    const data=parseJsonText(interaction.outputText||interaction.output_text||'');
    data.sourcePages=EXAM_SOURCE_PAGES; data.sourceVideos=EXAM_SOURCE_VIDEOS;
    if(pool)await pool.query("INSERT INTO cce_source_analysis(analysis_key,data,updated_at) VALUES('gsssb-cce-pyq-v1',$1::jsonb,NOW()) ON CONFLICT(analysis_key) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",[JSON.stringify(data)]);
    return data;
  }catch(e){console.error('Source analysis fallback:',e.message);return FALLBACK_ANALYSIS;}
}
function compactMistakes(rows,subject,topic){
  const out=[];
  for(const row of rows){const qs=Array.isArray(row.questions)?row.questions:[];const sm=row.summary||{};const wrongIds=new Set(Array.isArray(sm.wrongIds)?sm.wrongIds:[]);for(const q of qs){if(wrongIds.has(String(q.id))){out.push({topic:q.topic||topic,text:String(q.text||'').slice(0,220),correct:String(q.options?.[q.answer]||'').slice(0,120),explanation:String(q.explanation||'').slice(0,260)});if(out.length>=30)return out;}}}
  return out;
}
function normalizeAiQuestion(q,idx,subject,topic){
  if(!q||typeof q!=='object')return null;const options=Array.isArray(q.options)?q.options.map(x=>String(x).trim()).filter(Boolean):[];const answer=Number(q.answer);
  if(!validSimple(String(q.text||''),900)||options.length!==4||!Number.isInteger(answer)||answer<0||answer>3)return null;
  return {
    id:`ai-${Date.now()}-${idx}-${crypto.randomBytes(4).toString('hex')}`,subject,topic,
    text:String(q.text).trim(),options,answer,
    explanation:String(q.explanation||'Correct option follows the standard rule/concept for this topic.').trim().slice(0,1200),
    source:String(q.source||'AI-generated from CCE/PYQ patterns').trim().slice(0,160),sourceUrl:String(q.sourceUrl||'').trim().slice(0,600),
    pyqPattern:!!q.pyqPattern,difficulty:['easy','medium','hard'].includes(q.difficulty)?q.difficulty:'medium',
    videoSearchTerms:String(q.videoSearchTerms||`${topic} GSSSB CCE Gujarati explanation`).trim().slice(0,220)
  };
}
async function generateAdaptiveQuestions({subject,topic,setNo,mistakes,analysis,currentAffairs}){
  const ai=await geminiClient();
  const hasMistakes=mistakes.length>0;
  const targetMix=hasMistakes?{mistakeVariants:55,pyqPattern:25,fresh:20}:{mistakeVariants:0,pyqPattern:40,fresh:60};
  const caContext=(subject==='ga'&&topic==='Current Affairs • PIB')?currentAffairs.slice(0,18).map(x=>({text:x.text,answer:x.options?.[x.answer],sourceUrl:x.sourceUrl})):[];
  const prompt=`You generate exam-practice MCQs for GSSSB CCE prelims. Create EXACTLY 100 ORIGINAL questions for subject=${subject}, topic=${topic}, adaptive set #${setNo}.
Language: Gujarati for reasoning, quantitative aptitude, GA and Gujarati; English for English subject, with Gujarati explanation allowed.
Question design: four options only. answer must be 0,1,2,3. Avoid ambiguous facts. For maths/reasoning, ensure calculations are correct. For static facts use stable reputable facts. Never copy long/verbatim questions from past papers or videos; imitate recurring exam PATTERNS only.
Adaptive mix target: ${targetMix.mistakeVariants}% new variants targeting prior mistakes/weak concepts; ${targetMix.pyqPattern}% PYQ-style recurring patterns; ${targetMix.fresh}% fresh coverage. If prior mistake list is empty, use 40% PYQ-style + 60% fresh.
Every question must include a concise step-by-step explanation, difficulty, pyqPattern boolean, source label, optional sourceUrl, and videoSearchTerms suitable for YouTube search.
Do not repeat the same numeric values/wording. Ensure all 100 questions are distinct.
Prior mistakes (concept signals only): ${JSON.stringify(mistakes)}
Previous-paper/video pattern analysis: ${JSON.stringify(analysis).slice(0,14000)}
Current-affairs context when relevant: ${JSON.stringify(caContext).slice(0,10000)}
Return STRICT JSON only with this shape: {"questions":[{"text":"","options":["","","",""],"answer":0,"explanation":"Step 1... Step 2...","difficulty":"easy|medium|hard","pyqPattern":true,"source":"","sourceUrl":"","videoSearchTerms":""}],"mix":{"mistakeVariants":0,"pyqPattern":0,"fresh":0},"note":""}`;
  const interaction=await ai.interactions.create({model:GEMINI_MODEL,input:prompt});
  const parsed=parseJsonText(interaction.outputText||interaction.output_text||'');
  let raw=Array.isArray(parsed.questions)?parsed.questions:[];
  const clean=[];const seen=new Set();
  for(let i=0;i<raw.length;i++){const q=normalizeAiQuestion(raw[i],i,subject,topic);if(!q)continue;const sig=q.text.toLowerCase().replace(/\s+/g,' ').slice(0,240);if(seen.has(sig))continue;seen.add(sig);clean.push(q);if(clean.length===100)break;}
  if(clean.length<100)throw new Error(`AI returned only ${clean.length} valid unique questions`);
  return {questions:clean,mix:parsed.mix||targetMix,note:String(parsed.note||'Adaptive 100 generated from weak areas + PYQ-style patterns.')};
}

async function handleApi(req,res,u){
  if(u.pathname==='/health')return json(req,res,200,{ok:true,service:'cce-adaptive100',database:!!pool,ai:!!GEMINI_API_KEY,model:GEMINI_MODEL});
  if(u.pathname==='/api/current-affairs'&&req.method==='GET'){try{const data=await getCurrentAffairs();return json(req,res,200,{ok:true,count:data.length,items:data});}catch(_){return json(req,res,200,{ok:false,count:0,items:[],error:'PIB feed unavailable; offline bank is active.'});}}
  if(!u.pathname.startsWith('/api/'))return false;
  if(!sameOrigin(req))return json(req,res,403,{ok:false,error:'Origin rejected'});

  if(u.pathname==='/api/auth/me'&&req.method==='GET'){if(!pool)return json(req,res,200,{ok:true,database:false,user:null,ai:!!GEMINI_API_KEY});const user=await getAuth(req);return json(req,res,200,{ok:true,database:true,ai:!!GEMINI_API_KEY,model:GEMINI_MODEL,user:user?{id:String(user.id),email:user.email,name:user.display_name}:null});}
  if(u.pathname==='/api/auth/register'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Cloud database is not configured. Add DATABASE_URL on Render.'});if(rateLimited(req,'register',8))return json(req,res,429,{ok:false,error:'Too many attempts. Try again later.'});
    const body=await readJson(req,64*1024),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||''),name=sanitizeName(body.name);if(!validEmail(email))return json(req,res,400,{ok:false,error:'Enter a valid email address.'});if(password.length<8||password.length>128)return json(req,res,400,{ok:false,error:'Password must be 8–128 characters.'});
    const salt=crypto.randomBytes(16).toString('hex'),ph=hashPassword(password,salt);try{const {rows}=await pool.query('INSERT INTO cce_users(email,display_name,password_hash,password_salt) VALUES($1,$2,$3,$4) RETURNING id,email,display_name',[email,name,ph,salt]);const cookie=await createSession(req,rows[0]);return json(req,res,201,{ok:true,user:{id:String(rows[0].id),email:rows[0].email,name:rows[0].display_name}},{'Set-Cookie':cookie});}catch(e){if(e.code==='23505')return json(req,res,409,{ok:false,error:'An account with this email already exists.'});throw e;}
  }
  if(u.pathname==='/api/auth/login'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Cloud database is not configured. Add DATABASE_URL on Render.'});if(rateLimited(req,'login',12))return json(req,res,429,{ok:false,error:'Too many attempts. Try again later.'});
    const body=await readJson(req,64*1024),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');const {rows}=await pool.query('SELECT id,email,display_name,password_hash,password_salt FROM cce_users WHERE email=$1 LIMIT 1',[email]);const user=rows[0],valid=user&&safeEqualHex(hashPassword(password,user.password_salt),user.password_hash);if(!valid)return json(req,res,401,{ok:false,error:'Invalid email or password.'});const cookie=await createSession(req,user);return json(req,res,200,{ok:true,user:{id:String(user.id),email:user.email,name:user.display_name}},{'Set-Cookie':cookie});
  }
  if(u.pathname==='/api/auth/logout'&&req.method==='POST'){if(pool){const token=parseCookies(req).cce_session;if(token)await pool.query('DELETE FROM cce_sessions WHERE token_hash=$1',[sessionHash(token)]);}return json(req,res,200,{ok:true},{'Set-Cookie':sessionCookie(req,'',true)});}
  if(u.pathname==='/api/progress'&&req.method==='GET'){if(!pool)return json(req,res,503,{ok:false,error:'Database unavailable'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});const {rows}=await pool.query('SELECT data,updated_at FROM cce_progress WHERE user_id=$1',[user.id]);if(!rows[0])return json(req,res,200,{ok:true,hasProgress:false,progress:null});return json(req,res,200,{ok:true,hasProgress:true,progress:rows[0].data,serverUpdatedAt:rows[0].updated_at});}
  if(u.pathname==='/api/progress'&&req.method==='PUT'){if(!pool)return json(req,res,503,{ok:false,error:'Database unavailable'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});const body=await readJson(req,2*1024*1024),progress=body.progress;if(!progress||typeof progress!=='object'||Array.isArray(progress))return json(req,res,400,{ok:false,error:'Invalid progress payload'});const serialized=JSON.stringify(progress);if(serialized.length>1800000)return json(req,res,413,{ok:false,error:'Progress payload too large'});await pool.query(`INSERT INTO cce_progress(user_id,data,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(user_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[user.id,serialized]);return json(req,res,200,{ok:true,savedAt:new Date().toISOString()});}

  if(u.pathname==='/api/adaptive/status'&&req.method==='GET'){
    const user=pool?await getAuth(req):null;let sourceUpdatedAt=null;if(pool){const {rows}=await pool.query("SELECT updated_at FROM cce_source_analysis WHERE analysis_key='gsssb-cce-pyq-v1'");sourceUpdatedAt=rows[0]?.updated_at||null;}
    return json(req,res,200,{ok:true,aiConfigured:!!GEMINI_API_KEY,database:!!pool,loggedIn:!!user,model:GEMINI_MODEL,sourceUpdatedAt,sourcePages:EXAM_SOURCE_PAGES,sourceVideos:EXAM_SOURCE_VIDEOS});
  }
  if(u.pathname==='/api/adaptive/analyze-sources'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Database required'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,error:'Add GEMINI_API_KEY on Render to enable online PYQ/video analysis.'});if(rateLimited(req,'analyze',3,60*60*1000))return json(req,res,429,{ok:false,error:'Source analysis refresh is limited. Try later.'});const data=await getSourceAnalysis(true);return json(req,res,200,{ok:true,data});
  }
  if(u.pathname==='/api/adaptive/set'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Login/cloud database required for adaptive sets.'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required for adaptive 100.'});if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,error:'AI is not configured. Add GEMINI_API_KEY on Render.'});if(rateLimited(req,'adaptive-set',12,60*60*1000))return json(req,res,429,{ok:false,error:'Too many AI set-generation requests. Resume an existing set or try later.'});
    const body=await readJson(req,128*1024),subject=String(body.subject||'').trim(),topic=String(body.topic||'').trim();if(!validSimple(subject,40)||!validSimple(topic,120))return json(req,res,400,{ok:false,error:'Invalid subject/topic'});
    const latest=(await pool.query('SELECT * FROM cce_topic_sets WHERE user_id=$1 AND subject=$2 AND topic=$3 ORDER BY set_no DESC LIMIT 1',[user.id,subject,topic])).rows[0];
    if(latest&&latest.status==='active')return json(req,res,200,{ok:true,resumed:true,set:{id:String(latest.id),setNo:latest.set_no,dateKey:latest.date_key,questions:latest.questions,sourceMix:latest.source_mix,status:latest.status}});
    const setNo=latest?latest.set_no+1:1;
    const history=(await pool.query("SELECT questions,summary FROM cce_topic_sets WHERE user_id=$1 AND subject=$2 AND topic=$3 AND status='completed' ORDER BY set_no DESC LIMIT 4",[user.id,subject,topic])).rows;
    const mistakes=compactMistakes(history,subject,topic),analysis=await getSourceAnalysis(false),currentAffairs=await getCurrentAffairs().catch(()=>[]);
    let generated;try{generated=await generateAdaptiveQuestions({subject,topic,setNo,mistakes,analysis,currentAffairs});}catch(e){console.error('Adaptive generation:',e);return json(req,res,502,{ok:false,error:`AI question generation failed: ${e.message}. You can retry; existing progress is safe.`});}
    const dateKey=todayIndia();const {rows}=await pool.query('INSERT INTO cce_topic_sets(user_id,subject,topic,set_no,date_key,questions,source_mix,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,\'active\') RETURNING id',[user.id,subject,topic,setNo,dateKey,JSON.stringify(generated.questions),JSON.stringify({mix:generated.mix,note:generated.note,weakSignals:mistakes.length,analysisSource:'PYQ pages + public YouTube paper solutions'})]);
    return json(req,res,201,{ok:true,resumed:false,set:{id:String(rows[0].id),setNo,dateKey,questions:generated.questions,sourceMix:{mix:generated.mix,note:generated.note,weakSignals:mistakes.length},status:'active'}});
  }
  if(u.pathname==='/api/adaptive/complete'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Database required'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});const body=await readJson(req,512*1024),setId=String(body.setId||''),results=Array.isArray(body.results)?body.results:[];if(!/^\d+$/.test(setId))return json(req,res,400,{ok:false,error:'Invalid set ID'});
    const {rows}=await pool.query('SELECT * FROM cce_topic_sets WHERE id=$1 AND user_id=$2 LIMIT 1',[setId,user.id]);const set=rows[0];if(!set)return json(req,res,404,{ok:false,error:'Set not found'});if(set.status==='completed')return json(req,res,200,{ok:true,alreadyCompleted:true,nextSetNo:set.set_no+1});
    const qs=Array.isArray(set.questions)?set.questions:[];const map=new Map(results.map(r=>[String(r.questionId),r]));let correct=0,wrong=0,skipped=0;const wrongIds=[];
    for(const q of qs){const r=map.get(String(q.id));if(!r)continue;const outcome=String(r.outcome||'');if(outcome==='correct')correct++;else if(outcome==='wrong'){wrong++;wrongIds.push(String(q.id));}else if(outcome==='skip')skipped++;}
    const completed=correct+wrong+skipped;if(completed<qs.length)return json(req,res,409,{ok:false,error:`Complete all ${qs.length} questions first. Progress: ${completed}/${qs.length}.`});
    const summary={correct,wrong,skipped,net:Number((correct-wrong*0.25).toFixed(2)),wrongIds,completed,dateKey:set.date_key};await pool.query("UPDATE cce_topic_sets SET status='completed',summary=$1::jsonb,completed_at=NOW() WHERE id=$2 AND user_id=$3",[JSON.stringify(summary),setId,user.id]);
    return json(req,res,200,{ok:true,summary,nextSetNo:set.set_no+1,adaptiveMessage:wrong?`${wrong} wrong concepts will receive extra weight in your next 100.`:'Excellent. Next 100 will use harder/fresh PYQ-style variants.'});
  }

  return json(req,res,404,{ok:false,error:'API route not found'});
}

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const apiHandled=await handleApi(req,res,u);if(apiHandled!==false)return;if(req.method!=='GET'&&req.method!=='HEAD')return send(req,res,405,'Method not allowed','text/plain; charset=utf-8');let rel=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname);rel=path.normalize(rel).replace(/^([.][.][/\\])+/,'');const file=path.join(ROOT,rel);if(!file.startsWith(ROOT))return send(req,res,403,'Forbidden','text/plain; charset=utf-8');fs.readFile(file,(err,data)=>{if(err){if(err.code==='ENOENT')return send(req,res,404,'Not found','text/plain; charset=utf-8');return send(req,res,500,'Server error','text/plain; charset=utf-8');}res.writeHead(200,securityHeaders(req,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':path.extname(file)==='.html'?'no-cache':'public, max-age=3600'}));if(req.method==='HEAD')return res.end();res.end(data);});}catch(e){console.error(e);if(!res.headersSent)json(req,res,e.message==='BODY_TOO_LARGE'?413:500,{ok:false,error:e.message==='INVALID_JSON'?'Invalid JSON':'Server error'});else res.end();}});

initDb().then(()=>server.listen(PORT,'0.0.0.0',()=>console.log(`CCE Adaptive 100 running on port ${PORT} • cloud=${!!pool} • ai=${!!GEMINI_API_KEY} • model=${GEMINI_MODEL}`))).catch(err=>{console.error('Database initialization failed:',err);process.exit(1);});
