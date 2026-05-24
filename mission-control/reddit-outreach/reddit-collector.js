const fs = require("fs");
const path = require("path");

const SUBREDDITS = [
  "ScienceTeachers",
  "Teachers",
  "MiddleSchoolTeacher",
  "teaching",
  "education"
];

const KEYWORDS = [
  "science",
  "middle school",
  "6th grade",
  "sixth grade",
  "moon",
  "phases",
  "eclipse",
  "cells",
  "body systems",
  "evolution",
  "geology",
  "rocks",
  "waves",
  "engineering",
  "simulation",
  "lab",
  "activity",
  "lesson"
];

const OUTPUT_DIR = path.join(__dirname, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "latest-reddit-posts.json");

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

function keywordMatches(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.filter(keyword => lower.includes(keyword.toLowerCase()));
}

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
    const matchedKeywords = keywordMatches(combinedText);

    return {
      source: "reddit_rss",
      subreddit,
      title,
      summary,
      link,
      published,
      updated,
      matchedKeywords,
      collectedAt: new Date().toISOString()
    };
  });
}

async function main() {
  const allPosts = [];
  const errors = [];

  for (const subreddit of SUBREDDITS) {
    try {
      console.log(`Fetching r/${subreddit}...`);
      const posts = await fetchSubreddit(subreddit);
      allPosts.push(...posts);
    } catch (error) {
      errors.push({
        subreddit,
        error: error.message
      });
    }
  }

  const filteredPosts = allPosts.filter(post => post.matchedKeywords.length > 0);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceType: "reddit_rss",
    note: "Collected from public Reddit RSS feeds. No comments, upvotes, or full thread data collected.",
    subreddits: SUBREDDITS,
    keywords: KEYWORDS,
    totalPostsCollected: allPosts.length,
    totalPostsMatched: filteredPosts.length,
    errors,
    posts: filteredPosts
  };

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`Done.`);
  console.log(`Collected ${allPosts.length} posts.`);
  console.log(`Matched ${filteredPosts.length} posts.`);
  console.log(`Saved to ${OUTPUT_FILE}`);

  if (errors.length > 0) {
    console.log("Errors:");
    console.log(errors);
  }
}

main().catch(error => {
  console.error("Collector failed:", error);
  process.exit(1);
});