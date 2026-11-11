// Trusted sources per field: journals, research, trade magazines, regulators and news. At sign-up an AI
// step picks the best of these for the person (and may suggest a few more); every pick is fetched and
// kept only if its feed really works, so a wrong address here costs nothing but a skipped entry.

export type SourceKind = "journal" | "research" | "magazine" | "official" | "news";

export interface CatalogSource {
  id: string;
  name: string;
  url: string;
  kind: SourceKind;
  /** Words that help match a person's topics, specialty or country. */
  tags: string[];
}

const s = (name: string, url: string, kind: SourceKind, tags: string[] = []): CatalogSource => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  name,
  url,
  kind,
  tags,
});

export const CATALOG: Record<string, CatalogSource[]> = {
  health: [
    s("New England Journal of Medicine", "https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm", "journal", ["general medicine", "clinical trials"]),
    s("The Lancet", "https://www.thelancet.com/rssfeed/lancet_current.xml", "journal", ["general medicine", "global health"]),
    s("The Lancet Online First", "https://www.thelancet.com/rssfeed/lancet_online.xml", "journal", ["general medicine"]),
    s("The BMJ", "https://www.bmj.com/rss/recent.xml", "journal", ["general medicine", "primary care", "uk"]),
    s("JAMA", "https://jamanetwork.com/rss/site_3/67.xml", "journal", ["general medicine", "us"]),
    s("JAMA Network Open", "https://jamanetwork.com/rss/site_214/174.xml", "journal", ["general medicine", "research"]),
    s("Nature Medicine", "https://www.nature.com/nm.rss", "journal", ["research", "translational"]),
    s("PLOS Medicine", "https://journals.plos.org/plosmedicine/feed/atom", "journal", ["open access", "global health"]),
    s("Annals of Internal Medicine", "https://www.acpjournals.org/action/showFeed?type=etoc&feed=rss&jc=aim", "journal", ["internal medicine", "guidelines"]),
    s("Cochrane Reviews", "https://www.cochranelibrary.com/cdsr/table-of-contents/rss.xml", "research", ["evidence", "systematic reviews"]),
    s("medRxiv preprints", "https://connect.medrxiv.org/medrxiv_xml.php?subject=all", "research", ["preprints"]),
    s("JAMA Ophthalmology", "https://jamanetwork.com/rss/site_17/73.xml", "journal", ["ophthalmology", "eye"]),
    s("British Journal of Ophthalmology", "https://bjo.bmj.com/rss/current.xml", "journal", ["ophthalmology", "eye"]),
    s("JAMA Pediatrics", "https://jamanetwork.com/rss/site_19/75.xml", "journal", ["pediatrics", "children"]),
    s("JAMA Cardiology", "https://jamanetwork.com/rss/site_192/184.xml", "journal", ["cardiology", "heart"]),
    s("JAMA Oncology", "https://jamanetwork.com/rss/site_159/174.xml", "journal", ["oncology", "cancer"]),
    s("JAMA Psychiatry", "https://jamanetwork.com/rss/site_14/70.xml", "journal", ["psychiatry", "mental health"]),
    s("The Lancet Diabetes & Endocrinology", "https://www.thelancet.com/rssfeed/landia_current.xml", "journal", ["diabetes", "endocrinology"]),
    s("The Lancet Infectious Diseases", "https://www.thelancet.com/rssfeed/laninf_current.xml", "journal", ["infectious disease", "vaccines"]),
    s("WHO news", "https://www.who.int/rss-feeds/news-english.xml", "official", ["global health", "vaccines", "outbreaks"]),
    s("US FDA press releases", "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", "official", ["drugs", "recalls", "us"]),
    s("NIH news releases", "https://www.nih.gov/news-releases/feed.xml", "official", ["research", "us"]),
    s("NHS England news", "https://www.england.nhs.uk/feed/", "official", ["uk", "nhs"]),
    s("STAT News", "https://www.statnews.com/feed/", "news", ["health news", "pharma"]),
    s("MedPage Today", "https://www.medpagetoday.com/rss/headlines.xml", "news", ["clinical news"]),
    s("ScienceDaily: Health", "https://www.sciencedaily.com/rss/health_medicine.xml", "magazine", ["research news"]),
    s("The Conversation: Health", "https://theconversation.com/global/topics/health-12/articles.atom", "magazine", ["explainers"]),
  ],
  finance: [
    s("Journal of Accountancy", "https://www.journalofaccountancy.com/news.xml", "journal", ["accounting", "cpa", "us"]),
    s("Accounting Today", "https://www.accountingtoday.com/feed", "magazine", ["accounting", "tax", "us"]),
    s("CPA Practice Advisor", "https://www.cpapractice.com/feed/", "magazine", ["accounting firms", "practice"]),
    s("HMRC (GOV.UK)", "https://www.gov.uk/government/organisations/hm-revenue-customs.atom", "official", ["tax", "vat", "uk"]),
    s("HM Treasury (GOV.UK)", "https://www.gov.uk/government/organisations/hm-treasury.atom", "official", ["budget", "uk"]),
    s("US SEC press releases", "https://www.sec.gov/news/pressreleases.rss", "official", ["securities", "regulation", "us"]),
    s("Federal Reserve press releases", "https://www.federalreserve.gov/feeds/press_all.xml", "official", ["interest rates", "banking", "us"]),
    s("European Central Bank press", "https://www.ecb.europa.eu/rss/press.html", "official", ["interest rates", "eu"]),
    s("Bank of England news", "https://www.bankofengland.co.uk/rss/news", "official", ["interest rates", "uk"]),
    s("IMF news", "https://www.imf.org/en/News/rss?language=eng", "official", ["global economy"]),
    s("NBER working papers", "https://www.nber.org/rss/new.xml", "research", ["economics", "research"]),
    s("arXiv: Quantitative finance", "https://rss.arxiv.org/rss/q-fin", "research", ["quantitative finance", "research"]),
    s("The Economist: Finance and economics", "https://www.economist.com/finance-and-economics/rss.xml", "magazine", ["economics"]),
    s("Harvard Business Review", "https://feeds.hbr.org/harvardbusiness", "magazine", ["management", "business"]),
    s("CNBC Finance", "https://www.cnbc.com/id/10000664/device/rss/rss.html", "news", ["markets"]),
    s("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "news", ["business news"]),
    s("The Kathmandu Post: Money", "https://kathmandupost.com/money/rss", "news", ["nepal", "business"]),
  ],
  law: [
    s("SCOTUSblog", "https://www.scotusblog.com/feed/", "news", ["supreme court", "us"]),
    s("Harvard Law Review", "https://harvardlawreview.org/feed/", "journal", ["legal scholarship", "us"]),
    s("Above the Law", "https://abovethelaw.com/feed/", "news", ["legal industry", "us"]),
    s("Legal Cheek", "https://www.legalcheek.com/feed/", "news", ["legal industry", "uk"]),
    s("Courthouse News", "https://www.courthousenews.com/feed/", "news", ["courts", "litigation"]),
    s("Lawfare", "https://www.lawfaremedia.org/feeds/articles", "journal", ["national security", "technology law"]),
    s("US Federal Register: final rules", "https://www.federalregister.gov/documents/search.rss?conditions%5Btype%5D%5B%5D=RULE", "official", ["regulation", "us"]),
    s("US Department of Justice news", "https://www.justice.gov/feeds/opa/justice-news.xml", "official", ["enforcement", "us"]),
    s("Ministry of Justice (GOV.UK)", "https://www.gov.uk/government/organisations/ministry-of-justice.atom", "official", ["uk", "courts"]),
    s("European Data Protection Board", "https://www.edpb.europa.eu/feed/news_en", "official", ["privacy", "gdpr", "eu"]),
    s("ICO news (UK data protection)", "https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/rss/", "official", ["privacy", "uk"]),
    s("JD Supra legal news", "https://www.jdsupra.com/resources/syndication/docsRSSfeed.aspx?ftype=AllContent&premium=1", "magazine", ["law firm updates"]),
    s("The Conversation: Law", "https://theconversation.com/global/topics/law-1018/articles.atom", "magazine", ["explainers"]),
  ],
  education: [
    s("Edutopia", "https://www.edutopia.org/rss.xml", "magazine", ["teaching practice", "k-12"]),
    s("EdSurge", "https://www.edsurge.com/articles_rss", "magazine", ["edtech"]),
    s("The Hechinger Report", "https://hechingerreport.org/feed/", "news", ["research", "policy", "us"]),
    s("Chalkbeat", "https://www.chalkbeat.org/arc/outboundfeeds/rss/", "news", ["schools", "us"]),
    s("Schools Week", "https://schoolsweek.co.uk/feed/", "news", ["schools", "uk"]),
    s("FE Week", "https://feweek.co.uk/feed/", "news", ["further education", "uk"]),
    s("Inside Higher Ed", "https://www.insidehighered.com/rss.xml", "news", ["universities"]),
    s("KQED MindShift", "https://www.kqed.org/mindshift/feed", "magazine", ["learning", "teaching practice"]),
    s("The Learning Scientists", "https://www.learningscientists.org/blog?format=rss", "research", ["learning science", "evidence"]),
    s("Department for Education (GOV.UK)", "https://www.gov.uk/government/organisations/department-for-education.atom", "official", ["policy", "uk"]),
    s("The Conversation: Education", "https://theconversation.com/global/topics/education-31/articles.atom", "magazine", ["explainers"]),
    s("arXiv: Computers and society", "https://rss.arxiv.org/rss/cs.CY", "research", ["edtech", "ai in education"]),
  ],
  marketing: [
    s("Social Media Today", "https://www.socialmediatoday.com/feeds/news/", "news", ["social media", "platforms"]),
    s("Search Engine Land", "https://searchengineland.com/feed", "news", ["seo", "search ads"]),
    s("Search Engine Journal", "https://www.searchenginejournal.com/feed/", "magazine", ["seo"]),
    s("Marketing Week", "https://www.marketingweek.com/feed/", "magazine", ["brand", "uk"]),
    s("Adweek", "https://www.adweek.com/feed/", "magazine", ["advertising"]),
    s("MarTech", "https://martech.org/feed/", "magazine", ["marketing technology"]),
    s("Marketing Dive", "https://www.marketingdive.com/feeds/news/", "news", ["brands", "campaigns"]),
    s("Content Marketing Institute", "https://contentmarketinginstitute.com/feed/", "magazine", ["content marketing"]),
    s("HubSpot Marketing Blog", "https://blog.hubspot.com/marketing/rss.xml", "magazine", ["inbound", "b2b"]),
    s("Harvard Business Review", "https://feeds.hbr.org/harvardbusiness", "magazine", ["strategy"]),
    s("Nielsen Norman Group", "https://www.nngroup.com/feed/rss/", "research", ["ux research"]),
    s("Journal of Marketing", "https://journals.sagepub.com/action/showFeed?ui=0&mi=ehikzz&ai=2b4&jc=jmxa&type=etoc&feed=rss", "journal", ["marketing research"]),
  ],
  tech: [
    s("arXiv: Artificial intelligence", "https://rss.arxiv.org/rss/cs.AI", "research", ["ai", "machine learning"]),
    s("arXiv: Machine learning", "https://rss.arxiv.org/rss/cs.LG", "research", ["machine learning"]),
    s("arXiv: Security", "https://rss.arxiv.org/rss/cs.CR", "research", ["security"]),
    s("arXiv: Software engineering", "https://rss.arxiv.org/rss/cs.SE", "research", ["software engineering"]),
    s("IEEE Spectrum", "https://spectrum.ieee.org/feeds/feed.rss", "magazine", ["engineering"]),
    s("MIT Technology Review", "https://www.technologyreview.com/feed/", "magazine", ["ai", "research"]),
    s("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "news", ["tech news"]),
    s("InfoQ", "https://feed.infoq.com/", "magazine", ["software architecture", "devops"]),
    s("LWN.net", "https://lwn.net/headlines/rss", "news", ["linux", "open source"]),
    s("CISA advisories", "https://www.cisa.gov/cybersecurity-advisories/all.xml", "official", ["security", "vulnerabilities"]),
    s("GitHub Blog", "https://github.blog/feed/", "official", ["developer tools"]),
    s("Quanta Magazine: Computer science", "https://www.quantamagazine.org/computer-science/feed/", "magazine", ["research explainers"]),
  ],
  other: [
    s("The Conversation", "https://theconversation.com/global/articles.atom", "magazine", ["explainers", "research"]),
    s("ScienceDaily", "https://www.sciencedaily.com/rss/all.xml", "magazine", ["research news"]),
    s("Harvard Business Review", "https://feeds.hbr.org/harvardbusiness", "magazine", ["management", "work"]),
    s("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "news", ["business"]),
    s("BBC Science", "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", "news", ["science"]),
    s("NPR News", "https://feeds.npr.org/1001/rss.xml", "news", ["us"]),
    s("The Guardian: World", "https://www.theguardian.com/world/rss", "news", ["world"]),
    s("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "news", ["world"]),
    s("The Kathmandu Post", "https://kathmandupost.com/rss", "news", ["nepal"]),
    s("Onlinekhabar English", "https://english.onlinekhabar.com/feed", "news", ["nepal"]),
  ],
};

/** medRxiv subject areas a health account can follow as research feeds. */
export const MEDRXIV_SUBJECTS = [
  "Allergy and Immunology", "Cardiovascular Medicine", "Dentistry and Oral Medicine", "Dermatology", "Emergency Medicine", "Endocrinology",
  "Epidemiology", "Gastroenterology", "Health Economics", "Health Informatics", "Health Policy", "Infectious Diseases", "Nephrology", "Neurology",
  "Nursing", "Nutrition", "Obstetrics and Gynecology", "Oncology", "Ophthalmology", "Orthopedics", "Otolaryngology", "Pain Medicine", "Pediatrics",
  "Pharmacology and Therapeutics", "Primary Care Research", "Psychiatry and Clinical Psychology", "Public and Global Health", "Radiology and Imaging",
  "Rehabilitation Medicine and Physical Therapy", "Respiratory Medicine", "Rheumatology", "Sports Medicine", "Surgery", "Urology",
];

export const medrxivFeed = (subject: string): CatalogSource => ({
  id: `medrxiv-${subject.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `medRxiv: ${subject}`,
  url: `https://connect.medrxiv.org/medrxiv_xml.php?subject=${encodeURIComponent(subject)}`,
  kind: "research",
  tags: [subject.toLowerCase()],
});

/** Newest research papers on a topic, from arXiv's search (an Atom feed). For science and technical fields. */
export const arxivFeed = (query: string): CatalogSource => ({
  id: `arxiv-${query.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: `arXiv: ${query}`.slice(0, 80),
  url: `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(`all:"${query}"`)}&sortBy=submittedDate&sortOrder=descending&max_results=25`,
  kind: "research",
  tags: [query.toLowerCase()],
});

export function catalogFor(field: string): CatalogSource[] {
  return CATALOG[field] ?? CATALOG.other;
}

/** Sites that publish their own findings or rules (journals, research servers, regulators): the original source. */
export const ORIGINAL_SOURCE_DOMAINS = [
  ...new Set(
    Object.values(CATALOG)
      .flat()
      .filter((x) => x.kind !== "news" && x.kind !== "magazine")
      .map((x) => new URL(x.url).hostname.replace(/^(www|feeds|connect|rss|export)\./, "")),
  ),
  "medrxiv.org",
  "biorxiv.org",
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "doi.org",
];
