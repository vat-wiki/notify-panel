/**
 * writeToPty 跨工具适配测试:验证注入时序对 codex/claude/opencode/pi 都正确。
 *
 * 核心契约:writeToPty 必须保证 child.write(text) 和 child.write("\r")
 * 不在同一个事件循环 tick。原因(实测发现):
 *   - codex(ratatui)在同一个 tick 读到 "text\r" 会把 \r 当文本处理,不提交
 *   - claude / opencode / pi 对同 tick 的 \r 宽容,但分开写也无副作用
 * 所以"分 tick"是适配所有工具的最小公共要求。
 *
 * 本测试用 mock child 记录每次 write 所属的"事件循环批次",
 * 不起真实工具(避免网络/模型/TTY 依赖)。真实工具的观察数据作为注释固化。
 *
 * 2024 实测各工具提交键行为(Python pty 一次写,供参考):
 *   | 工具      | \r 提交 | \n 提交 |
 *   |-----------|---------|---------|
 *   | claude    | ✓       | (多行) |
 *   | codex     | ✓       | ✗       |
 *   | opencode  | ✓       | (多行) |
 *   | pi        | ✓       | -       |
 *   所有工具都认 \r 为提交键;tui 扩展固定发 \r。
 */
import { describe, expect, it } from "vitest";
import { writeToPty } from "../src/pty.js";

/** Mock child:记录每次 write 的内容 + 它所属的"事件循环批次"。 */
interface RecordedWrite {
  data: string;
  /**
   * 事件循环批次号:同步调用栈内连续 write 共享同一 batch;
   * 跨越宏任务边界(setTimeout/setImmediate 触发)后 batch 递增。
   * 这能区分"同 tick 连写"和"分 tick 写"。
   */
  batch: number;
}

function makeMockChild() {
  const writes: RecordedWrite[] = [];
  let batch = 0;
  // 每个宏任务边界追一:当前同步代码结束后(setImmediate),
  // 后续 write 的 batch 号就更大。writeToPty 的 setTimeout(\r)
  // 必然在 setImmediate 之后执行 → batch 更大 → 与 text 不同 tick。
  const bump = () => void (batch += 1);
  setImmediate(bump);
  // 持续 bump:每个宏任务边界都追,确保后续 setTimeout 也跨 batch
  const interval = setInterval(bump, 0);
  return {
    writes,
    /** 测试结束清理(否则 interval 挂住进程)。 */
    done: () => clearInterval(interval),
    child: {
      write: (s: string | Buffer) => {
        writes.push({ data: s.toString(), batch });
        return true;
      },
    },
  };
}

describe("writeToPty:跨工具适配", () => {
  it("claude / codex / opencode / pi:text 先写入,\\r 在不同 tick 跟上", async () => {
    // 这是对所有工具的核心保证。writeToPty 同步写 text,异步(setTimeout)
    // 写 \r —— 两者必然不在同一 tick(codex 需要,其他无副作用)。
    for (const tool of ["claude", "codex", "opencode", "pi"]) {
      const mock = makeMockChild();
      try {
        const inject = writeToPty(mock.child as any);

        const ok = inject("hello");
        expect(ok, `${tool}: inject 应返回 true`).toBe(true);

        // 此刻 text 已写,\r 还没(在 setTimeout 队列里)
        const textWrites = mock.writes.filter((w) => w.data === "hello");
        expect(textWrites, `${tool}: text 应已写入`).toHaveLength(1);

        // 推进 tick 让 setTimeout 触发
        await new Promise((r) => setTimeout(r, 150));

        const crWrites = mock.writes.filter((w) => w.data === "\r");
        expect(crWrites, `${tool}: \\r 应已写入`).toHaveLength(1);

        // 关键断言:text 和 \r 不在同一 batch(不同事件循环 tick)
        const textBatch = textWrites[0].batch;
        const crBatch = crWrites[0].batch;
        expect(
          crBatch,
          `${tool}: \\r 的 batch(${crBatch}) 应 > text 的 batch(${textBatch})`,
        ).toBeGreaterThan(textBatch);
      } finally {
        mock.done();
      }
    }
  });

  it("注入返回 true 时 text 必定已送达(投递契约:不丢消息)", () => {
    // writeToPty 返回 true 的语义:text 已写进 child.write。
    // \r 异步跟上,但 text 的交付是同步确认的。
    // 这支撑 watcher 的"inject 成功才标记已读"契约。
    const mock = makeMockChild();
    try {
      const inject = writeToPty(mock.child as any);
      const ok = inject("通知内容");
      expect(ok).toBe(true);
      // text 同步写入,inject 返回时已在 writes 里
      expect(mock.writes.some((w) => w.data === "通知内容")).toBe(true);
    } finally {
      mock.done();
    }
  });

  it("child.write 抛错时返回 false(目标已退出)", () => {
    const failingChild = {
      write: () => {
        throw new Error("EPIPE");
      },
    };
    const inject = writeToPty(failingChild as any);
    expect(inject("x")).toBe(false);
  });

  it("\\r 的写入失败不抛错(静默,目标可能刚退出)", async () => {
    // text 写成功,但 \r 写时目标已退出 → 不该抛错
    let writeCount = 0;
    const child = {
      write: () => {
        writeCount++;
        if (writeCount === 2) throw new Error("gone");
        return true;
      },
    };
    const inject = writeToPty(child as any);
    expect(inject("hi")).toBe(true);
    // 等 \r 的 setTimeout,\r 写失败不应抛
    await new Promise((r) => setTimeout(r, 150));
    expect(writeCount).toBe(2);
  });

  it("多次注入:每次的 text 和 \\r 都正确配对", async () => {
    const mock = makeMockChild();
    try {
      const inject = writeToPty(mock.child as any);

      inject("msg1");
      await new Promise((r) => setTimeout(r, 150));
      inject("msg2");
      await new Promise((r) => setTimeout(r, 150));

      // 应有 4 次 write:msg1, \r, msg2, \r
      expect(mock.writes.map((w) => w.data)).toEqual([
        "msg1",
        "\r",
        "msg2",
        "\r",
      ]);
    } finally {
      mock.done();
    }
  });
});
