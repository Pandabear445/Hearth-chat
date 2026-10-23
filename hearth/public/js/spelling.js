// Spelling in the message box (Settings → Chat → Spelling). Two things, both on this device only: nothing anyone
// types is looked up anywhere.
//  - Check spelling: the browser's (or the desktop app's) own spell checker underlines words it doesn't know, with
//    corrections on right-click (the spellcheck attribute; in the desktop app, its spell checker as well).
//  - Correct spelling as I type (computers; on by default where the browser's language is English): when a word is
//    finished (a space or punctuation after it), a common misspelling of it is fixed, "teh" → "the", "dont" →
//    "don't", "i" → "I". Only a fixed list of mistakes that aren't words themselves, so a real word, a name or slang
//    is never changed, nor a word with a capital in the middle of a sentence (a name) or a pasted one. Backspace or
//    Ctrl+Z right after a fix puts back what was typed, and that word is left alone after that. Phones and tablets
//    have their keyboard's own correction instead.
// Nothing is corrected inside `code`, links, @mentions, #channels, :emoji:, file names or words with digits.

// What's typed (lower case) → what it should be.
export const CORRECTIONS = Object.freeze({
  // Missing apostrophes
  im: "I'm", ive: "I've", youre: "you're", youve: "you've", youll: "you'll", youd: "you'd", theyre: "they're",
  theyve: "they've", theyll: "they'll", theyd: "they'd", weve: "we've", hes: "he's", shes: "she's", thats: "that's",
  whats: "what's", wheres: "where's", hows: "how's", theres: "there's", heres: "here's",
  itll: "it'll", thatll: "that'll", dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", wasnt: "wasn't",
  arent: "aren't", werent: "weren't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", cant: "can't",
  couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't", mustnt: "mustn't", neednt: "needn't", wont: "won't",
  aint: "ain't", wouldve: "would've", couldve: "could've", shouldve: "should've", mightve: "might've",
  mustve: "must've", whatre: "what're", whered: "where'd", howd: "how'd", whod: "who'd",
  // I
  i: 'I', "i'm": "I'm", "i've": "I've", "i'll": "I'll", "i'd": "I'd",
  // Letters swapped or doubled
  teh: 'the', hte: 'the', thw: 'the', taht: 'that', tath: 'that', thta: 'that', adn: 'and', jsut: 'just', waht: 'what', wnat: 'want', knwo: 'know', konw: 'know', woudl: 'would', wodul: 'would',
  coudl: 'could', shoudl: 'should', shuold: 'should', abotu: 'about', aobut: 'about', baout: 'about', agian: 'again',
  aginst: 'against', becuase: 'because', becasue: 'because', beacuse: 'because', becaue: 'because', bcause: 'because',
  cna: 'can', yuo: 'you', yoru: 'your', thnak: 'thank', thnaks: 'thanks', thansk: 'thanks', tahnks: 'thanks', wiht: 'with', wtih: 'with', wiill: 'will', htat: 'that', thier: 'their',
  theri: 'their', tehy: 'they', tyhe: 'the', whcih: 'which', wich: 'which', whihc: 'which', peopel: 'people',
  poeple: 'people', peolpe: 'people', becomeing: 'becoming', soem: 'some', smoe: 'some', somthing: 'something',
  somethign: 'something', soemthing: 'something', nothign: 'nothing', anythign: 'anything', everythign: 'everything',
  evrything: 'everything', evry: 'every', evrey: 'every', realy: 'really', relaly: 'really',   probaly: 'probably', probabaly: 'probably', porbably: 'probably', plase: 'please', pleae: 'please',
  plesae: 'please', tommorow: 'tomorrow', tomorow: 'tomorrow', tommorrow: 'tomorrow',
  tomarrow: 'tomorrow', yesturday: 'yesterday', yesterady: 'yesterday', wierd: 'weird',
  freind: 'friend', freinds: 'friends', firend: 'friend', firends: 'friends', gonig: 'going', giong: 'going',
  doign: 'doing', beign: 'being', thign: 'thing', thigns: 'things', thnig: 'thing', thikn: 'think',   tihnk: 'think', mroe: 'more', mreo: 'more', ahve: 'have', hvae: 'have', haev: 'have', ahd: 'had', fomr: 'from', frmo: 'from', owuld: 'would', yuor: 'your', yuore: "you're", recieve: 'receive',
  recieved: 'received', recieving: 'receiving', reciept: 'receipt', beleive: 'believe', belive: 'believe',
  beleived: 'believed', beleif: 'belief', acheive: 'achieve', acheived: 'achieved', decieve: 'deceive',
  percieve: 'perceive', peice: 'piece', freindly: 'friendly', hieght: 'height', wieght: 'weight', foriegn: 'foreign',
  seige: 'siege', sieze: 'seize', nieghbor: 'neighbor', recieves: 'receives',
  // Common misspellings
  definately: 'definitely', definatly: 'definitely', definetly: 'definitely', definitly: 'definitely',
  defintely: 'definitely', seperate: 'separate', seperated: 'separated', seperately: 'separately',
  occured: 'occurred', occuring: 'occurring', occurence: 'occurrence', ocurred: 'occurred', untill: 'until',
  alot: 'a lot', aswell: 'as well', atleast: 'at least', infront: 'in front',
  incase: 'in case', infact: 'in fact', inspite: 'in spite', noone: 'no one', thankyou: 'thank you',
  ofcourse: 'of course', eachother: 'each other', everytime: 'every time', alittle: 'a little', abit: 'a bit', goverment: 'government', govenment: 'government', enviroment: 'environment',
  embarass: 'embarrass', embarassed: 'embarrassed', embarassing: 'embarrassing', existance: 'existence',
  independant: 'independent', neccessary: 'necessary', necesary: 'necessary', neccesary: 'necessary',
  occassion: 'occasion', occassionally: 'occasionally', ocassionally: 'occasionally', persue: 'pursue',
  posession: 'possession', reccomend: 'recommend', recomend: 'recommend', reccommend: 'recommend',
  recomendation: 'recommendation', refered: 'referred', relevent: 'relevant', sucess: 'success',
  succesful: 'successful', successfull: 'successful', sucessful: 'successful', suprise: 'surprise',
  suprised: 'surprised', supprise: 'surprise', truely: 'truly', unfortunatly: 'unfortunately',
  unfortunetly: 'unfortunately', accross: 'across', adress: 'address', agressive: 'aggressive',
  apparantly: 'apparently', arguement: 'argument', basicly: 'basically',
  basicaly: 'basically', bascially: 'basically', begining: 'beginning', calender: 'calendar', catagory: 'category',
  cemetary: 'cemetery', collegue: 'colleague', comming: 'coming', commited: 'committed', commitee: 'committee',
  completly: 'completely', concious: 'conscious', curiousity: 'curiosity', dissapear: 'disappear',
  dissapeared: 'disappeared', dissapoint: 'disappoint', dissapointed: 'disappointed', dissapointing: 'disappointing',
  finaly: 'finally', fourty: 'forty', gaurd: 'guard', happend: 'happened', harrass: 'harass',
  immediatly: 'immediately', imediately: 'immediately', knowlege: 'knowledge', liason: 'liaison', libary: 'library',
  lisence: 'license', maintainance: 'maintenance', millenium: 'millennium', mischevious: 'mischievous',
  noticable: 'noticeable', oppurtunity: 'opportunity', oppertunity: 'opportunity', paralel: 'parallel',
  possibile: 'possible', prefered: 'preferred', presense: 'presence', publically: 'publicly',
  remeber: 'remember', resturant: 'restaurant', restaraunt: 'restaurant', rythm: 'rhythm',
  similiar: 'similar', simular: 'similar', sincerly: 'sincerely', speach: 'speech', strenght: 'strength',
  stregth: 'strength', tatoo: 'tattoo', tendancy: 'tendency', threshhold: 'threshold', tounge: 'tongue',
  vaccuum: 'vacuum', vacum: 'vacuum', vegatable: 'vegetable', whereever: 'wherever', yeild: 'yield',
  wherre: 'where', untl: 'until', usualy: 'usually', usally: 'usually', actualy: 'actually',
  acutally: 'actually', actaully: 'actually', totaly: 'totally', literaly: 'literally', litterally: 'literally',
  differant: 'different', diffrent: 'different', diferent: 'different', importent: 'important', imporant: 'important',
  intresting: 'interesting', interseting: 'interesting', beatiful: 'beautiful', beautifull: 'beautiful',
  wonderfull: 'wonderful', excercise: 'exercise', exersize: 'exercise', explaination: 'explanation',
  familar: 'familiar', febuary: 'February', wensday: 'Wednesday', wendsday: 'Wednesday',
  wednsday: 'Wednesday', saterday: 'Saturday', thrusday: 'Thursday', tuseday: 'Tuesday', januray: 'January',
  feburary: 'February', ninty: 'ninety', anwser: 'answer', answr: 'answer', awnser: 'answer', questoin: 'question',
  qustion: 'question', becouse: 'because', diffucult: 'difficult', dificult: 'difficult',
  easliy: 'easily', enought: 'enough', exept: 'except', excitment: 'excitement',
  experiance: 'experience', expierence: 'experience', favourate: 'favourite', favorit: 'favorite',
  favrite: 'favorite', guranteed: 'guaranteed', garantee: 'guarantee', gaurantee: 'guarantee', hapen: 'happen',
  hapened: 'happened', hapening: 'happening', heared: 'heard', hopefuly: 'hopefully',
  humerous: 'humorous', ignorence: 'ignorance', imagin: 'imagine', inteligent: 'intelligent', intelligant: 'intelligent',
  knowlegde: 'knowledge', langauge: 'language', langugage: 'language',
  lenght: 'length', mabye: 'maybe', maybee: 'maybe', medecine: 'medicine',
  messege: 'message', mesage: 'message', minuts: 'minutes', mispell: 'misspell',
  mispelled: 'misspelled', mispelling: 'misspelling', neice: 'niece', nessecary: 'necessary', ocurr: 'occur', oppinion: 'opinion', opinon: 'opinion', origional: 'original', orignal: 'original',
  particulary: 'particularly', passtime: 'pastime', perfom: 'perform', perfomance: 'performance',
  permenant: 'permanent', persistant: 'persistent', posibility: 'possibility',
  pratice: 'practice', prefrence: 'preference', privelege: 'privilege', priviledge: 'privilege',   promiss: 'promise', pronounciation: 'pronunciation', reffered: 'referred',
  religous: 'religious', repitition: 'repetition', responsability: 'responsibility', ridiculus: 'ridiculous',
  rediculous: 'ridiculous', scedule: 'schedule', schedual: 'schedule', sentance: 'sentence',
  shedule: 'schedule', sophmore: 'sophomore', strech: 'stretch', studing: 'studying',
  stoped: 'stopped', suceed: 'succeed', succeded: 'succeeded', surley: 'surely',
  temperture: 'temperature', tomatos: 'tomatoes', potatos: 'potatoes', togehter: 'together', togather: 'together', tounament: 'tournament', truley: 'truly', twelth: 'twelfth',
  unforseen: 'unforeseen', unneccessary: 'unnecessary', unnecesary: 'unnecessary',
  useing: 'using', vaccum: 'vacuum', visable: 'visible', writting: 'writing', writen: 'written', wroet: 'wrote', yourselfs: 'yourselves',
});
// Never in it: real words (ill, its, were, lets, wed, juts, whys, underate…), typos of two words (hwo: how or who,
// wheather: weather or whether, wanst: wants or wasn't), names (Sargent, Grammer), other languages' words (posible)
// and spellings people mean (thanx, pls, probly, reallly).
const LIST = new Map(Object.entries(CORRECTIONS));

// The fix for one word as typed, keeping how it was capitalized (Teh → The, TEHY → THEY), or null. Two or three
// capitals are taken as an abbreviation (IM, CNA) and left as they are.
export function correctionFor(word) {
  const w = String(word || '');
  const fix = LIST.get(w.toLowerCase());
  if (!fix || fix === w) return null;
  if (w.length <= 3 && w.length > 1 && w === w.toUpperCase()) return null;
  if (w.length > 1 && w === w.toUpperCase()) return fix.toUpperCase();
  if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) return fix[0].toUpperCase() + fix.slice(1);
  return fix;
}

// Whether correcting as people type is on when they haven't chosen: the list is English, so where the browser's
// language is (im, dont and i are words in German, French, Italian…).
export function englishHere() {
  try { return /^en\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || 'en'); } catch { return true; }
}

// What finishes a word: a space, a new line or punctuation. A full stop waits for what comes after it, so a file name
// or address (dont.js, im.example.org) and "i.e." stay as they are; "i" also waits for a space or , ! ?.
const ENDS = /[\s.,!?;:)\]"]/;
const WORD = /[A-Za-z']+$/;
export const finishes = (ch) => !!ch && ENDS.test(ch);
// Inside inline `code` or a ``` block, on the text up to a point.
function inCode(before) {
  if (((before.match(/```/g) || []).length) % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf('\n') + 1).replace(/```/g, '');
  return ((line.match(/`/g) || []).length) % 2 === 1;
}
// The word that ends right before `at` (the character typed after it), and whether it may be corrected. text: the
// box's text. Returns { start, end, word, fix } or null.
export function findCorrection(text, at, { kept = new Set() } = {}) {
  const sep = text[at - 1];
  if (!finishes(sep) || sep === '.') return null;
  let before = text.slice(0, at - 1);
  const dots = /\.+$/.exec(before); // "teh. ": the word before the full stop, now that it's clearly one
  if (dots) before = before.slice(0, dots.index);
  const m = WORD.exec(before);
  if (!m) return null;
  let word = m[0];
  let start = before.length - word.length;
  // Quotes around the word aren't part of it ('teh' → 'the').
  while (word.startsWith("'")) { word = word.slice(1); start++; }
  if (word.endsWith("'") && !/^i'/i.test(word)) word = word.slice(0, -1);
  if (!word) return null;
  // Part of something else (a @name, #channel, :emoji:, a path or link, a number, a-joined-word): only a word on its own.
  const prev = text[start - 1] || '';
  const opening = prev === "'" && /^\s?$/.test(text[start - 2] || ''); // a word in single quotes: 'teh'
  if (prev && !opening && !/[\s("[]/.test(prev)) return null;
  if (inCode(before)) return null;
  if (word.toLowerCase() === 'i' && (dots || !/[\s,!?]/.test(sep))) return null;
  // A capital in the middle of a sentence is a name (Jony Ive, Peter Noone) or a title: left as it is.
  const capital = word.length > 1 && word[0] !== word[0].toLowerCase() && word.slice(1) !== word.slice(1).toUpperCase();
  if (capital && !/(^|[.!?:\n])[\s("'[]*$/.test(text.slice(0, start))) return null;
  if (kept.has(word.toLowerCase())) return null;
  const fix = correctionFor(word);
  return fix ? { start, end: start + word.length, word, fix } : null;
}

// A message being sent: its last word, which nothing after it has finished, is corrected as the message goes (as
// phones do when Send is tapped). Returns the text, corrected or not.
export function correctEnd(text, { kept = keptWords() } = {}) {
  const t = String(text || '');
  const c = findCorrection(t + ' ', t.length + 1, { kept });
  return c ? t.slice(0, c.start) + c.fix + t.slice(c.end) : t;
}
// A bot's /command goes to the bot as typed.
export const isCommand = (text) => String(text || '').trimStart().startsWith('/');
const lastWord = (t) => (/([A-Za-z']+)[^A-Za-z']*$/.exec(t) || [])[1] || '';
// What a box sends: correctEnd, except for a /command and, when a message is edited (was: its text before), a last
// word that was already there (it was sent like that, or put back on another device).
export function correctSending(text, { was = null, kept } = {}) {
  const t = String(text || '');
  if (isCommand(t) || (was != null && lastWord(t) === lastWord(String(was)))) return t;
  return kept ? correctEnd(t, { kept }) : correctEnd(t);
}

// The words this person put back after a fix (Backspace or Ctrl+Z): never corrected again on this device.
const KEPT_KEY = 'hearth.spellKept';
let keptCache = null;
export function keptWords() {
  if (keptCache) return keptCache;
  try { keptCache = new Set(JSON.parse(localStorage.getItem(KEPT_KEY) || '[]')); } catch { return new Set(); }
  return keptCache;
}
function keep(word) {
  try {
    const s = new Set(keptWords());
    s.add(word.toLowerCase());
    const list = [...s].slice(-500);
    localStorage.setItem(KEPT_KEY, JSON.stringify(list));
    keptCache = new Set(list);
  } catch { /* not kept */ }
}
// (Another tab of the app may have kept one.)
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', (e) => { if (!e.key || e.key === KEPT_KEY) keptCache = null; });

// Replaces start..end with text the way typing would (so Ctrl+Z undoes it), or directly where the browser can't.
// Returns false, changing nothing, when the result wouldn't fit in the box (its maxlength).
const fits = (ta, out, add) => !(ta.maxLength > 0 && ta.value.length - out + add > ta.maxLength);
function replace(ta, start, end, text) {
  const was = ta.value.slice(start, end);
  const length = ta.value.length - was.length;
  if (!fits(ta, was.length, text.length)) return false;
  const caret = ta.selectionStart;
  ta.setSelectionRange(start, end);
  let done = false;
  try { done = document.execCommand && document.execCommand('insertText', false, text); } catch { done = false; }
  if (!done) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (ta.value.slice(start, start + text.length) !== text) {
    // Cut short after all: what was typed goes back.
    ta.setRangeText(was, start, start + (ta.value.length - length), 'end');
    ta.setSelectionRange(caret, caret);
    return false;
  }
  const at = caret + (text.length - (end - start));
  ta.setSelectionRange(at, at);
  return true;
}

// Corrects spelling as people type in a text box. on(): whether it's wanted right now (the setting, a computer).
// Returns a function that stops it.
export function autocorrect(ta, { on = () => true } = {}) {
  let last = null; // the latest fix: { start, word, fix, caret } until anything else happens
  let pasted = null; // where the latest paste or drop ended, until the next thing typed: { end }
  let pasting = null;
  let fixing = false;
  const fixed = new Set(); // the words fixed in this box, and what they became
  const onBeforeInput = (e) => {
    pasting = e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop'
      ? { start: Math.min(ta.selectionStart, ta.selectionEnd), length: ta.value.length - Math.abs(ta.selectionEnd - ta.selectionStart) }
      : null;
  };
  const onInput = (e) => {
    if (fixing) return;
    last = null;
    const paste = pasted;
    pasted = null;
    if (pasting) { pasted = { end: pasting.start + (ta.value.length - pasting.length) }; pasting = null; return; }
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      // Ctrl+Z later on brings a fix's word back selected: the next key would type over it. The caret goes back after
      // it and the space or punctuation that finished it.
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && fixed.has(sel)) {
        const at = ta.selectionEnd + (finishes(ta.value[ta.selectionEnd]) ? 1 : 0);
        ta.setSelectionRange(at, at);
        if (e.inputType === 'historyUndo' && LIST.has(sel.toLowerCase())) keep(sel);
      }
      return;
    }
    if (e.isComposing || !(e.inputType === 'insertText' || e.inputType === 'insertLineBreak')) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const at = ta.selectionStart;
    if (!finishes(ta.value[at - 1]) || !on()) return;
    const c = findCorrection(ta.value, at, { kept: keptWords() });
    if (!c || (paste && c.end === paste.end)) return; // a word that was pasted, just finished
    fixing = true;
    let done = false;
    try { done = replace(ta, c.start, c.end, c.fix); } finally { fixing = false; }
    if (!done) return;
    fixed.add(c.word); fixed.add(c.fix);
    last = { start: c.start, word: c.word, fix: c.fix, caret: ta.selectionStart };
  };
  const onKey = (e) => {
    if (!last || ['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return; // (Ctrl on its own, before Ctrl+Z)
    const l = last;
    last = null;
    // Backspace (or Ctrl+Z) right after a fix: what was typed comes back (the space or punctuation after it stays),
    // for good.
    const undo = (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const back = e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!(undo || back) || ta.selectionStart !== l.caret || ta.selectionEnd !== l.caret) return;
    if (ta.value.slice(l.start, l.start + l.fix.length) !== l.fix || !fits(ta, l.fix.length, l.word.length)) return;
    e.preventDefault();
    fixing = true;
    let done = false;
    try { done = replace(ta, l.start, l.start + l.fix.length, l.word); } finally { fixing = false; }
    if (done) keep(l.word);
  };
  const forget = () => { last = null; pasted = null; };
  ta.addEventListener('beforeinput', onBeforeInput);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('pointerdown', forget);
  ta.addEventListener('blur', forget);
  return () => {
    ta.removeEventListener('beforeinput', onBeforeInput);
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('keydown', onKey);
    ta.removeEventListener('pointerdown', forget);
    ta.removeEventListener('blur', forget);
  };
}
