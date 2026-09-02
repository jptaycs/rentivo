/**
 * Approximate city-center coordinates for the Philippine cities/provinces
 * offered in the host wizard's pickup-address step. Deliberately coarse —
 * renters only ever see city/province (never the exact street address,
 * which is shared after a booking is confirmed), so a city-level pin is
 * the correct level of precision, not a privacy gap to geocode around.
 *
 * Single source of truth: `PH_PROVINCES` is the host wizard's province
 * dropdown, and the coordinate tables below cover every one of those
 * provinces plus every chartered city. These two lists used to be
 * separate (a 13-entry dropdown + an "Other" option vs. a smaller
 * hand-maintained coordinate table) and drifted apart — a host outside
 * the original 13 provinces had to pick "Other", and the map then pinned
 * their listing in Manila regardless of their real city (e.g. a real
 * listing with `city: "NAGA CITY CAMARINES SUR", province: "Other"`).
 * Keeping both derived from one file is what prevents that recurring.
 *
 * Coordinates were resolved once, at authoring time (2026-09-02), against
 * the OpenStreetMap Nominatim API and baked in here — no runtime API call,
 * no new dependency, no account, matching this project's existing
 * zero-cost static-data approach for the pickup map.
 */

/** Display list for the host wizard's province dropdown. Single source of
 *  truth — Step5Address imports this rather than keeping its own copy, which
 *  is what let the two drift until every unlisted city pinned in Manila. */
export const PH_PROVINCES: string[] = [
  'Abra',
  'Agusan del Norte',
  'Agusan del Sur',
  'Aklan',
  'Albay',
  'Antique',
  'Apayao',
  'Aurora',
  'Basilan',
  'Bataan',
  'Batanes',
  'Batangas',
  'Benguet',
  'Biliran',
  'Bohol',
  'Bukidnon',
  'Bulacan',
  'Cagayan',
  'Camarines Norte',
  'Camarines Sur',
  'Camiguin',
  'Capiz',
  'Catanduanes',
  'Cavite',
  'Cebu',
  'Cotabato',
  'Davao de Oro',
  'Davao del Norte',
  'Davao del Sur',
  'Davao Occidental',
  'Davao Oriental',
  'Dinagat Islands',
  'Eastern Samar',
  'Guimaras',
  'Ifugao',
  'Ilocos Norte',
  'Ilocos Sur',
  'Iloilo',
  'Isabela',
  'Kalinga',
  'La Union',
  'Laguna',
  'Lanao del Norte',
  'Lanao del Sur',
  'Leyte',
  'Maguindanao del Norte',
  'Maguindanao del Sur',
  'Marinduque',
  'Masbate',
  'Metro Manila',
  'Misamis Occidental',
  'Misamis Oriental',
  'Mountain Province',
  'Negros Occidental',
  'Negros Oriental',
  'Northern Samar',
  'Nueva Ecija',
  'Nueva Vizcaya',
  'Occidental Mindoro',
  'Oriental Mindoro',
  'Palawan',
  'Pampanga',
  'Pangasinan',
  'Quezon',
  'Quirino',
  'Rizal',
  'Romblon',
  'Samar',
  'Sarangani',
  'Siquijor',
  'Sorsogon',
  'South Cotabato',
  'Southern Leyte',
  'Sultan Kudarat',
  'Sulu',
  'Surigao del Norte',
  'Surigao del Sur',
  'Tarlac',
  'Tawi-Tawi',
  'Zambales',
  'Zamboanga del Norte',
  'Zamboanga del Sur',
  'Zamboanga Sibugay',
]

const PROVINCE_COORDS: Record<string, { lat: number; lng: number }> = {
  'abra': { lat: 17.58, lng: 120.8 },
  'agusan del norte': { lat: 8.92, lng: 125.46 },
  'agusan del sur': { lat: 8.36, lng: 125.71 },
  'aklan': { lat: 11.6298, lng: 122.2481 },
  'albay': { lat: 13.2167, lng: 123.55 },
  'antique': { lat: 11.1705, lng: 122.0833 },
  'apayao': { lat: 18.12, lng: 121.19 },
  'aurora': { lat: 16.0475, lng: 121.6701 },
  'basilan': { lat: 6.565, lng: 122.0649 },
  'bataan': { lat: 14.6436, lng: 120.4658 },
  'batanes': { lat: 20.6442, lng: 121.8939 },
  'batangas': { lat: 13.9147, lng: 121.0868 },
  'benguet': { lat: 16.52, lng: 120.69 },
  'biliran': { lat: 11.6, lng: 124.49 },
  'bohol': { lat: 9.8333, lng: 124.1616 },
  'bukidnon': { lat: 8.0228, lng: 124.9986 },
  'bulacan': { lat: 15, lng: 121.0833 },
  'cagayan': { lat: 18, lng: 121.8333 },
  'camarines norte': { lat: 14.1667, lng: 122.75 },
  'camarines sur': { lat: 13.6428, lng: 123.3282 },
  'camiguin': { lat: 9.174, lng: 124.7257 },
  'capiz': { lat: 11.3853, lng: 122.6377 },
  'catanduanes': { lat: 13.8333, lng: 124.25 },
  'cavite': { lat: 14.2854, lng: 120.8543 },
  'cebu': { lat: 10.47, lng: 123.83 },
  'cotabato': { lat: 7.27, lng: 124.86 },
  'davao de oro': { lat: 7.45, lng: 126.07 },
  'davao del norte': { lat: 7.6179, lng: 125.6833 },
  'davao del sur': { lat: 6.6984, lng: 125.3612 },
  'davao occidental': { lat: 6.27, lng: 125.6 },
  'davao oriental': { lat: 7.1667, lng: 126.3333 },
  'dinagat islands': { lat: 10.1578, lng: 125.5852 },
  'eastern samar': { lat: 11.73, lng: 125.37 },
  'guimaras': { lat: 10.5731, lng: 122.6239 },
  'ifugao': { lat: 16.87, lng: 121.22 },
  'ilocos norte': { lat: 18.1667, lng: 120.75 },
  'ilocos sur': { lat: 17.2, lng: 120.5 },
  'iloilo': { lat: 10.9522, lng: 122.5799 },
  'isabela': { lat: 17, lng: 122 },
  'kalinga': { lat: 17.46, lng: 121.31 },
  'la union': { lat: 16.5736, lng: 120.409 },
  'laguna': { lat: 14.1696, lng: 121.3337 },
  'lanao del norte': { lat: 7.958, lng: 123.9021 },
  'lanao del sur': { lat: 7.8776, lng: 124.3755 },
  'leyte': { lat: 10.7841, lng: 124.8923 },
  'maguindanao del norte': { lat: 7.1088, lng: 124.2073 },
  'maguindanao del sur': { lat: 6.9234, lng: 124.5365 },
  'marinduque': { lat: 13.4167, lng: 121.95 },
  'masbate': { lat: 12.1667, lng: 123.5833 },
  'metro manila': { lat: 14.5736, lng: 121.033 },
  'misamis occidental': { lat: 8.3333, lng: 123.7 },
  'misamis oriental': { lat: 8.6535, lng: 124.8235 },
  'mountain province': { lat: 17.11, lng: 121.16 },
  'negros occidental': { lat: 10.4167, lng: 123 },
  'negros oriental': { lat: 9.75, lng: 123 },
  'northern samar': { lat: 12.42, lng: 124.81 },
  'nueva ecija': { lat: 15.5833, lng: 121 },
  'nueva vizcaya': { lat: 16.35, lng: 121.13 },
  'occidental mindoro': { lat: 13, lng: 120.9167 },
  'oriental mindoro': { lat: 13.2, lng: 121.2 },
  'palawan': { lat: 9.8778, lng: 118.6765 }, // mainland-island centroid, not the province polygon centroid — that one lands ~282km offshore in the Sulu Sea because Palawan's administrative territory includes the Kalayaan (Spratly) islands, which drags a polygon centroid out to sea
  'pampanga': { lat: 15.052, lng: 120.6445 },
  'pangasinan': { lat: 15.9167, lng: 120.3333 },
  // NOTE: Quezon PROVINCE, not Quezon CITY (Metro Manila) — the two share a
  // name and a naive Nominatim query for "Quezon, Philippines" resolves to
  // the city (14.6511, 121.0486), ~91km from the province's own Tayabas/
  // Lucena. Regenerating this table must re-disambiguate with something
  // like "Quezon, Calabarzon, Philippines" and reverse-geocode-verify the
  // result lands inside the province, not the city.
  'quezon': { lat: 13.9, lng: 122.0 },
  'quirino': { lat: 16.2833, lng: 121.5833 },
  'rizal': { lat: 14.65, lng: 121.25 },
  'romblon': { lat: 12.5, lng: 122.2 },
  'samar': { lat: 11.7982, lng: 125.169 },
  'sarangani': { lat: 5.8747, lng: 125.2753 },
  'siquijor': { lat: 9.18, lng: 123.58 },
  'sorsogon': { lat: 12.8333, lng: 123.9167 },
  'south cotabato': { lat: 6.2855, lng: 124.9333 },
  'southern leyte': { lat: 10.3475, lng: 125.1251 },
  'sultan kudarat': { lat: 6.5557, lng: 124.3271 },
  'sulu': { lat: 5.9943, lng: 121.0788 },
  'surigao del norte': { lat: 9.7023, lng: 125.5465 },
  'surigao del sur': { lat: 8.84, lng: 126.15 },
  'tarlac': { lat: 15.4937, lng: 120.4964 },
  'tawi-tawi': { lat: 5.2057, lng: 120.0265 },
  'zambales': { lat: 15.23, lng: 120.12 },
  // Verified on land (reverse-geocodes to a real road in Lawaan, Tampilisan,
  // Zamboanga del Norte) despite the round-looking numbers and the 99km
  // distance from Dipolog — the province is large/elongated and its
  // administrative polygon centroid genuinely sits inland, well south of
  // the coastal city. Not an error; left as-is.
  'zamboanga del norte': { lat: 8, lng: 122.6667 },
  'zamboanga del sur': { lat: 7.9043, lng: 123.3194 },
  'zamboanga sibugay': { lat: 7.7877, lng: 122.5744 },
}

// ~145 chartered cities, keyed lowercase and "city"-stripped (matching
// normalize() below). A handful of city names repeat across provinces
// (San Fernando in La Union/Pampanga, San Carlos in Pangasinan/Negros
// Occidental, Talisay in Cebu/Negros Occidental) — each plain key here
// holds the more populous city's coordinates; the other city's real
// coordinates live in CITY_COORDS_PROVINCE_OVERRIDE below, keyed by
// province, and getCityCoordinates() always resolves a name against the
// SELECTED PROVINCE's own cities before ever touching this flat table (see
// that function's comment), so which city a bare "Talisay" et al. resolves
// to depends on the province dropdown, not on which one happens to be
// listed here. Two short aliases ('samal', 'muñoz') are added alongside
// their full official-name keys so the common short form still resolves
// directly.
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'caloocan': { lat: 14.6513, lng: 120.9724 }, // Caloocan (Metro Manila)
  'las piñas': { lat: 14.4809, lng: 120.9818 }, // Las Piñas (Metro Manila)
  'makati': { lat: 14.5568, lng: 121.0211 }, // Makati (Metro Manila)
  'malabon': { lat: 14.6579, lng: 120.9511 }, // Malabon (Metro Manila)
  'mandaluyong': { lat: 14.5774, lng: 121.0339 }, // Mandaluyong (Metro Manila)
  'manila': { lat: 14.5904, lng: 120.9804 }, // Manila (Metro Manila)
  'marikina': { lat: 14.6331, lng: 121.0994 }, // Marikina (Metro Manila)
  'muntinlupa': { lat: 14.3893, lng: 121.0449 }, // Muntinlupa (Metro Manila)
  'navotas': { lat: 14.6572, lng: 120.948 }, // Navotas (Metro Manila)
  'parañaque': { lat: 14.5008, lng: 120.9915 }, // Parañaque (Metro Manila)
  'pasay': { lat: 14.5437, lng: 120.9947 }, // Pasay (Metro Manila)
  'pasig': { lat: 14.5605, lng: 121.0764 }, // Pasig (Metro Manila)
  'quezon': { lat: 14.6511, lng: 121.0486 }, // Quezon City (Metro Manila)
  'san juan': { lat: 14.6044, lng: 121.0299 }, // San Juan (Metro Manila)
  'taguig': { lat: 14.5271, lng: 121.0745 }, // Taguig (Metro Manila)
  'valenzuela': { lat: 14.6917, lng: 120.9695 }, // Valenzuela (Metro Manila)
  'butuan': { lat: 8.9477, lng: 125.5432 }, // Butuan (Agusan del Norte)
  'cabadbaran': { lat: 9.1233, lng: 125.5322 }, // Cabadbaran (Agusan del Norte)
  'bayugan': { lat: 8.7146, lng: 125.7482 }, // Bayugan (Agusan del Sur)
  'legazpi': { lat: 13.1389, lng: 123.7346 }, // Legazpi (Albay)
  'ligao': { lat: 13.2403, lng: 123.5365 }, // Ligao (Albay)
  'tabaco': { lat: 13.3593, lng: 123.7302 }, // Tabaco (Albay)
  'lamitan': { lat: 6.6576, lng: 122.145 }, // Lamitan (Basilan)
  'isabela': { lat: 6.7054, lng: 121.9711 }, // Isabela City (Basilan)
  'balanga': { lat: 14.6796, lng: 120.541 }, // Balanga (Bataan)
  'batangas': { lat: 13.7553, lng: 121.0591 }, // Batangas City (Batangas)
  'lipa': { lat: 13.9414, lng: 121.1643 }, // Lipa (Batangas)
  'tanauan': { lat: 14.0874, lng: 121.1013 }, // Tanauan (Batangas)
  'santo tomas': { lat: 14.1078, lng: 121.1453 }, // Santo Tomas (Batangas)
  'baguio': { lat: 16.412, lng: 120.5934 }, // Baguio (Benguet)
  'tagbilaran': { lat: 9.6403, lng: 123.856 }, // Tagbilaran (Bohol)
  'malaybalay': { lat: 8.155, lng: 125.1306 }, // Malaybalay (Bukidnon)
  'valencia': { lat: 7.9029, lng: 125.0898 }, // Valencia (Bukidnon)
  'malolos': { lat: 14.8438, lng: 120.8114 }, // Malolos (Bulacan)
  'meycauayan': { lat: 14.7345, lng: 120.9572 }, // Meycauayan (Bulacan)
  'san jose del monte': { lat: 14.8102, lng: 121.0474 }, // San Jose del Monte (Bulacan)
  'tuguegarao': { lat: 17.6119, lng: 121.73 }, // Tuguegarao (Cagayan)
  'iriga': { lat: 13.4223, lng: 123.4129 }, // Iriga (Camarines Sur)
  'naga': { lat: 13.624, lng: 123.185 }, // Naga (Camarines Sur)
  'roxas': { lat: 11.5895, lng: 122.7501 }, // Roxas (Capiz)
  'bacoor': { lat: 14.4593, lng: 120.9402 }, // Bacoor (Cavite)
  'cavite': { lat: 14.4821, lng: 120.9089 }, // Cavite City (Cavite)
  'dasmariñas': { lat: 14.3271, lng: 120.9371 }, // Dasmariñas (Cavite)
  'general trias': { lat: 14.3861, lng: 120.8803 }, // General Trias (Cavite)
  'imus': { lat: 14.429, lng: 120.9366 }, // Imus (Cavite)
  'tagaytay': { lat: 14.0993, lng: 120.9392 }, // Tagaytay (Cavite)
  'trece martires': { lat: 14.2822, lng: 120.8684 }, // Trece Martires (Cavite)
  'bogo': { lat: 11.0513, lng: 124.0035 }, // Bogo (Cebu)
  'carcar': { lat: 10.1056, lng: 123.6407 }, // Carcar (Cebu)
  'cebu': { lat: 10.2935, lng: 123.9018 }, // Cebu City (Cebu)
  'danao': { lat: 10.5196, lng: 124.0271 }, // Danao (Cebu)
  'lapu-lapu': { lat: 10.3127, lng: 123.9488 }, // Lapu-Lapu (Cebu)
  'mandaue': { lat: 10.3269, lng: 123.9427 }, // Mandaue (Cebu)
  'talisay': { lat: 10.243, lng: 123.8488 }, // Talisay City, Cebu (Cebu)
  'toledo': { lat: 10.3749, lng: 123.6344 }, // Toledo (Cebu)
  'kidapawan': { lat: 7.0096, lng: 125.0905 }, // Kidapawan (Cotabato)
  'panabo': { lat: 7.2999, lng: 125.6807 }, // Panabo (Davao del Norte)
  'island garden of samal': { lat: 7.078, lng: 125.712 }, // Island Garden City of Samal (Davao del Norte)
  'tagum': { lat: 7.4471, lng: 125.8095 }, // Tagum (Davao del Norte)
  'davao': { lat: 7.0648, lng: 125.6081 }, // Davao City (Davao del Sur)
  'digos': { lat: 6.7441, lng: 125.3555 }, // Digos (Davao del Sur)
  'mati': { lat: 6.9522, lng: 126.2167 }, // Mati (Davao Oriental)
  'borongan': { lat: 11.608, lng: 125.4322 }, // Borongan (Eastern Samar)
  'batac': { lat: 18.0547, lng: 120.5645 }, // Batac (Ilocos Norte)
  'laoag': { lat: 18.1954, lng: 120.5927 }, // Laoag (Ilocos Norte)
  'candon': { lat: 17.1928, lng: 120.4484 }, // Candon (Ilocos Sur)
  'vigan': { lat: 17.5754, lng: 120.3875 }, // Vigan (Ilocos Sur)
  'iloilo': { lat: 10.6933, lng: 122.5733 }, // Iloilo City (Iloilo)
  'passi': { lat: 11.1052, lng: 122.6417 }, // Passi (Iloilo)
  'cauayan': { lat: 16.9346, lng: 121.7744 }, // Cauayan (Isabela)
  'ilagan': { lat: 17.1486, lng: 121.8886 }, // Ilagan (Isabela)
  'santiago': { lat: 16.6916, lng: 121.5479 }, // Santiago (Isabela)
  'tabuk': { lat: 17.4112, lng: 121.4414 }, // Tabuk (Kalinga)
  'biñan': { lat: 14.3388, lng: 121.0842 }, // Biñan (Laguna)
  'cabuyao': { lat: 14.2801, lng: 121.1235 }, // Cabuyao (Laguna)
  'calamba': { lat: 14.206, lng: 121.1556 }, // Calamba (Laguna)
  'san pablo': { lat: 14.0701, lng: 121.3256 }, // San Pablo (Laguna)
  'san pedro': { lat: 14.3639, lng: 121.0568 }, // San Pedro (Laguna)
  'santa rosa': { lat: 14.3146, lng: 121.1137 }, // Santa Rosa (Laguna)
  'iligan': { lat: 8.2282, lng: 124.2412 }, // Iligan (Lanao del Norte)
  'marawi': { lat: 8.0047, lng: 124.2854 }, // Marawi (Lanao del Sur)
  'baybay': { lat: 10.6778, lng: 124.7978 }, // Baybay (Leyte)
  'ormoc': { lat: 11.0053, lng: 124.6091 }, // Ormoc (Leyte)
  'tacloban': { lat: 11.2432, lng: 125.0083 }, // Tacloban (Leyte)
  'cotabato': { lat: 7.2238, lng: 124.2467 }, // Cotabato City (Maguindanao del Norte)
  'masbate': { lat: 12.3711, lng: 123.6239 }, // Masbate City (Masbate)
  'oroquieta': { lat: 8.4859, lng: 123.8078 }, // Oroquieta (Misamis Occidental)
  'ozamiz': { lat: 8.147, lng: 123.846 }, // Ozamiz (Misamis Occidental)
  'tangub': { lat: 8.0609, lng: 123.7513 }, // Tangub (Misamis Occidental)
  'cagayan de oro': { lat: 8.4756, lng: 124.6422 }, // Cagayan de Oro (Misamis Oriental)
  'el salvador': { lat: 8.5622, lng: 124.5243 }, // El Salvador City (Misamis Oriental)
  'gingoog': { lat: 8.8233, lng: 125.1013 }, // Gingoog (Misamis Oriental)
  'bacolod': { lat: 10.6763, lng: 122.9514 }, // Bacolod (Negros Occidental)
  'bago': { lat: 10.5376, lng: 122.8353 }, // Bago (Negros Occidental)
  'cadiz': { lat: 10.9567, lng: 123.3057 }, // Cadiz (Negros Occidental)
  'escalante': { lat: 10.8413, lng: 123.4993 }, // Escalante (Negros Occidental)
  'himamaylan': { lat: 10.0993, lng: 122.8705 }, // Himamaylan (Negros Occidental)
  'kabankalan': { lat: 9.9889, lng: 122.8135 }, // Kabankalan (Negros Occidental)
  'la carlota': { lat: 10.4269, lng: 122.9208 }, // La Carlota (Negros Occidental)
  'sagay': { lat: 10.8961, lng: 123.4155 }, // Sagay (Negros Occidental)
  'silay': { lat: 10.7994, lng: 122.9756 }, // Silay (Negros Occidental)
  'sipalay': { lat: 9.7491, lng: 122.4041 }, // Sipalay (Negros Occidental)
  'victorias': { lat: 10.9013, lng: 123.0715 }, // Victorias (Negros Occidental)
  'bais': { lat: 9.5915, lng: 123.1214 }, // Bais (Negros Oriental)
  'bayawan': { lat: 9.3662, lng: 122.8048 }, // Bayawan (Negros Oriental)
  'canlaon': { lat: 10.387, lng: 123.2186 }, // Canlaon (Negros Oriental)
  'dumaguete': { lat: 9.3055, lng: 123.308 }, // Dumaguete (Negros Oriental)
  'guihulngan': { lat: 10.1196, lng: 123.2739 }, // Guihulngan (Negros Oriental)
  'tanjay': { lat: 9.5165, lng: 123.1566 }, // Tanjay (Negros Oriental)
  'cabanatuan': { lat: 15.4905, lng: 120.9684 }, // Cabanatuan (Nueva Ecija)
  'gapan': { lat: 15.3123, lng: 120.9479 }, // Gapan (Nueva Ecija)
  'science of muñoz': { lat: 15.7135, lng: 120.9039 }, // Science City of Muñoz (Nueva Ecija)
  'palayan': { lat: 15.5409, lng: 121.0843 }, // Palayan (Nueva Ecija)
  'san jose': { lat: 15.7576, lng: 121.0106 }, // San Jose City, Nueva Ecija (Nueva Ecija)
  'calapan': { lat: 13.4146, lng: 121.1795 }, // Calapan (Oriental Mindoro)
  'puerto princesa': { lat: 9.7399, lng: 118.7438 }, // Puerto Princesa (Palawan)
  'angeles': { lat: 15.1348, lng: 120.5907 }, // Angeles City (Pampanga)
  'san fernando': { lat: 15.0283, lng: 120.6938 }, // San Fernando City, Pampanga (Pampanga)
  'mabalacat': { lat: 15.2251, lng: 120.5734 }, // Mabalacat (Pampanga)
  'alaminos': { lat: 16.1554, lng: 119.9792 }, // Alaminos (Pangasinan)
  'dagupan': { lat: 16.043, lng: 120.3338 }, // Dagupan (Pangasinan)
  'san carlos': { lat: 15.9261, lng: 120.3464 }, // San Carlos City, Pangasinan (Pangasinan)
  'urdaneta': { lat: 15.976, lng: 120.5669 }, // Urdaneta (Pangasinan)
  'lucena': { lat: 13.9358, lng: 121.6129 }, // Lucena (Quezon)
  'tayabas': { lat: 14.0263, lng: 121.5918 }, // Tayabas (Quezon)
  'antipolo': { lat: 14.5872, lng: 121.1759 }, // Antipolo (Rizal)
  'calbayog': { lat: 12.067, lng: 124.5947 }, // Calbayog (Samar)
  'catbalogan': { lat: 11.7753, lng: 124.8831 }, // Catbalogan (Samar)
  'sorsogon': { lat: 12.9708, lng: 124.0053 }, // Sorsogon City (Sorsogon)
  'general santos': { lat: 6.1122, lng: 125.1722 }, // General Santos (South Cotabato)
  'koronadal': { lat: 6.5004, lng: 124.8435 }, // Koronadal (South Cotabato)
  'maasin': { lat: 10.1325, lng: 124.8385 }, // Maasin (Southern Leyte)
  'tacurong': { lat: 6.6884, lng: 124.6787 }, // Tacurong (Sultan Kudarat)
  'surigao': { lat: 9.7905, lng: 125.4936 }, // Surigao City (Surigao del Norte)
  'bislig': { lat: 8.2131, lng: 126.3156 }, // Bislig (Surigao del Sur)
  'tandag': { lat: 9.08, lng: 126.1975 }, // Tandag (Surigao del Sur)
  'tarlac': { lat: 15.4861, lng: 120.5893 }, // Tarlac City (Tarlac)
  'olongapo': { lat: 14.8389, lng: 120.2844 }, // Olongapo (Zambales)
  'dapitan': { lat: 8.6549, lng: 123.4244 }, // Dapitan (Zamboanga del Norte)
  'dipolog': { lat: 8.5864, lng: 123.3449 }, // Dipolog (Zamboanga del Norte)
  'pagadian': { lat: 7.825, lng: 123.4366 }, // Pagadian (Zamboanga del Sur)
  'zamboanga': { lat: 6.9047, lng: 122.0765 }, // Zamboanga City (Zamboanga del Sur)
  'samal': { lat: 7.078, lng: 125.712 }, // Island Garden City of Samal (alias) (Davao del Norte)
  'muñoz': { lat: 15.7135, lng: 120.9039 }, // Science City of Muñoz (alias) (Nueva Ecija)
}

/**
 * Coordinates for the less-populous city of each name that repeats across
 * provinces, keyed by `'<provinceKey>|<cityKey>'`. CITY_COORDS above holds
 * only one entry per name (the more populous city); getCityCoordinates()
 * checks here first whenever it has matched a city within a specific
 * selected province, so e.g. province "Negros Occidental" + city "Talisay"
 * correctly returns Negros Occidental's Talisay rather than Cebu's (the one
 * CITY_COORDS['talisay'] holds).
 */
const CITY_COORDS_PROVINCE_OVERRIDE: Record<string, { lat: number; lng: number }> = {
  'negros occidental|talisay': { lat: 10.7373, lng: 122.9673 }, // Talisay City, Negros Occidental
  'negros occidental|san carlos': { lat: 10.486, lng: 123.419 }, // San Carlos City, Negros Occidental
  'la union|san fernando': { lat: 16.6048, lng: 120.303 }, // San Fernando City, La Union
}

/** Cities grouped by province, for the province-scoped resolution in
 *  getCityCoordinates() below. Plain, unqualified keys — a city that also
 *  appears in CITY_COORDS_PROVINCE_OVERRIDE for its province resolves via
 *  that override rather than the flat CITY_COORDS entry. */
const CITIES_BY_PROVINCE: Record<string, string[]> = {
  'metro manila': ['caloocan', 'las piñas', 'makati', 'malabon', 'mandaluyong', 'manila', 'marikina', 'muntinlupa', 'navotas', 'parañaque', 'pasay', 'pasig', 'quezon', 'san juan', 'taguig', 'valenzuela'],
  'agusan del norte': ['butuan', 'cabadbaran'],
  'agusan del sur': ['bayugan'],
  'albay': ['legazpi', 'ligao', 'tabaco'],
  'basilan': ['lamitan', 'isabela'],
  'bataan': ['balanga'],
  'batangas': ['batangas', 'lipa', 'tanauan', 'santo tomas'],
  'benguet': ['baguio'],
  'bohol': ['tagbilaran'],
  'bukidnon': ['malaybalay', 'valencia'],
  'bulacan': ['malolos', 'meycauayan', 'san jose del monte'],
  'cagayan': ['tuguegarao'],
  'camarines sur': ['iriga', 'naga'],
  'capiz': ['roxas'],
  'cavite': ['bacoor', 'cavite', 'dasmariñas', 'general trias', 'imus', 'tagaytay', 'trece martires'],
  'cebu': ['bogo', 'carcar', 'cebu', 'danao', 'lapu-lapu', 'mandaue', 'talisay', 'toledo'],
  'cotabato': ['kidapawan'],
  'davao del norte': ['panabo', 'island garden of samal', 'tagum', 'samal'],
  'davao del sur': ['davao', 'digos'],
  'davao oriental': ['mati'],
  'eastern samar': ['borongan'],
  'ilocos norte': ['batac', 'laoag'],
  'ilocos sur': ['candon', 'vigan'],
  'iloilo': ['iloilo', 'passi'],
  'isabela': ['cauayan', 'ilagan', 'santiago'],
  'kalinga': ['tabuk'],
  'la union': ['san fernando'],
  'laguna': ['biñan', 'cabuyao', 'calamba', 'san pablo', 'san pedro', 'santa rosa'],
  'lanao del norte': ['iligan'],
  'lanao del sur': ['marawi'],
  'leyte': ['baybay', 'ormoc', 'tacloban'],
  'maguindanao del norte': ['cotabato'],
  'masbate': ['masbate'],
  'misamis occidental': ['oroquieta', 'ozamiz', 'tangub'],
  'misamis oriental': ['cagayan de oro', 'el salvador', 'gingoog'],
  'negros occidental': ['bacolod', 'bago', 'cadiz', 'escalante', 'himamaylan', 'kabankalan', 'la carlota', 'sagay', 'san carlos', 'silay', 'sipalay', 'talisay', 'victorias'],
  'negros oriental': ['bais', 'bayawan', 'canlaon', 'dumaguete', 'guihulngan', 'tanjay'],
  'nueva ecija': ['cabanatuan', 'gapan', 'science of muñoz', 'palayan', 'san jose', 'muñoz'],
  'oriental mindoro': ['calapan'],
  'palawan': ['puerto princesa'],
  'pampanga': ['angeles', 'san fernando', 'mabalacat'],
  'pangasinan': ['alaminos', 'dagupan', 'san carlos', 'urdaneta'],
  'quezon': ['lucena', 'tayabas'],
  'rizal': ['antipolo'],
  'samar': ['calbayog', 'catbalogan'],
  'sorsogon': ['sorsogon'],
  'south cotabato': ['general santos', 'koronadal'],
  'southern leyte': ['maasin'],
  'sultan kudarat': ['tacurong'],
  'surigao del norte': ['surigao'],
  'surigao del sur': ['bislig', 'tandag'],
  'tarlac': ['tarlac'],
  'zambales': ['olongapo'],
  'zamboanga del norte': ['dapitan', 'dipolog'],
  'zamboanga del sur': ['pagadian', 'zamboanga'],
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bcity\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cityCoordsFor(cityKey: string, provinceKey: string) {
  return CITY_COORDS_PROVINCE_OVERRIDE[`${provinceKey}|${cityKey}`] ?? CITY_COORDS[cityKey]
}

/**
 * Resolution order — PROVINCE-SCOPED FIRST, deliberately:
 *   1. Exact match among the selected province's own cities.
 *   2. Longest substring match among the selected province's own cities
 *      (handles free text like "NAGA CITY CAMARINES SUR").
 *   3. Flat city lookup across ALL cities (fallback for a legacy/unknown
 *      province value, e.g. old rows saved with province "Other").
 *   4. Province center.
 *   5. Manila.
 *
 * An earlier version tried the flat lookup (now step 3) first. That's
 * backwards: province is a required dropdown field, so it is *always*
 * known and is strictly better evidence than a bare city string — but
 * flat-first meant a host who selected the LESS populous province of a
 * name that repeats (Talisay: Cebu/Negros Occidental; San Fernando:
 * Pampanga/La Union; San Carlos: Pangasinan/Negros Occidental) and typed
 * just the bare city name got the OTHER province's — sometimes a different
 * island entirely — coordinates, because the flat map matched before the
 * selected province was ever consulted. Checking the selected province's
 * own city list first fixes that while still letting a host who picked the
 * wrong or legacy province, but typed a real unique city name, resolve via
 * step 3. Always returns a pin; never throws.
 */
export function getCityCoordinates(city: string, province: string) {
  const cityKey = normalize(city)
  const provinceKey = normalize(province)

  // Longest names first, so "san jose del monte" beats "san jose" and an
  // exact match is naturally tried before a shorter candidate could
  // substring-match part of a longer one.
  const ownCities = (CITIES_BY_PROVINCE[provinceKey] ?? [])
    .slice()
    .sort((a, b) => b.length - a.length)

  // 1. Exact match among the selected province's own cities.
  for (const candidate of ownCities) {
    if (candidate === cityKey) return cityCoordsFor(candidate, provinceKey)
  }

  // 2. Longest substring match among the selected province's own cities.
  for (const candidate of ownCities) {
    if (cityKey.includes(candidate)) return cityCoordsFor(candidate, provinceKey)
  }

  // 3. Flat lookup — wrong or legacy province, but a real unique city name.
  if (CITY_COORDS[cityKey]) return CITY_COORDS[cityKey]

  // 4. Province center, 5. Manila.
  return PROVINCE_COORDS[provinceKey] ?? PROVINCE_COORDS['metro manila']
}

// ───────────────────────────────────────────────────────────────────────────
// Search-bar location suggestions
// ───────────────────────────────────────────────────────────────────────────
//
// Derived from CITIES_BY_PROVINCE / PH_PROVINCES above rather than kept as its
// own list. The search bar previously hardcoded four destinations of its own
// ('Manila, Philippines', 'Cebu City, Philippines', …) in searchBarData.ts,
// which is the same separate-second-list shape that made the province dropdown
// and the coordinate table drift apart — the bug this file's header documents.
// Deriving means adding a city for the map automatically offers it in search.

/**
 * Official city names that differ from a plain title-case of their lookup key.
 * The keys above are deliberately short ('cebu', 'quezon') because that is what
 * getCityCoordinates() matches free-text host input against; this table only
 * affects what a human reads in the dropdown.
 */
const CITY_DISPLAY_NAMES: Record<string, string> = {
  'angeles': 'Angeles City',
  'batangas': 'Batangas City',
  'cavite': 'Cavite City',
  'cebu': 'Cebu City',
  'cotabato': 'Cotabato City',
  'davao': 'Davao City',
  'el salvador': 'El Salvador City',
  'iloilo': 'Iloilo City',
  'isabela': 'Isabela City',
  'island garden of samal': 'Island Garden City of Samal',
  'masbate': 'Masbate City',
  'quezon': 'Quezon City',
  'san carlos': 'San Carlos City',
  'san fernando': 'San Fernando City',
  'san jose': 'San Jose City',
  'science of muñoz': 'Science City of Muñoz',
  'sorsogon': 'Sorsogon City',
  'surigao': 'Surigao City',
  'talisay': 'Talisay City',
  'tarlac': 'Tarlac City',
  'zamboanga': 'Zamboanga City',
}

/**
 * Short convenience aliases that CITIES_BY_PROVINCE carries alongside the full
 * name of the same city, so getCityCoordinates() resolves either spelling.
 * They must NOT become their own suggestions, or the dropdown shows the same
 * place twice ("Island Garden City of Samal" and "Samal", both Davao del Norte).
 */
const ALIAS_CITY_KEYS = new Set(['samal', 'muñoz'])

function titleCase(key: string): string {
  return key.replace(/(^|[\s-])([a-zñ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

export interface PhLocation {
  /** Official display name, e.g. "Cebu City". */
  city: string
  /** Province display name, e.g. "Cebu". */
  province: string
  /**
   * The value handed to the search page's `?city=` filter. Deliberately the
   * SHORT key ("Cebu"), not the display name ("Cebu City"): searchListings()
   * matches with `ilike '%value%'` against a free-text column hosts type
   * themselves, which really does hold both forms — the live database has
   * "Cebu City", "Quezon City" and "Naga City" alongside bare "Manila",
   * "Makati" and "Pasig". The short key is a substring of the long form, so it
   * matches both; searching "Cebu City" would silently miss a listing whose
   * host simply typed "Cebu".
   */
  value: string
  /** Lowercase haystack for matching a typed query. */
  haystack: string
}

/** Every city the map can pin, as a search suggestion. One entry per
 *  (province, city) pair, so a repeated name like Talisay correctly offers
 *  both its Cebu and its Negros Occidental entry. */
export const PH_LOCATIONS: PhLocation[] = (() => {
  const provinceDisplay = new Map(PH_PROVINCES.map((p) => [normalize(p), p]))
  const out: PhLocation[] = []
  for (const [provinceKey, cityKeys] of Object.entries(CITIES_BY_PROVINCE)) {
    const province = provinceDisplay.get(provinceKey) ?? titleCase(provinceKey)
    for (const cityKey of cityKeys) {
      if (ALIAS_CITY_KEYS.has(cityKey)) continue
      const city = CITY_DISPLAY_NAMES[cityKey] ?? titleCase(cityKey)
      out.push({
        city,
        province,
        value: titleCase(cityKey),
        haystack: `${city} ${province}`.toLowerCase(),
      })
    }
  }
  return out.sort((a, b) => a.city.localeCompare(b.city))
})()

/** Shown when the Where field is empty — the metros that actually carry most
 *  of the marketplace's listings, rather than a per-user history the app does
 *  not record. */
const FEATURED_CITY_VALUES = ['Manila', 'Quezon', 'Makati', 'Cebu', 'Davao', 'Baguio']

export const PH_FEATURED_LOCATIONS: PhLocation[] = FEATURED_CITY_VALUES
  .map((v) => PH_LOCATIONS.find((l) => l.value === v))
  .filter((l): l is PhLocation => l !== undefined)

export interface PhLocationResults {
  /** Places matching what was typed, best match first. */
  matches: PhLocation[]
  /**
   * Other cities in the same province as the best match — "related to the
   * location being typed". Empty when nothing was typed, or when the province
   * has no other city that isn't already in `matches`.
   */
  related: PhLocation[]
  /** Province the `related` list belongs to, for its heading. */
  relatedProvince: string | null
}

/**
 * Ranks locations against a typed query.
 *
 * Ordering is by where the query hits, so typing "cebu" surfaces Cebu City
 * before Danao/Talisay (which match only on their province name):
 *   0 — city name starts with the query
 *   1 — city name contains it
 *   2 — province name starts with it
 *   3 — anything else that matches at all
 */
export function searchPhLocations(query: string, limit = 6): PhLocationResults {
  const q = query.trim().toLowerCase()
  if (!q) {
    return { matches: PH_FEATURED_LOCATIONS.slice(0, limit), related: [], relatedProvince: null }
  }

  const scored: { loc: PhLocation; rank: number }[] = []
  for (const loc of PH_LOCATIONS) {
    const city = loc.city.toLowerCase()
    const province = loc.province.toLowerCase()
    let rank = -1
    if (city.startsWith(q)) rank = 0
    else if (city.includes(q)) rank = 1
    else if (province.startsWith(q)) rank = 2
    else if (loc.haystack.includes(q)) rank = 3
    if (rank >= 0) scored.push({ loc, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.loc.city.localeCompare(b.loc.city))

  const matches = scored.slice(0, limit).map((s) => s.loc)
  if (matches.length === 0) {
    return { matches, related: [], relatedProvince: null }
  }

  const relatedProvince = matches[0].province
  const shown = new Set(matches.map((m) => `${m.province}|${m.city}`))
  const related = PH_LOCATIONS
    .filter((l) => l.province === relatedProvince && !shown.has(`${l.province}|${l.city}`))
    .slice(0, limit)

  return { matches, related, relatedProvince: related.length > 0 ? relatedProvince : null }
}
