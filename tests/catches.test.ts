// plan 6.3 Changed catch / docs/METRICS.md section 7. Never run in Dirty Mode.
import { describe, expect, it } from 'vitest';
import type { ChangeV1 } from '../src/core/types';
import { LOGGER_NAMES } from '../src/diffmetrics/catches';
import { analyze } from '../src/diffmetrics/index';

/** One added production file whose only hunk is the whole file; returns that hunk's catch flag. */
function flag(catchBody: string, path = 'src/c.ts'): boolean | 'unknown' {
  const head = `export async function f(logger: any, telemetry: any) {\n  try {\n    run();\n  } catch (e) {\n${catchBody}\n  }\n}\n`;
  const a = analyze({ schema: 's45.change/1', id: 'catch', files: [{ path, base: null, head }] });
  return a.metrics[0]?.catchMaySwallow.value ?? 'unknown';
}

describe('catch_may_swallow', () => {
  it('pins LOGGER_NAMES', () => {
    expect(LOGGER_NAMES).toEqual(['log', 'logger', 'logError', 'warn', 'report', 'reportError', 'track', 'telemetry']);
  });

  it.each([
    ['empty block', ''],
    ['console.* only', '    console.warn("x", e);\n    console.error(e);'],
    ['logger name call', '    logError(e);'],
    ['property call on a logger name', '    logger.error(e);\n    telemetry.send(e);'],
  ])('flags %s', (_name, body) => {
    expect(flag(body)).toBe(true);
  });

  it.each([
    ['rethrow', '    console.warn(e);\n    throw e;'],
    ['return', '    return null;'],
    ['assignment', '    console.warn(e);\n    lastError = e;'],
    ['assignment inside a logging call', '    log(state = e);'],
    ['increment', '    errors++;'],
    ['non-logging call', '    recover(e);'],
    ['property call on a non-logger object', '    this.logger.error(e);'],
    ['await of a logging call', '    await log(e);'],
  ])('does not flag %s', (_name, body) => {
    expect(flag(body)).toBe(false);
  });

  it('never flags test or config files', () => {
    expect(flag('', 'src/c.test.ts')).toBe(false);
    expect(flag('', 'vite.config.ts')).toBe(false);
  });

  it('applies only to hunks with a head atom inside the clause span', () => {
    const base = 'export function f() {\n  try {\n    run();\n  } catch (e) {\n  }\n}\n';
    const head = 'export function f() {\n  try {\n    run();\n    runMore();\n  } catch (e) {\n  }\n}\n';
    const input: ChangeV1 = { schema: 's45.change/1', id: 'catch-span', files: [{ path: 'src/c.ts', base, head }] };
    const a = analyze(input);
    expect(a.hunks.length).toBe(1);
    expect(a.metrics[0]?.catchMaySwallow.value).toBe(false);
  });
});
