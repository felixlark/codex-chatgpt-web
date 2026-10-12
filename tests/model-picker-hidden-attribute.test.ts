import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { selectChatGptModelFamily } from "../src/adapters/chatgpt-web/model-selection";

for (const attribute of ["", 'aria-hidden="false"']) {
  test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)(`select original 5.6 with active toggle ${attribute || "attribute omitted"}`, async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<div role="menu" id="owned">
        <div data-model-picker-view="simple">
          <div role="menuitem" data-model-picker-view-toggle="true" ${attribute}>Select model</div>
          <div hidden><div data-model-picker-view-toggle="true">Foreign hidden toggle</div></div>
          <div role="menuitemradio" aria-checked="true">Latest</div>
          <div role="menuitemradio" aria-checked="false" hidden>GPT-5.6 Sol</div>
        </div></div><script>
        const view = document.querySelector('[data-model-picker-view]');
        const option = document.querySelector('[aria-checked="false"]');
        document.querySelector('[role="menuitem"]').onclick = () => {
          view.dataset.modelPickerView = 'advanced'; option.hidden = false;
        };
        option.onclick = () => {
          document.querySelector('[aria-checked="true"]').setAttribute('aria-checked', 'false');
          option.setAttribute('aria-checked', 'true');
        };
        </script>`);
      const menu = { menu: page.locator("#owned") } as Parameters<typeof selectChatGptModelFamily>[0];
      await selectChatGptModelFamily(menu, "5.6", async () => menu);
      expect(await page.getByRole("menuitemradio", { name: "GPT-5.6 Sol", exact: true }).getAttribute("aria-checked")).toBe("true");
      expect(await page.getByRole("menuitemradio", { name: "Latest", exact: true }).getAttribute("aria-checked")).toBe("false");
    } finally { await browser.close(); }
  }, 60_000);
}
