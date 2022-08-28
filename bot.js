process.env.NTBA_FIX_319 = 1;
const { AsciiTable3 } = require('ascii-table3');
const schedule = require('node-schedule');
const got = require('got');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const jsdom = require('jsdom');
const mongoose = require('mongoose');
require('dotenv').config();

const { JSDOM } = jsdom;
const app = express();
const port = process.env.PORT || 8888;
const token = process.env.TOKEN;
const bot = new TelegramBot(token, {polling: true});
const dbUrl = process.env.DB_URL;
let matches = [];
let buffer = [];
let pointer = 0;
let dbUpdate = false;
const MAX_LEN = 30;

const UserSchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  username: { type: String, required: true },
  ojuz : { type: String, required: true }
});
const MatchSchema = new mongoose.Schema({
  matches: [Object]
});
const Match = mongoose.model('Match', MatchSchema);
const User = mongoose.model('User', UserSchema);

app.get('/', (req, res) => {
  res.send('oi-duel-bot is active');
});
app.listen(port, () => {
  console.log(`website running on port ${port}`);
});
mongoose.connect(dbUrl).then(() => {
  console.log(`Connected to the database`);
});

bot.onText(/\/register@OIDuelBot/, async (msg) => {
  const args = msg.text.split(" ").filter(item => item.length > 0).slice(1);
  const chatId = msg.chat.id;
  if(args.length === 0) {
    bot.sendMessage(chatId, 'You must specify your oj.uz username.');
    return ;
  }
  const username = msg.from.username;
  const ojuz = args[0];
  if((await doesUserExist(ojuz)) === false) {
    bot.sendMessage(chatId, `No oj.uz account with username ${ojuz} exists.`);
    return ;
  }
  const user = await User.findOne({chatId: chatId, username: username});
  if(user === null) {
    const newUser = new User({
      chatId: chatId,
      username: username,
      ojuz: ojuz
    });
    newUser.save().then(() => bot.sendMessage(chatId, 'User registered for duel'));
  } else {
    user.ojuz = ojuz;
    user.save().then(() => bot.sendMessage(chatId, 'oj.uz username updated for duel.'));
  }
});
  
bot.onText(/\/challenge@OIDuelBot/, async (msg) => {
  const args = msg.text.split(" ").filter(item => item.length > 0).slice(1);
  const chatId = msg.chat.id;

  if(matches.length > MAX_LEN) {
    bot.sendMessage(chatId, 'OIDuelBot server is too busy now. Please try again later.');
    return ;
  }
  if(args.length === 0) {
    bot.sendMessage(chatId, 'You must specify the username of the person you want to challenge.');
    return ;
  }

  const user1 = msg.from.username;
  const user1_fn = msg.from.first_name;
  const user2 = args[0][0] === '@' ? args[0].slice(1) : args[0];
    
  const userDoc1 = await User.findOne({chatId: chatId, username: user1});
  const userDoc2 = await User.findOne({chatId: chatId, username: user2});

  if(matches.filter(item => item.chatId === chatId && (item.user1 === user1 || item.user2 === user1)).length > 0) {
    bot.sendMessage(chatId, `@${user1} is already in a match. Please withdraw it first.`);
  } 
  else if(matches.filter(item => item.chatId === chatId && (item.user1 === user2 || item.user2 === user2)).length > 0) {
    bot.sendMessage(chatId, `@${user2} is already in a match. Please withdraw it first.`);
  } else if(userDoc1 === null) {
    bot.sendMessage(chatId, `@${user1} is not registered for duel.`);
  } else if (userDoc2 === null) {
    bot.sendMessage(chatId, `@${user2} is not registered for duel.`);
  } else {
    bot.sendMessage(chatId, 
      `@${user2} ${user1_fn} is challenging you in a duel.\nPlease use the accept or decline commands as soon as possible.`);
    matches.push({
      chatId: chatId,
      user1: user1,
      user2: user2,
      ojuz1: userDoc1.ojuz,
      ojuz2: userDoc2.ojuz,
      status: -1,
      problem: null,
      duration: null,
      start: null,
      score1: null,
      score2: null,
      score: null, 
      win: null,
      upto1: null,
      upto2: null,
      creation: Date.now(),
      withdraw1: false,
      withdraw2: false,
    });
    dbUpdate = true;
  }
});

bot.onText(/\/withdraw@OIDuelBot/, msg => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  let id = -1;
  let change = false;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.user1 !== username && item.user2 !== username) continue;
    if(item.user1 === username) {
      matches[i].withdraw1 = true;
    }
    if (item.user2 === username) {
      matches[i].withdraw2 = true;
    }
    dbUpdate = true;
    if(matches[i].withdraw1 === false || matches[i].withdraw2 === false) {
      bot.sendMessage(chatId, 'Both players have to withdraw the match.');
    } else {
      break;
    }
  }
});

bot.onText(/\/accept@OIDuelBot/, msg => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.user2 === username && item.status === -1) {
      matches[i].status = 1;
      dbUpdate = true;
      bot.sendMessage(chatId, `@${item.user2} accepted the challenge from @${item.user1}.\nPlease set the duration in minutes (between 10 to 180) using the duration command.`);
      break;
    }
  }
});
bot.onText(/\/decline@OIDuelBot/, msg => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.user2 === username && item.status === -1) {
      matches[i].status = 0;
      dbUpdate = true;
      break;
    }
  }
});
bot.onText(/\/duration@OIDuelBot/, async (msg) => {
  const args = msg.text.split(" ").filter(item => item.length > 0).slice(1);
  const chatId = msg.chat.id;
  if(args.length === 0 || isNaN(parseInt(args[0]))) {
    bot.sendMessage(chatId, "You must specify a number between 10 and 180 (in minutes).");
    return ;
  }
  const username = msg.from.username;
  let id = -1;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.status === 1 && (item.user1 === username || item.user2 === username)) {
      id = i;
      break;
    }
  }
  if(id === -1) {
    bot.sendMessage(chatId, 'You are not in any ongoing matches.');
    return ;
  }
  const num = parseInt(args[0]);
  const item = matches[id];
  if(item.duration !== null) {
    bot.sendMessage(chatId, 'Match duration is already set.');
    return ;
  }
  if(10 <= num && num <= 180) {
    dbUpdate = true;
    item.duration = num;
    bot.sendMessage(chatId, `Match duration is set to ${num}. Please set the difficulty of the problem (between 1 and 10) using the difficulty command.`);
  } else {
    bot.sendMessage(chatId, `Match duration must be between 10 and 180 minutes.`);
  }
  matches[id] = item;
  // console.log(matches[id]);
});

bot.onText(/\/difficulty@OIDuelBot/, async msg => {
  const args = msg.text.split(" ").filter(item => item.length > 0).slice(1);
  const chatId = msg.chat.id;
  if(args.length === 0 || isNaN(parseInt(args[0]))) {
    bot.sendMessage(chatId, "You must specify a number between 1 and 10.");
    return ;
  }
  const username = msg.from.username;
  let id = -1;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.status === 1 && (item.user1 === username || item.user2 === username)) {
      id = i;
      break;
    }
  }
  if(id === -1) {
    bot.sendMessage(chatId, 'You are not in any ongoing matches.');
    return ;
  }
  const num = parseInt(args[0]);
  const item = matches[id];
  
  if(item.duration === null) {
    bot.sendMessage(chatId, 'You must set the duration first.');
    return ;
  }
  if(item.problem !== null) {
    bot.sendMessage(chatId, 'You cannot set the difficulty now.');
    return ; 
  }
  if(1 <= num && num <= 10) {
    const problem = await getRandomProblem(item.ojuz1, item.ojuz2, num);
    if(problem !== null) {
      dbUpdate = true;
      bot.sendMessage(chatId, 
        `Difficulty is set to ${num}. Here is the link for the problem selected around that difficulty:\nhttps://oj.uz/problem/view/${problem}`);
      item.problem = problem;
      const details = await getProblemDetails(problem);
      
      item.score1 = details.score.map(i => 0);
      item.score2 = details.score.map(i => 0);
      item.score = details.score;
      item.win = details.score.map(i => 0);
      item.start = Date.now();
    } else {
      bot.sendMessage(chatId, 'No problem found around that difficuly. Please select a different difficulty level.');
    }
  } else {
    bot.sendMessage(chatId, `Please enter a difficulty between 1 and 10.`);
  }
  matches[id] = item;
  // console.log(matches[id]);
})

bot.onText(/\/help@OIDuelBot/, async msg => {
  let text = '<b>You need to start all commands with a forward slash</b>\n\n';
  text += '/register <code>[oj.uz username]</code> - you have to register yourself in order to enter your duel\n\n'
  text += '/challenge <code>[telegram username]</code> - you can challenge other users in a OI styled duel\n\n'
  text += '/accept - you can accept the challenge from other users\n\n'
  text += '/decline - you can decline the challenge from other users\n\n'
  text += '/duration <code>[minutes]</code> - you can set the duration of your challenge between 10 and 180 minutes\n\n'
  text += '/difficulty <code>[number]</code> - you can set a difficulty from 1 to 10\n\n'
  text += '/withdraw - you can withdraw from your current challenge\n\n'
  text += '/rules - you can see the rules of the duel'
  bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
});

bot.onText(/\/rules@OIDuelBot/, async msg => {
  let text = "You can challenge other users in a OI styled duel. In the duel, you have to race against time to solve the subtasks before your opponent. If your opponent solves a particular subtask before you, they gets the point for that subtask, and you won't get any points for it even if you solve it in the future. The player with more points at the end of the duel wins the challenge."
  bot.sendMessage(msg.chat.id, text);
});

bot.on("message", msg => {
  // console.log("Hello Guys");
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
  const submitId = await getFirstSubmission(problem);
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
    scored: scored,
    time: document.querySelector(".render-datetime").textContent,
    id: submitId
  }
  return details;
}

async function getSubmissions(user, problem, upto = null) {
  const url = `https://oj.uz/submissions?handle=${user}&problem=${problem}`;
  const document = await getDocumentFromUrl(url);
  let submissions = []

  for(const item of document.querySelector("tbody").children) {
    const submitId = item.querySelector("a").textContent;
    if(submitId === upto) break;
    const evalText = item.querySelector(".text").textContent;
    // console.log(evalText);
    if(evalText === "Compilation error" || evalText.includes("/")) {
      submissions.push(await parseSubmission(submitId));
    } else {
      submissions = []
    }
  }
  return submissions;
}

async function doesUserExist(ojuz) {
  try {
    await got(`https://oj.uz/profile/${ojuz}`);
    return true;
  } catch {
    return false;
  }
}

async function getUrlsFromPage(page) {
  const url = `https://oj.uz/problems/sorted/solved?search=&type=&page=${page}`;
  const document = await getDocumentFromUrl(url);
  const el = document.querySelector("tbody");
  const urls = [];
  for(const item of el.children) {
    const nextUrl = `https://oj.uz${item.querySelector("a").href}`;
    urls.push(nextUrl);
  }
  return urls;
}

async function getUrlsFromProfile(profile) {
  const url = `https://oj.uz/profile/${profile}`;
  const document = await getDocumentFromUrl(url);
  const urls = [];
  for(const item of document.querySelectorAll(".col-md-3")) {
    const el = item.querySelector('a');
    if(el !== null) {
      const nextUrl = `https://oj.uz${el.href}`;
      urls.push(nextUrl);  
    }
  }
  return urls;
}

async function getFirstSubmission(problem) {
  const url = `https://oj.uz/submissions?problem=${problem}`;
  const document = await getDocumentFromUrl(url);
  for(const item of document.querySelector("tbody").children) {
    const verdict = item.querySelector(".text").textContent;
    if(verdict.includes("/")) {
      return item.querySelector("a").href.split("/").pop();
    }
  }
  return null;
}

function calculatePoints(match) {
  if(match.win === null) {
    return { total1: null, total2: null };
  }
  let point1 = 0;
  let point2 = 0;
  match.win.forEach((val, i) => {
    if(val === 1) point1 += match.score1[i];
    if(val === 2) point2 += match.score2[i]; 
  });
  return { total1: point1, total2: point2 }; 
}

// mutates match object
async function updateMatch(match) {
  if(match.start === null) {
    return false;
  }
  const prevPoints = calculatePoints(match);
  const sub1 = await getSubmissions(match.ojuz1, match.problem, match.upto1);
  const sub2 = await getSubmissions(match.ojuz2, match.problem, match.upto2);
  const combine = sub1.concat(sub2).sort((a, b) => {
    if(a.id < b.id) return -1;
    else if (a.id > b.id) return 1;
    else return 0;
  });
  if(combine.length > 0) {
    console.log('Found submissions');
  }
  for(const submission of combine) {
    if(submission.user === match.ojuz1) {
      submission.scored.forEach((val, i) => {
        match.score1[i] = Math.max(match.score1[i], val);
        if(match.score1[i] > match.score2[i]) {
          match.win[i] = 1;
        }
      }); 
    } else if (submission.user === match.ojuz2) {
      submission.scored.forEach((val, i) => {
        match.score2[i] = Math.max(match.score2[i], val);
        if(match.score2[i] > match.score1[i]) {
          match.win[i] = 2;
        }
      }); 
    }
  }
  if(sub1.length > 0) match.upto1 = sub1[0].id;
  if(sub2.length > 0) match.upto2 = sub2[0].id;
  const curPoints = calculatePoints(match);
  const { total1, total2 } = curPoints;
  const total = match.score.reduce((a, b) => a + b, 0);

  if(total1 + total2 >= total || match.start + match.duration * 60 * 1000 <= Date.now()) {
    let text = `Match between @${match.user1} and @${match.user2} has ended. `;
    if(total1 > total2) text += `${match.user1} won the duel.`;
    else if (total1 < total2) text += `${match.user2} won the duel.`;
    else text += `The duel was a draw.`;
    text += ' Here is the final standings.';
    bot.sendMessage(match.chatId, text);
    return true;
  }
  return !(prevPoints.total1 === curPoints.total1 && prevPoints.total2 === curPoints.total2);
}

async function getRandomProblem(user1, user2, diff) {
  const problemList = await getUrlsFromPage(diff);
  const user1Solved = await getUrlsFromProfile(user1);
  const user2Solved = await getUrlsFromProfile(user2);
  const relevant = problemList.filter(item => !user1Solved.includes(item) && !user2Solved.includes(item));
  if(relevant.length === 0) {
    return null;
  } else {
    const len = relevant.length;
    const problemUrl = relevant[Math.floor(Math.random() * len)];
    return problemUrl.split("/").pop();
  }
}

function isAlive(match, showMsg=false) {
  // 3 minutes until creation
  const { total1, total2 } = calculatePoints(match);
  if(match.status === 0) {
    if(showMsg) bot.sendMessage(match.chatId, `@${match.user2} declined the challenge from @${match.user1}.`);
    return false;
  }
  if(match.start === null && match.creation + 180 * 1000 <= Date.now()) {
    if(showMsg) bot.sendMessage(match.chatId, `Duel invalidated. You took too long to respond to the messages.`);
    return false;
  }
  if(match.start !== null && match.start + match.duration * 60 * 1000 <= Date.now()) {
    return false;
  }
  if(match.withdraw1 && match.withdraw2) {
    if(showMsg) bot.sendMessage(match.chatId, `Match between @${match.user1} and @${match.user2} is withdrawn.`);
    return false;
  }
  if(total1 !== null && total2 !== null && total1 + total2 >= 100) {
    return false;
  }
  return true;
}

function generateStandings(match) {
  const table = new AsciiTable3('Standings');
  table.setAlignCenter(1);
  const header1 = AsciiTable3.truncateString(match.user1, 7);
  const header2 = AsciiTable3.truncateString(match.user2, 7);
  let total1 = 0;
  let total2 = 0;
  table.setHeading('Subtask', header1, header2);
  for(let i = 0; i < match.win.length; i++) {
    let point1 = 0;
    let point2 = 0;
    if(match.win[i] === 1) {
      point1 = match.score1[i];
    }
    if(match.win[i] === 2) {
      point2 = match.score2[i];
    }
    total1 += point1;
    total2 += point2;
    table.addRow(i + 1, point1, point2);
  }
  table.addRow("Total", total1, total2);
  return `\`\`\`\n${table.toString()}\n\`\`\``
}
function emitStandings(match) {
  bot.sendMessage(match.chatId, generateStandings(match), { parse_mode: 'MarkdownV2' });
}

function isEqual(a, b) {
  if(a.length !== b.length) return false;
  const n = a.length;
  for(let i = 0; i < n; i++) {
    if(JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return false;
    }
  }
  return true;
}

schedule.scheduleJob('*/5 * * * * *', async () => {
  if(!matches.every(isAlive)) {
    matches = matches.filter(item => isAlive(item, true));
    dbUpdate = true;
  }
  if(pointer === buffer.length) {
    pointer = 0;
    buffer = [...matches]
    if(dbUpdate) {
      console.log('Update db');
      dbUpdate = false;
      const dbBuffer = matches.map(JSON.stringify).map(JSON.parse);
      let matchList = await Match.findOne();
      if(matchList === null) {
        matchList = new Match({ matches: dbBuffer });
        matchList.save();
      } else {
        matchList.matches = dbBuffer;
        matchList.save();
      }
    }
    return ;
  }
  let item = buffer[pointer];
  pointer += 1;
  if(await updateMatch(item)) {
    dbUpdate = true;
    emitStandings(item);
  }
});

async function main() {
  let matchList = await Match.findOne();
  if(matchList === null) {
    matches = []
  } else {
    matches = [...matchList.matches];
  }
}
main();
