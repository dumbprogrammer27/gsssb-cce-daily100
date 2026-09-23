(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const KEY='cceDaily100StateV3', LEGACY_KEY='cceDaily100StateV2';
  let currentUser=null, cloudAvailable=false, aiAvailable=false, aiModel='', aiModels=[], aiQuestionModel='', aiQuestionModels=[], aiLiveState='unknown', oldPaperData=null, syncTimer=null, currentAffairs=[], quiz=null, timerHandle=null, authMode='login', lastNextAction=null;

  function defaultState(){return {completed:0,correct:0,wrong:0,skipped:0,net:0,wrongBank:[],theme:'dark',sets:0,topicStats:{},updatedAt:0,ownerUserId:null,adaptiveSessions:{},adaptiveDaily:{}};}
  function normalizeState(raw){
    const d=defaultState(),x=(raw&&typeof raw==='object')?raw:{},out={...d,...x};
    out.wrongBank=Array.isArray(out.wrongBank)?out.wrongBank.slice(0,700):[];
    out.topicStats=out.topicStats&&typeof out.topicStats==='object'&&!Array.isArray(out.topicStats)?out.topicStats:{};
    out.adaptiveSessions=out.adaptiveSessions&&typeof out.adaptiveSessions==='object'&&!Array.isArray(out.adaptiveSessions)?out.adaptiveSessions:{};
    out.adaptiveDaily=out.adaptiveDaily&&typeof out.adaptiveDaily==='object'&&!Array.isArray(out.adaptiveDaily)?out.adaptiveDaily:{};
    ['completed','correct','wrong','skipped','net','sets','updatedAt'].forEach(k=>out[k]=Number.isFinite(Number(out[k]))?Number(out[k]):d[k]);
    out.theme=out.theme==='light'?'light':'dark'; return out;
  }
  function loadLocal(){try{const a=localStorage.getItem(KEY);if(a)return normalizeState(JSON.parse(a));const b=localStorage.getItem(LEGACY_KEY);if(b)return normalizeState(JSON.parse(b));}catch(_){}return defaultState();}
  let state=loadLocal();
  function saveLocal(touch=true){if(currentUser)state.ownerUserId=String(currentUser.id);if(touch)state.updatedAt=Date.now();localStorage.setItem(KEY,JSON.stringify(state));}
  function save(){saveLocal(true);renderAllProgress();scheduleCloudSync();}
  function renderAllProgress(){renderStats();renderWrongList();renderProgress();buildSubjects();updateAuthUI();renderSourceStatus();}
  function renderStats(){
    $('#sCompleted').textContent=state.completed;const attempted=state.correct+state.wrong;$('#sAccuracy').textContent=`${attempted?Math.round(state.correct/attempted*100):0}%`;$('#sScore').textContent=Number(state.net.toFixed(2));$('#sWrong').textContent=state.wrongBank.length;
  }
  function applyTheme(){document.body.classList.toggle('light',state.theme==='light');}
  function indiaDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
  function countdown(){const exam=new Date('2026-09-28T00:00:00+05:30'),now=new Date(),ms=exam-now;if(ms<=0){$('#countdown').textContent='Exam day';return;}const d=Math.floor(ms/86400000),h=Math.floor((ms%86400000)/3600000);$('#countdown').textContent=`${d}d ${h}h`;}
  countdown(); setInterval(countdown,60000);

  function switchView(name){$$('.view').forEach(v=>v.classList.remove('active'));$$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));$(`#${name}View`)?.classList.add('active');}
  $$('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));

  async function syncCurrentAffairs(){try{$('#syncStatus').textContent='Syncing…';const r=await fetch('/api/current-affairs',{credentials:'same-origin'}),d=await r.json();currentAffairs=Array.isArray(d.items)?d.items:[];$('#syncStatus').textContent=currentAffairs.length?`${currentAffairs.length} live PIB MCQs available`:'PIB unavailable • local bank active';}catch(_){currentAffairs=[];$('#syncStatus').textContent='Offline mode • local bank active';}}
  $('#syncBtn').onclick=syncCurrentAffairs;

  function subjectName(k){return CCE.SUBJECTS.find(s=>s.key===k)?.name||k;}
  function dailyTopicStatus(subject,topic){
    const day=state.adaptiveDaily[indiaDate()]||{},key=`${subject}::${topic}`,done=day[key];
    const sessions=Object.values(state.adaptiveSessions||{}).filter(x=>x&&x.subject===subject&&x.topic===topic);
    const active=sessions.sort((a,b)=>(b.setNo||0)-(a.setNo||0))[0];
    if(active){const answered=Object.keys(active.responses||{}).length;return {text:`${answered}/100`,cls:'active'};}
    if(done)return {text:`Done ✓ • Set ${done.lastSetNo||''}`.trim(),cls:'done'};
    return {text:'100 Q • Today',cls:''};
  }
  function buildSubjects(){
    const notes={reasoning:'100-question adaptive drills • weak concepts repeat as new variants',quant:'Arithmetic: 100-question adaptive topic challenges',ga:'Static GK + PIB current affairs + PYQ-style patterns',gujarati:'ગુજરાતી વ્યાકરણ • topic-wise Daily 100',english:'Grammar + vocabulary • adaptive Daily 100'};
    $('#subjectGrid').innerHTML=CCE.SUBJECTS.map(s=>{
      const topics=(CCE.TOPICS[s.key]||[]).map(t=>{const href=CCE.videoLink(s.key,t),st=dailyTopicStatus(s.key,t);return `<div class="topic-action-row"><button class="topic-btn ${st.cls}" data-topic-sub="${s.key}" data-topic="${escapeAttr(t)}"><span class="topic-name">${escapeHtml(t)}</span><span>${escapeHtml(st.text)}</span></button><a class="topic-video" href="${escapeAttr(href)}" target="_blank" rel="noopener" title="Learn ${escapeAttr(t)} on YouTube">▶</a></div>`;}).join('');
      return `<article class="subject-card glass"><div class="eyebrow">${s.marks} MARKS IN FULL MOCK</div><h3>${escapeHtml(s.name)}</h3><p>${escapeHtml(notes[s.key])}</p><button class="secondary full" data-sub="${s.key}">Mixed ${escapeHtml(s.name)} • 30</button><div class="daily-rule">Daily rule: topicના 100/100 complete → next adaptive 100 unlock.</div><div class="topic-list">${topics}</div></article>`;
    }).join('');
    $$('[data-sub]').forEach(b=>b.onclick=()=>startSubject(b.dataset.sub));
    $$('[data-topic-sub]').forEach(b=>b.onclick=()=>startTopic(b.dataset.topicSub,b.dataset.topic));
  }
  function uniqueGenerated(subject,count){const list=[],seen=new Set();let guard=0;while(list.length<count&&guard<count*50){const q=CCE.generate(subject);guard++;const sig=q.text+'|'+q.options.join('|');if(!seen.has(sig)){seen.add(sig);list.push(q);}}while(list.length<count)list.push(CCE.generate(subject));return list;}

  function startDaily(){switchView('practice');startQuiz(CCE.generateSet(100,'daily',currentAffairs),'Daily 100',80*60,'daily');}
  function startMock(){switchView('practice');startQuiz(CCE.generateSet(150,'mock',currentAffairs),'Full 150 Mock',120*60,'mock');}
  function startSubject(subject){switchView('practice');startQuiz(uniqueGenerated(subject,30),`${subjectName(subject)} • Mixed 30`,0,'subject');}
  function showLoading(title,body){switchView('practice');$('#quizWrap').classList.add('hidden');$('#resultCard').classList.add('hidden');$('#emptyState').classList.remove('hidden');$('#emptyState').innerHTML=`<div class="ai-loader"></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>`;}
  function resetEmpty(){
    $('#emptyState').innerHTML='<h2>100 questions. One clear target.</h2><p>Topic practiceમાં દરેક active topic set 100 questionsનો છે. 100/100 complete થયા પછી next adaptive 100 unlock થાય છે.</p><button class="primary" id="emptyStart">Start today’s mixed 100</button>';
    $('#emptyStart').onclick=startDaily;
  }
  async function startTopic(subject,topic,opts={}){
    if(currentUser&&aiAvailable){
      showLoading(`Building ${topic} • ${opts.pyqFocus?'PYQ Pattern':'Adaptive'} 100`,`2026 syllabus + old-paper patterns + duplicate filter + your mistakes પરથી set તૈયાર થઈ રહ્યો છે. Gemini busy હોય તો server automatic retry/fallback કરશે.`);
      try{
        const data=await api('/api/adaptive/set',{method:'POST',body:JSON.stringify({subject,topic,mode:opts.pyqFocus?'pyq':'adaptive'})});
        resetEmpty(); const s=data.set, saved=state.adaptiveSessions[String(s.id)]||null;
        startQuiz(s.questions,`${subjectName(subject)} • ${topic} • ${opts.pyqFocus?'PYQ Pattern':'Adaptive'} 100 #${s.setNo}`,0,'adaptive',{setId:String(s.id),setNo:s.setNo,subject,topic,sourceMix:s.sourceMix,saved});
        return;
      }catch(err){
        resetEmpty(); alert(`${err.message}\n\nAI set could not be created now. A local fallback will open; it may be less exam-like. Use the AI status button and retry later.`);
      }
    } else if(!currentUser) alert('Adaptive AI + cross-device resume માટે login કરો. હમણાં local 100 open થશે.');
    else if(!aiAvailable) alert('Renderમાં GEMINI_API_KEY add થયા પછી AI-adaptive sets enable થશે. હમણાં local 100 open થશે.');
    switchView('practice'); startQuiz(CCE.generateTopic(subject,topic,100,currentAffairs),`${subjectName(subject)} • ${topic} • Local 100`,0,'topic');
  }
  async function startAiMock(){
    if(!currentUser){alert('AI 2026 Real Mock માટે login જરૂરી છે.');openAuth();return;}
    if(!aiAvailable){alert('GEMINI_API_KEY configured નથી. Render Environmentમાં key add કરો.');return;}
    showLoading('Building AI 2026 Real Mock','Fast v5 engine: smaller syllabus-focused batches + structured JSON + duplicate repair. Reasoning 60 • Quant 30 • GA/CA 30 • Gujarati 15 • English 15.');
    try{const d=await api('/api/adaptive/mock2026',{method:'POST',body:'{}'});resetEmpty();startQuiz(d.questions,`AI 2026 Real Mock • ${d.modelUsed||aiModel}`,120*60,'mock');}
    catch(e){resetEmpty();alert(`AI mock generation failed: ${e.message}`);switchView('practice');}
  }
  function startWrong(){if(!state.wrongBank.length){alert('Wrong-answer bank is empty. First solve some questions.');return;}switchView('practice');startQuiz(state.wrongBank.map(x=>({...x})),'Wrong Revision',0,'wrong');}

  function startQuiz(questions,label,seconds,mode,meta={}){
    clearInterval(timerHandle); const saved=meta.saved||null;
    quiz={questions,index:saved?.index||0,label,mode,remaining:seconds,answered:false,session:saved?.session||{correct:0,wrong:0,skip:0,net:0},responses:saved?.responses||{},...meta};
    delete quiz.saved;
    $('#emptyState').classList.add('hidden');$('#resultCard').classList.add('hidden');$('#quizWrap').classList.remove('hidden');$('#modeLabel').textContent=label;
    $('#finishBtn').textContent=mode==='adaptive'?'100/100 required':'Finish set';
    if(seconds>0){updateTimer();timerHandle=setInterval(()=>{quiz.remaining--;updateTimer();if(quiz.remaining<=0){clearInterval(timerHandle);finishQuiz(true);}},1000);}else $('#timerLabel').textContent=mode==='adaptive'?'Adaptive':'Practice';
    renderQuestion();window.scrollTo({top:0,behavior:'smooth'});
  }
  function updateTimer(){const m=Math.floor(quiz.remaining/60),s=quiz.remaining%60;$('#timerLabel').textContent=`${m}:${String(s).padStart(2,'0')}`;}
  function renderQuestion(){
    if(!quiz||quiz.index>=quiz.questions.length){finishQuiz();return;}const q=quiz.questions[quiz.index],existing=quiz.responses?.[String(q.id)];quiz.answered=!!existing;
    $('#progressLabel').textContent=`${quiz.index+1} / ${quiz.questions.length}`;$('#progressBar').style.width=`${(Object.keys(quiz.responses||{}).length/quiz.questions.length)*100}%`;$('#liveScore').textContent=Number(quiz.session.net.toFixed(2));
    $('#qSubject').textContent=subjectName(q.subject);$('#qTopic').textContent=q.topic||'';$('#qText').textContent=q.text;$('#qLearn').href=videoForQuestion(q);
    $('#feedback').className='feedback hidden';$('#feedback').innerHTML='';$('#nextBtn').disabled=!existing;$('#notAttempted').disabled=!!existing;$('#bookmarkBtn').textContent=isSaved(q)?'★ Saved':'☆ Save for revision';
    const letters=['A','B','C','D'];$('#options').innerHTML=q.options.map((o,i)=>`<button class="option" data-i="${i}"><b>${letters[i]}.</b> ${escapeHtml(String(o))}</button>`).join('');$$('.option').forEach(btn=>btn.onclick=()=>answer(Number(btn.dataset.i)));
    if(existing){restoreAnswered(q,existing);} 
  }
  function restoreAnswered(q,r){
    const correct=r.outcome==='correct';$$('.option').forEach((b,i)=>{b.disabled=true;if(i===q.answer)b.classList.add('correct');if(i===r.selectedIndex&&r.outcome==='wrong')b.classList.add('wrong');});$('#notAttempted').disabled=true;$('#nextBtn').disabled=false;showFeedback(q,r.outcome==='correct'?'Correct ✓':r.outcome==='wrong'?'Wrong answer':'Not attempted',correct,Number.isInteger(r.selectedIndex)?r.selectedIndex:null,r.outcome==='skip');
  }
  function topicKey(q){return `${q.subject}::${q.topic||'Mixed'}`;}
  function recordProgress(q,outcome,delta){state.completed++;if(outcome==='correct')state.correct++;if(outcome==='wrong')state.wrong++;if(outcome==='skip')state.skipped++;state.net+=delta;const key=topicKey(q),cur=state.topicStats[key]||{subject:q.subject,topic:q.topic||'Mixed',attempts:0,correct:0,wrong:0,skipped:0,net:0};cur.attempts++;if(outcome==='correct')cur.correct++;if(outcome==='wrong')cur.wrong++;if(outcome==='skip')cur.skipped++;cur.net=(Number(cur.net)||0)+delta;cur.lastPracticed=Date.now();state.topicStats[key]=cur;}
  function persistAdaptive(){if(!quiz||quiz.mode!=='adaptive'||!quiz.setId)return;state.adaptiveSessions[String(quiz.setId)]={setId:String(quiz.setId),setNo:quiz.setNo,subject:quiz.subject,topic:quiz.topic,index:quiz.index,session:quiz.session,responses:quiz.responses,label:quiz.label,updatedAt:Date.now()};}
  function answer(index){
    if(quiz.answered)return;quiz.answered=true;const q=quiz.questions[quiz.index],correct=index===q.answer,outcome=correct?'correct':'wrong',delta=correct?1:-0.25;
    $$('.option').forEach((b,i)=>{b.disabled=true;if(i===q.answer)b.classList.add('correct');if(i===index&&!correct)b.classList.add('wrong');});$('#notAttempted').disabled=true;$('#nextBtn').disabled=false;
    if(correct){quiz.session.correct++;quiz.session.net+=1;if(quiz.mode==='wrong')removeWrong(q,false);}else{quiz.session.wrong++;quiz.session.net-=0.25;addWrong(q,false,index);}recordProgress(q,outcome,delta);quiz.responses[String(q.id)]={questionId:String(q.id),outcome,selectedIndex:index};persistAdaptive();save();showFeedback(q,correct?'Correct ✓':'Wrong answer',correct,index,false);
  }
  function notAttempt(){
    if(quiz.answered)return;quiz.answered=true;const q=quiz.questions[quiz.index];$$('.option').forEach((b,i)=>{b.disabled=true;if(i===q.answer)b.classList.add('correct');});$('#notAttempted').disabled=true;$('#nextBtn').disabled=false;quiz.session.skip++;recordProgress(q,'skip',0);quiz.responses[String(q.id)]={questionId:String(q.id),outcome:'skip',selectedIndex:null};persistAdaptive();save();showFeedback(q,'Not attempted',false,null,true);
  }
  function videoForQuestion(q){const terms=String(q.videoSearchTerms||'').trim();return terms?`https://www.youtube.com/results?search_query=${encodeURIComponent(terms)}`:CCE.videoLink(q.subject,q.topic||'');}
  function showFeedback(q,title,good,selectedIndex,skipped){
    const f=$('#feedback');f.className=`feedback ${good?'good':'bad'}`;const selected=selectedIndex===null?'—':String(q.options[selectedIndex]),correct=String(q.options[q.answer]),sourceUrl=safeHttpUrl(q.sourceUrl),sourceLink=sourceUrl?` • <a href="${escapeAttr(sourceUrl)}" target="_blank" rel="noopener">Open source ↗</a>`:'',video=videoForQuestion(q),pyq=q.pyqPattern?'<span class="pyq-badge">PYQ-style pattern</span>':'';
    f.innerHTML=`<div class="feedback-title"><strong>${escapeHtml(title)}</strong>${pyq}</div><div class="solution-grid">${skipped?'':`<div><span>Your answer</span><b>${escapeHtml(selected)}</b></div>`}<div><span>Correct answer</span><b>${escapeHtml(correct)}</b></div></div><div class="solution-box"><strong>Solution / સમજણ</strong><ol><li>Topic: <b>${escapeHtml(q.topic||subjectName(q.subject))}</b></li><li>${escapeHtml(q.explanation||'Apply the standard rule/formula and compare the options.')}</li><li>Correct answer: <b>${escapeHtml(correct)}</b></li></ol></div><div class="feedback-links"><a class="learn-button" href="${escapeAttr(video)}" target="_blank" rel="noopener">▶ Learn this exact topic on YouTube</a><small>Source: ${escapeHtml(q.source||'Practice bank')}${sourceLink}</small></div>`;
    $('#liveScore').textContent=Number(quiz.session.net.toFixed(2));
  }
  function questionKey(q){return `${q.subject}|${q.topic}|${q.text}`;}
  function isSaved(q){const k=questionKey(q);return state.wrongBank.some(x=>questionKey(x)===k);}
  function addWrong(q,doSave=true,selectedIndex=null){const k=questionKey(q),existing=state.wrongBank.find(x=>questionKey(x)===k);if(existing){existing.timesWrong=(existing.timesWrong||1)+1;existing.lastWrongAt=Date.now();if(Number.isInteger(selectedIndex))existing.lastWrongIndex=selectedIndex;if(doSave)save();return;}const item={...q,timesWrong:1,lastWrongAt:Date.now()};if(Number.isInteger(selectedIndex))item.lastWrongIndex=selectedIndex;state.wrongBank.unshift(item);state.wrongBank=state.wrongBank.slice(0,700);if(doSave)save();}
  function removeWrong(q,doSave=true){const k=questionKey(q),before=state.wrongBank.length;state.wrongBank=state.wrongBank.filter(x=>questionKey(x)!==k);if(doSave&&before!==state.wrongBank.length)save();}
  function toggleBookmark(){const q=quiz.questions[quiz.index];if(isSaved(q))removeWrong(q);else addWrong(q);$('#bookmarkBtn').textContent=isSaved(q)?'★ Saved':'☆ Save for revision';}
  async function next(){if(!quiz.answered)return;quiz.index++;persistAdaptive();saveLocal(true);if(quiz.index>=quiz.questions.length)await finishQuiz();else renderQuestion();}
  async function finishQuiz(timedOut=false){
    if(!quiz)return;
    if(quiz.mode==='adaptive'&&Object.keys(quiz.responses||{}).length<quiz.questions.length){alert(`Next 100 unlock કરવા પહેલાં current setના બધા ${quiz.questions.length} questions complete કરવાના છે. Current: ${Object.keys(quiz.responses||{}).length}/${quiz.questions.length}.`);persistAdaptive();save();return;}
    clearInterval(timerHandle);const finished=quiz;state.sets++;
    let adaptiveMessage='';
    if(finished.mode==='adaptive'){
      try{const data=await api('/api/adaptive/complete',{method:'POST',body:JSON.stringify({setId:finished.setId,results:Object.values(finished.responses||{})})});adaptiveMessage=data.adaptiveMessage||'';const day=indiaDate(),key=`${finished.subject}::${finished.topic}`;state.adaptiveDaily[day]=state.adaptiveDaily[day]||{};state.adaptiveDaily[day][key]={lastSetNo:finished.setNo,completedAt:Date.now(),wrong:finished.session.wrong};delete state.adaptiveSessions[String(finished.setId)];lastNextAction=()=>startTopic(finished.subject,finished.topic);}catch(err){alert(`Set completed locally, but server could not unlock the next set: ${err.message}`);persistAdaptive();save();return;}
    } else lastNextAction=finished.mode==='daily'?startDaily:null;
    save();$('#quizWrap').classList.add('hidden');$('#resultCard').classList.remove('hidden');$('#resultTitle').textContent=`${finished.label}${timedOut?' • Time up':''}`;$('#rCorrect').textContent=finished.session.correct;$('#rWrong').textContent=finished.session.wrong;$('#rSkip').textContent=finished.session.skip;$('#rNet').textContent=Number(finished.session.net.toFixed(2));const attempted=finished.session.correct+finished.session.wrong,acc=attempted?Math.round(finished.session.correct/attempted*100):0;$('#resultNote').textContent=`Accuracy: ${acc}%. ${adaptiveMessage||'Wrong questions have been saved automatically with solutions.'}`;
    $('#next100Btn').style.display=lastNextAction?'inline-block':'none';$('#next100Btn').textContent=finished.mode==='adaptive'?'Generate next adaptive 100':'Load next 100';quiz=null;buildSubjects();
  }

  function renderWrongList(){
    const box=$('#wrongList');if(!box)return;if(!state.wrongBank.length){box.innerHTML='<div class="empty glass"><h3>No saved mistakes yet</h3><p>Wrong answers and manually saved questions will appear here.</p></div>';return;}
    box.innerHTML=state.wrongBank.slice(0,200).map((q,i)=>{const correct=String(q.options?.[q.answer]??''),wrong=Number.isInteger(q.lastWrongIndex)?String(q.options?.[q.lastWrongIndex]??''):'',url=safeHttpUrl(q.sourceUrl);return `<article class="wrong-item glass"><div class="wrong-top"><div><small>${escapeHtml(subjectName(q.subject))} • ${escapeHtml(q.topic||'')}</small><strong>${escapeHtml(q.text)}</strong></div><button class="ghost" data-remove-wrong="${i}">Remove</button></div><div class="wrong-solution">${wrong?`<span class="last-wrong">Your last wrong answer: ${escapeHtml(wrong)}</span>`:''}<b>Correct: ${escapeHtml(correct)}</b><p>${escapeHtml(q.explanation||'')}</p><div class="mini-links"><a href="${escapeAttr(videoForQuestion(q))}" target="_blank" rel="noopener">▶ Topic video</a>${url?`<a href="${escapeAttr(url)}" target="_blank" rel="noopener">Source ↗</a>`:''}<span>${q.timesWrong||1}× wrong</span></div></div></article>`;}).join('');
    $$('[data-remove-wrong]').forEach(b=>b.onclick=()=>{const q=state.wrongBank[Number(b.dataset.removeWrong)];if(q)removeWrong(q);});
  }
  function subjectAggregate(subject){const xs=Object.values(state.topicStats).filter(x=>x.subject===subject);return xs.reduce((a,x)=>({attempts:a.attempts+(x.attempts||0),correct:a.correct+(x.correct||0),wrong:a.wrong+(x.wrong||0)}),{attempts:0,correct:0,wrong:0});}
  function accuracy(x){const n=(x.correct||0)+(x.wrong||0);return n?Math.round((x.correct||0)/n*100):0;}
  function renderProgress(){
    const sbox=$('#subjectProgress');if(!sbox)return;sbox.innerHTML=CCE.SUBJECTS.map(s=>{const a=subjectAggregate(s.key);return `<div class="progress-card glass"><small>${escapeHtml(s.name)}</small><strong>${accuracy(a)}%</strong><span>${a.attempts} attempted • ${a.correct} correct • ${a.wrong} wrong</span></div>`;}).join('');
    const rows=Object.values(state.topicStats).sort((a,b)=>{const aa=accuracy(a),bb=accuracy(b);return aa-bb||(b.attempts||0)-(a.attempts||0);});$('#topicProgress').innerHTML=rows.length?rows.map(x=>`<div class="topic-stat"><div><b>${escapeHtml(x.topic)}</b><span>${escapeHtml(subjectName(x.subject))} • ${x.attempts} attempts</span></div><div class="topic-meter"><i style="width:${accuracy(x)}%"></i></div><strong>${accuracy(x)}%</strong><button class="ghost mini" data-progress-practice="${escapeAttr(x.subject)}" data-progress-topic="${escapeAttr(x.topic)}">100 Q</button><a class="topic-video small" href="${escapeAttr(CCE.videoLink(x.subject,x.topic))}" target="_blank" rel="noopener">▶</a></div>`).join(''):'<div class="empty-inline">Practice questions to build topic analytics.</div>';$$('[data-progress-practice]').forEach(b=>b.onclick=()=>startTopic(b.dataset.progressPractice,b.dataset.progressTopic));
  }

  async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});let d={};try{d=await r.json();}catch(_){}if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d;}
  function updateAuthUI(){
    $('#authBtn').classList.toggle('hidden',!!currentUser);$('#logoutBtn').classList.toggle('hidden',!currentUser);$('#cloudStatus').textContent=currentUser?`${currentUser.name||currentUser.email} • cloud sync${aiAvailable?' • AI adaptive ON':''}`:cloudAvailable?'Guest • login for cloud sync':'Guest • local progress';$('#progressIdentity').textContent=currentUser?`Synced account: ${currentUser.email}`:'Login to sync this progress across devices.';$('#privacyStatus').textContent=currentUser?'Your progress is stored in your cloud account and also cached locally.':'Guest mode: progress is kept locally in this browser.';
  }
  function scheduleCloudSync(){if(!currentUser)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>saveCloud(false),700);}
  async function saveCloud(show=false){if(!currentUser)return;try{await api('/api/progress',{method:'PUT',body:JSON.stringify({progress:state})});if(show)$('#cloudStatus').textContent=`${currentUser.name||currentUser.email} • synced`;}catch(_){if(show)$('#cloudStatus').textContent='Cloud sync error • local copy safe';}}
  async function loadCloudProgress(){
    if(!currentUser)return;try{const d=await api('/api/progress');if(d.hasProgress&&d.progress){const cloud=normalizeState(d.progress),local=state;if(String(local.ownerUserId||'')===String(currentUser.id)&&(local.updatedAt||0)>(cloud.updatedAt||0)){await saveCloud();}else state=cloud;}else{state.ownerUserId=String(currentUser.id);await saveCloud();}saveLocal(false);applyTheme();renderAllProgress();}catch(_){renderAllProgress();}
  }
  async function initAuth(){try{const d=await api('/api/auth/me',{method:'GET',headers:{}});cloudAvailable=!!d.database;aiAvailable=!!d.ai;aiModel=d.model||'';aiModels=Array.isArray(d.models)?d.models:[];aiQuestionModel=d.questionModel||aiModel;aiQuestionModels=Array.isArray(d.questionModels)?d.questionModels:[];currentUser=d.user||null;updateAuthUI();renderSourceStatus();if(currentUser)await loadCloudProgress();await checkAiConnection(false);await loadOldPapers();}catch(_){cloudAvailable=false;currentUser=null;updateAuthUI();}}
  function setAuthMode(mode){authMode=mode;const reg=mode==='register';$('#authTitle').textContent=reg?'Create account':'Login';$('#nameField').classList.toggle('hidden',!reg);$('#authSubmit').textContent=reg?'Create account':'Login';$('#authSwitch').textContent=reg?'Already have an account? Login':'Create a new account';$('#authPassword').autocomplete=reg?'new-password':'current-password';$('#authError').classList.add('hidden');}
  function openAuth(){setAuthMode('login');$('#authDialog').showModal();}
  $('#authBtn').onclick=openAuth;$('#closeAuth').onclick=()=>$('#authDialog').close();$('#authSwitch').onclick=()=>setAuthMode(authMode==='login'?'register':'login');
  $('#authForm').addEventListener('submit',async e=>{e.preventDefault();const btn=$('#authSubmit');btn.disabled=true;$('#authError').classList.add('hidden');try{const payload={email:$('#authEmail').value.trim(),password:$('#authPassword').value};if(authMode==='register')payload.name=$('#authName').value.trim();const data=await api(authMode==='register'?'/api/auth/register':'/api/auth/login',{method:'POST',body:JSON.stringify(payload)});currentUser=data.user;cloudAvailable=true;$('#authDialog').close();updateAuthUI();await initAuth();}catch(err){$('#authError').textContent=err.message;$('#authError').classList.remove('hidden');}finally{btn.disabled=false;}});
  $('#logoutBtn').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch(_){}currentUser=null;state=defaultState();saveLocal(false);applyTheme();renderAllProgress();updateAuthUI();};

  function setApiBadge(state,label){const b=$('#apiBadge');if(!b)return;b.className=`api-badge ${state}`;b.querySelector('span').textContent=label;}
  function renderSourceStatus(){
    const ai=$('#aiStatus');if(ai){if(!aiAvailable)ai.textContent='Not configured • add GEMINI_API_KEY on Render';else if(aiLiveState==='connected')ai.textContent=`Connected • MCQ: ${aiQuestionModel||aiModel||'Gemini'} • retry/fallback ON`;else if(aiLiveState==='busy-or-error')ai.textContent='Configured, but Gemini is busy/error • fallback will retry';else ai.textContent=`Configured • MCQ: ${aiQuestionModel||aiModel||'Gemini'} • connection not tested`;}
    const b=$('#refreshAnalysisBtn');if(b)b.disabled=!aiAvailable||!currentUser;const t=$('#testAiBtn');if(t)t.disabled=!aiAvailable;
  }
  async function checkAiConnection(show=true){
    if(!aiAvailable){aiLiveState='not-configured';setApiBadge('off','AI not configured');renderSourceStatus();return;}
    setApiBadge('checking','AI checking');try{const d=await api('/api/adaptive/test-ai',{method:'POST',body:'{}'});aiLiveState=d.state||'connected';aiQuestionModel=d.modelUsed||aiQuestionModel||aiModel;setApiBadge('ok',`AI connected • ${aiQuestionModel}${d.fallbackUsed?' fallback':''}`);if(show)alert(`Gemini connected\nMCQ model: ${aiQuestionModel}\nLatency: ${d.latencyMs} ms${d.fallbackUsed?'\nFallback model was used because primary was busy.':''}`);}catch(e){aiLiveState='busy-or-error';setApiBadge('busy','AI busy / retry');if(show)alert(e.message);}renderSourceStatus();
  }
  async function loadOldPapers(){
    try{const d=await api('/api/old-papers/analysis',{method:'GET',headers:{}});oldPaperData=d;renderOldPapers();}catch(_){oldPaperData=null;renderOldPapers();}
  }
  function renderOldPapers(){
    const sum=$('#oldPaperSummary'),patterns=$('#oldPaperPatterns'),sources=$('#oldPaperSources'),topics=$('#oldPaperTopics');if(!sum||!patterns||!sources||!topics)return;
    const data=oldPaperData?.data||{};sum.textContent=data.summary||'No online analysis cached yet. Use “Analyze old papers now”.';const rp=Array.isArray(data.recurringPatterns)?data.recurringPatterns:[];
    patterns.innerHTML=rp.length?rp.slice(0,12).map(x=>`<div class="pattern-item"><b>${escapeHtml(x.subject||'CCE')} • ${escapeHtml(x.topic||'')}</b><span>${escapeHtml(x.pattern||'Recurring pattern')}</span></div>`).join(''):'<div class="empty-inline">Refresh analysis to extract recurring patterns.</div>';
    const pages=oldPaperData?.sources?.pages||[];const videos=oldPaperData?.sources?.videos||[];sources.innerHTML=[...pages.map((u,i)=>`<a href="${escapeAttr(u)}" target="_blank" rel="noopener">Paper/source ${i+1} ↗</a>`),...videos.map((u,i)=>`<a href="${escapeAttr(u)}" target="_blank" rel="noopener">Solution video ${i+1} ▶</a>`)].join('');
    topics.innerHTML=CCE.SUBJECTS.map(s=>`<article><h4>${escapeHtml(s.name)}</h4><div>${(CCE.TOPICS[s.key]||[]).map(t=>`<button class="ghost pyq-topic" data-pyq-sub="${escapeAttr(s.key)}" data-pyq-topic="${escapeAttr(t)}">${escapeHtml(t)} • 100</button>`).join('')}</div></article>`).join('');$$('[data-pyq-sub]').forEach(b=>b.onclick=()=>startTopic(b.dataset.pyqSub,b.dataset.pyqTopic,{pyqFocus:true}));
  }
  const refresh=$('#refreshAnalysisBtn');if(refresh)refresh.onclick=async()=>{refresh.disabled=true;refresh.textContent='Analyzing papers + videos…';try{const d=await api('/api/adaptive/analyze-sources',{method:'POST',body:'{}'});oldPaperData={...(oldPaperData||{}),data:d.data};renderOldPapers();alert(`Source analysis refreshed.\n\n${d.data?.summary||'Done'}`);}catch(e){alert(e.message);}finally{refresh.textContent='Refresh PYQ/video analysis';renderSourceStatus();}};
  const testAi=$('#testAiBtn');if(testAi)testAi.onclick=()=>checkAiConnection(true);
  const refreshOld=$('#refreshOldPapers');if(refreshOld)refreshOld.onclick=async()=>{if(!currentUser){alert('Login first to run online paper/video analysis.');openAuth();return;}refreshOld.disabled=true;refreshOld.textContent='Analyzing…';try{const d=await api('/api/adaptive/analyze-sources',{method:'POST',body:'{}'});oldPaperData={...(oldPaperData||{}),data:d.data};renderOldPapers();}catch(e){alert(e.message);}finally{refreshOld.disabled=false;refreshOld.textContent='Analyze old papers now';}};

  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function escapeAttr(s){return escapeHtml(String(s??''));}
  function safeHttpUrl(v){try{const u=new URL(String(v||''));return ['http:','https:'].includes(u.protocol)?u.href:'';}catch(_){return '';}}

  $('#startDaily').onclick=startDaily;$('#startMock').onclick=startMock;$('#startAiMock').onclick=startAiMock;const opm=$('#oldPaperMockBtn');if(opm)opm.onclick=startAiMock;$('#notAttempted').onclick=notAttempt;$('#nextBtn').onclick=next;$('#finishBtn').onclick=()=>finishQuiz();$('#bookmarkBtn').onclick=toggleBookmark;$('#next100Btn').onclick=()=>lastNextAction&&lastNextAction();$('#reviewWrongBtn').onclick=startWrong;$('#startWrong').onclick=startWrong;
  $('#themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';applyTheme();save();};
  $('#resetBtn').onclick=()=>{if(confirm('Reset all CCE practice progress, adaptive local resume state and wrong-answer bank? Cloud progress will also reset if logged in.')){const theme=state.theme;state=defaultState();state.theme=theme;save();}};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){persistAdaptive();saveLocal(true);if(currentUser)saveCloud(false);}});

  applyTheme();resetEmpty();buildSubjects();renderAllProgress();syncCurrentAffairs();initAuth();
})();
