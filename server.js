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
const GEMINI_FALLBACK_MODELS = String(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.5-flash-lite').split(',').map(s=>s.trim()).filter(Boolean);
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
// Bulk MCQ generation should prefer the lowest-latency model. Heavy source/video analysis still uses GEMINI_MODEL.
const GEMINI_QUESTION_MODEL = process.env.GEMINI_QUESTION_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_QUESTION_FALLBACK_MODELS = String(process.env.GEMINI_QUESTION_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.7-flash').split(',').map(s=>s.trim()).filter(Boolean);
const GEMINI_QUESTION_MODELS = [...new Set([GEMINI_QUESTION_MODEL, ...GEMINI_QUESTION_FALLBACK_MODELS])];
const AI_RETRY_DELAYS_MS = [700, 1500, 3000];
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
  'https://www.marugujarat.in/2026/06/gsssb-class-3-cce-syllabus-2026/',
  'https://pariksapath.in/cce-syllabus',
  'https://pariksapath.in/materials',
  'https://www.adda247.com/exams/gujarat/gsssb-group-a-group-b-previous-year-question-papers/'
];
const EXAM_SOURCE_VIDEOS = [
  'https://www.youtube.com/watch?v=fXPZLobBEaU',
  'https://www.youtube.com/watch?v=N1MvwriKM5c',
  'https://www.youtube.com/watch?v=1J2h_1z2tO0'
];

const CCE_2026_SYLLABUS = {
  exam:'GSSSB CCE Class-III Group A & B Preliminary Examination 2026', advertisement:'378/2025-26',
  pattern:{total:150,minutes:120,negative:0.25,reasoning:60,quant:30,ga:30,gujarati:15,english:15},
  levels:{reasoning:'Std. 10',quant:'Std. 10',english:'Std. 10 lower level',gujarati:'Std. 12 higher level',science:'Std. 10',ga:'History/Heritage/Geography/Polity/Economics Std. 12'},
  topics:{
    reasoning:['Coding-Decoding','Blood Relation','Problem on Ages and Height','Direction Sense','Clock and Calendar','Venn Diagram','Rank and Position','Arithmetic Progression','Logical Sequence of Words','Inserting the missing Character','Word, Numerical and General Analogy','Picture Based General Logical Questions','Probability','Data Interpretation and Data Sufficiency','Symmetry','Mathematical Operations','Mathematical Modeling','Mathematical Proof','Logical and Mathematical Analytical Ability','Statement and Prediction'],
    quant:['Number System','LCM and HCF','Percentage and Partnership','Profit-Loss','Simple and Compound Interest','Ratio and Proportion','Time and Work, Wages and Chain Rule','Time, Speed and Distance','Mean, Mode and Median','Brackets and Expansions','Square/Square Roots, Cube/Cube Roots, Exponents','Polynomials and Factorisation','Linear Equations and Quadratic Equations','Area, Surface Area and Volume','Coordinate Geometry and Trigonometry'],
    gujarati:['રૂઢિપ્રયોગનો અર્થ','કહેવતનો અર્થ','સમાસનો વિગ્રહ અને ઓળખ','છંદ','અલંકાર','શબ્દસમૂહ માટે એક શબ્દ','જોડણીશુદ્ધિ','લેખનશુદ્ધિ/ભાષાશુદ્ધિ','સંધિ જોડો કે છોડો','સમાનાર્થી શબ્દ','વિરુદ્ધાર્થી શબ્દ','વિભક્તિ','ધ્વનિ','વ્યંજન-સ્વર જોડી શબ્દ બનાવો','શબ્દોને શબ્દકોષના ક્રમમાં ગોઠવો','વાક્ય પરિવર્તન','ગુજરાતી-અંગ્રેજી ભાષાંતર'],
    english:['Tenses','Voices','Direct/Indirect Speech','Articles and Determiners','Adjectives, Prepositions and Conjunctions','Verbs and Adverbs','Noun and Pronoun','Jumbled Words and Sentences','Synonyms','Antonyms','Homonyms/Homophones','Transformation of Sentence','Idiomatic Expressions','One Word Substitution','English-Gujarati Translation'],
    ga:['History of India','Cultural Heritage of India','Geography','Indian Polity','Economics','Science','Current Affairs: Regional, National and International']
  }
};


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
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function transientAiError(e){const s=String(e?.message||e||'').toLowerCase();return /503|unavailable|high demand|overload|capacity|429|resource_exhausted|rate limit|timeout|deadline|500|502|504/.test(s);}
function friendlyAiError(e){const s=String(e?.message||e||'');if(/503|unavailable|high demand|overload|capacity/i.test(s))return 'Gemini is temporarily busy (503). Automatic retries and fallback models were attempted.';if(/429|resource_exhausted|rate limit|quota/i.test(s))return 'Gemini rate/quota limit reached (429).';if(/api key|403|401|permission/i.test(s))return 'Gemini API key/permission error.';return s.slice(0,400)||'Unknown Gemini error';}
async function runGeminiInteraction({input,models=GEMINI_MODELS,tools,attempts=3,responseFormat}){
  const ai=await geminiClient(); let lastErr=null, tried=[];
  for(const model of [...new Set(models.filter(Boolean))]){
    for(let attempt=0;attempt<attempts;attempt++){
      try{
        const opts={model,input}; if(tools)opts.tools=tools; if(responseFormat)opts.response_format=responseFormat;
        const t0=Date.now(); const interaction=await ai.interactions.create(opts);
        return {interaction,model,latencyMs:Date.now()-t0,tried};
      }catch(e){lastErr=e;tried.push({model,attempt:attempt+1,error:friendlyAiError(e)});if(!transientAiError(e))break;if(attempt<attempts-1)await sleep((AI_RETRY_DELAYS_MS[attempt]||4000)+Math.floor(Math.random()*350));}
    }
  }
  const err=new Error(friendlyAiError(lastErr)); err.tried=tried; throw err;
}
function parseJsonText(text){
  let s=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch(_){const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));throw new Error('AI returned invalid JSON');}
}

const QUESTION_RESPONSE_FORMAT = {
  type:'text', mime_type:'application/json',
  schema:{
    type:'object',
    properties:{
      questions:{type:'array',items:{type:'object',properties:{
        text:{type:'string'}, topic:{type:'string'}, options:{type:'array',items:{type:'string'},minItems:4,maxItems:4},
        answer:{type:'integer'}, explanation:{type:'string'}, difficulty:{type:'string',enum:['easy','medium','hard']},
        pyqPattern:{type:'boolean'}, source:{type:'string'}, sourceUrl:{type:'string'}, videoSearchTerms:{type:'string'}
      },required:['text','options','answer','explanation','difficulty','pyqPattern']}},
      note:{type:'string'}
    },required:['questions']
  }
};
function canonicalExactText(s){return String(s||'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function exactQuestionSignature(q){return crypto.createHash('sha1').update(canonicalExactText(q?.text||q)).digest('hex').slice(0,20);}
async function runLimited(tasks,limit=2){
  const out=new Array(tasks.length); let next=0;
  async function worker(){while(true){const i=next++;if(i>=tasks.length)return;out[i]=await tasks[i]();}}
  await Promise.all(Array.from({length:Math.min(limit,tasks.length)},()=>worker())); return out;
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
    const pageText=EXAM_SOURCE_PAGES.join('\n');
    const input=[
      {type:'text',text:`Analyze GSSSB CCE PRELIM previous-paper patterns for 2026 study planning. Prioritize 2024 CCE prelim all-shift evidence; use the 2026 syllabus only to map old recurring patterns into the new 2026 scope. Read these public pages with URL context:\n${pageText}\nAlso analyze the attached public YouTube paper-solution videos. Do NOT reproduce long/exact copyrighted question text. Extract only recurring topic types, common traps, difficulty, and question patterns. Return STRICT JSON only: {"summary":"...","highFrequency":{"reasoning":[],"quant":[],"gujarati":[],"english":[],"ga":[]},"recurringPatterns":[{"subject":"","topic":"","pattern":"","priority":1}],"videoInsights":[{"url":"","insight":""}]}`},
      ...EXAM_SOURCE_VIDEOS.slice(0,3).map(uri=>({type:'video',uri}))
    ];
    const run=await runGeminiInteraction({input,models:[GEMINI_VIDEO_MODEL,...GEMINI_MODELS],tools:[{type:'url_context'}],attempts:2});
    const interaction=run.interaction;
    const data=parseJsonText(interaction.outputText||interaction.output_text||'');
    data.modelUsed=run.model; data.generatedAt=new Date().toISOString();
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
  const specificTopic=validSimple(String(q.topic||''),160)?String(q.topic).trim():topic;
  return {
    id:`ai-${Date.now()}-${idx}-${crypto.randomBytes(4).toString('hex')}`,subject,topic:specificTopic,
    text:String(q.text).trim(),options,answer,
    explanation:String(q.explanation||'Correct option follows the standard rule/concept for this topic.').trim().slice(0,1200),
    source:String(q.source||'AI-generated from CCE/PYQ patterns').trim().slice(0,160),sourceUrl:String(q.sourceUrl||'').trim().slice(0,600),
    pyqPattern:!!q.pyqPattern,difficulty:['easy','medium','hard'].includes(q.difficulty)?q.difficulty:'medium',
    videoSearchTerms:String(q.videoSearchTerms||`${topic} GSSSB CCE Gujarati explanation`).trim().slice(0,220)
  };
}
function canonicalText(s){return String(s||'').toLowerCase().normalize('NFKC').replace(/[0-9]+/g,'#').replace(/[^\p{L}\p{N}#]+/gu,' ').replace(/\s+/g,' ').trim();}
function questionSignature(q){return crypto.createHash('sha1').update(canonicalText(q?.text||q)).digest('hex').slice(0,16);}
async function previousQuestionSignals(userId,subject,topic,limitSets=12){
  if(!pool)return {signatures:[],examples:[]};
  const {rows}=await pool.query('SELECT questions FROM cce_topic_sets WHERE user_id=$1 AND subject=$2 AND topic=$3 ORDER BY set_no DESC LIMIT $4',[userId,subject,topic,limitSets]);
  const signatures=[],examples=[];for(const r of rows){for(const q of (Array.isArray(r.questions)?r.questions:[])){signatures.push(questionSignature(q));if(examples.length<80)examples.push(String(q.text||'').slice(0,180));}}
  return {signatures:[...new Set(signatures)].slice(0,1500),examples};
}
function compactAnalysisForSubject(analysis,subject){
  const key=subject==='quant'?'quant':subject;
  const recurring=Array.isArray(analysis?.recurringPatterns)?analysis.recurringPatterns.filter(x=>String(x?.subject||'').toLowerCase().includes(key)).slice(0,12):[];
  return {summary:String(analysis?.summary||'').slice(0,900),highFrequency:analysis?.highFrequency?.[key]||[],recurringPatterns:recurring};
}
function batchPrompt({subject,topic,setNo,batchNo,count,mistakes,analysis,currentAffairs,excludeExamples,mode='adaptive'}){
  const hasMistakes=mistakes.length>0;
  const targetMix=mode==='pyq'?{mistakeVariants:hasMistakes?25:0,pyqPattern:75,fresh:hasMistakes?0:25}:(hasMistakes?{mistakeVariants:55,pyqPattern:25,fresh:20}:{mistakeVariants:0,pyqPattern:40,fresh:60});
  const caContext=(subject==='ga')?currentAffairs.slice(0,16).map(x=>({text:x.text,answer:x.options?.[x.answer],sourceUrl:x.sourceUrl})):[];
  const subjectSyllabus={pattern:CCE_2026_SYLLABUS.pattern,level:CCE_2026_SYLLABUS.levels[subject]||'',topics:CCE_2026_SYLLABUS.topics[subject]||[]};
  const slimAnalysis=compactAnalysisForSubject(analysis,subject);
  return {targetMix,prompt:`You are a careful GSSSB CCE 2026 PRELIM question setter. Generate EXACTLY ${count} ORIGINAL MCQs for subject=${subject}, topic=${topic}, set #${setNo}, batch #${batchNo}.
2026 exam map: ${JSON.stringify(subjectSyllabus)}. Language: Gujarati for Reasoning, Quant, GA and Gujarati; English for English. Explanations can be simple Gujarati.
Difficulty: ~25% easy, 55% medium, 20% hard. Use competitive-exam distractors/traps; avoid toy/repeated templates. Verify maths/reasoning calculations. Static facts must be reliable; current affairs only from supplied context.
PYQ rule: learn recurring pattern/frequency/traps, NEVER copy long/verbatim past-paper text. pyqPattern=true means same pattern but new wording/data. Adaptive mix: ${targetMix.mistakeVariants}% weak-area variants, ${targetMix.pyqPattern}% PYQ-style, ${targetMix.fresh}% fresh.
Avoid substantially similar wording/templates to these recent examples: ${JSON.stringify(excludeExamples.slice(-35))}. Diversify names, numbers, structures and correct-option positions.
Prior mistakes: ${JSON.stringify(mistakes).slice(0,4500)}
PYQ analysis: ${JSON.stringify(slimAnalysis).slice(0,4500)}
Current-affairs context: ${JSON.stringify(caContext).slice(0,6000)}
Every item: text, specific topic, exactly 4 options, answer index 0-3, concise explanation (1-3 lines), difficulty, pyqPattern, source/sourceUrl only when useful, videoSearchTerms. Return JSON matching the provided schema.`};
}
async function generateAdaptiveQuestions({subject,topic,setNo,mistakes,analysis,currentAffairs,excludeExamples=[],mode='adaptive'}){
  const clean=[],seen=new Set(excludeExamples.map(x=>questionSignature(x))),notes=[],modelsUsed=[];
  for(let batchNo=1;batchNo<=4;batchNo++){
    let need=100-clean.length;if(need<=0)break; const count=Math.min(25,need); let batchClean=[];
    for(let repair=0;repair<3 && batchClean.length<count;repair++){
      const bp=batchPrompt({subject,topic,setNo,batchNo,count:count-batchClean.length,mistakes,analysis,currentAffairs,excludeExamples:[...excludeExamples,...clean.map(q=>q.text),...batchClean.map(q=>q.text)],mode});
      const run=await runGeminiInteraction({input:bp.prompt,models:GEMINI_QUESTION_MODELS,attempts:2,responseFormat:QUESTION_RESPONSE_FORMAT}); modelsUsed.push(run.model);
      const parsed=parseJsonText(run.interaction.outputText||run.interaction.output_text||''); notes.push(String(parsed.note||''));
      const raw=Array.isArray(parsed.questions)?parsed.questions:[];
      for(let i=0;i<raw.length;i++){
        const q=normalizeAiQuestion(raw[i],clean.length+batchClean.length+i,subject,topic);if(!q)continue;
        const sig=questionSignature(q); if(seen.has(sig))continue; seen.add(sig); batchClean.push(q); if(batchClean.length===count)break;
      }
    }
    clean.push(...batchClean); if(batchClean.length<count)throw new Error(`AI produced only ${clean.length}/100 unique questions after duplicate filtering.`);
  }
  if(clean.length!==100)throw new Error(`AI returned only ${clean.length} valid unique questions`);
  const hasMistakes=mistakes.length>0;const targetMix=mode==='pyq'?{mistakeVariants:hasMistakes?25:0,pyqPattern:75,fresh:hasMistakes?0:25}:(hasMistakes?{mistakeVariants:55,pyqPattern:25,fresh:20}:{mistakeVariants:0,pyqPattern:40,fresh:60});
  return {questions:clean,mix:targetMix,note:notes.filter(Boolean).join(' ').slice(0,800)||'2026 adaptive set generated with historical de-duplication.',modelUsed:[...new Set(modelsUsed)].join(' → ')};
}
async function generateMockBatch({subject,count,batchNo,focusTopics,analysis,currentAffairs,excludeExamples=[]}){
  const accepted=[],relaxed=[],exactSeen=new Set(excludeExamples.map(exactQuestionSignature)),templateSeen=new Set(excludeExamples.map(questionSignature));
  const modelsUsed=[]; const target=Math.max(1,Number(count)||1);
  for(let round=0;round<3 && accepted.length<target;round++){
    const missing=target-accepted.length;
    const ask=Math.min(28,missing+Math.min(6,Math.ceil(missing*0.3)));
    const topicLabel=`2026 Mixed ${subject} • focus: ${focusTopics.join(', ')}`;
    const bp=batchPrompt({subject,topic:topicLabel,setNo:1,batchNo:Number(batchNo||1)*10+round,count:ask,mistakes:[],analysis,currentAffairs,excludeExamples:[...excludeExamples,...accepted.map(q=>q.text)],mode:'pyq'});
    const prompt=`${bp.prompt}\nTHIS BATCH MUST FOCUS ONLY ON THESE SYLLABUS AREAS: ${JSON.stringify(focusTopics)}. Spread questions across them; do not repeatedly test one template. For mixed mock questions, set each item's topic field to the actual syllabus topic being tested.`;
    const run=await runGeminiInteraction({input:prompt,models:GEMINI_QUESTION_MODELS,attempts:2,responseFormat:QUESTION_RESPONSE_FORMAT});
    modelsUsed.push(run.model);
    const parsed=parseJsonText(run.interaction.outputText||run.interaction.output_text||'');
    for(const raw of (Array.isArray(parsed.questions)?parsed.questions:[])){
      const q=normalizeAiQuestion(raw,accepted.length+relaxed.length,subject,focusTopics[0]||subject); if(!q)continue;
      const exact=exactQuestionSignature(q),templ=questionSignature(q); if(exactSeen.has(exact))continue;
      exactSeen.add(exact);
      if(!templateSeen.has(templ)){templateSeen.add(templ);accepted.push(q);} else relaxed.push(q);
      if(accepted.length>=target)break;
    }
  }
  // If the model produced legitimate numerical variants of the same pattern, use them only as a final fallback.
  while(accepted.length<target && relaxed.length){accepted.push(relaxed.shift());}
  if(accepted.length<target)throw new Error(`Only ${accepted.length}/${target} valid ${subject} questions were produced for one mock batch.`);
  return {questions:accepted.slice(0,target),modelsUsed};
}
async function generate2026Mock({userId,analysis,currentAffairs}){
  const specs=[
    {subject:'reasoning',count:60,chunks:[20,20,20]},
    {subject:'quant',count:30,chunks:[15,15]},
    {subject:'ga',count:30,chunks:[15,15]},
    {subject:'gujarati',count:15,chunks:[15]},
    {subject:'english',count:15,chunks:[15]}
  ];
  const tasks=[],meta=[];
  for(const spec of specs){
    const topics=CCE_2026_SYLLABUS.topics[spec.subject]||[]; let cursor=0;
    spec.chunks.forEach((n,idx)=>{
      const take=Math.max(1,Math.ceil(topics.length/spec.chunks.length));
      let focus=topics.slice(cursor,cursor+take); cursor+=take;
      if(!focus.length)focus=topics;
      meta.push({subject:spec.subject,count:n,focus,batchNo:idx+1});
      tasks.push(()=>generateMockBatch({subject:spec.subject,count:n,batchNo:idx+1,focusTopics:focus,analysis,currentAffairs}));
    });
  }
  // Two concurrent calls is a deliberate compromise: much faster than v4's fully sequential generation,
  // while staying friendlier to free-tier rate limits than firing all 9 requests at once.
  const parts=await runLimited(tasks,2);
  const bySubject=new Map(specs.map(s=>[s.subject,[]])); const modelUsed=[];
  for(let i=0;i<parts.length;i++){const m=meta[i],part=parts[i];modelUsed.push(...part.modelsUsed);bySubject.get(m.subject).push(...part.questions);}
  const all=[];
  for(const spec of specs){
    let qs=bySubject.get(spec.subject)||[]; const unique=[],seen=new Set();
    for(const q of qs){const sig=exactQuestionSignature(q);if(seen.has(sig))continue;seen.add(sig);unique.push(q);}
    qs=unique;
    if(qs.length<spec.count){
      const repair=await generateMockBatch({subject:spec.subject,count:spec.count-qs.length,batchNo:99,focusTopics:CCE_2026_SYLLABUS.topics[spec.subject]||[spec.subject],analysis,currentAffairs,excludeExamples:qs.map(q=>q.text)});
      modelUsed.push(...repair.modelsUsed); qs.push(...repair.questions);
    }
    if(qs.length<spec.count)throw new Error(`Mock could only build ${qs.length}/${spec.count} ${spec.subject} questions.`);
    all.push(...qs.slice(0,spec.count));
  }
  if(all.length!==150)throw new Error(`Mock generation returned ${all.length}/150 questions.`);
  return {questions:all,modelUsed:[...new Set(modelUsed)].join(' → ')};
}

async function handleApi(req,res,u){
  if(u.pathname==='/health')return json(req,res,200,{ok:true,service:'cce-adaptive100-v5',database:!!pool,aiConfigured:!!GEMINI_API_KEY,models:GEMINI_MODELS,questionModels:GEMINI_QUESTION_MODELS});
  if(u.pathname==='/api/current-affairs'&&req.method==='GET'){try{const data=await getCurrentAffairs();return json(req,res,200,{ok:true,count:data.length,items:data});}catch(_){return json(req,res,200,{ok:false,count:0,items:[],error:'PIB feed unavailable; offline bank is active.'});}}
  if(!u.pathname.startsWith('/api/'))return false;
  if(!sameOrigin(req))return json(req,res,403,{ok:false,error:'Origin rejected'});

  if(u.pathname==='/api/auth/me'&&req.method==='GET'){if(!pool)return json(req,res,200,{ok:true,database:false,user:null,ai:!!GEMINI_API_KEY,model:GEMINI_MODEL,models:GEMINI_MODELS,questionModel:GEMINI_QUESTION_MODEL,questionModels:GEMINI_QUESTION_MODELS});const user=await getAuth(req);return json(req,res,200,{ok:true,database:true,ai:!!GEMINI_API_KEY,model:GEMINI_MODEL,models:GEMINI_MODELS,questionModel:GEMINI_QUESTION_MODEL,questionModels:GEMINI_QUESTION_MODELS,user:user?{id:String(user.id),email:user.email,name:user.display_name}:null});}
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
    return json(req,res,200,{ok:true,aiConfigured:!!GEMINI_API_KEY,database:!!pool,loggedIn:!!user,model:GEMINI_MODEL,models:GEMINI_MODELS,questionModel:GEMINI_QUESTION_MODEL,questionModels:GEMINI_QUESTION_MODELS,sourceUpdatedAt,sourcePages:EXAM_SOURCE_PAGES,sourceVideos:EXAM_SOURCE_VIDEOS,syllabus:CCE_2026_SYLLABUS});
  }
  if(u.pathname==='/api/adaptive/test-ai'&&req.method==='POST'){
    if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,configured:false,state:'not-configured',error:'GEMINI_API_KEY is missing on Render.'});
    const started=Date.now();try{const run=await runGeminiInteraction({input:'Return exactly this JSON and nothing else: {"ok":true}',models:GEMINI_QUESTION_MODELS,attempts:2,responseFormat:{type:'text',mime_type:'application/json',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok']}}});return json(req,res,200,{ok:true,configured:true,state:'connected',modelUsed:run.model,latencyMs:Date.now()-started,fallbackUsed:run.model!==GEMINI_QUESTION_MODEL,tried:run.tried});}catch(e){return json(req,res,503,{ok:false,configured:true,state:'busy-or-error',error:friendlyAiError(e),latencyMs:Date.now()-started,tried:e.tried||[]});}
  }
  if(u.pathname==='/api/adaptive/analyze-sources'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Database required'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,error:'Add GEMINI_API_KEY on Render to enable online PYQ/video analysis.'});if(rateLimited(req,'analyze',3,60*60*1000))return json(req,res,429,{ok:false,error:'Source analysis refresh is limited. Try later.'});const data=await getSourceAnalysis(true);return json(req,res,200,{ok:true,data});
  }
  if(u.pathname==='/api/adaptive/set'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Login/cloud database required for adaptive sets.'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required for adaptive 100.'});if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,error:'AI is not configured. Add GEMINI_API_KEY on Render.'});if(rateLimited(req,'adaptive-set',12,60*60*1000))return json(req,res,429,{ok:false,error:'Too many AI set-generation requests. Resume an existing set or try later.'});
    const body=await readJson(req,128*1024),subject=String(body.subject||'').trim(),topic=String(body.topic||'').trim(),mode=body.mode==='pyq'?'pyq':'adaptive';if(!validSimple(subject,40)||!validSimple(topic,160))return json(req,res,400,{ok:false,error:'Invalid subject/topic'});
    const latest=(await pool.query('SELECT * FROM cce_topic_sets WHERE user_id=$1 AND subject=$2 AND topic=$3 ORDER BY set_no DESC LIMIT 1',[user.id,subject,topic])).rows[0];
    if(latest&&latest.status==='active')return json(req,res,200,{ok:true,resumed:true,set:{id:String(latest.id),setNo:latest.set_no,dateKey:latest.date_key,questions:latest.questions,sourceMix:latest.source_mix,status:latest.status}});
    const setNo=latest?latest.set_no+1:1;
    const history=(await pool.query("SELECT questions,summary FROM cce_topic_sets WHERE user_id=$1 AND subject=$2 AND topic=$3 AND status='completed' ORDER BY set_no DESC LIMIT 4",[user.id,subject,topic])).rows;
    const mistakes=compactMistakes(history,subject,topic),analysis=await getSourceAnalysis(false),currentAffairs=await getCurrentAffairs().catch(()=>[]),prior=await previousQuestionSignals(user.id,subject,topic,14);
    let generated;try{generated=await generateAdaptiveQuestions({subject,topic,setNo,mistakes,analysis,currentAffairs,excludeExamples:prior.examples,mode});}catch(e){console.error('Adaptive generation:',e);return json(req,res,503,{ok:false,error:`${friendlyAiError(e)} Please press Retry. Your existing progress is safe.`,details:e.tried||[]});}
    const dateKey=todayIndia();const {rows}=await pool.query('INSERT INTO cce_topic_sets(user_id,subject,topic,set_no,date_key,questions,source_mix,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,\'active\') RETURNING id',[user.id,subject,topic,setNo,dateKey,JSON.stringify(generated.questions),JSON.stringify({mix:generated.mix,note:generated.note,weakSignals:mistakes.length,mode,modelUsed:generated.modelUsed,duplicateHistoryChecked:prior.signatures.length,analysisSource:'2026 syllabus + PYQ pages + public YouTube paper solutions'})]);
    return json(req,res,201,{ok:true,resumed:false,set:{id:String(rows[0].id),setNo,dateKey,questions:generated.questions,sourceMix:{mix:generated.mix,note:generated.note,weakSignals:mistakes.length,mode,modelUsed:generated.modelUsed,duplicateHistoryChecked:prior.signatures.length},status:'active'}});
  }
  if(u.pathname==='/api/old-papers/analysis'&&req.method==='GET'){
    const data=await getSourceAnalysis(false);return json(req,res,200,{ok:true,data,sources:{pages:EXAM_SOURCE_PAGES,videos:EXAM_SOURCE_VIDEOS},syllabus:CCE_2026_SYLLABUS});
  }
  if(u.pathname==='/api/adaptive/mock2026'&&req.method==='POST'){
    if(!pool)return json(req,res,503,{ok:false,error:'Database required'});const user=await getAuth(req);if(!user)return json(req,res,401,{ok:false,error:'Login required'});if(!GEMINI_API_KEY)return json(req,res,503,{ok:false,error:'GEMINI_API_KEY is not configured.'});if(rateLimited(req,'mock2026',3,60*60*1000))return json(req,res,429,{ok:false,error:'AI mock generation is limited to protect API quota. Try later.'});
    try{const analysis=await getSourceAnalysis(false),currentAffairs=await getCurrentAffairs().catch(()=>[]),mock=await generate2026Mock({userId:user.id,analysis,currentAffairs});return json(req,res,200,{ok:true,questions:mock.questions,modelUsed:mock.modelUsed,pattern:CCE_2026_SYLLABUS.pattern,note:'Fresh 2026-style 150-question simulation. Questions are original, not leaked/actual future exam questions.'});}catch(e){return json(req,res,503,{ok:false,error:friendlyAiError(e),details:e.tried||[]});}
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
