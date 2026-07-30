// local keyword extraction for job descriptions
// this is deliberately a lexicon-plus-statistics pipeline rather than a hosted model: it runs
// in a couple of milliseconds, works offline, and its output is inspectable, which matters when
// the whole feature is "here is why we think this word is important"

const STOPWORDS = new Set(`a about above across after again against all also am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other others our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves
ability able across additional adhere along among amount applicant applicants application apply as-needed assist available basis benefits candidate candidates career company demonstrate description desired duties employee employees employer employment ensure environment equal etc excellent experience feel firm following full-time gender good great help high highly hiring including industry job join key level look looking make may meet member must need needs new offer office one opportunity opportunities orientation other others part-time people per performing person plus position positions preferred provide provided provides qualified qualifications rate related relevant required requirement requirements responsibilities responsibility role roles salary seeking sexual similar skills someone status strong successful support team teams things time together type upon us use used using value values want we well who work working world year years you'll` .split(/\s+/));

// terms worth surfacing verbatim. Multi-word entries are matched as phrases so "machine
// learning" does not decompose into two weak unigrams
const TECH_LEXICON = [
  "python", "java", "javascript", "typescript", "c", "c++", "c#", "go", "golang", "rust", "ruby", "php", "swift", "kotlin", "scala", "r", "matlab", "perl", "dart", "objective-c", "vba", "bash", "shell scripting", "powershell",
  "html", "css", "sass", "scss", "tailwind", "bootstrap", "react", "react native", "next.js", "vue", "nuxt", "angular", "svelte", "jquery", "redux", "node.js", "express", "deno", "webpack", "vite", "babel",
  "django", "flask", "fastapi", "spring", "spring boot", "rails", "laravel", ".net", "asp.net", "blazor", "gin", "phoenix",
  "sql", "mysql", "postgresql", "postgres", "sqlite", "oracle", "sql server", "mongodb", "redis", "cassandra", "dynamodb", "elasticsearch", "neo4j", "snowflake", "bigquery", "redshift", "databricks",
  "aws", "azure", "gcp", "google cloud", "docker", "kubernetes", "terraform", "ansible", "jenkins", "github actions", "gitlab ci", "circleci", "argo", "helm", "openshift", "cloudformation", "lambda", "ec2", "s3", "rds", "eks",
  "git", "github", "gitlab", "bitbucket", "jira", "confluence", "linux", "unix", "windows server", "nginx", "apache", "kafka", "rabbitmq", "graphql", "rest", "rest api", "grpc", "websockets", "microservices", "serverless", "oauth", "saml", "jwt",
  "pandas", "numpy", "scipy", "scikit-learn", "tensorflow", "pytorch", "keras", "hugging face", "opencv", "spark", "hadoop", "airflow", "dbt", "tableau", "power bi", "looker", "excel", "google sheets", "sas", "spss", "stata",
  "machine learning", "deep learning", "natural language processing", "nlp", "computer vision", "reinforcement learning", "data science", "data analysis", "data engineering", "data visualization", "statistics", "statistical analysis", "a/b testing", "experimentation", "etl", "data modeling", "data pipelines", "predictive modeling", "large language models", "llm", "rag", "prompt engineering",
  "agile", "scrum", "kanban", "waterfall", "ci/cd", "tdd", "unit testing", "integration testing", "end-to-end testing", "code review", "pair programming", "system design", "distributed systems", "object-oriented programming", "functional programming", "design patterns", "data structures", "algorithms", "api design", "performance optimization", "debugging", "refactoring", "observability", "monitoring", "incident response", "security", "penetration testing", "cryptography", "devops", "site reliability", "infrastructure as code",
  "cybersecurity", "information security", "network security", "application security", "cloud security", "vulnerability assessment", "vulnerability management", "malware analysis", "reverse engineering", "binary analysis", "exploit development", "digital forensics", "threat modeling", "threat intelligence", "red team", "blue team", "capture the flag", "ctf", "siem", "soc", "edr", "firewall", "intrusion detection", "zero trust", "access control", "identity management", "wireshark", "nmap", "metasploit", "burp suite", "ghidra", "ida pro", "radare2", "gdb", "volatility", "splunk", "osint", "social engineering", "mitre att&ck", "nist", "iso 27001", "soc 2", "fedramp", "pci dss", "gdpr", "fuzzing", "static analysis", "dynamic analysis", "secure coding", "hardening",
  "embedded systems", "embedded c", "firmware", "fpga", "vhdl", "verilog", "systemverilog", "rtos", "freertos", "microcontroller", "arm", "risc-v", "x86", "assembly", "device drivers", "kernel", "bare metal", "real-time systems", "jtag", "i2c", "spi", "uart", "can bus", "pcb", "oscilloscope", "logic analyzer", "digital design", "computer architecture", "operating systems", "networking", "tcp/ip", "iot", "robotics", "ros", "plc", "scada", "control systems", "signal processing", "raspberry pi", "arduino",
  "figma", "sketch", "adobe xd", "photoshop", "illustrator", "indesign", "after effects", "premiere pro", "blender", "autocad", "solidworks", "revit", "ansys", "labview", "simulink",
  "salesforce", "hubspot", "sap", "workday", "netsuite", "quickbooks", "zendesk", "servicenow", "sharepoint", "tableau server",
  "financial modeling", "valuation", "forecasting", "budgeting", "variance analysis", "gaap", "ifrs", "audit", "tax", "accounts payable", "accounts receivable", "reconciliation", "due diligence", "risk management", "compliance", "underwriting", "portfolio management",
  "market research", "seo", "sem", "content marketing", "email marketing", "social media", "google analytics", "copywriting", "brand strategy", "campaign management", "crm", "lead generation", "customer success", "account management", "sales pipeline", "cold calling", "negotiation",
  "project management", "stakeholder management", "roadmap", "requirements gathering", "user research", "usability testing", "wireframing", "prototyping", "product strategy", "go-to-market", "okrs", "kpis",
  "patient care", "clinical", "hipaa", "emr", "ehr", "phlebotomy", "triage", "medication administration", "care coordination",
  "lesson planning", "curriculum development", "classroom management", "differentiated instruction", "assessment", "iep",
];

const SOFT_SKILLS = [
  "communication", "written communication", "verbal communication", "collaboration", "teamwork", "leadership", "mentoring", "coaching", "problem solving", "critical thinking", "analytical thinking", "attention to detail", "time management", "organization", "adaptability", "flexibility", "initiative", "self-motivated", "ownership", "accountability", "creativity", "innovation", "empathy", "customer focus", "presentation", "public speaking", "facilitation", "conflict resolution", "decision making", "prioritization", "cross-functional", "interpersonal", "multitasking", "resourcefulness", "curiosity", "work ethic", "independently", "fast-paced",
];

const CERTIFICATIONS = [
  "pmp", "cpa", "cfa", "cissp", "ccna", "ccnp", "comptia", "security+", "network+", "a+", "aws certified", "azure certified", "google cloud certified", "scrum master", "csm", "safe", "six sigma", "lean six sigma", "itil", "cpr", "bls", "acls", "rn", "lpn", "pe license", "series 7", "series 63", "shrm", "phr", "sphr", "capm", "cisa", "cism", "ceh", "oscp", "tefl", "toefl",
];

const ACTION_VERBS = [
  "achieved", "accelerated", "administered", "advised", "analyzed", "architected", "authored", "automated", "built", "championed", "collaborated", "conducted", "consolidated", "constructed", "coordinated", "created", "cut", "decreased", "delivered", "designed", "developed", "diagnosed", "directed", "drove", "eliminated", "engineered", "enhanced", "established", "evaluated", "executed", "expanded", "facilitated", "forecasted", "generated", "grew", "guided", "identified", "implemented", "improved", "increased", "influenced", "initiated", "integrated", "introduced", "launched", "led", "leveraged", "maintained", "managed", "mentored", "migrated", "modernized", "negotiated", "operated", "optimized", "orchestrated", "organized", "overhauled", "owned", "partnered", "performed", "pioneered", "planned", "presented", "prioritized", "produced", "programmed", "published", "recommended", "redesigned", "reduced", "refactored", "researched", "resolved", "restructured", "revamped", "saved", "scaled", "secured", "shipped", "simplified", "solved", "spearheaded", "standardized", "streamlined", "strengthened", "supervised", "supported", "surpassed", "tested", "trained", "transformed", "translated", "validated",
];

const WEAK_OPENERS = [
  "worked on", "helped with", "helped to", "responsible for", "assisted with", "assisted in", "involved in", "participated in", "tasked with", "duties included", "was in charge of", "took part in", "familiar with", "exposure to",
];

// some terms are written half a dozen ways. Fold them so counts are honest
const ALIASES = new Map(Object.entries({
  "js": "javascript", "ts": "typescript", "py": "python", "golang": "go",
  "node": "node.js", "nodejs": "node.js", "node js": "node.js",
  "react.js": "react", "reactjs": "react", "vue.js": "vue", "vuejs": "vue", "nextjs": "next.js",
  "postgres": "postgresql", "postgre sql": "postgresql", "ms sql": "sql server",
  "k8s": "kubernetes", "gcp": "google cloud", "amazon web services": "aws",
  "ml": "machine learning", "ai": "machine learning", "dl": "deep learning",
  "ci cd": "ci/cd", "cicd": "ci/cd", "continuous integration": "ci/cd", "continuous delivery": "ci/cd",
  "oop": "object-oriented programming", "ux": "user research", "restful": "rest",
  "scikit learn": "scikit-learn", "sklearn": "scikit-learn", "tf": "tensorflow",
  "powerbi": "power bi", "ms excel": "excel", "microsoft excel": "excel",
  "a b testing": "a/b testing", "ab testing": "a/b testing",
  "infosec": "information security", "appsec": "application security", "netsec": "network security",
  "cyber security": "cybersecurity", "cyber": "cybersecurity",
  "mcu": "microcontroller", "embedded software": "embedded systems", "riscv": "risc-v",
  "att&ck": "mitre att&ck", "capture-the-flag": "capture the flag",
  "hdl": "verilog", "rtos systems": "rtos",
}));

const PHRASES = [...TECH_LEXICON, ...SOFT_SKILLS, ...CERTIFICATIONS].filter((term) => term.includes(" ") || term.includes("/") || term.includes("."));
const SINGLE_TERMS = new Set([...TECH_LEXICON, ...SOFT_SKILLS, ...CERTIFICATIONS].filter((term) => !PHRASES.includes(term)));
const TECH_SET = new Set(TECH_LEXICON);
const SOFT_SET = new Set(SOFT_SKILLS);
const CERT_SET = new Set(CERTIFICATIONS);
const VERB_SET = new Set(ACTION_VERBS);

export const canonical = (term) => {
  const key = String(term).toLowerCase().trim().replace(/\s+/g, " ");
  return ALIASES.get(key) || key;
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// word-boundary counter that tolerates the punctuation in terms like "c++"
export function countTerm(text, term) {
  const escaped = escapeRegex(term);
  const leading = /^[a-z0-9]/i.test(term) ? "(?<![a-z0-9+#.])" : "(?<![a-z0-9])";
  const trailing = /[a-z0-9]$/i.test(term) ? "(?![a-z0-9+#])" : "";
  try {
    return (text.match(new RegExp(`${leading}${escaped}${trailing}`, "gi")) || []).length;
  } catch {
    return (text.match(new RegExp(escaped, "gi")) || []).length;
  }
}

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.\-/]*/g) || [])
    .map((token) => token.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter(Boolean);
}

// weights terms that appear under a requirements heading more heavily
function segmentWeights(text) {
  const segments = [];
  const lines = text.split(/\n+/);
  let weight = 1;
  for (const line of lines) {
    const heading = line.toLowerCase();
    if (/\b(required|requirements|qualifications|must have|you have|what you.{0,6}ll need|minimum)\b/.test(heading) && line.length < 90) weight = 1.7;
    else if (/\b(preferred|nice to have|bonus|plus|desired|a plus)\b/.test(heading) && line.length < 90) weight = 1.25;
    else if (/\b(responsibilities|what you.{0,6}ll do|the role|about (us|the team)|benefits|perks|equal opportunity)\b/.test(heading) && line.length < 90) {
      weight = /benefits|perks|equal opportunity/.test(heading) ? 0.35 : 1.1;
    }
    segments.push({ line, weight });
  }
  return segments;
}

// extracts weighted keywords from a job description
// buckets: Object, wordCount: number}}
export function analyzeJobDescription(description) {
  const text = String(description || "");
  if (!text.trim()) return { terms: [], verbs: [], buckets: emptyBuckets(), wordCount: 0 };

  const segments = segmentWeights(text);
  const scores = new Map();

  const bump = (rawTerm, weight, source) => {
    const term = canonical(rawTerm);
    if (!term || term.length < 2 || STOPWORDS.has(term)) return;
    const existing = scores.get(term) || { term, count: 0, weight: 0, sources: new Set() };
    existing.count += 1;
    existing.weight += weight;
    existing.sources.add(source);
    scores.set(term, existing);
  };

  for (const { line, weight } of segments) {
    const lower = line.toLowerCase();

    for (const phrase of PHRASES) {
      const hits = countTerm(lower, phrase);
      for (let i = 0; i < hits; i += 1) bump(phrase, weight * 1.4, "lexicon");
    }

    const tokens = tokenize(line);
    for (const token of tokens) {
      const term = canonical(token);
      if (SINGLE_TERMS.has(term)) bump(term, weight * 1.4, "lexicon");
      else if (VERB_SET.has(term)) bump(term, weight * 0.6, "verb");
    }

    // domain nouns the lexicon does not know: repeated, non-stopword, and not
    // a bare verb form
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (STOPWORDS.has(token) || token.length < 4 || /^\d/.test(token)) continue;
      if (VERB_SET.has(token)) continue;
      bump(token, weight * 0.35, "corpus");

      const next = tokens[i + 1];
      if (next && !STOPWORDS.has(next) && next.length > 3 && !VERB_SET.has(next)) {
        bump(`${token} ${next}`, weight * 0.4, "corpus");
      }
    }
  }

  const wordCount = tokenize(text).length;
  const minCount = wordCount > 700 ? 2 : 1;

  const terms = Array.from(scores.values())
    .filter((entry) => entry.sources.has("lexicon") || entry.count >= minCount + 1)
    .filter((entry) => !(entry.sources.size === 1 && entry.sources.has("verb")))
    .map((entry) => ({
      term: entry.term,
      count: entry.count,
      weight: Number(entry.weight.toFixed(2)),
      kind: classify(entry.term, entry.sources),
    }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .slice(0, 60);

  const verbs = Array.from(scores.values())
    .filter((entry) => VERB_SET.has(entry.term))
    .map((entry) => ({ term: entry.term, count: entry.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const buckets = emptyBuckets();
  for (const item of terms) buckets[item.kind]?.push(item);

  return { terms, verbs, buckets, wordCount };
}

function emptyBuckets() {
  return { technology: [], skill: [], soft: [], certification: [], domain: [] };
}

function classify(term, sources) {
  if (CERT_SET.has(term)) return "certification";
  if (SOFT_SET.has(term)) return "soft";
  if (TECH_SET.has(term)) {
    return /^(agile|scrum|kanban|waterfall|code review|pair programming|system design|project management|stakeholder management|user research|negotiation|market research)$/.test(term)
      ? "skill"
      : "technology";
  }
  return sources.has("lexicon") ? "skill" : "domain";
}

export { ACTION_VERBS, WEAK_OPENERS, VERB_SET, TECH_SET, SOFT_SET, STOPWORDS, tokenize };
