const fs = require("fs");
const path = require("path");

const SUBREDDITS = [
  "ScienceTeachers",
  "Teachers",
  "MiddleSchoolTeacher",
  "teaching",
  "education"
];

// High-value terms: +3 each
// Specific phrases that strongly signal the post is relevant to LyfeLabz.
const HIGH_VALUE_TERMS = [
  "middle school science",
  "science teacher",
  "science teachers",
  "6th grade science",
  "sixth grade science",
  "7th grade science",
  "seventh grade science",
  "8th grade science",
  "eighth grade science",
  "ngss",
  "science lesson",
  "science lessons",
  "science lab",
  "science labs",
  "science activity",
  "science activities",
  "science game",
  "science games",
  "science simulation",
  "science simulations",
  "moon phases",
  "eclipse",
  "cells",
  "organelles",
  "body systems",
  "evolution",
  "natural selection",
  "fossils",
  "geology",
  "rock cycle",
  "waves",
  "engineering design"
];

// General terms: +1 each
// Broad words that add weak signal but are not sufficient on their own.
const GENERAL_TERMS = [
  "science",
  "lab",
  "lesson",
  "activity",
  "simulation",
  "classroom",
  "teacher",
  "middle school"
];

// Exclusion terms: -4 each
// Strong indicators the post is outside LyfeLabz's scope.
// A post with ANY exclusion term cannot qualify via the high-value override -
// it must reach MIN_SCORE on its own despite the penalty.
const EXCLUSION_TERMS = [
  "college",
  "university",
  "professor",
  "phd",
  "grad school",
  "job offer",
  "salary",
  "interview",
  "certification",
  "licensure",
  "elementary school",
  "preschool",
  "kindergarten",
  "high school",
  "ap bio",
  "ap biology",
  "ap chemistry",
  "ap physics",
  "ap class",
  "ap exam",
  "chemistry major",
  "biology major"
];

const HIGH_VALUE_WEIGHT = 3;
const GENERAL_WEIGHT = 1;
const EXCLUSION_WEIGHT = 4;
const MIN_SCORE = 4;

const OUTPUT_DIR = path.join(__dirname, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "latest-reddit-posts.json");

// ─── Text helpers ─────────────────────────────────────────────────────────────

function stripHtml(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(entry, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = entry.match(regex);
  return match ? stripHtml(match[1]) : "";
}

function getLink(entry) {
  const match = entry.match(/<link[^>]*href="([^"]+)"/i);
  return match ? match[1] : "";
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scorePost(text) {
  const lower = text.toLowerCase();

  const matchedHighValueTerms = HIGH_VALUE_TERMS.filter(term =>
    lower.includes(term.toLowerCase())
  );
  const matchedGeneralTerms = GENERAL_TERMS.filter(term =>
    lower.includes(term.toLowerCase())
  );
  const matchedExclusionTerms = EXCLUSION_TERMS.filter(term =>
    lower.includes(term.toLowerCase())
  );

  const relevanceScore =
    matchedHighValueTerms.length * HIGH_VALUE_WEIGHT +
    matchedGeneralTerms.length * GENERAL_WEIGHT -
    matchedExclusionTerms.length * EXCLUSION_WEIGHT;

  return { relevanceScore, matchedHighValueTerms, matchedGeneralTerms, matchedExclusionTerms };
}

function isRelevant({ relevanceScore, matchedHighValueTerms, matchedExclusionTerms }) {
  // Posts with exclusion terms must reach MIN_SCORE on their own.
  // Posts with no exclusions qualify with a high-value term match alone,
  // even if general terms alone wouldn't push them to MIN_SCORE.
  if (matchedExclusionTerms.length > 0) {
    return relevanceScore >= MIN_SCORE;
  }
  return relevanceScore >= MIN_SCORE || matchedHighValueTerms.length > 0;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}.rss`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "LyfeLabzRedditCollector/1.0 educational research contact:cgbrown@proton.me"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch r/${subreddit}: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const entries = xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];

  return entries.map(entry => {
    const title = getTagValue(entry, "title");
    const summary = getTagValue(entry, "content") || getTagValue(entry, "summary");
    const link = getLink(entry);
    const published = getTagValue(entry, "published");
    const updated = getTagValue(entry, "updated");
    const combinedText = `${title} ${summary}`;
    const scoring = scorePost(combinedText);

    return {
      source: "reddit_rss",
      subreddit,
      title,
      summary,
      link,
      published,
      updated,
      collectedAt: new Date().toISOString(),
      ...scoring
    };
  });
}

// ─── Summary helpers ───────────────────────────────────────────────────────────

function buildTopTerms(posts) {
  const counts = {};
  for (const post of posts) {
    for (const term of [...post.matchedHighValueTerms, ...post.matchedGeneralTerms]) {
      counts[term] = (counts[term] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allPosts = [];
  const errors = [];

  for (const subreddit of SUBREDDITS) {
    try {
      console.log(`Fetching r/${subreddit}...`);
      const posts = await fetchSubreddit(subreddit);
      allPosts.push(...posts);
      console.log(`  → ${posts.length} posts collected`);
    } catch (error) {
      console.error(`  → Error: ${error.message}`);
      errors.push({ subreddit, error: error.message });
    }
  }

  const matchedPosts = allPosts.filter(isRelevant);
  matchedPosts.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const totalPostsExcluded = allPosts.length - matchedPosts.length;
  const topMatchedTerms = buildTopTerms(matchedPosts);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceType: "reddit_rss",
    note: "Collected from public Reddit RSS feeds. No comments, upvotes, or full thread data collected.",
    subreddits: SUBREDDITS,
    highValueTerms: HIGH_VALUE_TERMS,
    generalTerms: GENERAL_TERMS,
    exclusionTerms: EXCLUSION_TERMS,
    scoring: {
      highValueWeight: HIGH_VALUE_WEIGHT,
      generalWeight: GENERAL_WEIGHT,
      exclusionWeight: EXCLUSION_WEIGHT,
      minScore: MIN_SCORE
    },
    summary: {
      totalPostsCollected: allPosts.length,
      totalPostsMatched: matchedPosts.length,
      totalPostsExcluded,
      topMatchedTerms,
      errors
    },
    posts: matchedPosts
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\nDone.`);
  console.log(`Collected: ${allPosts.length} posts`);
  console.log(`Matched:   ${matchedPosts.length} posts`);
  console.log(`Excluded:  ${totalPostsExcluded} posts`);
  console.log(`Saved to:  ${OUTPUT_FILE}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    errors.forEach(e => console.log(`  r/${e.subreddit}: ${e.error}`));
  }

  if (matchedPosts.length > 0) {
    console.log("\nTop matched posts (by score):");
    matchedPosts.slice(0, 8).forEach(p => {
      const excl = p.matchedExclusionTerms.length
        ? ` [excl: ${p.matchedExclusionTerms.join(", ")}]`
        : "";
      console.log(`  [${p.relevanceScore}] r/${p.subreddit}: ${p.title}${excl}`);
    });
  }
}

main().catch(error => {
  console.error("Collector failed:", error);
  process.exit(1);
});
