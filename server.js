const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const TRAITS = [
  { id: 'spy', name: '间谍', desc: '复杂事件中额外+6', skill: { id: 'peek', name: '窥探', desc: '随机查看一名其他玩家的身份，并获得+4' } },
  { id: 'aggressor', name: '激进者', desc: '你赚的时候多赚12分；你赔的时候再多赔12分', skill: { id: 'all_in', name: '孤注一掷', desc: '本轮收益和损失都放大1.5倍' } },
  { id: 'conservative', name: '保守者', desc: '你赚的时候少赚4分；你赔的时候少赔4分', skill: { id: 'insurance', name: '保险', desc: '本轮损失减半；有收益时+2' } },
  { id: 'lucky', name: '幸运儿', desc: '结算随机浮动-6~+10分', skill: { id: 'destiny', name: '天命', desc: '本轮高波动：50% +15，50% -5' } },
  { id: 'strategist', name: '谋略家', desc: '在拍卖/决斗/最后通牒/海盗等复杂事件中额外+7', skill: { id: 'puppet', name: '幕后推手', desc: '选择一名玩家，本轮若TA盈利，你获得其盈利的30%；若TA亏损，你无损失' } }
];
const COOP_ACTIONS = {
  prisoner: ['合作'],
  public: ['投入'],
  stag: ['猎鹿'],
  volunteer: ['站出来'],
  trust: ['继续投资'],
  minority: [],
  cournot: ['低产量']
};

const STRATEGY_CARDS = [
  { id: 'shield', name: '保险', rarity: 'common', color: '#94a3b8', desc: '本轮你的损失减半', effect: 'shield' },
  { id: 'focus', name: '专注', rarity: 'common', color: '#94a3b8', desc: '本轮额外+3', effect: 'focus' },
  { id: 'boost', name: '加注', rarity: 'rare', color: '#60a5fa', desc: '本轮收益+5', effect: 'boost' },
  { id: 'disrupt', name: '干扰', rarity: 'rare', color: '#60a5fa', desc: '随机一名其他玩家本轮-3', effect: 'disrupt' },
  { id: 'gamble', name: '豪赌', rarity: 'epic', color: '#c084fc', desc: '本轮随机-5~+15', effect: 'gamble' },
  { id: 'coop_card', name: '合作卡', rarity: 'rare', color: '#60a5fa', desc: '本轮如果选择合作类行动，收益+10', effect: 'coop_bonus' },
  { id: 'aggr_card', name: '进攻卡', rarity: 'rare', color: '#f87171', desc: '本轮如果选择背叛/进攻类行动，收益+10', effect: 'aggr_bonus' },
  { id: 'prisoner_letter', name: '狱中密信', event: 'prisoner', rarity: 'rare', color: '#60a5fa', desc: '囚徒困境：本轮合作收益+12', effect: 'coop_bonus' },
  { id: 'public_support', name: '村长支持', event: 'public', rarity: 'rare', color: '#60a5fa', desc: '公共品：本轮投入收益+12', effect: 'coop_bonus' },
  { id: 'stag_track', name: '追踪术', event: 'stag', rarity: 'rare', color: '#60a5fa', desc: '猎鹿：本轮猎鹿收益+12', effect: 'coop_bonus' },
  { id: 'volunteer_lamp', name: '守夜人', event: 'volunteer', rarity: 'rare', color: '#60a5fa', desc: '灯塔：本轮站出来收益+12', effect: 'coop_bonus' },
  { id: 'trust_help', name: '央行支持', event: 'trust', rarity: 'rare', color: '#60a5fa', desc: '银行：本轮继续投资收益+12', effect: 'coop_bonus' },
  { id: 'minority_oracle', name: '先知', event: 'minority', rarity: 'epic', color: '#c084fc', desc: '少数者：如果你在少数方，额外+15', effect: 'minority_bonus' },
  { id: 'cournot_dump', name: '低价倾销', event: 'cournot', rarity: 'rare', color: '#60a5fa', desc: '古诺：本轮低产量收益+12', effect: 'coop_bonus' }
];
const EVENT_TWISTS = {
  public: [
    { id: 'mayor_reward', name: '村长的奖励', desc: '随机一名投入者额外+15，没人投入则没有奖励。', apply(room, result) {
      const investors = room.players.filter(p => room.choices[p.id] === '投入');
      if (investors.length) {
        const lucky = investors[Math.floor(Math.random() * investors.length)];
        result.deltas[lucky.id] = (result.deltas[lucky.id] || 0) + 15;
        result.detail += `\n【村长的奖励】${lucky.name}额外+15`;
      }
      return result;
    } },
    { id: 'grain_rot', name: '粮食霉变', desc: '投入人数不足半数时，旁观者也要扣10分。', apply(room, result) {
      const investCount = room.players.filter(p => room.choices[p.id] === '投入').length;
      const half = Math.ceil(room.players.length / 2);
      if (investCount < half) {
        room.players.forEach(p => { if (room.choices[p.id] !== '投入') result.deltas[p.id] = -10; });
        result.detail += '\n【粮食霉变】旁观者也被扣10分';
      }
      return result;
    } }
  ],
  stag: [
    { id: 'rabbit_boom', name: '兔子泛滥', desc: '猎兔者额外+10，猎鹿风险更高。', apply(room, result) {
      room.players.forEach(p => { if (room.choices[p.id] === '猎兔') result.deltas[p.id] = (result.deltas[p.id] || 0) + 10; });
      result.detail += '\n【兔子泛滥】猎兔者额外+10';
      return result;
    } },
    { id: 'alert_deer', name: '鹿群警觉', desc: '猎鹿人数不足或未过半数时，猎鹿者-30。', apply(room, result) {
      const hunters = room.players.filter(p => room.choices[p.id] === '猎鹿');
      const half = Math.ceil(room.players.length / 2);
      if (hunters.length < half || hunters.length < 2) {
        hunters.forEach(p => result.deltas[p.id] = -30);
        result.detail += '\n【鹿群警觉】猎鹿失败，猎鹿者-30';
      }
      return result;
    } }
  ],
  volunteer: [
    { id: 'storm', name: '暴风雨升级', desc: '无人站出来全员-70；有人站出来时，不站出来者只+10。', apply(room, result) {
      const vols = room.players.filter(p => room.choices[p.id] === '站出来');
      if (vols.length === 0) {
        room.players.forEach(p => result.deltas[p.id] = -70);
        result.detail += '\n【暴风雨升级】无人站出来，全员-70';
      } else {
        room.players.forEach(p => { if (room.choices[p.id] !== '站出来') result.deltas[p.id] = 10; });
        result.detail += '\n【暴风雨升级】不站出来者只+10';
      }
      return result;
    } },
    { id: 'keeper', name: '灯塔看守', desc: '如果只有1人站出来，站出来者反而+10。', apply(room, result) {
      const vols = room.players.filter(p => room.choices[p.id] === '站出来');
      if (vols.length === 1) {
        result.deltas[vols[0].id] = 10;
        result.detail += '\n【灯塔看守】唯一站出来者+10';
      }
      return result;
    } }
  ],
  trust: [
    { id: 'rescue', name: '央行救市', desc: '继续投资人数≥半数时奖励池改为人数×35；危机时继续投资者-30。', apply(room, result) {
      const withdraw = room.players.filter(p => room.choices[p.id] === '撤资').length;
      const half = Math.ceil(room.players.length / 2);
      const crisis = withdraw >= half;
      const continueCount = room.players.length - withdraw;
      if (!crisis) {
        const rewardEach = Math.floor(room.players.length * 35 / Math.max(1, continueCount));
        room.players.forEach(p => { if (room.choices[p.id] !== '撤资') result.deltas[p.id] = rewardEach; });
        result.detail += '\n【央行救市】奖励池提高到人数×35';
      } else {
        room.players.forEach(p => { if (room.choices[p.id] !== '撤资') result.deltas[p.id] = -30; });
        result.detail += '\n【央行救市】继续投资者只扣30';
      }
      return result;
    } },
    { id: 'panic', name: '挤兑恐慌', desc: '危机时撤资者-20；未危机时撤资者+25。', apply(room, result) {
      const withdraw = room.players.filter(p => room.choices[p.id] === '撤资').length;
      const half = Math.ceil(room.players.length / 2);
      const crisis = withdraw >= half;
      room.players.forEach(p => {
        if (room.choices[p.id] === '撤资') result.deltas[p.id] = crisis ? -20 : 25;
      });
      result.detail += crisis ? '\n【挤兑恐慌】撤资者-20' : '\n【挤兑恐慌】撤资者+25';
      return result;
    } }
  ],
  minority: [
    { id: 'tie_cost', name: '平局代价', desc: '双方人数相同则全员-10。', apply(room, result) {
      const a = room.players.filter(p => room.choices[p.id] === 'A').length;
      const b = room.players.length - a;
      if (a === b) {
        room.players.forEach(p => result.deltas[p.id] = -10);
        result.detail += '\n【平局代价】平局，全员-10';
      }
      return result;
    } },
    { id: 'big_prize', name: '少数派大奖', desc: '少数方每人+50（原+40）。', apply(room, result) {
      const a = room.players.filter(p => room.choices[p.id] === 'A').length;
      const b = room.players.length - a;
      const minorityIsA = a < b;
      room.players.forEach(p => {
        const isMinor = (room.choices[p.id] === 'A' && minorityIsA) || (room.choices[p.id] === 'B' && !minorityIsA && a > b);
        if (isMinor) result.deltas[p.id] = 50;
      });
      result.detail += '\n【少数派大奖】少数方每人+50';
      return result;
    } }
  ],
  cournot: [
    { id: 'boom', name: '市场需求暴涨', desc: '价格公式提高：70 - 总产量×5。', apply(room, result) {
      const outputMap = { '低产量': 1, '中产量': 2, '高产量': 3 };
      const total = room.players.reduce((s, p) => s + (outputMap[room.choices[p.id]] || 1), 0);
      const price = Math.max(0, 70 - total * 5);
      room.players.forEach(p => {
        const q = outputMap[room.choices[p.id]] || 1;
        result.deltas[p.id] = q * (price - 10);
      });
      result.detail += `\n【市场需求暴涨】单价改为${price}`;
      return result;
    } },
    { id: 'cost_up', name: '原料涨价', desc: '成本升到15，但基础价格提高到70，保持一定平衡。', apply(room, result) {
      const outputMap = { '低产量': 1, '中产量': 2, '高产量': 3 };
      const total = room.players.reduce((s, p) => s + (outputMap[room.choices[p.id]] || 1), 0);
      const price = Math.max(0, 70 - total * 5);
      room.players.forEach(p => {
        const q = outputMap[room.choices[p.id]] || 1;
        result.deltas[p.id] = q * (price - 15);
      });
      result.detail += `\n【原料涨价】成本15，单价${price}`;
      return result;
    } }
  ]
};
const EVENTS = [
  {
    id: 'prisoner',
    name: '无法串供的审判',
    type: 'normal',
    actions: ['合作', '背叛'],
    desc: `夜里的审讯室亮着一盏灯，你被带进一间没有窗户的房间。\n桌对面坐着另一个嫌疑人，你们都被指控犯了同一桩案子。\n狱警说：谁先招供，谁就能拿到减刑。\n你们不能串供，只能赌对方会怎么选。\n嘴硬到底，还是出卖对方？\n\n双方都合作：各+30。\n单人背叛：背叛+50，合作方-20。\n双方背叛：各-30。`,
    resolve(players, choices) {
      const deltas = {};
      players.forEach(p => deltas[p.id] = 0);
      const idx = shuffle(players.map((_, i) => i));
      for (let i = 0; i + 1 < idx.length; i += 2) {
        const a = players[idx[i]], b = players[idx[i + 1]];
        const ca = choices[a.id], cb = choices[b.id];
        if (ca === '合作' && cb === '合作') {
          deltas[a.id] += 30; deltas[b.id] += 30;
        } else if (ca === '背叛' && cb === '合作') {
          deltas[a.id] += 50; deltas[b.id] -= 20;
        } else if (ca === '合作' && cb === '背叛') {
          deltas[a.id] -= 20; deltas[b.id] += 50;
        } else {
          deltas[a.id] -= 30; deltas[b.id] -= 30;
        }
      }
      return { deltas, detail: '配对已随机生成' };
    }
  },
  {
    id: 'public',
    name: '众人拾柴的村庄',
    type: 'normal',
    actions: ['投入', '旁观'],
    desc: `村口的粮仓快空了，村长请大家凑粮食。\n每个人都可以往粮仓里放一份，也可以站在旁边看。\n粮仓里的粮食会翻倍，最后分给所有人。\n有人想：反正别人会凑，我不用出粮；\n也有人想：如果没人凑，全村都要饿肚子。\n村长端着空碗看着大家，等待第一把粮食落进仓里。\n\n投入者先扣20分。\n若投入人数 ≥ 半数：公共总奖励 = 玩家人数 × 20 分，由投入者平分（向下取整），旁观者+10。\n若投入人数 < 半数：投入者-20，旁观者0。\n投入者越多，每人分得越少。`,
    resolve(players, choices) {
      const investCount = players.filter(p => choices[p.id] === '投入').length;
              const half = Math.ceil(players.length / 2);
        const success = investCount >= half && investCount > 0;
        const totalReward = players.length * 20;
        const rewardEach = success ? Math.floor(totalReward / investCount) : 0;
      
      const deltas = {};
      players.forEach(p => {
        const invest = choices[p.id] === '投入';
        deltas[p.id] = invest ? -20 + rewardEach : (success ? 10 : 0);
      });
      return { deltas, detail: success ? `投入${investCount}人，总奖励${totalReward}，投入者每人分${rewardEach}（扣20后净${rewardEach - 20}），旁观者+10` : `投入人数不足${half}人，投入者-20` };
    }
  },
  {
    id: 'stag',
    name: '森林里的鹿与兔',
    type: 'normal',
    actions: ['猎鹿', '猎兔'],
    desc: `隆冬之前的森林，鹿群和兔群同时出现。\n猎鹿需要大家配合，捕兔却总能填饱肚子。\n如果只有一两个人去猎鹿，鹿会跑掉，猎人反而空手而归。\n可如果所有人都去猎鹿，鹿肉又要分给很多人。\n你选猎鹿，还是抓兔？\n\n猎鹿总奖励 = 玩家人数 × 20 - 20。\n猎鹿人数 ≥ 半数：总奖励由猎鹿者平分（向下取整），猎兔者+20。\n猎鹿人数 < 半数：猎鹿者-20，猎兔者+20。\n猎鹿者越多，每人分得越少；全员猎鹿时每人收益低于猎兔。`,
    resolve(players, choices) {
      const hunters = players.filter(p => choices[p.id] === '猎鹿');
      const half = Math.ceil(players.length / 2);
      const success = hunters.length >= half;
        const total = players.length * 20 - 20;
        const each = Math.floor(total / Math.max(1, hunters.length));
      const deltas = {};
      players.forEach(p => {
        if (choices[p.id] === '猎鹿') deltas[p.id] = success ? each : -20;
        else deltas[p.id] = 20;
      });
      return { deltas, detail: success ? `猎鹿成功！总价值${total}，${hunters.length}人平分，每人+${each}` : `猎鹿失败，${hunters.length}人猎鹿。` };
    }
  },
  {
    id: 'volunteer',
    name: '暴风雨前的灯塔',
    type: 'normal',
    actions: ['站出来', '不站出来'],
    desc: `海上的暴风雨即将来临，灯塔还亮着。\n只要有人愿意冒着风雨去加固灯塔，整条船的人都能活。\n可谁也不想独自冲进雨里。\n每个人都在等别人先站出来，而雨越来越大，灯塔的光越来越暗。\n\n若只有1人站出来：站出来者-20，不站出来者+20。\n若2人以上站出来：站出来者每人-10，不站出来者+20。\n没人站出来：所有人-50。`,
    resolve(players, choices) {
      const volunteers = players.filter(p => choices[p.id] === '站出来');
      const deltas = {};
      if (volunteers.length === 0) {
        players.forEach(p => deltas[p.id] = -50);
      } else {
        players.forEach(p => deltas[p.id] = choices[p.id] === '站出来' ? (volunteers.length === 1 ? -20 : -10) : 20);
      }
      return { deltas, detail: volunteers.length ? `站出来${volunteers.length}人` : '无人站出来' };
    }
  },
  {
    id: 'ultimatum',
    name: '船上的最后通牒',
    type: 'ultimatum',
    actions: [],
    desc: `商船被海盗围住，海盗头子把一袋金币放在桌上。\n“你来说，这袋金币怎么分。\n只要船上的人有一半以上同意，就按你说的办。\n不同意？那就再换一个人说。”\n甲板上的每个人都握着刀，盯着那袋金币。\n你提出方案时，必须想清楚：对方会不会接受，还是宁愿一拍两散。\n\n随机选两名玩家：提议者与回应者。\n奖励池：100分。\n提议者提出“自己和对方各拿多少”。\n回应者接受则按方案分配；拒绝则两人各扣15分。`
  },
  {
    id: 'trust',
    name: '银行门口的谣言',
    type: 'normal',
    actions: ['继续投资', '撤资'],
    desc: `城里的钱庄门口围满了人，有人说钱庄要倒了。\n继续把钱存在钱庄的人，如果钱庄撑住，可以分享一百两银子；\n急着把钱取出来的人，虽然不会大赚，但能拿到三十五两保底。\n可取钱的人越多，钱庄就越撑不住。\n\n继续投资人数 ≥ 半数：总奖励 = 玩家人数 × 25 分，由继续投资者平分（向下取整），撤资者+35。\n继续投资人数 < 半数：继续投资者-40，撤资者-10。`,
    resolve(players, choices) {
      const withdraw = players.filter(p => choices[p.id] === '撤资');
      const half = Math.ceil(players.length / 2);
      const crisis = withdraw.length >= half;
      const deltas = {};
        const continueCount = players.length - withdraw.length;
      players.forEach(p => {
        if (choices[p.id] === '撤资') deltas[p.id] = crisis ? -10 : 35;
        else deltas[p.id] = crisis ? -40 : Math.floor(players.length * 25 / Math.max(1, continueCount));
      });
      return { deltas, detail: crisis ? '危机爆发：双方都有损失' : `危机未爆发：继续投资者平分${players.length * 25}，撤资者+35` };
    }
  }
    ,
    {
      id: 'minority',
      name: '红蓝营地',
      type: 'normal',
      actions: ['A', 'B'],
      desc: `草原上分成红蓝两座营地。\n人多的一边并不安全，反而要承担更多代价。\n真正能占便宜的是少数。\n你站在路口，看见左边人群涌向红色旗帜，右边只有零星几个人。\n可真正到了夜晚，赢的往往是站到少数那边的人。\n你选红，还是蓝？\n\n所有人同时选 A 或 B。\n人数少的一边：每人+40。\n人数多的一边：每人-10。\n平局：所有人0分。`,
      resolve(players, choices) {
        const a = players.filter(p => choices[p.id] === 'A').length;
        const b = players.length - a;
        const deltas = {};
        players.forEach(p => {
          if (a === b) deltas[p.id] = 0;
          else if (choices[p.id] === 'A') deltas[p.id] = a < b ? 40 : -10;
          else deltas[p.id] = b < a ? 40 : -10;
        });
        return { deltas, detail: a === b ? '平局，全员0分' : `A=${a}人，B=${b}人，少数方+40` };
      }
    },
    {
      id: 'chicken',
      name: '迎面而来的车灯',
      type: 'normal',
      actions: ['硬刚', '认怂'],
      desc: `两辆车迎面而来，谁先躲谁就输了气势。\n随机两两配对。\n双方都认怂：各+10。\n一方硬刚、一方认怂：硬刚+40，认怂-20。\n双方硬刚：各-30。`,
      resolve(players, choices) {
        const deltas = {};
        players.forEach(p => deltas[p.id] = 0);
        const idx = shuffle(players.map((_, i) => i));
        for (let i = 0; i + 1 < idx.length; i += 2) {
          const a = players[idx[i]], b = players[idx[i + 1]];
          const ca = choices[a.id], cb = choices[b.id];
          if (ca === '认怂' && cb === '认怂') {
            deltas[a.id] += 10; deltas[b.id] += 10;
          } else if (ca === '硬刚' && cb === '认怂') {
            deltas[a.id] += 40; deltas[b.id] -= 20;
          } else if (ca === '认怂' && cb === '硬刚') {
            deltas[a.id] -= 20; deltas[b.id] += 40;
          } else {
            deltas[a.id] -= 30; deltas[b.id] -= 30;
          }
        }
        return { deltas, detail: '配对已随机生成' };
      }
    }
    ,
    {
      id: 'commons',
      name: '草场的贪婪',
      type: 'normal',
      actions: ['克制', '多捞'],
      desc: `一片草场养着所有人，也养着所有人的贪婪。\n所有人同时选“克制”或“多捞”。\n克制人数 ≥ 半数：克制者+20，多捞者+30。\n克制人数 < 半数：资源崩溃，克制者-30，多捞者-10。`,
      resolve(players, choices) {
        const restraint = players.filter(p => choices[p.id] === '克制');
        const half = Math.ceil(players.length / 2);
        const safe = restraint.length >= half;
        const deltas = {};
        players.forEach(p => {
          if (choices[p.id] === '克制') deltas[p.id] = safe ? 20 : -30;
          else deltas[p.id] = safe ? 30 : -10;
        });
        return { deltas, detail: safe ? '资源未被耗尽：多捞者更赚' : '资源崩溃：双方都有损失' };
      }
    },
    {
      id: 'rps',
      name: '剪刀石头布',
      type: 'normal',
      actions: ['石头', '剪刀', '布'],
      desc: `石头、剪刀、布，一念之间定胜负。\n所有人同时出手。\n每人都会和其他所有人打一场循环赛。\n每场胜者+10，败者-5，平局各0。\n总积分是全部比赛累计。`,
      resolve(players, choices) {
        const deltas = {};
        players.forEach(p => deltas[p.id] = 0);
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];
            const ca = choices[a.id], cb = choices[b.id];
            if (ca === cb) continue;
            const aWins = (ca === '石头' && cb === '剪刀') || (ca === '剪刀' && cb === '布') || (ca === '布' && cb === '石头');
            if (aWins) { deltas[a.id] += 10; deltas[b.id] -= 5; }
            else { deltas[a.id] -= 5; deltas[b.id] += 10; }
          }
        }
        return { deltas, detail: '循环赛已结算' };
      }
    }
    ,
    {
      id: 'cournot',
      name: '古诺产量博弈',
      type: 'normal',
      actions: ['低产量', '中产量', '高产量'],
      desc: `城东的市场里，几家布庄暗中较劲。\n每间布庄都觉得自己如果多织几匹，就能多赚一些银子。\n可当所有人都加足马力织布时，布匹堆积如山，价格一落千丈。\n账房先生摊开账本，低声说：\n“如果你只产一匹，能赚稳当钱；\n如果产三匹，就要赌别人不会也产三匹。”\n现在，轮到你决定：低产量、中产量，还是高产量？\n总产量越高，每匹布的价格越低。\n每生产一匹布成本10分。\n结算：你的利润 = 产量 × (单价 - 成本)。`,
      resolve(players, choices) {
        const outputMap = { '低产量': 1, '中产量': 2, '高产量': 3 };
        const total = players.reduce((s, p) => s + (outputMap[choices[p.id]] || 1), 0);
        const price = Math.max(0, 60 - total * 5);
        const deltas = {};
        players.forEach(p => {
          const q = outputMap[choices[p.id]] || 1;
          deltas[p.id] = q * (price - 10);
        });
        return { deltas, detail: `总产量${total}，单价${price}，每匹成本10` };
      }
    }
  ,
    {
      id: 'centipede',
      name: '伸向远方的路',
      type: 'centipede',
      actions: ['继续', '停止'],
      desc: `一条伸向远方的路，每一步都让人想回头。\n随机选出两名玩家轮流决策。\n每轮当前玩家可以选择“继续”或“停止”。\n停止：当前玩家拿高额奖励，另一人拿低额奖励。\n继续：轮到对方，奖金逐渐累积。`
    }
    ,
    {
      id: 'duel',
      name: '风沙中的枪口',
      type: 'duel',
      actions: ['继续靠近', '开枪'],
      desc: `风沙弥漫的荒原上，两个人相距越来越近。\n枪口越稳，命中率越高，但对方也在靠近。\n谁先开枪，谁就可能先赢；可一旦打空，就轮到对方送自己上路。\n围观的人屏住呼吸，风把沙粒吹进靴子里，你听见自己的心跳。\n\n随机选出两名玩家，轮流决定是否开枪。\n轮次越靠后，命中率越高：20%、40%、60%、80%。\n开枪命中：开枪者+70，对方-50。\n开枪未命中：开枪者-40，对方+30。\n一直不开枪到最后：双方各+40。`
    }
    ,
    {
      id: 'repeat_prisoner',
      name: '三次相遇的牢房',
      type: 'repeat',
      actions: ['合作', '背叛'],
      desc: `同一座牢房，你们要连续见面三次。\n每一次，你们都可以选择合作或者背叛。\n第一次背叛也许能占便宜，但下一次呢？\n对方会记住你做过什么。\n有人说，多次见面的人更容易学会合作；\n也有人说，背叛过一次的人，永远不值得再相信。\n\n随机两两配对，同一对连续打3轮。\n每轮双方同时选择合作或背叛。\n双方合作：各+30；单人背叛：背叛+50，合作-20；双方背叛：各-30。`
    }
    ,
    {
      id: 'pirate',
      name: '一箱金币与海盗',
      type: 'pirate',
      actions: [],
      desc: `一箱金币，几条海盗船，谁先开口谁先找死。\n最强的海盗先提出分法：每个人单独分多少。\n但船上的人都盯着金币，也盯着提建议的人。\n提案只要有一半以上反对，提议者就会被扔进海里。\n然后下一个人继续提。\n直到有人让所有人都满意，或者船上再没有人能说话。\n\n提案者提出一种100分的分配方案：每个人单独分多少。\n所有人投票，超过半数同意则通过。\n不通过则提案者被扔下海，换下一个人提案。\n直到方案通过或全部出局。`
    }
    ,
    {
      id: 'allpay',
      name: '欲望拍卖会',
      type: 'auction',
      actions: [],
      desc: `拍卖师举起槌子，台下的欲望蠢蠢欲动。\n每个人都可以出价，但无论输赢，都要支付自己的出价。\n出价最高的人能拿走那件宝贝，可是为了它，你已经先把银子交出去了。\n\n每个人都秘密出价0~200分。\n所有玩家都要支付自己的出价。\n出价最高者获得奖励 = 玩家人数 × 20 分。\n如果最高价并列，奖励由并列者平分。`
    }







];

const rooms = new Map();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function publicPlayers(room) {
  return room.players.map(p => ({ id: p.id, name: p.name, score: p.score, isBot: !!p.isBot }));
}

function publicEvent(event) {
  return { id: event.id, name: event.name, type: event.type, actions: event.actions, desc: event.desc };
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj) {
  room.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) send(p.ws, obj);
  });
}

function sendTo(room, playerId, obj) {
  const p = room.players.find(x => x.id === playerId);
  if (p && p.ws && p.ws.readyState === WebSocket.OPEN) send(p.ws, obj);
}

function createRoom(name) {
  let code = generateCode();
  while (rooms.has(code)) code = generateCode();
  const player = { id: crypto.randomUUID(), name: name || '房主', score: 100, ws: null, choice: null, isBot: false };
  const room = {
    code,
    hostId: player.id,
    players: [player],
    deck: [],
    roundIndex: 0,
    currentEvent: null,
    phase: 'waiting',
    choices: {},
    ultimatum: null,
      centipede: null,
      duel: null,
      repeat: null,
      pirate: null,
      auction: null
  };
  rooms.set(code, room);
  return room;
}

function addPlayer(room, name, ws) {
  const player = { id: crypto.randomUUID(), name: name || '玩家', score: 100, ws, choice: null, isBot: false };
  room.players.push(player);
  return player;
}

function addBot(room) {
  const botCount = room.players.filter(p => p.isBot).length;
  const player = {
    id: crypto.randomUUID(),
    name: '机器人' + String.fromCharCode(65 + botCount),
    score: 100,
    ws: null,
    choice: null,
    isBot: true
  };
  room.players.push(player);
  return player;
}


function startRound(room) {
  clearTimeout(room.discussionTimer);
  room.readConfirmed = {};
  room.phase = 'reading';
  room.activeSkillEffects = {};
  room.activeSkillTargets = {};
  room.choices = {};
  room.currentEvent = room.deck[room.roundIndex];
  room.ultimatum = null;
    room.centipede = null;
    room.duel = null;
    room.repeat = null;
    room.pirate = null;
    room.auction = null;
  room.twist = null;
  if (room.difficulty === 'hard') {
    const twists = EVENT_TWISTS[room.currentEvent.id];
    if (twists && twists.length) {
      room.twist = twists[Math.floor(Math.random() * twists.length)];
    }
  }
  broadcast(room, {
    type: 'roundStart',
    round: room.roundIndex + 1,
    totalRounds: room.deck.length,
    event: publicEvent(room.currentEvent),
    twist: room.twist ? { name: room.twist.name, desc: room.twist.desc } : null,
    players: publicPlayers(room)
  });
  if (room.difficulty === 'hard' && room.traits) {
    room.players.forEach(p => {
      const t = room.traits[p.id];
      if (t) sendTo(room, p.id, { type: 'trait', trait: t });
    });
  }
  // Bots automatically finish reading; humans click “我已读完”.
  room.cardHands = {};
  room.selectedCards = {};
  room.players.forEach(p => {
    const pool = STRATEGY_CARDS.filter(c => !c.event || c.event === room.currentEvent.id);
    const hand = shuffle(pool.slice()).slice(0, 3);
    room.cardHands[p.id] = hand;
    sendTo(room, p.id, { type: 'cardHand', cards: hand });
  });
  room.players.forEach(p => {
    if (p.isBot) room.readConfirmed[p.id] = true;
  });
  checkReadingComplete(room);
}

function checkReadingComplete(room) {
  if (room.phase !== 'reading') return;
  if (room.players.every(p => room.readConfirmed[p.id])) {
    room.phase = 'discussion';
    room.discussionStart = Date.now();
    room.chatCounts = {};
    room.players.forEach(p => room.chatCounts[p.id] = 0);
    clearTimeout(room.discussionTimer);
    room.discussionTimer = setTimeout(() => {
      if (room.phase === 'discussion') startChoice(room);
    }, 120000);
    broadcast(room, { type: 'discussionOpen', players: publicPlayers(room), minDiscussMs: 30000, maxDiscussMs: 120000 });
  }
}

function checkTraitSelection(room) {
  if (room.phase !== 'trait_select') return;
  if (room.players.every(p => room.traits[p.id])) {
    startRound(room);
  }
}
function assignBotChoices(room) {
  const actions = room.currentEvent.actions || [];
  room.players.forEach(p => {
    if (p.isBot && !room.choices[p.id]) {
      const choice = actions[Math.floor(Math.random() * actions.length)];
      p.choice = choice;
      room.choices[p.id] = choice;
    }
  });
}

function startUltimatum(room) {
  const shuffled = shuffle(room.players);
  const pairs = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = shuffled[i], b = shuffled[i + 1];
    pairs.push({
      proposerId: a.id,
      responderId: b.id,
      proposerName: a.name,
      responderName: b.name,
      share: null,
      response: null
    });
  }
  room.ultimatum = { mode: 'all', pairs };
  room.phase = 'ultimatum_propose';
  room.players.forEach(p => {
    const pair = pairs.find(x => x.proposerId === p.id || x.responderId === p.id);
    if (!pair) {
      sendTo(room, p.id, { type: 'ultimatumPhase', phase: 'propose', proposerId: null, proposerName: '', responderId: null, responderName: '' });
    } else {
      sendTo(room, p.id, { type: 'ultimatumPhase', phase: 'propose', proposerId: pair.proposerId, proposerName: pair.proposerName, responderId: pair.responderId, responderName: pair.responderName });
    }
  });
  autoUltimatumBots(room);
}

function autoUltimatumBots(room) {
  const u = room.ultimatum;
  if (!u || u.mode !== 'all') return;
  if (room.phase === 'ultimatum_propose') {
    u.pairs.forEach((pair, index) => {
      const p = room.players.find(x => x.id === pair.proposerId);
      if (p && p.isBot && pair.share == null) {
        setTimeout(() => {
          if (room.ultimatum && room.phase === 'ultimatum_propose' && pair.share == null) {
            pair.share = 30 + Math.floor(Math.random() * 41);
            checkUltimatumProposals(room);
          }
        }, 600 + index * 200);
      }
    });
  } else if (room.phase === 'ultimatum_respond') {
    u.pairs.forEach((pair, index) => {
      const p = room.players.find(x => x.id === pair.responderId);
      if (p && p.isBot && pair.response == null) {
        setTimeout(() => {
          if (room.ultimatum && room.phase === 'ultimatum_respond' && pair.response == null) {
            pair.response = Math.random() < 0.7;
            checkUltimatumResponses(room);
          }
        }, 600 + index * 200);
      }
    });
  }
}

function checkUltimatumProposals(room) {
  const u = room.ultimatum;
  if (!u || u.mode !== 'all' || !u.pairs.every(p => p.share != null)) return;
  room.phase = 'ultimatum_respond';
  u.pairs.forEach(pair => {
    sendTo(room, pair.responderId, { type: 'ultimatumOffer', share: pair.share, proposerName: pair.proposerName });
    sendTo(room, pair.responderId, { type: 'ultimatumPhase', phase: 'respond', proposerId: pair.proposerId, proposerName: pair.proposerName, responderId: pair.responderId, responderName: pair.responderName });
  });
  autoUltimatumBots(room);
}

function checkUltimatumResponses(room) {
  const u = room.ultimatum;
  if (!u || u.mode !== 'all' || !u.pairs.every(p => p.response != null)) return;
  resolveUltimatumAll(room);
}

function resolveUltimatumAll(room) {
  const u = room.ultimatum;
  const deltas = {};
  room.players.forEach(p => deltas[p.id] = 0);
  const lines = [];
  u.pairs.forEach(pair => {
    const proposer = room.players.find(x => x.id === pair.proposerId);
    const responder = room.players.find(x => x.id === pair.responderId);
    if (proposer && responder && pair.share != null) {
      if (pair.response) {
        deltas[proposer.id] += 100 - pair.share;
        deltas[responder.id] += pair.share;
        lines.push(`${proposer.name} 给 ${responder.name} ${pair.share}，接受：前者+${100 - pair.share}，后者+${pair.share}`);
      } else {
        deltas[proposer.id] += -15;
          deltas[responder.id] += -15;
          lines.push(`${proposer.name} 给 ${responder.name} ${pair.share}，拒绝：双方各-15`);
      }
    }
  });
    const roles = {};
    room.players.forEach(p => roles[p.id] = '旁观');
    u.pairs.forEach(pair => {
      roles[pair.proposerId] = '提议者';
      roles[pair.responderId] = '回应者';
    });

  applyIdentityToDeltas(room, deltas);
  room.players.forEach(p => p.score += deltas[p.id] || 0);
  room.phase = 'reveal';
  broadcast(room, {
    type: 'reveal',
      roles,
    mode: 'ulti_all',
    delta: deltas,
    detail: lines.join('\n'),
    players: publicPlayers(room)
  });
}

function startCentipede(room) {
  const [a, b] = shuffle(room.players).slice(0, 2);
  room.centipede = {
    turn: 1,
    firstId: a.id,
    secondId: b.id,
    currentId: a.id,
    history: [],
    maxTurn: 4
  };
  room.phase = 'centipede_turn';
  room.players.forEach(p => {
    const oppId = p.id === a.id ? b.id : (p.id === b.id ? a.id : null);
    if (oppId) {
      const opp = room.players.find(x => x.id === oppId);
      sendTo(room, p.id, { type: 'opponent', opponentId: oppId, opponentName: opp ? opp.name : '' });
    } else {
      sendTo(room, p.id, { type: 'opponent', opponentId: null, opponentName: '' });
    }
  });
  broadcast(room, {
    type: 'centipedeTurn',
    turn: 1,
    currentPlayerId: a.id,
    currentPlayerName: a.name,
    otherPlayerName: b.name
  });
  autoCentipedeIfBot(room);
}

function autoCentipedeIfBot(room) {
  const c = room.centipede;
  if (!c || room.phase !== 'centipede_turn') return;
  const p = room.players.find(x => x.id === c.currentId);
  if (p && p.isBot) {
    setTimeout(() => {
      if (room.centipede && room.phase === 'centipede_turn' && room.centipede.currentId === p.id) {
        const action = Math.random() < 0.35 ? '停止' : '继续';
        handleCentipedeAction(room, p.id, action);
      }
    }, 600);
  }
}

function stopRewards(turn) {
  const map = {
    1: [40, 20],
    2: [20, 60],
    3: [70, 40],
    4: [40, 80]
  };
  return map[turn] || [40, 20];
}

function handleCentipedeAction(room, playerId, action) {
  const c = room.centipede;
  if (!c) return;
  if (room.phase !== 'centipede_turn') return;
  if (c.currentId !== playerId) return;
  if (!['继续', '停止'].includes(action)) return;

  const current = room.players.find(p => p.id === c.currentId);
  const other = room.players.find(p => p.id !== c.currentId);
  if (!current || !other) return;
  c.history.push({ turn: c.turn, playerId, action });

  if (action === '停止') {
    const rewards = stopRewards(c.turn);
    const deltas = {};
    room.players.forEach(p => deltas[p.id] = 0);
    deltas[current.id] = rewards[0];
    deltas[other.id] = rewards[1];
    finishCentipede(room, deltas, `${current.name}在第${c.turn}轮选择停止：当前玩家+${rewards[0]}，对方+${rewards[1]}`);
    return;
  }

  if (c.turn >= c.maxTurn) {
    const deltas = {};
    room.players.forEach(p => deltas[p.id] = 0);
    deltas[current.id] = 70;
    deltas[other.id] = 70;
    finishCentipede(room, deltas, '双方坚持到最后：各+70');
    return;
  }

  c.turn++;
  c.currentId = c.currentId === c.firstId ? c.secondId : c.firstId;
  const otherPlayer = room.players.find(p => p.id !== c.currentId);
  broadcast(room, {
    type: 'centipedeTurn',
    turn: c.turn,
    currentPlayerId: c.currentId,
    currentPlayerName: room.players.find(p => p.id === c.currentId)?.name || '',
    otherPlayerName: otherPlayer ? otherPlayer.name : ''
  });
  autoCentipedeIfBot(room);
}

function finishCentipede(room, deltas, detail) {
  room.players.forEach(p => {
    p.score += deltas[p.id] || 0;
  });
  room.phase = 'reveal';
  broadcast(room, {
    type: 'reveal',
    mode: 'centipede',
    delta: deltas,
    detail,
    players: publicPlayers(room)
  });
}

function startDuel(room) {
  const shuffled = shuffle(room.players);
  const pairs = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = shuffled[i], b = shuffled[i + 1];
    pairs.push({
      aId: a.id,
      bId: b.id,
      firstId: a.id,
      secondId: b.id,
      turn: 1,
      currentId: a.id
    });
  }
  room.duel = { pairs, pairIndex: 0, pairCount: pairs.length, totalDeltas: {} };
  room.players.forEach(p => room.duel.totalDeltas[p.id] = 0);
  room.players.forEach(p => {
    const pair = pairs.find(x => x.aId === p.id || x.bId === p.id);
    if (pair) {
      const oppId = pair.aId === p.id ? pair.bId : pair.aId;
      const opp = room.players.find(x => x.id === oppId);
      sendTo(room, p.id, { type: 'opponent', opponentId: oppId, opponentName: opp ? opp.name : '' });
    } else {
      sendTo(room, p.id, { type: 'opponent', opponentId: null, opponentName: '' });
    }
  });
  startDuelPair(room);
}

function startDuelPair(room) {
  const d = room.duel;
  const pair = d.pairs[d.pairIndex];
  if (!pair) {
    room.phase = 'reveal';
      broadcast(room, { type: 'reveal', mode: 'duel', delta: d.totalDeltas, detail: '决斗结束', players: publicPlayers(room) });
    return;
  }
  pair.turn = 1;
  pair.currentId = pair.firstId;
  room.phase = 'duel_turn';
  const current = room.players.find(p => p.id === pair.currentId);
  const other = room.players.find(p => p.id !== pair.currentId);
  broadcast(room, {
    type: 'duelTurn',
    turn: 1,
    pairIndex: d.pairIndex + 1,
    pairCount: d.pairCount,
    currentPlayerId: pair.currentId,
    currentPlayerName: current ? current.name : '',
    otherPlayerName: other ? other.name : ''
  });
  autoDuelIfBot(room);
}

function autoDuelIfBot(room) {
  const d = room.duel;
  if (!d || room.phase !== 'duel_turn') return;
  const pair = d.pairs[d.pairIndex];
  if (!pair) return;
  const p = room.players.find(x => x.id === pair.currentId);
  if (p && p.isBot) {
    setTimeout(() => {
      if (room.duel && room.phase === 'duel_turn' && room.duel.pairs[room.duel.pairIndex] && room.duel.pairs[room.duel.pairIndex].currentId === p.id) {
        const shootChance = [0.2, 0.35, 0.5, 0.65][room.duel.pairs[room.duel.pairIndex].turn - 1] || 0.5;
        const action = Math.random() < shootChance ? '开枪' : '继续靠近';
        handleDuelAction(room, p.id, action);
      }
    }, 600);
  }
}

function hitChance(turn) {
  return [0.2, 0.4, 0.6, 0.8][turn - 1] || 0.8;
}

function handleDuelAction(room, playerId, action) {
  const d = room.duel;
  if (!d) return;
  if (room.phase !== 'duel_turn') return;
  const pair = d.pairs[d.pairIndex];
  if (!pair) return;
  if (pair.currentId !== playerId) return;
  if (!['继续靠近', '开枪'].includes(action)) return;

  const current = room.players.find(p => p.id === pair.currentId);
  const other = room.players.find(p => p.id !== pair.currentId && (p.id === pair.aId || p.id === pair.bId));
  if (!current || !other) return;

  if (action === '开枪') {
    const chance = hitChance(pair.turn);
    const hit = Math.random() < chance;
    const deltas = {};
    room.players.forEach(p => deltas[p.id] = 0);
    if (hit) {
      deltas[current.id] = 70;
      deltas[other.id] = -50;
      finishDuel(room, deltas, `第${pair.turn}轮命中（${Math.round(chance * 100)}%）：${current.name}+70，${other.name}-50`);
    } else {
      deltas[current.id] = -40;
      deltas[other.id] = 30;
      finishDuel(room, deltas, `第${pair.turn}轮未命中（${Math.round(chance * 100)}%）：${current.name}-40，${other.name}+30`);
    }
    return;
  }

  if (pair.turn >= d.maxTurn) {
    const deltas = {};
    room.players.forEach(p => deltas[p.id] = 0);
    deltas[current.id] = 40;
    deltas[other.id] = 40;
    finishDuel(room, deltas, '双方一直不开枪到最后：各+40');
    return;
  }

  pair.turn++;
  pair.currentId = pair.currentId === pair.firstId ? pair.secondId : pair.firstId;
  const otherPlayer = room.players.find(p => p.id !== pair.currentId && (p.id === pair.aId || p.id === pair.bId));
  broadcast(room, {
    type: 'duelTurn',
    turn: pair.turn,
    pairIndex: d.pairIndex + 1,
    pairCount: d.pairCount,
    currentPlayerId: pair.currentId,
    currentPlayerName: room.players.find(p => p.id === pair.currentId)?.name || '',
    otherPlayerName: otherPlayer ? otherPlayer.name : ''
  });
  autoDuelIfBot(room);
}

function finishDuel(room, deltas, detail) {
  const d = room.duel;
  room.players.forEach(p => {
    d.totalDeltas[p.id] = (d.totalDeltas[p.id] || 0) + (deltas[p.id] || 0);
    p.score += deltas[p.id] || 0;
  });
  d.pairIndex++;
  if (d.pairIndex < d.pairs.length) {
    startDuelPair(room);
  } else {
    room.phase = 'reveal';
    broadcast(room, {
      type: 'reveal',
      mode: 'duel',
      delta: d.totalDeltas,
      detail: '全部决斗结束',
      players: publicPlayers(room)
    });
  }
}

function startRepeatedPrisoner(room) {
  const shuffled = shuffle(room.players);
  const pairs = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairs.push({ aId: shuffled[i].id, bId: shuffled[i + 1].id });
  }
  room.repeat = { round: 1, maxRound: 3, pairs, choices: {} };
  room.players.forEach(p => {
    const pair = pairs.find(x => x.aId === p.id || x.bId === p.id);
    if (pair) {
      const oppId = pair.aId === p.id ? pair.bId : pair.aId;
      const opp = room.players.find(x => x.id === oppId);
      sendTo(room, p.id, { type: 'opponent', opponentId: oppId, opponentName: opp ? opp.name : '' });
    } else {
      sendTo(room, p.id, { type: 'opponent', opponentId: null, opponentName: '' });
    }
  });
  room.choices = {};
  assignBotChoices(room);
  room.phase = 'repeat_choosing';
  broadcast(room, {
    type: 'repeatPhase',
    round: 1,
    maxRound: 3,
    players: publicPlayers(room)
  });
}

function resolveRepeatRound(room) {
  const r = room.repeat;
  const deltas = {};
  room.players.forEach(p => deltas[p.id] = 0);
  const lines = [];
  r.pairs.forEach(pair => {
    const a = room.players.find(p => p.id === pair.aId);
    const b = room.players.find(p => p.id === pair.bId);
    if (!a || !b) return;
    const ca = room.choices[pair.aId], cb = room.choices[pair.bId];
    let da = 0, db = 0;
    if (ca === '合作' && cb === '合作') { da = 30; db = 30; }
    else if (ca === '背叛' && cb === '合作') { da = 50; db = -20; }
    else if (ca === '合作' && cb === '背叛') { da = -20; db = 50; }
    else { da = -30; db = -30; }
    deltas[pair.aId] = da;
    deltas[pair.bId] = db;
    lines.push(`${a.name}【${ca}】 vs ${b.name}【${cb}】：${a.name}${da>=0?'+':''}${da}，${b.name}${db>=0?'+':''}${db}`);
  });
  applyIdentityToDeltas(room, deltas);
  room.players.forEach(p => p.score += deltas[p.id] || 0);
  room.players.forEach(p => p.choice = null);
  room.choices = {};
  const finished = r.round >= r.maxRound;
  if (finished) {
    room.phase = 'reveal';
    broadcast(room, {
      type: 'reveal',
      mode: 'repeat',
        finished: true,
      delta: deltas,
      detail: `重复囚徒困境全部结束\n${lines.join('\n')}`,
      players: publicPlayers(room)
    });
  } else {
    r.round++;
      room.phase = 'reveal';
    broadcast(room, {
      type: 'reveal',
      mode: 'repeat',
        finished: false,
      delta: deltas,
      detail: `第${r.round - 1}轮结果：\n${lines.join('\n')}\n\n稍后进入第${r.round}轮…`,
      players: publicPlayers(room)
    });
    setTimeout(() => {
      if (room.repeat && room.phase === 'reveal') {
        room.phase = 'repeat_choosing';
        room.choices = {};
          assignBotChoices(room);
        broadcast(room, {
          type: 'repeatPhase',
          round: r.round,
          maxRound: r.maxRound,
          players: publicPlayers(room)
        });
      }
    }, 1800);
  }
}

const PIRATE_PLANS = [
  { self: 50, other: 50 },
  { self: 40, other: 60 },
  { self: 70, other: 30 }
];

function piratePlanOptions(room) {
  const n = Math.max(1, room.players.length - 1);
  return PIRATE_PLANS.map(p => `${p.self}分自己，其他人平分${p.other}分（每人约${Math.floor(p.other / n)}分）`);
}

function broadcastPirate(room, phase) {
  const pi = room.pirate;
  const proposer = room.players.find(p => p.id === pi.proposerId);
  broadcast(room, {
    type: 'piratePhase',
    phase,
    proposerId: pi.proposerId,
    proposerName: proposer ? proposer.name : '',
    turn: pi.turnIndex + 1,
    maxAttempts: pi.maxAttempts,
    alivePlayers: room.players.filter(p => pi.aliveIds.includes(p.id)).map(p => ({ id: p.id, name: p.name, isBot: p.isBot })),
    players: publicPlayers(room)
  });
}

function startPirate(room) {
  const order = shuffle(room.players.map(p => p.id));
  room.pirate = {
    order,
    turnIndex: 0,
    maxAttempts: order.length,
    proposerId: order[0],
      aliveIds: order.slice(),
    proposal: null,
    votes: {}
  };
  room.phase = 'pirate_propose';
  broadcastPirate(room, 'propose');
  autoPirateIfBot(room);
}

function autoPirateIfBot(room) {
  const pi = room.pirate;
  if (!pi) return;
  if (room.phase === 'pirate_propose') {
    const p = room.players.find(x => x.id === pi.proposerId);
    if (p && p.isBot) {
      setTimeout(() => {
        if (room.pirate && room.phase === 'pirate_propose' && room.pirate.proposerId === p.id) {
          handlePiratePropose(room, p.id, randomPirateProposal(room));
        }
      }, 600);
    }
  } else if (room.phase === 'pirate_vote') {
    room.players.forEach((p, index) => {
      if (p.isBot && pi.aliveIds.includes(p.id) && pi.votes[p.id] == null) {
        setTimeout(() => {
          if (room.pirate && room.phase === 'pirate_vote' && room.pirate.votes[p.id] == null) {
            handlePirateVote(room, p.id, Math.random() < 0.7);
          }
        }, 500 + index * 200);
      }
    });
  }
}

function randomPirateProposal(room) {
  const alive = room.players.filter(p => room.pirate.aliveIds.includes(p.id));
  const proposal = {};
  let remaining = 100;
  alive.forEach((p, i) => {
    if (i === alive.length - 1) {
      proposal[p.id] = remaining;
    } else {
      const left = alive.length - i - 1;
      const max = Math.max(0, remaining - left);
      const val = Math.floor(Math.random() * (max + 1));
      proposal[p.id] = val;
      remaining -= val;
    }
  });
  return proposal;
}

function handlePiratePropose(room, playerId, proposalObj) {
  if (!room.pirate || room.phase !== 'pirate_propose') return;
  if (room.pirate.proposerId !== playerId) return;
  const proposal = {};
  let total = 0;
  room.pirate.aliveIds.forEach(id => {
    const val = Math.max(0, Math.min(100, parseInt(proposalObj && proposalObj[id]) || 0));
    proposal[id] = val;
    total += val;
  });
  if (total !== 100) return;
  room.pirate.proposal = proposal;
  room.pirate.votes = {};
  room.phase = 'pirate_vote';
  const summary = room.pirate.aliveIds.map(id => {
    const p = room.players.find(x => x.id === id);
    return `${p ? p.name : '?'} ${proposal[id]}`;
  }).join('，');
  broadcast(room, {
    type: 'pirateVote',
    planText: summary,
    proposerName: room.players.find(p => p.id === playerId)?.name || '',
    players: publicPlayers(room)
  });
  autoPirateIfBot(room);
}

function handlePirateVote(room, playerId, accept) {
  if (!room.pirate || room.phase !== 'pirate_vote') return;
  if (!room.pirate.aliveIds.includes(playerId)) return;
  if (room.pirate.votes[playerId] != null) return;
  room.pirate.votes[playerId] = !!accept;
  if (Object.keys(room.pirate.votes).length < room.pirate.aliveIds.length) return;
  resolvePirate(room);
}

function resolvePirate(room) {
  const pi = room.pirate;
  const alive = room.players.filter(p => pi.aliveIds.includes(p.id));
  const accepts = Object.values(pi.votes).filter(Boolean).length;
  const majority = accepts > alive.length / 2;
  const deltas = {};
  room.players.forEach(p => deltas[p.id] = 0);
  const proposer = room.players.find(p => p.id === pi.proposerId);

  if (majority) {
    const proposal = pi.proposal || {};
    alive.forEach(p => {
      deltas[p.id] = proposal[p.id] || 0;
      p.score += deltas[p.id] || 0;
    });
    const summary = alive.map(p => `${p.name} ${deltas[p.id]}`).join('，');
      const roles = {};
      room.players.forEach(p => roles[p.id] = pi.aliveIds.includes(p.id) ? (p.id === pi.proposerId ? '提案者' : '海盗') : '出局');
    room.phase = 'reveal';
    broadcast(room, {
      type: 'reveal',
      mode: 'pirate',
        roles,
      delta: deltas,
      detail: `方案通过：${summary}`,
      players: publicPlayers(room)
    });
    return;
  }

  if (proposer) {
    proposer.score -= 50;
    deltas[proposer.id] = -50;
  }
  pi.aliveIds = pi.aliveIds.filter(id => id !== pi.proposerId);
  pi.turnIndex++;

  if (pi.aliveIds.length > 0) {
    pi.proposerId = pi.aliveIds[0];
    pi.proposal = null;
    pi.votes = {};
    room.phase = 'pirate_propose';
    broadcastPirate(room, 'propose');
    autoPirateIfBot(room);
  } else {
    room.phase = 'reveal';
    broadcast(room, {
      type: 'reveal',
      mode: 'pirate',
      delta: deltas,
      detail: '所有海盗都被否决，事件结束',
      players: publicPlayers(room)
    });
  }
}

function startAuction(room) {
  room.auction = { bids: {} };
  room.phase = 'auction_bid';
  broadcast(room, {
    type: 'auctionOpen',
    players: publicPlayers(room)
  });
  autoAuctionIfBot(room);
}

function autoAuctionIfBot(room) {
  const a = room.auction;
  if (!a) return;
  room.players.forEach((p, index) => {
    if (p.isBot && a.bids[p.id] == null) {
      setTimeout(() => {
        if (room.auction && room.phase === 'auction_bid' && room.auction.bids[p.id] == null) {
          handleAuctionBid(room, p.id, Math.floor(Math.random() * 201));
        }
      }, 500 + index * 200);
    }
  });
}

function handleAuctionBid(room, playerId, bid) {
  if (!room.auction || room.phase !== 'auction_bid') return;
  if (room.auction.bids[playerId] != null) return;
  const bidVal = Math.min(200, Math.max(0, parseInt(bid) || 0));
  room.auction.bids[playerId] = bidVal;
  if (Object.keys(room.auction.bids).length < room.players.length) return;
  resolveAuction(room);
}

function resolveAuction(room) {
  const bids = room.auction.bids;
  const maxBid = Math.max(...Object.values(bids));
  const winners = room.players.filter(p => bids[p.id] === maxBid);
  const reward = room.players.length * 20;
  const winnerShare = Math.floor(reward / Math.max(1, winners.length));
  const deltas = {};
  room.players.forEach(p => deltas[p.id] = -bids[p.id]);
  winners.forEach(p => deltas[p.id] += winnerShare);
  room.players.forEach(p => p.score += deltas[p.id] || 0);
    const roles = {};
    room.players.forEach(p => roles[p.id] = '竞拍者');

  room.phase = 'reveal';
  broadcast(room, {
      roles,
    type: 'reveal',
    mode: 'auction',
    delta: deltas,
    detail: `全支付拍卖：最高出价${maxBid}，${winners.map(w => w.name).join('、')}各得${winnerShare}`,
    players: publicPlayers(room)
  });
}











function grantDiscussionReward(room) {
  if (!room.chatCounts) return;
  const active = room.players.filter(p => (room.chatCounts[p.id] || 0) >= 2);
  if (!active.length) return;
  const winners = shuffle(active).slice(0, Math.min(2, active.length));
  const reward = 3;
  const names = [];
  winners.forEach(p => {
    p.score += reward;
    names.push(p.name);
  });
  broadcast(room, { type: 'chat', name: '系统', text: `🎉 讨论活跃奖励：${names.join('、')} 各 +${reward} 分` });
}
function startChoice(room) {
  if (room.phase !== 'discussion') return;
  clearTimeout(room.discussionTimer);
  grantDiscussionReward(room);
  if (room.currentEvent.type === 'duel') {
      startDuel(room);
    } else if (room.currentEvent.type === 'centipede') {
      startCentipede(room);
    } else if (room.currentEvent.type === 'repeat') {
      startRepeatedPrisoner(room);
    } else if (room.currentEvent.type === 'pirate') {
      startPirate(room);
    } else if (room.currentEvent.type === 'auction') {
      startAuction(room);
    } else if (room.currentEvent.type === 'ultimatum') {
    startUltimatum(room);
  } else {
    room.phase = 'choosing';
      if (room.currentEvent.id === 'prisoner') {
        const shuffled = shuffle(room.players);
        room.pairs = {};
        for (let i = 0; i + 1 < shuffled.length; i += 2) {
          const a = shuffled[i], b = shuffled[i + 1];
          room.pairs[a.id] = { opponentId: b.id, opponentName: b.name };
          room.pairs[b.id] = { opponentId: a.id, opponentName: a.name };
        }
      }
    assignBotChoices(room);
    broadcast(room, {
      type: 'choiceOpen',
      event: publicEvent(room.currentEvent),
      players: publicPlayers(room)
    });
      if (room.pairs) {
        room.players.forEach(p => {
          const o = room.pairs[p.id];
          if (o) sendTo(room, p.id, { type: 'opponent', opponentId: o.opponentId, opponentName: o.opponentName });
        });
      }
  }
}

function applyStrategyCards(room, deltas) {
  if (!room.selectedCards) return deltas;
  const eventId = room.currentEvent ? room.currentEvent.id : '';
  const coopSet = COOP_ACTIONS[eventId] || [];
  room.players.forEach(p => {
    const card = room.selectedCards[p.id];
    if (!card) return;
    let d = deltas[p.id] || 0;
    if (card.effect === 'shield') d = d < 0 ? Math.round(d / 2) : d;
    else if (card.effect === 'focus') d += 3;
    else if (card.effect === 'boost') d += 5;
    else if (card.effect === 'gamble') d += (Math.floor(Math.random() * 21) - 5);
    else if (card.effect === 'coop_bonus' && coopSet.includes(room.choices[p.id])) d += 10;
    else if (card.effect === 'aggr_bonus' && coopSet.length && !coopSet.includes(room.choices[p.id])) d += 10;
    else if (card.effect === 'minority_bonus' && eventId === 'minority') {
      const a = room.players.filter(x => room.choices[x.id] === 'A').length;
      const b = room.players.length - a;
      const isMinor = (room.choices[p.id] === 'A' && a < b) || (room.choices[p.id] === 'B' && b < a);
      if (isMinor) d += 15;
    }
    deltas[p.id] = d;
  });
  // 干扰：随机给一名其他玩家减分
  room.players.forEach(p => {
    const card = room.selectedCards[p.id];
    if (!card || card.effect !== 'disrupt') return;
    const others = room.players.filter(x => x.id !== p.id);
    if (others.length) {
      const target = others[Math.floor(Math.random() * others.length)];
      deltas[target.id] = (deltas[target.id] || 0) - 3;
    }
  });
  return deltas;
}
function applyIdentityToDeltas(room, deltas) {
  if (room.difficulty !== 'hard' || !room.traits) return deltas;
  const type = room.currentEvent ? room.currentEvent.type : '';
  const eventId = room.currentEvent ? room.currentEvent.id : '';
  const risk = ['auction', 'duel', 'ultimatum', 'pirate'].includes(type);
  const coopSet = COOP_ACTIONS[eventId] || [];
  room.players.forEach(p => {
    const trait = room.traits[p.id];
    if (!trait) return;
    const isCoop = coopSet.includes(room.choices[p.id]);
    let d = deltas[p.id] || 0;
    if (trait.id === 'disguiser') {
      deltas[p.id] = d + 4;
    } else if (trait.id === 'spy') {
      if (risk) deltas[p.id] = d + 6;
    } else if (trait.id === 'trickster') {
      if (coopSet.length) deltas[p.id] = isCoop ? d - 2 : d + (risk ? 7 : 5);
    } else if (trait.id === 'aggressor') {
      deltas[p.id] = d > 0 ? d + (risk ? 15 : 12) : d - (risk ? 15 : 12);
    } else if (trait.id === 'conservative') {
      const a = risk ? 6 : 4;
      deltas[p.id] = d > 0 ? d - a : d + a;
    } else if (trait.id === 'lucky') {
      deltas[p.id] = d + (Math.floor(Math.random() * (risk ? 21 : 17)) - (risk ? 8 : 6));
    } else if (trait.id === 'strategist') {
      if (risk) deltas[p.id] = d + 7;
    }
  });
  if (room.activeSkillEffects) {
    room.players.forEach(p => {
      const skillId = room.activeSkillEffects[p.id];
      if (!skillId) return;
      let d = deltas[p.id] || 0;
      if (skillId === 'disguise') d += 8;
      else if (skillId === 'peek') d += 4;
      else if (skillId === 'lie') d += 6;
      else if (skillId === 'all_in') d = Math.round(d * (risk ? 2 : 1.5));
      else if (skillId === 'insurance') d = d < 0 ? Math.round(d / 2) : d + 2;
      else if (skillId === 'destiny') d += (Math.random() < 0.5 ? 15 : -5);
      deltas[p.id] = d;
    });
  }
  if (room.activeSkillTargets) {
    room.players.forEach(p => {
      const skillId = room.activeSkillEffects && room.activeSkillEffects[p.id];
      const targetId = room.activeSkillTargets[p.id];
      if (skillId === 'puppet' && targetId) {
        const targetDelta = deltas[targetId] || 0;
        if (targetDelta > 0) deltas[p.id] = (deltas[p.id] || 0) + Math.round(targetDelta * 0.3);
      }
    });
  }
  deltas = applyStrategyCards(room, deltas);
  return deltas;
}

function applyHardModifier(room, result) {
  if (room.difficulty !== 'hard') return result;
  const mods = [
    { name: '市场恐慌', delta: -5 },
    { name: '意外之财', delta: 5 },
    { name: '奖励波动', delta: 3 },
    { name: '成本上升', delta: -3 }
  ];
  const mod = mods[Math.floor(Math.random() * mods.length)];
  room.players.forEach(p => {
    const trait = room.traits && room.traits[p.id];
    const isSteady = trait && trait.id === 'steady';
    const isLocked = room.activeSkillEffects && room.activeSkillEffects[p.id] === 'steady_gain';
    if (isSteady || isLocked) return;
    result.deltas[p.id] = (result.deltas[p.id] || 0) + mod.delta;
  });
  result.detail = (result.detail || '') + `\n【困难随机事件】${mod.name}：全员${mod.delta > 0 ? '+' : ''}${mod.delta}分`;
  return result;
}

function resolveNormal(room) {
  const event = room.currentEvent;
  let result = event.resolve(room.players, room.choices);
  if (room.twist && typeof room.twist.apply === 'function') {
    result = room.twist.apply(room, result) || result;
  }
  result = applyHardModifier(room, result);
  result.deltas = applyIdentityToDeltas(room, result.deltas);
  room.players.forEach(p => {
    p.score += result.deltas[p.id] || 0;
  });
  room.phase = 'reveal';
  broadcast(room, {
    type: 'reveal',
    mode: 'normal',
    choices: room.choices,
    delta: result.deltas,
    detail: result.detail || '',
    players: publicPlayers(room)
  });
}

function resolveUltimatum(room, accept) {
  const u = room.ultimatum;
  const deltas = {};
  room.players.forEach(p => deltas[p.id] = 0);
  const proposer = room.players.find(p => p.id === u.proposerId);
  const responder = room.players.find(p => p.id === u.responderId);
  if (proposer && responder) {
    deltas[proposer.id] = accept ? (100 - u.share) : 0;
    deltas[responder.id] = accept ? u.share : 0;
    proposer.score += deltas[proposer.id];
    responder.score += deltas[responder.id];
  }
  room.phase = 'reveal';
  broadcast(room, {
    type: 'reveal',
    mode: 'ultimatum',
    accept,
    proposerName: proposer ? proposer.name : '',
    responderName: responder ? responder.name : '',
    share: u.share,
    delta: deltas,
    players: publicPlayers(room)
  });
}

function nextRound(room) {
  if (room.phase !== 'reveal') return;
  room.roundIndex++;
  if (room.roundIndex >= room.deck.length) {
    room.phase = 'finished';
    const sorted = room.players.slice().sort((a, b) => b.score - a.score);
    broadcast(room, {
      type: 'gameOver',
      sorted: sorted.map(p => ({ name: p.name, score: p.score }))
    });
  } else {
    startRound(room);
  }
}

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  urlPath = decodeURIComponent(urlPath);
  if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const filePath = path.join(__dirname, 'public', urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath);
    const mime = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8'
    }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });
});

function handleMessage(ws, msg) {
  const room = ws.roomCode ? rooms.get(ws.roomCode) : null;

  switch (msg.type) {
    case 'create': {
      const newRoom = createRoom(msg.name || '房主');
      newRoom.players[0].ws = ws;
      ws.roomCode = newRoom.code;
      ws.playerId = newRoom.hostId;
      send(ws, {
        type: 'created',
        code: newRoom.code,
        playerId: newRoom.hostId,
        host: true,
        players: publicPlayers(newRoom)
      });
      break;
    }
    case 'join': {
      const code = String(msg.roomCode || '').trim().toUpperCase();
      const target = rooms.get(code);
      if (!target) { send(ws, { type: 'error', message: '房间不存在' }); return; }
      const player = addPlayer(target, msg.name || '玩家', ws);
      ws.roomCode = target.code;
      ws.playerId = player.id;
      send(ws, {
        type: 'joined',
        code: target.code,
        playerId: player.id,
        host: player.id === target.hostId,
        players: publicPlayers(target)
      });
      broadcast(target, { type: 'lobby', players: publicPlayers(target) });
      break;
    }
    case 'start': {
      if (room && room.hostId === ws.playerId && room.phase === 'waiting' && room.players.length >= 2) {
        room.difficulty = ['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal';
        room.traits = {};
        let pool = EVENTS.filter(e => e.id !== 'chicken' && e.id !== 'commons' && e.id !== 'centipede' && e.id !== 'rps');
        if (room.difficulty === 'easy') {
          const easyIds = new Set(['prisoner', 'public', 'stag', 'volunteer', 'trust', 'minority']);
          pool = pool.filter(e => easyIds.has(e.id));
        }
        room.deck = shuffle(pool).slice(0, 6);
        room.roundIndex = 0;
        if (room.difficulty === 'hard') {
          room.usedSkills = {};
          room.activeSkillEffects = {};
  room.activeSkillTargets = {};
          room.phase = 'trait_select';
          broadcast(room, { type: 'traitSelect', traits: TRAITS, players: publicPlayers(room) });
          room.players.forEach(p => {
            if (p.isBot) {
              room.traits[p.id] = TRAITS[Math.floor(Math.random() * TRAITS.length)];
            }
          });
          broadcast(room, { type: 'traitProgress', done: Object.keys(room.traits).length, total: room.players.length });
        } else {
          startRound(room);
        }
      }
      break;
    }
      case 'addBot': {
        if (room && room.hostId === ws.playerId && room.phase === 'waiting' && room.players.length < 8) {
          addBot(room);
          broadcast(room, { type: 'lobby', players: publicPlayers(room) });
        }
        break;
      }

    case 'selectTrait': {
      if (!room || room.phase !== 'trait_select') return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      const trait = TRAITS.find(t => t.id === msg.traitId);
      if (!trait) return;
      room.traits[player.id] = trait;
      sendTo(room, player.id, { type: 'trait', trait });
      broadcast(room, { type: 'traitProgress', done: Object.keys(room.traits).length, total: room.players.length });
      checkTraitSelection(room);
      break;
    }
    case 'useSkill': {
      if (!room || room.difficulty !== 'hard' || !room.traits) return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      const trait = room.traits[player.id];
      if (!trait || !trait.skill) return;
      if (room.usedSkills[player.id]) return;
      room.usedSkills[player.id] = true;
      room.activeSkillEffects[player.id] = trait.skill.id;
      if (trait.id === 'strategist') {
        const others = room.players.filter(x => x.id !== player.id);
        if (others.length) {
          room.activeSkillTargets[player.id] = others[Math.floor(Math.random() * others.length)].id;
        }
      }
      if (trait.id === 'spy') {
        const others = room.players.filter(x => x.id !== player.id);
        if (others.length) {
          const target = others[Math.floor(Math.random() * others.length)];
          const targetTrait = room.traits[target.id];
          if (targetTrait) {
            sendTo(room, player.id, { type: 'spyInfo', name: target.name, trait: targetTrait });
          }
        }
      }
      broadcast(room, { type: 'chat', name: '系统', text: `${player.name} 发动了主动技能` });
      break;
    }
    case 'selectCard': {
      if (!room || !room.cardHands) return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      const card = (room.cardHands[player.id] || []).find(c => c.id === msg.cardId);
      if (!card || room.selectedCards[player.id]) return;
      room.selectedCards[player.id] = card;
      sendTo(room, player.id, { type: 'cardSelected', card });
      break;
    }
    case 'confirmRead': {
      if (!room || room.phase !== 'reading') return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      room.readConfirmed[player.id] = true;
      broadcast(room, { type: 'readingProgress', read: Object.keys(room.readConfirmed).length, total: room.players.length });
      checkReadingComplete(room);
      break;
    }
    case 'startChoice': {
      if (room && room.hostId === ws.playerId) {
        if (room.phase === 'discussion') {
          const elapsed = Date.now() - (room.discussionStart || 0);
          if (elapsed < 30000) {
            send(ws, { type: 'error', message: `请先在讨论区讨论至少 ${Math.ceil((30000 - elapsed) / 1000)} 秒` });
          } else {
            startChoice(room);
          }
        } else if (room.phase === 'choosing') {
          broadcast(room, { type: 'choiceOpen', event: publicEvent(room.currentEvent), players: publicPlayers(room) });
        } else if (room.phase === 'repeat_choosing' && room.repeat) {
          broadcast(room, { type: 'repeatPhase', round: room.repeat.round, maxRound: room.repeat.maxRound, players: publicPlayers(room) });
        }
      }
      break;
    }
    case 'choose': {
      if (!room) return;
        if (room.phase === 'repeat_choosing') {
          const player = room.players.find(p => p.id === ws.playerId);
          if (!player) return;
          player.choice = msg.choice;
          room.choices[player.id] = msg.choice;
          if (Object.keys(room.choices).length >= room.players.length) {
            resolveRepeatRound(room);
          } else {
            broadcast(room, { type: 'choiceSubmitted', playerId: player.id });
          }
          break;
        }
        if (room.phase !== 'choosing') return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      player.choice = msg.choice;
      room.choices[player.id] = msg.choice;
      if (room.players.every(p => p.choice !== null && p.choice !== undefined)) {
        resolveNormal(room);
      } else {
        broadcast(room, { type: 'choiceSubmitted', playerId: player.id });
      }
      break;
    }
      case 'piratePropose': {
        if (!room || room.phase !== 'pirate_propose') return;
        handlePiratePropose(room, ws.playerId, msg.proposal || {});
        break;
      }
      case 'pirateVote': {
        if (!room || room.phase !== 'pirate_vote') return;
        handlePirateVote(room, ws.playerId, !!msg.accept);
        break;
      }
      case 'auctionBid': {
        if (!room || room.phase !== 'auction_bid') return;
        handleAuctionBid(room, ws.playerId, parseInt(msg.bid) || 0);
        break;
      }


    case 'ultimatumPropose': {
      if (!room || room.phase !== 'ultimatum_propose') return;
      if (room.ultimatum && room.ultimatum.mode === 'all') {
          const pair = room.ultimatum.pairs.find(x => x.proposerId === ws.playerId);
          if (!pair) return;
          pair.share = Math.min(100, Math.max(0, parseInt(msg.share) || 50));
          checkUltimatumProposals(room);
          break;
        }
        if (!room.ultimatum || room.ultimatum.proposerId !== ws.playerId) return;
      room.ultimatum.share = Math.min(100, Math.max(0, parseInt(msg.share) || 50));
      room.phase = 'ultimatum_respond';
      broadcast(room, {
        type: 'ultimatumPhase',
        phase: 'respond',
        proposerId: room.ultimatum.proposerId,
        proposerName: room.players.find(p => p.id === room.ultimatum.proposerId)?.name || '',
        responderId: room.ultimatum.responderId,
        responderName: room.players.find(p => p.id === room.ultimatum.responderId)?.name || ''
      });
      sendTo(room, room.ultimatum.responderId, {
        type: 'ultimatumOffer',
        share: room.ultimatum.share,
        proposerName: room.players.find(p => p.id === room.ultimatum.proposerId)?.name || ''
      });
        const botResponder = room.players.find(p => p.id === room.ultimatum.responderId);
        if (botResponder && botResponder.isBot) {
          resolveUltimatum(room, Math.random() < 0.7);
        }

      break;
    }
    case 'ultimatumRespond': {
      if (!room || room.phase !== 'ultimatum_respond') return;
      if (room.ultimatum && room.ultimatum.mode === 'all') {
          const pair = room.ultimatum.pairs.find(x => x.responderId === ws.playerId);
          if (!pair) return;
          pair.response = !!msg.accept;
          checkUltimatumResponses(room);
          break;
        }
        if (!room.ultimatum || room.ultimatum.responderId !== ws.playerId) return;
      resolveUltimatum(room, !!msg.accept);
      break;
    }
      case 'centipedeAction': {
        if (!room || room.phase !== 'centipede_turn') return;
        handleCentipedeAction(room, ws.playerId, String(msg.action || ''));
        break;
      }
      case 'duelAction': {
        if (!room || room.phase !== 'duel_turn') return;
        handleDuelAction(room, ws.playerId, String(msg.action || ''));
        break;
      }


    case 'nextRound': {
      if (room && room.hostId === ws.playerId) nextRound(room);
      break;
    }
    case 'ping': {
      break;
    }
    case 'chat': {
      if (!room) return;
      const player = room.players.find(p => p.id === ws.playerId);
      if (!player) return;
      const text = String(msg.text || '').slice(0, 200);
      if (room.phase === 'discussion' && room.chatCounts) {
        room.chatCounts[player.id] = (room.chatCounts[player.id] || 0) + 1;
      }
      broadcast(room, { type: 'chat', name: player.name, text });
      break;
    }
  }
}

httpServer.listen(PORT, () => {
  console.log(`博弈场运行在 http://0.0.0.0:${PORT}`);
});
