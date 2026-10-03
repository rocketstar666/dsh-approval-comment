// dsh-approval-comment — client half.
//
// Seamlessly replaces the built-in approval panel by registering into the same
// `conversation.composer` chain slot at a lower priority (the chain elects the
// first entry whose selector matches, and the built-in panel sits at
// priority 1). The replacement keeps the native approval-card look and adds a
// free-text "say some" box.
//
// Four-quadrant behavior:
//   - allow, no comment  → the tool runs as requested.
//   - allow + comment    → the comment is steered into the current turn, then
//     the tool runs; the model sees the comment on its next step and adjusts.
//   - reject, no comment → the tool is rejected; the host half terminates the
//     current turn (stop).
//   - reject + comment   → the comment is steered into the current turn, then
//     the tool is rejected; the model sees "rejected" + the comment on its
//     next step, adjusts, and continues automatically.
window.__ModuleLoader__.load({
  id: 'dsh-approval-comment',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const jsx = require('react/jsx-runtime')

    function selectApproval({ pendingInteraction }) {
      return pendingInteraction?.kind === 'approval' ? pendingInteraction : null
    }

    const styles = {
      root: {
        padding: '8px calc(var(--dsh-composer-side-clearance) + 16px) 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      },
      card: {
        width: '100%',
        maxWidth: 'var(--dsh-chat-content-width)',
        border: '1px solid var(--dsw-alias-state-warn-secondary)',
        background: 'var(--dsw-specific-input-major)',
        boxShadow: 'var(--dsw-shadow-lv2)',
        borderRadius: '20px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      },
      strip: {
        background: 'var(--dsw-alias-state-warn-tertiary)',
        color: 'var(--dsw-alias-state-warn-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 16px',
        fontSize: '13px',
        lineHeight: '18px',
      },
      dot: {
        background: 'var(--dsw-alias-state-warn-primary)',
        borderRadius: '50%',
        width: '8px',
        height: '8px',
        flexShrink: 0,
      },
      body: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '12px 16px 0',
        boxSizing: 'border-box',
      },
      headline: {
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '15px',
        fontWeight: 500,
        lineHeight: '24px',
      },
      textarea: {
        width: '100%',
        minHeight: '64px',
        resize: 'vertical',
        boxSizing: 'border-box',
        padding: '10px 12px',
        fontSize: '14px',
        lineHeight: '20px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-specific-input-major)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '12px',
        fontFamily: 'inherit',
      },
      actionRow: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        padding: '14px 16px',
      },
      button: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        padding: '6px 14px',
        fontSize: '14px',
        lineHeight: '20px',
        fontWeight: 500,
        borderRadius: '999px',
        cursor: 'pointer',
        border: '1px solid transparent',
        transition: 'background 0.15s, color 0.15s',
        fontFamily: 'inherit',
      },
      reject: {
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary)',
        borderColor: 'var(--dsw-alias-state-error-primary)',
      },
      rejectHover: {
        background: 'var(--dsw-alias-state-error-tertiary)',
      },
      allow: {
        background: 'var(--dsw-alias-interactive-bg-primary)',
        color: 'var(--dsw-alias-interactive-fg-primary)',
      },
    }

    function apply(ctx) {
      const sessions = ctx.sessions
      ctx.slots.inject('conversation.composer', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer',
            select: selectApproval,
            priority: 0,
          },
          ApprovalPanel(sessions),
        ),
      )
    }

    function ApprovalPanel(sessions) {
      return function ApprovalPanelComponent(props) {
        const pending = props.matched
        const [comment, setComment] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [answered, setAnswered] = React.useState(false)
        const [rejectHover, setRejectHover] = React.useState(false)

        if (pending === null || pending === undefined) return null

        const toolName = pending.toolName ?? 'tool'
        const reason = pending.reason
        const headline = reason ?? `工具 ${toolName} 请求越权执行`

        const answer = (outcome) => {
          if (typeof pending.answer !== 'function') return
          setAnswered(true)
          pending
            .answer(outcome)
            .catch(() => setAnswered(false))
        }

        const deliverComment = async (text) => {
          const session = sessions.binding(pending.sessionId)?.session
          if (session === undefined) throw new Error('no session binding')
          const content = [{ type: 'text', text }]
          // Steer first: inject into the running turn so the model reacts on its
          // very next step. Fall back to a queued turn if steering is unavailable.
          let result = await session.prompt(content, 'steer')
          if (!result || result.ok !== true) {
            result = await session.prompt(content, 'queue')
          }
          if (!result || result.ok !== true) throw new Error('prompt delivery failed')
        }

        const submit = async (outcome) => {
          if (busy || answered) return
          setBusy(true)
          try {
            const text = comment.trim()
            if (text !== '') {
              try {
                await deliverComment(text)
              } catch {
                // Comment delivery failed; the decision below still proceeds so a
                // rejection is never lost.
              }
            }
            answer(outcome)
          } finally {
            setBusy(false)
          }
        }

        const disabled = busy || answered

        return jsx.jsx('div', {
          style: styles.root,
          'data-approval-key': pending.key,
          children: jsx.jsxs('div', {
            style: styles.card,
            children: [
              jsx.jsxs('div', {
                style: styles.strip,
                children: [jsx.jsx('span', { style: styles.dot }), '等待审批'],
              }),
              jsx.jsxs('div', {
                style: styles.body,
                children: [
                  jsx.jsx('div', { style: styles.headline, children: headline }),
                  jsx.jsx('textarea', {
                    style: styles.textarea,
                    value: comment,
                    disabled,
                    placeholder: '可选：填写补充说明（拒绝时将据此调整并继续；允许时将一并生效）。',
                    onChange: (event) => setComment(event.target.value),
                  }),
                ],
              }),
              jsx.jsxs('div', {
                style: styles.actionRow,
                children: [
                  jsx.jsx(
                    'button',
                    {
                      type: 'button',
                      style: { ...styles.button, ...styles.reject, ...(rejectHover ? styles.rejectHover : {}) },
                      disabled,
                      onMouseEnter: () => setRejectHover(true),
                      onMouseLeave: () => setRejectHover(false),
                      onClick: () => submit('rejected'),
                      children: '拒绝',
                    },
                  ),
                  jsx.jsx(
                    'button',
                    {
                      type: 'button',
                      style: { ...styles.button, ...styles.allow },
                      disabled,
                      onClick: () => submit('allowed-once'),
                      children: '允许一次',
                    },
                  ),
                ],
              }),
            ],
          }),
        })
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'sessions']
    return module.exports
  },
})
