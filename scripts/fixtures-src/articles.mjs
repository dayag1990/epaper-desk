// Original stand-in articles for the fictional town of Riverton. All text written for this repo.
const p = (text) => ({ t: 'p', text });
const h = (text) => ({ t: 'h', text });
const q = (text) => ({ t: 'quote', text });

export const articles = [
{
 slug: 'council-approves-bridge-repairs', section: 'news', tags: ['council', 'infrastructure'], priority: 90,
 kicker: 'Council', headline: 'Council votes to repair Old Mill Bridge rather than replace it',
 subhead: 'A narrow 5-4 decision keeps the 1911 crossing open to pedestrians and buses.',
 byline: 'By Hannah Oakes', dateline: 'Riverton, 3 Nov', published: '2026-11-03T09:10:00+00:00',
 image: { kind: 'bridge', caption: 'Old Mill Bridge, seen from the east bank of the Wren.', credit: 'Riverton Herald illustration' },
 body: [
  p('Riverton council voted 5-4 on Monday night to spend £3.2 million repairing Old Mill Bridge instead of building a new crossing, ending a debate that has divided the town for almost two years.'),
  p('The 1911 stone-and-iron bridge carries about 9,000 pedestrians and cyclists a day, along with the number 4 and number 11 buses. Engineers told councillors last spring that the central pier had lost nearly a fifth of its bearing capacity to scour, the slow erosion of riverbed material around its base.'),
  h('What the repair involves'),
  p('The work will drive new steel piles beside the central pier, replace the corroded deck beams on the western span and re-point the masonry arches. A weight limit of 7.5 tonnes will stay in place permanently, which means heavy lorries must continue to use the ring road.'),
  q('This is the cheaper option, but it is not the cheap option. We are paying to keep something the town loves.'),
  p('Councillor Maria Delaney, who proposed the repair plan, said the decision protected a landmark and avoided the disruption of building a new bridge on the neighbouring Tanners Quay site. Opponents argued that patching an old structure would only postpone a larger bill.'),
  p('Construction is expected to begin in March and take fourteen months. The bridge will close to buses for six of those months; a temporary footbridge will keep the riverside path open throughout.'),
  h('Reaction'),
  p('Traders on Mill Street welcomed the vote. Several said they had feared a long closure would divert shoppers to the retail park on the edge of town. The Riverton Cycling Club said it was pleased the heritage crossing would survive but asked the council to widen the shared path during the works.'),
  p('The council will publish the tender documents in January. Local firms are expected to bid, and the council has said it will weight bids that commit to using apprentices from Riverton College.')
 ]},
{
 slug: 'flood-barrier-test-succeeds', section: 'news', tags: ['environment', 'flood'], priority: 75,
 kicker: 'Environment', headline: 'Flood barrier passes first full test on the Wren',
 subhead: 'The new demountable wall held back a simulated surge for six hours.',
 byline: 'By Tom Ashworth', dateline: 'Riverton, 5 Nov', published: '2026-11-05T14:00:00+00:00',
 image: { kind: 'water', caption: 'Engineers check the barrier panels along Quay Road.', credit: 'Riverton Herald illustration' },
 body: [
  p('Riverton\'s new demountable flood barrier held back a simulated surge for six hours on Wednesday, passing the first full-scale test since it was installed along Quay Road this summer.'),
  p('Environment Agency staff and volunteers bolted 140 aluminium panels into place in under ninety minutes. Pumps then raised the water behind the wall to 1.8 metres, a level last seen in the floods of 2019.'),
  p('Project manager Priya Nair said no leaks were detected at the joints, and the seepage rate measured at the base was well below the design limit. The barrier will be tested again in January with the river running at its normal winter flow.')
  ,p('Residents on Quay Road, who were evacuated twice in the last decade, watched from the pavement. Several said the quiet was the most striking thing: no sandbags, no lorries, just the sound of pumps.')
 ]},
{
 slug: 'library-extends-opening-hours', section: 'city', tags: ['library', 'community'], priority: 55,
 kicker: 'Community', headline: 'Central Library to open on Sundays from December',
 subhead: 'Volunteers and a new grant make seven-day service possible for the first time in a decade.',
 byline: 'By Grace Linton', dateline: 'Riverton, 6 Nov', published: '2026-11-06T08:30:00+00:00',
 image: { kind: 'books', caption: 'The reading room at Central Library.', credit: 'Riverton Herald illustration' },
 body: [
  p('Riverton Central Library will open on Sundays from the first weekend of December, ending a decade in which the building was closed for one day in every seven.'),
  p('The extra hours, from 11am to 4pm, are funded by a £48,000 community grant and staffed by a rota of 60 trained volunteers working alongside two paid librarians. Library manager Joseph Adeyemi said the first Sundays would focus on the children\'s floor and the computer suite, which are the most requested services.'),
  p('The library recorded 212,000 visits last year, up 9 per cent. Adeyemi said surveys of users showed that people who work weekdays were the most frustrated by the old timetable.'),
  q('Half the people we asked said they simply could not come on a weekday. Sunday gives them a way in.'),
  p('The trial will run until June. If visits meet the target of 150 a day, the council has indicated it will look for money to make the arrangement permanent.')
 ]},
{
 slug: 'night-market-returns', section: 'city', tags: ['market', 'events'], priority: 50,
 kicker: 'What\'s on', headline: 'Friday night market returns to Tanners Quay',
 subhead: 'Sixty stalls, live music and a hot-chocolate trail promised for the winter season.',
 byline: 'By Grace Linton', dateline: 'Riverton, 7 Nov', published: '2026-11-07T10:00:00+00:00',
 image: null,
 body: [
  p('The Friday night market will return to Tanners Quay this month with sixty stalls, a covered food court and a programme of live music that organisers say is the biggest in its eight-year history.'),
  p('Stallholders include returning favourites such as the Wren Valley cheese van and a bakery that sells out of cardamom buns within the hour, alongside twelve first-time traders from the Riverton Makers Hub.'),
  p('A hot-chocolate trail will link five cafés along the quay. Visitors collect a stamp at each and can win a hamper at the final stop. The market opens at 5pm on 14 November and runs every Friday until 19 December.'),
  p('Parking will be limited, and organisers are encouraging visitors to use the free shuttle from the railway station car park.')
 ]},
{
 slug: 'riverton-rovers-late-winner', section: 'sport', tags: ['football', 'rovers'], priority: 80,
 kicker: 'Football', headline: 'Rovers snatch late winner to go top of the table',
 subhead: 'Substitute Dani Kowalski scores in the 89th minute against Marlow Town.',
 byline: 'By Sam Pritchard', dateline: 'Riverton, 8 Nov', published: '2026-11-08T18:45:00+00:00',
 image: { kind: 'pitch', caption: 'Rovers celebrate at the final whistle.', credit: 'Riverton Herald illustration' },
 body: [
  p('Dani Kowalski came off the bench to score in the 89th minute as Riverton Rovers beat Marlow Town 2-1 on Saturday and moved to the top of the league for the first time in four seasons.'),
  p('Marlow had led through a first-half penalty, and the visitors defended deep for most of the second period. Rovers equalised through captain Ellis Burke, who finished a low cross from close range on the hour.'),
  p('The winner came from a corner that was only half cleared. Kowalski, on the pitch for just twelve minutes, controlled the ball on his chest and volleyed into the far corner.'),
  q('I have not stopped smiling. You dream of moments like that, and then it happens at your own ground.'),
  p('Manager Rhys Penhallow praised the squad\'s patience. Rovers have won five of their last six at home, and travel to Eastgate next weekend with a three-point cushion at the top.'),
  p('Tickets for the Eastgate trip are on sale at the club shop and the supporters\' coach is already almost full.')
 ]},
{
 slug: 'swimmer-breaks-county-record', section: 'sport', tags: ['swimming', 'record'], priority: 45,
 kicker: 'Swimming', headline: 'Teenager from Riverton breaks county 200m record',
 subhead: 'Aisha Rahman, 16, shaves nearly two seconds off the mark set in 2012.',
 byline: 'By Sam Pritchard', dateline: 'Riverton, 9 Nov', published: '2026-11-09T12:20:00+00:00',
 image: null,
 body: [
  p('Sixteen-year-old Aisha Rahman broke the county 200 metres freestyle record at the Riverton Aquatic Centre on Sunday, finishing in 2:03.14 and taking almost two seconds off a mark that had stood since 2012.'),
  p('Rahman, who trains with Wren Valley Swimming Club six mornings a week before school, said she did not look at the clock until she touched the wall. Her coach, Neil Fairbrother, said the result showed what disciplined work could do.'),
  p('She now has a qualifying time for the regional championships in February.')
  ,p('Fairbrother said the club would use the winter to work on her turns, which he believes are worth another half second, and that she will swim the 400 metres at the next county gala. "She has not yet reached her ceiling," he said.')
 ]},
{
 slug: 'high-street-shops-reopen', section: 'business', tags: ['retail', 'high-street'], priority: 65,
 kicker: 'Business', headline: 'Empty units on Bridge Street fill up as rents fall',
 subhead: 'Seven shops have signed leases since the summer, the highest figure since 2019.',
 byline: 'By Olivia Marsh', dateline: 'Riverton, 10 Nov', published: '2026-11-10T07:50:00+00:00',
 image: { kind: 'shopfront', caption: 'A new bookbinder\'s workshop on Bridge Street.', credit: 'Riverton Herald illustration' },
 body: [
  p('Seven empty units on Bridge Street have been let since the summer, the strongest run of lettings in the town centre since before the pandemic, according to figures from the Riverton Business Improvement District.'),
  p('The newcomers include a bookbinder, a repair café, a plant shop and a small bakery. Landlords have cut asking rents by an average of 18 per cent and many are offering three months rent-free to tenants who sign multi-year leases.'),
  h('A different kind of high street'),
  p('BID manager Colin Haywood said the new businesses were smaller and more specialised than the chains that left. Most employ two to five people and open six days a week. He cautioned that the vacancy rate, at 11 per cent, remained above the national average.'),
  p('Shop owner Amara Okafor opened a plant and pottery store in September after losing her office job. She said low rent was what made the risk affordable.'),
  q('A year ago I could not have afforded this street. Now the sums work, if I am careful.'),
  p('The council is considering a business-rates discount for independent traders in its next budget. A decision is expected in February.'),
  p('Footfall counters on Bridge Street recorded a 6 per cent rise in October compared with the same month last year, the third monthly rise in a row.')
 ]},
{
 slug: 'wren-brewery-expansion', section: 'business', tags: ['brewery', 'jobs'], priority: 60,
 kicker: 'Business', headline: 'Wren Valley Brewery to double output with new site',
 subhead: 'Forty jobs promised at a converted grain store beside the railway.',
 byline: 'By Olivia Marsh', dateline: 'Riverton, 11 Nov', published: '2026-11-11T11:15:00+00:00',
 image: { kind: 'barrels', caption: 'Fermentation tanks at the existing brewery.', credit: 'Riverton Herald illustration' },
 body: [
  p('Wren Valley Brewery has agreed to lease a disused grain store beside the railway line and plans to double its output by the end of next year, creating around forty jobs.'),
  p('Founded in a farm shed in 2014, the company now employs 31 people and supplies pubs across three counties. Managing director Fiona Calder said demand for its pale ale and a new low-alcohol lager had outgrown the current site.'),
  p('The grain store will house new tanks, a canning line and a taproom open to the public. Planning permission was granted in October with conditions on delivery times, designed to protect nearby homes from early-morning noise.'),
  p('Calder said recruitment would start in spring and that she expected most roles to be filled locally, including trainee brewers and packaging operatives.')
 ]},
{
 slug: 'opinion-keep-the-bus-lanes', section: 'opinion', tags: ['transport', 'opinion'], priority: 40,
 kicker: 'Comment', headline: 'Give the new bus lanes a fair chance',
 subhead: 'Three weeks of grumbling is not evidence. Let the town see a full year of data.',
 byline: 'By Margaret Doyle, Editor', dateline: 'Riverton', published: '2026-11-12T06:00:00+00:00',
 image: null,
 body: [
  p('It took less than a week for the letters to start arriving. The new bus lanes on Station Road, painted red in October, have been called a folly, a disaster and, in one memorable message, an act of war on the motorist.'),
  p('Let us calm down. A traffic scheme is not a verdict on anyone\'s character, and three weeks is far too short a time to know whether it works. Any change to a road makes the first month worse. Drivers do not yet know where to queue, buses have not yet learned the new timings and the shops have not yet worked out where deliveries can stop.'),
  h('What the numbers say so far'),
  p('The council\'s own counts show that the number 4 bus now takes eleven minutes to cover a stretch that used to take seventeen at the evening peak. Car journeys along the same road are about two minutes slower. That is a trade. Whether it is a good trade depends on how many people sit on the bus and how many in the car, and we do not yet have a year of figures to say.'),
  p('There are real complaints. Residents of Ferry Lane say the diversion has pushed cars past their front doors. Blue badge holders are right to ask where the new drop-off points are. The council should answer these questions plainly and quickly, and it has been too slow to do so.'),
  h('The test'),
  p('But the answer to a flawed detail is to fix the detail, not to rip out the scheme. If buses are faster and more reliable, more people will use them, and fewer cars will clog the town centre for everyone, including those who still drive.'),
  p('Councillors should commit now to a review in twelve months, with the data published in full, and to scrapping the lanes if they fail. In the meantime, readers who dislike them might try the number 4. They may be surprised.'),
  q('A road is judged by how many people it moves, not how many cars.')
 ]},
{
 slug: 'opinion-in-defence-of-the-market', section: 'opinion', tags: ['market', 'opinion'], priority: 35,
 kicker: 'Comment', headline: 'Why Riverton still needs its Thursday market',
 subhead: 'Mark Ellison argues that a market is more than a place to buy cabbages.',
 byline: 'By Mark Ellison', dateline: 'Riverton', published: '2026-11-13T06:00:00+00:00',
 image: null,
 body: [
  p('Every Thursday for nearly eight hundred years, farmers and makers have set up on Market Square, and every few years someone suggests we do without it. This year the suggestion is that the square would earn more as a car park.'),
  p('The market makes little profit for the council, that much is true. But it is where an elderly man who lives alone speaks to someone before lunch. It is where a teenager sells her first handmade candles. It is where the butcher knows which of his customers prefers the thinner slice.'),
  p('Economists talk about footfall and spend. Those matter. They are not why people come. They come because a market is the one place in town where being there is the whole point. Keep it.')
 ]},
{
 slug: 'school-science-fair-winners', section: 'city', tags: ['schools', 'science'], priority: 48,
 kicker: 'Schools', headline: 'Pupils\' solar-powered water filter wins regional science fair',
 subhead: 'Team from Hollis Road Primary heads to national final in London.',
 byline: 'By Hannah Oakes', dateline: 'Riverton, 14 Nov', published: '2026-11-14T13:05:00+00:00',
 image: { kind: 'lab', caption: 'The winning team with their filter prototype.', credit: 'Riverton Herald illustration' },
 body: [
  p('A team of four ten-year-olds from Hollis Road Primary School has won the regional young scientists\' fair with a solar-powered water filter built from recycled bottles, sand and a salvaged bicycle pump.'),
  p('The judges, who included two engineers from the Wren Water Treatment Works, said the entry stood out for its careful testing. The pupils measured the clarity of muddy pond water before and after filtering, repeating each trial five times and plotting the results on a hand-drawn chart.'),
  p('Teacher Beth Collins said the project began when the class noticed how much plastic was being thrown away at the school canteen. They decided to find a use for it.'),
  q('We thought, what if the bottles could clean water instead of floating in the sea?'),
  p('The team will travel to London in March for the national final. A fundraising bake sale on 22 November will help pay for the trip.')
 ]},
{
 slug: 'hospital-new-wing-opens', section: 'news', tags: ['health', 'hospital'], priority: 85,
 kicker: 'Health', headline: 'New maternity wing opens at Riverton General',
 subhead: 'The £21 million building has 28 private rooms and a dedicated birthing pool suite.',
 byline: 'By Tom Ashworth', dateline: 'Riverton, 16 Nov', published: '2026-11-16T09:40:00+00:00',
 image: { kind: 'building', caption: 'The new wing from the hospital forecourt.', credit: 'Riverton Herald illustration' },
 body: [
  p('A new maternity wing opened at Riverton General Hospital on Monday, giving families private rooms for the first time and ending years of crowded shared wards.'),
  p('The £21 million building has 28 single rooms, each with space for a partner to stay overnight, and four birthing suites, two of them with pools. A bright atrium and a garden courtyard connect the wing to the older hospital buildings.'),
  h('Why it matters'),
  p('The old unit, built in 1968, delivered about 3,400 babies a year in a space designed for 2,000. Midwives said that during busy periods women in labour were sometimes moved between corridors for lack of a free room. Head of midwifery Sarah Whitcombe said the difference was already clear in the first weekend.'),
  q('Women tell us they feel calmer when they have a door they can close. That is not a luxury, it changes how labour goes.'),
  p('The wing was paid for mostly by central government, with £2.4 million raised locally through a campaign that included sponsored walks, school collections and a charity dinner at the Assembly Rooms.'),
  p('The old maternity unit will close in January and be converted into outpatient clinics, easing pressure on the main entrance. Parents-to-be can book tours of the new wing on the hospital website.'),
  p('Staffing remains a worry. The trust says it has filled 22 of 26 new posts and is recruiting midwives from other regions. Unions have warned that the building alone will not fix shortages.')
 ]},
{
 slug: 'long-read-last-ferryman', section: 'news', tags: ['feature', 'history', 'river'], priority: 70,
 kicker: 'Long read', headline: 'The last ferryman of the Wren',
 subhead: 'For forty-one years Walter Pike has rowed people across a river that now has two bridges. He is not ready to stop.',
 byline: 'By Hannah Oakes', dateline: 'Riverton, 17 Nov', published: '2026-11-17T06:30:00+00:00',
 image: { kind: 'boat', caption: 'Walter Pike at the landing stage below Tanners Quay.', credit: 'Riverton Herald illustration' },
 body: [
  p('At twenty past seven on a grey Tuesday morning, Walter Pike unties a green rowing boat from the landing stage below Tanners Quay and waits. Nobody is there yet. He says that is normal. People arrive late, and then all at once.'),
  p('Pike, 68, is the last working ferryman on the Wren. For forty-one years he has carried passengers between the quay and the meadows on the far bank, a crossing of about ninety metres. Two bridges now stand within a ten-minute walk, one of them recently saved by the council, and nobody needs the ferry to get across. They take it anyway.'),
  h('A family trade'),
  p('The ferry licence was first granted to a Pike in 1874, by the old borough. Walter\'s great-grandfather rowed it, then his grandfather, then an uncle. His father worked at the sawmill and wanted something different for his son, and Walter spent his twenties as a van driver before the uncle fell ill and asked him to take a turn.'),
  p('He says he meant to stay a month. He has the original receipt for the first fare, a shilling, folded in a tobacco tin in the hut by the water. The fare is now two pounds, or free for children and anyone carrying a dog he likes.'),
  q('The river tells you things. You learn what the water will do before it does it. You cannot learn that from a book.'),
  h('The regulars'),
  p('A woman in a yellow coat arrives at half past seven, holding a thermos. She is Eileen Foss, a retired nurse, and she has crossed with Pike every working morning since 2011 to walk her terrier on the meadows. A pair of students from Riverton College come next, laughing, one of them clutching a bicycle wheel. A man in a suit asks to be dropped at the far bank so that he can have a quiet phone call, and Pike obliges without comment.'),
  p('Few of them have any practical need for the boat. Foss says she likes that it is slow. The students say it is the best part of their commute. The man in the suit says it is the only place in the town where nobody expects him to answer his emails.'),
  p('Pike keeps a log of every crossing in school exercise books. There are 112 of them, stacked in a cupboard. The total of passengers, by his reckoning, is somewhere near three hundred and ten thousand.')
  ,p('Not every crossing is gentle. In 2019 the flood took the landing stage and left the boat in a farmer\'s field two miles downstream. Pike fetched it with a borrowed tractor and had it back in service within the week. He says he was more annoyed about the logbook, which got wet.')
  ,p('There was the night, in the winter of 1996, when he rowed a midwife across in thick fog because the bridge had been closed by ice. The baby was born healthy on the meadow side an hour later. The boy, now a man of thirty, buys Pike a pint every birthday.'),
  h('Rules, rust and a retirement'),
  p('Running the ferry is not easy money. The licence demands an annual safety inspection, insurance that costs more each year and a lifejacket for every passenger. The boat itself, built in 1987 by a yard that no longer exists, needs new planking every few winters. Pike pays for most of it himself, along with the small grant the council gives for the heritage service.'),
  p('Last spring, after a bad bout of pneumonia, he told his family he would stop at the end of the season. His daughter, Jess, a joiner in Marlow, drove up and spent a weekend mending the hut roof. She did not say anything about retirement. On Monday she asked how one went about getting a ferry licence.'),
  p('Jess Pike, 37, now crosses with her father two days a week and has passed the boat-handling course. She says she is not sure whether she will do it for life. She is sure she does not want it to end because nobody was there to pick up the oars.'),
  h('What the town owes'),
  p('Some in Riverton have started to say the town owes the ferry something. A group called Friends of the Ferry has collected nearly £7,000 for a new boat. The council\'s heritage officer, Daniel Rowe, says that a place on the town\'s official list of cultural assets would give the crossing some protection, and would help with insurance costs.'),
  p('Pike is a little embarrassed by the fuss. He says the boat is not a monument, just a way across. Then he looks at the water, which is brown and fast after a week of rain, and says that nobody ought to be asked to love a monument, but they might love a ferry.'),
  p('At ten past eight the last of the morning passengers steps off at the meadows. Pike turns the boat with one stroke, a movement so small it is hard to see, and heads back across the river. The quay is full of people waiting.'),
  p('He estimates there will be about thirty crossings today. He has not yet decided what to do about the new boat. He says the oars, at least, will be the same.')
 ]},
{
 slug: 'cold-snap-weather-warning', section: 'news', tags: ['weather'], priority: 52,
 kicker: 'Weather', headline: 'Frost warning issued as cold snap settles over the valley',
 subhead: 'Temperatures could fall to minus six overnight on Thursday and Friday.',
 byline: 'By Tom Ashworth', dateline: 'Riverton, 18 Nov', published: '2026-11-18T16:25:00+00:00',
 image: null,
 body: [
  p('A yellow weather warning for ice has been issued for the Wren Valley from Thursday evening, with temperatures forecast to fall as low as minus six on higher ground around the town.'),
  p('The council said gritters would treat main roads from 6pm and that salt bins in residential streets had been refilled this week. Drivers are advised to allow extra time and to check on elderly neighbours.'),
  p('The cold snap is expected to ease on Sunday as milder air arrives from the west.')
  ,p('Farmers have been asked to bring livestock closer to shelter, and the Riverton Food Bank has appealed for donations of warm clothing and blankets after a rise in requests during the first frosts. Anyone who needs shelter can call the council helpline.')
 ]},
{
 slug: 'bank-holiday-rail-works', section: 'business', tags: ['rail', 'transport'], priority: 58,
 kicker: 'Transport', headline: 'Rail firm confirms three weekends of line closures for signal upgrade',
 subhead: 'Replacement buses will run between Riverton and Marlow while engineers work.',
 byline: 'By Olivia Marsh', dateline: 'Riverton, 19 Nov', published: '2026-11-19T10:10:00+00:00',
 image: { kind: 'rail', caption: 'Signalling equipment awaiting installation near Riverton station.', credit: 'Riverton Herald illustration' },
 body: [
  p('Trains between Riverton and Marlow will not run on three weekends in January and February while engineers replace ageing signalling equipment, the rail operator has confirmed.'),
  p('The closures will take place on 17-18 January, 31 January-1 February and 14-15 February. Replacement buses will run every thirty minutes, adding about twenty-five minutes to the journey. The operator said it chose winter weekends to limit the impact on commuters and the Saturday market.'),
  p('The £14 million upgrade will replace signal boxes dating from the 1960s with a modern system that can be run from a regional control centre. The operator says it should reduce delays caused by equipment failure, which accounted for almost a third of late trains on the line last year.'),
  p('Passenger groups have welcomed the investment but asked for clearer communication. Details of replacement services will appear on station boards and the operator\'s website from next week.')
 ]}
];
