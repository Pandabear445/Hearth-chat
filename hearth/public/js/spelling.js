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
  let out = fix;
  if (w.length > 1 && w === w.toUpperCase()) out = fix.toUpperCase();
  else if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) out = fix[0].toUpperCase() + fix.slice(1);
  return out === w ? null : out; // (I'LL is I'll in capitals already)
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
// Whether a word at `start` begins a sentence (or a line): after ! ? or a full stop that isn't a title's (Mr. Noone,
// a.k.a. Noone) or an initial's (J. Noone, A.J. Noone; not the I of "so do I." nor U.S., P.S. and the like).
const TITLE = /^\W*(?:mr|mrs|ms|mx|dr|st|vs|prof|sr|jr|mt|a\.k\.a|e\.g|i\.e)\.$/i;
const INITIAL = /^\W*(?:[A-HJ-Z]|(?:[A-Z]\.)+[A-Z])\.$/;
const ENDS_SENTENCE = /^\W*(?:U\.S|U\.S\.A|U\.K|E\.U|U\.N|D\.C|L\.A|N\.Y|P\.S|O\.K|T\.V|A\.I|A\.M|P\.M|R\.S\.V\.P)\.$/;
function startsSentence(text, start) {
  const before = text.slice(0, start);
  const gap = /[\s("'“‘[]*$/.exec(before);
  const lead = before.slice(0, gap.index);
  if (!lead || gap[0].includes('\n')) return true;
  if (/[!?]$/.test(lead)) return true;
  if (!lead.endsWith('.')) return false;
  const last = (/\S+$/.exec(lead) || [''])[0];
  return !TITLE.test(last) && (!INITIAL.test(last) || ENDS_SENTENCE.test(last));
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
  // Quotes around the word aren't part of it ('teh' → 'the'); one only before it is a word cut short ('im: him).
  let quoted = false;
  while (word.startsWith("'")) { word = word.slice(1); start++; quoted = true; }
  let closed = false;
  if (word.endsWith("'") && !/^i'/i.test(word)) { word = word.slice(0, -1); closed = true; }
  if (!word || (quoted && !closed)) return null;
  // Part of something else (a @name, #channel, :emoji:, a path or link, a number, a-joined-word): only a word on its own.
  const prev = text[start - 1] || '';
  const opening = prev === "'" && /^\s?$/.test(text[start - 2] || ''); // a word in single quotes: 'teh'
  if (prev && !opening && !/[\s("“[]/.test(prev)) return null;
  if (inCode(before)) return null;
  if (word.toLowerCase() === 'i' && (dots || !/[\s,!?]/.test(sep))) return null;
  if (kept.has(word.toLowerCase())) return null;
  const fix = correctionFor(word);
  if (!fix) return null;
  // A capital in the middle of a sentence is a name (Jony Ive, Peter Noone) or a title: left as it is. (Not where the
  // word always has one: Wensday → Wednesday.)
  const capital = word.length > 1 && word[0] !== word[0].toLowerCase() && word.slice(1) !== word.slice(1).toUpperCase();
  if (capital && !/^[A-Z][a-z]/.test(LIST.get(word.toLowerCase())) && !startsSentence(text, start)) return null;
  return { start, end: start + word.length, word, fix };
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
// What a box sends: correctEnd, except for a /command. was: when a message is edited, its text before. Its last word
// is corrected only if it's new: not one that was already there (sent like that, from another device, or the words
// after it deleted), nor the word a fix made on sending put back by hand (left as typed from then on, as Backspace
// does).
export function correctSending(text, { was = null, kept = keptWords() } = {}) {
  const t = String(text || '');
  if (isCommand(t)) return t;
  const c = findCorrection(t + ' ', t.length + 1, { kept });
  if (!c) return t;
  if (was != null) {
    const w = String(was);
    if (lastWord(t) === lastWord(w) || (w.slice(0, c.end) === t.slice(0, c.end) && !/[A-Za-z']/.test(w[c.end] || ''))) return t;
    // (The fix was the message's last word, after the same text: only the word is different.)
    const wt = w.replace(/[^A-Za-z]+$/, '');
    const k = wt.length - c.fix.length;
    if (k >= 0 && wt.endsWith(c.fix) && !/[A-Za-z]/.test(wt[k - 1] || '') && w.slice(0, k) === t.slice(0, c.start)) { keep(c.word); return t; }
  }
  return t.slice(0, c.start) + c.fix + t.slice(c.end);
}

// The words this person put back after a fix (Backspace or Ctrl+Z): never corrected again on this device.
const KEPT_KEY = 'hearth.spellKept';
let keptCache = null;
export function keptWords() {
  if (keptCache) return keptCache;
  try { keptCache = new Set(JSON.parse(localStorage.getItem(KEPT_KEY) || '[]')); } catch { return new Set(); }
  return keptCache;
}
function keep(word, on = true) {
  try {
    const s = new Set(keptWords());
    const w = word.toLowerCase();
    if (s.has(w) === on) return;
    if (on) s.add(w); else s.delete(w);
    const list = [...s].slice(-500);
    localStorage.setItem(KEPT_KEY, JSON.stringify(list));
    keptCache = new Set(list);
  } catch { /* not kept */ }
}
// (Another tab of the app may have kept one.)
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', (e) => { if (!e.key || e.key === KEPT_KEY) keptCache = null; });

// Replaces start..end with text the way typing would (so Ctrl+Z undoes it: 'native'), or directly where the browser
// can't ('direct'). Returns false, changing nothing, when the result wouldn't fit in the box (its maxlength).
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
  return done ? 'native' : 'direct';
}

// What was pasted or dropped into a box lately, line by line (trimmed), the latest last: a word that still has what
// came before it on its pasted line, or what came after it, next to it is left as it came, wherever it has moved to,
// also when sent (lastWordPasted). Going by the text means that, at worst, a word typed exactly as something pasted
// (with the same words beside it) is left too. Kept for the conversation (the box can be made again for it); a line
// is forgotten once none of its words are there when something is typed, and all of them when the box is emptied
// (not lost to a Backspace that's undone, nor kept after the message is sent).
const PASTES = new Map(); // key → [line…]
const KEYS = new WeakMap(); // box → () => its key
const MAX_CHARS = 20000; // lines kept for a key, beyond the ones still in the box
const keyOf = (ta) => { const k = KEYS.get(ta); return k ? k() : ta; };
const pastesOf = (ta) => PASTES.get(keyOf(ta)) || [];
const wordsOf = (line) => line.split(/[^A-Za-z']+/).filter(Boolean);
// Whether a character joins the word beside it: a letter, or an apostrophe with a letter on its far side (teh's, but
// not 'teh' in quotes).
const joins = (ch, far) => /[A-Za-z]/.test(ch || '') || (ch === "'" && /[A-Za-z]/.test(far || ''));
// Whether a word is in the text as a word of its own.
function hasWord(v, w) {
  for (let i = v.indexOf(w); i >= 0; i = v.indexOf(w, i + 1)) {
    if (!joins(v[i - 1], v[i - 2]) && !joins(v[i + w.length], v[i + w.length + 1])) return true;
  }
  return false;
}
const size = (list) => list.reduce((n, l) => n + l.length, 0);
function setPastes(ta, list) {
  const k = keyOf(ta);
  PASTES.delete(k);
  let keep = list;
  // Over the bound, the oldest go, those with none of their words in the box first.
  while (size(keep) > MAX_CHARS) {
    const i = keep.findIndex((l) => !wordsOf(l).some((w) => hasWord(ta.value, w)));
    keep = keep.filter((_, j) => j !== (i >= 0 ? i : 0));
  }
  if (keep.length) PASTES.set(k, keep);
  while (PASTES.size > 50) PASTES.delete(PASTES.keys().next().value);
}
// Whether the word at start..end came in with something pasted there.
function pasted(ta, start, end) {
  const v = ta.value;
  const word = v.slice(start, end);
  if (!word) return false;
  for (const line of pastesOf(ta)) {
    for (let o = line.indexOf(word); o >= 0; o = line.indexOf(word, o + 1)) {
      const e = o + word.length;
      if (joins(line[o - 1], line[o - 2]) || joins(line[e], line[e + 1])) continue; // (part of a longer word there)
      // With what came before it on the line, or after it, beside it in the box as whole words (a side with nothing
      // there doesn't count, unless the line is the word).
      // (A line that starts or ends with a word can't be the end of a longer one in the box: "he said" in "she said".)
      const b = start - o;
      const a = start + line.length - o;
      const cutBefore = joins(line[0], line[1]) && joins(v[b - 1], v[b - 2]);
      const cutAfter = joins(line[line.length - 1], line[line.length - 2]) && joins(v[a], v[a + 1]);
      if ((o > 0 || e === line.length) && b >= 0 && v.slice(b, end) === line.slice(0, e) && !cutBefore) return true;
      if (e < line.length && v.slice(start, a) === line.slice(o) && !cutAfter) return true;
    }
  }
  return false;
}
// Whether the last word in a box (the one sending would correct) came in with something pasted there.
export function lastWordPasted(ta) {
  const t = ta.value;
  const c = findCorrection(t + ' ', t.length + 1, { kept: new Set() });
  return !!c && pasted(ta, c.start, c.end);
}

// Corrects spelling as people type in a text box. on(): whether it's wanted right now (the setting, a computer).
// Returns a function that stops it.
// pasteKey(): what pastes are remembered for (the conversation), when the box can be made again for it.
export function autocorrect(ta, { on = () => true, pasteKey = null } = {}) {
  if (pasteKey) KEYS.set(ta, pasteKey);
  // last: the latest fix ({ start, word, fix, run (the punctuation and space that finished it), caret, native }) until
  // anything else happens; back: the latest Backspace that turned one down, likewise. undoing: Ctrl+Z was pressed
  // right after one of them ({ f, put: what the undo brings back }), for the input that follows.
  let last = null;
  let back = null;
  let undoing = null;
  let turnedDown = null; // a word Ctrl+Z put back: kept once typing goes on (not if undo or redo goes on instead)
  let fixing = false;
  // A paste or drop is remembered once it's in the box (not one the app took as files instead), as far as it went in
  // (the box's maxlength can cut it short).
  let coming = null;
  const remember = (text) => {
    const lines = String(text || '').split(/\r\n?|\n/).map((l) => l.replace(/[\s.,!?;:]+$/, '').trim()).filter((l) => /[A-Za-z]/.test(l));
    if (lines.length) setPastes(ta, [...pastesOf(ta).filter((x) => !lines.includes(x)), ...lines]);
  };
  const onPaste = () => { coming = { at: Math.min(ta.selectionStart, ta.selectionEnd) }; };
  const onDrop = () => { coming = { at: -1 }; };
  // Something going into an empty box starts afresh: what was pasted before is gone (the app empties the box when a
  // message is sent, without telling).
  const onBeforeInput = (e) => {
    if (!ta.value && e.inputType !== 'historyUndo' && e.inputType !== 'historyRedo') setPastes(ta, []);
  };
  const onInput = (e) => {
    const history = e.inputType === 'historyUndo' || e.inputType === 'historyRedo';
    if (coming && (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop')) {
      // A paste goes in at the caret, a drop is left selected (the browser does that); nothing in, nothing kept.
      if (coming.at >= 0) remember(ta.value.slice(coming.at, Math.max(coming.at, ta.selectionEnd)));
      else remember(ta.value.slice(ta.selectionStart, ta.selectionEnd));
    } else if (!history && (!ta.value || /^insert/.test(e.inputType || ''))) {
      // (Still there even glued to what's being typed beside it: "adont" while "and " goes in before a pasted "dont".)
      setPastes(ta, ta.value ? pastesOf(ta).filter((l) => wordsOf(l).some((w) => ta.value.includes(w))) : []);
    }
    coming = null;
    if (fixing) return;
    const u = undoing;
    last = null;
    back = null;
    undoing = null;
    if (turnedDown && !history) keep(turnedDown);
    turnedDown = null;
    if (history) {
      // Ctrl+Z right after a fix brings the typed word back selected, and right after a Backspace the fix (the next
      // key would type over it): the caret goes after it and what finished it. The first is turning the fix down, as
      // Backspace is; the second is taking it after all. Any other undo or redo is the browser's own.
      if (!u || e.inputType !== 'historyUndo') return;
      const end = u.f.start + u.put.length;
      if (ta.selectionStart !== u.f.start || ta.selectionEnd !== end || ta.value.slice(u.f.start, end) !== u.put) return;
      const at = ta.value.startsWith(u.f.run, end) ? end + u.f.run.length : end;
      ta.setSelectionRange(at, at);
      if (u.put === u.f.word) turnedDown = u.f.word; else keep(u.f.word, false);
      return;
    }
    if (e.isComposing || !(e.inputType === 'insertText' || e.inputType === 'insertLineBreak')) return;
    if (ta.selectionStart !== ta.selectionEnd) return;
    const at = ta.selectionStart;
    if (!finishes(ta.value[at - 1]) || !on()) return;
    const c = findCorrection(ta.value, at, { kept: keptWords() });
    if (!c || pasted(ta, c.start, c.end)) return;
    fixing = true;
    let done = false;
    try { done = replace(ta, c.start, c.end, c.fix); } finally { fixing = false; }
    if (!done) return;
    last = { start: c.start, word: c.word, fix: c.fix, run: ta.value.slice(c.start + c.fix.length, ta.selectionStart), caret: ta.selectionStart, native: done === 'native' };
  };
  const onKey = (e) => {
    if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return; // (Ctrl on its own, before Ctrl+Z)
    const l = last;
    const b = back;
    last = null;
    back = null;
    undoing = null;
    const f = l || b;
    if (!f) return;
    // (By the key's code too, as the browser does: Ctrl+Z on a Cyrillic or Greek keyboard is "я" or "ζ".)
    const undo = (e.key === 'z' || e.key === 'Z' || e.keyCode === 90) && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const del = e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (ta.selectionStart !== f.caret || ta.selectionEnd !== f.caret) return;
    const now = l ? l.fix : b.word; // what's in the box there
    if (ta.value.slice(f.start, f.start + now.length) !== now) return;
    // Ctrl+Z: the browser undoes the fix (or the Backspace), an edit of its own; onInput above follows it up.
    if (undo && f.native) { undoing = { f, put: l ? l.word : b.fix }; return; }
    // Backspace right after a fix (or Ctrl+Z where it isn't in the browser's undo): what was typed comes back (the
    // space or punctuation after it stays), for good.
    if (!l || !(del || undo) || !fits(ta, l.fix.length, l.word.length)) return;
    e.preventDefault();
    fixing = true;
    let done = false;
    try { done = replace(ta, l.start, l.start + l.fix.length, l.word); } finally { fixing = false; }
    if (!done) return;
    keep(l.word);
    back = { ...l, caret: ta.selectionStart, native: done === 'native' };
  };
  const forget = () => { last = null; back = null; undoing = null; };
  // (turnedDown stays: clicking somewhere else to go on typing is going on.)
  ta.addEventListener('paste', onPaste);
  ta.addEventListener('drop', onDrop);
  ta.addEventListener('beforeinput', onBeforeInput);
  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKey);
  ta.addEventListener('pointerdown', forget);
  ta.addEventListener('blur', forget);
  return () => {
    ta.removeEventListener('paste', onPaste);
    ta.removeEventListener('drop', onDrop);
    ta.removeEventListener('beforeinput', onBeforeInput);
    ta.removeEventListener('input', onInput);
    ta.removeEventListener('keydown', onKey);
    ta.removeEventListener('pointerdown', forget);
    ta.removeEventListener('blur', forget);
  };
}
