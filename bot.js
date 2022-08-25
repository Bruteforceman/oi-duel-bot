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

const UserSchema = new mongoose.Schema({
  chatId: { type: String, required: true },
  username: { type: String, required: true },
  ojuz : { type: String, required: true }
});
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

bot.onText(/\/register (.+)/, async (msg, match) => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  const ojuz = match[1];
  console.log(`${username} ${chatId} ${ojuz}`);
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
  
bot.onText(/\/challenge @(.+)/, async (msg, match) => {
  const user1 = msg.from.username;
  const user1_fn = msg.from.first_name;
  const user2 = match[1];
  const chatId = msg.chat.id;
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
      `@${user2} ${user1_fn} is challenging you in a duel.\nPlease type "yes" or "no" within one minute if you want to accept or decline the invitation.`);
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
      win: null,
      upto1: null,
      upto2: null,
      creation: Date.now()
    });
  }
});

bot.onText(/yes/, msg => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.user2 === username && item.status === -1) {
      matches[i].status = 1;
      bot.sendMessage(chatId, `@${item.user2} accepted the challenge from @${item.user1}.\nPlease enter the duration in minutes (must be an integer between 10 and 180)`);
      break;
    }
  }
});
bot.onText(/no/, msg => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.user2 === username && item.status === -1) {
      matches[i].status = 0;
      bot.sendMessage(chatId, `@${item.user2} declined the challenge from @${item.user1}`);
      break;
    }
  }
});
bot.onText(/\d+/, async (msg, match) => {
  const username = msg.from.username;
  const chatId = msg.chat.id;
  let id = -1;
  for(let i = 0; i < matches.length; i++) {
    const item = matches[i];
    if(item.chatId === chatId && item.status === 1 && item.user1 === username) {
      id = i;
      break;
    }
  }
  if(id === -1) {
    return ;
  }
  const num = parseInt(match[0]);
  const item = matches[id];
  if(item.duration === null) {
    if(10 <= num && num <= 180) {
      item.duration = num;
      bot.sendMessage(chatId, `Match duration is set to ${num}. Please enter the difficulty of the problem between 1 and 10.`);
    } else {
      bot.sendMessage(chatId, `Match duration must be between 10 and 180 minutes.`);
    }
  } else if (item.problem === null) {
    if(1 <= num && num <= 10) {
      const problem = 'IZhO19_xoractive' // await getRandomProblem(item.ojuz1, item.ojuz2, num);
      if(problem !== null) {
        bot.sendMessage(chatId, `Difficulty is set to ${num}. Here is the link for the problem selected around that difficulty:\nhttps://oj.uz/problem/view/${problem}`);
        item.problem = problem;
        const details = await getProblemDetails(problem);
        
        item.score1 = details.score.map(i => 0);
        item.score2 = details.score.map(i => 0);
        item.win = details.score.map(i => 0);
        item.start = Date.now();
      } else {
        bot.sendMessage(chatId, 'No problem found around that difficuly. Please select a different difficulty level.');
      }
    } else {
      bot.sendMessage(chatId, `Please enter a difficulty between 1 and 10.`);
    }
  }
  matches[id] = item;
  console.log(matches[id]);
})

bot.on("message", msg => {
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
    scored: scored,
    time: document.querySelector(".render-datetime").textContent,
    id: submitId
  }
  return details;
}

async function getSubmissions(user, problem, upto = null) {
  const url = `https://oj.uz/submissions?handle=${user}&problem=${problem}`;
  const document = await getDocumentFromUrl(url);
  const submissions = []

  for(const item of document.querySelector("tbody").children) {
    const submitId = item.querySelector("a").textContent;
    if(submitId === upto) break;
    submissions.push(await parseSubmission(submitId));
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

function calculatePoints(match) {
  let point1 = 0;
  let point2 = 0;
  match.win.forEach((val, i) => {
    if(val === 1) point1 += match.score1[i];
    if(val === 2) point2 += match.score2[i]; 
  });
  return { point1: point1, point2: point2 }; 
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
  for(const submission of combine) {
    if(submission.user === match.ojuz1) {
      submission.scored.forEach((val, i) => {
        match.score1[i] = Math.max(match.score1[i], val);
        if(match.score1[i] > match.score2[i]) {
          match.win[i] = 1;
        }
      }); 
    } else {
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
  return !(prevPoints.point1 === curPoints.point1 && prevPoints.point2 === curPoints.point2);
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

function emitStandings(match) {
  const points = calculatePoints(match);
  let text = "There was an update in the standings.\n\n";
  text += `@${match.user1} points: ${points.point1}\n`;
  text += `@${match.user2} points: ${points.point2}\n\n`;
  text += `${match.user1} scores: ${match.score1.map((val, i) => match.win[i] === 1 ? val : 0).join(" ")}\n`;
  text += `${match.user2} scores: ${match.score2.map((val, i) => match.win[i] === 2 ? val : 0).join(" ")}\n`;
  console.log(match.chatId);
  console.log(text);
  bot.sendMessage(match.chatId, text);
}

schedule.scheduleJob('*/5 * * * * *', async () => {
  if(pointer === buffer.length) {
    buffer = [...matches];
    pointer = 0;
    return ;
  }
  console.log('Hello');
  let item = buffer[pointer];
  pointer += 1;
  console.log(pointer, item);
  if(await updateMatch(item)) {
    emitStandings(item);
  }
});

async function main() {
  // console.log(await getProblemDetails('APIO13_robots'));
  const match = {
    chatId: 201162422,
    user1: 'tasmeemreza',
    user2: 'tasmeemreza',
    ojuz1: 'Bruteforceman',
    ojuz2: 'Bruteforceman',
    status: 1,
    problem: 'IZhO19_xoractive',
    duration: 45,
    start: 1661440800381,
    score1: [ 0, 0 ],
    score2: [ 0, 0 ],
    win: [ 0, 0 ],
    upto1: null,
    upto2: null,
    creation: 1661440774437
  }
//  console.log(await updateMatch(match));
//  console.log(await updateMatch(match));
}
main();
