import { describe, expect, it } from 'vitest'
import { computeFactcheckState } from './factcheck-state'

const v = (id: string, minute: number, source = 'edit') => ({ id, source, createdAt: new Date(Date.UTC(2026, 10, 16, 8, minute)) })
const job = (status: string, documentVersionId: string, minute = 0) => ({ status, documentVersionId, updatedAt: new Date(Date.UTC(2026, 10, 16, 9, minute)) })

describe('computeFactcheckState', () => {
  it('is never checked when no job exists (saving does not start one)', () => {
    expect(computeFactcheckState({ currentVersionId: 'a', jobs: [], versions: [v('a', 0)] }).status).toBe('never')
  })
  it('is done when the current version was checked', () => {
    const state = computeFactcheckState({ currentVersionId: 'a', jobs: [job('succeeded', 'a')], versions: [v('a', 0)] })
    expect(state).toMatchObject({ status: 'done', checkedVersionId: 'a' })
  })
  it('is outdated after an edit', () => {
    const state = computeFactcheckState({ currentVersionId: 'b', jobs: [job('succeeded', 'a')], versions: [v('a', 0), v('b', 5)] })
    expect(state).toMatchObject({ status: 'outdated', checkedVersionId: 'a' })
  })
  it('stays done when only accepted AI fixes changed the note', () => {
    const state = computeFactcheckState({ currentVersionId: 'c', jobs: [job('succeeded', 'a')], versions: [v('a', 0), v('b', 5, 'ai_fix'), v('c', 6, 'ai_fix')] })
    expect(state.status).toBe('done')
  })
  it('reports queued, running and budget pauses for the current version', () => {
    const versions = [v('a', 0), v('b', 5)]
    expect(computeFactcheckState({ currentVersionId: 'b', jobs: [job('queued', 'b'), job('succeeded', 'a')], versions }).status).toBe('queued')
    expect(computeFactcheckState({ currentVersionId: 'b', jobs: [job('running', 'b')], versions }).status).toBe('running')
    expect(computeFactcheckState({ currentVersionId: 'b', jobs: [job('paused_budget', 'b')], versions }).status).toBe('paused_budget')
  })
  it('reports a failed check of the current version', () => {
    const state = computeFactcheckState({ currentVersionId: 'a', jobs: [{ ...job('failed', 'a'), lastError: 'boom' }], versions: [v('a', 0)] })
    expect(state).toMatchObject({ status: 'failed', lastError: 'boom' })
  })
})
