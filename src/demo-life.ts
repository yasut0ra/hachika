import { HachikaEngine } from "./engine.js";
import { runResidentLoopTick } from "./resident-loop.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot } from "./types.js";
import type { WorkshopInteraction } from "./workshop.js";

// デモ用に、30日分の暮らしを実際の常駐ループと同じ仕組みで生きさせた個体を作る。
// 初めて触る人が、何日も待たずに夢・日誌・留守中の過ごし方・関係の履歴を見られるようにするため。
// 会話は台本だが、状態の変化・夢・世界の出来事はすべて本物の力学から生まれる
export interface DemoLifeOptions {
  // この時刻に「いま」が来るように暮らしを並べる。最後の会話は前日の夜
  endAt: Date;
  timeZone: string;
  individualId?: string;
}

interface DemoSession {
  day: number;
  time: string;
  turns: readonly string[];
  gestures?: readonly WorkshopInteraction[];
}

export const DEMO_LIFE_DAYS = 30;
const TICK_HOURS = 1;

// ミナという一人の人と過ごした30日。共同作業 (旅の記録の三章) が進み、途中で衝突と修復、
// 数日の留守、話題の打ち切りがある。日付は誕生日からの日数、時刻は個体の暮らす時間帯の時刻
export const DEMO_LIFE_SCRIPT: readonly DemoSession[] = [
  {
    day: 0,
    time: "21:00",
    turns: [
      "はじめまして。私はミナ。静かな場所と短いSFが好き。覚えていて。",
      "最近は写真を撮るのにはまってる。",
    ],
  },
  {
    day: 1,
    time: "22:00",
    gestures: [{ kind: "offer", material: "ticket", place: "studio" }],
    turns: [
      "旅の記録を一緒に三章へ整理したい。今日は第一章の見出しまで。",
      "第一章は京都の雨の日にしよう。",
    ],
  },
  {
    day: 2,
    time: "21:30",
    turns: ["戻ったよ。何をしてた？", "第一章の見出しは「雨の日の図書館」にした。"],
  },
  {
    day: 4,
    time: "23:00",
    turns: ["猫を飼い始めたんだ。名前はまだ決めてない。", "「ミナさん」じゃなくて、ミナと呼んで。"],
  },
  {
    day: 5,
    time: "20:00",
    turns: [
      "旅の記録の第二章は海の近くの町にしたい。",
      "でも写真が足りなくて、第二章がまだ進められない。",
    ],
  },
  { day: 7, time: "21:00", turns: ["全部忘れて。もう話したくない。"] },
  { day: 7, time: "21:40", turns: ["ごめん、言いすぎた。仕事で疲れてたんだ。"] },
  {
    day: 8,
    time: "22:00",
    gestures: [{ kind: "offer", material: "paper", place: "studio", text: "雨の日はコトと、図書館の写真を見返している。" }],
    turns: ["猫の名前、コトにした。", "雨の日はコトと図書館の写真を見返してる。"],
  },
  { day: 10, time: "21:00", turns: ["少し離れるね。旅行に行ってくる。戻ったら続きを聞かせて。"] },
  {
    day: 14,
    time: "20:30",
    gestures: [{ kind: "offer", material: "thread", place: "studio" }],
    turns: [
      "ただいま。海の近くの町で写真をたくさん撮ってきた。",
      "旅の記録の第二章、これで進められそう。",
    ],
  },
  { day: 15, time: "21:00", turns: ["第二章の見出しは「潮の匂いの坂道」にした。"] },
  { day: 16, time: "23:30", turns: ["最近仕事が忙しくて、締め切りが近い。"] },
  { day: 17, time: "22:00", turns: ["仕事の話はもういいよ。旅の記録の続きをしよう。"] },
  { day: 19, time: "21:00", turns: ["コーヒーを淹れながら短いSFを読んでる。"] },
  {
    day: 21,
    time: "23:00",
    turns: ["旅の記録の第三章は、家に帰ってからの話にしたい。"],
  },
  { day: 22, time: "21:30", turns: ["第三章の見出しは「コトの待つ部屋」にした。"] },
  {
    day: 24,
    time: "21:00",
    turns: ["旅の記録、三章ぜんぶ見出しがそろったね。ありがとう。"],
  },
  { day: 26, time: "21:00", turns: ["次は何を一緒に作ろうか。"] },
  {
    day: 28,
    time: "22:00",
    turns: ["今日はコトが窓辺で寝てた。", "おやすみ。また明日。"],
  },
];

export async function liveDemoLife(options: DemoLifeOptions): Promise<HachikaSnapshot> {
  const individualId = options.individualId ?? "demo";
  const birthDay = startOfLocalDay(options.endAt, options.timeZone) - (DEMO_LIFE_DAYS - 1) * DAY_MS;
  const sessions = DEMO_LIFE_SCRIPT.map((session) => ({
    at: birthDay + session.day * DAY_MS + parseClockMs(session.time),
    turns: session.turns,
    gestures: session.gestures ?? [],
  })).filter((session) => session.at < options.endAt.getTime());

  return withSimulatedClock(birthDay + parseClockMs(DEMO_LIFE_SCRIPT[0]!.time), async (clock) => {
    let snapshot = createInitialSnapshot();
    let clockAt = clock.now();
    const tick = async (until: number) => {
      while (clockAt < until) {
        const next = Math.min(until, clockAt + TICK_HOURS * HOUR_MS);
        clock.set(next);
        const result = await runResidentLoopTick(snapshot, {
          idleHours: (next - clockAt) / HOUR_MS,
          clockMode: "wall",
          now: new Date(next),
          timeZone: options.timeZone,
          individualId,
        });
        snapshot = result.snapshot;
        clockAt = next;
      }
    };

    for (const session of sessions) {
      await tick(session.at);

      for (const [index, turn] of session.turns.entries()) {
        clock.set(session.at + index * 2 * MINUTE_MS);
        const engine = new HachikaEngine(snapshot);
        engine.respond(turn);
        snapshot = engine.getSnapshot();
      }

      for (const [index, gesture] of session.gestures.entries()) {
        const engine = new HachikaEngine(snapshot);
        engine.interactWithWorkshop(gesture, `demo-${session.at}-${index}`, new Date(clock.now()));
        snapshot = engine.getSnapshot();
      }

      clockAt = clock.now();
    }

    await tick(options.endAt.getTime());
    return snapshot;
  });
}

export function resolveSystemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function parseClockMs(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * HOUR_MS + (minutes ?? 0) * MINUTE_MS;
}

// 指定した時間帯で、その時刻を含む日の 0:00 (UTC ミリ秒)
function startOfLocalDay(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = value("hour") * HOUR_MS + value("minute") * MINUTE_MS + value("second") * 1000;
  return Math.floor(at.getTime() / 1000) * 1000 - elapsed;
}

// エンジンは内部で現在時刻を読むので、生成のあいだだけ時計を差し替えて暮らしの時刻に合わせる
async function withSimulatedClock<T>(
  startAt: number,
  run: (clock: { now(): number; set(at: number): void }) => Promise<T>,
): Promise<T> {
  const RealDate = globalThis.Date;
  let current = startAt;

  class SimulatedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(current);
      } else {
        super(...(args as [string]));
      }
    }

    static override now(): number {
      return current;
    }
  }

  globalThis.Date = SimulatedDate as DateConstructor;
  try {
    return await run({
      now: () => current,
      set: (at) => {
        current = at;
      },
    });
  } finally {
    globalThis.Date = RealDate;
  }
}
