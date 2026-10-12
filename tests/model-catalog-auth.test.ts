import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config';
import { modelsRequest } from '../src/server';

test('missing or malformed catalog credentials fail locally as401 without upstream or cached catalog', async () => {
  let upstreamCalls = 0;
  for (const authorization of [undefined, '', 'Basic fixture', 'Bearer ']) {
    const headers = new Headers();
    if (authorization !== undefined) headers.set('authorization', authorization);
    let failure: unknown;
    const response = await modelsRequest(new Request('http://fixture.invalid/v1/models', { headers }),
      defaultConfig('browser-only'), async () => { upstreamCalls++; return Response.json({models:[]}); },
      undefined, value => { failure = value; });
    expect(response.status).toBe(401);
    expect(failure).toEqual({stage:'request'});
    expect(await response.text()).not.toContain('models');
  }
  expect(upstreamCalls).toBe(0);
});
