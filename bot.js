const got = require('got');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const jsdom = require('jsdom');
require('dotenv').config();

const { JSDOM } = jsdom;
const app = express();
const port = process.env.PORT || 3000;
const token = process.env.TOKEN;
const bot = new TelegramBot(token, {polling: true});


app.get('/', (req, res) => {
  res.send('oi-duel-bot is active');
});
app.listen(port, () => {
  console.log(`website running on port ${port}`);
});

bot.on("message", msg => {
  console.log(msg);
  bot.sendMessage(msg.chat.id, "Hello OI Duelists :+1:");
});

async function getDocumentFromUrl(url) {
  const rawHtml = (await got(url)).body;
  const dom = new JSDOM(rawHtml);
  return dom.window.document;
}

async function getProblemDetails(problem) {
  const url = `https://oj.uz/submissions?problem=${problem}`;
  const document = await getDocumentFromUrl(url);
  const table = document.querySelector('tbody');
  if(table.children.length === 0) {
    return null;
  }
  const submitId = table.querySelector('td').textContent;
  const details = await parseSubmission(submitId);
  return {
    name: details.name,
    score: details.score
  };
}
async function parseSubmission(submitId) {
  const url = `https://oj.uz/submission/${submitId}`;
  const document = await getDocumentFromUrl(url);
  const el = document.getElementById("submission_details").querySelectorAll(".panel"); 
  const score = [];
  const scored = [];
  for(const item of el) {
    const tmp = item.querySelector("strong").parentElement.children[1].textContent.split(" / ");
    score.push(parseFloat(tmp[1]));
    scored.push(parseFloat(tmp[0]));
  }
  const name = document.querySelector(".render-datetime")
    .parentElement.parentElement.children[3]
    .firstChild.href.split("/").pop();
  
  const user = document.querySelector(".render-datetime")
    .parentElement.parentElement.querySelector("a").textContent;

  const details = {
    name: name,
    user: user,
    score: score,
    scored: scored
  }
  return details;
}

async function getScore(user, problem) {
  const url = `https://oj.uz/submissions?handle=${user}&problem=${problem}`;
  const document = await getDocumentFromUrl(url);
  let scored = (await getProblemDetails(problem)).score.map(item => 0);

  for(const item of document.querySelector("tbody").children) {
    const submitId = item.querySelector("a").textContent;
    const newScored = (await parseSubmission(submitId)).scored;
    console.log(newScored);
    scored = scored.map((val, id) => Math.max(val, newScored[id]));
  }
  return scored;
}

async function getUrls(url) {
  const document = await getDocumentFromUrl(url);
  const el = document.querySelector("tbody");
  const urls = []
  for(const item of el.children) {
    const nextUrl = `https://oj.uz${item.querySelector("a").href}`;
    urls.push(nextUrl);
  }
  return urls;
}

const challengedBy = new Map();

async function main() {
  console.log(await getProblemDetails('APIO13_robots'));
  console.log(await getUrls("https://oj.uz/problems/sorted/solved?search=&type=&page=12"));
}
main();
