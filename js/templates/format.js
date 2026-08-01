// date and location presentation
// values are stored exactly as the source wrote them, and reformatted only on the way to the
// page. that keeps the document lossless: switching a format back always restores the original,
// and anything the parser cannot read confidently is left alone rather than guessed at

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_LOOKUP = new Map();
MONTHS.forEach((name, index) => {
  MONTH_LOOKUP.set(name.toLowerCase(), index);
  MONTH_LOOKUP.set(name.slice(0, 3).toLowerCase(), index);
});
MONTH_LOOKUP.set("sept", 8);

const ONGOING = /^(present|current|now|ongoing|to date)$/i;
const SEASONS = /^(spring|summer|fall|autumn|winter)\s+((?:19|20)\d{2})$/i;

// { month: 0-11 or null, year: number or null }
function readDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (ONGOING.test(text)) return { ongoing: true };
  if (SEASONS.test(text)) return { verbatim: text };

  const numeric = text.match(/^(\d{1,2})[/.-]((?:19|20)\d{2})$/);
  if (numeric) return { month: Number(numeric[1]) - 1, year: Number(numeric[2]) };

  const named = text.match(/^([a-z]+)\.?\s*,?\s*((?:19|20)\d{2})$/i);
  if (named) {
    const month = MONTH_LOOKUP.get(named[1].toLowerCase());
    if (month != null) return { month, year: Number(named[2]) };
  }

  const yearOnly = text.match(/^((?:19|20)\d{2})$/);
  if (yearOnly) return { year: Number(yearOnly[1]) };

  return { verbatim: text };
}

export function formatDate(value, format = "asWritten") {
  const parsed = readDate(value);
  if (!parsed) return "";
  if (parsed.ongoing) return "Present";
  if (parsed.verbatim || format === "asWritten") return parsed.verbatim ?? String(value).trim();
  if (parsed.year == null) return String(value).trim();

  const { month, year } = parsed;
  switch (format) {
    case "year":
      return String(year);
    case "numeric":
      return month == null ? String(year) : `${String(month + 1).padStart(2, "0")}/${year}`;
    case "shortMonthYear":
      return month == null ? String(year) : `${MONTHS[month].slice(0, 3)} ${year}`;
    case "monthYear":
      return month == null ? String(year) : `${MONTHS[month]} ${year}`;
    default:
      return String(value).trim();
  }
}

export function formatDateRange(item, format) {
  const start = formatDate(item.start, format);
  const end = formatDate(item.end, format);
  if (start && end) return `${start} - ${end}`;
  return start || end || "";
}

const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands",
};

const NAME_TO_CODE = new Map(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]));
const WORK_MODE = /^(remote|hybrid|on-?site|virtual|telework)$/i;

export function formatLocation(value, format = "asWritten") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (format === "hidden") return "";
  if (format === "asWritten") return text;
  // a work arrangement is not a place, so no format applies to it
  if (WORK_MODE.test(text)) return text;

  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts.slice(0, -1).join(", ") : "";
  const tail = (parts[parts.length - 1] || "").replace(/\s+\d{5}(-\d{4})?$/, "").trim();

  const code = STATES[tail.toUpperCase()] ? tail.toUpperCase() : NAME_TO_CODE.get(tail.toLowerCase());
  if (!code) return text;

  switch (format) {
    case "stateOnly": return code;
    case "cityStateLong": return city ? `${city}, ${STATES[code]}` : STATES[code];
    case "cityState": return city ? `${city}, ${code}` : code;
    default: return text;
  }
}
