// What each professional field changes: who reads the posts, which news matters, what a post
// must never do, and where the news comes from. "tech" is the original, tuned behaviour.

export const FIELD_IDS = ["tech", "health", "finance", "law", "marketing", "education", "other"] as const;
export type FieldId = (typeof FIELD_IDS)[number];

export interface FieldSource {
  name: string;
  url: string;
}

export interface Field {
  id: FieldId;
  /** Shown in the picker. */
  label: string;
  /** Placeholders for the welcome page. */
  roleExample: string;
  topicsExample: string;
  sourceExample: string;
  /** Who reads the posts, as a plural phrase: "developers, builders, founders". */
  audience: string;
  /** One busy reader: "developer or founder". */
  reader: string;
  /** "tech" in "the Nepal tech community". */
  community: string;
  /** Label for the news share in Settings. */
  newsLabel: string;
  /** Scoring rules for the triage step: what is high, what is must-know, what is routine. */
  scoring: string;
  /** One line: what "must_know" and "opportunity" mean here. */
  kinds: string;
  /** Lesson topics: an example of the idea behind a story, and the fallback. */
  lessonExample: string;
  lessonFallback: string;
  /** The "guess" move: what people in this field will do next. */
  guess: string;
  /** The "plain" move: who counts as an outsider. */
  outsider: string;
  /** Extra rules every post in this field must follow (the reviewer checks them too). */
  rules: string[];
  /** Well-known feeds every account in this field starts with (topic news is added from the owner's topics). */
  feeds: FieldSource[];
}

const TECH_SCORING = `  Score highest the items that open an OPPORTUNITY for builders: an API or product becoming free, cheaper or open to third parties; a platform opening to agents or integrations; a new capability that lets one developer do what used to need a team; a pricing or policy change; a market gap created by a launch or shutdown. Score just as high the MUST-KNOW stories a developer would be embarrassed to have missed: a critical vulnerability or supply-chain attack in widely used software (a language runtime, framework, package registry, popular library), a major outage, a breaking change or shutdown of a platform many developers rely on. These need no opportunity; their angle is what developers should do now (patch, check exposure, rotate keys) or the lesson it teaches. Rate them 8-10 by how many developers are affected.
  Also score 8-9 a MAJOR shift from the leading AI labs or big platforms (OpenAI, Anthropic, Google, Meta, Microsoft, Apple, Nvidia) that changes how AI is built, trained, priced, regulated or used by developers: a change of training or data policy, a model or pricing change, a safety or access decision. These are what the audience talks about this week. Ordinary product updates and blog posts stay below 7.
  Items marked "[covered by N other outlets]" are stories the audience is hearing about everywhere; when one is within the owner's expertise, score it at least 7 and pick the most informative item of the story.
  Routine releases are NOT must-know: scheduled patch or point releases (Node.js x.y.z, OpenSSL, Chrome, Python, Linux kernel), security releases that fix bugs nobody is exploiting, changelogs, minor version bumps and feature lists of developer tools score at most 5. Only an actively exploited flaw, or one the whole industry is talking about, lifts a release higher.
  Ask: would a typical developer or founder bring this up with a friend this week? If only the maintainers or heavy users of one tool would care, it scores at most 5.`;

/** Scoring rules for every field but tech, from three field-specific parts. */
function scoring(f: { mustKnow: string; opportunity: string; routine: string; friend: string }) {
  return `  Score highest the MUST-KNOW stories people in this field would be embarrassed to have missed: ${f.mustKnow}. Their angle is what changes for these readers and what they should check or do now, as far as the material says. Rate them 8-10 by how many people in the field are affected.
  Score just as high the OPPORTUNITIES: ${f.opportunity}.
  Items marked "[covered by N other outlets]" are stories the audience is hearing about everywhere; when one is within the owner's expertise, score it at least 7 and pick the most informative item of the story.
  Routine items are NOT must-know: ${f.routine} score at most 5.
  Ask: ${f.friend} If only a small group inside the field would care, it scores at most 5.`;
}

const NO_CONFIDENTIAL = "Never include names or identifying details of clients, patients, students or colleagues, even if the owner's note mentions them.";

export const FIELDS: Record<FieldId, Field> = {
  tech: {
    id: "tech",
    label: "Software & tech",
    roleExample: "e.g. Backend engineer at a fintech",
    topicsExample: "e.g. Go, payments, Postgres, system design",
    sourceExample: "e.g. go.dev/blog or reddit.com/r/golang",
    audience: "developers, builders, founders",
    reader: "developer or founder",
    community: "tech",
    newsLabel: "Tech news",
    scoring: TECH_SCORING,
    kinds: `"must_know" for the must-know events above (vulnerabilities, attacks, outages, shutdowns), "opportunity" for openings builders can act on, "other" for everything else.`,
    lessonExample: `A supply-chain attack on a popular package → "what a supply-chain attack is and how one bad dependency reaches your app"; a certificate authority caught issuing bad certificates → "what a certificate authority actually vouches for"; a decompression bug in a common library → "what a decompression bomb is".`,
    lessonFallback: `a common, costly mistake or a concept many developers half-understand. Never a generic "how to use <tool> for <task>" tutorial (no "Using Next.js middleware for auth", "Deploying X on Netlify", "Managing rate limits in a SaaS"). Those read like documentation, not a post.`,
    guess: "A guess about what builders will do next, worded freshly and clearly as a guess (no stock phrases).",
    outsider: "a smart friend outside tech",
    rules: [],
    feeds: [], // tech uses the original DEFAULT_SOURCES list
  },
  health: {
    id: "health",
    label: "Healthcare & medicine",
    roleExample: "e.g. Ophthalmologist running a private eye clinic",
    topicsExample: "e.g. glaucoma, cataract surgery, diabetic eye disease, myopia in children",
    sourceExample: "e.g. aao.org or a journal you read",
    audience: "doctors, nurses and other clinicians, plus patients who follow health news",
    reader: "clinician or patient",
    community: "medical",
    newsLabel: "Health news",
    scoring: scoring({
      mustKnow: "a drug or device recall or safety warning; a major change to clinical guidelines or screening advice; an outbreak or public-health alert; a regulator decision (FDA, EMA or the national regulator) that changes what clinicians can use or prescribe",
      opportunity: "a new approval, treatment, device or test that changes practice; a large, well-run study (randomised trial or meta-analysis) with a clear result; a change to reimbursement, licensing or practice rules",
      routine: "single small studies, animal or lab studies, early-stage research press releases, conference abstracts, hospital PR and awards",
      friend: "would a typical clinician in this field mention this to a colleague this week?",
    }),
    kinds: `"must_know" for recalls, safety warnings, guideline changes and public-health alerts, "opportunity" for new treatments, approvals and strong evidence that change practice, "other" for everything else.`,
    lessonExample: `A drug recall → "what a recall means for patients already taking it"; a new screening guideline → "why screening ages change and what the evidence was"; a headline about a "breakthrough" study → "the difference between a mouse study and a clinical trial".`,
    lessonFallback: `a common misunderstanding patients or junior colleagues have about a condition, test or treatment inside the owner's expertise. Never advice for an individual case.`,
    guess: "A guess about what this could change in clinics or for patients, worded freshly and clearly as a guess.",
    outsider: "a smart friend outside medicine",
    rules: [
      "Never give medical advice to an individual, never diagnose, and never tell readers to start, stop or change a treatment. Talk about the evidence, the guideline or the decision.",
      "Describe research exactly as the material does: say what kind of study it was (trial, review, animal or lab study) when the material says it, and never claim more than it shows. One study is not proof; words like \"cures\", \"proves\" or \"breakthrough\" are not allowed unless quoted.",
      "When a post discusses a treatment, drug or test, end with the short line \"General information, not medical advice.\"",
      NO_CONFIDENTIAL,
    ],
    feeds: [
      { name: "STAT News", url: "https://www.statnews.com/feed/" },
      { name: "WHO news", url: "https://www.who.int/rss-feeds/news-english.xml" },
      { name: "ScienceDaily: Health & Medicine", url: "https://www.sciencedaily.com/rss/health_medicine.xml" },
      { name: "KFF Health News", url: "https://kffhealthnews.org/feed/" },
    ],
  },
  finance: {
    id: "finance",
    label: "Finance & accounting",
    roleExample: "e.g. Chartered accountant advising small businesses",
    topicsExample: "e.g. VAT, small-business tax, IFRS, payroll, audit",
    sourceExample: "e.g. your tax authority's news page or a finance newsletter",
    audience: "accountants, finance professionals, business owners and founders",
    reader: "accountant or business owner",
    community: "business",
    newsLabel: "Finance news",
    scoring: scoring({
      mustKnow: "a change to tax law, rates or filing deadlines; a new or changed accounting or reporting standard (IFRS, GAAP or a national standard); a regulator action or enforcement; a major fraud or audit failure; a central-bank rate decision",
      opportunity: "a new relief, credit, exemption or simplification that saves businesses time or money; a rule change that creates work clients will need help with; a tool or service that changes how the work is done",
      routine: "daily market moves, single-stock picks, earnings recaps, price predictions and opinion columns",
      friend: "would a typical accountant or finance lead mention this to a client or colleague this week?",
    }),
    kinds: `"must_know" for tax, standard and deadline changes, enforcement and major failures, "opportunity" for reliefs and rule changes that create work or savings, "other" for everything else.`,
    lessonExample: `A new filing deadline → "what happens when you file late, and how penalties are worked out"; an audit scandal → "what an auditor actually checks, and what they do not"; a rate decision → "how a central-bank rate reaches a small-business loan".`,
    lessonFallback: `a common, costly mistake business owners make with money, tax or bookkeeping inside the owner's expertise, explained in general terms.`,
    guess: "A guess about what this means for businesses or clients next, worded freshly and clearly as a guess.",
    outsider: "a smart friend who is not an accountant",
    rules: [
      "Never give individual investment, tax or legal advice, and never promise returns or savings. Explain the rule or the news; readers should check their own case with a professional.",
      "Tax and accounting rules differ by country: always say which country, regulator or standard the news is about.",
      NO_CONFIDENTIAL,
    ],
    feeds: [{ name: "CNBC Finance", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" }],
  },
  law: {
    id: "law",
    label: "Law & compliance",
    roleExample: "e.g. Corporate lawyer advising startups",
    topicsExample: "e.g. contracts, employment law, data protection, company formation",
    sourceExample: "e.g. a legal news site or your bar association's news page",
    audience: "lawyers, compliance teams and the businesses they advise",
    reader: "lawyer or business owner",
    community: "legal",
    newsLabel: "Legal news",
    scoring: scoring({
      mustKnow: "a new law or regulation taking effect; a court ruling that changes how a law applies; a compliance deadline; a regulator enforcement action or large fine",
      opportunity: "a rule change that gives businesses or people new rights or obligations, or creates compliance work",
      routine: "minor cases, firm news, awards, hires and opinion pieces",
      friend: "would a typical lawyer in this area mention this to a client this week?",
    }),
    kinds: `"must_know" for new laws, rulings, deadlines and enforcement, "opportunity" for changes that create rights, obligations or compliance work, "other" for everything else.`,
    lessonExample: `A large data-protection fine → "what a regulator looks at when it sets a fine"; a ruling on gig workers → "employee or contractor: the test courts use".`,
    lessonFallback: `a common legal misunderstanding business owners or people have inside the owner's expertise, explained in general terms.`,
    guess: "A guess about what this means for businesses or clients next, worded freshly and clearly as a guess.",
    outsider: "a smart friend who is not a lawyer",
    rules: [
      "Never give legal advice for an individual situation. Explain the law, ruling or decision; readers should get advice on their own case.",
      "Always say which country or jurisdiction the law or ruling belongs to, and never state the likely outcome of a case as fact.",
      NO_CONFIDENTIAL,
    ],
    feeds: [],
  },
  marketing: {
    id: "marketing",
    label: "Marketing & sales",
    roleExample: "e.g. Growth marketer at a B2B SaaS",
    topicsExample: "e.g. SEO, LinkedIn ads, email marketing, B2B sales",
    sourceExample: "e.g. a marketing blog or newsletter you read",
    audience: "marketers, sales people, founders and small-business owners",
    reader: "marketer or founder",
    community: "marketing",
    newsLabel: "Marketing news",
    scoring: scoring({
      mustKnow: "a platform algorithm, policy or pricing change (Google, LinkedIn, Meta, TikTok, X, email providers); a privacy or advertising rule change; a major platform outage or shutdown",
      opportunity: "a new channel, format, ad product or tool; research with real data about what works",
      routine: "listicles, generic tips, agency PR, award announcements and trend predictions without data",
      friend: "would a typical marketer mention this to their team this week?",
    }),
    kinds: `"must_know" for platform, policy and privacy changes and shutdowns, "opportunity" for new channels, formats and tools, "other" for everything else.`,
    lessonExample: `A Google search update → "what a core update is and why traffic moves after one"; a new privacy rule → "what consent actually means for email lists".`,
    lessonFallback: `a common, costly mistake in marketing or sales inside the owner's expertise.`,
    guess: "A guess about what marketers or customers will do next, worded freshly and clearly as a guess.",
    outsider: "a smart friend outside marketing",
    rules: ["Never invent results, case studies or statistics, and never promise results.", NO_CONFIDENTIAL],
    feeds: [
      { name: "Search Engine Land", url: "https://searchengineland.com/feed" },
      { name: "Social Media Today", url: "https://www.socialmediatoday.com/feeds/news/" },
    ],
  },
  education: {
    id: "education",
    label: "Education",
    roleExample: "e.g. Maths teacher and head of department",
    topicsExample: "e.g. maths teaching, exams, classroom technology, student wellbeing",
    sourceExample: "e.g. an education news site or your ministry's news page",
    audience: "teachers, school leaders, lecturers, students and parents",
    reader: "teacher or parent",
    community: "education",
    newsLabel: "Education news",
    scoring: scoring({
      mustKnow: "a change to the curriculum, exams or assessment; an education policy or funding change; school safety guidance",
      opportunity: "new evidence about what helps students learn; a programme, grant or tool teachers can use",
      routine: "school PR, awards, rankings and opinion pieces",
      friend: "would a typical teacher mention this in the staff room this week?",
    }),
    kinds: `"must_know" for curriculum, exam, policy and safety changes, "opportunity" for evidence, programmes and tools teachers can use, "other" for everything else.`,
    lessonExample: `An exam reform → "what changes for students sitting it next year"; a study on homework → "what the evidence actually says about homework".`,
    lessonFallback: `a common misunderstanding about learning or teaching inside the owner's expertise.`,
    guess: "A guess about what this could change in classrooms, worded freshly and clearly as a guess.",
    outsider: "a smart friend outside education",
    rules: [NO_CONFIDENTIAL],
    feeds: [],
  },
  other: {
    id: "other",
    label: "Something else",
    roleExample: "e.g. Architect designing homes in Kathmandu",
    topicsExample: "e.g. the three or four subjects you know best",
    sourceExample: "e.g. a news site or blog from your field",
    audience: "people in the owner's field and the people they serve",
    reader: "person in the owner's field",
    community: "professional",
    newsLabel: "Industry news",
    scoring: scoring({
      mustKnow: "a change people in the owner's field must act on: a new law or rule, a deadline, a safety warning, a big price change, or an outage or shutdown of something they rely on",
      opportunity: "a change that opens something new for them: a new tool, method, market, grant or rule that saves time or money",
      routine: "routine announcements, company PR, awards and opinion pieces",
      friend: "would a typical person in the owner's field mention this to a colleague this week?",
    }),
    kinds: `"must_know" for rules, deadlines, warnings and shutdowns people in the field must act on, "opportunity" for new openings, "other" for everything else.`,
    lessonExample: `A new rule in the field → "what it changes in plain words"; a widely shared claim → "what the evidence behind it actually says".`,
    lessonFallback: `a common misunderstanding or costly mistake in the owner's field, inside their expertise.`,
    guess: "A guess about what this could change for people in the field, worded freshly and clearly as a guess.",
    outsider: "a smart friend outside the field",
    rules: ["Never give professional advice for an individual situation.", NO_CONFIDENTIAL],
    feeds: [],
  },
};

export function fieldOf(id: string | undefined | null): Field {
  return FIELDS[(FIELD_IDS as readonly string[]).includes(id ?? "") ? (id as FieldId) : "tech"];
}

/** A news search feed for one of the owner's topics (Bing News links carry the real article address). */
export function topicFeed(topic: string): FieldSource {
  return { name: `News: ${topic}`, url: `https://www.bing.com/news/search?q=${encodeURIComponent(topic)}&format=rss` };
}
