/// <reference types="bun" />
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Window as TestWindow } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';

type Options = Parameters<NonNullable<Window['turnstile']>['render']>[1];
let useVoteGate: typeof import('./useVoteGate')['useVoteGate'];
let createRoot: typeof import('react-dom/client')['createRoot'];
let gate: ReturnType<typeof useVoteGate>;
let root: Root;
let host: HTMLDivElement;
let attempts: Options[];
let casts: Array<string | undefined>;
let cancellations: number;
let scripts: HTMLScriptElement[];
let appendSpy: { mockRestore: () => void };
let testWindow: TestWindow;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

const Harness = () => { gate = useVoteGate(); return gate.challenge; };
const openVote = async () => {
  await act(async () => gate.guardVote((token) => casts.push(token), () => { cancellations += 1; }));
};
const click = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent === text)!;
  await act(async () => button.click());
};

beforeAll(async () => {
  // No scripts, network requests, Cloudflare challenges or actual votes run.
  testWindow = new TestWindow({ settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  for (const [name, value] of Object.entries({ window: testWindow, document: testWindow.document, HTMLElement: testWindow.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
  ({ useVoteGate } = await import('./useVoteGate'));
  delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  ({ createRoot } = await import('react-dom/client'));
});

beforeEach(async () => {
  attempts = [];
  casts = [];
  cancellations = 0;
  scripts = [];
  const append = document.head.appendChild.bind(document.head);
  appendSpy = spyOn(document.head, 'appendChild').mockImplementation(((node: Node) => {
    if (node.nodeName === 'SCRIPT') { scripts.push(node as HTMLScriptElement); return node; }
    return append(node);
  }) as typeof document.head.appendChild);
  window.turnstile = {
    render: (_element, options) => { attempts.push(options); return String(attempts.length); },
    remove: () => {},
    reset: () => {},
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  appendSpy.mockRestore();
  document.querySelectorAll('script').forEach((script) => script.remove());
});
afterAll(async () => {
  await testWindow.happyDOM.close();
  for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('vote verification recovery', () => {
  it('starts a fresh visible challenge on vote, with loading feedback and no background check', async () => {
    expect(attempts).toHaveLength(0);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await openVote();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.appearance).toBe('always');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Verifying');
    expect(casts).toEqual([]);
    await act(async () => attempts[0]!.callback('verified-token'));
    expect(casts).toEqual(['verified-token']);
    expect(gate.challengeOpen).toBe(false);
    await act(async () => attempts[0]!.callback('duplicate-token'));
    expect(casts).toHaveLength(1);
  });

  it('keeps failures visible and retries a new challenge without losing or duplicating the vote', async () => {
    await openVote();
    const failed = attempts[0]!;
    await act(async () => failed['error-callback']!('300010'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Your vote has not been sent');
    expect(casts).toEqual([]);
    expect(cancellations).toBe(0);
    await act(async () => failed.callback('late-token'));
    expect(casts).toEqual([]);
    await click('Retry check');
    expect(attempts).toHaveLength(2);
    await act(async () => failed.callback('old-attempt-token'));
    expect(casts).toEqual([]);
    await act(async () => attempts[1]!.callback('retry-token'));
    expect(casts).toEqual(['retry-token']);
  });

  it('cancels once and ignores callbacks after dismissal', async () => {
    await openVote();
    const pending = attempts[0]!;
    await click('Cancel vote');
    await act(async () => pending.callback('too-late'));
    expect(cancellations).toBe(1);
    expect(casts).toEqual([]);
    expect(gate.challengeOpen).toBe(false);
    await openVote();
    expect(attempts).toHaveLength(2);
  });

  it('shows an actionable hostname configuration error', async () => {
    await openVote();
    await act(async () => attempts[0]!['error-callback']!('110200'));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('not configured for this site');
    expect(casts).toEqual([]);
  });

  it('handles interactive timeouts and offers retry instead of a blank dialog', async () => {
    await openVote();
    await act(async () => attempts[0]!['timeout-callback']!());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('timed out');
    await click('Retry check');
    expect(attempts).toHaveLength(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('bounds a challenge that never calls back', async () => {
    const realTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
      if (delay === 60_000) expire = callback;
      return realTimeout(callback, delay);
    }) as typeof setTimeout);
    try {
      await openVote();
      expect(expire).toBeDefined();
      await act(async () => expire!());
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('timed out');
      expect(casts).toEqual([]);
    } finally { timer.mockRestore(); }
  });

  it('recovers when the script fails to load', async () => {
    delete window.turnstile;
    await openVote();
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');
    const firstScript = scripts[0]!;
    await act(async () => firstScript.dispatchEvent(new testWindow.Event('error') as unknown as Event));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not load');
    await click('Retry check');
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).not.toBe(firstScript);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');
    // Release the loader promise before the next test.
    await act(async () => scripts[1]!.dispatchEvent(new testWindow.Event('error') as unknown as Event));
    expect(casts).toEqual([]);
  });

  it('bounds a script request that never loads or errors', async () => {
    delete window.turnstile;
    const realTimeout = globalThis.setTimeout;
    let expire: (() => void) | undefined;
    const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => {
      if (delay === 15_000) expire = callback;
      return realTimeout(callback, delay);
    }) as typeof setTimeout);
    try {
      await openVote();
      expect(expire).toBeDefined();
      await act(async () => expire!());
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not load');
      expect(document.querySelector('script')).toBeNull();
      expect(casts).toEqual([]);
    } finally { timer.mockRestore(); }
  });
});
