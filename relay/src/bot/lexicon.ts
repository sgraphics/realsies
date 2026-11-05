// Word lists for the relay's language detector (src/bot/language.ts). Plain data, lowercase, one token
// per entry (accented and unaccented spellings both work: the detector also tries the form without accents).
//
//   ENGLISH    everyday English and chat English: function words, contractions with and without the
//              apostrophe, slang and abbreviations from the US, the UK, Ireland, Scotland, Australia and
//              online. These guard against false alarms: a line with English in it is never called foreign.
//   NEUTRAL    used everywhere online (lol, haha, ok, xd, emoticon words): neither English nor foreign
//   TOURIST    foreign words every English speaker knows (hola, merci, ciao, danke): neither
//   PHRASES    well-known foreign phrases used in English (c'est la vie, mi casa es su casa): removed first
//   LEXICONS   per language, its most frequent function words and chat words. A word that is also in
//              ENGLISH counts for neither side (die, was, so, me, on, also).
//
// Keep the lists to words that are frequent in short chat; the detector needs two or more of them.

const w = (s: string): string[] => s.split(/\s+/).filter(Boolean);

export const ENGLISH = new Set(w(`
a about above across act actually add after afternoon again against age ago agree ah ahead aint air all almost alone along already
alright also although always am amazing an and angry animal annoying another answer any anybody anyone anything anyway anyways
anywhere apart app apparently are area arent arm around arrive art as ask asked asking asleep at ate attention aunt avoid awake away
awesome awful awkward baby back bad badly bag bake ball band bank bar bathroom be beach bear beat beautiful became because become bed
bedroom been beer before begin behind being believe best better between big bike bill bird birthday bit bite black blame blue board
boat body book boring born boss both bother bottle bought box boy boyfriend brain bread break breakfast bring broke broken brother
brought brown buddy build building bunch burn bus busy but buy by bye cake call called calling calm came can cant car card care
careful carry case cat catch caught cause cell chair chance change charge chat cheap check cheese chicken child children chill
chilling choose church city class clean clear close clothes cloud coat coffee cold college color colour come comes coming company
cook cooking cool corner could couldnt count country couple course cousin cover crazy cream cry cup cut cute dad daddy damn dance dark
date daughter day days dead deal dear decide deep definitely did didnt die died diet different dinner dirty do doctor does doesnt dog
doing dollar dollars done dont door double down dream dress drink drive driver driving drop drove drunk dry dude due during each early
earth easy eat eaten eating egg eggs either else email end enjoy enough even evening ever every everybody everyone everything exactly
exam example except excited exciting excuse expect expensive explain eye eyes face fact fail fair fall family famous fan far farm
fast fat father favorite favourite fear feel feeling feet fell felt few field fight figure fill film final finally find fine finger
finish fire first fish five fix floor fly follow food foot for forget forgot forgotten form forward found four free fresh friday
friend friends from front fruit full fun funny game games garden gave get gets getting girl girlfriend give given glad glass go god
goes going gone good got gotten great green grew ground group grow guess guy guys hair half hand hands hang happen happened happy hard
has hate have havent having he head hear heard heart heavy hell hello help her here hers herself hey hi high him himself his history
hit hold holiday home homework hope horrible horse hospital hot hotel hour hours house how however huge human hungry hurry hurt
husband i ice idea if ill im important in inside instead interesting into is isnt it its itself job join joke jump just keep kept
key kid kids kill kind kinda kitchen knew know knows lady land language large last late later laugh lazy learn least leave left leg
less let lets letter life lift light like liked line list listen little live lived lives living long look looking looks lose lost lot
lots loud love lovely low luck lucky lunch mad made main make makes making man many market married matter may maybe me mean means
meant meat meet meeting men message met middle might mind mine minute minutes miss missed mom mommy moment monday money month months
mood more morning most mother mouth move movie movies much mum music must my myself name near nearly need needed needs never new news
next nice night nine no nobody noise none normal nose not nothing notice now number of off office often oh oil ok okay old on once
one ones online only open or orange order other others our out outside over own pain paint paper parent parents park part party pass
past pay people perfect perhaps person phone pick picture piece pink place plan plane play played player playing please plus pocket
point police poor possible post power pretty price probably problem pull put question quick quickly quiet quite rain raining ran
rather read reading ready real really reason red remember rest rich ride right ring road rock room round rule run running sad safe
said same sat saturday save saw say saying says school sea season seat second see seem seems seen sell send sent serious set seven
several shall share she shes ship shirt shoe shoes shop shopping short should shouldnt show shower shut sick side sign silly simple
since sing single sister sit sitting six size sky sleep sleeping sleepy slow small smart smell smile snow so some somebody someone
something sometimes somewhere son song soon sorry sort sound sounds space speak special spend spent sport sports spring stand star
start started state station stay stayed step stick still stop store story strange street strong student study stuff stupid such
sugar summer sun sunday sunny super supposed sure surprise sweet swim table take taken taking talk talking tall taste taught tea teach
teacher team tell telling ten terrible test than thank thanks that thats the their them themselves then there theres these they theyre
thing things think thinking third this those though thought three threw through throw thursday ticket till time tiny tired to today
together told tomorrow tonight too took top total touch town toy train travel tree tried trip trouble true trust truth try trying
tuesday turn tv twice two type ugly uncle under understand unless until up upset us use used useful usual usually very visit wait
waiting wake walk walked walking wall want wanted wants war warm was wash wasnt watch watched watching water way we wear weather
website wednesday week weekend weeks weird welcome well went were werent what whatever whats when where wheres whether which while
white who whole whos whose why wife wild will win wind window wine winter wish with without woke woman women won wonder wont wood word
words work worked working world worried worry worse worst would wouldnt write writing wrong wrote yeah year years yell yellow yes
yesterday yet you young your youre yours yourself
i'm i've i'll i'd you're you've you'll you'd he's she's it's we're we've we'll they're they've they'll that's what's who's where's
how's there's here's don't doesn't didn't can't won't isn't aren't wasn't weren't haven't hasn't hadn't wouldn't couldn't shouldn't
let's ain't y'all c'mon ma'am o'clock
ive youve youll youd hes theyve weve doesnt didnt cant havent hasnt hadnt arent werent couldnt shouldnt wouldnt yall
gonna wanna gotta kinda sorta dunno lemme gimme gotcha betcha whatcha ya yall yea yeh yep yup nah naw nope ye yee
u ur r ya y'know dont wont thx ty tysm np pls plz idk idc idek tbh tbf ngl imo imho fr frfr rn wyd wbu hbu nm nmu smh ikr iirc fyi
btw brb gtg g2g ttyl lmk jk hmu irl dm dms tl;dr nvm omw bff bf gf bae fam bro bruh bruv dude mate lad lads lass babe hun hon sis
sus cap bet lowkey highkey deadass fosho finna tryna ion ian bout aight ight ard wassup sup wazzup whaddup wsg wyd hbu wbu
lit salty shook stan tea vibe vibes vibing slay slaps bussin mid based cringe rizz gyatt yeet goat goated simp ratio periodt period
bestie besties fr sksksk iykyk pov delulu yikes oof welp meh eh ugh uh uhh um umm hmm hmmm huh hm ooh oops whoa wow yay yikes ew eww
aww awww yo hey heyy hiya howdy hiii hii heya yah woah dang darn heck frick fricking freaking frickin freakin hella mad wicked
innit proper knackered cheers ta bloody gutted chuffed skint quid tenner fiver bare peng wagwan mandem allow bants gaff cheeky nandos
footy pint lads oi blimey cor nowt summat owt reet bairn pet hen doll wee aye ken dinnae cannae och canny howay buzzing gert tidy
arvo heaps reckon servo maccas dinkum keen sweet arvo brekkie barbie bottle-o ute thongs mozzie
grand craic deadly eejit sound feck banjaxed
fixin ope yinz y'all hon sugar honey reckon
anime manga netflix youtube tiktok instagram insta snap snapchat discord twitch spotify google gaming gamer pc laptop wifi
pizza burger fries tacos taco sandwich pasta spaghetti noodles sushi ramen chips crisps cereal coffee tea soda coke beer
bot bots robot ai human humans real fake prove legit sure
fav fave obvs obvi def defo prob probs tho thru cuz coz cos bc becuz bcuz srsly rly realy jus jst sum smth sth smthn sumthin nuthin
nothin somethin doin goin sayin talkin chillin chillen lookin feelin gettin havin makin playin sittin watchin waitin workin
ok okk okie okey oki k kk kay alr alrighty bet sure np
bored random lame sucks suck kidding joking honestly literally basically totally seriously lately recently asap bday hbd congrats
nite tonite luv ppl peeps pic pics vid vids msg txt text texting texted convo apps uni mates cats dogs folks legal male female pro pie
cu em ban mam id freezing cloudy windy snowing stormy storm humid upstairs downstairs couch sofa desk computer tablet screen keyboard
mouse charger battery percent dying alive nap snack snacks takeout takeaway delivery drinking juice milk cookies cookie candy chocolate
rice soup salad steak veggies vegan vegetarian spicy gross yum yummy delicious tasty smells yass yas gn gm ily ilysm wdym wym hru sry
soz cya byee laters peace mornin evenin gday g'day teh jsut wrok waching homwork spagetti hav becuase becasue waht taht thier wierd
definately alot thru thx ty pls plz brb dm app mo sec secs min mins hr hrs
`));

// Universal chat tokens: laughs, emoticon words, interjections everyone uses whatever their language.
export const NEUTRAL = new Set(w(`
lol lolol lool lmao lmfao lmaoo rofl roflmao haha hahaha hahah hah hehe hehehe hihi hihihi xd xdd xddd ok okay okey okei oki omg omfg
wtf wth hm hmm mhm mm ah oh eh uh ahh ohh yay wow emoji gg ez rip afk wifi ig fb yt ha haa ahah bot bots robot robots
`));

// Foreign words every English speaker knows; they say nothing about the language of the line.
export const TOURIST = new Set(w(`
hola gracias adios adiós amigo amiga amigos señor senor señora senora señorita senorita fiesta siesta cerveza tequila burrito nacho
nachos salsa piñata pinata gringo gringa loco loca chica chico vamos ole olé nada mucho muchas
bonjour merci bonsoir madame monsieur mademoiselle oui voila voilà café cafe croissant baguette bon salut touché touche cliché
ciao grazie prego bella bello mamma mia pizza pasta espresso cappuccino latte gelato bravo
danke bitte nein hallo prost kaput wunderbar gesundheit kindergarten wanderlust zeitgeist schadenfreude doppelganger uber über
sayonara arigato konnichiwa kawaii sensei senpai baka desu sushi ramen anime manga namaste aloha mahalo shalom salaam hygge fika
lagom skål skal sisu
`));

// Well-known foreign phrases in English chat, accents stripped; removed before scoring.
export const PHRASES: readonly string[] = [
  "c'est la vie", 'cest la vie', 'je ne sais quoi', 'deja vu', 'bon appetit', 'bon voyage', 'au revoir', 'cafe au lait', 'creme de la creme',
  'creme brulee', 'joie de vivre', "raison d'etre", 'savoir faire', 'tete a tete', 'vis a vis', 'coup de grace', 'faux pas',
  'piece de resistance', 'menage a trois', 'laissez faire', 'fait accompli', 'avant garde', 'nom de plume', 'pas de deux', 'film noir',
  'voulez vous coucher avec moi', 'ooh la la', 'oh la la', 'ooh la la la', 'mon ami', 'mon dieu', 'sacre bleu', "c'est bon", 'tres bien',
  "s'il vous plait", 'sil vous plait', 'merci beaucoup', 'bonne nuit', 'bonne chance', 'a la carte', 'a la mode', 'en route', 'en masse',
  'rendez vous', 'hasta la vista', 'hasta luego', 'hasta manana', 'mi casa es su casa', 'mi casa su casa', 'que sera sera', 'que sera',
  'la vida loca', 'vida loca', 'por favor', 'muchas gracias', 'de nada', 'buenos dias', 'buenas noches', 'buenas tardes', 'feliz navidad',
  'feliz cumpleanos', 'no problemo', 'que pasa', 'hola amigo', 'como estas', 'dos cervezas', 'una cerveza', 'no hablo espanol',
  'yo quiero taco bell', 'ay caramba', 'arriba arriba', 'andale andale', 'el nino', 'el dorado', 'el paso', 'los angeles', 'las vegas',
  'san francisco', 'san diego', 'san antonio', 'santa fe', 'la la land', 'la la la', 'carpe diem', 'mea culpa', 'status quo', 'et cetera',
  'per se', 'ad hoc', 'vice versa', 'de facto', 'bona fide', 'alma mater', 'persona non grata', 'quid pro quo', 'in vino veritas',
  'veni vidi vici', 'e pluribus unum', 'ich bin ein berliner', 'auf wiedersehen', 'guten tag', 'guten morgen', 'gute nacht',
  'danke schoen', 'danke schon', 'wie gehts', 'das ist gut', 'sehr gut', 'mamma mia', 'ciao bella', 'grazie mille', 'bella ciao',
  'molto bene', 'la vie en rose', 'ich liebe dich', "je t'aime", 'te amo', 'ti amo', 'mon amour', 'mon cheri', 'ma cherie', 'amore mio', 'la dolce vita', 'dolce vita', 'hakuna matata', 'hasta la vista baby', 'arigato gozaimasu', 'banzai',
];

/** Per language: its most frequent function words and chat words (ISO 639-1 codes). */
export const LEXICONS: Record<string, Set<string>> = {
  et: new Set(w(`
ma mina minu mu mul mulle minust minuga minul sa sina sinu su sul sulle sinust sinuga sinul ta tema tal talle temaga me meie meil
meile te teie teil teile nad nemad neil neile see seda selle sellest need neid mis mida millest miks kus kust kuhu kes keda kelle
kuidas millal kas kui palju ja ning või voi aga ega et sest siis nagu ka ikka veel juba ainult kõik koik kõike midagi mitte ei jah
jaa jep nojah noh tere terre tsau tšau tervist nägemist nagemist head ööd aitäh aitah tänan tanan palun vabandust olen oled oleme olete
olin olid oli pole polnud olnud saan saad saab saame aru tean tead teab teen teed teeb teha tegin tegid räägi räägid räägin rääkida
raagid ütle ütlesid mõtlen mõtled motled arvan arvad tahan tahad tahab meeldib elad elan elab töötan töötad käin käid lähen lähed
läheb laheb läks tule tulen tuled tuleb sõin sõid soid süüa sööma söön joon magan magad väga vaga hästi hasti halvasti hea halb tore lahe
äge naljakas ilus täna tana homme eile praegu nüüd nuud kohe varsti hiljem alati kunagi tihti siin seal kodus tööl koolis linnas eesti
eestis eestlane keel keelt keeles inglise inimene päris paris sõber sõbrad kass koer ilm külm kulm soe vihma sajab lumi õhtu õhtust
hommik hommikust päev päeva päevast nimi nimeks aastat vana noor pärit parit lemmikloom lemmikloomi lemmik mõnus normaalne vist äkki
tegelt tegelikult muidugi kindlasti võibolla mingi selline niisama lihtsalt igav väsinud näljane kodu töö kool tallinnast tartust tulin tulid tuli koju töölt toimub oota oot mäng mängu mängust
`)),
  fi: new Set(w(`
minä mä mua mun minun minulla mulla minua sinä sä sua sun sinun sinulla sulla sinua hän han sen sitä sita sillä
meidän meillä teidän teillä niiden heidän tämä tama tää tätä tässä tuo toi tota mikä mika mitä mita missä missa mistä mista mihin
miksi miten milloin kuka kenen kuinka paljonko tai mutta mut kun että etta jos koska niin myös myos vielä viela jo vain vaan kaikki
jotain mitään ei en et emme ette eivät eika eikä kyllä kylla joo juu jep moi moikka hei terve morjens moro heippa kiitos kiitti
kiitoksia anteeksi sori olen olet olemme olette ovat oli olin olit oon oot ollaan ollut onko oletko ootko olenko teen teet tekee
tehdä tein teit tiedän tiedät tietää tiiä tiiän tiedä tarkoitat tarkotat tarkoitan ymmärrä ymmärrän ymmärrätkö puhun puhut puhutko
puhua sanoa sanoit haluan haluat tykkään tykkäät asun asut asuu asutko käyn käyt menen menet tulen tulet söin söit syödä syön juon
nukun tosi todella hyvin hyvä hyva hyvää huono kiva kivaa hauska hauskaa tänään tanaan huomenna eilen nyt kohta myöhemmin aina
koskaan usein täällä siellä kotona töissä koulussa suomi suomea suomeksi suomessa englanti englantia kieli kieltä ihminen oikea
oikeesti oikeasti kaveri kissa koira sää kylmä kylma lämmin sataa lunta ilta iltaa aamu huomenta päivää yö nimi nimesi vuotta vanha
nuori kotoisin lemmikkejä lemmikki kuuluu kello paljon vähän ehkä varmaan sitten sit siis jotenkin ihan aika nii niinku botti
`)),
  de: new Set(w(`
ich mich mir mein meine meinen meiner meinem du dich dir dein deine deinen er ihn ihm sein seine sie ihr ihre es wir uns unser unsere
euch euer der die das den dem des ein eine einen einem einer kein keine keinen nicht nichts nix und oder aber doch denn weil wenn dass
daß ob als wie was wer wen wem wo woher wohin wann warum wieso weshalb welche welcher welches ist bin bist sind seid war waren wäre
habe hab hast hat haben hatte hatten wird werden wurde kann kannst können konnte will willst wollen möchte möchtest mag magst muss
musst müssen soll sollst darf mach mache machst macht machen gemacht geht gehts gehen gehe kommst kommt komme kommen gekommen sag
sage sagst sagt sagen weiß weiss weißt weisst wissen glaube glaubst denke denkst verstehe versteh verstehst meinst sprichst spreche
sprechen wohnst wohne wohnt arbeite arbeitest gegessen essen isst esse trinke schlafe heute gestern jetzt gerade grad gleich später
spaeter immer nie oft manchmal schon noch nur auch sehr mal ganz viel viele wenig schlecht toll schön schoen lustig witzig echt
eigentlich wirklich vielleicht natürlich natuerlich klar genau stimmt ja moin servus tschüss tschüs hier dort drüben zu zum zur um mit
von vom bei beim nach aus für fuer über ueber ohne gegen durch bis seit unter zwischen alles etwas jemand niemand leute mensch
menschen wetter kalt regnet arbeit schule hause zuhause deutsch deutschland englisch sprache katze hund freund freundin digga alter
krass geil oida junge achso ach naja halt eben sowas sowieso irgendwie egal bisschen morgen abend nacht guten gute hallo
`)),
  nl: new Set(w(`
ik mij mijn jij je jou jouw uw hij hem zijn zij ze haar het wij ons onze jullie hun hen een en maar want omdat dat die dit deze wat
wie waar wanneer waarom hoe welke hoeveel ben bent was waren heb hebt heeft hebben kan kun kunt kunnen wil wilt willen moet moeten zal
zou ga gaat gaan kom komt komen doe doet doen gedaan zeg zegt zeggen weet weten denk denkt begrijp snap bedoel bedoelt praat spreek
spreekt woon woont werk werkt gegeten eten eet drink slaap niet geen niks niets wel ook nog al alleen heel erg veel weinig goed slecht
leuk mooi grappig echt eigenlijk misschien natuurlijk gewoon toch even nu vandaag morgen gisteren straks altijd nooit vaak hier daar
thuis school met van voor naar bij uit aan om tot zonder door tegen na ja nee hoi doei dag dankjewel bedankt alsjeblieft lekker
gezellig nederlands engels taal mensen kat hond weer koud regent zo ook jongen meisje vriend vriendin werken wonen
`)),
  sv: new Set(w(`
jag mig mej min mitt mina ifrån därifrån du dig dej din ditt dina han honom hans hon henne hennes den det vi oss vår ni er de dem dom deras en ett och
eller men för att som om när var vad vem varför hur vilken vilket är varit vara har hade haft ha kan kunde vill ville ska skulle måste
får gör gjorde göra går gick gå kommer kom säger sa vet visste tror tycker förstår menar pratar talar bor jobbar arbetar åt äta äter
dricker sover inte ingen inget inga aldrig alltid också bara redan fortfarande nu idag imorgon igår sen sedan här där hemma jobbet
skolan med på av till från ut upp över under mycket lite bra dålig kul roligt fin snygg faktiskt kanske typ liksom ju väl nog hej
hejsan tjena tack tjo ja nej jo svenska engelska språk folk katt hund vädret kallt varmt regnar
`)),
  da: new Set(w(`
jeg mig min mit mine du dig din dit dine han ham hans hun hende hendes den det vi os vores jer jeres de dem deres en et og eller men
for at som om når hvad hvem hvor hvorfor hvordan hvilken er var været være har havde haft have kan kunne vil ville skal skulle må får
gør gjorde gøre går gik gå kommer kom siger sagde ved vidste tror synes forstår mener snakker taler bor arbejder spiste spise spiser
drikker sover ikke ingen intet aldrig altid også bare allerede stadig nu idag imorgen igår senere her der hjemme arbejde skole med
på af til fra ud op over under meget lidt godt dårlig sjovt fint faktisk måske ligesom jo vel nok hej hejsa tak ja nej dansk engelsk
sprog folk kat hund vejret koldt varmt regner
`)),
  no: new Set(w(`
jeg meg min mitt mine du deg din ditt dine han ham hans hun henne hennes den det vi oss vår dere de dem deres en et ei og eller men
for at som om når hva hvem hvor hvorfor hvordan hvilken er var vært være har hadde hatt ha kan kunne vil ville skal skulle må får
gjør gjorde gjøre går gikk gå kommer kom sier sa vet visste tror synes forstår mener snakker bor jobber spiste spise spiser drikker
sover ikke ingen ingenting aldri alltid også bare allerede fortsatt nå idag imorgen igår senere her der hjemme jobb skole med på
av til fra ut opp over under mye litt bra dårlig gøy morsomt fint faktisk kanskje liksom jo vel nok hei hallo takk ja nei norsk
engelsk språk folk katt hund været kaldt varmt regner
`)),
  fr: new Set(w(`
je j' moi tu t' te toi il elle nous vous ils elles lui leur eux le la les l' un une des du de d' au aux et ou où mais donc car ni que
qu' qui quoi quand comment pourquoi combien quel quelle quels ce c' cet cette ces ça ca cela mon ma mes ton ta tes sa ses notre nos
votre vos leurs est es suis sommes êtes sont étais était été ai as avons avez ont avais avait eu fais fait faire faites vais vas va
allons allez vont aller veux veut voulez peux peut pouvez sais sait savez dois doit crois pense penses comprends comprend parle parles
parler mange manges mangé manger bois dors habite habites viens vient venir dit dis dire vois voir aime aimes ne n' pas rien jamais
personne très tres bien mal bonne mauvais beau belle aussi alors encore déjà toujours souvent parfois maintenant aujourd'hui aujourd
demain hier ici là avec pour sans dans sur sous chez vers entre après avant depuis pendant tout tous toute toutes quelque chose gens
temps froid chaud faim travail école maison chien ami amie copain copine mec meuf frère wesh ouais ouai non coucou mdr ptdr jsp jpp
stp svp slt cc cv tkt bcp beaucoup trop vraiment genre grave chelou bah ben bref hein euh heure heures français francais anglais
langue d'où j'ai c'est t'es j'suis chuis n'est s'il
`)),
  es: new Set(w(`
yo mi mí mis conmigo tú tu te ti tus contigo él ella ello usted nosotros nosotras vosotros ellos ellas ustedes le les lo los la las
el un una unos unas del al de y pero porque por para sin sobre entre hasta desde en que qué quien quién cual cuál cuando cuándo
donde dónde como cómo cuanto cuánto porqué este esta esto estos estas ese esa eso aquel aquí aqui ahí alli allí acá allá es eres soy
somos era fue fui ser estar estoy estás está estamos están estaba tengo tienes tiene tenemos tienen tener hay hace hago haces hacer
hecho voy vas va van ir quiero quieres quiere puedo puedes puede sé sabes sabe saber creo crees pienso entiendo entiendes hablo
hablas habla hablar vivo vives vive trabajo trabajas comes comiste comí comer bebo duermo dime dices decir digo veo ves ver mucha
muchos poco muy más mas menos bien mal bueno buena buenos malo todo todos algo alguien nadie siempre nunca también tampoco todavía
aún ahora hoy mañana ayer luego después antes entonces pues claro vale oye mira verdad sí si jaja jajaja jajajaja jeje wey güey neta
chido onda chévere bacano parce boludo che tío tía guay mola perro gato calor frío hambre sueño casa escuela español inglés idioma
gente tiempo hora día noche tarde haciendo comido estado real gracioso divertido aburrido cansado cansada lindo linda bonito genial
increíble raro rara feo fea simpático contento feliz triste chistoso
`)),
  pt: new Set(w(`
eu mim meu minha meus minhas você voce vc vcs tu te ti teu tua ele ela nós nos vocês eles elas os um uma uns umas do da dos das na nas
ao à de em para pra por pelo pela com sem sobre entre até e ou mas porque porquê que quê quem qual quando onde como quanto isso isto
esse essa este esta aquele aqui aí ali lá é sou és somos são era foi ser estar estou está estás estamos estão tava tô tenho tem tens
temos têm ter faz faço fazer fazendo vou vai vamos vão ir quero quer posso pode sei sabe acho entendi entendo falo fala falar moro mora
trabalho comi comeu comer muito muita pouco mais menos bem mal bom boa tudo todos algo alguém ninguém sempre nunca também já ainda agora
hoje amanhã ontem depois antes então né tipo cara mano beleza legal valeu obrigado obrigada oi olá tchau kkk kkkk kkkkk kkkkkk rs
rsrs sim não nao gente coisa tempo hora dia noite tarde calor frio fome casa escola português portugues inglês pessoa
`)),
  it: new Set(w(`
io mi mio mia miei mie tu ti te tuo tua lui lei noi ci voi vi loro il lo la gli le un uno una del dello della dei degli delle al allo
alla ai agli alle dal nel nella sul sulla di con su per tra fra e ed o ma perché perche che chi cosa quale quando dove quanto questo
questa quello quella qui qua lì là è sono sei siamo siete ero era essere sto stai sta stiamo stanno stare ho hai ha abbiamo avete
hanno avere faccio fai fa facciamo fare fatto vado vai andiamo andare voglio vuoi vuole posso puoi può so sai sa penso credo capisco
capito parlo parli parlare abito abiti vivo lavoro mangiato mangiare mangio bevo dormo dico dici dire molto tanto poco più piu meno
bene male buono buona tutto tutti niente nulla qualcosa qualcuno nessuno sempre mai anche già ancora adesso ora oggi domani ieri dopo
prima allora quindi però comunque magari boh beh dai vabbè vabbe cioè sì si non ahah ahahah ahahaha gente giorno notte sera caldo
freddo fame casa scuola italiano inglese facendo
`)),
  pl: new Set(w(`
ja mnie skąd mój moja moje ty ciebie cię ci twój twoja on go mu jego ona jej ją ono my nas nam nasz wy was wasz oni one ich się sie ten ta te
tego tej jest są jestem jesteś jestes jesteśmy był była było być mam masz ma mamy mają mieć robisz robię robi robić idę idziesz iść
chcę chce chcesz mogę możesz wiem wiesz myślę rozumiem rozumiesz mówię mówisz mieszkam mieszkasz pracuję jadłem jadłam jadłeś jeść
albo lub ale bo że ze czy jak co kto gdzie kiedy dlaczego czemu ile który która nie tak też tez tylko już juz jeszcze teraz dzisiaj dziś
jutro wczoraj potem zawsze nigdy często tutaj tu tam na do od po przez dla bez przy za pod nad bardzo dużo mało dobrze źle dobry
fajnie fajny spoko serio chyba może pewnie właśnie wlasnie naprawdę cześć czesc siema elo dzięki dzieki proszę prosze polski polsku
angielski ludzie kot pies pogoda zimno ciepło pada
`)),
  cs: new Set(w(`
já mě můj moje ty tě ti tvůj tvoje on ho mu jeho ona ji jí její my nás nám náš vy vás váš oni ony jejich se si ten ta je jsou jsem jsi
jsme jste byl byla bylo být mám máš má máme mají mít děláš dělám dělá dělat jdu jdeš jít chci chceš můžu můžeš vím víš myslím
rozumím rozumíš mluvím mluvíš bydlím bydlíš pracuju jedl jedla jíst nebo ale protože že jestli jak co kdo kde kdy proč kolik který
která ne ano jo taky také jen jenom už ještě teď dneska dnes zítra včera potom pak vždycky nikdy často tady tam na do od po pro bez
při za pod nad moc hodně málo dobře špatně dobrý fajn asi možná prostě fakt opravdu ahoj čau cau díky diky děkuju prosím česky
anglicky lidi kočka pes počasí zima teplo prší
`)),
  ro: new Set(w(`
eu mie mi mine meu mea mei tu ție îți tău el ea lui ei noi ne nostru voi vă vostru ele lor se își este sunt ești esti suntem sunteți
era fost fi ai are avem aveți avea fac faci face facem fă merg mergi vreau vrei pot poți știu stiu știi cred înțeleg inteleg vorbesc
vorbești locuiesc lucrez mâncat mancat mânca și sau dar pentru că dacă daca cum ce cine unde când cand cât care nu ba tot toți doar
deja încă inca acum azi astăzi mâine maine ieri apoi mereu niciodată aici acolo în cu de din pe fără despre între foarte mult puțin
bine rău bun bună buna frumos mișto fain chiar poate sigur servus mersi mulțumesc multumesc română romana engleză oameni pisică câine
vremea frig cald plouă
`)),
  hu: new Set(w(`
én engem nekem enyém te téged neked ő őt neki mi minket nekünk ti titeket nektek ők őket nekik az egy és vagy de mert hogy ha mint nem
igen ne sem mit ki kit hol honnan hova mikor miért hogyan mennyi melyik van vagyok vagyunk vagytok vannak volt voltam lesz nincs
csinálsz csinálok csinál megyek mész akarok akarsz tudok tudsz tudom tudod szerintem értem érted beszélek beszélsz lakom laksz
dolgozom ettem ettél enni eszem iszom alszom nagyon sok kevés jó rossz szép vicces tényleg talán persze csak már még most ma holnap
tegnap aztán mindig soha gyakran itt ott otthon szia sziasztok helló köszi köszönöm kösz kérlek szívesen magyar magyarul angol angolul
emberek macska kutya idő hideg meleg esik
`)),
  tr: new Set(w(`
ben beni bana benim sen seni sana senin onu ona onun biz bizi bize bizim siz sizi size sizin onlar onları bu şu bunu şunu bir ve veya
ama fakat çünkü ki eğer gibi için ile mi mı mu mü ne neden niye nasıl nerede nereden nereye kim kimin kaç hangi var yok evet hayır
değil degil değilim misin mısın musun nasılsın nasilsin iyiyim iyi kötü güzel çok cok az biraz şimdi simdi bugün bugun yarın dün sonra
önce hiç burada orada evde işte okulda yapıyorsun yapıyorum yapıyor gidiyorum istiyorum biliyorum bilmiyorum anlamadım anlamıyorum
konuşuyorum yaşıyorum çalışıyorum yedim yedin yemek içiyorum uyuyorum merhaba selam teşekkürler tesekkurler sağol sagol lütfen tamam
abi kanka lan türkçe türk ingilizce insanlar kedi köpek hava soğuk sıcak yağmur
`)),
  lv: new Set(w(`
es mani man mans mana tu tevi tev tavs tava viņš viņu viņam viņa viņai mēs mūs mums mūsu jūs jums jūsu viņi viņas viņiem tas tā tie
šis šī un vai bet jo ka ja kā kas ko kur kad kāpēc cik kurš kura ir esmu esi esam esat bija biju būt dari daru dara darīt eju ej iet
gribu gribi varu vari zinu zini domāju saprotu saproti nesaprotu runāju runā dzīvoju dzīvo strādāju ēdu ēdi ēst dzeru guļu ne nē jā
arī tikai jau vēl tagad šodien rīt vakar vienmēr nekad bieži šeit tur mājās darbā skolā ar no uz pie par bez līdz ļoti daudz maz labi
slikti labs jauks tiešām varbūt protams sveiks sveika čau paldies lūdzu latviski latviešu angliski cilvēki kaķis suns laiks auksts
silts līst
`)),
  lt: new Set(w(`
aš mane man mano tu tave tau tavo jis jį jam jo ji ją jai jos mes mus mums mūsų jūs jus jums jūsų jie juos jiems jų tas ta tai šis ši
ir ar arba bet nes kad jei jeigu kaip kas ką kur kada kodėl kiek kuris kuri yra esu esi esame esate buvo buvau būti turiu turi darai
darau daro daryti einu eini eiti noriu nori galiu gali žinau žinai manau suprantu supranti nesuprantu kalbu kalbi gyvenu gyveni dirbu
valgiau valgei valgyti geriu miegu ne taip nėra irgi tik jau dar dabar šiandien rytoj vakar paskui visada niekada dažnai čia ten
namie darbe su iš į prie apie be iki labai daug mažai gerai blogai geras gražus tikrai gal galbūt žinoma labas sveikas sveika ačiū aciu
prašau lietuviškai lietuvių angliškai žmonės katė šuo oras šalta šilta lyja
`)),
  id: new Set(w(`
aku saya gue gw kamu kau lu anda dia kita kami mereka ini itu yang dan atau tapi tetapi karena kerana kalau jika seperti dengan untuk
dari di ke pada apa siapa mana kapan bila kenapa mengapa bagaimana gimana berapa ada tidak tak nggak gak ga enggak bukan iya sudah
udah belum akan mau bisa boleh harus lagi sedang juga saja aja hanya cuma sangat banget sekali sekarang hari besok kemarin nanti
selalu pernah sini sana rumah kerja sekolah makan minum tidur tinggal bekerja bicara ngomong tahu tau paham mengerti ngerti baik bagus
jelek enak lucu benar betul mungkin tentu halo selamat pagi siang malam terima kasih makasih tolong wkwk wkwkwk bahasa inggris
indonesia melayu orang kucing anjing cuaca dingin panas hujan lah kah dong sih deh kok nih tuh
`)),
  tl: new Set(w(`
ako ko akin ikaw ka mo iyo siya niya kanya tayo kami natin namin kayo ninyo sila nila kanila ito iyan iyon yan yun dito diyan doon
ang ng nang mga sa si ni kay at pero kasi dahil kung para na pa lang din rin naman po opo oo hindi wala may mayroon meron ano sino saan
kailan bakit paano gaano ilan alin kumain kain kumusta kamusta salamat ingat sige talaga grabe sana ayaw gusto kaya alam nakakatawa
maganda pangit masarap mabuti ngayon bukas kahapon mamaya lagi palagi bahay trabaho eskwela paaralan tagalog ingles tao pusa aso
panahon malamig mainit ulan
`)),
  vi: new Set(w(`
tôi mình bạn anh chị em nó chúng họ này đó kia là và hoặc nhưng vì nếu như với cho của từ ở đến trong ngoài gì ai đâu sao nào có
không khong chưa đã sẽ đang muốn được phải cũng chỉ rất lắm quá bây giờ hôm nay ngày mai qua sau trước luôn bao đây nhà làm việc trường
ăn uống ngủ sống nói biết hiểu tốt xấu ngon vui thật chắc xin chào cảm ơn cám vâng dạ ừ tiếng việt
`)),
};

/** Letters that point at a language: strong ones almost prove it, typical ones lean toward it. */
export const LETTERS: Record<string, { strong?: string; typical?: string }> = {
  et: { strong: 'õ', typical: 'äöüšž' },
  fi: { typical: 'äö' },
  de: { strong: 'ß', typical: 'äöü' },
  nl: { typical: 'ëï' },
  sv: { typical: 'åäö' },
  da: { strong: 'æø', typical: 'å' },
  no: { strong: 'æø', typical: 'å' },
  fr: { strong: 'œ', typical: 'àâçèéêëîïôùûÿ' },
  es: { strong: 'ñ¿¡', typical: 'áéíóú' },
  pt: { strong: 'ãõ', typical: 'çáéíóúâêôà' },
  it: { typical: 'àèéìòù' },
  pl: { strong: 'łąęśźżń', typical: 'óć' },
  cs: { strong: 'řůě', typical: 'čďňšťýžáéíóú' },
  ro: { strong: 'șțşţ', typical: 'ăâî' },
  hu: { strong: 'őű', typical: 'áéíóöúü' },
  tr: { strong: 'ğış', typical: 'çöü' },
  lv: { strong: 'āēīūģķļņ', typical: 'čšž' },
  lt: { strong: 'ėįų', typical: 'ąčęšūž' },
  vi: { strong: 'ơưđạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ', typical: 'ăâêô' },
};
