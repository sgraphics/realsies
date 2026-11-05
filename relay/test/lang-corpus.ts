// Chat lines for the language detector test (test/language.test.ts).
//
// ENGLISH: short, sloppy English chat the detector must never call foreign: slang from the US, the UK,
// Ireland, Scotland and Australia, Gen-Z and gaming talk, typos, loanwords and famous foreign phrases that
// English speakers use, place names, food, and English that mentions a foreign word or two.
// FOREIGN: clear lines in other languages that it must flag, as players would type them (with and without
// accents, with chat abbreviations). MAYBE: tourist phrases either way (not asserted).

export const ENGLISH: readonly string[] = [
  // one or two words
  'lol', 'lmaooo', 'wyd', 'idk tbh', 'bruh', 'omg same', 'wait fr?', 'hbu', 'sup', 'heyy', 'hiii', 'yo', 'ok cool', 'k', 'kk', 'mood', 'ikr',
  'smh', 'fr fr', 'deadass', 'no cap', 'on god', 'bet', 'say less', 'its giving', 'slay', 'periodt', 'lowkey tired', 'highkey hungry',
  'ur funny', 'r u real', 'prove it', '4 duh', 'wbu', 'nm u', 'aight', 'ight', 'ayo', 'wassup', 'whatcha doin', 'dunno', 'gotta go',
  'lemme think', 'gimme a sec', 'wanna play', 'ya', 'yea', 'yeh', 'yep', 'nope', 'naw', 'ofc', 'obv', 'tho', 'gr8 m8', 'l8r', 'ttyl',
  'afk', 'gg ez', 'rip', 'oof', 'yikes', 'welp', 'meh', 'hmmm', 'uhh', 'umm', 'ooh', 'aww', 'omw', 'np ty', 'thx', 'pls', 'srsly', 'jk',
  'lmk', 'imo', 'nvm', 'wtf', 'omfg', 'LMAO', 'LOL', 'XD', 'xd', ':)', ':D', '<3', '😂😂', '💀', 'nahhh', 'hahahaha', 'hehe', 'ha',
  'hahah', 'bro what', 'k bye', 'byeee', 'cya', 'see ya', 'later', 'peace out', 'night', 'gn', 'gm', 'morning', 'mornin', 'evenin',
  'yesss', 'nooo', 'whyyy', 'omggg', 'sooo', 'ummm ok', 'ye', 'yee', 'yeehaw', 'brr', 'facts', 'tru', 'valid', 'fair enough', 'oh word?',
  'word', 'mos def', 'fosho', 'fo sho', 'bout to', 'finna', 'tryna', 'ion know', 'ian even care', 'nun much', 'ard', 'bruh moment',
  // UK, Ireland, Scotland, Australia, NZ, the American South and Midwest
  'innit', 'proper knackered mate', 'cheers', 'ta', 'bloody hell', 'gutted', 'chuffed', 'bare peng', 'wagwan', 'allow it bruv', 'arvo',
  'heaps good', 'reckon so', 'no worries', 'servo', 'maccas run', 'fair dinkum', "g'day mate", 'sweet as', 'grand so', 'great craic',
  'deadly', 'ya eejit', 'sound', 'whats the story', 'aye wee bit', 'och aye', 'dinnae ken', "y'all ok", 'fixin to eat', "ain't no way",
  'howdy', 'yinz', 'wicked cold', 'ope sorry', 'oi', 'blimey', 'ta ra', 'ey up', 'nowt', 'summat', 'owt', 'reet', 'skint til payday',
  'cheeky nandos later?', 'proper rain today', 'mate its freezing', 'wanna get a pint', 'footy tonight', 'the lads are coming over',
  'bants', 'working at tesco', 'i go to uni in manchester', 'studying compsci', 'my mam says hi',
  // Gen-Z and gaming
  'ok boomer', 'touch grass', 'skill issue', 'ratio', 'based', 'cringe', 'rizz', 'bussin', 'mid', 'fam', 'yeet', 'lit', 'salty', 'shook',
  'spill the tea', 'vibe check', 'big mood', 'main character energy', 'im dead', 'screaming', 'no bc why', 'not me', 'pov', 'iykyk',
  'goat', 'irl', 'hmu', 'thats so cringe omg', 'stop it lol', 'i cant w u', 'u r so random', 'gonna watch some anime', 'one piece is peak',
  'naruto mid tbh', 'ight imma head out', 'ur wrong', 'ur right', 'facts tho', 'pineapple pizza is fine fight me', 'tea > coffee',
  // typos and sloppy sentences
  'teh weather here is soo bad lol', 'i jsut got home from wrok', 'my mom made spagetti', 'were u from', 'im form texas',
  'hav u eaten yet', 'ive been waching netflix all day', 'my dog ate my homwork lmao', 'its raining cats and dogs here',
  'ugh my phone is at 2 percent', 'i cant even rn', 'this is so random lol', 'whats ur fav food', 'do u like anime',
  'i love pizza and tacos', 'ya im from ohio lol', 'ngl thats kinda sus', 'haha nah im good', 'u a bot or wut', 'where u at',
  'just chillin rn', 'gonna grab food brb', 'my cat is being so dramatic rn', 'ugh mondays', 'im so tired lmao', 'what u eating',
  'pizza obvs', 'dude no way', 'thats wild', 'yeah nah', 'i ate tacos', 'ate a sandwich lol', 'nothin much hbu', 'not much tbh',
  'kinda bored', 'ok so i kinda forgot ur name lol', 'whats the weather like there', 'sunny but cold', 'rain rain rain', 'snowing!!',
  'its hot af', 'ac broke', 'need coffee', 'coffee first', 'u good?', 'all good', 'im ok', 'not bad', 'could be worse', 'livin the dream',
  'meh its fine', 'whatevs', 'cool cool cool', 'ok but fr tho', 'i have a dog named max', 'his name is bruno', 'my sis is annoying',
  'mom says hi', 'gtg dinner', 'wanna hear a joke', 'knock knock', 'whos there', 'lettuce', 'lettuce who',
  'so what do u do for work', 'im a nurse, night shifts suck', 'what can u see right now', 'just my laptop and a cold coffee',
  'ok quick one whats 7 times 8', 'you type kinda fast lol', 'nah im just bored at work', 'wait really?', 'same honestly',
  'what time is it where you are', 'its like 3pm here', 'are you a bot tbh', 'haha no im real. are you?', 'what did you have for lunch',
  'my cat just walked across my keyboard', 'thats fair', 'where are you from?', 'lol ok', 'what are you up to today',
  'im in lisbon, its weirdly sunny', 'hey', 'hii', 'hello?', 'how old r u', '25 hbu', 'u go to school?', 'nah i dropped out lol',
  'thats crazy', 'ur crazy', 'i dont believe u', 'say smth only a human would say', 'banana', 'potato', 'idk man',
  'I am from Leeds, born and raised', 'Do you like football?', 'What is your favourite band?', 'I have never been to Estonia.',
  'Honestly I could eat pasta every single day', 'The bus was late again so I walked', 'Are you a real person or what?',
  'tbh i dont even know what im doing here', 'ngl this game is kinda fun', 'ive got exams next week so stressed',
  'im watching the game rn, eagles are losing', 'so i was in the bus and die hard was on tv', 'my bra strap broke lol',
  'folk music is underrated', 'ben and i went out last night', 'put it in the bin lol', 'my hat blew away', 'ho ho ho merry xmas',
  // loanwords, famous phrases, places and food
  'im in berlin rn', 'my friend from madrid', 'i love paris', 'visiting tallinn next week', 'have u been to helsinki',
  'pizza margherita', 'croissant and cafe au lait', 'tacos al pastor', 'si senor lol', 'hasta la vista baby', 'bon appetit',
  "c'est la vie", 'deja vu', 'danke schoen lol', 'gracias amigo', 'ciao bella', 'ok ciao', 'adios', 'merci', 'kawaii', 'sayonara',
  'namaste', 'salut', 'hola', 'aloha', 'prost', 'que sera sera', 'mi casa es su casa', 'je ne sais quoi', 'vamos', 'ole ole ole',
  'el fin', 'la la land', 'ja ja ja', 'jajaja', 'kkkkk', 'haha ja', 'ich bin ein berliner lol', 'auf wiedersehen', 'mamma mia',
  'gesundheit', 'muchas gracias', 'por favor', 'feliz navidad', 'bon voyage', 'au revoir', 'carpe diem', 'et cetera', 'vice versa',
  'the zeitgeist is wild', 'such wanderlust lol', 'schadenfreude is real', 'my friend says ich bin müde all the time lol',
  'my estonian mate says tere every morning', 'how do you say thanks in finnish? kiitos?', 'learning spanish on duolingo, hola!',
  'el paso is hot', 'we went to los angeles', 'i had tapas and sangria in barcelona', 'my fav dish is pad thai', 'tikka masala tonight',
  'c u l8r', 'ur so gr8', 'brb 5 min', 'omw 10 mins', 'call me at 9', 'it was 50 quid', '100% agree', 'top 10 anime fights',
  // English that mentions foreign words, names, food and places, kaomoji and stray characters from other scripts
  'i have a dog called pepper and a cat called miso', 'my name is ana and i live in porto', 'de la soul is my fav band',
  'la croix is the best drink', 'el chapo documentary is wild', 'per my last email lol', 'a la carte menu', 'con artist vibes',
  'die hard fan here', 'was so tired i fell asleep', 'also i have a dentist appt', 'kind of a mess tbh', 'the man the myth the legend',
  'see you at the gym', 'hell yeah', 'fast food again lol', 'i got a gift card', 'my mate dave is a legend', 'i was like wtf',
  'um ok so like', 'in a min', 'on my way home', 'so so tired', 'me too', 'ur mom lol', 'pan con tomate is amazing',
  'had a bratwurst at the christmas market', 'the doner kebab place is closed', 'mi amigo pablo', 'la la la la', 'est 1999',
  'le sigh', 'le epic fail', 'je suis tired', 'moi aussi lol', 'oui oui baguette', 'zut alors', "c'est what it is",
  'i love тетрис lol', '¯\\_(ツ)_/¯', 'ಠ_ಠ', '( ͡° ͜ʖ ͡°)', '(╯°□°)╯︵ ┻━┻', 'UwU', 'OwO', ':3', 'π day lol', 'lmao 草',
  'ok ok 😂😂😂', 'no no no no', 'si si si', 'da da da', 'ja ja', 'nein nein nein', 'oh la la', 'ole', 'mamma mia here we go again',
  'ich bin ein berliner', 'el nino is coming', 'fiesta time', 'nada mucho', 'que pasa amigo', 'hasta la vista', 'adios amigos',
  'au contraire mon ami', 'bonjour mademoiselle', 'merci beaucoup', 'danke schon', 'prost!', 'skal!', 'sante', 'salud',
  'my grandma is from italy and says mangia mangia', 'we had pasta al dente', 'going to ikea for meatballs', 'hygge vibes',
  'feeling very zen', 'tsunami warning lol', 'karaoke tonight', 'emoji overload', 'the tea is piping hot', 'pho for lunch',
  'banh mi is the best sandwich', 'kimchi fried rice', 'bibimbap time', 'naan bread', 'chai latte', 'matcha', 'gelato', 'espresso pls',
  'a cappella group', 'deja vu again', 'rsvp by friday', 'aka the boss', 'eta 5 mins', 'asap', 'ps i love u', 'fyi', 'diy project',
  'i speak a bit of spanish', 'my french is rusty', 'i took german in school', 'my estonian friend', 'do u speak finnish',
  'hi from tallinn', 'hello from berlin', 'greetings from madrid', 'im in paris rn its so pretty', 'helsinki is cold',
  'met a guy named jesus at work', 'jose and maria are my neighbours', 'my teacher mr garcia', 'santiago is my cousin',
  'mia is my best friend', 'ella and sara are coming', 'dan and ben went home', 'ana and eva', 'tom and jerry',
  'te quiero lol jk', 'besos', 'xoxo', 'muah', 'bisous', 'ciao ciao', 'tschuss', 'servus', 'moin moin', 'tere tere', 'moi moi',
];

export const FOREIGN: Record<string, readonly string[]> = {
  et: [
    'Tere! Kuidas sul läheb?', 'Kust sa pärit oled?', 'Mis sa praegu teed?', 'Ma olen Tallinnast, aga elan nüüd Tartus.',
    'Kas sa oled robot või päris inimene?', 'Täna on väga külm ilm.', 'Mida sa täna sõid?', 'Ma ei saa aru, mida sa mõtled.',
    'Mul on kass ja koer.', 'Tere õhtust, kuidas läheb?', 'Kas sa räägid eesti keelt?', 'Mis su nimi on?',
    'tere kuidas läheb', 'ma ei tea mis sa mõtled', 'kus sa elad praegu', 'kas sul on lemmikloomi',
  ],
  de: [
    'Hallo, wie geht es dir?', 'Woher kommst du?', 'Was machst du gerade?', 'Ich bin aus Berlin und arbeite im Labor.',
    'Bist du ein Bot oder ein Mensch?', 'Heute ist das Wetter wirklich schlecht.', 'Was hast du heute gegessen?',
    'Ich verstehe nicht, was du meinst.', 'Wie spät ist es bei dir?', 'Sprichst du Deutsch?',
    'ich weiß nicht was du meinst', 'wo wohnst du eigentlich', 'das ist echt lustig haha', 'ich bin so müde heute',
  ],
  es: [
    '¿De dónde eres?', '¿Qué estás haciendo ahora?', 'Soy de Madrid pero vivo en Valencia.', '¿Eres un bot o una persona real?',
    'Hoy hace mucho calor aquí.', '¿Qué comiste hoy?', 'No entiendo lo que quieres decir.', '¿Qué hora es allí?',
    '¿Hablas español?', 'no se que quieres decir', 'donde vives ahora', 'jajaja que gracioso eres', 'yo vivo en mexico y tu?',
  ],
  fr: [
    "Tu viens d'où ?", "Qu'est-ce que tu fais en ce moment ?", 'Je suis de Lyon mais je vis à Paris.', 'Tu es un bot ou une vraie personne ?',
    "Il fait vraiment froid aujourd'hui.", "Qu'est-ce que tu as mangé aujourd'hui ?", 'Je ne comprends pas ce que tu veux dire.',
    'Quelle heure est-il chez toi ?', 'Tu parles français ?', 'je sais pas ce que tu veux dire',
    'tu habites où maintenant', 'mdr t trop drôle toi', "c'est trop bien ici",
  ],
  fi: [
    'Moi! Mitä kuuluu?', 'Mistä sinä olet kotoisin?', 'Mitä sinä teet nyt?', 'Olen Tampereelta, mutta asun nyt Helsingissä.',
    'Oletko sinä botti vai oikea ihminen?', 'Tänään on tosi kylmä.', 'Mitä söit tänään?', 'En ymmärrä mitä tarkoitat.',
    'Onko sinulla lemmikkejä?', 'Paljonko kello on siellä?', 'moi mitä kuuluu', 'en tiiä mitä tarkotat',
    'missä sä asut nykyään', 'tosi hauska juttu kyllä',
  ],
  it: ['Di dove sei?', 'Cosa stai facendo adesso?', 'Non capisco cosa vuoi dire.', 'Sei un bot o una persona vera?'],
  pt: ['De onde você é?', 'O que você está fazendo agora?', 'Não entendi o que você quis dizer.', 'Você é um robô ou uma pessoa?'],
  nl: ['Hoi, hoe gaat het met je?', 'Waar kom je vandaan?', 'Wat ben je nu aan het doen?', 'Ik begrijp niet wat je bedoelt.'],
  sv: ['Hej, hur mår du?', 'Vad gör du just nu?', 'Jag förstår inte vad du menar.'],
  pl: ['Cześć, jak się masz?', 'Skąd jesteś?', 'Co teraz robisz?', 'Nie rozumiem, co masz na myśli.'],
  ru: ['Привет, как дела?', 'Откуда ты?', 'Что ты сейчас делаешь?', 'Я не понимаю, что ты имеешь в виду.'],
  ja: ['こんにちは、元気ですか？', 'どこから来ましたか？', '今何をしていますか？'],
  ko: ['안녕하세요, 잘 지내세요?', '어디에서 왔어요?', '지금 뭐 하고 있어요?'],
};

/** Tourist phrases and very short lines: either answer is acceptable. */
export const MAYBE: readonly string[] = [
  'Hast du Haustiere?', '¿Tienes mascotas?', 'Tu as des animaux ?', 'Puhutko suomea?', 'Var kommer du ifrån?', 'Hola, ¿cómo estás?', 'hola como estas', 'Salut, ça va ?', 'salut ça va', 'Wie gehts?', 'Hej!', 'Tere!', 'Kiitos!'];
