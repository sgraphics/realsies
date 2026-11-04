// Pools for the demo persona generator (src/persona/generate.ts) and the style rules (src/persona/model.ts).
// Plain data: places with their time zones, cultures (first language, laughter, slang, natural English
// slips, names, food), jobs by age, scenes by time of day, hobbies mapped onto the steering topics.
import type { Topic } from '../bot/api.js';
import type { JobCat, Slot } from './model.js';

export interface Culture {
  /** first language ("English" for native speakers) */
  language: string;
  /** English is the first language */
  native: boolean;
  /** non-native: weights of fluent, good, basic */
  level?: [number, number, number];
  /** how English slips for this first language (second person, no trailing period) */
  slips?: string;
  laughYoung: string[];
  laughOld: string[];
  slang?: string[];
  slangYoung?: string[];
  emoticons?: string[];
  names: { w: string[]; m: string[]; wOld?: string[]; mOld?: string[] };
  food?: { breakfast?: string[]; lunch?: string[]; dinner?: string[] };
  teams?: string[];
}

const SLIP_ARTICLES = "you skip 'a' and 'the' now and then and keep sentences plain";
const SLIP_ASIAN = "you keep sentences short and simple and sometimes drop 'a', 'the' and the plural s";
const SLIP_SPANISH = "small slips like 'i have 30 years', 'is very nice' with no subject, and 'no?' at the end of a sentence";

export const CULTURES: Record<string, Culture> = {
  us: {
    language: 'English', native: true,
    laughYoung: ['lol', 'lmao', 'lmaooo', 'LMAO'], laughOld: ['haha', 'lol', 'LOL', 'ha'],
    slangYoung: ['fr', 'lowkey', 'bet', 'no cap'],
    names: {
      w: ['Madison', 'Kayla', 'Brianna', 'Jasmine', 'Megan', 'Taylor', 'Hannah', 'Destiny', 'Alyssa', 'Morgan', 'Kaitlyn', 'Danielle'],
      wOld: ['Linda', 'Patricia', 'Debbie', 'Karen', 'Barbara', 'Cheryl', 'Brenda', 'Donna'],
      m: ['Tyler', 'Brandon', 'Jake', 'Austin', 'Marcus', 'Kevin', 'Josh', 'Dylan', 'Cody', 'Trevor', 'Jalen', 'Devin'],
      mOld: ['Gary', 'Dennis', 'Ron', 'Rick', 'Steve', 'Bill', 'Larry', 'Doug'],
    },
    food: {
      breakfast: ['a bagel', 'a bowl of cereal', 'a breakfast burrito', 'a granola bar and coffee'],
      lunch: ['a turkey sandwich', 'leftover pizza', 'a burrito bowl', 'a burger'],
      dinner: ['tacos', 'mac and cheese', 'chicken and rice', 'a frozen pizza'],
    },
  },
  uk: {
    language: 'English', native: true,
    laughYoung: ['lol', 'haha', 'lmao', 'hahaha'], laughOld: ['haha', 'ha', 'lol'],
    slang: ['mate', 'cheers', 'proper', 'knackered', 'quid', 'reckon'], slangYoung: ['peak', 'bare'],
    names: {
      w: ['Chloe', 'Amy', 'Jess', 'Ellie', 'Holly', 'Lauren', 'Abbie', 'Georgia', 'Becky', 'Freya'],
      wOld: ['Susan', 'Jean', 'Pauline', 'Carol', 'Janet', 'Linda'],
      m: ['Callum', 'Jack', 'Liam', 'Ryan', 'Tom', 'Kieran', 'Connor', 'Jamie', 'Lewis', 'Ollie'],
      mOld: ['Keith', 'Graham', 'Colin', 'Trevor', 'Derek', 'Nigel'],
    },
    food: {
      breakfast: ['toast and a cup of tea', 'a bacon sandwich', 'porridge', 'a sausage roll from Greggs'],
      lunch: ['a meal deal', 'a jacket potato', 'beans on toast', 'a sausage roll'],
      dinner: ['a curry', 'fish and chips', 'a pasta bake', 'shepherd’s pie'],
    },
  },
  ie: {
    language: 'English', native: true,
    laughYoung: ['haha', 'lol', 'hahaha'], laughOld: ['haha', 'ha'],
    slang: ['grand', 'deadly', 'craic', 'eejit', 'sound'],
    names: {
      w: ['Aoife', 'Niamh', 'Ciara', 'Orla', 'Roisin', 'Saoirse', 'Sinead'], wOld: ['Mary', 'Bernadette', 'Breda', 'Maureen'],
      m: ['Cian', 'Oisin', 'Darragh', 'Sean', 'Conor', 'Eoin', 'Cillian'], mOld: ['Paddy', 'Declan', 'Gerry', 'Martin'],
    },
    food: { breakfast: ['a fry', 'toast and tea', 'porridge'], lunch: ['a chicken fillet roll', 'soup and brown bread'], dinner: ['a spice bag', 'shepherd’s pie', 'pasta'] },
  },
  au: {
    language: 'English', native: true,
    laughYoung: ['haha', 'lol', 'hahaha'], laughOld: ['haha', 'ha'],
    slang: ['heaps', 'arvo', 'reckon', 'keen', 'no worries', 'servo'],
    names: {
      w: ['Chloe', 'Brooke', 'Tayla', 'Jess', 'Kirra', 'Mel', 'Jacinta', 'Shannon'], wOld: ['Sharon', 'Debbie', 'Kerry', 'Leanne'],
      m: ['Jayden', 'Lachlan', 'Brodie', 'Mitch', 'Riley', 'Jarrah', 'Kane'], mOld: ['Darren', 'Wayne', 'Bruce', 'Craig'],
    },
    food: { breakfast: ['Vegemite toast', 'smashed avo on toast', 'Weet-Bix'], lunch: ['a sausage roll', 'a meat pie from the servo', 'sushi rolls'], dinner: ['a barbie', 'spag bol', 'Thai takeaway'] },
  },
  nz: {
    language: 'English', native: true,
    laughYoung: ['haha', 'lol', 'hahaha'], laughOld: ['haha'],
    slang: ['sweet as', 'chur', 'heaps', 'keen', 'yeah nah'],
    names: { w: ['Aroha', 'Ruby', 'Kaia', 'Sophie', 'Mia'], m: ['Nikau', 'Tama', 'Hamish', 'Liam', 'Riley'] },
    food: { breakfast: ['Marmite toast'], lunch: ['a mince and cheese pie'], dinner: ['fish and chips', 'a roast'] },
  },
  ca: {
    language: 'English', native: true,
    laughYoung: ['lol', 'haha', 'lmao'], laughOld: ['haha', 'lol'],
    slang: ['eh'],
    names: { w: ['Madison', 'Brittany', 'Kaitlyn', 'Emilie', 'Avery', 'Chloe'], m: ['Tyler', 'Logan', 'Mathieu', 'Kyle', 'Owen', 'Liam'] },
    food: { breakfast: ['a breakfast sandwich from Tim Hortons'], lunch: ['poutine', 'a wrap'], dinner: ['butter chicken', 'pasta'] },
  },
  za: {
    language: 'English', native: true,
    laughYoung: ['haha', 'lol'], laughOld: ['haha'],
    slang: ['lekker', 'howzit', 'now now', 'eish', 'shame'],
    names: { w: ['Thandi', 'Lerato', 'Chantelle', 'Michelle', 'Naledi', 'Ayesha'], m: ['Sipho', 'Thabo', 'Ruan', 'Pieter', 'Jaco', 'Lwazi'] },
    food: { breakfast: ['rusks and coffee'], lunch: ['a gatsby', 'bunny chow'], dinner: ['a braai', 'pap and wors'] },
  },
  ng: {
    language: 'English', native: true,
    laughYoung: ['lol', 'lmao', 'lmaooo'], laughOld: ['lol', 'haha'],
    slang: ['abeg', 'omo', 'wahala', 'sha'],
    names: { w: ['Chioma', 'Funke', 'Ngozi', 'Adaeze', 'Bisi', 'Temi', 'Zainab'], m: ['Emeka', 'Segun', 'Chidi', 'Femi', 'Kunle', 'Ibrahim', 'Tobi'] },
    food: { breakfast: ['bread and akara', 'tea and bread'], lunch: ['jollof rice', 'suya'], dinner: ['eba and egusi soup', 'fried plantain and stew'] },
    teams: ['Arsenal', 'Chelsea', 'Man United'],
  },
  sg: {
    language: 'English', native: true,
    laughYoung: ['haha', 'lol', 'hahaha'], laughOld: ['haha'],
    slang: ['lah', 'leh', 'can', 'shiok', 'alamak'],
    names: { w: ['Hui Min', 'Jia Yi', 'Shu Ting', 'Nur Aisyah'], m: ['Wei Jie', 'Jun Hao', 'Hafiz', 'Marcus'] },
    food: { breakfast: ['kaya toast and kopi'], lunch: ['chicken rice', 'laksa'], dinner: ['char kway teow', 'nasi lemak'] },
  },
  ke: {
    language: 'Swahili', native: false, level: [0.7, 0.3, 0],
    slips: "Kenyan English, with Swahili words like sasa and poa slipping in, and 'I'm coming' when you mean you'll be right back",
    laughYoung: ['lol', 'hahaha'], laughOld: ['haha'],
    names: { w: ['Wanjiru', 'Akinyi', 'Njeri', 'Atieno', 'Faith'], m: ['Kamau', 'Otieno', 'Mwangi', 'Brian', 'Kevin'] },
    food: { breakfast: ['chai and mandazi'], lunch: ['ugali and sukuma wiki', 'chapati and beans'], dinner: ['nyama choma', 'pilau'] },
    teams: ['Arsenal', 'Gor Mahia'],
  },
  in: {
    language: 'Hindi', native: false, level: [0.6, 0.4, 0],
    slips: "Indian English, like 'do one thing', 'itself' and 'only' for emphasis, and 'na' at the end of a sentence",
    laughYoung: ['lol', 'haha', 'hahaha'], laughOld: ['haha'],
    slang: ['yaar', 'arre'],
    names: {
      w: ['Ananya', 'Sneha', 'Pooja', 'Kavya', 'Neha', 'Ishita', 'Divya'], wOld: ['Sunita', 'Lakshmi', 'Meena'],
      m: ['Rohan', 'Arjun', 'Vikram', 'Aditya', 'Rahul', 'Karthik', 'Siddharth'], mOld: ['Rajesh', 'Suresh', 'Anil'],
    },
    food: { breakfast: ['poha and chai', 'idli and chutney'], lunch: ['dal and roti from home', 'vada pav'], dinner: ['biryani', 'paneer butter masala'] },
  },
  ph: {
    language: 'Tagalog', native: false, level: [0.6, 0.4, 0],
    slips: "Taglish, with Tagalog words like grabe and sana slipping in",
    laughYoung: ['hahaha', 'HAHAHA', 'lol'], laughOld: ['hahaha', 'hehe'],
    names: { w: ['Joy', 'Kristine', 'Angel', 'Mae', 'Bea', 'Camille'], m: ['Mark', 'Carlo', 'Miguel', 'Jericho', 'Paolo', 'Jomar'] },
    food: { breakfast: ['pandesal and coffee', 'tapsilog'], lunch: ['adobo and rice', 'pancit'], dinner: ['sinigang', 'Jollibee chicken'] },
  },
  my: {
    language: 'Malay', native: false, level: [0.55, 0.45, 0],
    slips: 'Manglish, ending sentences with lah and mixing in Malay words',
    laughYoung: ['hahaha', 'kahkah'], laughOld: ['haha'],
    names: { w: ['Siti', 'Nur Aisyah', 'Mei Ling'], m: ['Hafiz', 'Amir', 'Wei Liang'] },
    food: { breakfast: ['roti canai and teh tarik'], lunch: ['nasi lemak'], dinner: ['mee goreng'] },
  },
  br: {
    language: 'Portuguese', native: false, level: [0.25, 0.5, 0.25],
    slips: "small grammar slips like 'i have 31 years', 'is very hot here' with no subject, and mixing up in, on and at",
    laughYoung: ['kkkk', 'kkkkkk'], laughOld: ['rsrs', 'kkk'],
    names: {
      w: ['Ana', 'Juliana', 'Camila', 'Larissa', 'Bruna', 'Fernanda', 'Beatriz', 'Leticia'], wOld: ['Maria', 'Sonia', 'Rosangela', 'Cida'],
      m: ['Lucas', 'Gabriel', 'Thiago', 'Mateus', 'Felipe', 'Gustavo', 'Vinicius'], mOld: ['Jose', 'Antonio', 'Carlos', 'Paulo'],
    },
    food: { breakfast: ['pão de queijo and coffee', 'bread with butter and a coffee'], lunch: ['rice, beans and chicken', 'a coxinha'], dinner: ['leftover feijoada', 'pizza'] },
    teams: ['Corinthians', 'Palmeiras', 'Flamengo', 'São Paulo'],
  },
  pt: {
    language: 'Portuguese', native: false, level: [0.45, 0.45, 0.1],
    slips: "small slips like 'i am here since monday' and the odd Portuguese word",
    laughYoung: ['ahah', 'ahahah', 'lol'], laughOld: ['ahah'],
    names: { w: ['Inês', 'Beatriz', 'Joana', 'Mariana', 'Rita'], m: ['João', 'Tiago', 'Diogo', 'Rui', 'Miguel'] },
    food: { breakfast: ['a pastel de nata and a coffee'], lunch: ['a bifana', 'bacalhau'], dinner: ['grilled sardines', 'a francesinha'] },
    teams: ['Benfica', 'Porto', 'Sporting'],
  },
  es: {
    language: 'Spanish', native: false, level: [0.3, 0.5, 0.2], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jaja', 'jajajaj'], laughOld: ['jaja', 'jajaja'],
    names: { w: ['Lucia', 'Paula', 'Marta', 'Laura', 'Alba', 'Carmen'], m: ['Pablo', 'Javier', 'Sergio', 'Alvaro', 'Dani', 'Iker'] },
    food: { breakfast: ['toast with tomato and olive oil'], lunch: ['a bocadillo', 'tortilla de patatas'], dinner: ['paella', 'croquetas'] },
    teams: ['Real Madrid', 'Barça', 'Valencia', 'Betis'],
  },
  mx: {
    language: 'Spanish', native: false, level: [0.3, 0.5, 0.2], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jaja', 'jsjsjs'], laughOld: ['jaja', 'jajaja'],
    slangYoung: ['wey'],
    names: { w: ['Valeria', 'Ximena', 'Fernanda', 'Daniela', 'Guadalupe', 'Andrea'], m: ['Luis', 'Jorge', 'Alejandro', 'Emiliano', 'Ivan', 'Rodrigo'] },
    food: { breakfast: ['chilaquiles', 'pan dulce and coffee'], lunch: ['tacos al pastor', 'a torta'], dinner: ['enchiladas', 'pozole'] },
    teams: ['Chivas', 'América', 'Tigres'],
  },
  ar: {
    language: 'Spanish', native: false, level: [0.3, 0.5, 0.2], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jsjs', 'jaja'], laughOld: ['jaja'],
    slangYoung: ['che'],
    names: { w: ['Sofia', 'Martina', 'Florencia', 'Camila', 'Agustina'], m: ['Matias', 'Facundo', 'Nicolas', 'Tomas', 'Joaquin'] },
    food: { breakfast: ['medialunas and mate'], lunch: ['empanadas', 'a milanesa sandwich'], dinner: ['asado', 'pizza'] },
    teams: ['Boca', 'River', 'Racing'],
  },
  co: {
    language: 'Spanish', native: false, level: [0.25, 0.5, 0.25], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jaja'], laughOld: ['jaja'], slangYoung: ['parce', 'bacano'],
    names: { w: ['Valentina', 'Daniela', 'Laura', 'Mariana'], m: ['Santiago', 'Andres', 'Camilo', 'Julian'] },
    food: { breakfast: ['an arepa with eggs'], lunch: ['bandeja paisa'], dinner: ['ajiaco'] },
  },
  cl: {
    language: 'Spanish', native: false, level: [0.25, 0.5, 0.25], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jsjs'], laughOld: ['jaja'], slangYoung: ['po', 'cachai'],
    names: { w: ['Catalina', 'Javiera', 'Constanza'], m: ['Benjamin', 'Vicente', 'Cristobal'] },
    food: { breakfast: ['marraqueta with avocado'], lunch: ['an empanada de pino'], dinner: ['pastel de choclo'] },
  },
  pe: {
    language: 'Spanish', native: false, level: [0.25, 0.5, 0.25], slips: SLIP_SPANISH,
    laughYoung: ['jajaja', 'jaja'], laughOld: ['jaja'],
    names: { w: ['Lucia', 'Milagros', 'Ximena'], m: ['Renzo', 'Diego', 'Bruno'] },
    food: { breakfast: ['pan con chicharrón'], lunch: ['ceviche', 'lomo saltado'], dinner: ['ají de gallina'] },
  },
  de: {
    language: 'German', native: false, level: [0.5, 0.45, 0.05],
    slips: "direct, slightly formal English with slips like 'since two years', 'I am here since ten' and 'make a photo'",
    laughYoung: ['haha', 'hahaha'], laughOld: ['haha'],
    names: {
      w: ['Anna', 'Sophie', 'Laura', 'Katharina', 'Julia', 'Marie', 'Lea'], wOld: ['Monika', 'Sabine', 'Ursula', 'Petra'],
      m: ['Jonas', 'Lukas', 'Felix', 'Max', 'Tobias', 'Jan', 'Niklas'], mOld: ['Klaus', 'Jürgen', 'Uwe', 'Wolfgang'],
    },
    food: { breakfast: ['a bread roll with cheese'], lunch: ['a döner', 'currywurst'], dinner: ['schnitzel', 'pasta'] },
    teams: ['Bayern', 'Dortmund', 'St. Pauli', 'Union Berlin'],
  },
  nl: {
    language: 'Dutch', native: false, level: [0.75, 0.25, 0],
    slips: "Dunglish now and then, like 'make a photo', 'I can not' and 'how do you call it'",
    laughYoung: ['haha', 'hahah'], laughOld: ['haha'],
    names: { w: ['Sanne', 'Lotte', 'Fleur', 'Eva', 'Anouk'], m: ['Daan', 'Bram', 'Thijs', 'Joost', 'Ruben'] },
    food: { breakfast: ['bread with hagelslag'], lunch: ['a cheese sandwich', 'a kroket'], dinner: ['stamppot', 'pasta'] },
    teams: ['Ajax', 'Feyenoord', 'PSV'],
  },
  nordic: {
    language: 'Swedish', native: false, level: [0.85, 0.15, 0],
    slips: 'near-native English with the odd literal translation',
    laughYoung: ['haha', 'hehe'], laughOld: ['haha'],
    names: { w: ['Ebba', 'Maja', 'Linnea', 'Elin', 'Freja', 'Ingrid'], m: ['Oscar', 'Erik', 'Viktor', 'Axel', 'Mads', 'Henrik'] },
    food: { breakfast: ['crispbread with cheese'], lunch: ['meatballs and potatoes', 'an open sandwich'], dinner: ['tacos', 'salmon and potatoes'] },
  },
  fi: {
    language: 'Finnish', native: false, level: [0.6, 0.4, 0],
    slips: "you are economical with words and skip 'a' and 'the' now and then",
    laughYoung: ['haha', 'hah'], laughOld: ['haha'],
    names: { w: ['Aino', 'Emmi', 'Venla'], m: ['Mikko', 'Juho', 'Ville'] },
    food: { breakfast: ['rye bread and coffee'], lunch: ['salmon soup'], dinner: ['karelian pies'] },
  },
  ee: {
    language: 'Estonian', native: false, level: [0.35, 0.5, 0.15], slips: SLIP_ARTICLES,
    laughYoung: ['haha', 'ha'], laughOld: ['ha', 'haha'],
    names: { w: ['Kadri', 'Liis', 'Triin', 'Kertu'], m: ['Rasmus', 'Kristjan', 'Siim', 'Tanel'] },
    food: { breakfast: ['rye bread and coffee'], lunch: ['soup and rye bread'], dinner: ['pork and sauerkraut'] },
  },
  pl: {
    language: 'Polish', native: false, level: [0.3, 0.5, 0.2],
    slips: "you skip 'a' and 'the' now and then and mix up tenses a little",
    laughYoung: ['xD', 'hahah'], laughOld: ['haha'],
    names: { w: ['Zuzanna', 'Kasia', 'Ola', 'Magda', 'Natalia'], m: ['Kuba', 'Piotr', 'Michal', 'Bartek', 'Kamil'] },
    food: { breakfast: ['a ham sandwich'], lunch: ['pierogi', 'żurek'], dinner: ['schabowy and potatoes'] },
  },
  cz: {
    language: 'Czech', native: false, level: [0.3, 0.5, 0.2],
    slips: "you skip 'a' and 'the' now and then and mix up tenses a little",
    laughYoung: ['xD', 'haha'], laughOld: ['haha'],
    names: { w: ['Tereza', 'Klara', 'Eliska'], m: ['Jakub', 'Ondrej', 'Tomas'] },
    food: { breakfast: ['a rohlík with butter'], lunch: ['svíčková'], dinner: ['fried cheese'] },
  },
  fr: {
    language: 'French', native: false, level: [0.25, 0.5, 0.25],
    slips: "slips like 'I am agree', 'since 2 years', and 'actually' when you mean 'right now'",
    laughYoung: ['mdr', 'ptdr', 'haha'], laughOld: ['haha'],
    names: {
      w: ['Camille', 'Léa', 'Chloé', 'Manon', 'Inès'], wOld: ['Brigitte', 'Sylvie', 'Martine'],
      m: ['Hugo', 'Théo', 'Maxime', 'Julien', 'Antoine'], mOld: ['Jean-Pierre', 'Gérard', 'Alain'],
    },
    food: { breakfast: ['a croissant and coffee'], lunch: ['a jambon-beurre'], dinner: ['raclette', 'a quiche'] },
    teams: ['OM', 'PSG', 'OL'],
  },
  it: {
    language: 'Italian', native: false, level: [0.2, 0.5, 0.3],
    slips: "slips like 'I have 28 years', 'no?' at the end of a sentence, and mixed-up prepositions",
    laughYoung: ['ahah', 'ahahah', 'ahahaha'], laughOld: ['ahah'],
    names: {
      w: ['Giulia', 'Chiara', 'Francesca', 'Martina', 'Sara'], wOld: ['Rosa', 'Giovanna', 'Anna'],
      m: ['Luca', 'Marco', 'Matteo', 'Alessandro', 'Davide'], mOld: ['Giuseppe', 'Franco', 'Mario'],
    },
    food: { breakfast: ['a cornetto and an espresso'], lunch: ['a panino', 'pizza al taglio'], dinner: ['pasta al ragù', 'risotto'] },
    teams: ['Juve', 'Napoli', 'Inter', 'Bologna'],
  },
  gr: {
    language: 'Greek', native: false, level: [0.3, 0.5, 0.2], slips: 'slips with tenses and prepositions',
    laughYoung: ['xaxa', 'haha'], laughOld: ['xaxa'],
    names: { w: ['Eleni', 'Katerina', 'Maria'], m: ['Giorgos', 'Nikos', 'Dimitris'] },
    food: { breakfast: ['a koulouri'], lunch: ['souvlaki'], dinner: ['moussaka'] },
  },
  tr: {
    language: 'Turkish', native: false, level: [0.25, 0.5, 0.25], slips: "you drop 'a' and 'the' now and then and sometimes mix up he and she",
    laughYoung: ['ahahah', 'haha'], laughOld: ['haha'],
    names: { w: ['Elif', 'Zeynep', 'Ayse', 'Merve'], m: ['Emre', 'Burak', 'Mehmet', 'Can'] },
    food: { breakfast: ['simit and tea'], lunch: ['döner', 'lahmacun'], dinner: ['köfte'] },
  },
  kr: {
    language: 'Korean', native: false, level: [0.2, 0.5, 0.3], slips: SLIP_ASIAN,
    laughYoung: ['kkk', 'ㅋㅋ', 'haha'], laughOld: ['haha', 'kk'], emoticons: ['^^'],
    names: {
      w: ['Jiwoo', 'Minji', 'Seoyeon', 'Soojin', 'Yuna'], wOld: ['Mi-kyung', 'Young-hee'],
      m: ['Minjun', 'Jihoon', 'Hyunwoo', 'Seungho', 'Dohyun'], mOld: ['Sang-hoon', 'Jae-ho'],
    },
    food: { breakfast: ['toast and a coffee from the convenience store'], lunch: ['kimbap', 'tteokbokki'], dinner: ['kimchi jjigae', 'fried chicken'] },
  },
  jp: {
    language: 'Japanese', native: false, level: [0.15, 0.5, 0.35], slips: SLIP_ASIAN,
    laughYoung: ['www', 'w', 'lol'], laughOld: ['haha'], emoticons: ['^^', '(^_^)'],
    names: {
      w: ['Yui', 'Haruka', 'Aoi', 'Misaki', 'Rina'], wOld: ['Keiko', 'Yoko'],
      m: ['Haruto', 'Ren', 'Takumi', 'Daiki', 'Sota'], mOld: ['Hiroshi', 'Takeshi'],
    },
    food: { breakfast: ['an onigiri from the konbini'], lunch: ['ramen', 'a bento'], dinner: ['curry rice', 'okonomiyaki'] },
  },
  tw: {
    language: 'Mandarin', native: false, level: [0.2, 0.5, 0.3], slips: "you sometimes drop tense endings and plurals, like 'yesterday I go'",
    laughYoung: ['XDD', 'haha'], laughOld: ['haha'],
    names: { w: ['Yi-Ting', 'Hsin-Yi', 'Pei-Shan'], m: ['Chih-Wei', 'Yu-Cheng', 'Kuan-Ting'] },
    food: { breakfast: ['a dan bing and soy milk'], lunch: ['beef noodles', 'a bento'], dinner: ['night market food'] },
  },
  vn: {
    language: 'Vietnamese', native: false, level: [0.15, 0.5, 0.35], slips: "short sentences, and you sometimes skip 'is' and tense endings",
    laughYoung: ['=))', 'hihi', 'haha'], laughOld: ['haha', 'hihi'],
    names: { w: ['Linh', 'Trang', 'Huong', 'Mai'], m: ['Minh', 'Tuan', 'Duc', 'Quang'] },
    food: { breakfast: ['a bánh mì'], lunch: ['phở', 'cơm tấm'], dinner: ['bún chả'] },
  },
  th: {
    language: 'Thai', native: false, level: [0.15, 0.5, 0.35], slips: "short sentences, and you sometimes skip 'is' and tense endings",
    laughYoung: ['555', '55555'], laughOld: ['555'],
    names: { w: ['Ploy', 'Nok', 'Fon', 'Mint'], m: ['Bank', 'Nat', 'Tong', 'Beam'] },
    food: { breakfast: ['jok rice porridge'], lunch: ['pad kra pao', 'som tam'], dinner: ['khao soi'] },
  },
  id: {
    language: 'Indonesian', native: false, level: [0.2, 0.5, 0.3], slips: "short sentences, and you sometimes skip 'is' and tense endings",
    laughYoung: ['wkwk', 'wkwkwk'], laughOld: ['hehe', 'wkwk'],
    names: { w: ['Putri', 'Dewi', 'Ayu', 'Sari'], m: ['Budi', 'Rizky', 'Dimas', 'Fajar'] },
    food: { breakfast: ['nasi uduk'], lunch: ['nasi goreng', 'bakso'], dinner: ['mie ayam'] },
  },
  eg: {
    language: 'Arabic', native: false, level: [0.25, 0.5, 0.25], slips: "you sometimes mix up tenses and use 'the' a bit too much",
    laughYoung: ['hhhh', 'hhhhh', 'haha'], laughOld: ['haha'],
    names: { w: ['Nour', 'Salma', 'Yasmin', 'Mariam'], m: ['Omar', 'Youssef', 'Karim', 'Ahmed'] },
    food: { breakfast: ['ful and bread'], lunch: ['koshari'], dinner: ['molokhia'] },
  },
  ma: {
    language: 'Arabic', native: false, level: [0.25, 0.5, 0.25], slips: 'French creeps into your English now and then, and you mix up tenses',
    laughYoung: ['hhhh', 'mdr'], laughOld: ['haha'],
    names: { w: ['Salma', 'Imane', 'Khadija'], m: ['Yassine', 'Amine', 'Mehdi'] },
    food: { breakfast: ['msemen and mint tea'], lunch: ['a tagine'], dinner: ['harira'] },
  },
  ro: {
    language: 'Romanian', native: false, level: [0.35, 0.5, 0.15], slips: 'slips with tenses and some direct translations',
    laughYoung: ['haha', 'hahaha'], laughOld: ['haha'],
    names: { w: ['Andreea', 'Ioana', 'Bianca'], m: ['Andrei', 'Mihai', 'Radu'] },
    food: { breakfast: ['covrigi'], lunch: ['ciorbă'], dinner: ['sarmale'] },
  },
  hu: {
    language: 'Hungarian', native: false, level: [0.3, 0.5, 0.2], slips: 'slips with tenses and some direct translations',
    laughYoung: ['haha', 'xd'], laughOld: ['haha'],
    names: { w: ['Reka', 'Eszter', 'Dora'], m: ['Bence', 'David', 'Gergo'] },
    food: { breakfast: ['kifli and coffee'], lunch: ['goulash'], dinner: ['lángos'] },
  },
};

/** Gender-neutral first names for non-binary characters (any culture). */
export const NEUTRAL_NAMES = ['Alex', 'Sam', 'Robin', 'Kai', 'Jamie', 'Charlie', 'Noa', 'Ari', 'River', 'Sasha', 'Max', 'Kim', 'Eden', 'Rowan', 'Quinn', 'Andy', 'Toni', 'Nico'];

export interface Place {
  city: string;
  region?: string;
  country: string;
  tz: string;
  culture: string;
  w: number;
  /** first language override (India, Philippines) */
  language?: string;
  slang?: string[];
  teams?: string[];
}

const us = (city: string, region: string, tz: string, slang?: string[], teams?: string[]): Place => ({ city, region, country: 'US', tz, culture: 'us', w: 2.5, slang, teams });
const uk = (city: string, region?: string, slang?: string[], teams?: string[]): Place => ({ city, region, country: 'UK', tz: 'Europe/London', culture: 'uk', w: 2.5, slang, teams });
const p = (city: string, country: string, tz: string, culture: string, w = 0.9, extra: Partial<Place> = {}): Place => ({ city, country, tz, culture, w, ...extra });

export const PLACES: Place[] = [
  us('Austin', 'Texas', 'America/Chicago', ["y'all"]),
  us('Atlanta', 'Georgia', 'America/New_York', ["y'all"], ['the Hawks', 'the Falcons']),
  us('Columbus', 'Ohio', 'America/New_York', [], ['Ohio State']),
  us('Chicago', 'Illinois', 'America/Chicago', [], ['the Bears', 'the Cubs']),
  us('Denver', 'Colorado', 'America/Denver', [], ['the Broncos', 'the Nuggets']),
  us('Portland', 'Oregon', 'America/Los_Angeles', [], ['the Blazers']),
  us('Phoenix', 'Arizona', 'America/Phoenix', [], ['the Suns']),
  us('Boston', 'Massachusetts', 'America/New_York', ['wicked'], ['the Red Sox', 'the Celtics']),
  us('Minneapolis', 'Minnesota', 'America/Chicago', ['ope'], ['the Vikings']),
  us('Nashville', 'Tennessee', 'America/Chicago', ["y'all"], ['the Titans']),
  us('Pittsburgh', 'Pennsylvania', 'America/New_York', ['yinz'], ['the Steelers']),
  us('Sacramento', 'California', 'America/Los_Angeles', [], ['the Kings']),
  us('Tampa', 'Florida', 'America/New_York', [], ['the Bucs']),
  uk('Leeds', undefined, [], ['Leeds United']),
  uk('Manchester', undefined, ['buzzing'], ['City', 'United']),
  uk('Bristol', undefined, ['gert'], ['Bristol City']),
  uk('Glasgow', 'Scotland', ['wee', 'aye'], ['Celtic', 'Rangers']),
  uk('Cardiff', 'Wales', ['tidy', 'cwtch'], ['Cardiff City']),
  uk('Newcastle', undefined, ['canny', 'howay'], ['Newcastle']),
  p('Dublin', 'Ireland', 'Europe/Dublin', 'ie', 1.6),
  p('Cork', 'Ireland', 'Europe/Dublin', 'ie', 1.2),
  p('Melbourne', 'Australia', 'Australia/Melbourne', 'au', 1.5, { teams: ['the Pies', 'Richmond'] }),
  p('Brisbane', 'Australia', 'Australia/Brisbane', 'au', 1.3, { teams: ['the Broncos'] }),
  p('Perth', 'Australia', 'Australia/Perth', 'au', 1.1),
  p('Auckland', 'New Zealand', 'Pacific/Auckland', 'nz', 1.2, { teams: ['the Blues'] }),
  p('Toronto', 'Canada', 'America/Toronto', 'ca', 1.3, { teams: ['the Leafs', 'the Raptors'] }),
  p('Vancouver', 'Canada', 'America/Vancouver', 'ca', 1.1, { teams: ['the Canucks'] }),
  p('Halifax', 'Canada', 'America/Halifax', 'ca', 0.8),
  p('Cape Town', 'South Africa', 'Africa/Johannesburg', 'za', 1.1),
  p('Durban', 'South Africa', 'Africa/Johannesburg', 'za', 0.8),
  p('Lagos', 'Nigeria', 'Africa/Lagos', 'ng', 1.3),
  p('Abuja', 'Nigeria', 'Africa/Lagos', 'ng', 0.8),
  p('Singapore', 'Singapore', 'Asia/Singapore', 'sg', 0.9),
  // second-language English
  p('Nairobi', 'Kenya', 'Africa/Nairobi', 'ke', 1),
  p('Pune', 'India', 'Asia/Kolkata', 'in', 1, { language: 'Marathi' }),
  p('Bengaluru', 'India', 'Asia/Kolkata', 'in', 1, { language: 'Kannada' }),
  p('Kochi', 'India', 'Asia/Kolkata', 'in', 0.7, { language: 'Malayalam' }),
  p('Jaipur', 'India', 'Asia/Kolkata', 'in', 0.7, { language: 'Hindi' }),
  p('Manila', 'Philippines', 'Asia/Manila', 'ph', 1, { language: 'Tagalog' }),
  p('Cebu', 'Philippines', 'Asia/Manila', 'ph', 0.6, { language: 'Cebuano' }),
  p('Kuala Lumpur', 'Malaysia', 'Asia/Kuala_Lumpur', 'my', 0.8),
  p('São Paulo', 'Brazil', 'America/Sao_Paulo', 'br', 1.2),
  p('Recife', 'Brazil', 'America/Recife', 'br', 0.8, { teams: ['Sport', 'Náutico'] }),
  p('Curitiba', 'Brazil', 'America/Sao_Paulo', 'br', 0.7, { teams: ['Athletico'] }),
  p('Belo Horizonte', 'Brazil', 'America/Sao_Paulo', 'br', 0.7, { teams: ['Atlético', 'Cruzeiro'] }),
  p('Lisbon', 'Portugal', 'Europe/Lisbon', 'pt'),
  p('Porto', 'Portugal', 'Europe/Lisbon', 'pt', 0.7),
  p('Madrid', 'Spain', 'Europe/Madrid', 'es'),
  p('Valencia', 'Spain', 'Europe/Madrid', 'es', 0.7),
  p('Seville', 'Spain', 'Europe/Madrid', 'es', 0.7),
  p('Monterrey', 'Mexico', 'America/Monterrey', 'mx', 0.8),
  p('Puebla', 'Mexico', 'America/Mexico_City', 'mx', 0.7),
  p('Mexico City', 'Mexico', 'America/Mexico_City', 'mx'),
  p('Buenos Aires', 'Argentina', 'America/Argentina/Buenos_Aires', 'ar'),
  p('Córdoba', 'Argentina', 'America/Argentina/Cordoba', 'ar', 0.6),
  p('Medellín', 'Colombia', 'America/Bogota', 'co', 0.8),
  p('Santiago', 'Chile', 'America/Santiago', 'cl', 0.7),
  p('Lima', 'Peru', 'America/Lima', 'pe', 0.7),
  p('Hamburg', 'Germany', 'Europe/Berlin', 'de'),
  p('Munich', 'Germany', 'Europe/Berlin', 'de', 0.8),
  p('Cologne', 'Germany', 'Europe/Berlin', 'de', 0.8),
  p('Vienna', 'Austria', 'Europe/Vienna', 'de', 0.8, { teams: ['Rapid'] }),
  p('Utrecht', 'Netherlands', 'Europe/Amsterdam', 'nl', 0.8),
  p('Rotterdam', 'Netherlands', 'Europe/Amsterdam', 'nl', 0.8),
  p('Gothenburg', 'Sweden', 'Europe/Stockholm', 'nordic', 0.7, { language: 'Swedish' }),
  p('Aarhus', 'Denmark', 'Europe/Copenhagen', 'nordic', 0.6, { language: 'Danish' }),
  p('Bergen', 'Norway', 'Europe/Oslo', 'nordic', 0.6, { language: 'Norwegian' }),
  p('Tampere', 'Finland', 'Europe/Helsinki', 'fi', 0.6),
  p('Tartu', 'Estonia', 'Europe/Tallinn', 'ee', 0.5),
  p('Kraków', 'Poland', 'Europe/Warsaw', 'pl', 0.9),
  p('Wrocław', 'Poland', 'Europe/Warsaw', 'pl', 0.7),
  p('Brno', 'Czechia', 'Europe/Prague', 'cz', 0.6),
  p('Lyon', 'France', 'Europe/Paris', 'fr'),
  p('Marseille', 'France', 'Europe/Paris', 'fr', 0.8),
  p('Nantes', 'France', 'Europe/Paris', 'fr', 0.6),
  p('Turin', 'Italy', 'Europe/Rome', 'it', 0.8),
  p('Naples', 'Italy', 'Europe/Rome', 'it', 0.8),
  p('Bologna', 'Italy', 'Europe/Rome', 'it', 0.7),
  p('Thessaloniki', 'Greece', 'Europe/Athens', 'gr', 0.6),
  p('Izmir', 'Turkey', 'Europe/Istanbul', 'tr', 0.7),
  p('Seoul', 'South Korea', 'Asia/Seoul', 'kr'),
  p('Daegu', 'South Korea', 'Asia/Seoul', 'kr', 0.6),
  p('Fukuoka', 'Japan', 'Asia/Tokyo', 'jp', 0.7),
  p('Nagoya', 'Japan', 'Asia/Tokyo', 'jp', 0.7),
  p('Sapporo', 'Japan', 'Asia/Tokyo', 'jp', 0.6),
  p('Taipei', 'Taiwan', 'Asia/Taipei', 'tw', 0.8),
  p('Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh', 'vn', 0.8),
  p('Da Nang', 'Vietnam', 'Asia/Ho_Chi_Minh', 'vn', 0.5),
  p('Chiang Mai', 'Thailand', 'Asia/Bangkok', 'th', 0.7),
  p('Bandung', 'Indonesia', 'Asia/Jakarta', 'id', 0.7),
  p('Yogyakarta', 'Indonesia', 'Asia/Jakarta', 'id', 0.6),
  p('Alexandria', 'Egypt', 'Africa/Cairo', 'eg', 0.7),
  p('Casablanca', 'Morocco', 'Africa/Casablanca', 'ma', 0.6),
  p('Cluj-Napoca', 'Romania', 'Europe/Bucharest', 'ro', 0.6),
  p('Budapest', 'Hungary', 'Europe/Budapest', 'hu', 0.7),
];

// ---------- jobs ----------

export interface JobT {
  title: string;
  phrase: string;
  cat: JobCat;
  ages: [number, number];
  w: number;
  topics?: Partial<Record<Topic, number>>;
  /** native or fluent English only */
  fluent?: boolean;
}

export const SUBJECTS = [
  'nursing', 'computer science', 'history', 'mechanical engineering', 'psychology', 'graphic design', 'business', 'law', 'biology',
  'architecture', 'sports science', 'music', 'economics', 'civil engineering', 'film studies', 'chemistry',
];

const j = (title: string, phrase: string, cat: JobCat, ages: [number, number], w = 1, topics?: Partial<Record<Topic, number>>, fluent?: boolean): JobT => ({ title, phrase, cat, ages, w, topics, fluent });

export const JOBS: JobT[] = [
  j('high school student', "You're in your last year of high school", 'school', [16, 18], 3, { music: 1, hot_take: 1 }),
  j('high school student', "You're in high school and work weekends at a supermarket", 'school', [16, 18], 2, { work: 1 }),
  j('{subject} student', "You're studying {subject} at university", 'student', [18, 25], 6, { music: 0.5, hot_take: 0.5 }),
  j('PhD student', "You're doing a PhD in {subject} and you're behind on it", 'student', [24, 33], 1, { work: 1 }),
  j('apprentice electrician', "You're an apprentice electrician", 'trade', [17, 23], 1.5, { work: 1 }),
  j('barista', 'You work as a barista at a busy café', 'shift', [18, 35], 2, { food: 1, work: 1 }),
  j('bartender', 'You work behind the bar in a pub', 'shift', [19, 35], 1.5, { music: 0.5, sport: 0.5 }),
  j('supermarket cashier', 'You work the tills at a supermarket', 'shift', [17, 60], 1.5, { local: 1 }),
  j('warehouse worker', 'You pick orders in a big warehouse outside town', 'shift', [19, 50], 1.5, { work: 1 }),
  j('line cook', "You're a line cook in a busy restaurant", 'shift', [19, 45], 1.5, { food: 1.5 }),
  j('hotel receptionist', 'You work the front desk of a hotel', 'shift', [20, 45], 1, { local: 1 }, true),
  j('call centre agent', 'You answer phones at a call centre for a phone company', 'office', [20, 45], 1, { work: 1, hot_take: 0.5 }, true),
  j('shop assistant', 'You work in a clothes shop in the town centre', 'shift', [18, 40], 1.2, { local: 1 }),
  j('gym receptionist', 'You work the front desk of a gym and do some personal training', 'shift', [20, 35], 0.8, { sport: 1.5 }),
  j('hairdresser', "You're a hairdresser at a small salon", 'shop', [20, 55], 1, { local: 1, news: 0.5 }),
  j('software tester', 'You test software at an IT company', 'office', [23, 40], 1, { work: 1 }),
  j('junior accountant', "You're a junior accountant at a small firm", 'office', [23, 32], 1, { work: 1 }),
  j('data analyst', "You're a data analyst for a supermarket chain", 'office', [24, 40], 1, { work: 1, hot_take: 0.5 }),
  j('project manager', "You're a project manager at a construction company", 'office', [30, 55], 1, { work: 1 }),
  j('HR assistant', 'You work in HR at a logistics company', 'office', [23, 40], 0.8, { work: 1 }),
  j('marketing coordinator', 'You do the marketing for a local brewery', 'office', [23, 38], 0.8, { local: 1, food: 0.5 }),
  j('IT support technician', 'You do IT support for a hospital', 'office', [21, 50], 1, { work: 1 }),
  j('bank clerk', 'You work at a bank branch', 'office', [22, 55], 0.8, { local: 0.5, news: 0.5 }),
  j('insurance claims handler', 'You handle insurance claims all day', 'office', [25, 55], 0.6, { work: 1 }),
  j('estate agent', "You're an estate agent", 'office', [25, 55], 0.6, { local: 1.5 }),
  j('architect', "You're an architect at a small firm", 'office', [27, 60], 0.5, { local: 1 }),
  j('office manager', 'You run the office at a dental practice', 'office', [40, 62], 0.8, { work: 1 }),
  j('nurse', "You're a nurse at the hospital", 'care', [22, 60], 2, { work: 1.5 }),
  j('paramedic', "You're a paramedic", 'care', [24, 50], 0.8, { work: 1.5, local: 0.5 }),
  j('physiotherapist', "You're a physiotherapist", 'care', [24, 55], 0.7, { sport: 1 }),
  j('pharmacist', "You're a pharmacist at a local pharmacy", 'care', [26, 62], 0.6, { work: 1 }),
  j('care home worker', 'You work in a care home', 'care', [19, 60], 1, { work: 1 }),
  j('vet nurse', "You're a vet nurse", 'care', [21, 45], 0.6, { work: 1 }),
  j('electrician', "You're an electrician", 'trade', [22, 60], 1, { work: 1 }),
  j('plumber', "You're a plumber", 'trade', [22, 60], 1, { work: 1, local: 0.5 }),
  j('car mechanic', "You're a car mechanic at a small garage", 'trade', [19, 62], 1, { work: 1, sport: 0.5 }),
  j('carpenter', "You're a carpenter", 'trade', [22, 62], 0.8, { work: 1 }),
  j('bike mechanic', 'You fix bikes at a little bike shop', 'trade', [19, 45], 0.5, { sport: 1, local: 0.5 }),
  j('delivery driver', 'You drive a delivery van', 'driver', [20, 55], 1.5, { local: 1, weather: 1 }),
  j('motorbike courier', 'You deliver food on a motorbike', 'driver', [19, 40], 1, { local: 1, food: 0.5 }),
  j('bus driver', 'You drive a city bus', 'driver', [28, 62], 0.8, { local: 1.5 }),
  j('taxi driver', 'You drive a taxi', 'driver', [28, 66], 0.8, { local: 1.5, news: 0.5 }),
  j('truck driver', 'You drive a truck, mostly long hauls', 'driver', [25, 62], 0.8, { weather: 1, music: 0.5 }),
  j('graphic designer', "You're a freelance graphic designer", 'creative', [23, 45], 1, { work: 1, hot_take: 0.5 }),
  j('wedding photographer', "You're a wedding photographer", 'creative', [25, 50], 0.5, { work: 1, weather: 0.5 }),
  j('tattoo artist', "You're a tattoo artist", 'creative', [22, 45], 0.5, { music: 1 }),
  j('video editor', "You're a freelance video editor", 'creative', [22, 40], 0.6, { work: 1, news: 0.5 }),
  j('music teacher', 'You teach guitar and play drums in a covers band at weekends', 'creative', [24, 60], 0.5, { music: 2 }),
  j('baker', 'You run a small bakery with your sister', 'shop', [28, 62], 0.7, { food: 2 }),
  j('shopkeeper', 'You run a corner shop', 'shop', [30, 65], 0.7, { local: 1.5 }),
  j('florist', 'You run a little flower shop', 'shop', [25, 60], 0.5, { local: 1, weather: 0.5 }),
  j('primary school teacher', "You're a primary school teacher", 'teacher', [24, 60], 1.2, { work: 1 }),
  j('maths teacher', 'You teach maths at a secondary school', 'teacher', [25, 60], 0.8, { work: 1 }),
  j('kindergarten teacher', "You're a kindergarten teacher", 'teacher', [23, 55], 0.7, { work: 1 }),
  j('university lecturer', 'You lecture at the university', 'teacher', [32, 65], 0.4, { news: 1, hot_take: 0.5 }),
  j('stay-at-home parent', "You're at home with the kids for now", 'home', [26, 48], 1, { local: 1, food: 0.5 }),
  j('security guard', 'You work nights as a security guard at a shopping centre', 'night', [25, 62], 0.7, { news: 1 }),
  j('night-shift warehouse worker', 'You work night shifts at a warehouse', 'night', [20, 50], 0.6, { work: 1 }),
  j('school caretaker', "You're the caretaker at a school", 'trade', [45, 65], 0.6, { local: 1 }),
  j('librarian', "You're a librarian", 'office', [40, 66], 0.6, { news: 1 }),
  j('farmer', 'You run a small farm with your family', 'trade', [35, 70], 0.5, { weather: 2 }),
  j('postal worker', 'You deliver the post', 'driver', [30, 62], 0.6, { weather: 1, local: 1 }),
  j('retired teacher', "You're retired; you taught at a primary school for over thirty years", 'retired', [62, 70], 1, { news: 1 }),
  j('retired nurse', "You're a retired nurse", 'retired', [62, 70], 1, { news: 0.5 }),
  j('retired postal worker', "You're retired; you delivered the post for most of your life", 'retired', [62, 70], 1, { local: 1 }),
  j('retired engineer', "You're a retired engineer", 'retired', [62, 70], 0.8, { news: 1, hot_take: 0.5 }),
  j('retired shop owner', "You're retired; you ran a hardware shop for years", 'retired', [62, 70], 0.8, { local: 1 }),
  j('retired factory worker', "You're retired; you worked in a factory for most of your life", 'retired', [62, 70], 0.8, { sport: 0.5 }),
  j('retired accountant', "You're a retired accountant", 'retired', [62, 70], 0.6, { news: 1 }),
];

// ---------- scenes: where they are right now, by time of day ----------

export interface SceneT {
  slots: Slot[];
  /** job categories this fits; omitted = anyone */
  cats?: JobCat[];
  /** ages this fits */
  ages?: [number, number];
  now: string;
  sees: string[];
}

const SCENE_LIST: SceneT[] = [
  // morning
  { slots: ['morning'], now: 'in bed scrolling on your phone instead of getting up', sees: ['grey light coming through the curtains', 'your phone at 23 percent'] },
  { slots: ['morning'], now: 'having breakfast at the kitchen table', sees: ['a mug of coffee going cold', 'the radio on low'] },
  { slots: ['morning'], cats: ['student', 'school'], now: 'on the bus to class', sees: ["someone's backpack in your face", 'fogged-up windows'] },
  { slots: ['morning'], cats: ['office', 'teacher', 'care', 'shift'], now: 'on your way to work', sees: ['a guy asleep against the window', 'an ad for car insurance you have seen a hundred times'] },
  { slots: ['morning'], cats: ['office'], now: 'at your desk with a coffee before the first meeting', sees: ['an inbox with forty unread emails', 'a colleague already microwaving something'] },
  { slots: ['morning'], cats: ['shift', 'care'], now: 'on a quick break early in your shift', sees: ['a stack of boxes', 'a flickering strip light'] },
  { slots: ['morning'], cats: ['driver', 'trade'], now: 'sitting in the van waiting for your first job of the day', sees: ['the dashboard clock', 'a queue at the petrol station'] },
  { slots: ['morning'], cats: ['shop'], now: 'opening up the shop, nobody in yet', sees: ['the till warming up', 'boxes from a delivery'] },
  { slots: ['morning'], cats: ['retired'], now: 'at the kitchen table with a coffee and the news', sees: ["the neighbour's cat in the garden", 'the newspaper folded on the table'] },
  { slots: ['morning'], cats: ['home'], now: 'back home after the school run, the kitchen is a mess', sees: ['cereal on the floor', 'the dishwasher half loaded'] },
  { slots: ['morning'], cats: ['night'], now: 'just home from a night shift, lying on the sofa, not sleepy yet', sees: ['the curtains still closed', 'your work boots by the door'] },
  // afternoon
  { slots: ['afternoon'], cats: ['student'], now: 'in the library pretending to study', sees: ['a laptop with fourteen tabs open', 'someone typing very loudly'] },
  { slots: ['afternoon'], cats: ['school'], now: 'just home from school, lying on your bed', sees: ['your school bag on the floor', 'a half-eaten packet of crisps'] },
  { slots: ['afternoon'], cats: ['office'], now: 'at your desk on a slow afternoon', sees: ["a spreadsheet you've been ignoring", 'the office plant that is nearly dead'] },
  { slots: ['afternoon'], cats: ['shift'], now: 'on your break in the staff room', sees: ['a vending machine', 'a microwave with a queue'] },
  { slots: ['afternoon'], cats: ['care'], now: 'on a short break at work', sees: ['a vending machine coffee', 'a notice board full of rotas'] },
  { slots: ['afternoon'], cats: ['trade'], now: 'on a break in the van between jobs', sees: ['a toolbox on the passenger seat', 'rain on the windscreen'] },
  { slots: ['afternoon'], cats: ['driver'], now: 'parked up between deliveries', sees: ['the delivery app on your other phone', 'a busy street'] },
  { slots: ['afternoon', 'morning'], cats: ['creative'], now: 'at home, supposed to be working on a project', sees: ['a half-finished draft on the screen', 'a cold cup of tea'] },
  { slots: ['afternoon'], cats: ['shop'], now: 'behind the counter, the shop is quiet', sees: ['the door, waiting for customers', 'a radio playing old songs'] },
  { slots: ['afternoon'], cats: ['retired'], now: 'sitting out in the garden', sees: ['the flower beds that need weeding', 'a neighbour mowing the lawn'] },
  { slots: ['afternoon'], cats: ['home'], now: 'waiting at the school gate for the kids', sees: ['other parents on their phones', 'a crossing guard'] },
  { slots: ['afternoon'], cats: ['night'], now: 'just woke up after a night shift, still in bed', sees: ['the blackout curtains', 'an energy drink on the nightstand'] },
  { slots: ['afternoon'], cats: ['teacher'], now: 'in the staff room between classes', sees: ['a pile of marking', 'a kettle that takes forever'] },
  // evening
  { slots: ['evening'], now: 'on the sofa with the TV on in the background', sees: ['a cooking show nobody is watching', 'a blanket over your legs'] },
  { slots: ['evening'], ages: [20, 70], now: 'cooking dinner', sees: ['a pan of something on the stove', 'a sink full of dishes'] },
  { slots: ['evening'], cats: ['office', 'shift', 'care', 'trade', 'teacher'], now: 'on the way home from work', sees: ['a packed bus', 'traffic lights that never change'] },
  { slots: ['evening'], cats: ['student', 'school'], now: 'in your room, supposed to be doing an assignment', sees: ['a desk covered in notes', 'your headphones'] },
  { slots: ['evening'], cats: ['home'], now: 'the kids are finally in the bath and you have five minutes', sees: ['toys all over the floor', 'a basket of laundry'] },
  { slots: ['evening'], cats: ['night'], now: 'getting ready for your night shift', sees: ['your uniform on the bed', 'the clock'] },
  { slots: ['evening'], cats: ['retired'], now: 'in your armchair after supper', sees: ['the evening news on TV', 'a cup of tea'] },
  { slots: ['evening'], cats: ['shift'], now: 'closing up at work, almost done', sees: ['chairs stacked on tables', 'a mop bucket'] },
  { slots: ['evening'], cats: ['driver'], now: 'doing the last few deliveries of the day', sees: ['headlights everywhere', 'a parcel with a wrong address'] },
  // night
  { slots: ['night'], now: "in bed, can't sleep", sees: ['the glow of your phone', 'a dripping tap somewhere'] },
  { slots: ['night'], ages: [20, 70], now: 'up late with a cup of tea', sees: ['the dark street outside', 'one lamp on'] },
  { slots: ['night'], cats: ['student', 'school'], ages: [16, 30], now: 'up late gaming', sees: ['your monitor', 'an empty energy drink can'] },
  { slots: ['night'], cats: ['night', 'shift'], now: 'on your break on a night shift', sees: ['a strip-lit break room', 'a vending machine'] },
  { slots: ['night'], cats: ['care'], now: 'on a night shift, a quiet moment at the nurses station', sees: ['a row of monitors', 'a cold coffee'] },
  { slots: ['night'], cats: ['driver'], now: 'waiting for one more job before you call it a night', sees: ['empty streets', 'the app showing nothing'] },
  { slots: ['night'], cats: ['retired'], now: "can't sleep, sitting in the kitchen", sees: ['the clock ticking', 'the dog asleep under the table'] },
];
export const SCENES: readonly SceneT[] = SCENE_LIST;

export const GENERIC_FOOD = {
  breakfast: ['toast and coffee', 'just coffee so far', 'porridge', 'a banana on the way out', 'cereal', 'eggs on toast'],
  lunch: ['a sandwich from the shop', 'leftover pasta', 'instant ramen', 'a salad that was sad', 'chicken and rice', 'a slice of pizza'],
  dinner: ['pasta', 'a takeaway pizza', 'a stir fry', 'soup', 'chicken and veg', 'a burger'],
  snack: ['crisps', 'a bowl of cereal', 'cold pizza', 'toast', 'some biscuits', 'an apple'],
};

// ---------- family, pets, commute, hobbies, quirks, details ----------

export const PETS: { kind: string; names: string[] }[] = [
  { kind: 'cat', names: ['Biscuit', 'Mochi', 'Luna', 'Pepper', 'Tofu', 'Miso', 'Olive', 'Ziggy', 'Noodle'] },
  { kind: 'dog', names: ['Rex', 'Nala', 'Pickles', 'Bruno', 'Daisy', 'Max', 'Lola', 'Bear', 'Peanut'] },
  { kind: 'rabbit', names: ['Bun', 'Clover', 'Thumper'] },
  { kind: 'parrot', names: ['Kiwi', 'Captain'] },
  { kind: 'tortoise', names: ['Speedy', 'Gary'] },
];

export interface HobbyT {
  text: string;
  topics: Topic[];
  ages?: [number, number];
  /** a letter that makes this hobby likelier, e.g. 'E' or 'N' */
  likes?: string;
}

export const HOBBIES: HobbyT[] = [
  { text: 'five-a-side football', topics: ['sport'], ages: [16, 50], likes: 'E' },
  { text: 'watching {team} games', topics: ['sport'], likes: 'E' },
  { text: 'running', topics: ['sport', 'weather'], ages: [18, 65], likes: 'J' },
  { text: 'bouldering', topics: ['sport'], ages: [18, 45] },
  { text: 'basketball', topics: ['sport'], ages: [16, 40], likes: 'E' },
  { text: 'the gym', topics: ['sport'], ages: [17, 50], likes: 'J' },
  { text: 'cycling', topics: ['sport', 'local'], ages: [18, 70] },
  { text: 'swimming', topics: ['sport', 'weather'] },
  { text: 'yoga', topics: ['sport'], ages: [20, 70] },
  { text: 'indie gigs', topics: ['music', 'local'], ages: [17, 45], likes: 'E' },
  { text: 'making beats on your laptop', topics: ['music'], ages: [16, 35], likes: 'N' },
  { text: 'K-pop', topics: ['music'], ages: [16, 30] },
  { text: 'playing guitar, badly', topics: ['music'], likes: 'P' },
  { text: 'old records on vinyl', topics: ['music'], ages: [25, 70], likes: 'I' },
  { text: 'karaoke', topics: ['music'], likes: 'E' },
  { text: 'true crime podcasts', topics: ['news', 'hot_take'], ages: [18, 60], likes: 'N' },
  { text: 'keeping up with the news', topics: ['news'], ages: [30, 70], likes: 'J' },
  { text: 'baking', topics: ['food'], likes: 'S' },
  { text: 'trying street food', topics: ['food', 'local'], likes: 'P' },
  { text: 'cooking for friends', topics: ['food'], ages: [22, 70], likes: 'F' },
  { text: 'gardening', topics: ['weather', 'local'], ages: [30, 70], likes: 'S' },
  { text: 'fishing', topics: ['weather', 'local'], ages: [25, 70], likes: 'I' },
  { text: 'hiking', topics: ['weather', 'sport'], ages: [18, 70] },
  { text: 'video games', topics: ['hot_take'], ages: [16, 45], likes: 'I' },
  { text: 'anime', topics: ['hot_take'], ages: [16, 35], likes: 'N' },
  { text: 'reality TV', topics: ['hot_take', 'news'], ages: [18, 60], likes: 'F' },
  { text: 'thrift shopping', topics: ['local'], ages: [16, 45], likes: 'P' },
  { text: 'photography', topics: ['local', 'weather'], likes: 'N' },
  { text: 'fantasy novels', topics: ['hot_take'], likes: 'N' },
  { text: 'knitting', topics: ['hot_take'], ages: [20, 70], likes: 'I' },
  { text: 'board games', topics: ['hot_take'], ages: [18, 60] },
  { text: 'star signs', topics: ['hot_take'], ages: [16, 50], likes: 'F' },
  { text: 'fixing up old cars', topics: ['local'], ages: [20, 70], likes: 'S' },
  { text: 'crosswords', topics: ['news'], ages: [40, 70], likes: 'J' },
  { text: 'bird watching', topics: ['weather', 'local'], ages: [40, 70], likes: 'I' },
  { text: 'online chess', topics: ['hot_take'], ages: [16, 60], likes: 'T' },
  { text: 'TikTok, too much of it', topics: ['news', 'hot_take'], ages: [16, 35] },
];

export interface QuirkT {
  text: string;
  ages?: [number, number];
  /** letters this suits; any of them */
  letters?: string;
}

export const QUIRKS: QuirkT[] = [
  { text: 'You hate voice notes.' },
  { text: "You're trying to cut down on coffee and it is not going well." },
  { text: "You say 'anyway' a lot when you want to change the subject.", letters: 'P' },
  { text: 'You find most small talk a bit silly, but you play along.', letters: 'IT' },
  { text: 'You love a good conspiracy theory, half as a joke.', letters: 'N' },
  { text: 'You always have an opinion about the weather.', letters: 'S' },
  { text: "You're on your phone too much and you know it.", ages: [16, 45] },
  { text: "You're saving up for a trip and bring it up if travel comes up." },
  { text: "You're a bit competitive and hate losing at anything.", letters: 'T' },
  { text: 'You get distracted halfway through thoughts.', letters: 'P' },
  { text: "You use the word 'literally' way too much.", ages: [16, 30] },
  { text: "You're nosy and like asking where people are from.", letters: 'EF' },
  { text: 'You go quiet if someone is rude.', letters: 'IF' },
  { text: 'You sometimes correct people on facts, then feel a bit bad about it.', letters: 'TJ' },
  { text: "You're terrible with names." },
  { text: 'You ramble a little when something excites you.', letters: 'E' },
  { text: 'You think pineapple on pizza is fine and will defend it.' },
  { text: 'You type with one thumb while holding a drink.', ages: [18, 50] },
  { text: "You're very proud of your pet." },
];

export const DETAILS: { text: string; ages?: [number, number] }[] = [
  { text: 'You moved to {city} about two years ago.', ages: [20, 60] },
  { text: "You're learning to drive and failed your first test.", ages: [17, 30] },
  { text: 'You cracked your phone screen last week.' },
  { text: 'You just started a new job and still get lost in the building.', ages: [19, 50] },
  { text: 'Your landlord has not fixed the boiler in a month.', ages: [19, 45] },
  { text: "You're saving up for a trip to {trip}." },
  { text: 'You just got back from visiting family and are still tired from it.' },
  { text: 'You have a dentist appointment tomorrow you are dreading.' },
  { text: 'Your neighbour has been doing DIY every evening this week.' },
  { text: 'You are trying to learn to cook properly.', ages: [18, 40] },
  { text: 'You have been binge-watching a series all week.' },
  { text: 'Your knee has been playing up.', ages: [40, 70] },
  { text: 'Your grandkids visited at the weekend.', ages: [58, 70] },
  { text: 'You have exams in two weeks.', ages: [16, 25] },
];

export const TRIPS = ['Lisbon', 'Japan', 'Mexico', 'New York', 'Thailand', 'Iceland', 'Rome', 'Bali', 'Scotland', 'Peru', 'Greece', 'Cape Town'];

export const COMMUTES: { text: string; ages?: [number, number]; cats?: JobCat[]; w?: number }[] = [
  { text: 'You get the bus everywhere.', w: 2 },
  { text: 'You get around on an old bike.', ages: [16, 60] },
  { text: 'You drive a {car}.', ages: [18, 70], w: 2 },
  { text: 'You take the metro, packed every time.', ages: [16, 60] },
  { text: 'You walk most places.' },
  { text: 'You ride an electric scooter.', ages: [16, 40] },
  { text: 'You take the train in.', ages: [18, 65] },
  { text: 'You ride a motorbike.', ages: [19, 55] },
  { text: 'You drive the work van, even at weekends.', cats: ['trade', 'driver'], w: 3 },
  { text: 'Your mum drives you most places.', ages: [16, 18], w: 2 },
];

export const CARS = ['beat-up hatchback', 'old Volkswagen', 'second-hand Toyota', 'tiny Fiat', 'rusty pickup', 'company car', 'ancient Honda'];
