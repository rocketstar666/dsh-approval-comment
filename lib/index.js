// dsh-approval-comment — host half.
//
// Behaviors, implemented on top of the approval seam without touching core:
//
//   1. Observe every approval decision by wrapping the answerer chain
//      (`approval/request` with `prepend: true`). `next()` delegates to the
//      built-in web answerer, which shows the approval UI; we then post-process
//      the outcome.
//
//   2. One-shot grant (grant-next): when the user attaches a "say some" comment
//      to an approval decision (allow or reject), the comment is steered into
//      the current turn and the model is expected to act on it — possibly by
//      issuing another privileged call with adjusted arguments. That follow-up
//      call would otherwise re-prompt. We detect the comment (the agent inbox
//      has pending input at decision time) and grant ONE automatic `allowed-once`
//      for the agent's next approval request.
//
//      The grant is scoped to the CURRENT TURN: it is cleared at `turn/end` and
//      also when the agent leaves the comment step (next step has no user
//      message), so an adjustment that needed no escalation (e.g. rewrite into
//      the workspace) cannot leak an auto-approval into a later turn.
//
//   3. Stop-on-reject through `agent/pre-step`:
//        - plain rejection (no comment) → reject the step (`{ kind: 'reject' }`),
//          terminating the current turn (stop, wait for the user).
//        - rejection with a comment → the comment arrives as steering input in
//          this step's messages, so we let the step through; the model sees
//          "rejected" + the comment and adjusts, then continues automatically.
//
// `approval/policy = 'never'` rejections never reach the answerer chain (the
// approval service short-circuits before the waterfall), so unattended/CI runs
// are unaffected.

export const name = 'dsh-approval-comment'
export const inject = []

/** Agent ids whose most recent approval decision was a plain human rejection. */
const rejected = new Set()

/** Agent ids granted one automatic approval for their next privileged call. */
const grantNext = new Set()

export function apply(ctx) {
  ctx.on(
    'approval/request',
    async (req, next) => {
      // One-shot grant: the user commented on the previous approval and the
      // model is now re-issuing the adjusted call — let it through without a
      // second prompt.
      if (grantNext.has(req.agent.id)) {
        grantNext.delete(req.agent.id)
        return 'allowed-once'
      }

      let outcome
      try {
        outcome = await next()
      } catch {
        outcome = 'unavailable'
      }

      if (outcome === 'rejected' || outcome === 'cancelled') {
        rejected.add(req.agent.id)
      }

      // A pending comment (steered into the inbox before the answer) means the
      // user adjusted the request; authorize the model's next privileged call so
      // the adjustment runs without a second approval prompt.
      if (
        outcome === 'allowed-once' &&
        req.agent.inbox.hasPending
      ) {
        grantNext.add(req.agent.id)
      }

      return outcome
    },
    { prepend: true },
  )

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    // A user-role message claimed for this step is the "say some" comment
    // (steered in); it marks the adjustment step. Tool results enter the request
    // separately, so any user message here is genuine human steering/input.
    const hasComment = payload.messages.some((message) => message.role === 'user')

    // grant-next is only valid inside the comment/adjustment step. Leaving it
    // (next step has no user message) means the adjustment either completed or
    // needed no escalation — discard any unconsumed grant so it cannot leak
    // into a later step/turn.
    if (grantNext.has(payload.agent.id) && !hasComment) {
      grantNext.delete(payload.agent.id)
    }

    if (!rejected.has(payload.agent.id)) return decision
    rejected.delete(payload.agent.id)

    // Rejection with a comment: let the model process it and adjust (continue).
    if (hasComment) return decision

    // Plain rejection: terminate the current turn (stop, wait for the user).
    return { kind: 'reject' }
  })

  // Turn boundary: neither `rejected` nor `grantNext` may survive past the turn
  // that produced them — otherwise a grant from an earlier scenario would
  // auto-approve an unrelated privileged call in a later turn.
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') {
      rejected.delete(session.id)
      grantNext.delete(session.id)
    }
  })
}
