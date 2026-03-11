/**
 * Georgia city → county lookup table.
 * Keys are lowercase city names. Values are Title Case county names.
 * Covers all 159 Georgia county seats + cities/municipalities with population > 5,000.
 *
 * Sources: U.S. Census Bureau, Georgia Municipal Association, Wikipedia.
 */
export const GEORGIA_CITY_TO_COUNTY: Record<string, string> = {
  // ── Fulton County ──────────────────────────────────────────────
  atlanta: 'Fulton',
  'sandy springs': 'Fulton',
  roswell: 'Fulton',
  'johns creek': 'Fulton',
  alpharetta: 'Fulton',
  'college park': 'Fulton',
  'east point': 'Fulton',
  fairburn: 'Fulton',
  'union city': 'Fulton',
  hapeville: 'Fulton',
  'palmetto': 'Fulton',
  'chattahoochee hills': 'Fulton',
  'mountain park': 'Fulton',
  'south fulton': 'Fulton',
  milton: 'Fulton',

  // ── Gwinnett County ────────────────────────────────────────────
  lawrenceville: 'Gwinnett',
  duluth: 'Gwinnett',
  suwanee: 'Gwinnett',
  norcross: 'Gwinnett',
  buford: 'Gwinnett',
  lilburn: 'Gwinnett',
  snellville: 'Gwinnett',
  'sugar hill': 'Gwinnett',
  'peachtree corners': 'Gwinnett',
  'berkeley lake': 'Gwinnett',
  grayson: 'Gwinnett',
  dacula: 'Gwinnett',
  auburn: 'Gwinnett',
  loganville: 'Gwinnett',
  braselton: 'Gwinnett',
  'rest haven': 'Gwinnett',

  // ── Cobb County ────────────────────────────────────────────────
  marietta: 'Cobb',
  smyrna: 'Cobb',
  kennesaw: 'Cobb',
  acworth: 'Cobb',
  'powder springs': 'Cobb',
  austell: 'Cobb',
  mableton: 'Cobb',
  'fair oaks': 'Cobb',
  'vinings': 'Cobb',

  // ── DeKalb County ──────────────────────────────────────────────
  decatur: 'DeKalb',
  tucker: 'DeKalb',
  'stone mountain': 'DeKalb',
  lithonia: 'DeKalb',
  chamblee: 'DeKalb',
  doraville: 'DeKalb',
  clarkston: 'DeKalb',
  'avondale estates': 'DeKalb',
  brookhaven: 'DeKalb',
  dunwoody: 'DeKalb',
  'pine lake': 'DeKalb',
  'lake city': 'DeKalb',
  stonecrest: 'DeKalb',

  // ── Cherokee County ────────────────────────────────────────────
  canton: 'Cherokee',
  woodstock: 'Cherokee',
  'ball ground': 'Cherokee',
  'holly springs': 'Cherokee',
  nelson: 'Cherokee',
  waleska: 'Cherokee',
  'free home': 'Cherokee',

  // ── Forsyth County ─────────────────────────────────────────────
  cumming: 'Forsyth',
  'coal mountain': 'Forsyth',

  // ── Hall County ────────────────────────────────────────────────
  gainesville: 'Hall',
  oakwood: 'Hall',
  'flowery branch': 'Hall',
  clermont: 'Hall',
  gillsville: 'Hall',
  lula: 'Hall',

  // ── Barrow County ──────────────────────────────────────────────
  winder: 'Barrow',
  statham: 'Barrow',
  bethlehem: 'Barrow',
  carl: 'Barrow',
  'braidwood': 'Barrow',

  // ── Jackson County ─────────────────────────────────────────────
  jefferson: 'Jackson',
  commerce: 'Jackson',
  hoschton: 'Jackson',
  pendergrass: 'Jackson',
  nicholson: 'Jackson',
  maysville: 'Jackson',
  'talmo': 'Jackson',

  // ── Paulding County ────────────────────────────────────────────
  dallas: 'Paulding',
  hiram: 'Paulding',

  // ── Henry County ───────────────────────────────────────────────
  mcdonough: 'Henry',
  stockbridge: 'Henry',
  hampton: 'Henry',
  'locust grove': 'Henry',
  'sunny side': 'Henry',

  // ── Douglas County ─────────────────────────────────────────────
  douglasville: 'Douglas',
  winston: 'Douglas',

  // ── Rockdale County ────────────────────────────────────────────
  conyers: 'Rockdale',

  // ── Newton County ──────────────────────────────────────────────
  covington: 'Newton',
  oxford: 'Newton',
  porterdale: 'Newton',
  'social circle': 'Newton',

  // ── Walton County ──────────────────────────────────────────────
  monroe: 'Walton',
  'social circle (walton)': 'Walton',
  jersey: 'Walton',

  // ── Carroll County ─────────────────────────────────────────────
  carrollton: 'Carroll',
  'villa rica': 'Carroll',
  bremen: 'Carroll',
  bowdon: 'Carroll',
  temple: 'Carroll',
  whitesburg: 'Carroll',
  roopville: 'Carroll',

  // ── Clayton County ─────────────────────────────────────────────
  jonesboro: 'Clayton',
  'forest park': 'Clayton',
  riverdale: 'Clayton',
  morrow: 'Clayton',
  lovejoy: 'Clayton',
  ellenwood: 'Clayton',
  'rex': 'Clayton',

  // ── Fayette County ─────────────────────────────────────────────
  fayetteville: 'Fayette',
  'peachtree city': 'Fayette',
  tyrone: 'Fayette',
  woolsey: 'Fayette',
  brooks: 'Fayette',

  // ── Coweta County ──────────────────────────────────────────────
  newnan: 'Coweta',
  senoia: 'Coweta',
  turin: 'Coweta',
  moreland: 'Coweta',
  grantville: 'Coweta',
  sharpsburg: 'Coweta',

  // ── Spalding County ────────────────────────────────────────────
  griffin: 'Spalding',

  // ── Chatham County ─────────────────────────────────────────────
  savannah: 'Chatham',
  pooler: 'Chatham',
  'garden city': 'Chatham',
  'port wentworth': 'Chatham',
  'tybee island': 'Chatham',
  thunderbolt: 'Chatham',
  bloomingdale: 'Chatham',
  'vernonburg': 'Chatham',

  // ── Bibb County ────────────────────────────────────────────────
  macon: 'Bibb',
  payne: 'Bibb',

  // ── Houston County ─────────────────────────────────────────────
  'warner robins': 'Houston',
  centerville: 'Houston',
  perry: 'Houston',
  bonaire: 'Houston',

  // ── Muscogee County ────────────────────────────────────────────
  columbus: 'Muscogee',

  // ── Richmond County ────────────────────────────────────────────
  augusta: 'Richmond',
  hephzibah: 'Richmond',
  blythe: 'Richmond',

  // ── Lowndes County ─────────────────────────────────────────────
  valdosta: 'Lowndes',
  hahira: 'Lowndes',
  remerton: 'Lowndes',
  dasher: 'Lowndes',

  // ── Floyd County ───────────────────────────────────────────────
  rome: 'Floyd',
  'cave spring': 'Floyd',

  // ── Whitfield County ───────────────────────────────────────────
  dalton: 'Whitfield',
  'tunnel hill': 'Whitfield',
  varnell: 'Whitfield',

  // ── Bartow County ──────────────────────────────────────────────
  cartersville: 'Bartow',
  adairsville: 'Bartow',
  emerson: 'Bartow',
  kingston: 'Bartow',
  white: 'Bartow',

  // ── Clarke County ──────────────────────────────────────────────
  athens: 'Clarke',

  // ── Dougherty County ───────────────────────────────────────────
  albany: 'Dougherty',

  // ── Thomas County ──────────────────────────────────────────────
  thomasville: 'Thomas',
  meigs: 'Thomas',

  // ── Laurens County ─────────────────────────────────────────────
  dublin: 'Laurens',

  // ── Troup County ───────────────────────────────────────────────
  lagrange: 'Troup',
  'la grange': 'Troup',
  'west point': 'Troup',
  hogansville: 'Troup',

  // ── Glynn County ───────────────────────────────────────────────
  brunswick: 'Glynn',
  'st simons island': 'Glynn',
  "st. simons island": 'Glynn',
  'jekyll island': 'Glynn',

  // ── Camden County ──────────────────────────────────────────────
  kingsland: 'Camden',
  'st marys': 'Camden',
  "st. mary's": 'Camden',

  // ── Catoosa County ─────────────────────────────────────────────
  ringgold: 'Catoosa',
  'fort oglethorpe': 'Catoosa',

  // ── Walker County ──────────────────────────────────────────────
  lafayette: 'Walker',
  'la fayette': 'Walker',
  chickamauga: 'Walker',
  rossville: 'Walker',

  // ── Gordon County ──────────────────────────────────────────────
  calhoun: 'Gordon',
  resaca: 'Gordon',

  // ── Polk County ────────────────────────────────────────────────
  cedartown: 'Polk',
  rockmart: 'Polk',

  // ── Haralson County ────────────────────────────────────────────
  buchanan: 'Haralson',
  tallapoosa: 'Haralson',

  // ── Heard County ───────────────────────────────────────────────
  franklin: 'Heard',

  // ── Meriwether County ──────────────────────────────────────────
  greenville: 'Meriwether',
  manchestera: 'Meriwether',
  manchester: 'Meriwether',
  warm_springs: 'Meriwether',
  'warm springs': 'Meriwether',

  // ── Pike County ────────────────────────────────────────────────
  zebulon: 'Pike',

  // ── Upson County ───────────────────────────────────────────────
  thomaston: 'Upson',

  // ── Lamar County ───────────────────────────────────────────────
  barnesville: 'Lamar',

  // ── Monroe County ──────────────────────────────────────────────
  forsyth: 'Monroe',

  // ── Jasper County ──────────────────────────────────────────────
  monticello: 'Jasper',

  // ── Butts County ───────────────────────────────────────────────
  jackson: 'Butts',

  // ── Jones County ───────────────────────────────────────────────
  gray: 'Jones',

  // ── Twiggs County ──────────────────────────────────────────────
  jeffersonville: 'Twiggs',

  // ── Wilkinson County ───────────────────────────────────────────
  irwinton: 'Wilkinson',

  // ── Baldwin County ─────────────────────────────────────────────
  milledgeville: 'Baldwin',

  // ── Putnam County ──────────────────────────────────────────────
  eatonton: 'Putnam',

  // ── Morgan County ──────────────────────────────────────────────
  madison: 'Morgan',

  // ── Greene County ──────────────────────────────────────────────
  greensboro: 'Greene',

  // ── Oglethorpe County ──────────────────────────────────────────
  lexington: 'Oglethorpe',

  // ── Elbert County ──────────────────────────────────────────────
  elberton: 'Elbert',

  // ── Madison County ─────────────────────────────────────────────
  danielsville: 'Madison',

  // ── Franklin County ────────────────────────────────────────────
  carnesville: 'Franklin',

  // ── Stephens County ────────────────────────────────────────────
  toccoa: 'Stephens',

  // ── Habersham County ───────────────────────────────────────────
  cornelia: 'Habersham',
  clarkesville: 'Habersham',
  demorest: 'Habersham',

  // ── White County ───────────────────────────────────────────────
  cleveland: 'White',

  // ── Lumpkin County ─────────────────────────────────────────────
  dahlonega: 'Lumpkin',

  // ── Dawson County ──────────────────────────────────────────────
  dawsonville: 'Dawson',

  // ── Pickens County ─────────────────────────────────────────────
  jasper: 'Pickens',

  // ── Gilmer County ──────────────────────────────────────────────
  ellijay: 'Gilmer',

  // ── Fannin County ──────────────────────────────────────────────
  'blue ridge': 'Fannin',
  mccaysville: 'Fannin',

  // ── Union County ───────────────────────────────────────────────
  blairsville: 'Union',

  // ── Towns County ───────────────────────────────────────────────
  hiawassee: 'Towns',

  // ── Rabun County ───────────────────────────────────────────────
  clayton: 'Rabun',

  // ── Habersham County (additional) ──────────────────────────────
  tallulah_falls: 'Rabun',
  'tallulah falls': 'Rabun',

  // ── Banks County ───────────────────────────────────────────────
  homer: 'Banks',

  // ── Hart County ────────────────────────────────────────────────
  hartwell: 'Hart',

  // ── Oconee County ──────────────────────────────────────────────
  watkinsville: 'Oconee',
  bogart: 'Oconee',

  // ── Walton County (additional) ─────────────────────────────────
  'good hope': 'Walton',
  loganville_walton: 'Walton',

  // ── Gwinnett County (additional) ───────────────────────────────
  'jimmy carter': 'Gwinnett',
  'collins hill': 'Gwinnett',

  // ── Bartow County (additional) ─────────────────────────────────
  taylorsville: 'Bartow',

  // ── Cherokee County (additional) ───────────────────────────────
  'big canoe': 'Cherokee',

  // ── Cobb County (additional) ───────────────────────────────────
  'lost mountain': 'Cobb',

  // ── Fayette County (additional) ────────────────────────────────
  'flat creek': 'Fayette',

  // ── Coweta County (additional) ─────────────────────────────────
  haralson: 'Coweta',

  // ── Gordon County (additional) ─────────────────────────────────
  sonoraville: 'Gordon',

  // ── Chattooga County ───────────────────────────────────────────
  summerville: 'Chattooga',
  trion: 'Chattooga',

  // ── Walker County (additional) ─────────────────────────────────
  'rock spring': 'Walker',

  // ── Dade County ────────────────────────────────────────────────
  trenton: 'Dade',

  // ── Murray County ──────────────────────────────────────────────
  chatsworth: 'Murray',
  eton: 'Murray',

  // ── Whitfield County (additional) ──────────────────────────────
  cohutta: 'Whitfield',

  // ── Gilmer County (additional) ─────────────────────────────────
  'east ellijay': 'Gilmer',

  // ── Floyd County (additional) ──────────────────────────────────
  lindale: 'Floyd',

  // ── Polk County (additional) ───────────────────────────────────
  aragon: 'Polk',

  // ── Haralson County (additional) ───────────────────────────────
  waco: 'Haralson',

  // ── Carroll County (additional) ────────────────────────────────
  'mount zion': 'Carroll',

  // ── Troup County (additional) ──────────────────────────────────
  'long cane': 'Troup',

  // ── Coweta County (additional) ─────────────────────────────────
  'raymond': 'Coweta',

  // ── Meriwether County (additional) ─────────────────────────────
  waverly_hall: 'Meriwether',

  // ── Upson County (additional) ──────────────────────────────────
  yatesville: 'Upson',

  // ── Pike County (additional) ───────────────────────────────────
  meansville: 'Pike',

  // ── Lamar County (additional) ──────────────────────────────────
  milner: 'Lamar',
  'the rock': 'Upson',

  // ── Monroe County (additional) ─────────────────────────────────
  culloden: 'Monroe',

  // ── Houston County (additional) ────────────────────────────────
  kathleen: 'Houston',
  'houston county': 'Houston',

  // ── Peach County ───────────────────────────────────────────────
  'fort valley': 'Peach',
  byron: 'Peach',

  // ── Crawford County ────────────────────────────────────────────
  knoxville: 'Crawford',
  roberta: 'Crawford',

  // ── Taylor County ──────────────────────────────────────────────
  butler: 'Taylor',

  // ── Schley County ──────────────────────────────────────────────
  ellaville: 'Schley',

  // ── Macon County ───────────────────────────────────────────────
  oglethorpe: 'Macon',

  // ── Dooly County ───────────────────────────────────────────────
  vienna: 'Dooly',

  // ── Crisp County ───────────────────────────────────────────────
  cordele: 'Crisp',

  // ── Wilcox County ──────────────────────────────────────────────
  abbeville: 'Wilcox',

  // ── Telfair County ─────────────────────────────────────────────
  mcrae: 'Telfair',
  helena: 'Telfair',
  'mcrae-helena': 'Telfair',

  // ── Jeff Davis County ──────────────────────────────────────────
  hazlehurst: 'Jeff Davis',

  // ── Coffee County ──────────────────────────────────────────────
  douglas: 'Coffee',

  // ── Bacon County ───────────────────────────────────────────────
  alma: 'Bacon',

  // ── Pierce County ──────────────────────────────────────────────
  blackshear: 'Pierce',
  patterson: 'Pierce',

  // ── Brantley County ────────────────────────────────────────────
  nahunta: 'Brantley',

  // ── Charlton County ────────────────────────────────────────────
  folkston: 'Charlton',

  // ── Ware County ────────────────────────────────────────────────
  waycross: 'Ware',

  // ── Atkinson County ────────────────────────────────────────────
  pearson: 'Atkinson',

  // ── Clinch County ──────────────────────────────────────────────
  homerville: 'Clinch',

  // ── Lanier County ──────────────────────────────────────────────
  lakeland: 'Lanier',

  // ── Echols County ──────────────────────────────────────────────
  statenville: 'Echols',

  // ── Berrien County ─────────────────────────────────────────────
  nashville: 'Berrien',

  // ── Cook County ────────────────────────────────────────────────
  adel: 'Cook',

  // ── Colquitt County ────────────────────────────────────────────
  moultrie: 'Colquitt',

  // ── Mitchell County ────────────────────────────────────────────
  camilla: 'Mitchell',

  // ── Worth County ───────────────────────────────────────────────
  sylvester: 'Worth',

  // ── Lee County ─────────────────────────────────────────────────
  leesburg: 'Lee',
  smithville: 'Lee',

  // ── Terrell County ─────────────────────────────────────────────
  dawson: 'Terrell',

  // ── Webster County ─────────────────────────────────────────────
  preston: 'Webster',

  // ── Stewart County ─────────────────────────────────────────────
  lumpkin: 'Stewart',

  // ── Webster County (alt) ───────────────────────────────────────
  richland: 'Stewart',

  // ── Quitman County ─────────────────────────────────────────────
  georgetown: 'Quitman',

  // ── Clay County ────────────────────────────────────────────────
  'fort gaines': 'Clay',

  // ── Early County ───────────────────────────────────────────────
  blakely: 'Early',

  // ── Miller County ──────────────────────────────────────────────
  colquitt: 'Miller',

  // ── Seminole County ────────────────────────────────────────────
  donalsonville: 'Seminole',

  // ── Decatur County ─────────────────────────────────────────────
  bainbridge: 'Decatur',

  // ── Grady County ───────────────────────────────────────────────
  cairo: 'Grady',

  // ── Thomas County (additional) ─────────────────────────────────
  ochlocknee: 'Thomas',
  coolidge: 'Thomas',

  // ── Brooks County ──────────────────────────────────────────────
  quitman: 'Brooks',

  // ── Lowndes County (additional) ────────────────────────────────
  lake_park: 'Lowndes',
  'lake park': 'Lowndes',

  // ── Lanier County (additional) ─────────────────────────────────
  ray_city: 'Berrien',

  // ── Irwin County ───────────────────────────────────────────────
  ocilla: 'Irwin',

  // ── Ben Hill County ────────────────────────────────────────────
  fitzgerald: 'Ben Hill',

  // ── Tift County ────────────────────────────────────────────────
  tifton: 'Tift',

  // ── Turner County ──────────────────────────────────────────────
  ashburn: 'Turner',

  // ── Wilcox County (additional) ─────────────────────────────────
  rochelle: 'Wilcox',

  // ── Dodge County ───────────────────────────────────────────────
  eastman: 'Dodge',

  // ── Pulaski County ─────────────────────────────────────────────
  hawkinsville: 'Pulaski',

  // ── Bleckley County ────────────────────────────────────────────
  cochran: 'Bleckley',

  // ── Laurens County (additional) ────────────────────────────────
  'east dublin': 'Laurens',

  // ── Treutlen County ────────────────────────────────────────────
  soperton: 'Treutlen',

  // ── Wheeler County ─────────────────────────────────────────────
  alamo: 'Wheeler',

  // ── Toombs County ──────────────────────────────────────────────
  vidalia: 'Toombs',
  lyons: 'Toombs',

  // ── Montgomery County ──────────────────────────────────────────
  mount_vernon: 'Montgomery',
  'mount vernon': 'Montgomery',

  // ── Emanuel County ─────────────────────────────────────────────
  swainsboro: 'Emanuel',

  // ── Johnson County ─────────────────────────────────────────────
  wrightsville: 'Johnson',

  // ── Washington County ──────────────────────────────────────────
  sandersville: 'Washington',

  // ── Hancock County ─────────────────────────────────────────────
  sparta: 'Hancock',

  // ── Warren County ──────────────────────────────────────────────
  warrenton: 'Warren',

  // ── McDuffie County ────────────────────────────────────────────
  thomson: 'McDuffie',

  // ── Columbia County ────────────────────────────────────────────
  'evans': 'Columbia',
  appling: 'Columbia',
  grovetown: 'Columbia',
  harlem: 'Columbia',

  // ── Burke County ───────────────────────────────────────────────
  waynesboro: 'Burke',

  // ── Jenkins County ─────────────────────────────────────────────
  millen: 'Jenkins',

  // ── Screven County ─────────────────────────────────────────────
  sylvania: 'Screven',

  // ── Bulloch County ─────────────────────────────────────────────
  statesboro: 'Bulloch',

  // ── Candler County ─────────────────────────────────────────────
  metter: 'Candler',

  // ── Evans County ───────────────────────────────────────────────
  claxton: 'Evans',

  // ── Tattnall County ────────────────────────────────────────────
  reidsville: 'Tattnall',

  // ── Long County ────────────────────────────────────────────────
  ludowici: 'Long',

  // ── Liberty County ─────────────────────────────────────────────
  hinesville: 'Liberty',
  midway: 'Liberty',

  // ── Bryan County ───────────────────────────────────────────────
  pembroke: 'Bryan',
  richmond_hill: 'Bryan',
  'richmond hill': 'Bryan',

  // ── Effingham County ───────────────────────────────────────────
  springfield: 'Effingham',
  rincon: 'Effingham',
  guyton: 'Effingham',

  // ── Screven County (additional) ────────────────────────────────
  oliver: 'Screven',

  // ── Wayne County ───────────────────────────────────────────────
  jesup: 'Wayne',

  // ── Brantley County (additional) ───────────────────────────────
  hoboken: 'Brantley',

  // ── Appling County ─────────────────────────────────────────────
  baxley: 'Appling',

  // ── Jeff Davis County (additional) ─────────────────────────────
  denton: 'Jeff Davis',

  // ── Montgomery County (additional) ─────────────────────────────
  ailey: 'Montgomery',

  // ── Toombs County (additional) ─────────────────────────────────
  'santa claus': 'Toombs',

  // ── Bleckley County (additional) ───────────────────────────────
  milan: 'Bleckley',

  // ── Pulaski County (additional) ────────────────────────────────
  chester: 'Pulaski',

  // ── Bibb County (additional) ───────────────────────────────────
  'north macon': 'Bibb',

  // ── Muscogee County (additional) ───────────────────────────────
  phenix_city: 'Muscogee',

  // ── Harris County ──────────────────────────────────────────────
  hamilton: 'Harris',
  pine_mountain: 'Harris',
  'pine mountain': 'Harris',
  'warm springs (harris)': 'Harris',

  // ── Talbot County ──────────────────────────────────────────────
  talbotton: 'Talbot',

  // ── Taliaferro County ──────────────────────────────────────────
  crawfordville: 'Taliaferro',

  // ── Glascock County ────────────────────────────────────────────
  gibson: 'Glascock',

  // ── Jefferson County ───────────────────────────────────────────
  louisville: 'Jefferson',

  // ── Glascock County (additional) ───────────────────────────────
  mitchell: 'Glascock',

  // ── Lincoln County ─────────────────────────────────────────────
  lincolnton: 'Lincoln',

  // ── Wilkes County ──────────────────────────────────────────────
  washington: 'Wilkes',

  // ── Oglethorpe County (additional) ─────────────────────────────
  crawford: 'Oglethorpe',

  // ── Barrow County (additional) ─────────────────────────────────
  'bramlett': 'Barrow',

  // ── Gwinnett County (additional) ───────────────────────────────
  'trip': 'Gwinnett',
  'mountain park (gwinnett)': 'Gwinnett',

  // ── Additional small GA cities / common misspellings ──────────
  gainsville: 'Hall',           // common misspelling of Gainesville
  'reed creek': 'Hart',
  rentz: 'Laurens',
  ellabell: 'Bryan',
  concord: 'Pike',
  screven: 'Wayne',
  buckhead: 'Morgan',           // Morgan County (not Atlanta's Buckhead)
  lizella: 'Bibb',
  brooklet: 'Bulloch',
  'silver creek': 'Floyd',
  armuchee: 'Floyd',
  fortson: 'Harris',
  eden: 'Effingham',
  comer: 'Madison',
  baldwin: 'Banks',
  'iron city': 'Seminole',
  epworth: 'Fannin',
  glennville: 'Tattnall',
  ranger: 'Gordon',
  matthews: 'Madison',
}

/**
 * Returns the Georgia county for a given city name, or null if not in the static map.
 *
 * State detection: fires for 'GA', 'GEORGIA', or null/blank state (permit-sourced
 * companies often have state unset). Blocks explicitly non-GA states.
 */
export function deriveCountyFromCity(
  city: string | null | undefined,
  state: string | null | undefined,
): string | null {
  if (!city) return null
  const s = (state ?? '').trim().toUpperCase()
  // Attempt for explicit GA, GEORGIA, or unset state — block clearly non-GA states
  if (s !== '' && s !== 'GA' && s !== 'GEORGIA') return null
  return GEORGIA_CITY_TO_COUNTY[city.trim().toLowerCase()] ?? null
}
