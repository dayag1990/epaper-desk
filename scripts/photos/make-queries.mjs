// Generates queries.json (the exact list of Commons searches run). Run once; queries.json is committed.
import fs from "node:fs";
const Q = [];
const add = (sections, tags, ...qs) => qs.forEach((q) => Q.push({ q, sections, tags }));
// Tamil Nadu
add(["front","tamil-nadu"],["temple","gopuram"],"gopuram Tamil Nadu temple","Meenakshi Temple Madurai gopuram","Brihadisvara Temple Thanjavur","Ramanathaswamy temple Rameswaram corridor","Shore Temple Mahabalipuram","Srirangam Ranganathaswamy temple gopuram","Kanchipuram temple Ekambareswarar","Chidambaram Nataraja temple gopuram","Gangaikonda Cholapuram temple","Airavatesvara temple Darbasuram");
add(["tamil-nadu","india"],["paddy","agriculture"],"paddy field Tamil Nadu","rice fields Thanjavur","Cauvery delta farming","sugarcane harvest Tamil Nadu","coconut grove Tamil Nadu","banana plantation Tamil Nadu");
add(["tamil-nadu","front"],["coast","beach"],"Kanyakumari sunrise sea","Vivekananda Rock Memorial Kanyakumari","Dhanushkodi beach","Pamban bridge Rameswaram","Tiruchendur coast temple","Mahabalipuram beach","Tamil Nadu fishing boats coast");
add(["tamil-nadu","front"],["hills","western-ghats"],"Western Ghats Tamil Nadu hills","Pothigai hills Tirunelveli","Courtallam waterfalls","Hogenakkal Falls Cauvery","Kodaikanal lake hills","Yercaud hills","Megamalai Theni hills","Valparai tea hills");
add(["tamil-nadu","front"],["river","cauvery"],"Cauvery river Tamil Nadu","Mettur Dam","Grand Anicut Kallanai","Bhavani river","Vaigai river Madurai","Thamirabarani river");
add(["tamil-nadu"],["market","rural"],"village market Tamil Nadu","vegetable market Madurai","flower market Tamil Nadu jasmine","weekly market Tamil Nadu","Koyambedu market","Pazhamudhir vegetable stall Tamil Nadu");
add(["tamil-nadu","business"],["handloom","textile"],"handloom weaving Kanchipuram silk","Tamil Nadu handloom weavers loom","Kanchipuram silk saree shop","Karur textile","Tiruppur garment factory","spinning mill Coimbatore");
add(["tamil-nadu","front"],["tea","nilgiris"],"Nilgiris tea garden","Ooty tea plantation","Coonoor tea estate","Nilgiri Mountain Railway","Ooty lake","Doddabetta Nilgiris");
add(["tamil-nadu","front"],["pongal","kolam","festival"],"Pongal festival Tamil Nadu","kolam rangoli Tamil Nadu","Pongal pot rice festival","kolam street Chennai","Tamil Nadu temple festival chariot","Thaipusam Tamil festival","Karthigai Deepam Tiruvannamalai","Pongal sugarcane decoration");
add(["tamil-nadu","business"],["salt","industry"],"salt pans Thoothukudi","Thoothukudi port","Sivakasi fireworks factory","Hosur industrial","Tamil Nadu windmills Muppandal");
add(["tamil-nadu"],["fort","architecture"],"Thirumalai Nayak Palace Madurai","Gingee Fort","Vellore Fort","Rock Fort Tiruchirappalli","Padmanabhapuram palace","Chettinad mansion","Tanjore Palace","Vattakottai Fort");
add(["tamil-nadu"],["wildlife","nature"],"Mudumalai tiger reserve","Pichavaram mangrove","Point Calimere sanctuary","Vedanthangal bird sanctuary","Nilgiri tahr");
add(["tamil-nadu","india"],["pottery","craft"],"pottery Tamil Nadu","Thanjavur doll","bronze casting Swamimalai","Tamil Nadu temple elephant");
// Chennai
add(["chennai","front"],["marina","beach"],"Marina Beach Chennai","Marina Beach Chennai evening","Chennai beach fishermen","Elliot's Beach Besant Nagar","Chennai lighthouse Marina");
add(["chennai","front"],["skyline","city"],"Chennai skyline","Chennai aerial view","Chennai Central railway station","Chennai Egmore railway station","Chennai Ripon Building","Chennai High Court building","Fort St. George Chennai","Chennai Senate House University of Madras","Chennai Anna Salai","Chennai Mount Road","Chennai Lighthouse");
add(["chennai","india"],["train","suburban"],"Chennai suburban railway EMU","Chennai Beach railway station","Chennai Mass Rapid Transit Railway","Chennai MRTS train","Chennai Central platform train","Southern Railway Chennai locomotive");
add(["chennai","business"],["metro"],"Chennai Metro train","Chennai Metro station","Chennai Metro elevated","Chennai Metro Rail construction");
add(["chennai"],["monsoon","flood"],"Chennai monsoon rain street","Chennai floods street","Chennai rain","Chennai flooded road");
add(["chennai","business"],["auto-rickshaw","traffic"],"auto rickshaw Chennai","Chennai traffic road","Chennai bus MTC","Chennai Koyambedu bus terminus","Chennai autorickshaws street");
add(["chennai","business"],["market","retail"],"T. Nagar Chennai shopping","Ranganathan Street T Nagar","Chennai market stalls","Pondy Bazaar Chennai","Mylapore market","Chennai vegetable market","Parry's Corner Chennai");
add(["chennai","tamil-nadu"],["temple","architecture"],"Kapaleeshwarar Temple Mylapore","Kapaleeshwarar temple tank Mylapore","Parthasarathy temple Triplicane","Santhome Basilica Chennai","Chennai Government Museum","Chennai Valluvar Kottam","Chennai Egmore museum","Madras High Court");
add(["chennai","business"],["it-park","office"],"Chennai Tidel Park","Chennai OMR IT corridor","Chennai Ambattur industrial estate","Chennai skyscraper","Chennai Nandambakkam trade centre");
add(["chennai","business"],["port","harbour"],"Chennai Port","Ennore port","Chennai harbour ships","Kattupalli port");
add(["chennai","india","world"],["airport"],"Chennai International Airport","Chennai airport terminal","Chennai airport aircraft");
add(["chennai"],["nature","urban"],"Guindy National Park","Adyar river Chennai","Pulicat lake","Chennai Theosophical Society banyan","Chennai Marina Beach sunrise");
// India
add(["india","front"],["parliament"],"Sansad Bhavan Parliament of India","Parliament House New Delhi","New Parliament Building India","India Gate New Delhi","Rashtrapati Bhavan","Supreme Court of India building");
add(["india"],["train","railway"],"Indian Railways train","Vande Bharat Express","Indian Railways locomotive","Indian railway station platform","Howrah railway station","Mumbai CST","Rajdhani Express","Indian railway freight train");
add(["india","world"],["highway","road"],"National Highway India","Mumbai Pune Expressway","Bandra Worli Sea Link","highway India truck","Yamuna Expressway");
add(["india","front"],["monsoon","agriculture"],"monsoon clouds India","monsoon rain India","farmers field India","wheat harvest India","tractor India farm","irrigation canal India","Indian farmers harvesting");
add(["india","world","business"],["airport","aviation"],"Indira Gandhi International Airport terminal","Mumbai airport terminal","Bengaluru Kempegowda airport","Indian airport aircraft","Hyderabad airport");
add(["india","front"],["space","launch"],"Sriharikota launch pad","ISRO PSLV launch","Satish Dhawan Space Centre","GSLV rocket","Chandrayaan launch","ISRO rocket");
add(["india","business"],["solar","energy"],"solar farm India","Bhadla Solar Park","Kamuthi solar power project Tamil Nadu","wind farm India","Kudankulam nuclear power plant","thermal power plant India");
add(["india","front"],["architecture","monument"],"Taj Mahal","Red Fort Delhi","Gateway of India Mumbai","Victoria Memorial Kolkata","Hawa Mahal Jaipur","Qutub Minar","Lotus Temple Delhi","Golden Temple Amritsar","Charminar Hyderabad","Mysore Palace");
add(["india","front"],["nature"],"Himalaya India","Ganges river Varanasi ghats","Kerala backwaters","Thar desert Rajasthan","Western Ghats monsoon waterfall");
add(["india","business"],["city"],"Mumbai skyline","Bangalore skyline","Delhi skyline","Hyderabad Hi-Tech City","Kolkata Howrah Bridge","Mumbai Marine Drive");
// World
add(["world","front"],["city","skyline"],"New York City skyline","London skyline Thames","Tokyo skyline","Paris skyline","Singapore skyline","Dubai skyline","Sydney Opera House harbour","Hong Kong skyline","Shanghai Pudong skyline","Toronto skyline","Istanbul skyline","Cape Town Table Mountain");
add(["world","business"],["port","ship"],"Port of Rotterdam","Port of Singapore containers","Port of Hamburg","Shanghai port containers","Los Angeles port containers","Suez Canal ship","Panama Canal ship");
add(["world","india"],["airport","aviation"],"Dubai International Airport","Heathrow Airport terminal","Changi Airport","Frankfurt airport aircraft","Airbus A380 airport","Boeing 787 airport");
add(["world","front"],["summit","building"],"United Nations Headquarters New York","European Parliament Strasbourg","Palace of Nations Geneva","Reichstag building Berlin","Capitol Washington","Houses of Parliament Westminster","White House Washington","ASEAN secretariat building","Kremlin Moscow","Great Hall of the People Beijing");
add(["world","front"],["weather","storm"],"hurricane satellite image","thunderstorm lightning","tornado","snowstorm city","flood river","drought cracked earth","wildfire smoke","cyclone satellite Bay of Bengal","heat haze desert","rainbow storm clouds");
add(["world"],["flag"],"flag of India waving","flag of Tamil Nadu","flags United Nations headquarters");
add(["world","business"],["industry"],"oil refinery","wind turbines offshore","container ship at sea","space shuttle launch","International Space Station","Falcon 9 launch");
// Business
add(["business","india"],["port","container"],"container port cranes","Jawaharlal Nehru Port","Mundra Port","Visakhapatnam port","container terminal gantry crane","container stack port");
add(["business"],["factory"],"factory floor assembly line","automobile assembly plant","steel plant","textile factory machines","automobile factory India","car factory robots","Hyundai Chennai plant","Royal Enfield","machine shop lathe");
add(["business","chennai"],["it-park"],"IT park India building","Infosys campus","Hinjewadi IT park","Technopark Trivandrum","Bangalore Electronic City","Cyberabad Hyderabad IT","Manyata Tech Park","Mindspace");
add(["business"],["retail"],"shopping mall interior India","supermarket aisle","street market India retail","shopping street India","bazaar India","jewellery shop India","bookstore India");
add(["business","tamil-nadu","india"],["tractor","agri"],"tractor ploughing field","combine harvester India","Mahindra tractor","tractor paddy field","sugarcane farm machinery");
add(["business","tamil-nadu"],["textile","mill"],"textile mill India","cotton spinning machines","cotton field India","weaving loom power loom","saree weaving loom","dyeing yarn India","silk weaving India");
add(["business","world"],["ship","shipyard"],"cargo ship","bulk carrier","oil tanker","shipyard","ferry boat India","fishing harbour India","Cochin Shipyard","Chennai harbour fishing");
add(["business","india"],["bank","stock"],"Reserve Bank of India building","Bombay Stock Exchange building","National Stock Exchange Mumbai","currency notes rupee","gold market India","ATM India");
// Sport
add(["sport"],["cricket","stadium"],"M. A. Chidambaram Stadium Chepauk","Chepauk stadium cricket match","Eden Gardens cricket stadium","Wankhede Stadium","Narendra Modi Stadium Ahmedabad","cricket ground India match","Lord's Cricket Ground","Melbourne Cricket Ground","cricket stumps pitch","cricket bat ball","Chinnaswamy Stadium","Feroz Shah Kotla stadium","cricket match crowd stadium");
add(["sport"],["football","pitch"],"football pitch stadium","football stadium Kolkata Salt Lake","football match stadium crowd","Jawaharlal Nehru Stadium Chennai football","football goal net","football stadium aerial");
add(["sport"],["kabaddi"],"kabaddi mat","kabaddi match India","Pro Kabaddi League","kabaddi tournament Tamil Nadu","kabaddi players India");
add(["sport"],["hockey"],"field hockey pitch","hockey stadium Chennai Mayor Radhakrishnan","Odisha hockey stadium Kalinga","field hockey match","hockey turf stadium");
add(["sport"],["athletics"],"athletics track stadium","running track stadium","athletics meet stadium India","Nehru stadium athletics","stadium running track aerial","track and field stadium");
add(["sport"],["badminton"],"badminton hall court","badminton court indoor","badminton tournament hall","shuttlecock racket");
add(["sport"],["chess"],"chess board pieces","chess tournament hall","Chess Olympiad Mahabalipuram","chess pieces closeup","chess set wooden");
add(["sport","tamil-nadu"],["sport","other"],"swimming pool stadium","tennis court Chennai","carrom board","Chennai Open tennis stadium","volleyball beach","basketball court","boat race","marathon runners crowd");
// Cinema
add(["cinema"],["theatre","exterior"],"cinema hall India exterior","movie theatre exterior India","single screen theatre India","Sathyam Cinemas Chennai","Devi Theatre Chennai","Kodambakkam","Tamil cinema theatre","cinema hall Madurai","cinema multiplex exterior","Rex theatre");
add(["cinema"],["camera","film"],"film camera 35mm","movie camera vintage","Arriflex camera","cine camera","film set lighting","film reel projector","film production equipment","motion picture camera crane");
add(["cinema"],["clapperboard"],"clapperboard","clapper board film","film slate");
add(["cinema"],["interior","auditorium"],"cinema auditorium seats empty","movie theatre interior seats","theatre auditorium empty seats","old cinema interior","drive-in movie theatre");
add(["cinema"],["projector"],"film projector cinema","35mm projector","cinema projection booth","movie projector");
add(["cinema"],["studio","recording"],"recording studio mixing console","sound recording studio","film studio Chennai AVM","Vijaya Vauhini studios","film city studio","soundstage","microphone recording booth","editing suite film");
const seen = new Set();
const out = Q.filter((x) => (seen.has(x.q) ? false : (seen.add(x.q), true)));
fs.writeFileSync(new URL("./queries.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(out.length, "queries");
