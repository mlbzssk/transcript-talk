import type { Summary5W1H, Transcript } from "./core/types";

/**
 * 硬编码演示数据。
 *
 * 背景说明（如实标注）：2025-2026 年 YouTube 对无登录态会话（数据中心 IP、
 * 无 cookie fetch、headless 浏览器）全面启用 "Sign in to confirm you're not a bot"
 * 风控，抓取成功率极不稳定——这正是需求建议硬编码字幕的原因。
 *
 * 以下字幕为依据原视频主题（a16z: "Marc Andreessen's 2026 Outlook: AI Timelines,
 * US vs. China, and The Price of AI"）人工整理的演示转写，用于：
 *   1. 演示视频的自动兜底（仅当请求的是 DEMO_VIDEO_ID）
 *   2. 无 LLM API Key 时的演示模式（GEMINI_API_KEY 与 OPENAI_API_KEY 至少其一）
 */

export const DEMO_VIDEO_ID = "xRh2sVcNXQ8";

export const DEMO_VIDEO_TITLE = "Marc Andreessen's 2026 Outlook: AI Timelines, US vs. China, and The Price of AI";

/** 人工整理的演示字幕（英文 ASR 风格转写） */
const DEMO_TRANSCRIPT_TEXT = `
so Marc let's start with the big question everyone is asking
what happens with AI in 2026
well I think we're past the science fair stage
for the first forty years of computing we had demos
now we have products and that changes everything
the chatbot was the first product
the agent is the next one
an agent doesn't just answer questions
it books your flight it files your expense report it writes the code
and 2026 is the year agents actually ship at scale
you've said timelines are compressing
what does that mean in practice
capability that I expected in 2030 is showing up in 2025
the labs keep trading predictions for calendar pages
part of it is scale
part of it is that we learned how to train these systems better
and part of it is just the money
when hundreds of billions of dollars flow into something
things move fast
let's talk about the money
there's this question about whether AI is a bubble
people compare it to the telecom fiber crash of 2000
here's the thing about the fiber crash
the fiber got laid
the crash was in the stocks not in the fiber
and the fiber became the substrate for the next twenty years of the internet
I think compute is our fiber
the GPUs are being installed
the data centers are being built
even if some stocks crash the compute stays
and the compute becomes the substrate for the next twenty years of AI
but what about the revenue question
critics say the revenue doesn't justify the capex
so let's actually look at the numbers
AI is probably the fastest ramping technology product in history
we went from zero to meaningful billions in revenue in about two years
the telephone took decades
electricity took decades
even smartphones took several years to get to real revenue
and it's not just one company
the whole stack is monetizing
consumer subscriptions at the front
enterprise API usage in the middle
and full platform deals at the top
and the demand curve is not saturating
every time the price drops usage explodes
which brings me to the cost side
this is the part I find most exciting
the price of intelligence is collapsing
tokens are getting cheaper by something like ten times per year
a query that cost dollars two years ago costs pennies now
and it's heading to fractions of a cent
and here's the kicker
when the marginal cost of a unit of intelligence falls that fast
you don't save money
you use infinitely more of it
that's Jevons paradox
it happened with coal it happened with electricity
it happened with bandwidth and it will happen with intelligence
so the smart money is on demand expanding to fill every corner of the economy
what about China
the US and China are running a two horse race here
and I think the US has been underestimated on manufacturing
yes building a gigawatt data center is hard
but American companies are doing it in eighteen months now
the constraint isn't capability it's energy and permitting
meanwhile China has the complete stack
they have the models they have the chips coming
they have the manufacturing base and the power plants
this is not a sprint it's a marathon at sprint speed
and the rest of the world needs to decide how to plug in
beyond chatbots what's coming in the physical world
this is the sleeper story of 2026
robots
for forty years robotics was stuck because software was the bottleneck
you can't hand write the code for a machine to navigate a warehouse
but now the model learns like a person learns
watch demonstrations touch things fail and try again
humanoid robots are entering factories and warehouses right now
and the cost curve looks like what we saw with drones
expensive military hardware became hundred dollar toys
the same thing is happening to robots
physical labor becomes a subscription
what would you tell a founder listening right now
three things
first the technology always gets cheaper and better faster than you expect
build for the model that will exist in a year not the one that exists today
second the bottleneck is moving up the stack
when intelligence is cheap the scarce things are taste distribution and trust
figure out what humans still want from humans
and third don't fight the current
every technology wave creates its own jobs
the movie industry didn't kill theater it created Hollywood
AI won't kill knowledge work it will transform what knowledge work means
so is 2026 the year of the trillion dollar question
look the trillion dollar question was always
when does this stop being infrastructure and start being the economy
my answer is it already has
the debate is over the build out continues
and the people who understand that first
will be the ones who build the next twenty years
`.trim();

export const DEMO_TRANSCRIPT: Transcript = {
  videoId: DEMO_VIDEO_ID,
  title: DEMO_VIDEO_TITLE,
  author: "a16z",
  languageCode: "en",
  text: DEMO_TRANSCRIPT_TEXT,
  source: "demo",
};

/** 无 LLM API Key 时的演示文章（假流逐字下发，复刻基础演示效果） */
export const DEMO_ARTICLE = `# 对话安德森：AI 革命的万亿美金之问

当大模型的算力投入被质疑为泡沫，Marc Andreessen（下称 Mark）给出了一个充满历史感的回答：光纤危机崩溃的是股票，而不是光纤。本文以对话形式复盘这场关于 2026 年 AI 走向的深谈。

## 开场：2026 年的万亿之问

**主持人**：Mark，先从所有人都关心的问题开始——2026 年，AI 会发生什么？

**Mark**：我认为我们已经跨过了"科技展会"阶段。计算器前四十年只有演示品，而现在我们有了真正的产品——这改变了一切。

**主持人**：产品化意味着什么？

**Mark**：聊天机器人是第一个产品，代理（Agent）是下一个。代理不只是回答问题，它会帮你订机票、报销、写代码。2026 年，就是代理真正规模化落地的一年。

**主持人**：你说过时间线在压缩？

**Mark**：我原本预期 2030 年才有的能力，2025 年就出现了。实验室们不断把预测换成日历页——部分靠规模，部分靠更好的训练方法，还有部分，纯粹是钱。当几千亿美元涌进一个领域，事情就会变快。

## 美中竞速：两种模式的赛跑

**主持人**：谈谈竞赛格局吧，大家总在比较美国和中国。

**Mark**：这确实是一场双人赛马。而且我觉得美国在制造能力上被低估了——建一座千兆瓦级数据中心确实难，但美国公司现在十八个月就能建成。真正的约束不是能力，而是能源和审批。

**主持人**：中国呢？

**Mark**：中国拥有完整的栈——模型、即将量产的芯片、制造基地和电厂。这不是短跑，是以短跑速度进行的马拉松。而世界其他国家要决定的是：如何接入这套体系。

## 智能经济：收入爆发与成本塌陷

**主持人**：回到那个万亿美金的问题——AI 是泡沫吗？有人拿 2000 年电信光纤泡沫来类比。

**Mark**：光纤泡沫的关键是：光纤铺好了。崩盘的是股票，不是光纤。那些光纤成了之后二十年互联网的底座。算力就是我们的光纤——GPU 在安装，数据中心在建。就算有些股票崩了，算力还在，它会成为未来二十年 AI 的底座。

**主持人**：但收入能证明这些资本开支是合理的吗？

**Mark**：看数字。AI 可能是历史上收入爬坡最快的技术产品：大约两年时间，从零冲到有意义的数十亿美元。电话用了几十年，电力用了几十年，智能手机也用了好几年。而且不是一家公司在赚钱——消费者订阅在前，企业 API 调用居中，平台级合作在顶，整个技术栈都在变现。

**主持人**：需求侧呢？

**Mark**：需求曲线远没有饱和。每次降价，用量都爆炸式增长。这就说到最让我兴奋的部分：智能的价格在坍塌。token 成本大约每年下降十倍，两年前要花一美元的查询，现在只要几美分，还在向一美分的零头逼近。

**主持人**：成本下降，厂商不是赚得更少吗？

**Mark**：恰恰相反。当一单位智能的边际成本下降得足够快，人们不会省钱，而是无限量地使用它——这是杰文斯悖论。煤炭时代发生过，电力发生过，带宽发生过，智能也必然发生。聪明的钱应该押注：需求会扩张到填满经济的每个角落。

## 物理世界：机器人是沉睡的故事

**主持人**：聊天窗口之外，物理世界会发生什么？

**Mark**：这是 2026 年的沉睡故事——机器人。机器人学被困了四十年，瓶颈是软件：你不可能手写出让机器在仓库里导航的代码。但现在，模型像人一样学习：看演示、动手、失败、再试。人形机器人正在进厂。

**主持人**：成本呢？

**Mark**：成本曲线和无人机如出一辙——昂贵的军用硬件，最后变成一百美元的玩具。机器人正在经历同样的事，体力劳动会变成一种订阅服务。

## 尾声：给创业者的三句话

**主持人**：最后，对正在收听的创业者说三句话吧。

**Mark**：第一，技术变便宜、变好的速度永远比你预期的快，为一后年后的模型做设计，而不是今天的。第二，瓶颈在上移——当智能变得廉价，稀缺的是品味、分发和信任，想清楚人类依然想从人类这里得到什么。第三，别逆流而行——每一波技术都创造自己的就业，电影没有杀死戏剧，而是创造了好莱坞。AI 不会杀死知识工作，它会重新定义知识工作的含义。

**主持人**：所以，2026 是"万亿美金之问"揭晓的一年？

**Mark**：万亿美金之问从来是：这一切何时从"基础设施"变成"经济体"？我的答案是——已经发生了。争论结束了，建设仍在继续。而最先理解这一点的人，将建造下一个二十年。`;

/** 演示模式下的 5W1H 示例（「智能经济」章节，来自需求文档） */
export const DEMO_SUMMARIES: Record<string, Summary5W1H> = {
  "智能经济：收入爆发与成本塌陷": {
    who: "Mark",
    what: "AI 行业的收入增长、商业模式、普及速度、定价方式和单位成本下降趋势。",
    when: "当前 AI 商业化早期，以及未来十年。",
    where: "消费者 AI 市场、企业 AI 市场、云服务和数据中心基础设施领域。",
    why: "AI 可以依托已有互联网快速触达全球用户，并能为个人和企业直接创造效率提升、收入增长和成本优化等价值。",
    how: "通过消费者订阅、企业按需 token 计费和基于业务价值的变现方式获得收入；同时随着 GPU 和数据中心供给改善，单位成本下降会进一步扩大需求。",
  },
};
