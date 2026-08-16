/**
 * Unit coverage for the workbench trace projection.
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { activatedSkills, deriveTrace, parseSkillName } from '../src/client/trace.ts'

/** Minimal running call. */
function running(key: string, anchorSeq: number, name: string, argsRaw: string, time: number): unknown {
  return {
    key,
    id: key,
    target: 'chat',
    kind: 'tool-call',
    anchorSeq,
    data: {
      root: { callId: `call-${key}`, name, argsRaw, turn: 1, step: 1, time, callView: null, subCalls: [] },
    },
  }
}

/** Minimal settled call with a rendered text result. */
function settled(
  key: string,
  anchorSeq: number,
  name: string,
  argsRaw: string,
  time: number,
  content: string,
  options: { isError?: boolean; errorMessage?: string } = {},
): unknown {
  const { isError = false, errorMessage = '' } = options
  return {
    key,
    id: key,
    target: 'chat',
    kind: 'tool-call',
    anchorSeq,
    data: {
      root: {
        kind: 'tool-result',
        seq: anchorSeq,
        time,
        callId: `call-${key}`,
        call: { name, argsRaw },
        callTime: time,
        content: [{ type: 'text', text: content }],
        isError,
        ...(errorMessage === '' ? {} : { error: { message: errorMessage } }),
        callView: null,
        resultView: null,
        subCalls: [],
      },
    },
  }
}

/** Wrap raw nodes into a snapshot carrying only the fields deriveTrace reads. */
function snapshot(nodes: readonly unknown[]): ConversationSnapshot {
  return {
    sessionId: 's-1',
    chat: { nodes: { values: () => nodes } },
  } as unknown as ConversationSnapshot
}

describe('deriveTrace', () => {
  it('orders rows by anchor seq and tags tools with the active skill', () => {
    const snapshotWith = snapshot([
      settled('skill', 2, 'skill', '{"name":"cordis-plugin-development"}', 100, '## Instructions\nfull body'),
      settled('bash', 5, 'bash', '{"command":"ls"}', 200, 'output'),
      settled('skill', 8, 'skill', '{"name":"editing-cordis-compositions"}', 300, '## Editing'),
      settled('read', 10, 'read', '{"file_path":"a.ts"}', 400, 'text'),
    ])
    const trace = deriveTrace(snapshotWith)
    expect(trace.map(entry => entry.seq)).toEqual([2, 5, 8, 10])
    expect(trace[0]).toMatchObject({ kind: 'skill-load', tool: 'skill', skillName: 'cordis-plugin-development', ok: true })
    expect(trace[1]).toMatchObject({ kind: 'tool', tool: 'bash', skill: 'cordis-plugin-development', ok: true })
    expect(trace[2]).toMatchObject({ kind: 'skill-load', skillName: 'editing-cordis-compositions' })
    expect(trace[3]).toMatchObject({ kind: 'tool', tool: 'read', skill: 'editing-cordis-compositions' })
  })

  it('exposes the rendered skill body as content', () => {
    const trace = deriveTrace(snapshot([
      settled('skill', 1, 'skill', '{"name":"a"}', 100, 'body text'),
    ]))
    expect(trace[0]?.output).toBe('body text')
  })

  it('marks settled errors with detail and ok:false', () => {
    const trace = deriveTrace(snapshot([
      settled('skill', 1, 'skill', '{"name":"missing"}', 100, '', { isError: true, errorMessage: 'skill "missing" is unknown' }),
      settled('bash', 2, 'bash', '{"command":"false"}', 200, '', { isError: true, errorMessage: 'exit code 1' }),
    ]))
    expect(trace[0]).toMatchObject({ ok: false, detail: 'skill "missing" is unknown', running: false })
    expect(trace[1]).toMatchObject({ ok: false, detail: 'exit code 1' })
  })

  it('treats a non-zero bash exit-code marker as an error', () => {
    const trace = deriveTrace(snapshot([
      settled('bash', 1, 'bash', '{"command":"verify.sh"}', 100, 'FAIL: 缺少指标行 largestPopulation=\n[exit code: 1]'),
    ]))
    expect(trace[0]).toMatchObject({ ok: false, detail: '命令退出码 1' })
    expect(trace[0]?.output).toContain('FAIL: 缺少指标行 largestPopulation=')
  })

  it('keeps a zero exit-code marker as a success', () => {
    const trace = deriveTrace(snapshot([
      settled('bash', 1, 'bash', '{"command":"verify.sh"}', 100, 'PASS: 全部指标通过\n[exit code: 0]'),
    ]))
    expect(trace[0]).toMatchObject({ ok: true, detail: null })
  })

  it('flags in-flight calls as running and does not tag them as active skills', () => {
    const trace = deriveTrace(snapshot([
      running('skill', 1, 'skill', '{"name":"a"}', 100),
      running('bash', 2, 'bash', '{"command":"ls"}', 200),
    ]))
    expect(trace[0]).toMatchObject({ kind: 'skill-load', running: true, ok: false, skillName: 'a' })
    expect(trace[1]).toMatchObject({ running: true, skill: null })
  })

  it('returns an empty list without a snapshot', () => {
    expect(deriveTrace(undefined)).toEqual([])
  })

  it('truncates long argument strings', () => {
    const trace = deriveTrace(snapshot([
      settled('bash', 1, 'bash', `{"command":"${'x'.repeat(4000)}"}`, 100, ''),
    ]))
    expect(trace[0]?.args?.length).toBeLessThanOrEqual(2004)
  })

  it('ignores non-tool chat nodes', () => {
    const trace = deriveTrace(snapshot([
      { key: 'u1', id: 'u1', target: 'chat', kind: 'user', anchorSeq: 1, data: { text: 'hi' } },
    ]))
    expect(trace).toEqual([])
  })
})

describe('activatedSkills', () => {
  it('returns distinct loaded skills in first-load order, skipping failures and running calls', () => {
    const trace = deriveTrace(snapshot([
      settled('s1', 1, 'skill', '{"name":"a"}', 100, 'A'),
      settled('s2', 2, 'skill', '{"name":"b"}', 200, 'B'),
      settled('s3', 3, 'skill', '{"name":"a"}', 300, 'A again'),
      running('s4', 4, 'skill', '{"name":"c"}', 400),
      settled('s5', 5, 'skill', '{"name":"d"}', 500, '', { isError: true, errorMessage: 'no' }),
    ]))
    const activated = activatedSkills(trace)
    expect(activated.map(entry => entry.skillName)).toEqual(['a', 'b'])
    expect(activated[0]?.output).toBe('A')
  })
})

describe('parseSkillName', () => {
  it('parses the skill loader argument', () => {
    expect(parseSkillName('{"name":"cordis-plugin-development"}')).toBe('cordis-plugin-development')
  })

  it('returns null for malformed or name-less input', () => {
    expect(parseSkillName('{"name":123}')).toBeNull()
    expect(parseSkillName('{not json')).toBeNull()
    expect(parseSkillName('{"other":1}')).toBeNull()
    expect(parseSkillName(null)).toBeNull()
  })
})
