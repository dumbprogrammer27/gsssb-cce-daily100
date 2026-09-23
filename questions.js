const CCE = (() => {
  const SUBJECTS = [
    { key: 'reasoning', name: 'Reasoning', marks: 60 },
    { key: 'quant', name: 'Quantitative Aptitude', marks: 30 },
    { key: 'ga', name: 'General Awareness & Current Affairs', marks: 30 },
    { key: 'gujarati', name: 'Gujarati', marks: 15 },
    { key: 'english', name: 'English', marks: 15 },
  ];

  const TOPICS = {
    reasoning:['Coding-Decoding','Blood Relation','Problem on Ages and Height','Direction Sense','Clock and Calendar','Venn Diagram','Rank and Position','Arithmetic Progression','Logical Sequence of Words','Inserting the missing Character','Word, Numerical and General Analogy','Picture Based General Logical Questions','Probability','Data Interpretation and Data Sufficiency','Symmetry','Mathematical Operations','Mathematical Modeling','Mathematical Proof','Logical and Mathematical Analytical Ability','Statement and Prediction'],
    quant:['Number System','LCM and HCF','Percentage and Partnership','Profit-Loss','Simple and Compound Interest','Ratio and Proportion','Time and Work, Wages and Chain Rule','Time, Speed and Distance','Mean, Mode and Median','Brackets and Expansions','Square/Square Roots, Cube/Cube Roots, Exponents','Polynomials and Factorisation','Linear Equations and Quadratic Equations','Area, Surface Area and Volume','Coordinate Geometry and Trigonometry'],
    ga:['History of India','Cultural Heritage of India','Geography','Indian Polity','Economics','Science','Current Affairs: Regional, National and International'],
    gujarati:['રૂઢિપ્રયોગનો અર્થ','કહેવતનો અર્થ','સમાસનો વિગ્રહ અને ઓળખ','છંદ','અલંકાર','શબ્દસમૂહ માટે એક શબ્દ','જોડણીશુદ્ધિ','લેખનશુદ્ધિ/ભાષાશુદ્ધિ','સંધિ જોડો કે છોડો','સમાનાર્થી શબ્દ','વિરુદ્ધાર્થી શબ્દ','વિભક્તિ','ધ્વનિ','વ્યંજન-સ્વર જોડી શબ્દ બનાવો','શબ્દોને શબ્દકોષના ક્રમમાં ગોઠવો','વાક્ય પરિવર્તન','ગુજરાતી-અંગ્રેજી ભાષાંતર'],
    english:['Tenses','Voices','Direct/Indirect Speech','Articles and Determiners','Adjectives, Prepositions and Conjunctions','Verbs and Adverbs','Noun and Pronoun','Jumbled Words and Sentences','Synonyms','Antonyms','Homonyms/Homophones','Transformation of Sentence','Idiomatic Expressions','One Word Substitution','English-Gujarati Translation']
  };

  const SOURCE_URLS = {
    'Constitution of India':'https://legislative.gov.in/constitution-of-india/',
    'Government of Gujarat':'https://gujaratindia.gov.in/',
    'Narmada Control Authority':'https://nca.gov.in/',
    'Gujarat Forest Department':'https://forests.gujarat.gov.in/',
    'NCERT Science':'https://ncert.nic.in/',
    'NCERT Geography':'https://ncert.nic.in/',
    'Gandhi Heritage Portal':'https://www.gandhiheritageportal.org/',
    'National Archives of India':'https://nationalarchives.nic.in/',
    'Reserve Bank of India':'https://www.rbi.org.in/',
    'Election Commission of India':'https://www.eci.gov.in/',
    'Statue of Unity official':'https://statueofunity.in/',
    'Gujarat Tourism':'https://www.gujarattourism.com/'
  };

  function videoLink(subject, topic='') {
    const subjectNames = {
      reasoning:'Reasoning', quant:'Maths Quantitative Aptitude', ga:'General Knowledge Current Affairs',
      gujarati:'Gujarati Grammar', english:'English Grammar'
    };
    const query = `${subjectNames[subject] || subject} ${topic || ''} GSSSB CCE Gujarati explanation`.replace(/\s+/g,' ').trim();
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  }

  const ri = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
  const shuffle = arr => [...arr].sort(() => Math.random()-0.5);
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  const lcm = (a,b) => Math.abs(a*b)/gcd(a,b);
  const letter = n => String.fromCharCode(65 + ((n%26)+26)%26);

  function makeOptions(correct, distractors, fmt=x=>String(x)) {
    const unique = [];
    [correct, ...distractors].forEach(v => { if (!unique.some(x => String(x) === String(v))) unique.push(v); });
    while (unique.length < 4) {
      const base = typeof correct === 'number' ? correct : String(correct).length;
      const extra = typeof correct === 'number' ? base + ri(-9, 9) || base+1 : `${correct}${unique.length}`;
      if (!unique.some(x => String(x) === String(extra))) unique.push(extra);
    }
    const opts = shuffle(unique.slice(0,4));
    return { options: opts.map(fmt), answer: opts.findIndex(v => String(v) === String(correct)) };
  }

  function qBase(subject, topic, text, options, answer, explanation, source='Practice generator') {
    return { id: `${subject}-${Date.now()}-${Math.random().toString(36).slice(2)}`, subject, topic, text, options, answer, explanation, source, sourceUrl: SOURCE_URLS[source] || '' };
  }

  function reasoningQuestion() {
    const t = ri(1,7);
    if (t===1) {
      const start=ri(2,30), d=ri(2,12), seq=[0,1,2,3].map(i=>start+i*d), correct=start+4*d;
      const o=makeOptions(correct,[correct+d,correct-d,correct+2]);
      return qBase('reasoning','Number Series',`શ્રેણીમાં આગળની સંખ્યા કઈ? ${seq.join(', ')}, ?`,o.options,o.answer,`દર વખતે ${d} ઉમેરાય છે. જવાબ ${correct}.`);
    }
    if (t===2) {
      const a=ri(1,18), d=ri(1,5); const seq=[0,1,2,3].map(i=>letter(a+i*d)); const correct=letter(a+4*d);
      const o=makeOptions(correct,[letter(a+5*d),letter(a+4*d+1),letter(a+3*d)]);
      return qBase('reasoning','Alphabet Series',`Find the next letter: ${seq.join(', ')}, ?`,o.options,o.answer,`Alphabet positions increase by ${d}.`);
    }
    if (t===3) {
      const shift=ri(1,4); const words=['CAT','DOG','MAP','SUN','BOX','PEN']; const w=words[ri(0,words.length-1)];
      const enc=[...w].map(c=>letter(c.charCodeAt(0)-65+shift)).join('');
      const target=words[(words.indexOf(w)+ri(1,words.length-1))%words.length];
      const correct=[...target].map(c=>letter(c.charCodeAt(0)-65+shift)).join('');
      const ds=[...Array(3)].map((_,i)=>[...target].map(c=>letter(c.charCodeAt(0)-65+shift+i+1)).join(''));
      const o=makeOptions(correct,ds);
      return qBase('reasoning','Coding-Decoding',`જો ${w} ને ${enc} તરીકે code કરવામાં આવે છે, તો ${target} નો code શું થશે?`,o.options,o.answer,`દરેક અક્ષરને ${shift} સ્થાન આગળ ખસેડવામાં આવ્યો છે.`);
    }
    if (t===4) {
      const north=ri(3,12), east=ri(3,12); const dist=Math.sqrt(north*north+east*east); const correct=Number.isInteger(dist)?dist:Math.round(dist*10)/10;
      const o=makeOptions(correct,[north+east,Math.abs(north-east),Math.max(north,east)]);
      return qBase('reasoning','Direction Sense',`એક વ્યક્તિ ${north} km ઉત્તર અને પછી ${east} km પૂર્વ જાય છે. શરૂઆતના બિંદુથી તેની સીધી દૂરી આશરે કેટલી?`,o.options,o.answer,`Pythagoras: √(${north}²+${east}²) ≈ ${correct} km.`);
    }
    if (t===5) {
      const total=ri(25,60), rankTop=ri(3,Math.min(20,total-5)); const correct=total-rankTop+1;
      const o=makeOptions(correct,[total-rankTop,total-rankTop+2,rankTop]);
      return qBase('reasoning','Rank & Position',`${total} વિદ્યાર્થીઓની કતારમાં Ravi ઉપરથી ${rankTop}મો છે. નીચેથી તેનો ક્રમ કેટલો?`,o.options,o.answer,`${total} - ${rankTop} + 1 = ${correct}.`);
    }
    if (t===6) {
      const pairs=[['Book','Read','Food','Eat'],['Bird','Fly','Fish','Swim'],['Eye','See','Ear','Hear'],['Doctor','Hospital','Teacher','School']];
      const p=pairs[ri(0,pairs.length-1)];
      const correct=p[3]; const ds=['Run','Write','Office','Speak'].filter(x=>x!==correct);
      const o=makeOptions(correct,ds);
      return qBase('reasoning','Analogy',`${p[0]} : ${p[1]} :: ${p[2]} : ?`,o.options,o.answer,`${p[0]} નો સંબંધ ${p[1]} સાથે જેવો છે, એવો ${p[2]} નો સંબંધ ${p[3]} સાથે છે.`);
    }
    const sets=[
      {text:'A, B નો ભાઈ છે. B, C ની બહેન છે. તો A નો C સાથે શું સંબંધ?', correct:'ભાઈ', ds:['પિતા','બહેન','કાકા']},
      {text:'P, Q ની માતા છે. Q, R નો ભાઈ છે. તો P નો R સાથે શું સંબંધ?', correct:'માતા', ds:['બહેન','પિતા','કાકી']},
      {text:'X, Y નો પિતા છે. Y, Z ની બહેન છે. તો X નો Z સાથે શું સંબંધ?', correct:'પિતા', ds:['ભાઈ','મામા','દાદા']}
    ];
    const s=sets[ri(0,sets.length-1)], o=makeOptions(s.correct,s.ds);
    return qBase('reasoning','Blood Relation',s.text,o.options,o.answer,`સંબંધને family tree રૂપે ગોઠવવાથી જવાબ ${s.correct} આવે છે.`);
  }

  function quantQuestion() {
    const t=ri(1,8);
    if(t===1){
      const base=ri(5,40)*10, pct=[5,10,12.5,15,20,25,30,40,50][ri(0,8)], correct=base*pct/100;
      const o=makeOptions(correct,[correct+base*.05,correct-base*.05,base-pct]);
      return qBase('quant','Percentage',`${base} નું ${pct}% કેટલું?`,o.options,o.answer,`${base} × ${pct}/100 = ${correct}.`);
    }
    if(t===2){
      const cp=ri(10,50)*10, pct=[5,10,15,20,25][ri(0,4)], sp=cp*(100+pct)/100, correct=sp;
      const o=makeOptions(correct,[cp*(100-pct)/100,cp+pct,cp]);
      return qBase('quant','Profit & Loss',`એક વસ્તુ ₹${cp} માં ખરીદી અને ${pct}% નફા પર વેચી. વેચાણ કિંમત કેટલી?`,o.options,o.answer,`SP = ${cp} × (100+${pct})/100 = ₹${correct}.`);
    }
    if(t===3){
      const a=ri(2,8), b=ri(2,8), k=ri(5,20), total=(a+b)*k, correct=a*k;
      const o=makeOptions(correct,[b*k,total,Math.abs(a-b)*k]);
      return qBase('quant','Ratio',`A:B = ${a}:${b} અને કુલ રકમ ${total} છે. A નો ભાગ કેટલો?`,o.options,o.answer,`${a}/${a+b} × ${total} = ${correct}.`);
    }
    if(t===4){
      const nums=[ri(10,30),ri(10,30),ri(10,30),ri(10,30)]; const sum=nums.reduce((a,b)=>a+b,0), correct=sum/4;
      const o=makeOptions(correct,[correct+2,correct-2,sum]);
      return qBase('quant','Average',`${nums.join(', ')} નો સરેરાશ કેટલો?`,o.options,o.answer,`કુલ ${sum}; ${sum}/4 = ${correct}.`);
    }
    if(t===5){
      const p=ri(10,50)*100, r=[5,6,8,10,12][ri(0,4)], y=ri(1,4), correct=p*r*y/100;
      const o=makeOptions(correct,[p*r/100,correct+p,correct-y*10]);
      return qBase('quant','Simple Interest',`₹${p} પર ${r}% વાર્ષિક દરે ${y} વર્ષનું Simple Interest કેટલું?`,o.options,o.answer,`SI = P×R×T/100 = ₹${correct}.`);
    }
    if(t===6){
      const speed=[30,40,50,60,72][ri(0,4)], time=ri(2,6), correct=speed*time;
      const o=makeOptions(correct,[speed+time,speed*(time-1),speed*(time+1)]);
      return qBase('quant','Time-Speed-Distance',`${speed} km/h ઝડપે ${time} કલાકમાં કેટલું અંતર કાપશે?`,o.options,o.answer,`Distance = Speed × Time = ${correct} km.`);
    }
    if(t===7){
      const a=ri(2,15)*2, b=ri(2,15)*2, correct=gcd(a,b); const o=makeOptions(correct,[lcm(a,b),Math.min(a,b),correct+2]);
      return qBase('quant','HCF',`${a} અને ${b} નો HCF કેટલો?`,o.options,o.answer,`Greatest common divisor = ${correct}.`);
    }
    const daysA=[6,8,10,12,15,20][ri(0,5)], daysB=[6,8,10,12,15,20][ri(0,5)];
    const together=1/(1/daysA+1/daysB); const correct=Math.round(together*100)/100;
    const o=makeOptions(correct,[daysA+daysB,Math.abs(daysA-daysB)||2,Math.round((daysA+daysB)/2*100)/100]);
    return qBase('quant','Time & Work',`A કામ ${daysA} દિવસમાં અને B ${daysB} દિવસમાં કરે. બંને સાથે કામ આશરે કેટલા દિવસમાં કરશે?`,o.options,o.answer,`Combined rate = 1/${daysA} + 1/${daysB}; time ≈ ${correct} days.`);
  }

  const englishBank = [
    ['Tenses','Choose the correct form: She ___ to office every day.',['go','goes','going','gone'],1,'With third-person singular in simple present, use “goes”.'],
    ['Articles','Choose the correct article: He is ___ honest man.',['a','an','the','no article'],1,'“Honest” begins with a vowel sound, so use “an”.'],
    ['Prepositions','Fill in the blank: The meeting starts ___ 10 a.m.',['in','on','at','by'],2,'Use “at” for a specific clock time.'],
    ['Synonym','Choose the synonym of “Rapid”.',['Slow','Quick','Weak','Late'],1,'Rapid means quick or fast.'],
    ['Antonym','Choose the antonym of “Ancient”.',['Old','Historic','Modern','Past'],2,'Modern is the opposite of ancient.'],
    ['Voice','Change to passive voice: “The team completed the work.”',['The work completed the team.','The work was completed by the team.','The team was completed by the work.','The work is completed by the team.'],1,'Simple past passive: was/were + past participle.'],
    ['Direct/Indirect','Choose the indirect form: He said, “I am tired.”',['He said that he was tired.','He says that I am tired.','He said he is tired.','He told that he tired.'],0,'Backshift “am” to “was” in reported speech.'],
    ['One word substitution','One who writes dictionaries is called a…',['Biographer','Lexicographer','Photographer','Calligrapher'],1,'A lexicographer compiles dictionaries.'],
    ['Homophones','Choose the correct word: Please ___ the door.',['close','clothes','cloze','closed'],0,'“Close” means shut.'],
    ['Conjunction','I wanted to go, ___ it was raining.',['and','but','or','because'],1,'“But” shows contrast.'],
    ['Pronoun','Rita and ___ went to the market.',['me','I','mine','my'],1,'Subject pronoun “I” is required.'],
    ['Adjective','Choose the adjective: “She wore a beautiful dress.”',['She','wore','beautiful','dress'],2,'“Beautiful” describes the noun “dress”.'],
    ['Adverb','Choose the adverb: “He spoke softly.”',['He','spoke','softly','none'],2,'“Softly” modifies the verb “spoke”.'],
    ['Sentence correction','Choose the correct sentence.',['He do not know.','He does not knows.','He does not know.','He not know.'],2,'After “does not”, use base verb “know”.'],
    ['Vocabulary','Meaning of “Abundant” is…',['Scarce','Plentiful','Empty','Rare'],1,'Abundant means plentiful.'],
    ['Prepositions','She is good ___ mathematics.',['in','at','on','for'],1,'The standard phrase is “good at”.'],
    ['Tenses','By next year, they ___ the project.',['complete','completed','will have completed','have complete'],2,'Future perfect: will have + past participle.'],
    ['Articles','___ Ganga is a sacred river.',['A','An','The','No article'],2,'Names of rivers generally take “the”.'],
    ['Antonym','Antonym of “Expand” is…',['Increase','Extend','Contract','Grow'],2,'Contract means reduce/shrink.'],
    ['Synonym','Synonym of “Diligent” is…',['Lazy','Hardworking','Careless','Weak'],1,'Diligent means hardworking/careful.']
  ];

  const gujaratiBank = [
    ['સમાનાર્થી','“સૂર્ય”નો સમાનાર્થી શબ્દ કયો?',['રવિ','શશી','અનિલ','સાગર'],0,'“રવિ” સૂર્યનો સમાનાર્થી છે.'],
    ['વિરુદ્ધાર્થી','“લાભ”નો વિરુદ્ધાર્થી શબ્દ કયો?',['નફો','ફાયદો','હાનિ','ઉપકાર'],2,'લાભનો વિરુદ્ધાર્થી “હાનિ” છે.'],
    ['જોડણી','શુદ્ધ જોડણી કઈ?',['પરિસ્થીતિ','પરિસ્થિતિ','પરીસ્થિતી','પરિસ્થીતી'],1,'શુદ્ધ જોડણી “પરિસ્થિતિ” છે.'],
    ['એક શબ્દ','“જેનો કોઈ શત્રુ ન હોય” માટે એક શબ્દ કયો?',['અજાતશત્રુ','અનાથ','અનન્ય','અદ્વિતીય'],0,'“અજાતશત્રુ” એટલે જેનો શત્રુ ન હોય.'],
    ['રૂઢિપ્રયોગ','“આંખમાં ધૂળ નાખવી”નો અર્થ શું?',['સાચું કહેવું','છેતરવું','રડવું','ગુસ્સે થવું'],1,'આ રૂઢિપ્રયોગનો અર્થ છેતરવું થાય છે.'],
    ['કહેવત','“જેવું વાવો તેવું લણો”નો અર્થ શું?',['મહેનત ન કરવી','કર્મ પ્રમાણે પરિણામ મળે','ખેતી કરવી','સમય ગુમાવવો'],1,'કર્મ/વર્તન પ્રમાણે પરિણામ મળે તે ભાવ છે.'],
    ['સમાનાર્થી','“પૃથ્વી”નો સમાનાર્થી કયો?',['ધરા','વ્યોમ','અગ્નિ','પવન'],0,'“ધરા” પૃથ્વીનો સમાનાર્થી છે.'],
    ['વિરુદ્ધાર્થી','“આદર”નો વિરુદ્ધાર્થી કયો?',['માન','સન્માન','અનાદર','સ્વીકાર'],2,'આદરનો વિરુદ્ધાર્થી “અનાદર” છે.'],
    ['જોડણી','શુદ્ધ શબ્દ કયો?',['સ્વતંત્રતા','સ્વતંર્તા','સ્વતન્ત્રતા','સ્વતંત્ર્તા'],0,'શુદ્ધ લખાણ “સ્વતંત્રતા” છે.'],
    ['શબ્દસમૂહ માટે એક શબ્દ','“જે બધું જાણે છે” માટે એક શબ્દ કયો?',['સર્વજ્ઞ','સર્વત્ર','સર્વનામ','સર્વદા'],0,'“સર્વજ્ઞ” એટલે બધું જાણનાર.'],
    ['રૂઢિપ્રયોગ','“હાથ ધોઈને પાછળ પડવું”નો અર્થ શું?',['સફાઈ કરવી','જિદ્દપૂર્વક પીછો કરવો','મદદ કરવી','હાર સ્વીકારવી'],1,'અર્થ: જિદ્દપૂર્વક કોઈના પાછળ લાગવું.'],
    ['કહેવત','“ઉતાવળે આંબા ન પાકે”નો ભાવ શું?',['ધીરજ રાખવી જરૂરી','આંબા ન ખાવા','ઝડપથી કામ કરવું','વાવેતર કરવું'],0,'સારા પરિણામ માટે સમય અને ધીરજ જરૂરી છે.'],
    ['વિરુદ્ધાર્થી','“પ્રકાશ”નો વિરુદ્ધાર્થી કયો?',['તેજ','અંધકાર','દીવો','કિરણ'],1,'પ્રકાશનો વિરુદ્ધાર્થી અંધકાર છે.'],
    ['સમાનાર્થી','“આકાશ”નો સમાનાર્થી કયો?',['ગગન','ધરા','જળ','વન'],0,'“ગગન” આકાશનો સમાનાર્થી છે.'],
    ['જોડણી','શુદ્ધ જોડણી પસંદ કરો.',['જવાબદારી','જવાબદારીં','જવાબદારીય','જવાબ્દારી'],0,'શુદ્ધ શબ્દ “જવાબદારી” છે.'],
    ['એક શબ્દ','“જે કદી મરે નહીં” માટે એક શબ્દ કયો?',['અમર','અચળ','અનાથ','અજ્ઞાત'],0,'“અમર” એટલે જે મરે નહીં.'],
    ['રૂઢિપ્રયોગ','“નાક કપાવવું”નો અર્થ શું?',['માન વધવું','અપમાન થવું','ઘાયલ થવું','બીમાર થવું'],1,'અર્થ: અપમાન થવું.'],
    ['કહેવત','“એક હાથથી તાળી ન પડે”નો અર્થ શું?',['એકલો માણસ મજબૂત','વિવાદમાં બંને પક્ષ જવાબદાર હોઈ શકે','સંગીત શીખવું','હાથ ન વાપરવો'],1,'ઘણા વિવાદોમાં બંને પક્ષનું યોગદાન હોય તે ભાવ છે.'],
    ['વિરુદ્ધાર્થી','“સત્ય”નો વિરુદ્ધાર્થી કયો?',['અસત્ય','તથ્ય','પ્રમાણ','વચન'],0,'સત્યનો વિરુદ્ધાર્થી અસત્ય છે.'],
    ['સમાનાર્થી','“જળ”નો સમાનાર્થી કયો?',['નીર','અનિલ','અનલ','ધરા'],0,'“નીર” એટલે જળ.']
  ];

  const gaBank = [
    ['Indian Polity','ભારતનું બંધારણ ક્યારે અમલમાં આવ્યું?',['26 જાન્યુઆરી 1950','15 ઑગસ્ટ 1947','26 નવેમ્બર 1949','2 ઑક્ટોબર 1950'],0,'ભારતનું બંધારણ 26 જાન્યુઆરી 1950થી અમલમાં આવ્યું.','Constitution of India'],
    ['Indian Polity','ભારતનું બંધારણ ક્યારે સ્વીકારવામાં આવ્યું?',['26 નવેમ્બર 1949','26 જાન્યુઆરી 1950','15 ઑગસ્ટ 1947','1 મે 1960'],0,'Constituent Assemblyએ 26 નવેમ્બર 1949એ બંધારણ સ્વીકાર્યું.','Constitution of India'],
    ['Gujarat','ગુજરાત રાજ્યની સ્થાપના ક્યારે થઈ?',['1 મે 1960','26 જાન્યુઆરી 1950','15 ઑગસ્ટ 1947','2 ઑક્ટોબર 1965'],0,'Bombay Stateના વિભાજન બાદ 1 મે 1960એ ગુજરાત રચાયું.','Government of Gujarat'],
    ['Gujarat','ગુજરાતની રાજધાની કઈ છે?',['અમદાવાદ','સુરત','ગાંધીનગર','વડોદરા'],2,'ગુજરાતની રાજધાની ગાંધીનગર છે.','Government of Gujarat'],
    ['Geography','સર્દાર સરોવર ડેમ કઈ નદી પર છે?',['તાપી','નર્મદા','મહી','સાબરમતી'],1,'સર્દાર સરોવર પ્રોજેક્ટ નર્મદા નદી પર છે.','Narmada Control Authority'],
    ['Environment','ગીર રાષ્ટ્રીય ઉદ્યાન મુખ્યત્વે કયા પ્રાણી માટે જાણીતું છે?',['એકશિંગો ગેંડો','એશિયાટિક સિંહ','હિમ તંદુરસ્ત ચિત્તો','લાલ પાંડા'],1,'ગીર એ એશિયાટિક સિંહનું મુખ્ય કુદરતી નિવાસસ્થાન છે.','Gujarat Forest Department'],
    ['Science','માનવ શરીરમાં રક્ત પંપ કરતું અંગ કયું?',['ફેફસા','યકૃત','હૃદય','કિડની'],2,'હૃદય રક્ત પરિભ્રમણ માટે પંપ તરીકે કામ કરે છે.','NCERT Science'],
    ['Science','પાણીનું રાસાયણિક સૂત્ર શું છે?',['CO₂','H₂O','O₂','NaCl'],1,'પાણી H₂O અણુઓથી બને છે.','NCERT Science'],
    ['Science','વનસ્પતિમાં પ્રકાશસંશ્લેષણ માટે મુખ્ય રંગદ્રવ્ય કયું?',['હિમોગ્લોબિન','મેલાનિન','ક્લોરોફિલ','કેરોટિન માત્ર'],2,'ક્લોરોફિલ પ્રકાશ ઊર્જા શોષે છે.','NCERT Science'],
    ['History','દાંડી કૂચ કયા વર્ષમાં થઈ?',['1919','1920','1930','1942'],2,'મહાત્મા ગાંધીની દાંડી કૂચ 1930માં શરૂ થઈ.','Gandhi Heritage Portal'],
    ['History','ભારત છોડો આંદોલન કયા વર્ષમાં શરૂ થયું?',['1930','1942','1947','1919'],1,'Quit India Movement 1942માં શરૂ થયું.','National Archives of India'],
    ['Geography','ભારતનો દક્ષિણતમ મુખ્ય ભૂખંડીય બિંદુ કયો?',['કન્યાકુમારી','ઇન્દિરા પોઈન્ટ','કોચી','રામેશ્વરમ'],0,'મુખ્ય ભૂખંડનો દક્ષિણતમ બિંદુ કન્યાકુમારી છે.','NCERT Geography'],
    ['Economy','ભારતીય રિઝર્વ બેંક (RBI) કયા ક્ષેત્ર સાથે મુખ્યત્વે સંબંધિત છે?',['રક્ષા','મોનેટરી/બેંકિંગ પ્રણાલી','ખેતી સંશોધન','રેલવે'],1,'RBI ભારતની કેન્દ્રીય બેંક છે.','Reserve Bank of India'],
    ['Polity','ભારતના રાષ્ટ્રપતિની ચૂંટણી કોણ કરે છે?',['માત્ર લોકસભા','માત્ર રાજ્યસભા','ચૂંટણી મંડળ','સીધી જનતા'],2,'રાષ્ટ્રપતિની ચૂંટણી નિર્ધારિત electoral college દ્વારા થાય છે.','Election Commission of India'],
    ['Polity','લોકસભાનો સામાન્ય કાર્યકાળ કેટલા વર્ષનો છે?',['4','5','6','7'],1,'સામાન્ય રીતે લોકસભાનો કાર્યકાળ 5 વર્ષનો હોય છે, જો વહેલી વિઘટન ન થાય.','Constitution of India'],
    ['Science','વિદ્યુત પ્રવાહનું SI એકમ કયું?',['Volt','Ampere','Ohm','Watt'],1,'Electric currentનું SI unit ampere છે.','NCERT Science'],
    ['Science','બળનું SI એકમ કયું?',['Joule','Newton','Pascal','Watt'],1,'Forceનું SI unit newton છે.','NCERT Science'],
    ['Geography','કર્કવૃત્ત ભારતના કયા ભાગમાંથી પસાર થાય છે?',['ઉત્તરથી દક્ષિણ','પશ્ચિમથી પૂર્વ મધ્ય ભારત','માત્ર દરિયાકાંઠે','ભારતમાંથી પસાર થતું નથી'],1,'Tropic of Cancer ભારતના મધ્ય ભાગમાંથી પશ્ચિમથી પૂર્વ જાય છે.','NCERT Geography'],
    ['Gujarat','સ્ટેચ્યુ ઓફ યુનિટી કોની પ્રતિમા છે?',['મહાત્મા ગાંધી','સરદાર વલ્લભભાઈ પટેલ','સુભાષચંદ્ર બોઝ','ડૉ. આંબેડકર'],1,'Statue of Unity સરદાર વલ્લભભાઈ પટેલને સમર્પિત છે.','Statue of Unity official'],
    ['Gujarat','કચ્છનું રણ કયા પ્રકારના ભૂદૃશ્ય માટે જાણીતું છે?',['ઘન જંગલ','મીઠાળું મરુસ્થલ','હિમપ્રદેશ','કાળી માટી'],1,'Great Rann of Kutch વિશાળ salt marsh માટે જાણીતું છે.','Gujarat Tourism']
  ];

  function bankQuestion(subject, bank) {
    const item=bank[ri(0,bank.length-1)];
    return qBase(subject,item[0],item[1],item[2],item[3],item[4],item[5] || 'CCE syllabus practice');
  }

  function bankQuestionByTopic(subject, bank, topic) {
    const filtered = topic ? bank.filter(item => item[0]===topic) : bank;
    return bankQuestion(subject, filtered.length ? filtered : bank);
  }

  function generate(subject, topic=null) {
    if(subject==='reasoning') {
      if(!topic) return reasoningQuestion();
      for(let i=0;i<80;i++){ const q=reasoningQuestion(); if(q.topic===topic) return q; }
      return reasoningQuestion();
    }
    if(subject==='quant') {
      if(!topic) return quantQuestion();
      for(let i=0;i<80;i++){ const q=quantQuestion(); if(q.topic===topic) return q; }
      return quantQuestion();
    }
    if(subject==='english') return bankQuestionByTopic('english',englishBank,topic);
    if(subject==='gujarati') return bankQuestionByTopic('gujarati',gujaratiBank,topic);
    if(subject==='ga') return bankQuestionByTopic('ga',gaBank,topic && topic!=='Current Affairs • PIB' ? topic : null);
    return bankQuestion('ga',gaBank);
  }

  function generateTopic(subject, topic, count=30, currentAffairs=[]) {
    if(subject==='ga' && topic==='Current Affairs • PIB' && currentAffairs.length) {
      const out=[];
      while(out.length<count) out.push({...currentAffairs[out.length % currentAffairs.length],id:`ca-topic-${Date.now()}-${out.length}-${Math.random().toString(36).slice(2)}`});
      return shuffle(out);
    }
    const out=[];
    for(let i=0;i<count;i++) out.push(generate(subject,topic));
    return shuffle(out);
  }

  function generateSet(count=100, mode='daily', currentAffairs=[]) {
    const distribution = count===150
      ? {reasoning:60,quant:30,ga:30,gujarati:15,english:15}
      : {reasoning:40,quant:20,ga:20,gujarati:10,english:10};
    const out=[];
    Object.entries(distribution).forEach(([sub,n])=>{
      for(let i=0;i<n;i++){
        if(sub==='ga' && currentAffairs.length && i < Math.min(Math.ceil(n/3), currentAffairs.length)) {
          const ca=currentAffairs[i % currentAffairs.length];
          out.push({...ca,id:`ca-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`});
        } else out.push(generate(sub));
      }
    });
    return shuffle(out);
  }

  return { SUBJECTS, TOPICS, generate, generateTopic, generateSet, shuffle, videoLink };
})();
