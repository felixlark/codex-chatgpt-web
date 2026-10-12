import { expect, test } from "bun:test";
import { HttpTurnCounter } from "../src/server";

test("a materialized model catalog releases its owner before a slow client reads it", async () => {
  const turns = new HttpTurnCounter();
  const payload = { models: [{ slug: "native", description: "x".repeat(250_000) }] };
  const response = await turns.track(async () => Response.json(payload), undefined, "linux", "models");
  try {
    expect(turns.count()).toBe(0);
    expect(await response.json()).toEqual(payload);
  } finally { if (!response.bodyUsed) await response.body!.cancel(); }
});

test("an unfinished model catalog fetch still prevents a release and propagates cancellation", async () => {
  const turns = new HttpTurnCounter();
  let aborted = false;
  const incoming = turns.track(signal => new Promise<Response>((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
  }), undefined, "linux", "models");
  const observed = incoming.catch(() => {});
  expect(turns.count()).toBe(1);
  expect(await turns.cancelAll()).toBe(1);
  await observed;
  expect(aborted).toBe(true); expect(turns.count()).toBe(0);
});

test("Responses body ownership remains tracked until its stream completes", async () => {
  const turns = new HttpTurnCounter();
  const response = await turns.track(async () => Response.json({ message: "still owned" }), undefined, "linux", "responses");
  expect(turns.count()).toBe(1);
  await response.text(); expect(turns.count()).toBe(0);
});
